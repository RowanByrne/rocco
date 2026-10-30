# Workboard tasks: one folder per task in <Game>\rocco\tasks\T-NNN\, holding task.json, the user's
# screenshots, audio options, and the worker's notes.md. A feature plan is a task too (kind 'plan').

$Statuses = 'inbox', 'queued', 'working', 'stuck', 'ready', 'done', 'removed'
$Types = 'bug', 'tweak', 'idea', 'feature', 'question'
$ToConductor = 'Waiting for the conductor'

function Set-Field($t, [string]$name, $value) {
	if ($t.PSObject.Properties[$name]) { $t.$name = $value } else { $t | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

function Get-List($value) { @(@($value) | Where-Object { $null -ne $_ -and "$_" -ne '' }) }

function Add-Log($t, [string]$who, [string]$text) {
	$entry = [pscustomobject]@{ who = $who; at = (Now); text = $text }
	Set-Field $t 'log' (@(Get-List $t.log) + $entry)
}

function Set-Status($t, [string]$status) {
	if ($t.status -ne $status) {
		if ($status -eq 'working') { Set-Field $t 'startedAt' (Now) }
		if ($status -eq 'done') { Set-Field $t 'doneAt' (Now) }
		# Picking a task back up handles what the user asked of it; a follow-up stays until it's read (clear).
		if ($status -in 'working', 'stuck', 'ready' -and $t.pending -in 'plan', 'answer', 'reopen', 'approved', 'question') { Set-Field $t 'pending' '' }
	}
	Set-Field $t 'status' $status
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

# ---- Undo: approve, queue and dismiss can be taken back for a little while ----

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
			Send-ToConductor $t 'answer'
			Add-Log $t 'you' $text
		}
		# Something Claude spotted (the inbox) that the user wants done.
		'queue' {
			Save-Undo $t
			Send-ToConductor $t 'plan'
			Add-Log $t 'you' 'Queued.'
		}
		'remove' {
			Save-Undo $t
			Set-Status $t 'removed'
		}
		# More from the user while the task is running; it waits until the worker or conductor reads it (clear).
		'followup' {
			if (-not $text) { throw 'A follow-up needs some text.' }
			Add-Log $t 'you' $text
			Set-Field $t 'followups' ([int]$t.followups + 1)
			if (-not $t.pending) { Set-Field $t 'pending' 'followup' }
		}
		'undo' { Restore-Undo $t }
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
