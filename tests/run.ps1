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
	$env:ROCCO_MEMORY_TICK = '2' # the server writes its memory line every 2 seconds, not every minute (memory.ps1)
	Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue

	# Rocco's own functions, for the tests that call one directly.
	$AppDir = $App; $Command = 'test'; $Project = 'Game'; $Port = 34860
	foreach ($part in 'core', 'agents', 'memory', 'tasks', 'thread', 'sessions', 'projects', 'codex-watch', 'conductor', 'leads', 'lanes', 'loans', 'connections', 'history', 'docs', 'actions', 'accounts', 'onboarding', 'roblox', 'updates', 'thumbnails', 'http') { . (Join-Path $App "server\$part.ps1") }
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
		# Approved in its lane, it stays done through the merge: the conductor can't hand it back to To test.
		Assert-Match ((Rocco show T-001) -join "`n") "don't set it ready" 'show says it stays done'
		Assert-Throws { Rocco set T-001 -Status ready -Where main } 'stays done' 'merged, it isn''t handed back to test'
		Assert-Throws { Rocco set T-001 -Status working } 'stays done' 'nor taken up again before its merge'
		Rocco clear T-001 | Out-Null
		$t = Read-TaskJson 'T-001'
		Assert-Equal "$($t.status)/$($t.pending)" 'done/' 'merged and cleared, it''s done'
		Assert-Throws { Rocco set T-001 -Status ready } "doesn't go back to To test" 'an approved card isn''t made ready again'
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

	Test 'a feature of one step is the conductor''s to build, and its step is kept as a list' {
		$plan = @(Rocco plan -Title 'Horn' -Summary 'A horn to honk.' -Steps 'Horn button|1|standard')[0]
		Assert-Match ([IO.File]::ReadAllText((Join-Path $Tasks "$plan\task.json"))) '"steps":\s*\[' 'one step is saved as a list'
		Api "/api/tasks/$plan/approve-plan" @{} | Out-Null
		Assert (-not (Read-TaskJson $plan).lead) 'it gets no agent of its own'
		Assert-Match ((Rocco list -Pending) -join "`n") "$plan\s.*\[approved\]" 'the conductor is asked to build it'
		Assert-Equal @((Api '/api/conductor/thread').items | Where-Object { "$($_.text)" -match 'Horn has its own thread' }).Count 0 'the chat names no thread for it'
		Rocco set $plan -Status removed | Out-Null
	}

	Test 'a card with nothing to test approves itself, and its plan moves on' {
		$plan = @(Rocco plan -Title 'Garage' -Summary 'Players keep cars.' -Steps 'Garage records|1|standard,Garage screen|1|standard')[0]
		Api "/api/tasks/$plan/approve-plan" @{} | Out-Null
		Api '/api/state' | Out-Null # looking at the board gives it its lane
		$p = Read-TaskJson $plan
		$env:ROCCO_THREAD = $plan
		try {
			$first = @(Rocco new -Title 'Garage records' -Plan $plan)[0]
			Rocco set $first -Status working -Lane $p.lane -Branch feature/garage | Out-Null
			Assert-Throws { Rocco set $first -Status ready -Where lane -Summary 'Records kept.' -Test 'Nothing to try yet' } 'add -NothingToTest' 'nothing to try, in words alone'
			Assert-Throws { Rocco set $first -Status working -NothingToTest } 'goes with -Status ready' '-NothingToTest on another status'
			# What the user added while it ran is read first: it may be something to try.
			Api "/api/tasks/$first/followup" @{ text = 'show the car colours too' } | Out-Null
			Assert-Throws { Rocco set $first -Status ready -NothingToTest -Where lane -Summary 'Records kept.' } 'added to' 'with a follow-up unread'
			Rocco clear $first | Out-Null
			$said = (Rocco set $first -Status ready -NothingToTest -Where lane -Summary 'Records kept.' -Test 'The screen shows them in the next step') -join "`n"
			Assert-Match $said 'approved itself' 'its agent hears it approved itself'
			$t = Read-TaskJson $first
			Assert-Equal "$($t.status)/$($t.pending)" 'done/merge' 'done, and on its branch it waits on its merge'
			Assert-Equal $t.test 'Nothing to test: The screen shows them in the next step' 'the card says why'
			Assert-Match (@($t.log)[-1].text) 'approved itself' 'and that it approved itself'
		} finally { Remove-Item Env:ROCCO_THREAD }
		Assert-Match ((Rocco list -Pending) -join "`n") "$first\s.*\[merge\]" 'the conductor gets the merge at once, with no Undo to wait out'
		Assert-Match ((Rocco show $first) -join "`n") 'approved itself' 'show tells the conductor why it''s done'
		Assert (@((Api "/api/conductor/thread?t=$plan").items | Where-Object { "$($_.text)" -match 'Done, nothing to test: Garage records' }).Count -eq 1) 'the thread says so'
		Assert-Equal (Read-TaskJson $plan).status 'queued' 'the feature carries on'
		# Its last step, with nothing to test either: every step is approved, so the feature is done.
		$env:ROCCO_THREAD = $plan
		try {
			$last = @(Rocco new -Title 'Garage screen' -Plan $plan)[0]
			Rocco set $last -Status working -Lane $p.lane -Branch feature/garage | Out-Null
			Rocco set $last -Status ready -NothingToTest -Where lane -Summary 'The screen.' | Out-Null
		} finally { Remove-Item Env:ROCCO_THREAD }
		Assert-Equal (Read-TaskJson $last).test 'Nothing to test' 'with no reason given, the card still says so'
		Assert-Equal (Read-TaskJson $plan).status 'done' 'the feature is done'
	}

	Test 'two commands in one shell: the first lets go of what it held, and a failed new leaves no card' {
		$plan = @(Rocco plan -Title 'Paint shop' -Summary 'Players paint cars.' -Steps 'Paint booth|1|standard,Colour picker|1|standard')[0]
		$first = @(Rocco new -Title 'Paint booth' -Plan $plan)[0]
		Rocco set $first -Status working -Lane 1 | Out-Null
		$count = { @(Get-ChildItem (Join-Path $Game 'rocco\tasks') -Directory).Count }
		$before = & $count
		# As an agent runs them: one after the other, in its own PowerShell. Making the first ready looks at its plan,
		# which the second then changes.
		$rocco = Join-Path $App 'rocco.ps1'
		$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '$rocco' set $first -Status ready -Summary 'The booth.' -Test 'Open it' -Project Game; & '$rocco' new -Title 'Colour picker' -Plan $plan -Project Game" 2>&1 | ForEach-Object { "$_" }
		Assert-Equal $LASTEXITCODE 0 "both ran ($($out -join ' '))"
		Assert-Equal (& $count) ($before + 1) 'one card for the step'
		Assert-Throws { Rocco new -Title 'Lost step' -Plan 'T-999' } 'No task T-999' 'a step for a plan that isn''t there'
		Assert-Equal (& $count) ($before + 1) 'and no card is left from it'
	}

	Test 'a finished feature''s agent closes with its window, however it finished' {
		# An agent in a window as Rocco opens one (agents.ps1's window script, run as is), standing in for Claude Code.
		$script = [regex]::Match([IO.File]::ReadAllText((Join-Path $App 'server\agents.ps1')), "(?s)\`$AgentWindowScript = @'\r?\n(.*?)\r?\n'@").Groups[1].Value
		$openAgent = {
			param($plan)
			$start = ConvertTo-Json -Compress @{ title = 'Rocco: test'; dir = $Repo; exe = (Get-Command powershell).Source; agent = 'claude'; desktopCodex = $false; arguments = @('-NoProfile', '-Command', 'Start-Sleep -Seconds 300'); set = @{} }
			$env:ROCCO_START = [Convert]::ToBase64String($Utf8.GetBytes($start))
			try { $window = Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))) -WindowStyle Hidden -PassThru }
			finally { Remove-Item Env:ROCCO_START }
			$agent = $null
			for ($i = 0; $i -lt 100 -and -not $agent; $i++) { Start-Sleep -Milliseconds 100; $agent = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($window.Id)" | Where-Object { $_.Name -eq 'powershell.exe' } | Select-Object -First 1 }
			Assert ([bool]$agent) 'the stand-in agent started in its window'
			# The record a wait leaves: the agent, without its window.
			$record = [ordered]@{ agent = 'Claude Code'; window = 0; windowStarted = ''; pid = [int]$agent.ProcessId; started = (Get-Process -Id $agent.ProcessId).StartTime.ToString('o'); waiting = $true; at = (Get-Date).ToString('o') }
			[IO.File]::WriteAllText((Join-Path $Game "rocco\threads\$plan\agent.json"), (ConvertTo-Json $record), $Utf8)
			@($window.Id, [int]$agent.ProcessId)
		}
		$gone = { param($ids) -not @($ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count }

		# Set done by hand: set closes it.
		$plan = @(Rocco plan -Title 'Wheels' -Summary 'Rims to pick.' -Steps 'Rim shop|1|standard,Rim colours|1|standard')[0]
		Api "/api/tasks/$plan/approve-plan" @{} | Out-Null
		New-Item -ItemType Directory -Force (Join-Path $Game "rocco\threads\$plan") | Out-Null
		$ids = & $openAgent $plan
		Rocco set $plan -Status done | Out-Null
		Start-Sleep -Milliseconds 500
		Assert (& $gone $ids) 'its agent and its window are closed'
		Assert (-not (Test-Path (Join-Path $Game "rocco\threads\$plan\agent.json"))) 'and its record'
		Assert-Equal @((Api "/api/conductor/thread?t=$plan").items | Where-Object { $_.text -match 'The feature is done, so its agent' }).Count 1 'its thread says so'

		# Its last step approved while the plan was held: the step's command couldn't finish it, and the server does,
		# as it looks at the board.
		$plan = @(Rocco plan -Title 'Paint' -Summary 'Colours to pick.' -Steps 'Paint booth|1|standard,Colour list|1|standard')[0]
		Api "/api/tasks/$plan/approve-plan" @{} | Out-Null
		New-Item -ItemType Directory -Force (Join-Path $Game "rocco\threads\$plan") | Out-Null
		$first = @(Rocco new -Title 'Colour list' -Plan $plan)[0]
		Rocco set $first -Status done | Out-Null
		$step = @(Rocco new -Title 'Paint booth' -Plan $plan)[0]
		$ids = & $openAgent $plan
		$lock = New-Object IO.FileStream((Join-Path $Game "rocco\tasks\$plan\task.lock"), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
		try { Rocco set $step -Status done | Out-Null } finally { $lock.Close() }
		Assert-Equal (Read-TaskJson $plan).status 'queued' 'the plan was held, so it isn''t finished yet'
		Assert (-not (& $gone $ids)) 'and its agent still runs'
		Api '/api/state' | Out-Null
		Start-Sleep -Milliseconds 500
		Assert-Equal (Read-TaskJson $plan).status 'done' 'the server finishes it'
		Assert (& $gone $ids) 'and closes its agent and window'
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

	Test 'lane review prevents skipping the user approval for a branch' {
		$projectDoc = Join-Path $Repo 'docs\game\PROJECT.md'
		$original = [IO.File]::ReadAllText($projectDoc, $Utf8)
		try {
			[IO.File]::WriteAllText($projectDoc, $original.Replace('| Phase | Production |', "| Phase | Production |`n| Game code review | Lane first |"), $Utf8)
			$id = @(Rocco new -Title 'Game code requiring review')[0]
			Rocco set $id -Status working -Lane 2 -Branch agent/lane-review | Out-Null
			Assert-Throws { Rocco set $id -Status ready -Where main -Test 'Try the change' } 'approval in its lane' 'Main cannot be the initial review place'
			Assert-Throws { Rocco set $id -Status ready -NothingToTest } 'approval in its lane' 'a branch cannot approve itself'
			Assert-Throws { Rocco set $id -Status done } 'approval in its lane' 'a branch cannot be marked approved from the CLI'
			Rocco set $id -Status ready -Test 'Try the change' | Out-Null
			Assert-Equal (Read-TaskJson $id).where 'lane' 'ready defaults to its lane'
			Api "/api/tasks/$id/approve" @{} | Out-Null
			Assert-Equal (Read-TaskJson $id).pending 'merge' 'the user approval asks for the merge'
		} finally { [IO.File]::WriteAllText($projectDoc, $original, $Utf8) }
	}

	Test 'a message carries no card: one is made from it only for work, with its screenshot' {
		$before = @(Get-ChildItem (Join-Path $Game 'rocco\tasks') -Directory).Count
		Assert-Throws { Api '/api/conductor/picture' ([byte[]](1, 2, 3)) 'text/plain' } 'HTTP 415' 'not a picture'
		Assert-Throws { Api '/api/conductor/picture' (New-Object byte[] 0) 'image/png' } 'HTTP 400' 'an empty picture'
		Assert-Throws { Api '/api/conductor/message' @{ text = ' ' } } 'HTTP 400' 'nothing to send'
		$pic = (Api '/api/conductor/picture' ([byte[]](137, 80, 78, 71, 1, 2, 3)) 'image/png').name
		Assert-Match $pic '^pic-[0-9a-f]{8}\.png$' 'the picture is up, by name'
		# A name that isn't one of the pictures sent up is dropped, not looked for elsewhere.
		$m = Api '/api/conductor/message' @{ text = 'the car spins out on the hairpin'; type = 'fix'; shots = @($pic, '..\..\x.png') }
		Assert-Equal @(Get-ChildItem (Join-Path $Game 'rocco\tasks') -Directory).Count $before 'no card for a message'
		$e = @((Api '/api/conductor/thread').items | Where-Object { $_.id -eq $m.id })[0]
		Assert-Equal "$($e.type)|$(@($e.shots) -join ',')" "fix|$($m.id)/$pic" 'it keeps what they said it is, and its screenshot'
		Assert-Equal ((Api "/files/conductor/$($m.id)/$pic").Length) 7 'the screenshot is served with it'
		Assert-Match ((Rocco list -Pending) -join "`n") "$($m.id)\s+\[message\]\s+\(a fix\) the car spins out on the hairpin \(\+1 screenshot\)" 'the conductor sees it as a message'
		$shown = (Rocco show $m.id) -join "`n"
		Assert-Match $shown ([regex]::Escape($pic)) 'show gives the screenshot''s path'
		Assert-Match $shown 'No card comes of it until it asks for work' 'and says when to make a card'
		Assert-Throws { Rocco new -Title 'Spin-out' -From 'C-000000' } 'No C-000000' 'a card from a message that isn''t there'
		$id = @(Rocco new -Title 'Hairpin spin-out' -From $m.id)[-1]
		$t = Read-TaskJson $id
		Assert-Equal "$($t.note)|$($t.from)|$(@($t.shots).Count)" "the car spins out on the hairpin|$($m.id)|1" 'the card has their words, the message and its screenshot'
		Assert (Test-Path (Join-Path $Game "rocco\tasks\$id\$(@($t.shots)[0])")) 'copied to the card'
		Assert-Equal @((Api '/api/conductor/thread').items | Where-Object { $_.kind -eq 'made' -and $_.to -eq $m.id -and $_.task -eq $id }).Count 1 'the chat shows it under the message'
		Assert-Match ((Rocco show $m.id) -join "`n") "Cards made from it: $id" 'and show says so'
		Rocco clear $m.id | Out-Null
		Rocco set $id -Status removed | Out-Null
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

	Test 'tell: a feature agent and the conductor write to each other, never as the user' {
		$plan = @(Rocco plan -Title 'Biomes' -Summary 'Fields and cliffs.' -Steps 'Shared terrain|2|standard,Cliff edges|2|standard')[0]
		Api "/api/tasks/$plan/approve-plan" @{} | Out-Null
		try {
			Assert ([bool](Read-TaskJson $plan).lead) 'the feature has an agent of its own'
			$sent = @(Rocco tell -Text 'T-211 is ready to merge.' -Thread $plan)[0]
			$id = ($sent -split ' ')[0]
			Assert-Match $sent '^C-[0-9a-f]{6} sent to the conductor\.' 'the feature agent hears it went'
			$e = Get-Content (Join-Path $Game 'rocco\conductor\thread.jsonl') | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.id -eq $id }
			Assert-Equal "$($e.who) $($e.kind) $($e.from)" "agent message $plan" 'it lands in the conductor''s thread from that agent'
			Assert-Match ((Rocco list -Pending) -join "`n") "$id\s+\[message\]\s+from the $plan agent, not the user: T-211 is ready" 'wait and list name the agent, not the user'
			Assert-Match ((Rocco show $id) -join "`n") "message from the $plan agent, not the user" 'show names the agent'
			Rocco clear $id | Out-Null
			$back = @(Rocco tell $plan -Text 'Merged; pull main.')[0]
			Assert-Match $back "sent to the $plan agent" 'the conductor tells the feature agent'
			Assert-Match ((Rocco list -Pending -Thread $plan) -join "`n") 'from the conductor: Merged; pull main' 'the feature agent''s wait has it'
			Rocco clear ($back -split ' ')[0] -Thread $plan | Out-Null
			Assert-Throws { Rocco tell -Text 'hello' } 'tells a feature' 'the conductor names whom it tells'
			Assert-Throws { Rocco tell T-001 -Text 'x' -Thread $plan } 'tells only the conductor' 'a feature agent tells only the conductor'
		} finally { Rocco set $plan -Status removed | Out-Null }
	}

	Test 'the Codex Stop hook waits for a feature answer and continues the same thread' {
		$plan = @(Rocco plan -Title 'Settings design' -Summary 'Choose a style.' -Steps 'Compare concepts|1|standard,Pick one|1|standard')[0]
		Api "/api/tasks/$plan/approve-plan" @{} | Out-Null
		Rocco clear $plan -Thread $plan | Out-Null
		$step = @(Rocco new -Title 'Compare concepts' -Plan $plan -Thread $plan)[0]
		Rocco ask $step -Question 'Which settings style?' -Options 'Smoked glass,Pale frost' -Thread $plan | Out-Null
		$other = Api '/api/conductor/message' @{ text = 'This belongs to the main conductor.' }
		$inputFile = Join-Path $Temp 'codex-stop-in.json'
		$outputFile = Join-Path $Temp 'codex-stop-out.json'
		$errorFile = Join-Path $Temp 'codex-stop-error.txt'
		$agentFile = Join-Path $Game "rocco\threads\$plan\agent.json"
		[IO.File]::WriteAllText($inputFile, (ConvertTo-Json -Compress @{
			session_id = [guid]::NewGuid().ToString(); turn_id = [guid]::NewGuid().ToString(); hook_event_name = 'Stop'
			stop_hook_active = $false; last_assistant_message = 'Which settings style?'; cwd = $Repo
		}), $Utf8)
		$exe = Join-Path $App 'rocco.ps1'
		$launchArgs = '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$exe`"", 'hook', 'codex-stop', '-Project', 'Game', '-Thread', $plan, '-Timeout', '20'
		$watch = Start-Process powershell.exe -ArgumentList $launchArgs -WindowStyle Hidden -PassThru -RedirectStandardInput $inputFile -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile
		$null = $watch.Handle # without a handle, Start-Process leaves ExitCode empty
		try {
			for ($i = 0; $i -lt 60 -and -not $watch.HasExited -and -not (Test-Path $agentFile); $i++) { Start-Sleep -Milliseconds 100 }
			# Read the hook's errors only once it has exited: while it runs, its redirect holds the file.
			if ($watch.HasExited) { throw "the Stop hook exited while waiting: $([IO.File]::ReadAllText($errorFile))" }
			Assert (Test-Path $agentFile) 'the feature is listening before the user answers'
			Api "/api/tasks/$step/answer" @{ text = 'Smoked glass' } | Out-Null
			$undoUntil = ([datetime](Read-TaskJson $step).undo.at).AddSeconds($UndoSeconds)
			Assert ($watch.WaitForExit(14000)) 'the Stop hook received the answer'
			Assert-Equal $watch.ExitCode 0 'the hook command succeeded'
			Assert ($watch.ExitTime -ge $undoUntil) 'the hook honored the Undo window'
			$result = [IO.File]::ReadAllText($outputFile, $Utf8) | ConvertFrom-Json
			Assert-Equal $result.decision 'block' 'Codex continues after trying to stop'
			Assert-Match $result.reason "$step\s.*\[answer\]" 'the feature agent receives its pending step answer'
			Assert ($result.reason -notmatch 'This belongs to the main conductor') 'the hook stays in the feature thread'
			Assert-Equal (Read-TaskJson $step).log[-1].text 'Smoked glass' 'the answer stays on the task for the feature agent'
			Rocco clear $step -Thread $plan | Out-Null
			$ask = (@(Rocco ask -Question 'How dark?' -Thread $plan)[0] -split ' ')[0]
			Api "/api/conductor/answer?t=$plan" @{ id = $ask; answers = @('Charcoal'); text = 'Charcoal' } | Out-Null
			$watch = Start-Process powershell.exe -ArgumentList $launchArgs -WindowStyle Hidden -PassThru -RedirectStandardInput $inputFile -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile
		$null = $watch.Handle # without a handle, Start-Process leaves ExitCode empty
			Assert ($watch.WaitForExit(5000)) 'the Stop hook sees a reply already pending from the feature chat'
			Assert-Equal $watch.ExitCode 0 'the reply hook command succeeded'
			$result = [IO.File]::ReadAllText($outputFile, $Utf8) | ConvertFrom-Json
			Assert-Equal $result.decision 'block' 'a feature chat reply also continues the session'
			Assert-Match $result.reason '\[answer\]\s+How dark\? -> Charcoal' 'the feature chat reply reaches its agent'
		} finally {
			if (-not $watch.HasExited) { Stop-Process -Id $watch.Id -Force }
			Rocco clear $other.id | Out-Null
			Rocco set $step -Status removed | Out-Null
			Rocco set $plan -Status removed | Out-Null
		}
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
		# A turn that answered a note: what it ends on says the answer again, and isn't shown twice.
		$n = Api '/api/note' @{ text = 'can the road change partway through a run?'; type = '' }
		Rocco reply $n.id -Answer -Text 'Yes: it is only decided 1,600 studs ahead.' | Out-Null
		& $post 'stop' @{ last_assistant_message = 'Yes, the road can change mid-run. I answered your note.' }
		& $post 'stop' @{ last_assistant_message = 'Merged the lap timer.' }
		$items = (Api '/api/conductor/thread').items
		Assert-Equal @($items | Where-Object { $_.kind -eq 'said' -and $_.text -match 'mid-run' }).Count 0 'the answer once, not again at the end of the turn'
		Assert-Equal @($items | Where-Object { $_.kind -eq 'said' -and $_.text -eq 'Merged the lap timer.' }).Count 1 'the next turn''s message is kept'
	}

	Test 'a message handed to the conductor is marked seen once, and the chat page has it' {
		$m = Api '/api/conductor/message' @{ text = 'How are the road''s sides built?' }
		Rocco list -Pending | Out-Null
		Rocco list -Pending | Out-Null
		$seen = @(Get-Content (Join-Path $Game 'rocco\conductor\thread.jsonl') | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.kind -eq 'seen' -and $_.to -eq $m.id })
		Assert-Equal $seen.Count 1 'one seen line, however often it is handed over'
		$items = @((Api '/api/conductor/thread').items)
		$i = [array]::IndexOf(@($items | ForEach-Object { $_.id }), $m.id)
		Assert ($i -ge 0) 'the message is on the page'
		Assert (@($items | Select-Object -Skip ($i + 1) | Where-Object { $_.kind -eq 'seen' -and $_.to -eq $m.id }).Count -eq 1) 'with its seen line after it'
		Rocco clear $m.id | Out-Null
		Assert (@((Api '/api/conductor/thread').items | Where-Object { $_.kind -eq 'handled' -and $_.to -eq $m.id }).Count -eq 1) 'and its handled line, once it is'
	}

	Test 'an answer the conductor wrote before its last line reaches the chat' {
		$m = Api '/api/conductor/message' @{ text = 'Explain how the runoff is made.' }
		$answer = 'Here is how the sides are built. ' + ('The grass runoff is 12 to 40 studs wide, eased between knots so nothing steps. ' * 5)
		$file = Join-Path $Temp 'turn.jsonl'
		$line = { param($type, $content) ConvertTo-Json -Compress -Depth 8 ([ordered]@{ parentUuid = 'p'; isSidechain = $false; type = $type; message = @{ role = $type; content = $content } }) }
		$lines = @(
			(& $line 'user' 'An earlier turn.'),
			(& $line 'assistant' @(@{ type = 'text'; text = 'An earlier answer that is long enough to count. ' * 8 })),
			(& $line 'user' '<task-notification><task-id>w</task-id></task-notification>'),
			(& $line 'assistant' @(@{ type = 'text'; text = 'Reading the road code.' })),
			(& $line 'assistant' @(@{ type = 'tool_use'; id = 't1'; name = 'Bash'; input = @{ command = 'grep runoff' } })),
			(& $line 'user' @(@{ type = 'tool_result'; tool_use_id = 't1'; content = 'RunoffMin = 12' })),
			(ConvertTo-Json -Compress -Depth 8 ([ordered]@{ parentUuid = 'p'; isSidechain = $false; isMeta = $true; type = 'user'; message = @{ role = 'user'; content = 'A reminder.' } })),
			(& $line 'assistant' @(@{ type = 'text'; text = $answer })),
			(& $line 'assistant' @(@{ type = 'tool_use'; id = 't2'; name = 'Bash'; input = @{ command = 'rocco.ps1 wait' } })),
			(& $line 'user' @(@{ type = 'tool_result'; tool_use_id = 't2'; content = 'Running in the background' })),
			(& $line 'assistant' @(@{ type = 'text'; text = 'The worker is still running.' }))
		)
		[IO.File]::WriteAllText($file, ($lines -join "`n") + "`n", $Utf8)
		Rocco list -Pending | Out-Null
		Api '/api/conductor/hook?e=stop' @{ transcript_path = $file; last_assistant_message = 'The worker is still running.' } | Out-Null
		$said = @((Api '/api/conductor/thread').items | Where-Object { $_.kind -eq 'said' } | Select-Object -Last 2)
		Assert-Equal $said[0].text $answer.Trim() 'the answer it wrote earlier in the turn'
		Assert-Equal $said[1].text 'The worker is still running.' 'then what it ended on'
		Assert (@((Api '/api/conductor/thread').items | Where-Object { $_.kind -eq 'said' -and $_.text -match 'An earlier answer|Reading the road' }).Count -eq 0) 'not its steps, nor an earlier turn'
		# The stop check kept that turn going: what came before it was posted then, and isn't again.
		$more = @(
			(ConvertTo-Json -Compress -Depth 8 ([ordered]@{ parentUuid = 'p'; isSidechain = $false; isMeta = $true; type = 'user'; message = @{ role = 'user'; content = 'Stop hook feedback: Before you stop, start wait.' } })),
			(& $line 'assistant' @(@{ type = 'tool_use'; id = 't3'; name = 'Bash'; input = @{ command = 'rocco.ps1 wait' } })),
			(& $line 'user' @(@{ type = 'tool_result'; tool_use_id = 't3'; content = 'Running in the background' })),
			(& $line 'assistant' @(@{ type = 'text'; text = 'Watching the board again.' }))
		)
		[IO.File]::AppendAllText($file, ($more -join "`n") + "`n", $Utf8)
		Api '/api/conductor/hook?e=stop' @{ transcript_path = $file; last_assistant_message = 'Watching the board again.' } | Out-Null
		Assert-Equal @((Api '/api/conductor/thread').items | Where-Object { $_.kind -eq 'said' -and $_.text -eq $answer.Trim() }).Count 1 'the answer once, after the stop check kept the turn going'
		Rocco clear $m.id | Out-Null
	}

	Test 'the plan''s limits from a status line follow the selected agent until they reset' {
		$previous = (Api '/api/agent').id
		$soon = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600
		$legacy = @{ five = $null; week = @{ used = 17; resets = $soon }; at = (Now) }
		[IO.File]::WriteAllText((Join-Path $RoccoHome 'limits.json'), (ConvertTo-Json -InputObject $legacy -Depth 3), $Utf8)
		try {
			Api '/api/agent' @{ id = 'claude' } | Out-Null
			$l = (Api '/api/state').limits
			Assert-Equal "$($l.agent) $($l.week.used)" 'claude 17' 'the legacy cache belongs to Claude'
			$line = Api '/api/limits' @{ model = @{ id = 'x' }; rate_limits = @{ five_hour = @{ used_percentage = 89.4; resets_at = $soon }; seven_day = @{ used_percentage = 69; resets_at = $soon + 86400 } } }
			Assert-Equal "$line" "5h 89% $([char]0x00B7) week 69%" 'the status line says them'
			$l = (Api '/api/state').limits
			Assert-Equal "$($l.agent) $($l.five.used) $($l.week.used)" 'claude 89.4 69' 'the board has them'
			Api '/api/limits' @{ model = @{ id = 'x' } } | Out-Null
			Assert-Equal "$((Api '/api/state').limits.five.used)" '89.4' 'a status line without limits keeps the last update'

			Api '/api/agent' @{ id = 'gemini' } | Out-Null
			Assert ($null -eq (Api '/api/state').limits) 'switching agents clears Claude limits from the board'
			$line = Api '/api/limits' @{ rate_limits = @{ five_hour = @{ used_percentage = 10; resets_at = 1 }; seven_day = @{ used_percentage = 70; resets_at = $soon } } }
			Assert-Equal "$line" 'week 70%' 'an open Claude window keeps its own status line'
			Assert ($null -eq (Api '/api/state').limits) 'a late Claude update stays off the board'

			Api '/api/agent' @{ id = 'claude' } | Out-Null
			$l = (Api '/api/state').limits
			Assert-Equal "$($l.agent) $($null -eq $l.five) $($l.week.used)" 'claude True 70' 'switching back restores the latest unexpired limits'
		} finally {
			Api '/api/agent' @{ id = $previous } | Out-Null
		}
	}

	Test 'a dialog only its window can answer is said, until it moves on' {
		# A conductor that's running: this test's own process stands in for it.
		$file = Join-Path $Game 'rocco\conductor.json'
		$had = if (Test-Path $file) { [IO.File]::ReadAllText($file, $Utf8) } else { $null }
		$me = Get-Process -Id $PID
		[IO.File]::WriteAllText($file, (ConvertTo-Json @{ agent = 'Claude Code'; pid = $PID; started = $me.StartTime.ToString('o'); at = (Get-Date).ToString('o') }), $Utf8)
		try {
			Add-Activity 'Checking the current repair'
			$firstNote = Api '/api/conductor/message' @{ text = 'First note' }
			$before = (Api '/api/state').conductor
			$note = Api '/api/conductor/message' @{ text = 'Also look at the tyre marks' }
			$after = (Api '/api/state').conductor
			Assert-Equal $after.doing 'Checking the current repair' 'a new message keeps the current action'
			Assert ([bool]$before.doingAt) 'the action has its own timestamp'
			Assert-Equal $after.doingAt $before.doingAt 'an incoming message does not reset its timer'
			Rocco clear $firstNote.id | Out-Null
			Rocco clear $note.id | Out-Null
			$ask = { Start-Sleep -Milliseconds 3100; (Api '/api/state').conductor.windowAsk } # past the state's 3s cache
			Api '/api/conductor/hook?e=notify' @{ notification_type = 'idle_prompt'; message = 'Claude is waiting for your input' } | Out-Null
			Assert-Equal "$(& $ask)" '' 'an idle prompt is nothing to answer'
			Api '/api/conductor/hook?e=notify' @{ notification_type = 'permission_prompt'; message = 'Claude needs your permission' } | Out-Null
			Assert-Equal (& $ask).text 'Claude needs your permission' 'a dialog in its window is said'
			Api '/api/conductor/hook?e=tool' @{ agent_id = 'w9'; tool_name = 'Read'; tool_input = @{ file_path = 'x.md' } } | Out-Null
			Assert-Equal (& $ask).text 'Claude needs your permission' "a worker's step doesn't answer it"
			Api '/api/conductor/hook?e=tool' @{ tool_name = 'Read'; tool_input = @{ file_path = 'x.md' } } | Out-Null
			Assert-Equal "$(& $ask)" '' 'its next step means it was answered'
		} finally { if ($null -ne $had) { [IO.File]::WriteAllText($file, $had, $Utf8) } else { Remove-Item $file -Force } }
	}

	Test 'a worker''s hooks pair its session with its task' {
		Api '/api/conductor/hook?e=tool' @{ agent_id = 'abc123'; agent_type = 'worker'; tool_name = 'PowerShell'; tool_input = @{ command = '..\..\_tools\rocco\rocco.ps1 set T-001 -Step "Testing"' } } | Out-Null
		$rows = @([IO.File]::ReadAllLines((Join-Path $Game 'rocco\conductor\workers.jsonl')) | ForEach-Object { $_ | ConvertFrom-Json })
		Assert-Equal @($rows | Where-Object { $_.agent -eq 'abc123' -and $_.task -eq 'T-001' }).Count 1 'the pairing is on record'
	}

	Test 'the conductor chat pages keep their boundary as new messages arrive' {
		$path = '/api/conductor/thread?t=T-990'
		Use-Thread 'T-990'
		try {
			$file = Get-ThreadFile
			$activityFile = Get-ActivityFile
			$start = (Get-Date).AddMinutes(-5)
			$rows = @(foreach ($n in 1..120) {
				$seconds = if ($n -eq 70) { 71 } else { $n }
				$row = @{ id = 'C-{0:x6}' -f $n; kind = 'said'; who = 'conductor'; at = $start.AddSeconds($seconds).ToString('o'); text = "Message $n" }
				if ($n -eq 10 -or $n -eq 12) {
					$row.kind = 'asked'; $row.questions = @(@{ text = "Question $n" })
				} elseif ($n -eq 20) { $row.kind = 'message'; $row.who = 'you' }
				ConvertTo-Json -Compress -InputObject $row
			})
			New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
			[IO.File]::WriteAllText($file, ($rows -join "`n") + "`n", $Utf8)
			$steps = @(1..160 | ForEach-Object { ConvertTo-Json -Compress -InputObject @{ at = $start.AddSeconds(75).AddMilliseconds($_).ToString('o'); text = "Step $_" } })
			[IO.File]::WriteAllText($activityFile, ($steps -join "`n") + "`n", $Utf8)
			$at = $start.AddSeconds(121).ToString('o')
			Add-Line $file @{ id = 'C-0000a1'; kind = 'made'; to = 'C-000014'; task = 'T-001'; at = $at }
			Add-Line $file @{ id = 'C-0000a2'; kind = 'answered'; to = 'C-00000c'; answers = @('Yes'); at = $at }
			Add-Line $file @{ id = 'C-0000a3'; kind = 'made'; to = 'C-0000ff'; task = 'T-001'; at = $at }
			$latest = Api $path
			Assert-Equal "$($latest.items.Count) $($latest.items[0].text) $($latest.items[-1].text)" '50 Message 71 Message 120' 'the latest page is bounded and skips orphaned metadata'
			Assert-Equal $latest.steps.Count 150 'steps are bounded too'
			Assert-Equal $latest.steps[0].text 'Step 11' 'the page keeps the most recent steps'
			Assert-Equal "$($latest.decisions[0].q) $($latest.decisions[0].a)" 'Question 12 Yes' 'the feature keeps older decisions available'
			Assert-Equal $latest.why.'C-00000a' 'Message 9' 'an older open question keeps its reason'
			Assert-Equal $latest.whyIds.'C-00000a' 'C-000009' 'the reason names the chat row'
			Assert (Api "$path&stamp=$($latest.stamp)").same 'polling an unchanged history is cheap'

			Add-Line $file @{ id = 'C-000079'; kind = 'said'; who = 'conductor'; at = $at; text = 'Message 121' }
			$older = Api "$path&before=$($latest.before)"
			Assert-Equal "$($older.items.Count) $($older.items[0].text) $($older.items[-1].text)" '50 Message 21 Message 70' 'an append cannot move an older page boundary'
			$first = Api "$path&before=$($older.before)"
			Assert (-not $first.before) 'the oldest page has no cursor'
			Assert-Equal @($first.items | Where-Object kind -eq 'made').Count 1 'an older message keeps the card made from it later'
			Assert-Equal @($first.items | Where-Object kind -eq 'answered').Count 1 'an older question keeps its answer'
			Assert-Equal (Api $path).items[-1].text 'Message 121' 'new messages still arrive in the latest page'
			Edit-Lines $file { param($lines) $lines | Select-Object -Skip 1 }
			Assert-Equal (Api "$path&before=$($latest.before)").items[-1].text 'Message 70' 'a trim keeps the boundary between messages with the same time'
			Assert-Throws { Api "$path&before=broken" } '^HTTP 400:' 'an invalid cursor gets a client error'
		} finally { Use-Thread '' }
	}

	Stop-Server
	Write-Host 'Pieces'

	Test 'Codex plan limits use the account bucket and each window duration' {
		$soon = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 3600
		$weekly = @{ usedPercent = 7; windowDurationMins = 10080; resetsAt = $soon }
		$daily = @{ usedPercent = 23; windowDurationMins = 1440; resetsAt = $soon }
		$five = @{ usedPercent = 52; windowDurationMins = 300; resetsAt = $soon }
		$result = @{
			rateLimits = @{ limitId = 'codex'; primary = $five; secondary = $daily }
			rateLimitsByLimitId = @{
				codex = @{ limitId = 'codex'; primary = $weekly; secondary = $null }
				other = @{ limitId = 'other'; primary = $five; secondary = $null }
			}
		}
		$l = ConvertFrom-CodexLimits (ConvertTo-Json -InputObject $result -Depth 6 | ConvertFrom-Json)
		Assert-Equal "$($l.agent) $($null -eq $l.five) $($l.week.used) $(@($l.other).Count)" 'codex True 7 0' 'the weekly primary window comes from the Codex account bucket'
		Assert-Equal $l.week.resets $soon 'keeps the reset time'

		$result.Remove('rateLimitsByLimitId')
		$l = ConvertFrom-CodexLimits (ConvertTo-Json -InputObject $result -Depth 6 | ConvertFrom-Json)
		Assert-Equal "$($l.five.used) $($null -eq $l.week) $($l.other[0].used) $($l.other[0].minutes)" '52 True 23 1440' 'an older response keeps both its standard and custom windows'
	}

	Test 'Codex conductors and leads start with their own permissions, and the Stop hook where there is one' {
		$settings = Read-RoccoSettings
		$launch = @{}
		function Find-AgentExe([string]$id) { "C:\fake\$id.exe" }
		function Get-CodexWatchArguments { if ($launch.hookAvailable) { '-c', 'fake-stop-hook' } }
		function Start-Process {
			$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ROCCO_START)) | ConvertFrom-Json
			$launch.arguments = $data.arguments -join '|'
			$launch.set = $data.set
			[pscustomobject]@{ Id = 0 }
		}
		function Save-Conductor {}
		function Add-Event {}
		try {
			Set-Agent 'codex' | Out-Null
			Open-Conductor 'Watch the board' | Out-Null
			Assert ($launch.arguments -notmatch '--sandbox|--ask-for-approval|--approve-for-me|danger-full-access') 'the conductor starts with the user''s own Codex permissions'
			Assert-Match $launch.arguments 'write_stdin' 'an unsupported Codex launch asks the agent to poll'
			Use-Thread 'T-900'
			$launch.hookAvailable = $true
			$lane = Join-Path $Game 'lanes\lane1'
			Open-Conductor 'Build this feature' $lane | Out-Null
			Assert-Match $launch.arguments '^-c\|fake-stop-hook\|Build this feature' 'the lead gets the Stop hook before the prompt, and no permission flags'
			Assert-Match $launch.arguments 'Stop hook' 'the prompt tells the lead it can use its hook'
			Assert ($launch.arguments -notmatch 'write_stdin') 'a hooked agent can end its turn'
			Assert-Equal $launch.set.ROCCO_THREAD 'T-900' 'the lead watches its own thread'
			Assert-Equal $launch.set.ROCCO_CODEX_BOARD (Join-Path $App 'rocco.ps1') 'the hook runs this board'
			Assert-Equal $launch.set.ROCCO_CODEX_DIR $lane 'the hook starts from the feature lane'
			Use-Thread ''
			Set-Agent 'gemini' | Out-Null
			Open-Conductor 'Watch the board' | Out-Null
			Assert-Match $launch.arguments '^-i\|Watch the board\b' 'other agents keep their launch arguments'
		} finally {
			Use-Thread ''
			Save-RoccoSettings $settings
		}
	}

	Test 'a lane that went down: its places are looked at, and Fix lanes tells the agent' {
		Use-Project $Game
		$places = Get-OpenPlaces 3
		Assert $places.known 'the game has a code, so its places can be looked for'
		Assert-Equal @($places.open).Count 0 'none of the test game''s places is open in Studio'
		# Opening the lanes for real would start Lync and Studio: a stand-in records that it was asked.
		$script:asked = 0
		function Start-OpenLanes { $script:asked++; [pscustomobject]@{ job = 'stub' } }
		Use-Thread ''
		$r = Repair-Lanes @([pscustomobject]@{ lane = 2; what = @('studio') })
		Assert-Equal $r.job 'stub' 'what went down is opened again'
		Assert-Equal $script:asked 1 'by opening the lanes'
		# Told in the thread whose agent has work in that lane: the feature's, when one is built there, else the conductor's.
		$lead = Get-Tasks | Where-Object { $_.lead -and [int]$_.lane -eq 2 -and $_.status -notin 'done', 'removed' } | Select-Object -First 1
		Use-Thread $(if ($lead) { "$($lead.id)" } else { '' })
		$told = @(Get-Thread | Where-Object { $_.kind -eq 'message' -and $_.who -eq 'rocco' -and $_.via -eq 'lanes' }) | Select-Object -Last 1
		Assert-Match $told.line '^Lane 2: its Studio place had closed' 'the chat says which lane, and what'
		Assert-Match $told.text 'lane 2 went down' 'and the conductor is told'
		Assert (@((Get-ThreadState).pending | Where-Object { $_.id -eq $told.id }).Count -eq 1) 'as something waiting on it'
		Assert-Match ((Show-ThreadItem $told.id) -join "`n") 'message from Rocco itself' 'not as the user''s words'
		Use-Thread ''
		$r = Repair-Lanes @([pscustomobject]@{ lane = 3; what = @('agent') })
		Assert-Equal "$($r.job)" '' 'an agent that stopped needs no lanes opened'
		Assert-Equal $script:asked 1 'so they aren''t'
	}

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

	Test 'the watch prompt keeps a Codex turn open to receive answers' {
		function Get-Agent { @{ id = 'codex' } }
		Use-Thread ''
		$watch = Get-WatchText
		Assert-Match $watch '\.\.\\\.\.\\_tools\\rocco\\rocco\.ps1 wait -Timeout 540 with exec_command' 'the conductor watches from the game repo'
		Assert-Match $watch 'poll it with write_stdin until the command exits\. Keep the turn open' 'Codex collects the result inside the turn'
		Assert-Match $watch 'start the next wait, including after a timeout' 'the wait is started again'
		Use-Thread 'T-001'
		try {
			$watch = Get-WatchText
			Assert-Match $watch '\.\.\\\.\.\\\.\.\\_tools\\rocco\\rocco\.ps1 wait -Timeout 540' 'the feature agent watches from its lane'
			Assert-Match $watch 'poll it with write_stdin until the command exits' 'the feature agent collects the result too'
		} finally { Use-Thread '' }
		Assert-Match (Get-WaitCommand) 'run_in_background, with no -Timeout' 'the Claude Code stop hook still starts a background wait'
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
		Assert-Equal @($s.hooks.Notification[0].hooks).Count 1 'a dialog in its own window is passed on'
		Assert-Equal @($s.hooks.Stop[0].hooks)[1].type 'command' 'the check that can send it back is a command'
		Assert ($null -ne $s.hooks.SubagentStop) 'a worker ending is passed on'
		Assert-Match $s.statusLine.command '^curl\.exe .*-H "X-Rocco: 1".*"@-" http://localhost:\d+/api/limits$' 'its status line posts the plan''s limits'
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

	Write-Host 'Shared lanes'

	# A game whose agents borrow lanes: its LANES.md says so, and it syncs a folder, so a lane has a fingerprint. Lanes
	# 4 and 5 are real checkouts, "served" (something listens on their Lync ports) and "open in Studio" (their places'
	# locks are held): all Rocco looks at before it lends one. Lanes 1 to 3 are bare folders, which it never lends.
	$script:LoanFixtures = @()
	function Start-LoanGame {
		if ($script:LoanFixtures.Count) { return }
		[IO.File]::WriteAllText((Join-Path $Repo 'docs\workflow\LANES.md'), "# Lanes`n`n## Lending a lane`n`nThe template's.`n", $Utf8)
		[IO.File]::WriteAllText((Join-Path $Repo 'default.project.json'), '{ "name": "Game", "port": 34900, "tree": { "ServerStorage": { "$path": "src/ServerStorage" } } }', $Utf8)
		New-Item -ItemType Directory -Force (Join-Path $Repo 'src\ServerStorage\Kit'), (Join-Path $Game 'places') | Out-Null
		[IO.File]::WriteAllText((Join-Path $Repo 'src\ServerStorage\Kit\init.luau'), "return {}`n", $Utf8)
		[IO.File]::WriteAllText((Join-Path $Repo 'src\ServerStorage\Kit\Part.luau'), "return 1`n", $Utf8)
		[IO.File]::WriteAllText((Join-Path $Repo 'src\ServerStorage\Plain.luau'), "return 0`r`n", $Utf8)
		RepoGit add -A; RepoGit commit --quiet -m 'Lanes are lent, and a folder is synced'
		foreach ($n in 4, 5) {
			RepoGit worktree add --detach (Join-Path $Game "lanes\lane$n") main | Out-Null
			$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, (34900 + $n)); $listener.Start()
			$lock = [IO.File]::Open((Join-Path $Game "places\TG-Lane$n.rbxl.lock"), 'OpenOrCreate', 'ReadWrite', 'None')
			$script:LoanFixtures += $listener, $lock
		}
	}
	function WorkGit([string]$dir) { $ErrorActionPreference = 'Continue'; git.exe -C $dir @args 2>$null }
	function WorkCommit([string]$dir, [string]$message) { WorkGit $dir add -A; WorkGit $dir commit --quiet -m $message }
	# A task at work in a checkout of its own.
	function New-LoanTask([string]$title, [string]$branch) {
		$id = @(Rocco new -Title $title)[-1]
		Rocco work $id -Branch $branch | Out-Null
		Rocco set $id -Status working -Step Coding | Out-Null
		$id
	}

	Test 'a task gets a checkout of its own' {
		Start-LoanGame
		$id = @(Rocco new -Title 'Borrowed lane')[-1]
		$said = (Rocco work $id -Branch agent/loan-a) -join "`n"
		$dir = Join-Path $Game 'work\agent-loan-a'
		Assert (Test-Path (Join-Path $dir 'src\ServerStorage\Kit\init.luau')) 'its checkout is there, with the game in it'
		Assert-Match $said ([regex]::Escape($dir)) 'work says where it is'
		Assert-Equal (WorkGit $dir symbolic-ref --short HEAD) 'agent/loan-a' 'on its branch'
		$t = Read-TaskJson $id
		Assert-Equal $t.work 'agent-loan-a' 'the task knows its checkout'
		Assert-Equal $t.branch 'agent/loan-a' 'and its branch'
		Rocco work $id -Branch agent/loan-a | Out-Null
		Assert-Throws { Rocco work $id -Branch 'agent//x' } "isn't a branch name" 'a name git would misread'
		Assert-Throws { Rocco borrow $id } 'being worked on' 'a lane is lent to a task at work'
		$script:LoanA = $id
	}

	Test 'a lane is lent by commit, says what to check, and is returned' {
		Start-LoanGame
		$id = $script:LoanA
		$dir = Join-Path $Game 'work\agent-loan-a'
		Rocco set $id -Status working -Step Coding | Out-Null
		# The task deletes a folder that is itself a script: what a plain switch would leave behind in the place.
		Remove-Item -LiteralPath (Join-Path $dir 'src\ServerStorage\Kit') -Recurse -Force
		[IO.File]::WriteAllText((Join-Path $dir 'src\ServerStorage\New.luau'), "return 2`n", $Utf8)
		WorkCommit $dir 'Drop the kit'
		[IO.File]::WriteAllText((Join-Path $dir 'src\ServerStorage\Loose.luau'), "return 3`n", $Utf8)
		$said = (Rocco borrow $id) -join "`n"
		$t = Read-TaskJson $id
		Assert ([int]$t.lane -in 4, 5) "it has a lane that can be lent (lane $($t.lane))"
		Assert-Equal $t.laneFor 'agent' 'for its agent'
		$lane = Join-Path $Game "lanes\lane$($t.lane)"
		Assert-Equal (WorkGit $lane rev-parse HEAD) (WorkGit $dir rev-parse HEAD) 'the lane is on the checkout''s commit'
		Assert (-not (Test-Path (Join-Path $lane 'src\ServerStorage\Kit'))) 'the folder is gone from the lane'
		Assert-Equal "$(WorkGit $lane status --porcelain)" '' 'and the lane is clean'
		Assert-Match $said "TG-Lane$($t.lane)" 'borrow names the place'
		Assert-Match $said 'scripts=2 digest=\d+' 'and what the place should hold'
		Assert-Match $said 'Not in the lane: 1 file' 'and what isn''t committed'
		Assert-Match ([IO.File]::ReadAllText((Join-Path $Game 'rocco\lane-check.luau'), $Utf8)) 'add\("ServerStorage"\)' 'the checker looks where this game syncs'
		Use-Project $Game
		Assert-Match $said ([regex]::Escape((Get-SourceFingerprint $lane))) 'which is the lane''s own fingerprint'
		# Line ends don't count (Studio keeps one kind): repo\ wrote Plain.luau with CRLF, and git may check it out either way.
		$other = Join-Path $Game "lanes\lane$(9 - [int]$t.lane)"
		Assert-Equal (Get-SourceFingerprint $other) (Get-SourceFingerprint $Repo) 'the lane still on main matches repo\, whatever its line ends'
		Assert ((Get-SourceFingerprint $lane) -ne (Get-SourceFingerprint $Repo)) 'and a fingerprint differs when the scripts do'
		WorkCommit $dir 'The loose one'
		Assert-Match ((Rocco sync $id) -join "`n") 'scripts=3' 'sync brings the new commit'
		Assert-Equal (WorkGit $lane rev-parse HEAD) (WorkGit $dir rev-parse HEAD) 'the lane follows'
		Assert-Match ((Rocco return $id) -join ' ') 'returned lane' 'return says so'
		Assert (-not (Read-TaskJson $id).lane) 'the lane is free again'
		Assert-Throws { Rocco sync $id } 'no lane just now' 'sync needs a loan'
	}

	Test 'the user tests in a lane, which gives way to work that waits' {
		Start-LoanGame
		$a = $script:LoanA
		Rocco borrow $a | Out-Null
		$said = (Rocco set $a -Status ready -Where lane -Summary 'The kit is gone.' -Test 'Look for it') -join "`n"
		$ta = Read-TaskJson $a
		Assert ([int]$ta.lane -in 4, 5) 'ready in a lane keeps the lane its agent tested in'
		Assert-Equal $ta.laneFor 'user' 'for the user now'
		Assert-Match $said "tests it in lane $($ta.lane)" 'set says where they test'
		$b = New-LoanTask 'Second borrower' 'agent/loan-b'
		[IO.File]::WriteAllText((Join-Path $Game 'work\agent-loan-b\src\ServerStorage\Second.luau'), "return 'b'`n", $Utf8)
		WorkCommit (Join-Path $Game 'work\agent-loan-b') 'The second'
		Rocco borrow $b | Out-Null
		$tb = Read-TaskJson $b
		Assert ([int]$tb.lane -in 4, 5 -and [int]$tb.lane -ne [int]$ta.lane) 'the next task gets the other lane'
		# Every lane taken, one of them by the user's testing: that one gives way.
		$c = New-LoanTask 'Third borrower' 'agent/loan-c'
		Rocco borrow $c | Out-Null
		Assert-Equal (Read-TaskJson $c).lane $ta.lane 'work that waits takes the lane the user''s testing held'
		$ta = Read-TaskJson $a
		Assert (-not $ta.lane) 'which leaves that card without one'
		Assert-Match (@($ta.log)[-1].text) 'Load into a lane' 'and says so on it'
		Assert-Match ((Rocco show $a) -join "`n") 'no lane holding it' 'show says it waits for one'
		Assert-Match ((Rocco borrow $a -User) -join ' ') 'Load into a lane' 'the user''s own loan takes no one''s lane'
		# Every lane taken by agents: the next one waits its turn, and keeps its place.
		$d = New-LoanTask 'Fourth borrower' 'agent/loan-d'
		Assert-Throws { Rocco borrow $d -Timeout 1 } 'kept its place in line' 'with every lane at work'
		Rocco return $c | Out-Null
		Rocco borrow $a -User | Out-Null
		$ta = Read-TaskJson $a
		Assert ([int]$ta.lane -in 4, 5) 'a lane came free, and the card is loaded into it'
		# A lane kept for the user's testing isn't taken.
		$settings = Read-RoccoSettings
		try {
			$kept = Read-RoccoSettings; Set-Field $kept 'keepLane' $true; Save-RoccoSettings $kept
			Assert-Throws { Rocco borrow $c -Timeout 1 } 'kept its place in line' 'the user keeps a lane'
		} finally { Save-RoccoSettings $settings }
		# Approved: it holds its lane while its merge is checked, and lets go, checkout and all, once that's cleared.
		Use-Project $Game
		Invoke-TaskAction $a 'approve' ''
		$ta = Read-TaskJson $a
		Assert-Equal $ta.pending 'merge' 'approved in its lane, it waits on its merge'
		Assert ([int]$ta.lane -in 4, 5) 'still holding the lane'
		$said = (Rocco clear $a) -join "`n"
		$ta = Read-TaskJson $a
		Assert (-not $ta.lane) 'merged and cleared, the lane is free'
		Assert-Match $said 'agent-loan-a is gone' 'clear says its checkout went'
		Assert (-not (Test-Path (Join-Path $Game 'work\agent-loan-a'))) 'and it did'
		Assert ("$(RepoGit rev-parse --verify -q refs/heads/agent/loan-a)" -ne '') 'its branch stays for the conductor'
		# Sent back: the lane goes back by itself.
		Rocco set $b -Status ready -Where lane -Summary 'The second.' -Test 'Try it' | Out-Null
		Assert ([int](Read-TaskJson $b).lane -gt 0) 'ready in its lane'
		Invoke-TaskAction $b 'reopen' 'not yet'
		Assert (-not (Read-TaskJson $b).lane) 'sent back, it holds no lane'
		$script:LoanC = $c
		$script:LoanD = $d
	}

	Test 'only so many agents work at once' {
		Start-LoanGame
		Use-Project $Game
		$settings = Read-RoccoSettings
		try {
			$atWork = Get-AgentsAtWork @(Get-Tasks)
			Assert ($atWork -gt 0) 'some are at work'
			$limited = Read-RoccoSettings; Set-Field $limited 'agentsAtOnce' $atWork; Save-RoccoSettings $limited
			$e = @(Rocco new -Title 'One too many')[-1]
			Assert-Throws { Rocco work $e -Branch agent/loan-e } "this PC's limit" 'a checkout past the limit'
			Rocco set $e -ForLane | Out-Null
			Assert (((Rocco list -Pending) -join "`n") -notmatch [regex]::Escape($e)) 'parked, it waits on nobody'
			Assert-Match ((Rocco show $e) -join "`n") 'As many agents are at work' 'show says why it waits'
			Rocco set $script:LoanD -Status queued | Out-Null
			Assert-Match ((Rocco list -Pending) -join "`n") "$e\s.*\[lane\].*an agent is free" 'one finishes, and it is handed back'
		} finally { Save-RoccoSettings $settings }
	}

	Test 'merged and in Main to try, a card lets its checkout go' {
		Start-LoanGame
		$c = $script:LoanC
		$dir = Join-Path $Game 'work\agent-loan-c'
		Assert (Test-Path $dir) 'its checkout is there while it works'
		# Its branch holds nothing main doesn't, which is how a merged one looks.
		$said = (Rocco set $c -Status ready -Where main -Summary 'The third.' -Test 'Try it') -join "`n"
		Assert-Match $said 'agent-loan-c is gone' 'set says its checkout went'
		Assert (-not (Test-Path $dir)) 'and it did'
		Assert-Equal "$((Read-TaskJson $c).work)" '' 'the card no longer names one'
	}

	Test 'a feature''s own agent works in a checkout, and needs no lane' {
		Start-LoanGame
		Use-Project $Game
		$p = New-Task 'Trading Post!' 'Trade cars' 'queued' 'plan' 'feature'
		Set-Field $p 'lead' $true
		Save-Task $p
		try { Use-Thread $p.id; Start-Lead $p.id | Out-Null; $prompt = Get-LeadPrompt (Get-Task $p.id) 0 } finally { Use-Thread ''; Unlock-Tasks }
		$t = Read-TaskJson $p.id
		Assert-Equal $t.branch 'feature/trading-post' 'its branch is named for the feature'
		Assert-Equal $t.work 'feature-trading-post' 'and its checkout for the branch'
		Assert (Test-Path (Join-Path $Game 'work\feature-trading-post\.git')) 'which is made'
		Assert (-not $t.lane) 'it holds no lane'
		Assert-Match $prompt 'checkout of your own \(on feature/trading-post\), borrowing a lane' 'its agent is told how it works'
		# A piece of the feature starts from the feature's branch.
		$piece = @(Rocco new -Title 'Trade window' -Plan $p.id)[-1]
		Rocco work $piece -Branch agent/trade-window -Base feature/trading-post | Out-Null
		$from = WorkGit (Join-Path $Game 'work\agent-trade-window') merge-base HEAD feature/trading-post
		Assert-Equal $from (WorkGit $Repo rev-parse feature/trading-post) 'a piece branches from its feature'
	}

	Test 'lent-lane settings are kept, and checked' {
		Use-Project $Game
		$settings = Read-RoccoSettings
		try {
			$a = Set-LaneSettings ([pscustomobject]@{ agentsAtOnce = 3 })
			Assert-Equal $a.agentsAtOnce 3 'agents at once'
			Assert-Equal (Get-AgentsLimit) 3 'is the limit'
			$a = Set-LaneSettings ([pscustomobject]@{ keepLane = $true })
			Assert ($a.keepLane -and $a.agentsAtOnce -eq 3) 'keeping a lane leaves the other as it was'
			Assert-Throws { Set-LaneSettings ([pscustomobject]@{ agentsAtOnce = 99 }) } 'Agents at once' 'a number out of range'
			Set-LaneSettings ([pscustomobject]@{ agentsAtOnce = 0 }) | Out-Null
			Assert ((Get-AgentsLimit) -gt 3) 'back to two per lane'
		} finally { Save-RoccoSettings $settings }
	}

	Test 'a network git call is given up on' {
		$r = Invoke-GitNet $Repo @('ls-remote', '--heads', 'http://10.255.255.1/nothing.git') 3 $false
		Assert (-not $r.ok) 'it failed'
	}

	Write-Host 'Memory'
	# The app's server again, stopped after The app: these look at it.
	Start-Server

	Test 'Rocco logs its memory each tick, and the heap route says what it holds' {
		$heap = Api '/api/debug/heap'
		Assert ($heap.heldMB -gt 0 -and $heap.roccoMB -ge $heap.heldMB) "it says what it holds ($($heap.heldMB) MB of $($heap.roccoMB) MB)"
		Assert-Equal $heap.limitGB 3 'and its limit, the default'
		$log = Join-Path $env:ROCCO_HOME 'memory.log'
		$line = ''
		for ($i = 0; $i -lt 40 -and -not $line; $i++) {
			Api '/api/state' | Out-Null
			Start-Sleep -Milliseconds 250
			if (Test-Path $log) { $line = "$(@(Get-Content $log | Where-Object { $_ -match 'GET /api/state=' }) | Select-Object -Last 1)" }
		}
		Assert-Match $line '^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d rocco=\d+MB heap=\d+MB pcFree=[\d.]+GB \| .*GET /api/state=\d+' 'a line with its memory and what it was asked'
		$m = (Api '/api/state').memory
		Assert ($m.freeGB -gt 0 -and $m.roccoMB -gt 0 -and $m.floorGB -eq 6) 'the board has the PC''s free memory, for the sidebar'
	}

	Test 'past its limit, Rocco restarts itself, and the next one says why in the chat' {
		$home2 = Join-Path $Temp 'home-memory'
		New-Item -ItemType Directory -Force $home2 | Out-Null
		[IO.File]::WriteAllText((Join-Path $home2 'settings.json'), '{"memoryLimitGB":0.01}', $Utf8)
		$port = & { $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0); $l.Start(); $l.LocalEndpoint.Port; $l.Stop() }
		$serve = '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $App 'rocco.ps1')`"", 'serve', '-Port', $port, '-Project', 'Game'
		# Its own settings (a 10 MB limit), no wait before it may restart, and (ROCCO_NO_RESTART) no new Rocco started.
		$was = $env:ROCCO_HOME
		$env:ROCCO_HOME = $home2; $env:ROCCO_MEMORY_GRACE = '0'; $env:ROCCO_NO_RESTART = '1'
		try { $big = Start-Process powershell -ArgumentList $serve -WindowStyle Hidden -PassThru }
		finally { $env:ROCCO_HOME = $was; Remove-Item Env:ROCCO_MEMORY_GRACE, Env:ROCCO_NO_RESTART -ErrorAction SilentlyContinue }
		try {
			Assert ($big.WaitForExit(40000)) 'it stopped, to restart'
			Assert-Equal $big.ExitCode 3 'as it does to hand over to a new Rocco'
			Assert-Match ((Get-Content (Join-Path $home2 'memory.log')) -join "`n") 'RESTARTING: rocco=\d+MB, past the 0.01 GB limit\. Held after a full collection: \d+MB' 'the log says why, with what it held'
			Assert (Test-Path (Join-Path $home2 'restarted.json')) 'it leaves word for the next Rocco'
		} finally { if (-not $big.HasExited) { & taskkill.exe /T /F /PID $big.Id 2>$null | Out-Null } }
		# The next one, with the limit back to its default, says so in the main chat.
		[IO.File]::WriteAllText((Join-Path $home2 'settings.json'), '{}', $Utf8)
		$env:ROCCO_HOME = $home2
		try { $next = Start-Process powershell -ArgumentList $serve -WindowStyle Hidden -PassThru } finally { $env:ROCCO_HOME = $was }
		try {
			$said = $null
			for ($i = 0; $i -lt 60 -and -not $said; $i++) {
				Start-Sleep -Milliseconds 300
				$said = @((Api '/api/conductor/thread').items | Where-Object { "$($_.text)" -match 'Rocco restarted itself to free memory: it had grown to [\d.]+ GB, past its 0.01 GB limit' }) | Select-Object -First 1
			}
			Assert ([bool]$said) 'the main chat says it restarted to free memory'
			Assert (-not (Test-Path (Join-Path $home2 'restarted.json'))) 'once'
		} finally { if (-not $next.HasExited) { & taskkill.exe /T /F /PID $next.Id 2>$null | Out-Null } }
	}

	Test 'a conductor stopping is asked to watch the board again, even after a watch stopped for memory' {
		$in = Join-Path $Temp 'stop-in.json'; $out = Join-Path $Temp 'stop-out.json'
		[IO.File]::WriteAllText($in, '{"session_id":"s","stop_hook_active":false}', $Utf8)
		$p = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $App 'rocco.ps1')`"", 'hook', 'stop', '-Project', 'Game' -WindowStyle Hidden -PassThru -RedirectStandardInput $in -RedirectStandardOutput $out
		Assert ($p.WaitForExit(60000)) 'the hook answers'
		$said = [IO.File]::ReadAllText($out, $Utf8) | ConvertFrom-Json
		Assert-Equal $said.decision 'block' 'it keeps the turn going'
		Assert-Match $said.reason 'stopped because the PC ran low on memory, start it again anyway: Rocco asks you to' 'and asks for the watch again'
		Assert-Match $said.reason 'This PC has [\d.]+ GB free now' 'saying how much memory is free'
		Remove-Item (Join-Path $Game 'rocco\conductor\stop-check.json') -ErrorAction SilentlyContinue
	}

	Test 'short of memory, no new agent starts, and a parked card says why' {
		Start-LoanGame
		Use-Project $Game
		$env:ROCCO_TEST_FREE_GB = '2'
		try {
			$id = @(Rocco new -Title 'Short of memory')[-1]
			Assert-Throws { Rocco work $id -Branch agent/short-memory } 'only 2 GB of memory free, under 6 GB, so no new agent starts' 'no new checkout'
			Rocco set $id -ForLane | Out-Null
			Assert-Equal (Read-TaskJson $id).waiting 'More free memory on this PC' 'the card says what it waits for'
			Assert (((Rocco list -Pending) -join "`n") -notmatch "$id\s.*\[lane\]") 'it isn''t handed back'
			Assert-Match ((Rocco show $id) -join "`n") 'only 2 GB of memory free' 'show says why'
		} finally { Remove-Item Env:ROCCO_TEST_FREE_GB -ErrorAction SilentlyContinue }
		if ((Get-AgentsAtWork @(Get-Tasks)) -lt (Get-AgentsLimit)) {
			Assert-Match ((Rocco list -Pending) -join "`n") "$id\s.*\[lane\]" 'with memory back, it is handed back'
		}
		Rocco set $id -Status removed | Out-Null
	}

	Test 'Restart Rocco above is kept, and checked' {
		Use-Project $Game
		$settings = Read-RoccoSettings
		try {
			Assert-Equal (Get-MemoryLimit) 3 'the default'
			$a = Set-LaneSettings ([pscustomobject]@{ memoryLimitGB = 6 })
			Assert-Equal $a.memoryLimitGB 6 'kept'
			Assert-Equal (Get-MemoryLimit) 6 'and used'
			Assert-Throws { Set-LaneSettings ([pscustomobject]@{ memoryLimitGB = 5 }) } 'Restart Rocco above' 'a size it doesn''t offer'
		} finally { Save-RoccoSettings $settings }
	}

	Test 'Connections, Docs and History leave what Rocco holds flat' {
		foreach ($route in '/api/connections', '/api/docs', '/api/history') { Api $route | Out-Null }
		$before = (Api '/api/debug/heap').heldMB
		for ($i = 0; $i -lt 100; $i++) { foreach ($route in '/api/connections', '/api/docs', '/api/history') { Api $route | Out-Null } }
		$heap = Api '/api/debug/heap'
		Assert (($heap.heldMB - $before) -lt 10) "held $before MB before, $($heap.heldMB) MB after 100 of each"
		Assert ($heap.errors -lt 5) "and keeps no errors ($($heap.errors))"
	}
} finally {
	Stop-Server
	# The stand-ins for a lane's Lync and its open place.
	foreach ($f in $script:LoanFixtures) { try { if ($f -is [Net.Sockets.TcpListener]) { $f.Stop() } else { $f.Close() } } catch { } }
	Remove-Item Env:ROCCO_HOME, Env:ROCCO_NO_CONDUCTOR, Env:ROCCO_MEMORY_TICK, Env:ROCCO_TEST_FREE_GB -ErrorAction SilentlyContinue
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
