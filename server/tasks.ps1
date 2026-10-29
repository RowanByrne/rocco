# Workboard tasks: one folder per task in <Game>\rocco\tasks\T-NNN\, holding task.json, the user's
# screenshots and the worker's notes.md.

$Statuses = 'inbox', 'queued', 'working', 'stuck', 'ready', 'done', 'removed'
$ToConductor = 'Waiting for the conductor'

function Set-Field($t, [string]$name, $value) {
	if ($t.PSObject.Properties[$name]) { $t.$name = $value } else { $t | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

function Add-Log($t, [string]$who, [string]$text) {
	$entry = [pscustomobject]@{ who = $who; at = (Now); text = $text }
	Set-Field $t 'log' (@(@($t.log) | Where-Object { $_ }) + $entry)
}

function Set-Status($t, [string]$status) {
	if ($t.status -ne $status) {
		if ($status -eq 'working') { Set-Field $t 'startedAt' (Now) }
		if ($status -eq 'done') { Set-Field $t 'doneAt' (Now) }
		# Picking a task back up handles whatever the user asked of it.
		if ($status -in 'working', 'stuck', 'ready') { Set-Field $t 'pending' '' }
	}
	Set-Field $t 'status' $status
}

# Back to Up next until the conductor handles what the user asked: plan, answer or reopen.
function Send-ToConductor($t, [string]$pending) {
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
	[IO.File]::WriteAllText((Join-Path (Join-Path $TasksDir $t.id) 'task.json'), (ConvertTo-Json -InputObject $t -Depth 8), $Utf8)
}

function New-Task([string]$title, [string]$note, [string]$status, [string]$kind) {
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
		id = $id; title = $title; note = $note; kind = $kind; feature = $false; status = $status; pending = ''
		attempt = 1; lane = $null; branch = ''; where = 'main'; step = ''; startedAt = $null
		summary = ''; test = ''; question = ''; options = @(); waiting = ''; shots = @()
		created = $now; updated = $now; doneAt = $null; log = @()
	}
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

# What the user does to a task in the app.
function Invoke-TaskAction([string]$id, [string]$action, [string]$text) {
	$t = Read-Task $id
	switch ($action) {
		'approve' {
			Set-Status $t 'done'
			Add-Log $t 'you' 'Approved.'
			# A feature on its own branch merges once it's approved.
			if ($t.where -eq 'lane') { Set-Field $t 'pending' 'merge' }
		}
		'reopen' {
			Set-Field $t 'attempt' ([int]$t.attempt + 1)
			Send-ToConductor $t 'reopen'
			Add-Log $t 'you' $(if ($text) { $text } else { 'Not right yet.' })
		}
		'answer' {
			Send-ToConductor $t 'answer'
			Add-Log $t 'you' $text
		}
		'remove' { Set-Status $t 'removed' }
	}
	Save-Task $t
}

# Every note in the inbox goes to the conductor to plan.
function Send-Inbox {
	$sent = 0
	foreach ($t in Get-Tasks | Where-Object { $_.status -eq 'inbox' }) {
		$t = Read-Task $t.id
		Send-ToConductor $t 'plan'
		Save-Task $t
		$sent++
	}
	$sent
}
