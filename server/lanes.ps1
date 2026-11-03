# Lanes on this PC (the template's docs/workflow/LANES.md): how many it can run, recording that in PROJECT.md
# "Workstations", and opening them: the Main place and each lane's place, the lane checkouts, Lync for each (with no
# window: its output goes to <Game>\rocco\lync\), and Studio. Lync stops from Connections, or when Rocco quits.

# ---- How many this PC can run ----

$script:PcSpecs = $null
function Get-PcSpecs {
	if (-not $script:PcSpecs) {
		$computer = Get-CimInstance Win32_ComputerSystem
		$cpus = @(Get-CimInstance Win32_Processor)
		$script:PcSpecs = [pscustomobject]@{
			pc = $env:COMPUTERNAME
			memory = [Math]::Round($computer.TotalPhysicalMemory / 1GB)
			threads = [int]($cpus | Measure-Object NumberOfLogicalProcessors -Sum).Sum
			cpu = ("$($cpus[0].Name)" -replace '\s+', ' ').Trim()
		}
	}
	$script:PcSpecs
}

# A starting guess, before a lane has been measured (LANES.md "How many lanes"): a Studio place with a playtest running
# takes about 3 GB. Fit that many in memory, less Main and 2 for other apps, and no more than one per two threads.
$LaneMemory = 3
$MostLanes = 12
function Get-LaneAdvice([bool]$forProject = $true) {
	$pc = Get-PcSpecs
	$byMemory = [Math]::Floor($pc.memory / $LaneMemory) - 3
	$byCpu = [Math]::Floor($pc.threads / 2)
	[pscustomobject]@{
		pc = $pc.pc; memory = $pc.memory; threads = $pc.threads; cpu = $pc.cpu; perLane = $LaneMemory
		suggested = [int][Math]::Max(1, [Math]::Min(8, [Math]::Min($byMemory, $byCpu)))
		most = [int][Math]::Max(1, [Math]::Min($MostLanes, $byMemory))
		mine = $(if ($forProject) { Get-WorkstationLanes } else { $null })
	}
}

# ---- Recording it ----

# PROJECT.md: this PC's row in "Workstations" (the placeholder row goes), and "Lanes" in At a glance: as many as the
# strongest PC opens, so never fewer than are there. Committed as the user, only that file, and pushed.
function Set-WorkstationLanes([int]$count) {
	if ($count -lt 0 -or $count -gt $MostLanes) { throw "Lanes: 0 to $MostLanes." }
	$relative = 'docs/game/PROJECT.md'
	$path = Join-Path $RepoDir $relative
	if (-not (Test-Path $path)) { throw 'This project has no docs/game/PROJECT.md yet.' }
	if ((Invoke-GitText $RepoDir status --porcelain '--' $relative).text) { throw 'PROJECT.md has changes that aren''t committed yet. Ask your agent to commit them first.' }
	$pc = Get-PcSpecs
	$row = "| ``$($pc.pc)`` | $($pc.memory) GB, $($pc.threads) threads ($($pc.cpu)) | $count |"
	$lines = [Collections.Generic.List[string]]([IO.File]::ReadAllText($path, $Utf8) -replace "`r`n", "`n" -split "`n")
	$start = $lines.FindIndex([Predicate[string]] { param($l) $l -match '^##\s+Workstations' })
	if ($start -lt 0) { throw 'PROJECT.md has no "Workstations" section.' }
	$last = -1
	for ($i = $start + 1; $i -lt $lines.Count -and $lines[$i] -notmatch '^##\s'; $i++) {
		if ($lines[$i] -notmatch '^\|') { continue }
		$first = ($lines[$i].Trim().Trim('|').Split('|')[0]).Trim().Trim('`')
		if ($first -ieq $pc.pc -or $first -eq 'None yet') { $lines.RemoveAt($i); $i--; continue }
		$last = $i
	}
	if ($last -lt 0) { throw 'PROJECT.md "Workstations" has no table.' }
	$lines.Insert($last + 1, $row)
	$most = $count
	foreach ($l in $lines) { if ($l -match '^\|\s*Lanes\s*\|\s*(\d+)') { $most = [Math]::Max($most, [int]$Matches[1]) } }
	$most = [Math]::Max($most, @(Get-ChildItem (Join-Path $Root 'lanes') -Directory -Filter 'lane*' -ErrorAction SilentlyContinue).Count)
	for ($i = 0; $i -lt $lines.Count; $i++) {
		if ($lines[$i] -match '^\|\s*Lanes\s*\|') { $lines[$i] = "| Lanes | $(if ($most -gt 1) { "$most (lane1 to lane$most)" } elseif ($most) { '1 (lane1)' } else { 'None yet' }) |" }
	}
	Save-RepoFile $relative ($lines -join "`n") "Lanes: $($pc.pc) opens $count"
}

# ---- Opening them (rocco.ps1 lanes, in the background) ----

# Workspace attributes in Roblox's binary attribute format: a count, then each key, its type and its value. Numbers are
# Float64 (type 6), strings type 2.
function ConvertTo-AttributeBlob([Collections.IDictionary]$attributes) {
	$stream = New-Object IO.MemoryStream
	$w = New-Object IO.BinaryWriter($stream)
	$w.Write([uint32]$attributes.Count)
	foreach ($key in $attributes.Keys) {
		$name = $Utf8.GetBytes($key)
		$w.Write([uint32]$name.Length); $w.Write($name)
		$value = $attributes[$key]
		if ($value -is [string]) { $bytes = $Utf8.GetBytes($value); $w.Write([byte]2); $w.Write([uint32]$bytes.Length); $w.Write($bytes) }
		else { $w.Write([byte]6); $w.Write([double]$value) }
	}
	$w.Flush()
	[Convert]::ToBase64String($stream.ToArray())
}

# A new place: Studio's plain baseplate and spawn, with workspace.__lync_port set so Lync's plugin finds its server.
# Written as Roblox XML, which Studio opens under the .rbxl name; its first save makes it a binary place like any other.
function New-PlaceFile([string]$path, [int]$port) {
	$frame = { param($y) "<X>0</X><Y>$y</Y><Z>0</Z><R00>1</R00><R01>0</R01><R02>0</R02><R10>0</R10><R11>1</R11><R12>0</R12><R20>0</R20><R21>0</R21><R22>1</R22>" }
	$xml = @"
<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
	<External>null</External>
	<External>nil</External>
	<Item class="Workspace" referent="RBX0">
		<Properties>
			<string name="Name">Workspace</string>
			<BinaryString name="AttributesSerialize">$(ConvertTo-AttributeBlob ([ordered]@{ __lync_port = $port }))</BinaryString>
		</Properties>
		<Item class="Part" referent="RBX1">
			<Properties>
				<string name="Name">Baseplate</string>
				<bool name="Anchored">true</bool>
				<bool name="Locked">true</bool>
				<CoordinateFrame name="CFrame">$(& $frame -8)</CoordinateFrame>
				<Vector3 name="size"><X>2048</X><Y>16</Y><Z>2048</Z></Vector3>
				<Color3uint8 name="Color3uint8">4284177243</Color3uint8>
			</Properties>
		</Item>
		<Item class="SpawnLocation" referent="RBX2">
			<Properties>
				<string name="Name">SpawnLocation</string>
				<bool name="Anchored">true</bool>
				<CoordinateFrame name="CFrame">$(& $frame 0.5)</CoordinateFrame>
				<Vector3 name="size"><X>12</X><Y>1</Y><Z>12</Z></Vector3>
			</Properties>
		</Item>
	</Item>
</roblox>
"@
	New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
	[IO.File]::WriteAllText($path, $xml, $Utf8)
}

# The place a checkout is served into: a .rbxl, or the .rbxlx a game was brought in with.
function Find-PlaceFile([string]$name) {
	foreach ($ext in '.rbxl', '.rbxlx') { $p = Join-Path $Root "places\$name$ext"; if (Test-Path $p) { return $p } }
	Join-Path $Root "places\$name.rbxl"
}

# A program started with no window, apart from this process, so it outlives a shell an agent runs commands in
# (Win32_Process.Create). Hidden from the start, so Windows Terminal doesn't pick it up as a tab. Returns its id.
function Start-Hidden([string]$commandLine, [string]$dir) {
	$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
	$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine; CurrentDirectory = $dir; ProcessStartupInformation = $startup }
	if ($r.ReturnValue -ne 0) { throw "Couldn't start $commandLine (error $($r.ReturnValue))." }
	[int]$r.ProcessId
}

function Find-Lync {
	$lync = Join-Path $ToolsDir 'lync\lync.exe'
	if (Test-Path $lync) { return $lync }
	"$((Get-Command lync -ErrorAction SilentlyContinue | Select-Object -First 1).Source)"
}

# Lync for one checkout, with no window: what it says goes to <Game>\rocco\lync\<name>.log. A lane serves
# lane.project.json on its own port (.lane-port), as the template's serve.bat does.
function Start-Lync([string]$dir, [string]$name) {
	$lync = Find-Lync
	if (-not $lync) { throw 'Lync isn''t in the RoDev folder''s _tools\lync (WORKSTATION.md).' }
	$project = 'default.project.json'
	$portFile = Join-Path $dir '.lane-port'
	if (Test-Path $portFile) {
		$json = Get-Content (Join-Path $dir 'default.project.json') -Raw | ConvertFrom-Json
		$json.port = [int](Get-Content $portFile -Raw).Trim()
		[IO.File]::WriteAllText((Join-Path $dir 'lane.project.json'), ($json | ConvertTo-Json -Depth 64))
		$project = 'lane.project.json'
	}
	$logs = Join-Path $Root 'rocco\lync'
	New-Item -ItemType Directory -Force $logs | Out-Null
	Start-Hidden "cmd.exe /d /c `"`"$lync`" serve $project > `"$(Join-Path $logs "$name.log")`" 2>&1`"" $dir | Out-Null
}

# Lync for Main and each of this PC's lanes that has a checkout, where it isn't serving yet. Says what it starts.
function Start-ProjectLync {
	$base = [int](Get-Content (Join-Path $RepoDir 'default.project.json') -Raw | ConvertFrom-Json).port
	$count = [int](Get-WorkstationLanes)
	$listening = Get-ListeningPorts
	$checkouts = @([pscustomobject]@{ name = 'Main'; log = 'main'; dir = $RepoDir; port = $base })
	if ($count -gt 0) { foreach ($n in 1..$count) { $checkouts += [pscustomobject]@{ name = "Lane $n"; log = "lane$n"; dir = (Join-Path $Root "lanes\lane$n"); port = $base + $n } } }
	foreach ($c in $checkouts | Where-Object { (Test-Path $_.dir) -and -not $listening.Contains($_.port) }) {
		Write-Output "$($c.name): starting Lync on port $($c.port)"
		Start-Lync $c.dir $c.log
	}
}

# Every Lync this RoDev folder's copy runs, or just this project's (listening on its port base and the 19 above it).
function Get-LyncProcesses([switch]$Project) {
	$lync = Find-Lync
	$all = @(Get-Process lync -ErrorAction SilentlyContinue | Where-Object { -not $lync -or $_.Path -eq $lync })
	if (-not $Project) { return $all }
	$base = [int](Get-Content (Join-Path $RepoDir 'default.project.json') -Raw | ConvertFrom-Json).port
	$ids = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge $base -and $_.LocalPort -lt $base + 20 } | ForEach-Object { [int]$_.OwningProcess })
	@($all | Where-Object { $ids -contains $_.Id })
}

function Stop-Lync([switch]$Project) {
	$stopped = @(Get-LyncProcesses -Project:$Project)
	$stopped | Stop-Process -Force -ErrorAction SilentlyContinue
	$script:ListenCache = $null
	$stopped.Count
}

function Test-PlaceOpen([string]$path) {
	$file = Split-Path $path -Leaf
	[bool](Get-Process RobloxStudioBeta -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$file*" })
}

# Main and lane1 to laneK (this PC's row), each made if it's missing, served by Lync, and open in Studio. What's there
# already is left as it is. Says each step as it goes: Rocco shows it while the job runs.
function Open-Lanes {
	$count = Get-WorkstationLanes
	if ($null -eq $count) { throw "$env:COMPUTERNAME has no row in PROJECT.md ""Workstations"" yet: give rocco.ps1 lanes -Count." }
	$code = (Get-ProjectField 'Code').Trim('`', ' ')
	if (-not $code -or $code -match '\{\{') { throw 'PROJECT.md has no game code yet.' }
	$base = [int](Get-Content (Join-Path $RepoDir 'default.project.json') -Raw | ConvertFrom-Json).port
	if (-not $base) { throw 'default.project.json has no Lync port.' }
	$checkouts = @([pscustomobject]@{ name = 'Main'; dir = $RepoDir; place = (Find-PlaceFile "$code-Main"); port = $base })
	if ($count -gt 0) {
		foreach ($n in 1..$count) {
			$checkouts += [pscustomobject]@{ name = "Lane $n"; dir = (Join-Path $Root "lanes\lane$n"); place = (Find-PlaceFile "$code-Lane$n"); port = $base + $n; number = $n }
		}
	}

	foreach ($c in $checkouts) {
		if ($c.number -and -not (Test-Path $c.dir)) {
			Write-Output "$($c.name): making its checkout"
			$add = Join-Path $RepoDir 'tools\add-lane.ps1'
			# Git reports progress on stderr, which Windows PowerShell would otherwise turn into a stopping error.
			$out = & { $ErrorActionPreference = 'Continue'; & powershell -NoProfile -ExecutionPolicy Bypass -File $add $c.number 2>&1 | ForEach-Object { "$_" } }
			if (-not (Test-Path $c.dir)) { throw "tools\add-lane.ps1 $($c.number) didn't make the lane: $($out -join ' ')" }
		}
		# Without its port, a lane's Lync would serve on Main's.
		if ($c.number -and -not (Test-Path (Join-Path $c.dir '.lane-port'))) { [IO.File]::WriteAllText((Join-Path $c.dir '.lane-port'), "$($c.port)") }
		if (-not (Test-Path $c.place)) {
			Write-Output "$($c.name): making $(Split-Path $c.place -Leaf)"
			New-PlaceFile $c.place $c.port
		}
	}

	# Lync before Studio: its first serve installs the Studio plugin, which Studio loads as it opens.
	Start-ProjectLync
	$plugin = Join-Path $env:LOCALAPPDATA 'Roblox\Plugins\Lync.rbxm'
	for ($i = 0; $i -lt 30 -and -not (Test-Path $plugin); $i++) { Start-Sleep -Milliseconds 500 }

	$studio = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Roblox\Versions') -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'RobloxStudioBeta.exe') }
	if (-not $studio) { Write-Output 'Roblox Studio isn''t installed on this PC, so the places aren''t opened.'; return }
	foreach ($c in $checkouts) {
		if (Test-PlaceOpen $c.place) { continue }
		Write-Output "$($c.name): opening $(Split-Path $c.place -Leaf) in Studio"
		# A Studio that closed without warning leaves its lock behind, and the place would open read-only.
		Remove-Item -LiteralPath "$($c.place).lock" -Force -ErrorAction SilentlyContinue
		Start-Hidden "cmd.exe /d /c start `"`" `"$($c.place)`"" $Root | Out-Null
		Start-Sleep -Seconds 2
	}
	Write-Output "Open: Main$(if ($count) { " and $count lane$(if ($count -ne 1) { 's' })" }). Studio takes a moment to load each one."
}

# The app's lanes step (onboarding, or the sidebar): record this PC's count if it's given, then open them in the
# background. One job per project at a time. Returns { job, saved }.
function Start-OpenLanes($count) {
	$saved = if ($null -ne $count) { Set-WorkstationLanes ([int]$count) } else { $null }
	$job = @(Get-LaneJobs)[0]
	if (-not $job) { $job = Start-ScriptJob 'lanes' (Join-Path $AppDir 'rocco.ps1') @('lanes', '-Project', "`"$(Split-Path $Root -Leaf)`"") (Split-Path $Root -Leaf) }
	[pscustomobject]@{ job = $job; saved = $saved }
}

function Get-LaneJobs {
	$id = Split-Path $Root -Leaf
	@($script:Jobs.Keys | Where-Object { $j = $script:Jobs[$_]; $j.Kind -eq 'lanes' -and $j.Name -eq $id -and -not $j.Process.HasExited })
}
