# Memory: Rocco's own, and the PC's (plans\memory.md). On 2026-11-15 Rocco's server grew to 44 GB in a night and took
# the PC with it. So the server writes a line about itself to %APPDATA%\Rocco\memory.log once a minute (its memory, and
# what it was asked that minute), restarts itself past a limit (Settings, "Restart Rocco above"), and no new agent is
# started while the PC is short of memory.

# Below this much free memory (GB), no new agent starts: a new checkout is refused, a parked task isn't handed back,
# and a feature's own agent isn't opened. The sidebar turns amber below $MemoryLow and red below $MemoryVeryLow.
$MemoryFloor = 6
$MemoryLow = 8
$MemoryVeryLow = 4
# Rocco restarts itself above this many GB, unless Settings say otherwise.
$MemoryLimitDefault = 3
$MemoryLimits = 1, 2, 3, 4, 6, 8, 12, 16
# How often the server looks at itself (seconds), and how long after starting it never restarts for memory, so a
# Rocco that starts out big doesn't restart over and over. Tests make both short.
$MemoryTick = $(if ($env:ROCCO_MEMORY_TICK) { [int]$env:ROCCO_MEMORY_TICK } else { 60 })
$MemoryGrace = $(if ($env:ROCCO_MEMORY_GRACE) { [int]$env:ROCCO_MEMORY_GRACE } else { 600 })
$MemoryLogDays = 7
$MemoryLogFile = Join-Path $RoccoHome 'memory.log'
$MemoryRestartFile = Join-Path $RoccoHome 'restarted.json'
$MemoryWait = 'More free memory on this PC'

# This PC's free (available) and total memory, in GB. ROCCO_TEST_FREE_GB stands in for it in the tests.
$script:PcMemory = $null
function Get-PcMemory {
	if ($env:ROCCO_TEST_FREE_GB) { return [pscustomobject]@{ free = [double]$env:ROCCO_TEST_FREE_GB; total = 64.0 } }
	if (-not $script:PcMemory -or ((Get-Date) - $script:PcMemory.Read).TotalSeconds -gt 5) {
		Add-Type -AssemblyName Microsoft.VisualBasic # loaded only when asked: an agent's command usually isn't
		$info = New-Object Microsoft.VisualBasic.Devices.ComputerInfo
		$script:PcMemory = @{ Read = Get-Date; Value = [pscustomobject]@{ free = [Math]::Round($info.AvailablePhysicalMemory / 1GB, 1); total = [Math]::Round($info.TotalPhysicalMemory / 1GB, 1) } }
	}
	$script:PcMemory.Value
}

# Too little free memory to start another agent.
function Test-MemoryShort { (Get-PcMemory).free -lt $MemoryFloor }
function Get-MemoryShortText { "This PC has only $((Get-PcMemory).free) GB of memory free, under $MemoryFloor GB" }

# This process's private memory, in MB.
function Get-RoccoMemoryMB {
	$p = [Diagnostics.Process]::GetCurrentProcess()
	try { [int]($p.PrivateMemorySize64 / 1MB) } finally { $p.Dispose() }
}

function Get-MemoryLimit {
	$s = Read-RoccoSettings
	if ($s.PSObject.Properties['memoryLimitGB'] -and [double]$s.memoryLimitGB -gt 0) { [double]$s.memoryLimitGB } else { $MemoryLimitDefault }
}

# The caches Rocco keeps, biggest first: a name and how many entries.
function Get-CacheSizes {
	@(Get-Variable -Scope Script | Where-Object { $_.Name -ne 'Error' -and $_.Value -is [Collections.ICollection] -and $_.Value.Count -ge 20 } |
		Sort-Object { $_.Value.Count } -Descending | Select-Object -First 8 | ForEach-Object { "$($_.Name)=$($_.Value.Count)" }) -join ' '
}

# What Rocco holds: with $collect, after a full garbage collection, which is what it really keeps (a second or so).
# /api/debug/heap, and the line written before a restart for memory.
function Get-MemoryReport([bool]$collect) {
	$before = [GC]::GetTotalMemory($false)
	if ($collect) { [GC]::Collect(); [GC]::WaitForPendingFinalizers(); [GC]::Collect() }
	$pc = Get-PcMemory
	[pscustomobject]@{
		roccoMB = Get-RoccoMemoryMB
		heldMB = [int]([GC]::GetTotalMemory($false) / 1MB)
		heapBeforeMB = [int]($before / 1MB)
		limitGB = Get-MemoryLimit
		upMinutes = [int]((Get-Date) - $script:MemoryStarted).TotalMinutes
		freeGB = $pc.free
		totalGB = $pc.total
		errors = $global:Error.Count
		caches = Get-CacheSizes
		requests = Get-RequestCountText
	}
}

# ---- The log ----
$script:MemoryStarted = Get-Date
$script:MemoryNext = (Get-Date).AddSeconds($MemoryTick)
$script:MemoryTrimmed = [datetime]::MinValue
$script:RequestCounts = @{}

# Each request, counted by what it asked: ids are left out so like requests count together, and a hook by its event.
function Add-RequestCount($req) {
	$path = $req.Url.AbsolutePath -creplace $TaskIdPattern, 'T-n' -creplace 'C-[0-9a-f]{6}', 'C-x' # case matters: shot-1.png isn't a task
	if ($path -notmatch '^/(api|files)/') { $path = '(the app''s files)' }
	$key = "$($req.HttpMethod) $path"
	if ($path -eq '/api/conductor/hook') { $key += " $($req.QueryString['e'])" }
	$script:RequestCounts[$key] = 1 + [int]$script:RequestCounts[$key]
}
function Get-RequestCountText {
	@($script:RequestCounts.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', '
}

function Write-MemoryLine([string]$line) {
	try { [IO.File]::AppendAllText($MemoryLogFile, "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $line`r`n", $Utf8) } catch { }
}

# Only the last week is kept: once a day, older lines go.
function Limit-MemoryLog {
	if (((Get-Date) - $script:MemoryTrimmed).TotalHours -lt 24) { return }
	$script:MemoryTrimmed = Get-Date
	if (-not (Test-Path -LiteralPath $MemoryLogFile)) { return }
	$from = (Get-Date).AddDays(-$MemoryLogDays).ToString('yyyy-MM-dd HH:mm:ss')
	try {
		$keep = @([IO.File]::ReadAllLines($MemoryLogFile, $Utf8) | Where-Object { $_.Length -ge 19 -and $_.Substring(0, 19) -ge $from })
		[IO.File]::WriteAllLines($MemoryLogFile, [string[]]$keep, $Utf8)
	} catch { }
}

# Called while the server waits for a request, and after each one. Once a tick: a line in the log, and $true when
# Rocco has grown past its limit and should restart (Start-Rocco does, as it does after an update).
function Invoke-MemoryTick {
	if ((Get-Date) -lt $script:MemoryNext) { return $false }
	$script:MemoryNext = (Get-Date).AddSeconds($MemoryTick)
	Limit-MemoryLog
	$mb = Get-RoccoMemoryMB
	$pc = Get-PcMemory
	Write-MemoryLine "rocco=${mb}MB heap=$([int]([GC]::GetTotalMemory($false) / 1MB))MB pcFree=$($pc.free)GB | $(Get-RequestCountText) | $(Get-CacheSizes)"
	$script:RequestCounts = @{}
	$limit = Get-MemoryLimit
	if ($mb -lt $limit * 1024 -or ((Get-Date) - $script:MemoryStarted).TotalSeconds -lt $MemoryGrace) { return $false }
	$r = Get-MemoryReport $true
	Write-MemoryLine "RESTARTING: rocco=$($r.roccoMB)MB, past the ${limit} GB limit. Held after a full collection: $($r.heldMB)MB. Errors kept: $($r.errors). Caches: $($r.caches)"
	try { [IO.File]::WriteAllText($MemoryRestartFile, (ConvertTo-Json -Compress @{ at = (Now); mb = $r.roccoMB; limit = $limit }), $Utf8) } catch { }
	$true
}

# After a restart for memory: the main chat says so, once.
function Show-MemoryRestart {
	if (-not (Test-Path -LiteralPath $MemoryRestartFile)) { return }
	try { $r = [IO.File]::ReadAllText($MemoryRestartFile, $Utf8) | ConvertFrom-Json } catch { $r = $null }
	Remove-Item -LiteralPath $MemoryRestartFile -Force -ErrorAction SilentlyContinue
	if (-not $r) { return }
	$gb = [Math]::Round([double]$r.mb / 1024, 1)
	try { Add-Event "Rocco restarted itself to free memory: it had grown to $gb GB, past its $($r.limit) GB limit (Settings). Your agents carried on. Its memory log, in $RoccoHome\memory.log, shows what it was doing." } catch { }
}
