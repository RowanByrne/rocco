# Projects in the RoDev folder, their lanes and Main, the user, and starting a new project.

function Get-ProjectField([string]$name, [string]$repo = $script:RepoDir) {
	$project = Join-Path $repo 'docs\game\PROJECT.md'
	if ((Test-Path $project) -and ([IO.File]::ReadAllText($project, $Utf8) -match "(?m)^\|\s*$name\s*\|\s*([^|]+?)\s*\|")) { return $Matches[1] }
	''
}

# Every project in the RoDev folder: a folder whose repo\ has docs\game\PROJECT.md. The template is one too.
$script:ProjectCache = $null
function Get-Projects {
	if (-not $script:ProjectCache -or ((Get-Date) - $script:ProjectCache.Read).TotalSeconds -gt 10) {
		$list = @(Get-ChildItem $RoDev -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'repo\docs\game\PROJECT.md') } | ForEach-Object {
			$repo = Join-Path $_.FullName 'repo'
			$game = Get-ProjectField 'Game' $repo
			$isTemplate = $game -like '*{{*'
			$phase = Get-ProjectField 'Phase' $repo
			if ($phase -match '^([A-Za-z][A-Za-z ]*?)\s*[(.]') { $phase = $Matches[1] }
			[pscustomobject]@{
				id = $_.Name
				name = $(if ($isTemplate) { 'RoDev template' } else { $game })
				phase = $(if ($isTemplate) { 'Template' } else { $phase })
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
	[pscustomobject]@{ count = $count; open = $served; main = [bool]($base -and $listening.Contains($base)) }
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

# Everything the Workboard shows for one project.
function Get-State([string]$projectId) {
	$p = Find-Project $projectId
	$cutoff = (Get-Date).AddDays(-3)
	[pscustomobject]@{
		project = [pscustomobject]@{ id = $p.id; name = $p.name; phase = $p.phase; template = $p.template }
		lanes = Get-Lanes
		main = Get-Main
		tasks = @(Get-Tasks | Where-Object { $_.status -ne 'removed' -and ($_.status -ne 'done' -or -not $_.doneAt -or [datetime]$_.doneAt -gt $cutoff) })
	}
}

# ---- The user ----

$script:Me = $null
function Get-Me {
	if (-not $script:Me) {
		$name = "$(Invoke-Git $HomeProject config --global user.name)"
		$email = "$(Invoke-Git $HomeProject config --global user.email)"
		$login = ''; $avatar = ''
		if ($email -match '^(\d+)\+([^@]+)@users\.noreply\.github\.com$') { $avatar = "https://avatars.githubusercontent.com/u/$($Matches[1])?s=80"; $login = $Matches[2] }
		$claude = ''
		$config = Join-Path $env:USERPROFILE '.claude.json'
		if ((Test-Path $config) -and ([IO.File]::ReadAllText($config) -match '"oauthAccount"\s*:\s*\{[^}]*?"emailAddress"\s*:\s*"([^"]+)"')) { $claude = $Matches[1] }
		$script:Me = [pscustomobject]@{ name = $name; email = $email; login = $login; avatar = $avatar; claude = $claude; pc = $env:COMPUTERNAME }
	}
	$script:Me
}

# ---- New projects: the template's tools\new-project.ps1, run in the background ----

$script:Jobs = @{}
function Start-NewProject([string]$name, [string]$code, [string]$repo) {
	if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$') { throw 'Name: 2 to 40 letters, numbers, - or _, starting with a letter or number.' }
	if ($code -notmatch '^[A-Za-z0-9]{2,4}$') { throw 'Code: 2 to 4 letters or numbers.' }
	if ($repo -and $repo -notmatch '^(https://github\.com/[\w.-]+/[\w.-]+?(\.git)?|git@github\.com:[\w.-]+/[\w.-]+?(\.git)?)$') { throw 'GitHub repo: a github.com URL, like https://github.com/you/game.git' }
	if (Test-Path (Join-Path $RoDev $name)) { throw "$name already exists in $RoDev." }
	$newProject = Join-Path $RoDev 'template\repo\tools\new-project.ps1'
	if (-not (Test-Path $newProject)) { throw "There's no template in $RoDev to copy." }
	$jobId = [guid]::NewGuid().ToString('N').Substring(0, 8)
	$log = Join-Path ([IO.Path]::GetTempPath()) "rocco-new-$jobId.log"
	$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$newProject`"", '-Name', $name, '-Code', $code)
	if ($repo) { $arguments += '-GitHubRepo', $repo }
	$process = Start-Process powershell -ArgumentList $arguments -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
	$null = $process.Handle # without holding the handle, ExitCode reads as empty once it exits
	$script:Jobs[$jobId] = @{ Process = $process; Log = $log; Name = $name }
	$jobId
}

# The script still has its logs open while it runs, so read them shared.
function Read-Log([string]$path) {
	if (-not (Test-Path $path)) { return '' }
	$stream = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
	try { (New-Object IO.StreamReader($stream)).ReadToEnd() } finally { $stream.Close() }
}

function Get-JobStatus([string]$jobId) {
	$job = $script:Jobs[$jobId]
	if (-not $job) { throw "No job $jobId." }
	$running = -not $job.Process.HasExited
	$ok = -not $running -and $job.Process.ExitCode -eq 0
	if (-not $running) { $script:ProjectCache = $null }
	# Its errors (and git's harmless warnings) only matter when it failed.
	$output = Read-Log $job.Log
	if (-not $running -and -not $ok) { $output += "`n" + (Read-Log "$($job.Log).err") }
	[pscustomobject]@{ running = $running; ok = $ok; output = $output.Trim(); project = $job.Name }
}
