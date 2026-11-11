# Projects in the RoDev folder, their lanes and Main, the user, and starting a new project.

function Get-ProjectField([string]$name, [string]$repo = $script:RepoDir) {
	$project = Join-Path $repo 'docs\game\PROJECT.md'
	if ((Test-Path $project) -and ([IO.File]::ReadAllText($project, $Utf8) -match "(?m)^\|\s*$name\s*\|\s*([^|]+?)\s*\|")) { return $Matches[1] }
	''
}

# Every project in the RoDev folder (Test-ProjectDir). The template is one too. A game brought in from its own repo
# has no PROJECT.md until the template is merged into it: it's listed by its folder's name until then.
$script:ProjectCache = $null
function Get-Projects {
	if (-not $script:ProjectCache -or ((Get-Date) - $script:ProjectCache.Read).TotalSeconds -gt 10) {
		$list = @(Get-ChildItem $RoDev -Directory | Where-Object { Test-ProjectDir $_.FullName } | ForEach-Object {
			$repo = Join-Path $_.FullName 'repo'
			$game = Get-ProjectField 'Game' $repo
			$isTemplate = $game -like '*{{*'
			$phase = Get-ProjectField 'Phase' $repo
			if ($phase -match '^([A-Za-z][A-Za-z ]*?)\s*[(.]') { $phase = $Matches[1] }
			[pscustomobject]@{
				id = $_.Name
				name = $(if ($isTemplate) { 'RoDev template' } elseif ($game) { $game } else { $_.Name })
				phase = $(if ($isTemplate) { 'Template' } elseif ($phase) { $phase } else { 'Being brought in' })
				template = $isTemplate
				path = $_.FullName
			}
		})
		$script:ProjectCache = @{ Read = Get-Date; List = $list }
	}
	$script:ProjectCache.List
}

function Find-Project([string]$id) {
	if (-not $id) { $id = Split-Path $HomeProject -Leaf }
	$p = Get-Projects | Where-Object { $_.id -eq $id } | Select-Object -First 1
	if (-not $p) { throw "No project '$id' in $RoDev." }
	$p
}

# ---- Lanes and Main ----

$script:ListenCache = $null
function Get-ListeningPorts {
	if (-not $script:ListenCache -or ((Get-Date) - $script:ListenCache.Read).TotalSeconds -gt 3) {
		$ports = New-Object 'System.Collections.Generic.HashSet[int]'
		foreach ($l in [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()) { [void]$ports.Add($l.Port) }
		$script:ListenCache = @{ Read = Get-Date; Ports = $ports }
	}
	$script:ListenCache.Ports
}

# This PC's row in PROJECT.md "Workstations" (as tools\serve-all.ps1 reads it); $null if it has none.
function Get-WorkstationLanes {
	$project = Join-Path $RepoDir 'docs\game\PROJECT.md'
	$inTable = $false
	if (-not (Test-Path $project)) { return $null }
	foreach ($line in Get-Content $project) {
		if ($line -match '^##\s+Workstations') { $inTable = $true; continue }
		if ($inTable -and $line -match '^##\s') { break }
		if ($inTable -and $line -match '^\|') {
			$cells = @($line.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim().Trim('`') })
			if ($cells.Count -ge 3 -and $cells[0] -ieq $env:COMPUTERNAME -and $cells[2] -match '\d+') { return [int]$Matches[0] }
		}
	}
	$null
}

# How many lanes to show, and which are open (their Lync is serving): this PC's count, stretched to any higher lane that's open.
function Get-Lanes {
	$json = Join-Path $RepoDir 'default.project.json'
	$base = if (Test-Path $json) { [int](Get-Content $json -Raw | ConvertFrom-Json).port } else { 0 }
	$listening = Get-ListeningPorts
	$served = @(if ($base) { 1..19 | Where-Object { $listening.Contains($base + $_) } })
	$highest = [int]($served | Measure-Object -Maximum).Maximum
	$mine = Get-WorkstationLanes
	$folders = @(Get-ChildItem (Join-Path $Root 'lanes') -Directory -Filter 'lane*' -ErrorAction SilentlyContinue).Count
	$count = if ($null -ne $mine) { [Math]::Max($mine, $highest) } elseif ($highest) { $highest } else { $folders }
	# mine: this PC's row, $null when it has none yet (lanes.ps1 asks how many).
	[pscustomobject]@{ count = $count; open = $served; main = [bool]($base -and $listening.Contains($base)); mine = $mine; jobs = @(Get-LaneJobs) }
}

$script:MainCache = @{}
function Get-Main {
	$hit = $script:MainCache[$RepoDir]
	if (-not $hit -or ((Get-Date) - $hit.Read).TotalSeconds -gt 15) {
		$line = Invoke-Git $RepoDir log -1 '--format=%cI%x09%s' main
		$at, $subject = if ($line) { "$line" -split "`t", 2 } else { $null, '' }
		$hit = @{ Read = Get-Date; Value = [pscustomobject]@{ at = $at; subject = $subject } }
		$script:MainCache[$RepoDir] = $hit
	}
	$hit.Value
}

# The other projects that want the user: a card stuck on a question, one ready to test, or their conductor asking
# something. The app shows them beside the project's name, and says so once, so work in one game isn't left waiting
# while the user is in another. Looked at every few seconds at most.
$script:OthersCache = $null
function Get-OtherProjects([string]$current) {
	if ($script:OthersCache -and $script:OthersCache.For -eq $current -and ((Get-Date) - $script:OthersCache.Read).TotalSeconds -lt 8) { return $script:OthersCache.Value }
	$here = $Root
	$rows = @()
	try {
		foreach ($p in @(Get-Projects | Where-Object { $_.id -ne $current -and -not $_.template })) {
			Use-Project $p.path
			$tasks = @(Get-Tasks)
			$stuck = @($tasks | Where-Object { $_.status -eq 'stuck' }).Count
			$ready = @($tasks | Where-Object { $_.status -eq 'ready' }).Count
			$asks = 0
			try { $asks = @((Get-ThreadState).open).Count } catch { }
			if ($stuck -or $ready -or $asks) { $rows += [pscustomobject]@{ id = $p.id; name = $p.name; stuck = $stuck; ready = $ready; asks = $asks } }
		}
	} finally { Use-Project $here }
	$script:OthersCache = @{ For = $current; Read = Get-Date; Value = $rows }
	$rows
}

# Everything the Workboard shows for one project.
function Get-State([string]$projectId) {
	$p = Find-Project $projectId
	$cutoff = (Get-Date).AddDays(-$BoardKeepsDays)
	[pscustomobject]@{
		rocco = $RoccoVersion # the app reloads when this changes: Rocco updated itself
		project = [pscustomobject]@{ id = $p.id; name = $p.name; phase = $p.phase; template = $p.template }
		lanes = Get-Lanes
		conductor = Get-Conductor
		main = Get-Main
		# Approved more than a few days ago: in the archive (tasks.ps1 Get-Archive), not on the board.
		tasks = @(Get-Tasks | Where-Object { $_.status -ne 'removed' -and ($_.status -ne 'done' -or -not $_.doneAt -or [datetime]$_.doneAt -gt $cutoff) })
		others = @(Get-OtherProjects $p.id)
	}
}

# ---- The user ----

$script:Me = $null
function Get-Me {
	if (-not $script:Me) {
		$name = "$(Invoke-Git $AppDir config --global user.name)"
		$email = "$(Invoke-Git $AppDir config --global user.email)"
		$login = ''; $avatar = ''
		if ($email -match '^(\d+)\+([^@]+)@users\.noreply\.github\.com$') { $avatar = "https://avatars.githubusercontent.com/u/$($Matches[1])?s=80"; $login = $Matches[2] }
		$claude = ''
		$config = Join-Path $env:USERPROFILE '.claude.json'
		if ((Test-Path $config) -and ([IO.File]::ReadAllText($config) -match '"oauthAccount"\s*:\s*\{[^}]*?"emailAddress"\s*:\s*"([^"]+)"')) { $claude = $Matches[1] }
		$script:Me = [pscustomobject]@{ name = $name; email = $email; login = $login; avatar = $avatar; claude = $claude; pc = $env:COMPUTERNAME; rocco = $RoccoVersion }
	}
	$script:Me
}

# ---- New projects: the template's tools\new-project.ps1, run in the background ----

$GitHubUrl = '^(https://github\.com/[\w.-]+/[\w.-]+?(\.git)?|git@github\.com:[\w.-]+/[\w.-]+?(\.git)?)$'
$script:Jobs = @{}
# A game brought in (onboarding, "A game I've already made") says where it is: kind github, folder, place or studio.
function Start-NewProject([string]$name, [string]$code, [string]$repo, [string]$kind = '', [string]$from = '') {
	if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$') { throw 'Name: 2 to 40 letters, numbers, - or _, starting with a letter or number.' }
	if ($code -notmatch '^[A-Za-z0-9]{2,4}$') { throw 'Code: 2 to 4 letters or numbers.' }
	if ($repo -and $repo -notmatch $GitHubUrl) { throw 'GitHub repo: a github.com URL, like https://github.com/you/game.git' }
	if (Test-Path (Join-Path $RoDev $name)) { throw "$name already exists in $RoDev." }
	$from = $from.Trim().Trim('"')
	switch ($kind) {
		'' { }
		'github' { if ($from -notmatch $GitHubUrl) { throw 'The game''s repo: a github.com URL, like https://github.com/you/game.git' } }
		'folder' { if (-not (Test-Path -LiteralPath $from -PathType Container)) { throw "There's no folder $from on this PC." } }
		'place' { if (-not ((Test-Path -LiteralPath $from -PathType Leaf) -and $from -match '\.rbxlx?$')) { throw "There's no place file (.rbxl) at $from." } }
		'studio' { }
		default { throw "Not a kind of game to bring in: '$kind'." }
	}
	$newProject = Join-Path $RoDev 'template\repo\tools\new-project.ps1'
	if (-not (Test-Path $newProject)) { throw "There's no template in $RoDev to copy." }
	# A path ending in \ would swallow the quote PowerShell closes it with.
	$from = $from.TrimEnd('\')
	$arguments = @('-Name', $name, '-Code', $code)
	if ($repo) { $arguments += '-GitHubRepo', $repo }
	if ($kind -eq 'studio') { $arguments += '-StudioOnly' } elseif ($kind) { $arguments += '-Existing', $from }
	Start-ScriptJob 'new' $newProject $arguments $name
}

# ---- Background jobs: a script run hidden, its output kept for the app to show ----
# The job is a small fixed script that runs the real one and writes down how it ended. What to run reaches it as data
# (ROCCO_JOB), never as script text, so a folder's name or a path can't be read as PowerShell. Each job is on record in
# jobs.json with its process, so a Rocco that restarted (an update) still knows a job that's running, and how one ended.
# A job is stopped if it runs far past what its kind should take, or when the user cancels it.

$JobMinutes = @{ new = 30; lanes = 20 }
$JobRunner = @'
$job = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ROCCO_JOB)) | ConvertFrom-Json
Remove-Item Env:ROCCO_JOB -ErrorAction SilentlyContinue
$arguments = @($job.arguments)
& powershell.exe -NoProfile -ExecutionPolicy $job.policy -File $job.script @arguments
$code = $LASTEXITCODE
[IO.File]::WriteAllText($job.exit, "$code")
exit $code
'@
function Get-JobsFile { Join-Path $RoccoHome 'jobs.json' }
function Read-JobRecords {
	$file = Get-JobsFile
	$records = @{}
	if (Test-Path -LiteralPath $file) {
		try { foreach ($p in ([IO.File]::ReadAllText($file, $Utf8) | ConvertFrom-Json).PSObject.Properties) { $records[$p.Name] = $p.Value } } catch { }
	}
	$records
}
function Save-JobRecords($records) {
	# Two days is long enough to ask how a job went.
	$keep = @{}
	foreach ($k in $records.Keys) { if ([datetime]$records[$k].at -gt (Get-Date).AddDays(-2)) { $keep[$k] = $records[$k] } }
	New-Item -ItemType Directory -Force $RoccoHome | Out-Null
	[IO.File]::WriteAllText((Get-JobsFile), (ConvertTo-Json -InputObject $keep -Depth 4), $Utf8)
}

# $own: one of Rocco's own scripts. A project's script (the template's tools) runs as RemoteSigned: one that came
# from a download Windows marked as from the internet is refused, where Bypass would run anything.
function Start-ScriptJob([string]$kind, [string]$script, [string[]]$arguments, [string]$name, [bool]$own = $false) {
	$jobId = [guid]::NewGuid().ToString('N').Substring(0, 8)
	$log = Join-Path ([IO.Path]::GetTempPath()) "rocco-$kind-$jobId.log"
	$data = ConvertTo-Json -Compress -InputObject ([ordered]@{ script = $script; arguments = @($arguments); policy = $(if ($own) { 'Bypass' } else { 'RemoteSigned' }); exit = "$log.exit" })
	$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($JobRunner))
	$env:ROCCO_JOB = [Convert]::ToBase64String($Utf8.GetBytes($data))
	try {
		$process = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
	} finally { Remove-Item Env:ROCCO_JOB -ErrorAction SilentlyContinue }
	$null = $process.Handle # without holding the handle, ExitCode reads as empty once it exits
	$script:Jobs[$jobId] = @{ Process = $process; Log = $log; Name = $name; Kind = $kind; Started = Get-Date }
	$records = Read-JobRecords
	$records[$jobId] = [pscustomobject]@{ pid = $process.Id; started = (Get-ProcessStart $process.Id); log = $log; name = $name; kind = $kind; at = (Now) }
	try { Save-JobRecords $records } catch { }
	$jobId
}

# The script still has its logs open while it runs, so read them shared.
function Read-Log([string]$path) {
	if (-not (Test-Path $path)) { return '' }
	$stream = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
	try { (New-Object IO.StreamReader($stream)).ReadToEnd() } finally { $stream.Close() }
}

# A job as Rocco knows it now: one it started this run, or one on record from before a restart.
function Find-Job([string]$jobId) {
	$job = $script:Jobs[$jobId]
	if ($job) { return [pscustomobject]@{ id = $jobId; log = $job.Log; name = $job.Name; kind = $job.Kind; pid = $job.Process.Id; running = -not $job.Process.HasExited; started = $job.Started; note = "$($job.Note)" } }
	$r = (Read-JobRecords)[$jobId]
	if (-not $r) { throw "No job $jobId." }
	[pscustomobject]@{ id = $jobId; log = "$($r.log)"; name = "$($r.name)"; kind = "$($r.kind)"; pid = [int]$r.pid; running = (Test-ProcessAlive ([int]$r.pid) "$($r.started)"); started = [datetime]$r.at; note = '' }
}

function Get-JobStatus([string]$jobId) {
	$job = Find-Job $jobId
	# How it ended is what the job itself wrote down; without that (it was stopped), it didn't end well.
	$code = if (-not $job.running -and (Test-Path -LiteralPath "$($job.log).exit")) { "$(Read-Log "$($job.log).exit")".Trim() } else { '' }
	$ok = -not $job.running -and $code -eq '0'
	if (-not $job.running) { $script:ProjectCache = $null }
	# Its errors (and git's harmless warnings) only matter when it failed.
	$output = Read-Log $job.log
	if (-not $job.running -and -not $ok) { $output += "`n" + (Read-Log "$($job.log).err") }
	if ($job.note) { $output += "`n$($job.note)" }
	[pscustomobject]@{ running = $job.running; ok = $ok; output = $output.Trim(); project = $job.name; kind = $job.kind }
}

# Stops a job and everything it started. $why is shown with its output.
function Stop-ScriptJob([string]$jobId, [string]$why = 'Stopped: you cancelled it.') {
	$job = Find-Job $jobId
	if ($job.running) {
		try { & taskkill.exe /T /F /PID $job.pid 2>$null | Out-Null } catch { }
		if ($script:Jobs[$jobId]) { $script:Jobs[$jobId].Note = $why }
	}
	[pscustomobject]@{ stopped = [bool]$job.running }
}

# Once a minute: a script job far past its time is stopped, and so is a background check (PowerShell's own jobs: the
# tools check, GitHub lookups, Roblox's numbers) that never came back, so neither sits there forever.
$script:JobsSwept = Get-Date
function Stop-OldJobs {
	if (((Get-Date) - $script:JobsSwept).TotalSeconds -lt 60) { return }
	$script:JobsSwept = Get-Date
	foreach ($id in @($script:Jobs.Keys)) {
		$job = $script:Jobs[$id]
		$most = [int]$JobMinutes[$job.Kind]
		if ($most -and -not $job.Process.HasExited -and ((Get-Date) - $job.Started).TotalMinutes -gt $most) { Stop-ScriptJob $id "Stopped: it ran for over $most minutes, which is far longer than it should take." | Out-Null }
	}
	foreach ($job in @(Get-Job -State Running -ErrorAction SilentlyContinue)) {
		# Making thumbnail concepts is slow by nature (thumbnails.ps1 stops a single image that hangs).
		$most = if ($job.Name -eq 'rocco-concepts') { 60 } else { 10 }
		if ($job.PSBeginTime -and ((Get-Date) - $job.PSBeginTime).TotalMinutes -gt $most) { Stop-Job $job -ErrorAction SilentlyContinue }
	}
}
