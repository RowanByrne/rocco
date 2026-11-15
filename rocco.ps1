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
#                                      -From C-1a2b3c: made from the user's message (new and plan): its words are the
#                                      note (unless -Note), its screenshots go with it, and the chat shows the card under it
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
#   rocco.ps1 tell [T-020] -Text "..."   one agent to another, never as the user: a feature's agent to the conductor
#                                      (no id), the conductor to a feature's agent (its id). Its wait hands it over as a [message]
#   rocco.ps1 reply T-012 -Text "..."   answer the user: a question card shows it under the note box (and turns
#                                      answered); on any other card it goes in the card's session, which stays put
#   rocco.ps1 set T-012 -Status working -Lane 3 -Step "Coding" [-Progress 40] [-Branch agent/x]
#   rocco.ps1 set T-012 -Status ready -Where main -Summary "what changed" -Test "Drive a lap","Drift the hairpin"
#                                      what a card shows has to fit it: a title is 50 characters at most (one line), a
#                                      task's summary and its test (the steps to try) 30 words each. The detail goes in log
#   rocco.ps1 set T-012 -Status ready -NothingToTest -Summary "what changed" [-Test "why"]   nothing for the user to try
#                                      yet: the card approves itself, as Approve would (on a lane, the conductor merges),
#                                      and its plan moves on. A test that starts "Nothing to..." without it is refused
#   rocco.ps1 set T-020 -Summary "..." -Steps "...|4|standard"   a revised feature plan: new summary and steps
#   rocco.ps1 set T-012 -ForLane       every lane is busy: it waits in Up next, and wait hands it back ([lane]) the
#                                      moment one is free. new takes -ForLane too. Starting it ends the wait
#   rocco.ps1 work T-012 -Branch agent/x [-Base feature/y]   a game whose agents borrow lanes (LANES.md "Lending a
#                                      lane"): the task's own checkout, <Game>\work\agent-x on that branch (from -Base, a
#                                      feature's branch, else from main). Prints its folder: the agent works only there
#   rocco.ps1 borrow T-012 [-Timeout 480]   a lane to test in: the place then holds the checkout's latest commit. With
#                                      every lane busy it waits in line. Prints the lane, its place, and what to check
#   rocco.ps1 sync T-012               the lane it has, switched to the checkout's latest commit (after more commits)
#   rocco.ps1 return T-012             done testing: the lane is free for the next task
#   rocco.ps1 result T-012 -Pass|-Fail -Text "12 of 12 tests pass" [-File console.txt]   what the worker ran and how it
#                                      went, on the card: the line, and the output (the tests' report, Studio's console)
#   rocco.ps1 log T-012 -Text "..." [-Who conductor]
#   rocco.ps1 clear T-012              what the user asked of it (plan, answer, reopen, merge, cancel, follow-ups) is handled
#   rocco.ps1 show C-1a2b3c / clear C-1a2b3c   a message or answer the user sent the conductor; clear: it's read
#   rocco.ps1 wait [-Timeout 540]      the conductor watching the board: returns when something waits on it (as list
#                                      -Pending), or after -Timeout seconds. Rocco shows it listening meanwhile
#   rocco.ps1 hook permission|question|stop|codex-stop   Hooks for an agent Rocco opened (server\conductor.ps1).
#                                      codex-stop watches the board before the turn can end
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
	[string]$From, # new, plan: the user's message (C-1a2b3c) the card is made from
	[switch]$Pass, [switch]$Fail, [string]$File,
	[string]$Base,    # work: the branch a new checkout starts from (a feature's, for one of its pieces)
	[switch]$User,    # borrow: for the user's own testing (the app's Load into a lane): never waits, takes no one's lane
	[Alias('Thread')] [string]$ThreadId, # -Thread T-020: the thread a command is about, a feature's (or a card's) with an agent of its own (LEAD.md)
	[switch]$Answer,  # reply: the note was only a question, and this answers it (no card is kept)
	[switch]$Done,    # reply: the note was an errand (nothing to test), done now, and this says what was done (no card is kept)
	[switch]$NothingToTest, # set -Status ready: nothing for the user to try yet, so the card approves itself
	[switch]$Restart # started by a Rocco that just updated itself: wait for its port, and don't open another tab
)
$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot
# Kept before the parts load: they keep the thread in use under the same name (core.ps1 Use-Thread), and start with none.
$named = $ThreadId
# An agent's command loads only what the board needs: it runs many of these, and each starts PowerShell afresh.
$parts = if ($Command -in 'serve', 'start', 'lanes') { 'core', 'agents', 'tasks', 'thread', 'sessions', 'projects', 'codex-watch', 'conductor', 'leads', 'lanes', 'loans', 'connections', 'history', 'docs', 'actions', 'accounts', 'onboarding', 'roblox', 'updates', 'thumbnails', 'http' }
	else { 'core', 'agents', 'tasks', 'thread', 'sessions', 'projects', 'conductor', 'leads', 'lanes', 'loans' }
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
		if ($t.pending -eq 'lane' -and -not [int]$t.freeLane) { $extra += "an agent is free: start it (work $($t.id) -Branch ..., then set $($t.id) -Status working)" }
		elseif ($t.pending -eq 'lane') { $extra += "lane $($t.freeLane) is free: set $($t.id) -Status working -Lane $($t.freeLane)" }
		elseif (Test-WaitsForLane $t) { $extra += $(if (Test-SharedLanes) { 'waiting for a free agent' } else { 'waiting for a free lane' }) }
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

function Wait-Pending([int]$seconds) {
	$deadline = if ($seconds -gt 0) { (Get-Date).AddSeconds($seconds) } else { [datetime]::MaxValue }
	$beat = [datetime]::MinValue
	try {
		while ($true) {
			$rows = @(Get-PendingTasks)
			$thread = Get-ThreadState
			if ($rows.Count -or $thread.pending.Count) { return @{ tasks = $rows; thread = $thread } }
			if ((Get-Date) -ge $deadline) { return }
			if (((Get-Date) - $beat).TotalSeconds -ge 5) { Register-Waiting $true; $beat = Get-Date }
			Start-Sleep -Seconds 2
		}
	} finally { Register-Waiting $false }
}

# Codex does not start a turn when a background command returns. Its synchronous Stop hook watches the board
# before the turn ends, then gives Codex the pending work as a continuation. Keep the hook's own timeout outside this wait.
function Wait-CodexStop($in) {
	$waiting = Wait-Pending $(if ($Timeout -gt 0) { $Timeout } else { 3570 })
	if (-not $waiting) {
		$reason = 'Rocco is still waiting for work. End your turn so the Stop hook can continue watching the Workboard.'
	} else {
		$items = (Write-Pending $waiting.tasks $waiting.thread) -join "`n"
		$reason = "The Rocco Workboard has work for you. Show each pending item and handle it before ending your turn again:`n$items"
		# An unchanged item after repeated continuations can be blocked on something the hook cannot resolve.
		$state = Join-Path (Get-ThreadDir) 'codex-stop-check.json'
		$last = if ($in.stop_hook_active -and (Test-Path -LiteralPath $state)) {
			try { [IO.File]::ReadAllText($state, $Utf8) | ConvertFrom-Json } catch { }
		}
		$tries = if ($last.turn -eq $in.turn_id -and $last.items -ceq $items) { [int]$last.tries + 1 } else { 1 }
		if ($tries -gt 3) {
			Add-Event 'Codex stopped with work still waiting. Use Restart it to pick up the Workboard.'
			return
		}
		[IO.File]::WriteAllText($state, (ConvertTo-Json -Compress @{ turn = $in.turn_id; items = $items; tries = $tries }), $Utf8)
	}
	ConvertTo-Json -Compress -InputObject ([ordered]@{ decision = 'block'; reason = $reason })
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

$PendingHead = 'Waiting on you. Show each, then handle it as CONDUCTOR.md "The Workboard" says: a message gets a card only for work that comes of it (new -Title "<a few words>" -From C-..., then set it working as you start), and a note card you take on gets set -Title "<a few words>" -Status working first, so it leaves Up next. Clear a C- message or answer once you''ve acted on it:'

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

# The user's message a card is made from (-From C-1a2b3c): a message carries no card of its own, so one is made only
# for work that comes of it, and the chat shows it under their message.
function Get-FromMessage {
	if (-not $From) { return $null }
	$m = Find-ThreadItem $From
	if ($m.kind -ne 'message' -or $m.who -ne 'you') { throw "$From isn't a message the user sent." }
	$m
}

# The card gets the message's screenshots, and the message the card (after Save-Task: a thread line names it).
function Add-FromMessage($t, $m) {
	Set-Field $t 'from' $m.id
	$i = @(Get-List $t.shots).Count
	foreach ($s in @($m.shots | Where-Object { $_ })) {
		$src = Join-Path (Get-ThreadDir) "files\$($s -replace '/', '\')"
		if (-not (Test-Path -LiteralPath $src)) { continue }
		$i++
		$name = "shot-$i$([IO.Path]::GetExtension($src))"
		Copy-Item -LiteralPath $src (Join-Path (Get-TaskDir $t.id) $name) -Force
		Set-Field $t 'shots' (@(Get-List $t.shots) + $name)
	}
}
function Add-MadeLine($t, $m) { if ($m) { Add-Thread 'made' @{ to = $m.id; task = $t.id; title = $t.title } | Out-Null } }

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

# What a command held to change (tasks.ps1 Lock-Task) is let go as it ends, saved or not. An agent runs this inside its
# own PowerShell (& rocco.ps1), whose process outlives the command: a lock left open there kept the next command, in
# the same shell, out of that task.
try {
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
		$waiting = Wait-Pending $Timeout
		if ($waiting) { $PendingHead; Write-Pending $waiting.tasks $waiting.thread }
		else { 'Nothing new yet. Run wait again.' }
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
		if ($t.lane) { $head += "  lane $($t.lane)$(if (Get-WorkDir $t) { ' (on loan)' })" }
		if ($t.branch) { $head += "  $($t.branch)" }
		$head += "  attempt $($t.attempt)"
		if ($t.pending) { $head += "  waiting on the conductor: $($t.pending)" }
		$head
		"Title:      $($t.title)"
		if ($t.note -and $t.note -ne $t.title) { "Note:       $($t.note)" }
		if ($t.plan) { "Plan:       $($t.plan)" }
		if (Get-WorkDir $t) { "Checkout:   $(Get-WorkDir $t)$(if (Test-NeedsLane $t) { '  (ready for the user to test, with no lane holding it: borrow -User loads it into one)' })" }
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
			"Sort it first (README.md `"Sorting`"). Only a question, with nothing to change: answer it with reply $($t.id) -Answer -Text `"...`", and no card is kept. Something to do that changes nothing in the game, so there's nothing to test (open the lanes, start Studio, push main, run the checks): do it, then reply $($t.id) -Done -Text `"<what you did>`", and no card is kept. A small fix: set $($t.id) -Title `"<a few words>`" -Status working -Step `"...`", so it leaves Up next. A feature (it needs a plan, a decision, or several steps): post its plan (plan -Title ... -Steps ...), then set $($t.id) -Status removed. Several unrelated requests in it: a task each (new -Title `"...`" -Note `"<their words>`"), not a plan."
		}
		# The user stepped in on its worker (the card's Pause, Resume, Start again, or its lane and worker), or approved
		# it in its lane: what to do.
		$stepIn = switch ($t.pending) {
			'handoff' { "The user gave it an agent of its own, which Rocco opens once your worker has let go of it. Stop the worker on it now, commit what it has on its branch so nothing is lost, then clear $($t.id). From then on it isn't yours, except to merge when it's approved." }
			'stop' { "The user paused it. Stop its worker now, commit what it has on its branch so nothing is lost, then set $($t.id) -Status queued and clear $($t.id). Don't start it again until they resume it (wait hands it back as [resume])." }
			'resume' { "The user resumed it. $(if ($t.branch) { "Carry it on from $($t.branch) and its notes.md" } else { 'Start it when its turn comes' }): set $($t.id) -Status working -Lane <n> -Step `"...`" as you do." }
			'restart' { "The user wants a fresh worker on it. Stop the one it has, then start a new one on $($t.id) $(if ($t.branch) { "from $($t.branch) and its notes.md" } else { 'from the start' }) (attempt $($t.attempt)), and clear $($t.id). Their reason, if they gave one, is the latest 'you' line." }
			'assign' { "The user wants it on $(Format-Wanted $t). Stop its worker, commit what it has, start it there (set $($t.id) -Status working -Lane <n>), and clear $($t.id)." }
			'merge' { "It's approved$(if ($t.PSObject.Properties['nothingToTest'] -and $t.nothingToTest) { ' (it had nothing to test, so it approved itself)' } else { ' (the user tested it in its lane)' }), so it's done. Merge $(if ($t.branch) { $t.branch } else { 'its branch' }) (CONDUCTOR.md `"A round`", step 4), then clear $($t.id). It stays done: don't set it ready, since they've already tried it." }
		}
		if ($stepIn) { ''; $stepIn }
		# Waiting for a lane: whether one is free now.
		if (Test-WaitsForLane $t) {
			$free = @(Get-LaneReady @(Get-Tasks) | Where-Object { $_.id -eq $t.id })
			''
			if ($free.Count -and -not [int]$free[0].freeLane) { "An agent is free: work $($t.id) -Branch agent/<slug>, set $($t.id) -Status working -Step `"...`", and give the worker its id and its checkout." }
			elseif ($free.Count) { "Lane $($free[0].freeLane) is free: set $($t.id) -Status working -Lane $($free[0].freeLane) -Step `"...`", and give the worker its id." }
			elseif (Test-SharedLanes) { 'As many agents are at work as this PC runs at once: wait hands it back ([lane]) the moment one finishes.' }
			else { 'Every lane is busy: wait hands it back ([lane]) the moment one is free.' }
		}
		# Nothing to start a task in, for one you're about to start: every lane busy, or (where agents borrow lanes) as
		# many agents at work as this PC runs at once.
		if ($t.status -eq 'queued' -and $t.pending -in 'plan', 'reopen') {
			if (Test-SharedLanes) { if ((Get-AgentsAtWork @(Get-Tasks)) -ge (Get-AgentsLimit)) { ''; "As many agents are at work as this PC runs at once ($(Get-AgentsLimit)). To start it when one finishes: set $($t.id) -ForLane (wait hands it back as [lane])." } }
			elseif (-not @(Get-FreeLanes @(Get-Tasks)).Count) { ''; "Every lane is busy. To start it when one frees: set $($t.id) -ForLane (wait hands it back as [lane])." }
		}
		# A feature plan is never worked as a card: its steps are tasks, which the plan's chip counts.
		if ($t.kind -eq 'plan' -and $t.lead) {
			# Built by an agent of its own (LEAD.md). To that agent: how. To anyone else: hands off.
			''
			if ($script:ThreadId -eq $t.id -and (Get-WorkDir $t)) {
				"You are building this, a step at a time, in your own checkout, $(Get-WorkDir $t), on $($t.branch). For each step in turn: new -Title `"<step>`" -Plan $($t.id), then work <its id> -Branch $($t.branch) (the same checkout) and set <its id> -Status working -Step `"...`", build it, borrow <its id> to test it in a lane, record what you ran (result), and set it ready with -Where lane. A step that can be built apart from the one you're on can go to a helper in a checkout of its own: work <its id> -Branch agent/<piece> -Base $($t.branch). $(if ($t.pending -eq 'approved') { "Then clear $($t.id)." })"
			} elseif ($script:ThreadId -eq $t.id) {
				"You are building this, a step at a time, in lane $($t.lane). For each step in turn: new -Title `"<step>`" -Plan $($t.id), then set <its id> -Status working -Lane $($t.lane) -Branch <the feature's branch> -Step `"...`", build it, record what you ran (result), and set it ready with -Where lane. $(if ($t.pending -eq 'approved') { "Then clear $($t.id)." })"
			} else { "This feature has an agent of its own, $(if (Get-WorkDir $t) { "in its own checkout ($($t.branch))" } else { "in lane $($t.lane)" }): it makes and works its tasks, and the user talks to it in the feature's thread. It isn't yours, except to merge a step the user has approved." }
		} elseif ($t.kind -eq 'plan') {
			$perStep = "a task per step, new -Title `"<step>`" -Plan $($t.id) [-After T-0xx], and give each worker its step's id"
			$hint = if ($t.status -eq 'inbox' -and $t.pending -eq 'revise') { "The user asked for changes (the latest 'you' line), and they're watching the plan's card while you make them. Change it now: set $($t.id) -Summary `"...`" -Steps ... (only what they asked). Then say what you changed in a sentence, reply $($t.id) -Text `"...`" (it shows on the card and in the chat), and clear $($t.id). It waits for their OK again." }
				elseif ($t.status -eq 'inbox' -and $t.pending) { "It still waits for the user's OK (Approve plan on its card). If their words approve it (`"go`", `"build it`"), make $perStep; the first one approves it. Otherwise answer them, and it waits." }
				elseif ($t.pending -eq 'approved') { "Approved: make $perStep. Then clear $($t.id)." }
				elseif ($t.status -in 'working', 'stuck', 'ready') { "It's being worked as one card, so the board shows none of it: make $perStep. That puts the plan back." }
			if ($hint) { ''; $hint }
		}
	}

	'new' {
		if (-not $Title) { throw 'new needs -Title.' }
		Assert-CardText $false
		$m = Get-FromMessage
		$t = New-Task $Title $(if ($Note) { $Note } elseif ($m -and $m.text) { $m.text } else { $Title }) $(if ($Status) { $Status } else { 'queued' }) 'task'
		# All or nothing: a card whose command failed is taken back, so trying again doesn't leave a second one.
		try {
			if ($m) { Add-FromMessage $t $m }
			Set-Common $t
			if ($Waiting) { Set-Field $t 'waiting' $Waiting }
			if ($ForLane) { Set-LaneWait $t $Waiting }
			Save-Task $t
			# A plan's step: the plan is under way (approved, if the user said so in words).
			if ($Plan) { Open-Plan $Plan }
		} catch { Remove-TaskFolder $t.id; throw }
		Add-MadeLine $t $m
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
		$m = Get-FromMessage
		$t = New-Task $Title $(if ($m -and $m.text) { $m.text } else { $Title }) 'inbox' 'plan' 'feature'
		if ($m) { Add-FromMessage $t $m }
		Set-Field $t 'feature' $true
		if ($Summary) { Set-Field $t 'summary' $Summary }
		Set-Field $t 'steps' (ConvertTo-Steps $Steps)
		Set-Common $t
		Save-Task $t
		Add-MadeLine $t $m
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
		# The user's approval stands. An approved card never goes back to To test, and one approved in its lane waits
		# only on its merge, done all the while: merging it doesn't make it ready again.
		if ($t.status -eq 'done' -and $Status -and $Status -notin 'done', 'removed' -and ($Status -eq 'ready' -or $t.pending -eq 'merge')) {
			if ($t.pending -eq 'merge') { throw "$($t.id) is done: it's approved, so it doesn't go to To test again. Merge its branch, then clear $($t.id), and it stays done." }
			throw "$($t.id) is done: it's approved, so it doesn't go back to To test. To work on it again (a follow-up on it), set -Status working first."
		}
		if ($t.kind -eq 'plan' -and ($Status -in 'working', 'stuck', 'ready' -or $Lane -gt 0)) { throw ($PlanNotWorked -f $t.id) }
		# Nothing for the user to try yet (groundwork the next step makes visible, a record of their pick, agents' own
		# tools): said with -NothingToTest, so the card approves itself, never in words on a card they'd approve by hand.
		if ($NothingToTest) {
			if ($Status -ne 'ready') { throw '-NothingToTest goes with -Status ready: the card approves itself as it turns ready.' }
			# What they added while it ran may be something to try.
			if ([int]$t.followups -gt 0 -or $t.pending -eq 'followup') { throw "The user added to $($t.id) while it ran (show $($t.id)). Handle that and clear $($t.id) first: it may give them something to test." }
		} elseif ($PSBoundParameters.ContainsKey('Test') -and (Join-Steps) -match '^\s*nothing\s+(to|in|for)\b') {
			throw "That test says there's nothing to try. If there's nothing for the user to test, add -NothingToTest: the card approves itself and its plan moves on, with -Test saying why. Otherwise -Test says what to try, even when it takes some setting up (two players)."
		}
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
		if ($NothingToTest) {
			$why = Join-Steps
			Set-Field $t 'test' $(if (-not $why) { 'Nothing to test' } elseif ($why -match '^\s*nothing\s+(to|in|for)\b') { $why } else { "Nothing to test: $why" })
		} elseif ($PSBoundParameters.ContainsKey('Test')) { Set-Field $t 'test' (Join-Steps) }
		# One question in one go; ask adds more, with audio.
		if ($Question) { Set-Field $t 'questions' @(); Add-Question $t $Question @($Options) @($Audio) @($Images) @($Show) }
		if ($Lane -ge 0) { Set-Field $t 'lane' $(if ($Lane -eq 0) { $null } else { $Lane }) }
		if ($Progress -ge 0) { Set-Field $t 'progress' ([Math]::Min(100, $Progress)) }
		# A revised feature plan (the user asked for changes): its new steps.
		if ($Steps) { Set-Field $t 'steps' (ConvertTo-Steps $Steps) }
		if ($Order -ge 0) { Set-Field $t 'order' $Order }
		Set-Common $t
		# Where to test it is checked against git: an agent with an old picture can't send the user to the wrong place.
		$testing = $t.status -eq 'ready' -and ($Status -eq 'ready' -or $PSBoundParameters.ContainsKey('Where') -or $PSBoundParameters.ContainsKey('Branch'))
		$markingDone = $Status -eq 'done' -and $before -ne 'done'
		if (($testing -or $markingDone) -and $t.branch -and ($t.lane -or (Get-WorkDir $t)) -and (Test-RequiresLaneApproval)) {
			if ($NothingToTest -or $markingDone) { throw "$($t.id) needs the user's approval in its lane. Set it ready with test instructions and wait for the user to approve it on the Workboard." }
			if ($Status -eq 'ready' -and -not $PSBoundParameters.ContainsKey('Where')) { Set-Field $t 'where' 'lane' }
			if ($t.where -ne 'lane') { throw "$($t.id) needs the user's approval in its lane. Use -Where lane and merge only after approval." }
		}
		if ($testing) { Assert-TestPlace $t }
		if ($Status -eq 'ready') { Set-Field $t 'nothingToTest' ([bool]$NothingToTest) }
		# Approved as the user's Approve would: done, and on its branch the conductor merges it. There's no Undo: they
		# didn't click anything. (A setup card is done already: it approves itself.)
		$selfApproved = $NothingToTest -and $t.status -eq 'ready'
		if ($selfApproved) {
			Set-Status $t 'done'
			Set-Field $t 'undo' $null
			Add-Log $t 'conductor' 'Nothing for you to test, so it approved itself.'
			if ($t.where -eq 'lane') { Set-Field $t 'pending' 'merge' }
		}
		Save-Task $t
		# Ready for the user to test on its branch, from a checkout of its own: a lane holds it for them (the one its
		# agent tested in, now on its latest commit, else a free one), or its card offers to load it when one is free.
		$loan = if ($Status -eq 'ready' -and $t.status -eq 'ready' -and $t.where -eq 'lane' -and (Get-WorkDir $t)) { Invoke-Borrow $t.id 'user' 0 }
		# Merged, and in Main to try: its own checkout has nothing left to do.
		$tidied = if ($Status -eq 'ready' -and $t.status -in 'ready', 'done' -and $t.where -eq 'main' -and (Get-WorkDir $t) -and (Get-BranchPlace $t) -eq 'main') {
			$t = Read-Task $t.id; Remove-Work $t; Save-Task $t
		}
		# A step task approved, taken back or deleted: its plan follows. One just linked to a plan puts it under way.
		if ($Plan) { Open-Plan $Plan }
		if ($t.status -ne $before) { Sync-Plan $t.plan }
		# Milestones for the conductor's history in Rocco.
		if ($t.status -ne $before) {
			switch ($t.status) {
				'working' { Add-Event "$(if ($t.lane) { "Started in lane $($t.lane)" } else { 'Started' }): $($t.title)" $t.id }
				'ready' { Add-Event "Ready to test: $($t.title)" $t.id }
				'done' {
					if ($selfApproved) { Add-Event "Done, nothing to test: $($t.title)" $t.id }
					elseif ($t.PSObject.Properties['auto'] -and $t.auto) { Add-Event "Done: $($t.title)" $t.id }
				}
			}
		}
		"$($t.id) $($t.status)"
		if ($loan) { if ($loan.lane) { "The user tests it in lane $($loan.lane), which holds its latest commit." } else { $loan.text } }
		if ($tidied) { $tidied }
		if ($selfApproved) {
			"Nothing for the user to test, so it approved itself.$(if ($t.pending -eq 'merge') { ' The conductor merges its branch.' })$(if ($t.plan) { " Go on to $($t.plan)'s next step." })"
		}
		# Its work over (a feature set done, a card with an agent of its own approved or deleted): that agent and the
		# window it runs in close, as when the user approves it. Last, as it may be the agent running this.
		if ($t.status -ne $before) { Close-FinishedLead (Get-Task $t.id) }
		# Ready, with nothing on the card about what was run: say how to put it there.
		if ($Status -eq 'ready' -and $t.status -eq 'ready' -and $t.kind -eq 'task' -and -not @(Get-List $t.checks | Where-Object { [int]$_.attempt -eq [int]$t.attempt }).Count) {
			"No check on the card for this attempt. Whatever you ran (tests, a playtest) shows there with: result $($t.id) -Pass -Text `"12 of 12 tests pass`" [-File <the tests' output or Studio's console, as a text file>]"
		}
	}

	# A game whose agents borrow lanes (loans.ps1; the template's LANES.md "Lending a lane"). work: the task's own
	# checkout. borrow, sync, return: a lane to test it in, by commit.
	'work' {
		if (-not $Branch) { throw 'work needs -Branch: the task''s branch, like agent/trade-window.' }
		$t = Read-Task $Id
		if ($t.status -eq 'removed') { throw ($DeletedText -f $t.id) }
		if ($t.kind -eq 'plan') { throw ($PlanNotWorked -f $t.id) }
		$dir = Add-Work $t $Branch $Base
		Save-Task $t
		"$($t.id) works in $dir, on $Branch. Edit and commit only there; a lane to test in: borrow $($t.id)."
	}
	'borrow' {
		if (-not $Id) { throw 'borrow needs the task: borrow T-012.' }
		(Invoke-Borrow $Id $(if ($User) { 'user' } else { 'agent' }) $(if ($Timeout -gt 0) { $Timeout } else { 480 })).text
	}
	'sync' { Invoke-Sync $Id }
	'return' { Invoke-Return $Id }

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
		# -Done: an errand (open the lanes, push main): nothing changed in the game, so there's nothing to test or
		# approve. It's finished as it's reported, in the chat, with no card kept.
		if ($Done) {
			if ($Answer) { throw 'Use -Answer or -Done, not both.' }
			if ($t.kind -in 'plan', 'question' -or $t.status -in 'done', 'removed') { throw "-Done is for a note that's an errand: $($t.id) is a $($t.kind) and $($t.status)." }
			if ($t.branch) { throw "$($t.id) has a branch ($($t.branch)): something was changed, so it's tested. Hand it back with set -Status ready." }
			Set-Field $t 'kind' 'errand'
			Set-Field $t 'summary' $Text
			Set-Status $t 'done'
			Set-Field $t 'pending' ''
			Set-Field $t 'waiting' ''
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
			'merge' { Add-Event "Merged into Main: $($t.title)" $t.id; $tidy = $true }
			'cancel' { Add-Event "Stopped deleted work: $($t.title)" $t.id; $tidy = $true }
			'stop' { Add-Event "Paused: $($t.title)" $t.id }
			'handoff' { Set-Field $t 'waiting' 'Opening its own agent' }
			# A plan changed as asked: if nothing was said about it since, the card and the chat still get an answer.
			'revise' {
				if (@(Get-List $t.log)[-1].who -eq 'you') { Add-Log $t 'conductor' 'Updated the plan.' }
				Add-Event "Updated the plan: $($t.title)" $t.id
			}
		}
		Set-Field $t 'pending' ''
		Set-Field $t 'followups' 0
		# Merged, or dropped: its own checkout has nothing left to do (loans.ps1). Its lane went back as it was saved.
		$gone = if ($tidy) { Remove-Work $t }
		Save-Task $t
		if ($gone) { $gone }
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

	# One agent to another, never as the user: a feature's agent to the conductor (tell -Text "..."), or the conductor
	# to a feature's agent (tell T-020 -Text "..."). Plain code, no agent in between: it lands in the other's thread,
	# where its wait hands it over as a [message] from that agent. The chat shows only a line saying it was sent.
	'tell' {
		if (-not $Text) { throw 'tell needs -Text.' }
		$from = $script:ThreadId
		$to = if ($from) { if ($Id) { throw "A feature's agent tells only the conductor: tell -Text `"...`"." }; '' }
			elseif ($Id) { "$Id" } else { throw 'The conductor tells a feature''s agent: tell T-020 -Text "...".' }
		if ($to) {
			$t = try { Get-Task $to } catch { throw "No task $to." }
			if (-not $t.lead) { throw "$to has no agent of its own to tell." }
		}
		$was = $script:ThreadId
		try {
			Use-Thread $to
			$e = Add-Thread 'message' @{
				via = 'agent'; from = $(if ($from) { $from } else { 'conductor' })
				line = $(if ($from) { "The $from agent wrote to the conductor" } else { "The conductor wrote to this feature's agent" })
				text = $Text
			} 'agent'
		} finally { $script:ThreadId = $was }
		"$($e.id) sent to $(if ($to) { "the $to agent" } else { 'the conductor' })."
	}

	# Hooks for a conductor Rocco opened (server\conductor.ps1): wait for the user's answer in Rocco and hand it back.
	'hook' {
		# Bytes in and out, as UTF-8: the console's own encoding would garble anything past ASCII.
		$raw = New-Object IO.MemoryStream
		[Console]::OpenStandardInput().CopyTo($raw)
		$in = $Utf8.GetString($raw.ToArray()) | ConvertFrom-Json
		$out = switch ($Id) {
			'permission' { Wait-Permission $in }
			'question' { Wait-Question $in }
			'stop' { Test-ConductorStop $in }
			'codex-stop' { Wait-CodexStop $in }
			default { throw "Unknown hook '$Id'." }
		}
		if ($out) {
			$bytes = $Utf8.GetBytes($out)
			$stdout = [Console]::OpenStandardOutput()
			$stdout.Write($bytes, 0, $bytes.Length)
			$stdout.Flush()
		}
	}

	default { throw "Unknown command '$Command'. Use serve, list, show, new, suggest, plan, ask, doing, say, reply, set, work, borrow, sync, return, result, log, clear, wait or lanes." }
}
} finally { Unlock-Lanes; Unlock-Tasks }
foreach ($line in $script:SplitNote) { $line }
