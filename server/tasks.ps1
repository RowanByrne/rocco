# Workboard tasks: one folder per task in <Game>\rocco\tasks\T-NNN\, holding task.json, the user's
# screenshots, audio options, and the worker's notes.md. A feature plan is a task too (kind 'plan').

$Statuses = 'inbox', 'queued', 'working', 'stuck', 'ready', 'done', 'removed'
$Types = 'bug', 'tweak', 'idea', 'feature', 'question'
$ToConductor = 'Waiting for the conductor'
# Once the conductor has read a note (show), so the user can tell it from one it hasn't seen. {0}: the agent.
$ReadIt = 'Rocco has read it'
# What a card shows has to fit it: a title on one line, and a summary and a test the hover shows whole.
$TitleMax = 50
$WordsMax = 30

function Get-WordCount([string]$text) { @("$text" -split '\s+' | Where-Object { $_ }).Count }
# How long the app offers Undo (its toast, and a moment more), and so how long a deleted task's work waits before the
# conductor hears it should stop.
$UndoSeconds = 6
$DeletedText = '{0} was deleted on the Workboard. Stop work on it and report; the conductor cleans up.'

function Set-Field($t, [string]$name, $value) {
	if ($t.PSObject.Properties[$name]) { $t.$name = $value } else { $t | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

function Get-List($value) { @(@($value) | Where-Object { $null -ne $_ -and "$_" -ne '' }) }

function Add-Log($t, [string]$who, [string]$text) {
	$entry = [pscustomobject]@{ who = $who; at = (Now); text = $text }
	Set-Field $t 'log' (@(Get-List $t.log) + $entry)
}

function Set-Status($t, [string]$status) {
	if ($t.status -eq 'removed' -and $status -ne 'removed') { throw ($DeletedText -f $t.id) }
	# A card that needs no review (onboarding's setup) is done as soon as it's ready.
	if ($status -eq 'ready' -and $t.PSObject.Properties['auto'] -and $t.auto) {
		$status = 'done'
		if ($t.status -ne 'done') { Add-Log $t 'conductor' 'Done. It needs no review, so it approved itself.' }
	}
	if ($t.status -ne $status) {
		# Back to Up next (sent back, queued again), or a fresh start: the last attempt's progress and step go, so the
		# card's bar and its step show this attempt. Back from Stuck it carries on where it was.
		$fresh = $status -eq 'working' -and $t.status -ne 'stuck'
		if ($status -eq 'queued' -or $fresh) { Set-Field $t 'progress' $null; Set-Field $t 'step' '' }
		# Sent back: what the last attempt said it changed, and what to try, aren't this one's.
		if ($fresh -and [int]$t.attempt -gt 1) { Set-Field $t 'summary' ''; Set-Field $t 'test' '' }
		if ($fresh) { Set-Field $t 'startedAt' (Now) }
		if ($status -eq 'done') { Set-Field $t 'doneAt' (Now) }
		# Picking a task back up handles what the user asked of it; a follow-up stays until it's read (clear).
		if ($status -in 'working', 'stuck', 'ready' -and $t.pending -in 'plan', 'answer', 'reopen', 'approved', 'question') { Set-Field $t 'pending' '' }
	}
	Set-Field $t 'status' $status
}

# ---- Where to test a task: what git says, not what an agent remembers ----

# 'main' once the Main place has a task's branch (its commits are in repo\'s HEAD, which Lync serves to Main), 'branch'
# while they aren't, '' when it has no branch or git can't tell. A branch that's gone counts as in main when a merge
# naming it is (merged branches are deleted).
function Get-BranchPlace($t) {
	$b = "$($t.branch)".Trim()
	if (-not $b -or -not (Test-Path (Join-Path $RepoDir '.git'))) { return '' }
	$ErrorActionPreference = 'Continue'
	$tip = ''
	foreach ($ref in "refs/heads/$b", "refs/remotes/origin/$b") {
		$x = git -C $RepoDir rev-parse --verify -q "$ref^{commit}" 2>$null
		if ($LASTEXITCODE -eq 0 -and $x) { $tip = "$x".Trim(); break }
	}
	if ($tip) {
		git -C $RepoDir merge-base --is-ancestor $tip HEAD 2>$null
		if ($LASTEXITCODE -eq 0) { return 'main' }
		if ($LASTEXITCODE -eq 1) { return 'branch' }
		return ''
	}
	$merge = git -C $RepoDir log -1 --merges --format=%h -F "--grep=$b" HEAD 2>$null
	if ($merge) { 'main' } else { '' }
}

function Assert-TestPlace($t) {
	$place = Get-BranchPlace $t
	if ($t.where -eq 'main' -and $place -eq 'branch') {
		throw "$($t.branch) isn't in the Main place yet: its commits aren't in repo\'s main. Merge it and push it (CONDUCTOR.md `"Checking in a lane`"), git pull in repo\, then set it ready. For the user to try it before it merges: -Where lane."
	}
	if ($t.where -eq 'lane' -and $place -eq 'main') {
		throw "$($t.branch) is already merged, and the Main place has it: -Where main. Where to test is checked against git, so a card can't send the user to a lane that no longer holds the work."
	}
}

# ---- Waiting for a lane: a task the conductor parked while every lane was busy (set -ForLane) ----

$LaneWait = 'A free lane'
function Test-WaitsForLane($t) { $t.status -eq 'queued' -and $t.PSObject.Properties['waitingFor'] -and $t.waitingFor -eq 'lane' }

# This PC's lanes that no task holds, as the sidebar sees them: none at work or stuck in it, or held for testing there.
function Get-FreeLanes($tasks) {
	$held = @($tasks | Where-Object { $_.lane -and ($_.status -in 'working', 'stuck' -or ($_.where -eq 'lane' -and $_.status -in 'ready', 'queued')) } | ForEach-Object { [int]$_.lane })
	$count = [int](Get-Lanes).count
	@(if ($count) { 1..$count | Where-Object { $_ -notin $held } })
}

# Parked tasks whose lane is free: one per free lane, in Up next order, each given its lane (not saved).
function Get-LaneReady($tasks) {
	$byId = @{}; foreach ($x in $tasks) { $byId[$x.id] = $x }
	$parked = @($tasks | Where-Object { (Test-WaitsForLane $_) -and -not $_.pending -and
		-not @(Get-List $_.after | Where-Object { $byId[$_] -and $byId[$_].status -notin 'done', 'removed' }).Count } |
		Sort-Object { if ($_.order) { [int]$_.order } else { 9999 } }, id)
	if (-not $parked.Count) { return @() }
	$free = @(Get-FreeLanes $tasks)
	@(for ($i = 0; $i -lt [Math]::Min($free.Count, $parked.Count); $i++) { Set-Field $parked[$i] 'pending' 'lane'; Set-Field $parked[$i] 'freeLane' $free[$i]; $parked[$i] })
}

# Parks a task until a lane is free. What the user asked of it has been read, so wait stops returning it until then.
function Set-LaneWait($t, [string]$waiting) {
	if ($t.status -ne 'queued') { Set-Status $t 'queued' }
	Set-Field $t 'waitingFor' 'lane'
	Set-Field $t 'waiting' $(if ($waiting) { $waiting } else { $LaneWait })
	if ($t.pending -in 'plan', 'answer', 'reopen', 'approved', 'question') { Set-Field $t 'pending' '' }
}

function Clear-LaneWait($t) {
	Set-Field $t 'waitingFor' ''
	if ($t.waiting -eq $LaneWait) { Set-Field $t 'waiting' '' }
}

# The end of Up next.
function Get-NextOrder {
	1 + [int](@(Get-Tasks | Where-Object { $_.status -eq 'queued' -and $_.order }) | ForEach-Object { [int]$_.order } | Measure-Object -Maximum).Maximum
}

# Back to Up next until the conductor handles what the user asked: plan, answer or reopen.
function Send-ToConductor($t, [string]$pending) {
	if ($t.status -ne 'queued' -or -not $t.order) { Set-Field $t 'order' (Get-NextOrder) }
	Set-Status $t 'queued'
	Set-Field $t 'pending' $pending
	Set-Field $t 'waiting' $ToConductor
}

function Get-TaskDir([string]$id) {
	if ($id -notmatch '^T-\d+$') { throw "Not a task id: '$id' (expected T-012)." }
	$dir = Join-Path $TasksDir $id
	if (-not (Test-Path (Join-Path $dir 'task.json'))) { throw "No task $id in $TasksDir." }
	$dir
}

function Read-Task([string]$id) {
	[IO.File]::ReadAllText((Join-Path (Get-TaskDir $id) 'task.json'), $Utf8) | ConvertFrom-Json
}

function Save-Task($t) {
	Set-Field $t 'updated' (Now)
	[IO.File]::WriteAllText((Join-Path (Join-Path $TasksDir $t.id) 'task.json'), (ConvertTo-Json -InputObject $t -Depth 10), $Utf8)
}

function New-Task([string]$title, [string]$note, [string]$status, [string]$kind, [string]$type = '') {
	New-Item -ItemType Directory -Force $TasksDir | Out-Null
	$numbers = @(Get-ChildItem $TasksDir -Directory | Where-Object { $_.Name -match '^T-(\d+)$' } | ForEach-Object { [int]$Matches[1] })
	$next = 1 + [int]($numbers | Measure-Object -Maximum).Maximum
	$id = $null
	for ($i = 0; $i -lt 50 -and -not $id; $i++) {
		$candidate = 'T-{0:D3}' -f ($next + $i)
		try { New-Item -ItemType Directory (Join-Path $TasksDir $candidate) -ErrorAction Stop | Out-Null; $id = $candidate } catch { }
	}
	if (-not $id) { throw "Couldn't create a task folder in $TasksDir." }
	$now = Now
	$t = [pscustomobject]@{
		id = $id; title = $title; note = $note; kind = $kind; type = $type; feature = $false; status = $status; pending = ''
		attempt = 1; lane = $null; branch = ''; where = 'main'; step = ''; progress = $null; startedAt = $null
		summary = ''; test = ''; questions = @(); waiting = ''; shots = @(); after = @(); order = $null; plan = ''; steps = @()
		followups = 0; created = $now; updated = $now; doneAt = $null; log = @()
	}
	if ($status -eq 'queued') { $t.order = Get-NextOrder }
	Save-Task $t
	$t
}

# Every task, re-reading only the files that changed since the last call.
$script:TaskCache = @{}
function Get-Tasks {
	if (-not (Test-Path $TasksDir)) { return @() }
	$tasks = foreach ($f in Get-ChildItem $TasksDir -Filter 'task.json' -Recurse -Depth 1 -File) {
		$hit = $script:TaskCache[$f.FullName]
		if (-not $hit -or $hit.Stamp -ne $f.LastWriteTimeUtc.Ticks) {
			try { $hit = @{ Stamp = $f.LastWriteTimeUtc.Ticks; Task = ([IO.File]::ReadAllText($f.FullName, $Utf8) | ConvertFrom-Json) } } catch { continue }
			$script:TaskCache[$f.FullName] = $hit
		}
		$hit.Task
	}
	@($tasks)
}

# ---- Questions for the user, with options that can carry an audio file to play ----

# A question round: a new round replaces the old questions, later questions in the same round add to it.
function Add-Question($t, [string]$text, [string[]]$options, [string[]]$audio) {
	$dir = Get-TaskDir $t.id
	$opts = for ($i = 0; $i -lt @($options).Count; $i++) {
		$sound = ''
		if ($audio -and $i -lt $audio.Count -and $audio[$i]) {
			$source = $audio[$i]
			# A file from elsewhere is copied in, so the app can play it.
			if ((Test-Path -LiteralPath $source) -and -not ((Resolve-Path -LiteralPath $source).Path.StartsWith($dir))) {
				$sound = 'audio-' + [IO.Path]::GetFileName($source) -replace '[^\w.-]', '-'
				Copy-Item -LiteralPath $source -Destination (Join-Path $dir $sound) -Force
			} else { $sound = [IO.Path]::GetFileName($source) }
		}
		[pscustomobject]@{ label = $options[$i]; audio = $sound }
	}
	$question = [pscustomobject]@{ text = $text; options = @($opts) }
	$keep = if ($t.status -eq 'stuck') { Get-List $t.questions } else { @() }
	Set-Field $t 'questions' (@($keep) + $question)
}

# ---- Undo: approve, answer, queue and dismiss can be taken back for a little while ----

function Save-Undo($t) {
	Set-Field $t 'undo' ([pscustomobject]@{ status = $t.status; pending = $t.pending; waiting = $t.waiting; doneAt = $t.doneAt; order = $t.order; logCount = @(Get-List $t.log).Count; at = (Now) })
}

function Restore-Undo($t) {
	$u = $t.undo
	if (-not $u) { throw 'Nothing to undo.' }
	foreach ($name in 'status', 'pending', 'waiting', 'doneAt', 'order') { Set-Field $t $name $u.$name }
	Set-Field $t 'log' @(Get-List $t.log | Select-Object -First $u.logCount)
	Set-Field $t 'undo' $null
}

# ---- Deleting a task ----

# Work that's running, or done but not merged yet: a worker on it, a question it waits on, or a branch still to merge.
function Test-Running($t) {
	$t.status -in 'working', 'stuck' -or ($t.where -eq 'lane' -and $t.branch -and ($t.status -ne 'done' -or $t.pending -eq 'merge'))
}

# Deleted on the Workboard. Work that's running or unmerged waits on the conductor to stop and drop it ('cancel'), once
# Undo has had its chance (rocco.ps1 list -Pending); what's merged stays. $with: the plan it went with.
function Remove-Task($t, [string]$with = '') {
	Save-Undo $t
	$cancel = Test-Running $t
	Set-Status $t 'removed'
	Set-Field $t 'pending' $(if ($cancel) { 'cancel' } else { '' })
	Set-Field $t 'removedWith' $with
}

# The tasks a plan's deletion takes with it: all but what's done and merged.
function Get-PlanTasks($plan) {
	@(Get-Tasks | Where-Object { $_.plan -eq $plan.id -and $_.status -ne 'removed' -and ($_.status -ne 'done' -or $_.pending -eq 'merge') })
}

# ---- A feature plan's life: its steps are the tasks that get worked, and it follows them ----

# What a plan can't be: a card that's worked. Its steps are (new -Plan), so the board can show and count them.
$PlanNotWorked = '{0} is a feature plan: its steps are the cards that get worked, and the plan''s chip counts them. Make a task per step, new -Title "<step>" -Plan {0} [-After T-0xx], then set or ask on those. Each worker gets its step''s id.'

# A step task was just made for it (new -Plan). A plan still waiting for the user's OK is approved: the conductor makes
# its tasks only once the user has approved it, with the button or in their own words ("build it"). A plan that was
# worked as one card goes back to being the plan, its lane and step left to its tasks. A finished one opens again.
function Open-Plan([string]$id) {
	$p = Read-Task $id
	if ($p.kind -ne 'plan' -or $p.status -in 'queued', 'removed') { return }
	$was = $p.status
	Set-Status $p 'queued'
	if ($was -eq 'inbox') {
		Add-Log $p 'conductor' 'Approved in your words, so its tasks started.'
		Add-Event "Plan approved: $($p.title)" $p.id
	}
	if ($was -in 'working', 'stuck', 'ready') {
		foreach ($name in 'lane', 'progress', 'startedAt') { Set-Field $p $name $null }
		Set-Field $p 'step' ''
		Set-Field $p 'questions' @()
	}
	Save-Task $p
}

# A plan is done once the user has approved a task for each of its steps, and open again if one comes back (Undo).
function Sync-Plan([string]$id) {
	if (-not $id) { return }
	try { $p = Read-Task $id } catch { return }
	if ($p.kind -ne 'plan' -or $p.status -notin 'queued', 'done') { return }
	$kids = @(Get-Tasks | Where-Object { $_.plan -eq $id -and $_.status -ne 'removed' })
	$approved = @($kids | Where-Object { $_.status -eq 'done' }).Count
	$finished = $kids.Count -gt 0 -and $approved -eq $kids.Count -and $kids.Count -ge @(Get-List $p.steps).Count
	if ($finished -and $p.status -ne 'done') {
		Set-Status $p 'done'
		Add-Log $p 'conductor' 'Every step approved, so the feature is done.'
		Save-Task $p
		Add-Event "Feature done: $($p.title)" $p.id
	} elseif (-not $finished -and $p.status -eq 'done') {
		Set-Status $p 'queued'
		Save-Task $p
	}
}

# ---- What the user does to a task in the app ----

function Invoke-TaskAction([string]$id, [string]$action, [string]$text) {
	$t = Read-Task $id
	switch ($action) {
		'approve' {
			Save-Undo $t
			Set-Status $t 'done'
			Add-Log $t 'you' $(if ($t.kind -eq 'question') { 'Got it.' } else { 'Approved.' })
			# A feature on its own branch merges once it's approved.
			if ($t.where -eq 'lane') { Set-Field $t 'pending' 'merge' }
		}
		'reopen' {
			Set-Field $t 'attempt' ([int]$t.attempt + 1)
			# On an answered question, reopen is "ask more".
			Send-ToConductor $t $(if ($t.kind -eq 'question') { 'question' } else { 'reopen' })
			Add-Log $t 'you' $(if ($text) { $text } else { 'Not right yet.' })
		}
		'answer' {
			Save-Undo $t
			Send-ToConductor $t 'answer'
			Add-Log $t 'you' $text
		}
		# Something the agent spotted (the inbox) that the user wants done.
		'queue' {
			Save-Undo $t
			Send-ToConductor $t 'plan'
			Add-Log $t 'you' 'Queued.'
		}
		'remove' {
			Remove-Task $t
			if ($t.kind -eq 'plan') {
				foreach ($k in Get-PlanTasks $t) { $k = Read-Task $k.id; Remove-Task $k $t.id; Save-Task $k }
			}
		}
		# More from the user while the task is running; it waits until the worker or conductor reads it (clear).
		'followup' {
			if (-not $text) { throw 'A follow-up needs some text.' }
			Add-Log $t 'you' $text
			Set-Field $t 'followups' ([int]$t.followups + 1)
			if (-not $t.pending) { Set-Field $t 'pending' 'followup' }
		}
		'undo' {
			Restore-Undo $t
			# A deleted plan brings back the tasks that went with it.
			if ($t.kind -eq 'plan') {
				foreach ($k in Get-Tasks | Where-Object { $_.status -eq 'removed' -and $_.PSObject.Properties['removedWith'] -and $_.removedWith -eq $t.id -and $_.undo }) {
					$k = Read-Task $k.id; Restore-Undo $k; Set-Field $k 'removedWith' ''; Save-Task $k
				}
			}
		}
		# A feature plan: approve it, or ask for changes.
		'approve-plan' {
			Set-Status $t 'queued'
			Set-Field $t 'pending' 'approved'
			Set-Field $t 'waiting' $ToConductor
			Add-Log $t 'you' 'Approved the plan.'
		}
		'revise' {
			if (-not $text) { throw 'Say what to change.' }
			Set-Field $t 'pending' 'revise'
			Add-Log $t 'you' $text
		}
		default { throw "Unknown action '$action'." }
	}
	Save-Task $t
	# Approving a plan's last step finishes the feature; Undo opens it again.
	Sync-Plan $t.plan
}

# Everything in the inbox goes to the conductor to plan.
function Send-Inbox {
	$sent = 0
	foreach ($t in Get-Tasks | Where-Object { $_.status -eq 'inbox' -and $_.kind -ne 'plan' }) {
		$t = Read-Task $t.id
		Send-ToConductor $t 'plan'
		Save-Task $t
		$sent++
	}
	$sent
}

# The user's order for Up next. A task can't go before something it waits on (its 'after' list).
function Set-QueueOrder([string[]]$ids) {
	$position = @{}
	for ($i = 0; $i -lt $ids.Count; $i++) { $position[$ids[$i]] = $i }
	$tasks = foreach ($id in $ids) { Read-Task $id }
	foreach ($t in $tasks) {
		if ($t.status -ne 'queued') { throw "$($t.id) isn't in Up next any more." }
		foreach ($dep in Get-List $t.after) {
			if ($position.ContainsKey($dep) -and $position[$dep] -gt $position[$t.id]) { throw "$($t.id) has to come after ${dep}: it needs that done first." }
		}
	}
	for ($i = 0; $i -lt @($tasks).Count; $i++) {
		$t = @($tasks)[$i]
		Set-Field $t 'order' ($i + 1)
		Save-Task $t
	}
}
