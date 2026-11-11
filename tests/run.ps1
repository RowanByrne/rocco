# Rocco's server tests: the agent's commands and the app's API, run against a small game made for the run in a
# temporary RoDev folder. Nothing here touches a real project, the user's settings, or their agent: Rocco's own files
# are reached through a link, its settings and log go to the temporary folder (ROCCO_HOME), and no conductor is ever
# opened (ROCCO_NO_CONDUCTOR). Needs Windows PowerShell 5.1 and git, nothing else.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\run.ps1 [-Only <part of a test's name>] [-Keep]
#
# Exits 0 when every test passes. -Keep leaves the temporary folder, to look at what a failed test left.
param([string]$Only = '', [switch]$Keep)
$ErrorActionPreference = 'Stop'
$Here = Split-Path $PSScriptRoot -Parent
$Temp = Join-Path ([IO.Path]::GetTempPath()) ("rocco-tests-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$RoDevDir = Join-Path $Temp 'RoDev'
$App = Join-Path $RoDevDir '_tools\rocco'
$Game = Join-Path $RoDevDir 'Game'
$Repo = Join-Path $Game 'repo'
$Tasks = Join-Path $Game 'rocco\tasks'
$Utf8 = New-Object Text.UTF8Encoding $false
$script:Passed = 0
$script:Failed = @()

function Test([string]$name, [scriptblock]$body) {
	if ($Only -and $name -notmatch [regex]::Escape($Only)) { return }
	try { & $body; $script:Passed++; Write-Host "  ok    $name" }
	catch { $script:Failed += $name; Write-Host "  FAIL  $name`n          $($_.Exception.Message)" }
}
function Assert([bool]$condition, [string]$what) { if (-not $condition) { throw $what } }
function Assert-Equal($actual, $expected, [string]$what) { if ("$actual" -cne "$expected") { throw "$what`: expected '$expected', got '$actual'" } }
function Assert-Match([string]$actual, [string]$pattern, [string]$what) { if ($actual -notmatch $pattern) { throw "$what`: '$actual' doesn't match $pattern" } }
function Assert-Throws([scriptblock]$body, [string]$pattern, [string]$what) {
	try { & $body | Out-Null } catch { if ("$($_.Exception.Message)" -match $pattern) { return }; throw "$what`: failed with '$($_.Exception.Message)', expected $pattern" }
	throw "$what`: didn't fail"
}

# Git in the test game's repo. Not named Git: PowerShell would then run this for every git, itself included.
function RepoGit { $ErrorActionPreference = 'Continue'; git.exe -C $Repo @args 2>$null }

# A Rocco command as an agent in a bash shell runs it: through powershell -File. Returns what it printed.
function Rocco {
	$ErrorActionPreference = 'Continue'
	$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $App 'rocco.ps1') @args -Project Game 2>&1 | ForEach-Object { "$_" }
	if ($LASTEXITCODE) { throw "rocco $($args -join ' ') failed: $($out -join ' ')" }
	@($out)
}
function Read-TaskJson([string]$id) {
	foreach ($base in $Tasks, (Join-Path $Game 'rocco\archive')) { $f = Join-Path $base "$id\task.json"; if (Test-Path $f) { return [IO.File]::ReadAllText($f, $Utf8) | ConvertFrom-Json } }
	throw "no $id"
}
function Write-TaskJson($t) { [IO.File]::WriteAllText((Join-Path $Tasks "$($t.id)\task.json"), ($t | ConvertTo-Json -Depth 10), $Utf8) }

# The app's side: requests to the test server.
$script:Base = ''
function Api([string]$path, $body = $null, [string]$type = 'application/json') {
	$url = "$script:Base$path$(if ($path -match '\?') { '&' } else { '?' })p=Game"
	$request = [Net.HttpWebRequest]::Create($url)
	$request.Timeout = 30000
	if ($null -ne $body) {
		$request.Method = 'POST'; $request.ContentType = $type; $request.Headers.Add('X-Rocco', '1')
		[byte[]]$bytes = if ($body -is [byte[]]) { , $body } else { , $Utf8.GetBytes((ConvertTo-Json -InputObject $body -Compress -Depth 6)) }
		if ($null -eq $bytes) { $bytes = New-Object byte[] 0 }
		$request.ContentLength = $bytes.Length
		$stream = $request.GetRequestStream(); if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }; $stream.Close()
	}
	try { $response = $request.GetResponse() } catch [Net.WebException] {
		if (-not $_.Exception.Response) { throw }
		$text = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream(), $Utf8)).ReadToEnd()
		throw "HTTP $([int]$_.Exception.Response.StatusCode): $text"
	}
	$text = (New-Object IO.StreamReader($response.GetResponseStream(), $Utf8)).ReadToEnd()
	$response.Close()
	if ("$($response.ContentType)" -match 'json' -and $text) { $text | ConvertFrom-Json } else { $text }
}
function Start-Server {
	$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0); $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
	$script:Base = "http://localhost:$port"
	$script:Server = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $App 'rocco.ps1')`"", 'serve', '-Port', $port, '-Project', 'Game' -WindowStyle Hidden -PassThru
	for ($i = 0; $i -lt 60; $i++) { try { Api '/api/projects' | Out-Null; return } catch { Start-Sleep -Milliseconds 300 } }
	throw 'The test server did not start.'
}
function Stop-Server { if ($script:Server -and -not $script:Server.HasExited) { & taskkill.exe /T /F /PID $script:Server.Id 2>$null | Out-Null; Start-Sleep -Milliseconds 300 } }

try {
	# ---- The temporary game ----
	# Three lanes on this PC (folders only: no checkouts, places or Lync are needed to hand a lane out).
	New-Item -ItemType Directory -Force (Join-Path $RoDevDir '_tools'), (Join-Path $Game 'lanes\lane1'), (Join-Path $Game 'lanes\lane2'), (Join-Path $Game 'lanes\lane3'), (Join-Path $Repo 'docs\game'), (Join-Path $Repo 'docs\workflow'), (Join-Path $Temp 'home') | Out-Null
	cmd /c mklink /J "$App" "$Here" | Out-Null
	[IO.File]::WriteAllText((Join-Path $Repo 'docs\game\PROJECT.md'), "# Project`n`n| | |`n|---|---|`n| Game | Test Game |`n| Code | ``TG`` |`n| Phase | Production |`n| Lanes | 3 (lane1 to lane3) |`n`n## Workstations`n`n| PC | Specs | Lanes |`n|---|---|---|`n| ``$env:COMPUTERNAME`` | the tests | 3 |`n", $Utf8)
	[IO.File]::WriteAllText((Join-Path $Repo 'docs\workflow\CONDUCTOR.md'), "# Conductor`n`nThe template's.`n", $Utf8)
	[IO.File]::WriteAllText((Join-Path $Repo 'docs\game\GDD.md'), "# Design`n`nA racing game.`n", $Utf8)
	[IO.File]::WriteAllText((Join-Path $Repo 'default.project.json'), '{ "name": "Game", "port": 34900, "tree": {} }', $Utf8)
	git init --quiet -b main $Repo
	# The commits Rocco makes for the user need a name and an email: set for this repo only.
	git -C $Repo config user.name Tester; git -C $Repo config user.email tester@example.com
	RepoGit add -A; RepoGit commit --quiet -m 'A game for the tests'
	$env:ROCCO_HOME = Join-Path $Temp 'home'
	$env:ROCCO_NO_CONDUCTOR = '1'
	Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue

	# Rocco's own functions, for the tests that call one directly.
	$AppDir = $App; $Command = 'test'; $Project = 'Game'; $Port = 34860
	foreach ($part in 'core', 'agents', 'tasks', 'thread', 'sessions', 'projects', 'conductor', 'leads', 'lanes', 'connections', 'history', 'docs', 'actions', 'accounts', 'onboarding', 'roblox', 'updates', 'thumbnails', 'http') { . (Join-Path $App "server\$part.ps1") }
	$ErrorActionPreference = 'Stop'

	Write-Host "Rocco tests in $Temp"
	Write-Host 'Commands'

	Test 'new, set, log and show keep a task' {
		$id = @(Rocco new -Title 'First task' -Note 'Do the first thing')[-1]
		Assert-Equal $id 'T-001' 'the first id'
		Rocco set $id -Status working -Lane 1 -Step Coding -Branch agent/first | Out-Null
		Rocco log $id -Text 'Started on it' | Out-Null
		$shown = (Rocco show $id) -join "`n"
		Assert-Match $shown 'T-001\s+working\s+lane 1\s+agent/first' 'show says where it is'
		Assert-Match $shown 'Started on it' 'show has the log'
	}

	Test 'a list through -File is split at its commas' {
		$out = Rocco set T-001 -Test 'Drive a lap,Drift the hairpin' -Summary 'Faster car'
		Assert-Equal (Read-TaskJson 'T-001').test "Drive a lap`nDrift the hairpin" 'two steps'
		Assert-Match ($out -join ' ') 'read as 2 items' 'it says it split them'
	}

	Test 'a branch name that git would read as an option is refused' {
		Assert-Throws { Rocco set T-001 -Branch 'agent//x' } "isn't a branch name" 'set -Branch'
		Assert-Throws { Rocco set T-001 -Branch 'has space' } "isn't a branch name" 'set -Branch with a space'
		Assert-Equal (Read-TaskJson 'T-001').branch 'agent/first' 'the branch is unchanged'
	}

	Test 'result puts a check and its output on the card' {
		$file = Join-Path $Temp 'console.txt'
		[IO.File]::WriteAllText($file, "line 1`nAll tests passed`n", $Utf8)
		Rocco result T-001 -Pass -Text '3 of 3 tests pass' -File $file | Out-Null
		$t = Read-TaskJson 'T-001'
		Assert-Equal @($t.checks).Count 1 'one check'
		Assert ([bool]$t.checks[0].ok) 'it passed'
		Assert (Test-Path (Join-Path $Tasks "T-001\$($t.checks[0].file)")) 'the output is beside the task'
		Assert-Throws { Rocco result T-001 -Text 'nothing said' } 'needs -Pass or -Fail' 'result without a verdict'
	}

	Test 'commands at the same moment lose nothing' {
		$exe = Join-Path $App 'rocco.ps1'
		$runs = 1..8 | ForEach-Object { Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$exe`"", 'log', 'T-001', '-Text', "parallel-$_", '-Project', 'Game' -WindowStyle Hidden -PassThru }
		$runs | ForEach-Object { $_.WaitForExit(60000) | Out-Null }
		$lines = @((Read-TaskJson 'T-001').log | Where-Object { $_.text -match '^parallel-' })
		Assert-Equal $lines.Count 8 'all eight log lines are there'
	}

	Test 'a task file is never left half written' {
		Assert (-not (Test-Path (Join-Path $Tasks 'T-001\task.json.new'))) 'no leftover of the swap'
		$null = Read-TaskJson 'T-001'
	}

	Test 'time at work is counted' {
		$t = Read-TaskJson 'T-001'; $t.workSince = (Get-Date).AddMinutes(-10).ToString('o'); Write-TaskJson $t
		Rocco set T-001 -Status ready -Where lane | Out-Null
		$worked = [int](Read-TaskJson 'T-001').worked
		Assert ($worked -ge 590 -and $worked -le 700) "about ten minutes, got $worked s"
	}

	Test 'the other commands an agent runs' {
		$plan = @(Rocco plan -Title 'Trading' -Summary 'Players trade cars.' -Steps 'Trade window|1|standard,Trade service|2|heavy')[0]
		Assert-Match $plan '^T-\d+$' 'plan gives its id'
		Assert-Equal @((Read-TaskJson $plan).steps).Count 2 'two steps, split at the comma'
		$idea = @(Rocco suggest -Title 'Add a horn' -Summary 'Players asked')[0]
		Assert-Equal (Read-TaskJson $idea).status 'inbox' 'a suggestion waits in the inbox'
		Rocco doing 'Merging the trade window' | Out-Null
		Rocco say -Text 'All merged.' | Out-Null
		Rocco reply $idea -Text 'Noted.' | Out-Null
		Rocco clear $idea | Out-Null
		$asked = (Rocco ask -Question 'Ship it today?' -Options 'Yes,Not yet') -join ' '
		Assert-Match $asked '^C-[0-9a-f]{6} asked' 'the conductor''s own question'
		Assert-Match ((Rocco wait -Timeout 1) -join ' ') 'Nothing new yet|Waiting on you' 'wait returns'
		Assert-Match ((Rocco list) -join "`n") 'Trading' 'list shows the plan'
		# wait marks whatever ran it as this game's conductor: not one for the tests that follow.
		Remove-Item (Join-Path $Game 'rocco\conductor.json') -Force -ErrorAction SilentlyContinue
		Remove-Item (Join-Path $Game "rocco\tasks\$plan"), (Join-Path $Game "rocco\tasks\$idea") -Recurse -Force
	}

	Write-Host 'The app'
	# An old approved task, to be put away when the server first looks at the board.
	$old = @(Rocco new -Title 'Long finished' -Note 'An old car fix')[-1]
	$t = Read-TaskJson $old; $t.status = 'done'; $t.doneAt = (Get-Date).AddDays(-30).ToString('o'); $t.updated = $t.doneAt; Write-TaskJson $t
	Start-Server

	Test 'the board loads, with the version and other projects' {
		$s = Api '/api/state'
		Assert-Equal $s.project.name 'Test Game' 'the project'
		Assert ($null -ne $s.others) 'others is there'
		Assert (@($s.tasks | Where-Object { $_.id -eq 'T-001' }).Count -eq 1) 'T-001 is on the board'
	}

	Test 'a write without the app''s header is refused' {
		$request = [Net.HttpWebRequest]::Create("$script:Base/api/note?p=Game"); $request.Method = 'POST'; $request.ContentType = 'application/json'
		$stream = $request.GetRequestStream(); $stream.Write([byte[]](123, 125), 0, 2); $stream.Close()
		$code = 0; try { $request.GetResponse().Close() } catch [Net.WebException] { $code = [int]$_.Exception.Response.StatusCode }
		Assert-Equal $code 403 'the status'
	}

	Test 'a long-finished task is put away, and still found' {
		Assert (Test-Path (Join-Path $Game "rocco\archive\$old\task.json")) 'it moved to the archive'
		Assert-Equal @((Api '/api/archive?q=car+fix').tasks | Where-Object { $_.id -eq $old }).Count 1 'the archive search finds it'
		Assert-Equal (Api "/api/tasks/$old").title 'Long finished' 'it opens by its id'
		Assert-Match ((Rocco show $old) -join ' ') 'Long finished' 'show finds it'
		$next = @(Rocco new -Title 'After the archive')[-1]
		Assert ([int]($next -replace '\D') -gt [int]($old -replace '\D')) "ids carry on past the archive ($next)"
	}

	Test 'a note with screenshots waits for them' {
		$n = Api '/api/note' @{ text = 'Look at this'; type = 'bug'; hold = $true }
		Assert-Equal (Read-TaskJson $n.id).pending '' 'not handed over yet'
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match $n.id }).Count 0 'the conductor doesn''t see it'
		$png = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
		Assert-Equal (Api "/api/tasks/$($n.id)/shot" $png 'image/png').name 'shot-1.png' 'the screenshot'
		Api "/api/tasks/$($n.id)/release" @{} | Out-Null
		$t = Read-TaskJson $n.id
		Assert-Equal $t.pending 'plan' 'handed over'
		Assert-Equal @($t.shots).Count 1 'with its screenshot'
		Assert-Throws { Api "/api/tasks/$($n.id)/shot" (New-Object byte[] 0) 'image/png' } 'HTTP 400' 'an empty picture'
		Assert-Throws { Api "/api/tasks/$($n.id)/shot" ([byte[]](1, 2, 3)) 'text/plain' } 'HTTP 415' 'not a picture'
	}

	Test 'an approval waits out Undo before the conductor hears of it' {
		Api '/api/tasks/T-001/approve' @{} | Out-Null
		Assert-Equal (Read-TaskJson 'T-001').pending 'merge' 'it will merge'
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match 'T-001' }).Count 0 'held back while Undo is offered'
		Api '/api/tasks/T-001/undo' @{} | Out-Null
		Assert-Equal (Read-TaskJson 'T-001').status 'ready' 'Undo put it back'
		Api '/api/tasks/T-001/approve' @{} | Out-Null
		Start-Sleep -Seconds 7
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match 'T-001\s.*\[merge\]' }).Count 1 'handed over once Undo is gone'
		Assert-Throws { Api '/api/tasks/T-001/undo' @{} } 'Too late to undo' 'a late Undo'
	}

	Test 'pause, the lane and worker, resume and restart' {
		$id = @(Rocco new -Title 'Worked on')[-1]
		Rocco set $id -Status working -Lane 2 | Out-Null
		Api "/api/tasks/$id/pause" @{} | Out-Null
		$t = Read-TaskJson $id
		Assert ([bool]$t.held) 'paused'
		Assert-Equal $t.status 'queued' 'no conductor running: it stops at once'
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match $id }).Count 0 'a paused task waits on nobody'
		Api "/api/tasks/$id/assign" @{ text = 'lane=3 tier=heavy' } | Out-Null
		Assert-Throws { Api "/api/tasks/$id/assign" @{ text = 'tier=mega' } } 'A worker is one of' 'an unknown worker'
		Api "/api/tasks/$id/resume" @{} | Out-Null
		$t = Read-TaskJson $id
		Assert-Equal $t.pending 'resume' 'the conductor is asked to carry on'
		Assert-Equal "$($t.wantLane) $($t.wantTier)" '3 heavy' 'what the user picked'
		Assert-Match ((Rocco show $id) -join "`n") 'The user resumed it' 'show says what to do'
		Rocco set $id -Status working -Lane 3 | Out-Null
		Assert-Equal (Read-TaskJson $id).pending '' 'picking it up handles the resume'
		Api "/api/tasks/$id/restart" @{ text = 'it went the wrong way' } | Out-Null
		Assert-Match ((Rocco show $id) -join "`n") 'wants a fresh worker' 'show says to restart it'
	}

	Test 'an approved feature gets a thread and an agent of its own' {
		$plan = @(Rocco plan -Title 'Trading' -Summary 'Players trade cars.' -Steps 'Trade window|1|standard,Trade service|2|heavy')[0]
		Api "/api/tasks/$plan/approve-plan" @{} | Out-Null
		Api '/api/state' | Out-Null # looking at the board gives it its lane
		$p = Read-TaskJson $plan
		Assert ([bool]$p.lead) 'it has an agent of its own'
		Assert ([int]$p.lane -ge 1) "and a lane ($($p.lane))"
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match "^$plan\s" }).Count 0 'the conductor isn''t asked to build it'
		Assert-Equal @(Rocco list -Pending -Thread $plan | Where-Object { $_ -match "^$plan\s.*\[approved\]" }).Count 1 'its own agent is'
		# What the user writes in the feature's thread goes to that agent, not to the conductor.
		Api "/api/conductor/message?t=$plan" @{ text = 'make the accept button green' } | Out-Null
		Assert (Test-Path (Join-Path $Game "rocco\threads\$plan\thread.jsonl")) 'the thread has its own file'
		Assert-Match ((Rocco list -Pending -Thread $plan) -join "`n") '\[message\]\s+make the accept button green' 'its agent sees the message'
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match 'accept button' }).Count 0 'the conductor doesn''t'
		# As that agent (its window names its thread): a step it makes is its own, and its news goes in its thread.
		$env:ROCCO_THREAD = $plan
		try {
			$step = @(Rocco new -Title 'Trade window' -Plan $plan)[0]
			Rocco set $step -Status working -Lane $p.lane -Branch feature/trading | Out-Null
			Rocco say -Text 'The window is half built.' | Out-Null
			Assert-Match ((Rocco list) -join "`n") 'Trade window' 'its list is its own tasks'
			Assert-Equal @(Rocco list | Where-Object { $_ -match 'Worked on' }).Count 0 'and nobody else''s'
		} finally { Remove-Item Env:ROCCO_THREAD }
		$items = (Api "/api/conductor/thread?t=$plan").items
		Assert (@($items | Where-Object { $_.kind -eq 'event' -and $_.task -eq $step }).Count -ge 1) 'the step''s start is in the thread'
		Assert-Equal @($items | Where-Object { $_.kind -eq 'said' -and $_.text -match 'half built' }).Count 1 'and so is what its agent said'
		Assert-Equal @((Api '/api/conductor/thread').items | Where-Object { "$($_.text)" -match 'half built' }).Count 0 'neither is in the main chat'
		Assert (@((Api '/api/state').leads | Where-Object { $_.id -eq $plan }).Count -eq 1) 'the board lists the thread'
		# Sent back, a step goes to the feature's agent. Approved, its merge is the conductor's.
		Rocco set $step -Status ready -Where lane -Summary 'The window opens.' -Test 'Open it' | Out-Null
		Api "/api/tasks/$step/reopen" @{ text = 'too small on phone' } | Out-Null
		Assert-Match ((Rocco list -Pending -Thread $plan) -join "`n") "$step\s.*\[reopen\]" 'a send-back goes to its agent'
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match "^$step\s" }).Count 0 'not to the conductor'
		Rocco set $step -Status ready -Where lane -Summary 'Bigger on phone.' -Test 'Open it' | Out-Null
		Api "/api/tasks/$step/approve" @{} | Out-Null
		Start-Sleep -Seconds 7
		Assert-Match ((Rocco list -Pending) -join "`n") "$step\s.*\[merge\]" 'the merge goes to the conductor'
		Assert-Match ((Rocco show $plan) -join "`n") 'has an agent of its own' 'show tells the conductor it isn''t its to build'
	}

	Test 'a card can be given an agent of its own' {
		$id = @(Rocco new -Title 'Stubborn bug')[0]
		Rocco set $id -Status working -Lane 2 | Out-Null
		Rocco set $id -Status ready -Where main -Summary 'Fixed.' -Test 'Try it' | Out-Null
		Api "/api/tasks/$id/reopen" @{ text = 'still wrong' } | Out-Null
		Api "/api/tasks/$id/promote" @{} | Out-Null
		Api '/api/state' | Out-Null
		Assert ([bool](Read-TaskJson $id).lead) 'it has its own agent'
		Assert-Match ((Rocco list -Pending -Thread $id) -join "`n") "$id\s.*\[reopen\]" 'which hears the send-back'
		Assert-Equal @(Rocco list -Pending | Where-Object { $_ -match "^$id\s" }).Count 0 'and the conductor no longer does'
		Assert-Throws { Api "/api/tasks/$id/promote" @{} } 'already has an agent' 'twice'
	}

	Test 'a note that was only a question is answered, with no card kept' {
		$n = Api '/api/note' @{ text = 'how is drift score worked out?'; type = '' }
		Rocco reply $n.id -Answer -Text 'Angle times speed, summed over the slide.' | Out-Null
		$t = Read-TaskJson $n.id
		Assert-Equal "$($t.kind) $($t.status)" 'question done' 'answered, and finished'
		Assert-Equal @((Api '/api/conductor/thread').items | Where-Object { $_.kind -eq 'said' -and $_.task -eq $n.id }).Count 1 'the answer is in the chat'
		Api "/api/tasks/$($n.id)/make-task" @{} | Out-Null
		$t = Read-TaskJson $n.id
		Assert-Equal "$($t.kind) $($t.pending)" 'note plan' 'and it can be made a task after all'
	}

	Test 'the conductor''s model and effort are kept, and a wrong effort is refused' {
		Api '/api/agent' @{ id = 'claude' } | Out-Null
		$a = Api '/api/agent/model' @{ model = 'claude-opus-5-5' }
		Assert-Equal $a.model 'claude-opus-5-5' 'model'
		$a = Api '/api/agent/effort' @{ effort = 'high' }
		Assert-Equal "$($a.effort) $($a.takesEffort)" 'high True' 'effort'
		Assert-Throws { Api '/api/agent/effort' @{ effort = 'turbo' } } 'Effort is one of' 'a level it does not take'
		Assert-Equal (Api '/api/agent').effort 'high' 'still high after a refused change'
		Api '/api/agent/effort' @{ effort = '' } | Out-Null
		Api '/api/agent/model' @{ model = '' } | Out-Null
	}

	Test 'an errand is done and said, with nothing to approve' {
		$n = Api '/api/note' @{ text = 'open 4 lanes and main'; type = '' }
		Rocco set $n.id -Title 'Open Main and 4 lanes' -Status working | Out-Null
		Rocco reply $n.id -Done -Text 'Main and lanes 1 to 4 are open in Studio.' | Out-Null
		$t = Read-TaskJson $n.id
		Assert-Equal "$($t.kind) $($t.status) $($t.pending)" 'errand done ' 'finished, waiting on nobody'
		Assert-Equal @((Api '/api/conductor/thread').items | Where-Object { $_.kind -eq 'said' -and $_.task -eq $n.id }).Count 1 'what was done is in the chat'
		$b = @(Rocco new -Title 'A change with a branch')[0]
		Rocco set $b -Status working -Branch 'agent/a-change' | Out-Null
		Assert-Throws { Rocco reply $b -Done -Text 'Done.' } 'has a branch' 'a change is tested, not just done'
	}

	Test 'docs: the template''s files stay locked however the path is written' {
		Assert ([bool](Api '/api/docs/file?path=docs/workflow/CONDUCTOR.md').locked) 'locked by its plain path'
		Assert ([bool](Api '/api/docs/file?path=docs//workflow/CONDUCTOR.md').locked) 'locked with a doubled slash'
		Assert-Throws { Api '/api/docs/save' @{ path = 'docs//workflow/CONDUCTOR.md'; text = 'x'; base = ''; message = '' } } 'belongs to the template' 'saving it'
	}

	Test 'docs: an edit is committed, and one git refuses is put back' {
		$doc = Api '/api/docs/file?path=docs/game/GDD.md'
		$saved = Api '/api/docs/save' @{ path = 'docs/game/GDD.md'; text = "# Design`n`nA drifting game.`n"; base = $doc.hash; message = 'Design: drifting' }
		Assert ([bool]$saved.saved) 'saved'
		Assert-Match "$(RepoGit log -1 --format=%s)" 'Design: drifting' 'committed with its message'
		New-Item -ItemType Directory -Force (Join-Path $Repo '.git\hooks') | Out-Null
		[IO.File]::WriteAllText((Join-Path $Repo '.git\hooks\pre-commit'), "#!/bin/sh`necho refused by the test hook >&2`nexit 1`n")
		$doc = Api '/api/docs/file?path=docs/game/GDD.md'
		Assert-Throws { Api '/api/docs/save' @{ path = 'docs/game/GDD.md'; text = "# Design`n`nBroken.`n"; base = $doc.hash; message = '' } } 'back as it was' 'a refused commit'
		Remove-Item (Join-Path $Repo '.git\hooks\pre-commit') -Force
		Assert-Match ([IO.File]::ReadAllText((Join-Path $Repo 'docs\game\GDD.md'))) 'drifting' 'the doc is as it was'
		Assert-Equal "$(RepoGit status --porcelain)" '' 'nothing left staged or changed'
	}

	Test 'docs: a doc that isn''t UTF-8 is shown but not edited' {
		[IO.File]::WriteAllBytes((Join-Path $Repo 'docs\game\OLD.md'), [byte[]](35, 32, 67, 97, 102, 0xE9, 10))
		RepoGit add -A; RepoGit commit --quiet -m 'An old doc'
		$doc = Api '/api/docs/file?path=docs/game/OLD.md'
		Assert ([bool]$doc.locked) 'locked'
		Assert-Match $doc.text "Caf$([char]0xE9)" 'shown with its accent'
		Assert-Throws { Api '/api/docs/save' @{ path = 'docs/game/OLD.md'; text = 'x'; base = $doc.hash; message = '' } } "isn't saved as UTF-8" 'saving it'
	}

	Test 'what a task changed, file by file' {
		RepoGit checkout --quiet -b agent/diff
		[IO.File]::WriteAllText((Join-Path $Repo 'docs\game\GDD.md'), "# Design`n`nA drifting game.`nWith rain.`n", $Utf8)
		RepoGit commit --quiet -am 'Rain'; RepoGit checkout --quiet main
		$id = @(Rocco new -Title 'Rain')[-1]
		Rocco set $id -Status working -Branch agent/diff | Out-Null
		$changes = Api "/api/tasks/$id/changes"
		Assert-Equal @($changes.files).Count 1 'one file'
		$diff = Api "/api/tasks/$id/diff?path=docs/game/GDD.md"
		Assert-Match $diff.text '(?m)^\+With rain\.' 'the added line'
		Assert-Throws { Api "/api/tasks/$id/diff?path=docs/game/PROJECT.md" } "isn't one this task changed" 'a file it didn''t change'
	}

	Test 'the server answers with the fields the app counts on' {
		# tests\shapes.json lists them. The app's own check holds the demo to the same list (tests\web\demo.test.js).
		$shapes = [IO.File]::ReadAllText((Join-Path $Here 'tests\shapes.json'), $Utf8) | ConvertFrom-Json
		# A task of its own at work, so the board and the usage list each have a row to look at.
		$own = @(Rocco new -Title 'A task for the fields')[0]
		Rocco set $own -Status working -Lane 1 | Out-Null
		# With an agent of its own, so the threads the board lists have one to look at too.
		Api "/api/tasks/$own/promote" @{} | Out-Null
		$problems = @()
		foreach ($shape in $shapes.PSObject.Properties) {
			$value = Api ($shape.Value.path -replace '\{task\}', $own)
			foreach ($part in $shape.Value.fields.PSObject.Properties) {
				$at = $value
				if ($part.Name -ne '.') { foreach ($key in $part.Name -split '\.') { $at = @($at)[0].$key } }
				$one = @($at)[0]
				if ($null -eq $one) { $problems += "$($shape.Name) $($part.Name): nothing came back"; continue }
				$gone = @($part.Value | Where-Object { -not $one.PSObject.Properties[$_] })
				if ($gone.Count) { $problems += "$($shape.Name) $($part.Name): $($gone -join ', ')" }
			}
		}
		Assert-Equal ($problems -join '; ') '' 'fields missing'
	}

	Test 'the conductor''s hooks: only the user''s own words count as typed' {
		$post = { param($event, $body) Api "/api/conductor/hook?e=$event" $body | Out-Null }
		& $post 'prompt' @{ prompt = '<agent-message from="a1">[Subagent hand-back] report</agent-message>' }
		& $post 'prompt' @{ prompt = '<task-notification><task-id>x</task-id></task-notification>' }
		& $post 'prompt' @{ prompt = 'there are queued tasks waiting' }
		1..3 | ForEach-Object { & $post 'stop' @{ last_assistant_message = 'Watching.' } }
		& $post 'stop' @{ last_assistant_message = 'Merged the trade window.' }
		$items = (Api '/api/conductor/thread').items
		Assert-Equal @($items | Where-Object { $_.kind -eq 'message' -and $_.via -eq 'terminal' }).Count 1 'one typed message'
		Assert-Equal @($items | Where-Object { $_.kind -eq 'said' -and $_.text -eq 'Watching.' }).Count 1 'the idle line once'
		Assert-Equal @($items | Where-Object { $_.kind -eq 'said' -and $_.via -eq 'hook' }).Count 2 'and the real one'
	}

	Test 'a worker''s hooks pair its session with its task' {
		Api '/api/conductor/hook?e=tool' @{ agent_id = 'abc123'; agent_type = 'worker'; tool_name = 'PowerShell'; tool_input = @{ command = '..\..\_tools\rocco\rocco.ps1 set T-001 -Step "Testing"' } } | Out-Null
		$rows = @([IO.File]::ReadAllLines((Join-Path $Game 'rocco\conductor\workers.jsonl')) | ForEach-Object { $_ | ConvertFrom-Json })
		Assert-Equal @($rows | Where-Object { $_.agent -eq 'abc123' -and $_.task -eq 'T-001' }).Count 1 'the pairing is on record'
	}

	Stop-Server
	Write-Host 'Pieces'

	Test 'trimming the conductor''s thread keeps what is new and what is open' {
		Use-Project $Game
		$file = Join-Path $Temp 'trim.jsonl'
		$oldAt = (Get-Date).AddDays(-20).ToString('o'); $newAt = (Get-Date).ToString('o')
		$lines = @(
			"{`"id`":`"C-000001`",`"at`":`"$oldAt`",`"who`":`"conductor`",`"kind`":`"said`",`"text`":`"old`"}",
			"{`"id`":`"C-000002`",`"at`":`"$oldAt`",`"who`":`"conductor`",`"kind`":`"asked`"}",
			"{`"id`":`"C-000003`",`"at`":`"$newAt`",`"who`":`"conductor`",`"kind`":`"said`",`"text`":`"new`"}"
		)
		[IO.File]::WriteAllText($file, ($lines -join "`n") + "`n", $Utf8)
		$needed = @{ 'C-000002' = $true }
		$stamp = (Get-Date).AddDays(-7).ToUniversalTime()
		Edit-Lines $file {
			param($all)
			foreach ($line in $all) {
				$id = if ($line -match '"id":"(C-[0-9a-f]+)"') { $Matches[1] } else { '' }
				$fresh = $false
				if ($line -match '"at":"([^"]+)"') { $fresh = ([datetime]$Matches[1]).ToUniversalTime() -gt $stamp }
				if ($fresh -or $needed.ContainsKey($id)) { $line }
			}
		}
		$kept = @([IO.File]::ReadAllLines($file))
		Assert-Equal $kept.Count 2 'the old line is gone'
		Add-Line $file ([ordered]@{ id = 'C-000004'; at = $newAt })
		Assert-Equal @([IO.File]::ReadAllLines($file)).Count 3 'a line appended after still lands whole'
	}

	Test 'the conductor''s hook settings are valid, whichever kind this PC gets' {
		Use-Project $Game
		$s = [IO.File]::ReadAllText((Write-ConductorHooks), $Utf8) | ConvertFrom-Json
		$tool = @($s.hooks.PreToolUse | Where-Object { $_.matcher -eq '*' })[0].hooks[0]
		Assert ($tool.type -in 'http', 'command') "a kind of hook Claude Code knows ($($tool.type))"
		if ($tool.type -eq 'http') {
			Assert-Match $tool.url '^http://localhost:\d+/api/conductor/hook\?p=Game&e=tool$' 'where it posts'
			Assert-Equal $tool.headers.'X-Rocco' '1' 'the header a write needs'
		} else { Assert-Match $tool.command 'hook-post\.ps1' 'the script that posts for it' }
		Assert-Equal @($s.hooks.Stop[0].hooks).Count 2 'Stop passes the message on and checks the board'
		Assert-Equal @($s.hooks.Stop[0].hooks)[1].type 'command' 'the check that can send it back is a command'
		Assert ($null -ne $s.hooks.SubagentStop) 'a worker ending is passed on'
		# A feature's own agent: its hooks name its thread.
		Use-Thread 'T-001'
		try { $own = [IO.File]::ReadAllText((Write-ConductorHooks), $Utf8) } finally { Use-Thread '' }
		Assert-Match $own 'T-001' 'a feature''s hooks name its thread'
		Assert (Test-Path (Join-Path $Game 'rocco\threads\T-001\claude-settings.json')) 'and are kept with it'
	}

	Test 'what an agent is opened with is data: a quote in it can''t run' {
		$fake = Join-Path $Temp 'fake-agent'
		New-Item -ItemType Directory -Force $fake | Out-Null
		$got = Join-Path $Temp 'agent-args.json'
		[IO.File]::WriteAllText((Join-Path $fake 'claude.ps1'), "[IO.File]::WriteAllText('$got', (ConvertTo-Json -InputObject @(`$args)), (New-Object Text.UTF8Encoding `$false))", $Utf8)
		$path = $env:PATH; $env:PATH = "$fake;$path"; $script:AgentCache = $null
		$marker = Join-Path $Temp 'INJECTED'
		$curly = [char]0x2019
		$prompt = "Fix the player${curly}s car$curly; New-Item '$marker' -ItemType File; ${curly}x and it's `$(New-Item '$marker' -ItemType File) done"
		try {
			$window = Start-AgentWindow $Repo $prompt 'test' @('--settings', 'C:\a b\settings.json')
			for ($i = 0; $i -lt 60 -and -not (Test-Path $got); $i++) { Start-Sleep -Milliseconds 250 }
			& taskkill.exe /T /F /PID $window.Id 2>$null | Out-Null
		} finally { $env:PATH = $path; $script:AgentCache = $null }
		Assert (Test-Path $got) 'the agent was started'
		$passed = @(([IO.File]::ReadAllText($got, $Utf8) | ConvertFrom-Json) | ForEach-Object { $_ })
		Assert-Equal $passed.Count 3 'three arguments'
		Assert-Equal $passed[-1] $prompt 'the prompt arrived whole, as one argument'
		Assert-Equal $passed[1] 'C:\a b\settings.json' 'so did a path with a space'
		Assert (-not (Test-Path $marker)) 'nothing in it ran'
	}

	Test 'a thumbnail prompt is data too' {
		$tool = Join-Path $Temp 'fake-imagegen.ps1'
		[IO.File]::WriteAllText($tool, "param([string]`$Prompt, [string]`$Out) [IO.File]::WriteAllText(`$Out, `$Prompt, (New-Object Text.UTF8Encoding `$false)); 'size=1x1 sha256=abc'", $Utf8)
		$marker = Join-Path $Temp 'INJECTED2'
		$curly = [char]0x2019
		$prompt = "A hero$curly; New-Item '$marker' -ItemType File; ${curly}x"
		$out = Join-Path $Temp 'concepts'
		$said = & $ConceptJob $tool $out 'hero' $prompt 1 1 'The hero'
		Assert-Equal "$said" '' 'no failure reported'
		Assert-Equal ([IO.File]::ReadAllText((Join-Path $out 'hero-01.png'), $Utf8)) $prompt 'the tool got the prompt whole'
		Assert (-not (Test-Path $marker)) 'nothing in it ran'
		Assert (Test-Path (Join-Path $out 'hero-01.png.json')) 'its record is beside it'
	}

	Test 'a background job says how it ended, even to a Rocco that restarted' {
		$job = Join-Path $Temp 'job.ps1'
		[IO.File]::WriteAllText($job, "param([string]`$Name) Write-Output `"made `$Name`"; exit 0", $Utf8)
		$id = Start-ScriptJob 'new' $job @('-Name', 'A game with spaces') 'A game with spaces' $true
		for ($i = 0; $i -lt 80 -and (Get-JobStatus $id).running; $i++) { Start-Sleep -Milliseconds 250 }
		$status = Get-JobStatus $id
		Assert ([bool]$status.ok) "it ended well ($($status.output))"
		Assert-Match $status.output 'made A game with spaces' 'its output, and its argument whole'
		$script:Jobs = @{}
		Assert ([bool](Get-JobStatus $id).ok) 'still known from its record'
		$bad = Join-Path $Temp 'job-bad.ps1'
		[IO.File]::WriteAllText($bad, "Write-Output 'going wrong'; exit 3", $Utf8)
		$id = Start-ScriptJob 'new' $bad @() 'x' $true
		for ($i = 0; $i -lt 80 -and (Get-JobStatus $id).running; $i++) { Start-Sleep -Milliseconds 250 }
		Assert (-not (Get-JobStatus $id).ok) 'a failed one says so'
	}

	Test 'a session''s usage counts each message once' {
		$dir = Join-Path $Temp 'claude\projects\x'
		New-Item -ItemType Directory -Force $dir | Out-Null
		$env:CLAUDE_CONFIG_DIR = Join-Path $Temp 'claude'
		$line = { param($id, $in, $out) "{`"type`":`"assistant`",`"timestamp`":`"2026-01-01T00:00:00Z`",`"message`":{`"model`":`"claude-test`",`"id`":`"$id`",`"type`":`"message`",`"role`":`"assistant`",`"content`":[],`"usage`":{`"input_tokens`":$in,`"cache_creation_input_tokens`":10,`"cache_read_input_tokens`":100,`"output_tokens`":$out,`"cache_creation`":{`"x`":1}}}}" }
		$file = Join-Path $dir 's.jsonl'
		[IO.File]::WriteAllText($file, ((& $line 'msg_a' 5 7), (& $line 'msg_a' 5 7), (& $line 'msg_b' 1 2) -join "`n") + "`n", $Utf8)
		try { $u = Get-SessionUsage $file } finally { Remove-Item Env:CLAUDE_CONFIG_DIR }
		Assert-Equal "$($u.in) $($u.out) $($u.cacheRead) $($u.cacheWrite) $($u.messages)" '6 9 200 20 2' 'in, out, cache read, cache write, messages'
		Assert-Equal $u.model 'claude-test' 'the model'
		Assert ($null -eq (Get-SessionUsage (Join-Path $Temp 'console.txt'))) 'a file outside the agent''s own folder is never read'
	}

	Test 'a network git call is given up on' {
		$r = Invoke-GitNet $Repo @('ls-remote', '--heads', 'http://10.255.255.1/nothing.git') 3 $false
		Assert (-not $r.ok) 'it failed'
	}
} finally {
	Stop-Server
	Remove-Item Env:ROCCO_HOME, Env:ROCCO_NO_CONDUCTOR -ErrorAction SilentlyContinue
	# The link to Rocco's own files goes first, by itself, and the folder is only deleted once it's gone: deleting a
	# folder with the link still in it could reach through it into the real files.
	if (-not $Keep) {
		if (Test-Path -LiteralPath $App) { [IO.Directory]::Delete($App, $false) }
		if (Test-Path -LiteralPath $App) { Write-Host "Left in place (the link to Rocco couldn't be removed): $Temp" }
		else { Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue }
	} else { Write-Host "Kept: $Temp" }
}

Write-Host ''
Write-Host "$script:Passed passed, $($script:Failed.Count) failed"
if ($script:Failed.Count) { $script:Failed | ForEach-Object { Write-Host "  failed: $_" }; exit 1 }
exit 0
