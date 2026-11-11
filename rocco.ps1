# Rocco (README.md): serves the app for every project in this RoDev folder, and gives the agent the commands that
# keep a project's Workboard current. Installed once, in <RoDev>\_tools\rocco. Tasks live outside git, in
# <Game>\rocco\tasks\T-NNN\. Commands act on the project the current folder is in (a game's repo\ or a lane), or on
# -Project <folder name>; from a game's repo\, run them as ..\..\_tools\rocco\rocco.ps1.
#
#   rocco.ps1 start [-Project Game]    serve Rocco in the background, with no window (Rocco.bat), and open that project
#   rocco.ps1 [serve] [-Open] [-Project Game]   serve Rocco on http://localhost:34860/ in this window (opening that project)
#   rocco.ps1 list [-Pending]          this project's open tasks; -Pending: only what waits on the conductor
#   rocco.ps1 show T-012               one task in full: note, screenshots, questions, follow-ups, history
#   rocco.ps1 new -Title "..." [-Type bug] [-Plan T-020] [-After T-011,T-012]   add a task to Up next; prints its id.
#                                      -Plan: a step of that feature plan (plans are never worked as cards)
#   rocco.ps1 suggest -Title "..." [-Summary "why"]   put something you spotted in the inbox, for the user to queue or dismiss
#   rocco.ps1 plan -Title "..." -Summary "..." -Steps "Trade window UI|4|standard","Trade service|6|heavy" [-Spec docs/game/features/trading.md]
#                                      a feature plan for the user to approve; prints its id. -Spec: the feature's spec,
#                                      which the card links (set -Spec changes it)
#   rocco.ps1 ask T-012 -Question "..." -Options "A","B" [-Audio a.ogg,b.ogg]   ask the user (the task turns Stuck).
#                                      Options are a few words each; the detail goes in the question
#                                      [-Images a.png,b.png] one picture per option, to pick from (concepts);
#                                      [-Show front.png,side.png] pictures for the question itself (a model to approve).
#                                      An image path, or a folder and file names, in the question show by themselves
#   rocco.ps1 ask -Question "..." [-Options "A","B"] [-Images ...] [-Show ...]   with no task: the conductor asks the
#                                      user, above their note box; wait returns the answer ([answer] C-xxxxxx)
#   rocco.ps1 doing "Merging the trade window"   what the conductor is doing now: Rocco's status line
#   rocco.ps1 say -Text "..."          a message to the user (a report, anything you'd tell them): Rocco's history
#   rocco.ps1 reply T-012 -Text "..."   answer the user: a question card shows it under the note box (and turns
#                                      answered); on any other card it goes in the card's session, which stays put
#   rocco.ps1 set T-012 -Status working -Lane 3 -Step "Coding" [-Progress 40] [-Branch agent/x]
#   rocco.ps1 set T-012 -Status ready -Where main -Summary "what changed" -Test "Drive a lap","Drift the hairpin"
#                                      what a card shows has to fit it: a title is 50 characters at most (one line), a
#                                      task's summary and its test (the steps to try) 30 words each. The detail goes in log
#   rocco.ps1 set T-020 -Summary "..." -Steps "...|4|standard"   a revised feature plan: new summary and steps
#   rocco.ps1 set T-012 -ForLane       every lane is busy: it waits in Up next, and wait hands it back ([lane]) the
#                                      moment one is free. new takes -ForLane too. Starting it ends the wait
#   rocco.ps1 result T-012 -Pass|-Fail -Text "12 of 12 tests pass" [-File console.txt]   what the worker ran and how it
#                                      went, on the card: the line, and the output (the tests' report, Studio's console)
#   rocco.ps1 log T-012 -Text "..." [-Who conductor]
#   rocco.ps1 clear T-012              what the user asked of it (plan, answer, reopen, merge, cancel, follow-ups) is handled
#   rocco.ps1 show C-1a2b3c / clear C-1a2b3c   a message or answer the user sent the conductor; clear: it's read
#   rocco.ps1 wait [-Timeout 540]      the conductor watching the board: returns when something waits on it (as list
#                                      -Pending), or after -Timeout seconds. Rocco shows it listening meanwhile
#   rocco.ps1 hook permission|question|stop   Claude Code's hooks, for a conductor Rocco opened (server\conductor.ps1).
#                                      stop: it can't end a turn while something waits on it, or with no wait running
#   rocco.ps1 lanes [-Count 3]         open this PC's lanes: makes any missing lane, the Main and lane places, starts
#                                      Lync for each (no window) and opens them in Studio. -Count: record this PC's number first
param(
	[Parameter(Position = 0)] [string]$Command = 'serve',
	[Parameter(Position = 1)] [string]$Id,
	[string]$Title, [string]$Note, [string]$Status, [int]$Lane = -1, [string]$Branch, [string]$Where,
	[string]$Step, [string]$Summary, [string[]]$Test, [string]$Question, [string[]]$Options, [string[]]$Audio, [string[]]$Images, [string[]]$Show, [string]$Waiting,
	[string]$Type, [int]$Progress = -1, [string[]]$After, [int]$Order = -1, [string]$Plan, [string[]]$Steps,
	[string]$Who = 'worker', [string]$Text, [switch]$Feature, [switch]$Pending, [switch]$Open, [switch]$ForLane, [int]$Port = 34860,
	[string]$Project, [string]$Spec, [int]$Timeout = 0, [int]$Count = -1,
	[switch]$Pass, [switch]$Fail, [string]$File,
	[Alias('Thread')] [string]$ThreadId, # -Thread T-020: the thread a command is about, a feature's (or a card's) with an agent of its own (LEAD.md)
	[switch]$Answer,  # reply: the note was only a question, and this answers it (no card is kept)
	[switch]$Restart # started by a Rocco that just updated itself: wait for its port, and don't open another tab
)
$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot
# Kept before the parts load: they keep the thread in use under the same name (core.ps1 Use-Thread), and start with none.
$named = $ThreadId
# An agent's command loads only what the board needs: it runs many of these, and each starts PowerShell afresh.
$parts = if ($Command -in 'serve', 'start', 'lanes') { 'core', 'agents', 'tasks', 'thread', 'sessions', 'projects', 'conductor', 'leads', 'lanes', 'connections', 'history', 'docs', 'actions', 'accounts', 'onboarding', 'roblox', 'updates', 'thumbnails', 'http' }
	else { 'core', 'agents', 'tasks', 'thread', 'sessions', 'projects', 'conductor', 'leads', 'lanes' }
foreach ($part in $parts) { . (Join-Path $AppDir "server\$part.ps1") }

# A feature's own agent runs in a window that names its thread (ROCCO_THREAD, conductor.ps1 Open-Conductor), so
# every command it runs is about that thread without saying so: its wait, its messages, its questions. The server
# is about every thread, and takes each request's.
if (-not $named -and $env:ROCCO_THREAD -and $Command -notin 'serve', 'start') { $named = $env:ROCCO_THREAD }
if ($named) { Use-Thread $named }

# A list given as "a","b" arrives as one string, a,b, when the command is run through powershell -File (an agent in a
# bash shell): -File hands every argument over as plain text. So a single item with a comma in it is taken as the list
# it was meant to be. From PowerShell itself lists arrive whole, and this changes nothing.
$ViaFile = $false
$started = [Environment]::GetCommandLineArgs()
for ($i = 0; $i -lt $started.Count - 1; $i++) { if ($started[$i] -match '^-(f|fi|fil|file)$' -and $started[$i + 1] -match 'rocco\.ps1$') { $ViaFile = $true } }
$script:SplitNote = @()
function Split-FileList([string]$name, [string[]]$value) {
	if (-not $ViaFile -or @($value).Count -ne 1 -or "$($value[0])" -notmatch ',') { return $value }
	$items = @("$($value[0])" -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
	$script:SplitNote += "-$name was read as $($items.Count) items, split at its commas (powershell -File passes a list as one string). For an item with a comma in it, run the command from PowerShell."
	$items
}
foreach ($name in 'Test', 'Options', 'Steps', 'Audio', 'Images', 'Show') {
	if ($PSBoundParameters.ContainsKey($name)) {
		$split = @(Split-FileList $name (Get-Variable $name -ValueOnly))
		Set-Variable $name $split
		$PSBoundParameters[$name] = $split
	}
}

function Format-Time($iso) { if ($iso) { ([datetime]$iso).ToString('HH:mm') } else { '' } }

# Tasks as list shows them, in Up next order.
function Format-Tasks($rows) {
	foreach ($t in $rows | Sort-Object { if ($_.status -eq 'queued' -and $_.order) { [int]$_.order } else { 9999 } }, id) {
		$laneText = if ($t.lane) { "L$($t.lane)" } else { '-' }
		$wants = if ($t.pending) { "[$($t.pending)]" } else { '' }
		$extra = @()
		if ($t.kind -eq 'plan') { $extra += 'PLAN' }
		if ($t.held) { $extra += $(if ($t.pending -eq 'stop') { 'the user paused it: stop its worker' } else { 'paused by the user: leave it until they resume it' }) }
		if ($t.wantLane -or $t.wantTier) { $extra += "the user wants $(Format-Wanted $t)" }
		if ($t.pending -eq 'lane') { $extra += "lane $($t.freeLane) is free: set $($t.id) -Status working -Lane $($t.freeLane)" }
		elseif (Test-WaitsForLane $t) { $extra += 'waiting for a free lane' }
		if ($t.kind -eq 'question') { $extra += 'QUESTION: answer with reply' }
		if ($t.plan) { $extra += "in $($t.plan)" }
		if (@(Get-List $t.after).Count) { $extra += "after $((Get-List $t.after) -join ',')" }
		'{0,-6} {1,-8} {2,-4} {3,-10} {4}{5}' -f $t.id, $t.status, $laneText, $wants, $t.title, $(if ($extra) { "  ($($extra -join '; '))" })
	}
}

# The lane and worker the user picked for a task, in words.
function Format-Wanted($t) { (@($(if ($t.wantLane) { "lane $($t.wantLane)" }), $(if ($t.wantTier) { "the $($t.wantTier) worker" })) | Where-Object { $_ }) -join ', ' }

# What waits on the conductor: what the user asked of a task, until it's handled. Nothing the user can still take back
# is handed over: an approval (which merges a branch), an answer, a queued suggestion and a delete each wait out the
# app's Undo first. A deleted task waits only to be stopped (cancel). A task the user paused waits on nobody, apart
# from having its worker stopped.
function Get-PendingTasks {
	$undoGone = (Get-Date).AddSeconds(-$UndoSeconds)
	$tasks = @(Get-Tasks)
	$byId = @{}; foreach ($x in $tasks) { $byId[$x.id] = $x }
	@($tasks | Where-Object {
		$_.pending -and
		(-not $_.undo -or -not $_.undo.at -or [datetime]$_.undo.at -lt $undoGone) -and
		($_.status -ne 'removed' -or $_.pending -eq 'cancel') -and
		(-not $_.held -or $_.pending -eq 'stop') -and
		# Each agent hears only of its own: a feature's agent of its feature's tasks, the conductor of the rest
		# (leads.ps1 Get-TaskOwner).
		(Get-TaskOwner $_ $byId) -eq $script:ThreadId
	})
	# A task parked for a lane (set -ForLane), once one is free: the conductor's.
	if (-not $script:ThreadId) { Get-LaneReady $tasks }
}

# Everything that waits on the conductor, as list -Pending and wait print it: tasks, then what the user sent it.
function Write-Pending($rows, $thread) {
	if (@($rows).Count) { Format-Tasks $rows }
	foreach ($e in $thread.pending) { Format-ThreadItem $e $thread }
}
# The conductor ending a turn (Claude Code's Stop hook, for a conductor Rocco opened): not while something waits on it,
# and not with nothing watching the board, or the user's next note sits unseen until they prompt it. Says what to do
# instead ({"decision":"block"}). After three goes in a row it lets the turn end, and tells the user.
function Test-ConductorStop($in) {
	$state = Join-Path (Get-ThreadDir) 'stop-check.json'
	$tries = 0
	if ($in.stop_hook_active -and (Test-Path $state)) { try { $tries = [int]([IO.File]::ReadAllText($state, $Utf8) | ConvertFrom-Json).tries } catch { } }
	$rows = @(Get-PendingTasks)
	$thread = Get-ThreadState
	$reason = if ($rows.Count -or $thread.pending.Count) {
		"Before you stop, handle what waits on you, as $(if ($script:ThreadId) { 'LEAD.md' } else { 'CONDUCTOR.md "What waits on you"' }) says:`n$((Write-Pending $rows $thread) -join "`n")`nThen, if nothing is watching for what the user sends, start $(Get-WaitCommand)."
	} elseif (-not (Wait-ForWatch 20)) {
		"Before you stop: nothing is watching for what the user sends, so their next note, answer or send-back would sit unseen until they prompt you. Start $(Get-WaitCommand)."
	} else { '' }
	if (-not $reason -or $tries -ge 3) {
		if ($reason) { Add-Event "The conductor stopped $(if ($rows.Count -or $thread.pending.Count) { 'with work still waiting on it' } else { 'with nothing watching the board' }): type anything in its window to wake it" }
		Remove-Item $state -ErrorAction SilentlyContinue
		return ''
	}
	New-Item -ItemType Directory -Force (Split-Path $state) | Out-Null
	[IO.File]::WriteAllText($state, (ConvertTo-Json -InputObject @{ tries = $tries + 1; at = (Now) }), $Utf8)
	ConvertTo-Json -Compress -InputObject ([ordered]@{ decision = 'block'; reason = $reason })
}

$PendingHead = 'Waiting on you. Show each, then handle it as CONDUCTOR.md "The Workboard" says: a note you take on gets set -Title "<a few words>" -Status working first, so it leaves Up next. Clear a C- message or answer once you''ve acted on it:'

# The text of doing and say: -Text, or the first word after the command.
function Get-Words { if ($Text) { $Text } else { $Id } }

# A plan's steps from "title|lane|tier" strings.
function ConvertTo-Steps([string[]]$steps) {
	@($steps | ForEach-Object {
		$f = $_ -split '\|'
		[pscustomobject]@{ title = $f[0].Trim(); lane = $(if ($f.Count -gt 1 -and $f[1].Trim() -match '^\d+$') { [int]$f[1] } else { $null }); tier = $(if ($f.Count -gt 2) { $f[2].Trim() } else { '' }) }
	})
}

# What a card shows has to fit it, so it's checked before anything changes: a title on one line, and (for a task, not
# a feature plan or a setup card) a summary and a test the hover shows whole. The rest has its own place.
function Assert-CardText([bool]$words) {
	if ($Title -and $Title.Length -gt $TitleMax) {
		throw "That title is $($Title.Length) characters; a card shows $TitleMax on one line. Titles are a few words that name it, like `"Keep the baseplate in playtests`": the detail goes in -Note or -Summary."
	}
	# A plan's steps each become a task (new), with its title.
	$long = @(if ($Steps) { ConvertTo-Steps $Steps | Where-Object { $_.title.Length -gt $TitleMax } })
	if ($long.Count) { throw "The step `"$($long[0].title)`" is $($long[0].title.Length) characters; each step becomes a card, so name it in a few words ($TitleMax at most)." }
	if (-not $words) { return }
	$n = Get-WordCount $Summary
	if ($n -gt $WordsMax) {
		throw "That summary is $n words; the card's hover shows $WordsMax. Say what changed in a sentence or two. The detail goes in log (the card's History), a report in say, and a choice for the user in ask."
	}
	$n = Get-WordCount ($Test -join ' ')
	if ($n -gt $WordsMax) {
		throw "That test is $n words; the card's hover shows $WordsMax. Give the few steps to try, a few words each: -Test `"Drive a lap`",`"Drift the hairpin`". The detail goes in log."
	}
}

# -Test: the steps to try, one a line.
function Join-Steps { (@($Test) | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) -join "`n" }

# The fields new and set share.
function Set-Common($t) {
	if ($Type) {
		if ($Type -notin $Types) { throw "Type must be one of: $($Types -join ', ')." }
		Set-Field $t 'type' $Type
	}
	if ($Plan) { Get-Task $Plan | Out-Null; Set-Field $t 'plan' $Plan }
	if ($PSBoundParameters.ContainsKey('After') -or $After) { Set-Field $t 'after' @($After | ForEach-Object { $_ -split ',' } | Where-Object { $_ -match '^T-\d+$' }) }
	if ($Feature) { Set-Field $t 'feature' $true }
	# A feature's spec, which its plan card links: a doc in the repo.
	if ($Spec) {
		$path = $Spec.Replace('\', '/').TrimStart('/')
		if (-not (Test-Path (Join-Path $RepoDir $path))) { throw "There's no $path in repo\ (-Spec is a path in the repo, like docs/game/features/trading.md)." }
		Set-Field $t 'spec' $path
	}
}

switch ($Command) {
	# 3: this Rocco updated itself, and the new one carries on in the background.
	'serve' { if (Start-Rocco) { exit 3 } }

	# Rocco.bat: the server in the background with no window, so nothing stays open on the user's screen. Settings
	# has Quit. Started hidden, so Windows Terminal doesn't pick it up as a tab, and detached from whatever ran this:
	# started from an agent's shell, Rocco (and the Lync, Studio and agent windows it opens) would close with that agent.
	'start' {
		Start-Hidden "powershell.exe $((Get-ServeArguments $Project $Port $Restart) -join ' ')" $AppDir | Out-Null
	}

	'list' {
		$rows = @(if ($Pending) { Get-PendingTasks } else { Get-Tasks | Where-Object { ($_.status -notin 'done', 'removed') -or $_.pending } })
		# In a feature's thread: its own plan and tasks.
		if ($script:ThreadId -and -not $Pending) { $rows = @($rows | Where-Object { $_.id -eq $script:ThreadId -or $_.plan -eq $script:ThreadId }) }
		$thread = Get-ThreadState
		if ($Pending) {
			if (-not $rows.Count -and -not $thread.pending.Count) { 'Nothing waiting on the conductor.'; break }
			Write-Pending $rows $thread
			break
		}
		if (-not $rows.Count) { 'Nothing on the Workboard.' } else { Format-Tasks $rows }
		if ($thread.pending.Count) { ''; 'From the user:'; foreach ($e in $thread.pending) { Format-ThreadItem $e $thread } }
	}

	# The conductor between jobs: returns as soon as the user hands something over. Rocco shows it listening meanwhile,
	# and opens no other conductor.
	'wait' {
		$deadline = if ($Timeout -gt 0) { (Get-Date).AddSeconds($Timeout) } else { [datetime]::MaxValue }
		$beat = [datetime]::MinValue
		try {
			while ($true) {
				$rows = @(Get-PendingTasks)
				$thread = Get-ThreadState
				if ($rows.Count -or $thread.pending.Count) { $PendingHead; Write-Pending $rows $thread; break }
				if ((Get-Date) -gt $deadline) { 'Nothing new yet. Run wait again.'; break }
				if (((Get-Date) - $beat).TotalSeconds -ge 5) { Register-Waiting $true; $beat = Get-Date }
				Start-Sleep -Seconds 2
			}
		} finally { Register-Waiting $false }
	}

	'lanes' {
		if ($Count -ge 0) {
			$saved = Set-WorkstationLanes $Count
			"$env:COMPUTERNAME opens $Count lane$(if ($Count -ne 1) { 's' }): recorded in PROJECT.md.$(if ($saved.note) { " $($saved.note)" })"
		}
		Open-Lanes
	}

	'show' {
		if ($Id -match '^C-') { Show-ThreadItem $Id; break }
		$t = Read-Task $Id
		$dir = Get-TaskDir $Id
		$head = "$($t.id)  $($t.status)"
		if ($t.kind -eq 'plan') { $head += '  feature plan' }
		if ($t.kind -eq 'question') { $head += '  question from the user' }
		if ($t.type) { $head += "  $($t.type)" }
		if ($t.lane) { $head += "  lane $($t.lane)" }
		if ($t.branch) { $head += "  $($t.branch)" }
		$head += "  attempt $($t.attempt)"
		if ($t.pending) { $head += "  waiting on the conductor: $($t.pending)" }
		$head
		"Title:      $($t.title)"
		if ($t.note -and $t.note -ne $t.title) { "Note:       $($t.note)" }
		if ($t.plan) { "Plan:       $($t.plan)" }
		if (@(Get-List $t.after).Count) { "After:      $((Get-List $t.after) -join ', ')" }
		foreach ($s in Get-List $t.shots) { "Screenshot: $(Join-Path $dir $s)" }
		if ($t.step) { "Step:       $($t.step)" }
		if ($t.summary) { "Summary:    $($t.summary)" }
		foreach ($line in "$($t.test)" -split "`n" | Where-Object { $_ }) { "Test:       $line" }
		foreach ($s in Get-List $t.steps) { "Plan step:  $($s.title)  (lane $($s.lane), $($s.tier))" }
		foreach ($q in Get-List $t.questions) { "Question:   $($q.text)  [$((@($q.options) | ForEach-Object { $_.label + $(if ($_.audio) { " ($($_.audio))" }) + $(if ($_.image) { " (picture $($_.image))" }) }) -join ' | ')]$(if (@($q.images).Count) { "  pictures: $(@($q.images) -join ', ')" })" }
		if ($t.waiting) { "Waiting:    $($t.waiting)" }
		if ([int]$t.followups) { "Follow-ups: $($t.followups) from the user since the last clear (latest 'you' lines below)" }
		if ($t.wantLane -or $t.wantTier) { "User wants: $(Format-Wanted $t)" }
		if ($t.held) { 'Paused:     by the user. Leave it until they resume it.' }
		foreach ($c in Get-List $t.checks) { "Check:      $(if ($c.ok) { 'passed' } else { 'FAILED' })  $($c.text)$(if ($c.file) { "  ($(Join-Path $dir $c.file))" })" }
		$notes = Join-Path $dir 'notes.md'
		"Notes:      $notes$(if (-not (Test-Path $notes)) { ' (none yet)' })"
		if (@(Get-List $t.log).Count) {
			'History:'
			foreach ($e in $t.log) { '  {0}  {1,-9} {2}' -f (Format-Time $e.at), $e.who, $e.text }
		}
		# A note for the conductor to take on: Up next tells the user it's been read, and the conductor what comes first.
		if ($t.pending -eq 'plan' -and $t.status -eq 'queued') {
			if ($t.waiting -eq $ToConductor) { Set-Field $t 'waiting' $ReadIt; Save-Task $t }
			''
			"Sort it first (README.md `"Sorting`"). Only a question, with nothing to change: answer it with reply $($t.id) -Answer -Text `"...`", and no card is kept. A small fix: set $($t.id) -Title `"<a few words>`" -Status working -Step `"...`", so it leaves Up next. A feature (it needs a plan, a decision, or several steps): post its plan (plan -Title ... -Steps ...), then set $($t.id) -Status removed. Several unrelated requests in it: a task each (new -Title `"...`" -Note `"<their words>`"), not a plan."
		}
		# The user stepped in on its worker (the card's Pause, Resume, Start again, or its lane and worker): what to do.
		$stepIn = switch ($t.pending) {
			'handoff' { "The user gave it an agent of its own, which Rocco opens once your worker has let go of it. Stop the worker on it now, commit what it has on its branch so nothing is lost, then clear $($t.id). From then on it isn't yours, except to merge when it's approved." }
			'stop' { "The user paused it. Stop its worker now, commit what it has on its branch so nothing is lost, then set $($t.id) -Status queued and clear $($t.id). Don't start it again until they resume it (wait hands it back as [resume])." }
			'resume' { "The user resumed it. $(if ($t.branch) { "Carry it on from $($t.branch) and its notes.md" } else { 'Start it when its turn comes' }): set $($t.id) -Status working -Lane <n> -Step `"...`" as you do." }
			'restart' { "The user wants a fresh worker on it. Stop the one it has, then start a new one on $($t.id) $(if ($t.branch) { "from $($t.branch) and its notes.md" } else { 'from the start' }) (attempt $($t.attempt)), and clear $($t.id). Their reason, if they gave one, is the latest 'you' line." }
			'assign' { "The user wants it on $(Format-Wanted $t). Stop its worker, commit what it has, start it there (set $($t.id) -Status working -Lane <n>), and clear $($t.id)." }
		}
		if ($stepIn) { ''; $stepIn }
		# Waiting for a lane: whether one is free now.
		if (Test-WaitsForLane $t) {
			$free = @(Get-LaneReady @(Get-Tasks) | Where-Object { $_.id -eq $t.id })
			''
			if ($free.Count) { "Lane $($free[0].freeLane) is free: set $($t.id) -Status working -Lane $($free[0].freeLane) -Step `"...`", and give the worker its id." }
			else { 'Every lane is busy: wait hands it back ([lane]) the moment one is free.' }
		}
		# Every lane busy for a task you're about to start.
		if ($t.status -eq 'queued' -and $t.pending -in 'plan', 'reopen' -and -not @(Get-FreeLanes @(Get-Tasks)).Count) { ''; "Every lane is busy. To start it when one frees: set $($t.id) -ForLane (wait hands it back as [lane])." }
		# A feature plan is never worked as a card: its steps are tasks, which the plan's chip counts.
		if ($t.kind -eq 'plan' -and $t.lead) {
			# Built by an agent of its own (LEAD.md). To that agent: how. To anyone else: hands off.
			''
			if ($script:ThreadId -eq $t.id) {
				"You are building this, a step at a time, in lane $($t.lane). For each step in turn: new -Title `"<step>`" -Plan $($t.id), then set <its id> -Status working -Lane $($t.lane) -Branch <the feature's branch> -Step `"...`", build it, record what you ran (result), and set it ready with -Where lane. $(if ($t.pending -eq 'approved') { "Then clear $($t.id)." })"
			} else { "This feature has an agent of its own, in lane $($t.lane): it makes and works its tasks, and the user talks to it in the feature's thread. It isn't yours, except to merge a step the user has approved." }
		} elseif ($t.kind -eq 'plan') {
			$perStep = "a task per step, new -Title `"<step>`" -Plan $($t.id) [-After T-0xx], and give each worker its step's id"
			$hint = if ($t.status -eq 'inbox' -and $t.pending) { "It still waits for the user's OK (Approve plan on its card). If their words approve it (`"go`", `"build it`"), make $perStep; the first one approves it. Otherwise answer them, and it waits." }
				elseif ($t.pending -eq 'approved') { "Approved: make $perStep. Then clear $($t.id)." }
				elseif ($t.status -in 'working', 'stuck', 'ready') { "It's being worked as one card, so the board shows none of it: make $perStep. That puts the plan back." }
			if ($hint) { ''; $hint }
		}
	}

	'new' {
		if (-not $Title) { throw 'new needs -Title.' }
		Assert-CardText $false
		$t = New-Task $Title $(if ($Note) { $Note } else { $Title }) $(if ($Status) { $Status } else { 'queued' }) 'task'
		Set-Common $t
		if ($Waiting) { Set-Field $t 'waiting' $Waiting }
		if ($ForLane) { Set-LaneWait $t $Waiting }
		Save-Task $t
		# A plan's step: the plan is under way (approved, if the user said so in words).
		if ($Plan) { Open-Plan $Plan }
		$t.id
	}

	'suggest' {
		if (-not $Title) { throw 'suggest needs -Title.' }
		Assert-CardText $false
		$t = New-Task $Title $(if ($Note) { $Note } else { $Title }) 'inbox' 'suggestion'
		if ($Summary) { Set-Field $t 'summary' $Summary }
		Set-Common $t
		Save-Task $t
		Add-Event "Spotted: $Title" $t.id
		$t.id
	}

	'plan' {
		if (-not $Title) { throw 'plan needs -Title.' }
		if (-not $Steps) { throw 'plan needs -Steps "title|lane|tier", one per task.' }
		Assert-CardText $false
		$t = New-Task $Title $Title 'inbox' 'plan' 'feature'
		Set-Field $t 'feature' $true
		if ($Summary) { Set-Field $t 'summary' $Summary }
		Set-Field $t 'steps' (ConvertTo-Steps $Steps)
		Set-Common $t
		Save-Task $t
		Add-Event "Posted a plan for your OK: $Title" $t.id
		$t.id
	}

	'ask' {
		if (-not $Question) { throw 'ask needs -Question.' }
		if (-not $Id) {
			# The conductor's own question: above the note box, and its answer comes back through wait.
			$cid = New-ThreadId
			$q = [ordered]@{ text = $Question; header = ''; multi = $false; options = @($Options | Where-Object { $_ } | ForEach-Object { [ordered]@{ label = $_; detail = ''; image = '' } }); images = @() }
			Add-Pictures $q @($Images) @($Show) @() (Get-AskFilesDir $cid) "$cid/"
			$e = Add-Thread 'asked' @{ id = $cid; questions = @($q); via = 'command' }
			"$($e.id) asked, above the user's note box. Their answer comes back through wait, as an [answer]."
		} else {
			$t = Read-Task $Id
			# A plan's question would show nowhere: it's asked on the step's task.
			if ($t.kind -eq 'plan') { throw ($PlanNotWorked -f $t.id) }
			Add-Question $t $Question @($Options) @($Audio) @($Images) @($Show)
			Set-Status $t 'stuck'
			Save-Task $t
			Add-Event "Needs your answer: $($t.title)" $t.id
			"$($t.id) stuck: $(@(Get-List $t.questions).Count) question(s)"
		}
		# The card shows two lines of an option at most.
		$long = @($Options | Where-Object { "$_".Length -gt 40 })
		if ($long.Count) {
			"Asked, but $($long.Count) option(s) run long for the card. Options read best in a few words, with the detail in the question" +
			$(if ($Id) { ": set $Id -Question `"...`" -Options ... replaces it." } else { '.' })
		}
	}

	'set' {
		$t = Read-Task $Id
		# A worker finds out here (set -Step) that the user deleted its task.
		if ($t.status -eq 'removed' -and $Status -ne 'removed') { throw ($DeletedText -f $t.id) }
		if ($t.kind -eq 'plan' -and ($Status -in 'working', 'stuck', 'ready' -or $Lane -gt 0)) { throw ($PlanNotWorked -f $t.id) }
		Assert-CardText ($t.kind -ne 'plan' -and -not ($t.PSObject.Properties['auto'] -and $t.auto))
		$before = $t.status
		if ($Status) {
			if ($Status -notin $Statuses) { throw "Status must be one of: $($Statuses -join ', ')." }
			Set-Status $t $Status
		}
		if ($Where -and $Where -notin 'main', 'lane') { throw "Where must be 'main' (merged, test in Main) or 'lane' (on its branch, test in the lane's place)." }
		# A branch's name goes to git as it is: only what a branch can be called.
		if ($Branch -and ($Branch -notmatch '^[A-Za-z0-9][\w./-]{0,120}$' -or $Branch -match '\.\.|//|\.lock$|/$')) { throw "'$Branch' isn't a branch name (letters, numbers, / - _ . , like agent/trade-window)." }
		foreach ($name in 'Title', 'Branch', 'Where', 'Step', 'Summary', 'Waiting') {
			if ($PSBoundParameters.ContainsKey($name)) { Set-Field $t $name.ToLower() $PSBoundParameters[$name] }
		}
		# Every lane busy: it waits in Up next until wait hands it back. Starting it, or giving it a lane, ends the wait.
		if ($ForLane) { Set-LaneWait $t $Waiting }
		elseif ($t.PSObject.Properties['waitingFor'] -and $t.waitingFor -and ($t.status -ne 'queued' -or $Lane -gt 0)) { Clear-LaneWait $t }
		if ($PSBoundParameters.ContainsKey('Test')) { Set-Field $t 'test' (Join-Steps) }
		# One question in one go; ask adds more, with audio.
		if ($Question) { Set-Field $t 'questions' @(); Add-Question $t $Question @($Options) @($Audio) @($Images) @($Show) }
		if ($Lane -ge 0) { Set-Field $t 'lane' $(if ($Lane -eq 0) { $null } else { $Lane }) }
		if ($Progress -ge 0) { Set-Field $t 'progress' ([Math]::Min(100, $Progress)) }
		# A revised feature plan (the user asked for changes): its new steps.
		if ($Steps) { Set-Field $t 'steps' (ConvertTo-Steps $Steps) }
		if ($Order -ge 0) { Set-Field $t 'order' $Order }
		Set-Common $t
		# Where to test it is checked against git: an agent with an old picture can't send the user to the wrong place.
		if ($t.status -eq 'ready' -and ($Status -eq 'ready' -or $PSBoundParameters.ContainsKey('Where') -or $PSBoundParameters.ContainsKey('Branch'))) { Assert-TestPlace $t }
		Save-Task $t
		# A step task approved, taken back or deleted: its plan follows. One just linked to a plan puts it under way.
		if ($Plan) { Open-Plan $Plan }
		if ($t.status -ne $before) { Sync-Plan $t.plan }
		# Milestones for the conductor's history in Rocco.
		if ($t.status -ne $before) {
			switch ($t.status) {
				'working' { Add-Event "$(if ($t.lane) { "Started in lane $($t.lane)" } else { 'Started' }): $($t.title)" $t.id }
				'ready' { Add-Event "Ready to test: $($t.title)" $t.id }
				'done' { if ($t.PSObject.Properties['auto'] -and $t.auto) { Add-Event "Done: $($t.title)" $t.id } }
			}
		}
		"$($t.id) $($t.status)"
		# Ready, with nothing on the card about what was run: say how to put it there.
		if ($Status -eq 'ready' -and $t.status -eq 'ready' -and $t.kind -eq 'task' -and -not @(Get-List $t.checks | Where-Object { [int]$_.attempt -eq [int]$t.attempt }).Count) {
			"No check on the card for this attempt. Whatever you ran (tests, a playtest) shows there with: result $($t.id) -Pass -Text `"12 of 12 tests pass`" [-File <the tests' output or Studio's console, as a text file>]"
		}
	}

	# What the worker ran and how it went, on the card: the user sees the tests' result and Studio's console there.
	'result' {
		if ($Pass -eq $Fail) { throw 'result needs -Pass or -Fail (one of them), and -Text saying what was run.' }
		if (-not $Text) { throw 'result needs -Text: what was run and what came of it, in a line ("12 of 12 tests pass", "Playtest: lap completes, no errors in the console").' }
		if ((Get-WordCount $Text) -gt $WordsMax) { throw "That's $(Get-WordCount $Text) words; a check is a line ($WordsMax words at most). The output itself goes in -File." }
		$t = Read-Task $Id
		if ($t.status -eq 'removed') { throw ($DeletedText -f $t.id) }
		Add-Check $t ([bool]$Pass) $Text $File
		Add-Log $t $(if ($PSBoundParameters.ContainsKey('Who')) { $Who } else { 'worker' }) "$(if ($Pass) { 'Check passed' } else { 'Check failed' }): $Text"
		Save-Task $t
		"$($t.id) check recorded: $(if ($Pass) { 'passed' } else { 'failed' })"
	}

	'log' {
		if (-not $Text) { throw 'log needs -Text.' }
		if ($Who -notin 'worker', 'conductor') { throw "Who must be 'worker' or 'conductor'." }
		$t = Read-Task $Id
		Add-Log $t $Who $Text
		Save-Task $t
	}

	# Answer the user's question; it shows under the note box until they say they've got it.
	'reply' {
		if (-not $Text) { throw 'reply needs -Text.' }
		$t = Read-Task $Id
		# -Answer: a note that was only a question (the conductor sorted it so) becomes one, answered here.
		if ($Answer) {
			if ($t.kind -notin 'note', 'question' -or $t.status -notin 'queued', 'inbox') { throw "-Answer is for a note that hasn't been started: $($t.id) is $($t.status)." }
			Set-Field $t 'kind' 'question'
			Set-Field $t 'type' 'question'
		}
		# A question is answered in the chat, where it was asked: the answer is all there is to it, so it's finished,
		# with no card to tick off. (The user can ask more, or make it a task.) On any other card the answer goes in
		# its session, and the card stays where it is (a question typed into a working card doesn't make it ready).
		if ($t.kind -eq 'question') {
			Set-Field $t 'summary' $Text
			Set-Status $t 'done'
			Set-Field $t 'pending' ''
			Set-Field $t 'waiting' ''
		}
		Add-Log $t $(if ($PSBoundParameters.ContainsKey('Who')) { $Who } else { 'conductor' }) $Text
		Save-Task $t
		Add-Thread 'said' @{ text = $Text; task = $t.id; re = $t.title } | Out-Null
		if ($t.kind -ne 'question') { "Answered on $($t.id)'s card; it stays $($t.status). Pass anything for its worker on to it, then clear $($t.id)." }
	}

	'clear' {
		if ($Id -match '^C-') { Find-ThreadItem $Id | Out-Null; Add-Thread 'handled' @{ to = $Id } | Out-Null; break }
		$t = Read-Task $Id
		switch ($t.pending) {
			'merge' { Add-Event "Merged into Main: $($t.title)" $t.id }
			'cancel' { Add-Event "Stopped deleted work: $($t.title)" $t.id }
			'stop' { Add-Event "Paused: $($t.title)" $t.id }
			'handoff' { Set-Field $t 'waiting' 'Opening its own agent' }
		}
		Set-Field $t 'pending' ''
		Set-Field $t 'followups' 0
		Save-Task $t
	}

	# The conductor's status line in Rocco, and a step in its history.
	'doing' {
		$words = Get-Words
		if (-not $words) { throw 'doing needs what you are doing: doing "Merging the trade window".' }
		Add-Activity $words
	}

	# A message to the user, in Rocco's history: a report, or anything you'd otherwise only say in your own window.
	'say' {
		$words = Get-Words
		if (-not $words) { throw 'say needs -Text.' }
		Add-Thread 'said' @{ text = $words } | Out-Null
	}

	# Claude Code's hooks for a conductor Rocco opened (server\conductor.ps1 writes them): they wait for the user's
	# answer in Rocco and hand it back. Anything that goes wrong leaves the agent's own dialog to ask instead.
	'hook' {
		# Bytes in and out, as UTF-8: the console's own encoding would garble anything past ASCII.
		$raw = New-Object IO.MemoryStream
		[Console]::OpenStandardInput().CopyTo($raw)
		$in = $Utf8.GetString($raw.ToArray()) | ConvertFrom-Json
		$out = switch ($Id) {
			'permission' { Wait-Permission $in }
			'question' { Wait-Question $in }
			'stop' { Test-ConductorStop $in }
			default { throw "Unknown hook '$Id'." }
		}
		if ($out) {
			$bytes = $Utf8.GetBytes($out)
			$stdout = [Console]::OpenStandardOutput()
			$stdout.Write($bytes, 0, $bytes.Length)
			$stdout.Flush()
		}
	}

	default { throw "Unknown command '$Command'. Use serve, list, show, new, suggest, plan, ask, doing, say, reply, set, result, log, clear, wait or lanes." }
}
foreach ($line in $script:SplitNote) { $line }
