# Workboard tasks: one folder per task in <Game>\rocco\tasks\T-NNN\, holding task.json, the user's
# screenshots, audio options, and the worker's notes.md. A feature plan is a task too (kind 'plan').

$Statuses = 'inbox', 'queued', 'working', 'stuck', 'ready', 'done', 'removed'
# fix: the user marked the note as a small fix themselves (the note box's kinds: README.md "Sorting").
$Types = 'bug', 'tweak', 'idea', 'feature', 'question', 'fix'
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
		# Time at work, across every attempt: counted from each time it turns Working to when it stops being so
		# (stuck on a question, ready, back in Up next). The card shows the total.
		if ($t.status -eq 'working' -and $t.workSince) {
			$spent = [int][Math]::Max(0, ((Get-Date) - [datetime]$t.workSince).TotalSeconds)
			Set-Field $t 'worked' ([int]$t.worked + $spent)
			Set-Field $t 'workSince' $null
		}
		if ($status -eq 'working') { Set-Field $t 'workSince' (Now) }
		# Picked up again: the user's pause is over, and what they asked of its worker is under way.
		if ($status -eq 'working') { Set-Field $t 'held' $false }
		if ($status -eq 'working' -and $t.pending -in 'resume', 'restart', 'assign') { Set-Field $t 'pending' '' }
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
	# A feature's own agent keeps its lane for the feature's life, between steps too (leads.ps1).
	$held = @($tasks | Where-Object { $_.lane -and ($_.status -in 'working', 'stuck' -or ($_.where -eq 'lane' -and $_.status -in 'ready', 'queued') -or ($_.lead -and $_.status -notin 'done', 'removed')) } | ForEach-Object { [int]$_.lane })
	$count = [int](Get-Lanes).count
	@(if ($count) { 1..$count | Where-Object { $_ -notin $held } })
}

# Parked tasks whose lane is free: one per free lane, in Up next order, each given its lane (not saved).
function Get-LaneReady($tasks) {
	$byId = @{}; foreach ($x in $tasks) { $byId[$x.id] = $x }
	$parked = @($tasks | Where-Object { (Test-WaitsForLane $_) -and -not $_.pending -and -not $_.held -and
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

# A task's folder: on the board (tasks\), or put away once it was long finished (archive\).
function Get-TaskDir([string]$id) {
	if ($id -notmatch '^T-\d+$') { throw "Not a task id: '$id' (expected T-012)." }
	foreach ($base in $TasksDir, $ArchiveDir) {
		$dir = Join-Path $base $id
		if (Test-Path (Join-Path $dir 'task.json')) { return $dir }
	}
	throw "No task $id in $TasksDir."
}

# ---- One writer at a time ----
# The server and every agent's commands change tasks at the same moment. A task read to be changed (Read-Task) is held
# until it's saved or the command ends: a lock file in its folder, open with no sharing. So a worker's log and the
# user's follow-up can't each write the whole file over the other's change. A holder that dies lets go by itself:
# Windows closes its files. Something that only looks reads with Get-Task, which holds nothing.

$script:TaskLocks = @{}   # task folder -> the open lock file
function Lock-Task([string]$dir) {
	if ($script:TaskLocks[$dir]) { return }
	$file = Join-Path $dir 'task.lock'
	for ($i = 0; $i -lt 400; $i++) {
		try {
			$script:TaskLocks[$dir] = New-Object IO.FileStream($file, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
			return
		} catch [IO.IOException] { Start-Sleep -Milliseconds 25 } catch [UnauthorizedAccessException] { Start-Sleep -Milliseconds 25 }
	}
	throw "$(Split-Path $dir -Leaf) is being changed by something else right now. Try again in a moment."
}
function Unlock-Task([string]$dir) {
	$held = $script:TaskLocks[$dir]
	if ($held) { try { $held.Close() } catch { }; $script:TaskLocks.Remove($dir) }
}
# Everything still held: the end of a request, so a read that was never saved doesn't keep its task.
function Unlock-Tasks { foreach ($dir in @($script:TaskLocks.Keys)) { Unlock-Task $dir } }

# A task file's text. Its writer swaps the new file in, so a read that lands on that instant tries again.
function Read-TaskFile([string]$file) {
	for ($i = 0; ; $i++) {
		try { return [IO.File]::ReadAllText($file, $Utf8) } catch [IO.IOException] { if ($i -ge 8) { throw }; Start-Sleep -Milliseconds 15 } catch [UnauthorizedAccessException] { if ($i -ge 8) { throw }; Start-Sleep -Milliseconds 15 }
	}
}

# A task as it is now, to look at.
function Get-Task([string]$id) {
	Read-TaskFile (Join-Path (Get-TaskDir $id) 'task.json') | ConvertFrom-Json
}

# A task to change: held from here until Save-Task (or the end of the command).
function Read-Task([string]$id) {
	$dir = Get-TaskDir $id
	Lock-Task $dir
	Read-TaskFile (Join-Path $dir 'task.json') | ConvertFrom-Json
}

# Written beside the file and swapped in, so nothing ever reads half a task, then let go of.
function Save-Task($t) {
	$dir = Join-Path $TasksDir $t.id
	if (-not (Test-Path -LiteralPath $dir)) { $dir = Join-Path $ArchiveDir $t.id }
	Lock-Task $dir
	try {
		Set-Field $t 'updated' (Now)
		$file = Join-Path $dir 'task.json'
		$new = "$file.new"
		[IO.File]::WriteAllText($new, (ConvertTo-Json -InputObject $t -Depth 10), $Utf8)
		if (-not (Test-Path -LiteralPath $file)) { [IO.File]::Move($new, $file); return }
		for ($i = 0; ; $i++) {
			try { [IO.File]::Replace($new, $file, [NullString]::Value); break } catch {
				# A reader has it open for a moment. After a second of that, write it in place as before.
				if ($i -ge 40) { [IO.File]::WriteAllText($file, [IO.File]::ReadAllText($new, $Utf8), $Utf8); Remove-Item -LiteralPath $new -Force -ErrorAction SilentlyContinue; break }
				Start-Sleep -Milliseconds 25
			}
		}
	} finally { Unlock-Task $dir }
}

function New-Task([string]$title, [string]$note, [string]$status, [string]$kind, [string]$type = '') {
	New-Item -ItemType Directory -Force $TasksDir | Out-Null
	# Numbers carry on from the highest ever used, the archive's included.
	$numbers = @(Get-ChildItem $TasksDir, $ArchiveDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^T-(\d+)$' } | ForEach-Object { [int]$Matches[1] })
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
		held = $false; wantLane = $null; wantTier = ''; worked = 0; workSince = $null; checks = @()
	}
	if ($status -eq 'queued') { $t.order = Get-NextOrder }
	Save-Task $t
	$t
}

# A task made a moment ago that has to be taken back whole (what it was made for fell through): its folder goes.
function Remove-TaskFolder([string]$id) {
	if ($id -notmatch '^T-\d+$') { return }
	$dir = Join-Path $TasksDir $id
	Unlock-Task $dir
	Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
	$script:TaskCache.Remove((Join-Path $dir 'task.json'))
}

# Every task, re-reading only the files that changed since the last call.
$script:TaskCache = @{}
function Get-Tasks {
	if (-not (Test-Path $TasksDir)) { return @() }
	Move-OldTasks
	@(Read-TaskFolder $TasksDir)
}

# Every task in a folder of tasks. One that can't be read this instant (its writer is swapping it in) is shown as it
# was a moment ago, not dropped from the board.
function Read-TaskFolder([string]$base) {
	foreach ($f in Get-ChildItem $base -Filter 'task.json' -Recurse -Depth 1 -File) {
		$hit = $script:TaskCache[$f.FullName]
		if (-not $hit -or $hit.Stamp -ne $f.LastWriteTimeUtc.Ticks) {
			try {
				$hit = @{ Stamp = $f.LastWriteTimeUtc.Ticks; Task = ([IO.File]::ReadAllText($f.FullName, $Utf8) | ConvertFrom-Json) }
				$script:TaskCache[$f.FullName] = $hit
			} catch { if (-not $hit) { continue } }
		}
		$hit.Task
	}
}

# ---- The archive: tasks finished long ago ----
# The board looks at every task each time it's asked. A task approved or deleted two weeks ago, with nothing waiting on
# it, moves to <Game>\rocco\archive\ so the board's look stays quick however long the game has run. It's still found by
# its id (show, a link to it), listed and searched in the app's archive, and comes back to the board if it's reopened.
# A feature's tasks stay until the feature itself is done, so its plan can still count them.

$ArchiveAfterDays = 14
$script:ArchivedAt = @{}   # tasks folder -> when it was last tidied (hourly at most; the first look of a run does it)
function Move-OldTasks {
	# The server's job: an agent's command only reads the board.
	if ($Command -ne 'serve') { return }
	$last = $script:ArchivedAt[$TasksDir]
	if ($last -and ((Get-Date) - $last).TotalMinutes -lt 60) { return }
	$script:ArchivedAt[$TasksDir] = Get-Date
	$old = (Get-Date).AddDays(-$ArchiveAfterDays)
	$all = @(Read-TaskFolder $TasksDir)
	$byId = @{}; foreach ($t in $all) { $byId[$t.id] = $t }
	$settled = { param($t) $t.status -in 'done', 'removed' -and -not $t.pending -and $t.updated -and [datetime]$t.updated -lt $old }
	foreach ($t in $all) {
		if (-not (& $settled $t)) { continue }
		if ($t.plan -and $byId[$t.plan] -and -not (& $settled $byId[$t.plan])) { continue }
		if ($t.kind -eq 'plan' -and @($all | Where-Object { $_.plan -eq $t.id -and -not (& $settled $_) }).Count) { continue }
		$from = Join-Path $TasksDir $t.id
		if ($script:TaskLocks[$from]) { continue }
		try {
			New-Item -ItemType Directory -Force $ArchiveDir | Out-Null
			Lock-Task $from
			try { Remove-Item -LiteralPath (Join-Path $from 'task.json.new') -Force -ErrorAction SilentlyContinue } finally { Unlock-Task $from }
			Remove-Item -LiteralPath (Join-Path $from 'task.lock') -Force -ErrorAction SilentlyContinue
			Move-Item -LiteralPath $from -Destination (Join-Path $ArchiveDir $t.id) -ErrorAction Stop
			$script:TaskCache.Remove((Join-Path $from 'task.json'))
		} catch { } # in use this instant: the next tidy takes it
	}
}

# An archived task back on the board: the user reopened it.
function Restore-Archived([string]$id) {
	$from = Join-Path $ArchiveDir $id
	if (-not (Test-Path -LiteralPath (Join-Path $from 'task.json'))) { return }
	New-Item -ItemType Directory -Force $TasksDir | Out-Null
	Move-Item -LiteralPath $from -Destination (Join-Path $TasksDir $id)
	$script:ArchiveCache = $null
}

# What the board no longer shows: approved or deleted more than a few days ago, on the board's folder or in the
# archive. Newest first, $take at a time from $skip, narrowed to tasks that have every word of $query (in the title,
# note, summary, id, branch or history).
$BoardKeepsDays = 3
$script:ArchiveCache = $null
function Get-Archive([string]$query, [int]$skip = 0, [int]$take = 50) {
	$key = "$TasksDir"
	if (-not $script:ArchiveCache -or $script:ArchiveCache.Key -ne $key -or ((Get-Date) - $script:ArchiveCache.Read).TotalSeconds -gt 20) {
		$cutoff = (Get-Date).AddDays(-$BoardKeepsDays)
		$gone = @(Get-Tasks | Where-Object { $_.status -eq 'removed' -or ($_.status -eq 'done' -and $_.doneAt -and [datetime]$_.doneAt -le $cutoff) })
		$kept = @(if (Test-Path -LiteralPath $ArchiveDir) { Read-TaskFolder $ArchiveDir })
		$rows = @(@($gone) + @($kept) | Sort-Object { if ($_.doneAt) { [datetime]$_.doneAt } elseif ($_.updated) { [datetime]$_.updated } else { [datetime]::MinValue } } -Descending)
		$script:ArchiveCache = @{ Key = $key; Read = Get-Date; Rows = $rows }
	}
	$rows = $script:ArchiveCache.Rows
	$words = @("$query".ToLower() -split '\s+' | Where-Object { $_ })
	if ($words.Count) {
		$rows = @($rows | Where-Object {
			$hay = ("$($_.id) $($_.title) $($_.note) $($_.summary) $($_.branch) $($_.type) " + ((@(Get-List $_.log) | ForEach-Object { $_.text }) -join ' ')).ToLower()
			-not @($words | Where-Object { -not $hay.Contains($_) }).Count
		})
	}
	[pscustomobject]@{ total = $rows.Count; skip = $skip; tasks = @($rows | Select-Object -Skip $skip -First $take) }
}

# ---- Questions for the user, with options that can carry an audio file to play or a picture to see ----

# A question round: a new round replaces the old questions, later questions in the same round add to it.
function Add-Question($t, [string]$text, [string[]]$options, [string[]]$audio, [string[]]$images = @(), [string[]]$show = @()) {
	$dir = Get-TaskDir $t.id
	$options = @($options | Where-Object { $_ })
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
		[pscustomobject]@{ label = $options[$i]; audio = $sound; image = '' }
	}
	$question = [pscustomobject]@{ text = $text; options = @($opts); images = @() }
	Add-Pictures $question $images $show @() $dir ''
	$keep = if ($t.status -eq 'stuck') { Get-List $t.questions } else { @() }
	Set-Field $t 'questions' (@($keep) + $question)
}

# ---- Pictures on a question: concepts to pick from, or a model to approve ----
# An option can show a picture (the garage concept to build from), and so can the question itself (the gray model,
# from the front and the side). They come from ask's -Images (one per option) and -Show (the question's), or from
# what the question says: a path to an image, or a file name from a folder it names ("the concepts are in
# ..\art\generated\garage\: garage-01 to garage-04"). Each is copied beside the question (the task's folder, or the
# conductor's files\<id>\), so it still shows when the art moves on.

$PicturePattern = '\.(png|jpe?g|gif|webp)$'

# A path as the agent wrote it: whole, or from where it ran, the repo or the game's folder. $null when there's nothing.
function Resolve-NamedPath([string]$p) {
	if (-not $p -or $p.Length -gt 260) { return $null }
	try {
		$tries = if ($p -match '^[A-Za-z]:[\\/]') { @($p) } else { @((Join-Path $PWD.ProviderPath $p), (Join-Path $RepoDir $p), (Join-Path $Root $p)) }
		foreach ($x in $tries) { if (Test-Path -LiteralPath $x) { return (Resolve-Path -LiteralPath $x).ProviderPath.TrimEnd('\') } }
	} catch { }
	$null
}

# The files and folders some text names. A path in a sentence runs on into the words after it, so each is cut back a
# word at a time until it's one that exists.
function Find-NamedPaths([string]$text) {
	if (-not $text) { return @() }
	$found = New-Object Collections.ArrayList
	$rx = [regex]'(?<![\w.\\/:-])(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\w-]+[\\/])[^\r\n"<>|*?`]*'
	$pos = 0
	for ($n = 0; $n -lt 16 -and $pos -lt $text.Length; $n++) {
		$m = $rx.Match($text, $pos)
		if (-not $m.Success) { break }
		$s = $m.Value; $hit = $null; $try = ''
		for ($k = 0; $k -lt 24 -and $s -and -not $hit; $k++) {
			$try = $s.TrimEnd(' ', '.', ',', ';', ':', ')', "'")
			$hit = Resolve-NamedPath $try
			if (-not $hit) { $cut = $try.LastIndexOfAny([char[]]' (,;'); if ($cut -le 0) { break }; $s = $try.Substring(0, $cut) }
		}
		if ($hit) { [void]$found.Add($hit); $pos = $m.Index + [Math]::Max(1, $try.Length) }
		else { $next = $text.IndexOfAny([char[]]" `t`r`n", $m.Index); $pos = if ($next -lt 0) { $text.Length } else { $next + 1 } }
	}
	@($found | Select-Object -Unique)
}

function Test-Picture([string]$p) { $p -match $PicturePattern -and (Test-Path -LiteralPath $p -PathType Leaf) -and (Get-Item -LiteralPath $p).Length -le 30MB }

# The pictures in $pool whose name (with or without its extension) the text mentions, in the order it mentions them.
function Find-PoolNames([string]$text, [string[]]$pool) {
	$hits = foreach ($f in @($pool)) {
		$stem = [IO.Path]::GetFileNameWithoutExtension($f)
		if ($stem.Length -lt 3) { continue }
		$m = [regex]::Match([string]$text, '(?<![\w-])' + [regex]::Escape($stem) + '(?![\w-])', 'IgnoreCase')
		if ($m.Success) { [pscustomobject]@{ at = $m.Index; file = $f } }
	}
	@($hits | Sort-Object at | ForEach-Object { $_.file })
}

# Fills in $q's pictures: each option's image and the question's own images, as names under $dir with $url before
# them (what the app asks for). $images: one per option, in order. $show: the question's. $extra: more text per option
# to look for paths in (AskUserQuestion's previews).
function Add-Pictures($q, [string[]]$images, [string[]]$show, [string[]]$extra, [string]$dir, [string]$url) {
	$given = {
		param($list, $what)
		@($list | Where-Object { $_ } | ForEach-Object {
			$p = Resolve-NamedPath $_
			if (-not $p -or -not (Test-Picture $p)) { throw "$what`: no picture at '$_' (a .png, .jpg, .gif or .webp under 30 MB)." }
			$p
		})
	}
	$images = @(& $given $images '-Images')
	$show = @(& $given $show '-Show')
	$opts = @($q.options)
	if ($images.Count -and $images.Count -ne $opts.Count) {
		throw "-Images is one picture per option, in order: $($opts.Count) option(s), $($images.Count) picture(s). Pictures for the question itself go in -Show."
	}
	$named = @(Find-NamedPaths $q.text)
	$folders = @($named | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
	$loose = @($named | Where-Object { Test-Picture $_ })
	$pool = @(@($folders) + @($loose | ForEach-Object { Split-Path $_ }) | Select-Object -Unique | ForEach-Object {
		Get-ChildItem -LiteralPath $_ -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $PicturePattern } |
			Sort-Object Name | Select-Object -First 40 | ForEach-Object { $_.FullName }
	})
	$tag = '{0:x4}' -f (Get-Random -Maximum 65536)
	$copied = @{}
	$copy = {
		param($p)
		if (-not $copied.ContainsKey($p)) {
			New-Item -ItemType Directory -Force $dir | Out-Null
			$name = 'pic-{0}-{1}-{2}' -f $tag, ($copied.Count + 1), ([IO.Path]::GetFileName($p) -replace '[^\w.-]', '-')
			Copy-Item -LiteralPath $p -Destination (Join-Path $dir $name) -Force
			$copied[$p] = $url + $name
		}
		$copied[$p]
	}
	$used = @{}
	for ($i = 0; $i -lt $opts.Count; $i++) {
		$o = $opts[$i]
		$say = "$($o.label) $($o.detail) $(if ($extra -and $i -lt $extra.Count) { $extra[$i] })"
		$pic = if ($images.Count) { $images[$i] } else { @(@(Find-NamedPaths $say | Where-Object { Test-Picture $_ }) + @(Find-PoolNames $say $pool))[0] }
		if ($pic) { $o.image = & $copy $pic; $used[$pic] = $true }
	}
	$own = @(@($show) + @($loose) + @(Find-PoolNames $q.text $pool) | Where-Object { $_ -and -not $used.ContainsKey($_) } | Select-Object -Unique)
	# A folder it names, with no picture picked out of it: the whole folder.
	if (-not $own.Count -and -not $used.Count -and $folders.Count) { $own = @($pool | Select-Object -First 8) }
	$q.images = @($own | Select-Object -First 8 | ForEach-Object { & $copy $_ })
}

# ---- Undo: approve, answer, queue and dismiss can be taken back for a little while ----

function Save-Undo($t) {
	Set-Field $t 'undo' ([pscustomobject]@{ status = $t.status; pending = $t.pending; waiting = $t.waiting; doneAt = $t.doneAt; order = $t.order; logCount = @(Get-List $t.log).Count; at = (Now) })
}

function Restore-Undo($t) {
	$u = $t.undo
	if (-not $u) { throw 'Nothing to undo.' }
	# Past the Undo window the conductor may already be acting on it (merging, stopping its worker): taking it back
	# here would leave the card saying one thing and the work another.
	if ($u.at -and ((Get-Date) - [datetime]$u.at).TotalSeconds -gt $UndoSeconds) { throw 'Too late to undo: it has gone to the conductor. Send it back, or write a note, to change it.' }
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
	$all = @(Get-Tasks | Where-Object { $_.plan -eq $id })
	$kids = @($all | Where-Object { $_.status -ne 'removed' })
	# A step whose task was deleted (by the user, or folded into another) is dropped, not waiting: it still counts
	# toward every step being covered, so the plan can finish.
	$dropped = $all.Count - $kids.Count
	$approved = @($kids | Where-Object { $_.status -eq 'done' }).Count
	$finished = $kids.Count -gt 0 -and $approved -eq $kids.Count -and ($kids.Count + $dropped) -ge @(Get-List $p.steps).Count
	if ($finished -and $p.status -ne 'done') {
		Set-Status $p 'done'
		Add-Log $p 'conductor' $(if ($dropped) { 'Every step approved or dropped, so the feature is done.' } else { 'Every step approved, so the feature is done.' })
		Save-Task $p
		Add-Event "Feature done: $($p.title)" $p.id
		# Its own agent has nothing left to build: its session ends, and its lane is free again.
		if ($p.lead) { Stop-Lead $p.id 'Every step is approved, so its agent''s session is closed' }
	} elseif (-not $finished -and $p.status -eq 'done') {
		Set-Status $p 'queued'
		Save-Task $p
	}
}

# ---- What the user does to a task in the app ----

$WorkerTiers = 'heavy', 'standard', 'light'

# The lane and worker the user asked for, from "lane=3 tier=heavy" (either, or both; lane=0 or tier=any: no preference).
function Set-Wanted($t, [string]$text) {
	$changed = @()
	if ($text -match '(?i)\blane\s*=\s*(\d+)') {
		$n = [int]$Matches[1]
		if ($n -gt $MostLanes) { throw "Lanes go up to $MostLanes." }
		Set-Field $t 'wantLane' $(if ($n) { $n } else { $null })
		$changed += $(if ($n) { "lane $n" } else { 'any lane' })
	}
	if ($text -match '(?i)\btier\s*=\s*([a-z]+)') {
		$tier = $Matches[1].ToLower()
		if ($tier -ne 'any' -and $tier -notin $WorkerTiers) { throw "A worker is one of: $($WorkerTiers -join ', ')." }
		Set-Field $t 'wantTier' $(if ($tier -eq 'any') { '' } else { $tier })
		$changed += $(if ($tier -eq 'any') { 'any worker' } else { "the $tier worker" })
	}
	if (-not $changed.Count) { throw 'Say which lane or worker: lane=3, tier=heavy.' }
	$changed -join ', '
}

function Invoke-TaskAction([string]$id, [string]$action, [string]$text) {
	# Something done to a task that was put away brings it back to the board first.
	if ($action -in 'reopen', 'followup') { Restore-Archived $id }
	$t = Read-Task $id
	switch ($action) {
		# ---- Stepping in on running work. The conductor runs the workers, so each of these waits on it, and
		# rocco.ps1 show tells it what to do. With no conductor running no worker is either: it takes effect here. ----
		# Pause: its worker stops, its branch stays, and it waits in Up next until the user resumes it.
		'pause' {
			if ($t.status -notin 'working', 'stuck', 'queued') { throw "$($t.id) isn't in Up next or being worked on." }
			Set-Field $t 'held' $true
			Add-Log $t 'you' 'Paused.'
			if ($t.status -in 'working', 'stuck') {
				if ((Get-Conductor).state -eq 'none') { Set-Status $t 'queued'; Set-Field $t 'pending' ''; Set-Field $t 'waiting' '' }
				else { Set-Field $t 'pending' 'stop' }
			}
		}
		'resume' {
			if (-not $t.held) { throw "$($t.id) isn't paused." }
			Set-Field $t 'held' $false
			Add-Log $t 'you' 'Resumed.'
			# Still stopping: the conductor hasn't got to it, so it just carries on. Otherwise it's picked up again.
			if ($t.pending -eq 'stop') { Set-Field $t 'pending' '' }
			elseif ($t.status -eq 'queued' -and -not $t.pending) { Send-ToConductor $t 'resume' }
		}
		# A fresh worker on it, from what the last one left.
		'restart' {
			if ($t.status -notin 'working', 'stuck') { throw "$($t.id) isn't being worked on." }
			Set-Field $t 'attempt' ([int]$t.attempt + 1)
			Set-Field $t 'held' $false
			Set-Field $t 'pending' 'restart'
			Add-Log $t 'you' $(if ($text) { "Start again with a fresh worker: $text" } else { 'Start again with a fresh worker.' })
		}
		# The lane it runs in, or the worker it gets. On running work it's moved; before it starts it's remembered.
		'assign' {
			if ($t.status -in 'done', 'removed') { throw "$($t.id) is finished." }
			$what = Set-Wanted $t $text
			Add-Log $t 'you' "Use $what."
			if ($t.status -in 'working', 'stuck') { Set-Field $t 'pending' 'assign' }
		}
		'approve' {
			Save-Undo $t
			Set-Status $t 'done'
			Add-Log $t 'you' $(if ($t.kind -eq 'question') { 'Got it.' } else { 'Approved.' })
			# A feature on its own branch merges once it's approved.
			if ($t.where -eq 'lane') { Set-Field $t 'pending' 'merge' }
			$closeLead = $t.lead -and $t.kind -ne 'plan'
		}
		# A card that keeps coming back gets an agent of its own (leads.ps1): the user works it through with that
		# agent directly, in the card's own thread. A worker still on it is the conductor's to stop first.
		'promote' {
			if ($t.kind -in 'plan', 'question') { throw "$($t.id) isn't a card of work." }
			if ($t.status -in 'done', 'removed') { throw "$($t.id) is finished." }
			if ($t.lead) { throw "$($t.id) already has an agent of its own." }
			Set-Field $t 'lead' $true
			Set-Field $t 'held' $false
			Add-Log $t 'you' 'Give it an agent of its own.'
			if ($t.status -in 'working', 'stuck' -and (Get-Conductor).state -ne 'none') { Set-Field $t 'pending' 'handoff' }
			else { Set-Field $t 'waiting' 'Opening its own agent' }
		}
		# An answer that turned out to be work: the question becomes a note in Up next, for the conductor to plan.
		'make-task' {
			if ($t.kind -ne 'question') { throw "$($t.id) isn't an answered question." }
			Set-Field $t 'kind' 'note'
			Set-Field $t 'type' ''
			Send-ToConductor $t 'plan'
			Add-Log $t 'you' $(if ($text) { $text } else { 'Make this a task.' })
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
			$closeLead = [bool]$t.lead
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
			# It's built by an agent of its own, in its own thread (leads.ps1), unless this PC turned that off.
			if (Test-LeadsOn) { Set-Field $t 'lead' $true; Set-Field $t 'waiting' 'Opening its own agent'; $newThread = $true }
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
	# A card with its own agent that's approved or deleted, or a deleted feature: that agent's session ends. What's
	# left of its work (a branch to merge, or to drop) is the conductor's.
	if ($closeLead) { Stop-Lead $t.id $(if ($action -eq 'remove') { 'Deleted, so its agent''s session is closed' } else { 'Approved, so its agent''s session is closed' }) }
	# The main chat says where the feature went.
	if ($newThread) {
		$was = $script:ThreadId
		try { Use-Thread ''; Add-Thread 'event' @{ text = "$($t.title) has its own thread now: an agent of its own builds it there"; task = $t.id } 'rocco' | Out-Null } finally { $script:ThreadId = $was }
	}
}

# ---- Checks: what the worker ran, and what came of it ----
# A worker records each test run or playtest on its card (rocco.ps1 result): whether it passed, a line saying what,
# and the output itself (the tests' report, Studio's console) kept beside the task as check-N.txt. The card shows
# them, so the user sees what was tried before they try it themselves.

$CheckKeep = 12
$CheckBytes = 200KB
function Add-Check($t, [bool]$ok, [string]$text, [string]$file) {
	$dir = Get-TaskDir $t.id
	$checks = @(Get-List $t.checks)
	$name = ''
	if ($file) {
		$source = Resolve-NamedPath $file
		if (-not $source -or -not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "-File: there's no file at '$file'." }
		$n = 1 + [int](@(Get-ChildItem -LiteralPath $dir -Filter 'check-*.txt' -File | ForEach-Object { if ($_.BaseName -match '-(\d+)$') { [int]$Matches[1] } }) | Measure-Object -Maximum).Maximum
		$name = "check-$n.txt"
		# The end of a long output is the part that says how it went.
		$bytes = [IO.File]::ReadAllBytes($source)
		if ($bytes.Length -gt $CheckBytes) {
			$tail = New-Object byte[] $CheckBytes
			[Array]::Copy($bytes, $bytes.Length - $CheckBytes, $tail, 0, $CheckBytes)
			$bytes = [byte[]]($Utf8.GetBytes("(the last $([int]($CheckBytes / 1KB)) KB of a longer output)`n") + $tail)
		}
		[IO.File]::WriteAllBytes((Join-Path $dir $name), $bytes)
	}
	$entry = [pscustomobject]@{ at = (Now); ok = $ok; text = $text; file = $name; attempt = [int]$t.attempt }
	$all = @($checks) + $entry
	# Old outputs go with the entries that named them.
	foreach ($gone in @($all | Select-Object -First ([Math]::Max(0, $all.Count - $CheckKeep)))) {
		if ($gone.file) { Remove-Item -LiteralPath (Join-Path $dir $gone.file) -Force -ErrorAction SilentlyContinue }
	}
	Set-Field $t 'checks' @($all | Select-Object -Last $CheckKeep)
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
