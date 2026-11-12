# The conductor's thread (README.md "The conductor in Rocco"): what the conductor and the user say to each other, and
# what the conductor is doing, in <Game>\rocco\conductor\. Writers only ever append a line, so the server, the agent's
# commands and Claude Code's hooks can all write at once.
#   thread.jsonl    messages, questions, answers, permission requests and decisions, milestones, handled marks
#   activity.jsonl  the conductor's steps: the status line, and the history's folded steps
#
# A thread line: { id, at, who (conductor, you, rocco), kind, ... }. Kinds:
#   said        the conductor's message: text [, task, re]
#   asked       its question(s): questions [{ text, header, options [{ label, detail, image }], multi, images }],
#               via (hook, command). image and images are pictures in files\<id>\, as <id>/<file>
#   answered    the user's answer: to (the asked id), answers [one per question], text
#   permission  a permission request (Claude Code): tool, text, detail, worker
#   decided     the user's decision on one: to, allow
#   expired     a hook stopped waiting: to. A question then waits for wait; a permission is answered in the agent's window
#   message     the user wrote to the conductor: text [, to (what it replies to)], via (rocco, terminal)
#   sent        the user did something on the Workboard that goes to the conductor: act, text, task
#   event       a milestone: text [, task]
#   handled     the conductor has read it: to

# The conductor's thread is the main chat. A feature with its own agent (leads.ps1), or a card given one, has a thread
# of its own, with the same files, in <Game>\rocco\threads\<its id>\. Which one is meant is core.ps1's Use-Thread.
function Get-ThreadDir { if ($script:ThreadId) { Join-Path $Root "rocco\threads\$($script:ThreadId)" } else { Join-Path $Root 'rocco\conductor' } }

# The thread a task's news belongs in: its feature's, or its own when it has an agent of its own, else the main chat.
function Get-OwnerThread([string]$taskId) {
	try { $t = Get-Task $taskId } catch { return '' }
	if ($t.lead) { return "$($t.id)" }
	if ($t.plan) { try { if ((Get-Task $t.plan).lead) { return "$($t.plan)" } } catch { } }
	''
}

# Runs $run with that thread as the one in use, then puts back the one that was.
function Invoke-InTaskThread([string]$taskId, [scriptblock]$run) {
	$was = $script:ThreadId
	try { $script:ThreadId = Get-OwnerThread $taskId; & $run } finally { $script:ThreadId = $was }
}
function Get-ThreadFile { Join-Path (Get-ThreadDir) 'thread.jsonl' }
function Get-ActivityFile { Join-Path (Get-ThreadDir) 'activity.jsonl' }

function New-ThreadId { 'C-{0:x6}' -f (Get-Random -Maximum 16777216) }

# A question's pictures (tasks.ps1 Add-Pictures), served as /files/conductor/<id>/<file>.
function Get-AskFilesDir([string]$id) { Join-Path (Get-ThreadDir) "files\$id" }

# One line, appended in a single write that Windows keeps whole when several processes append at once.
function Add-Line([string]$file, $entry) {
	New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
	$bytes = $Utf8.GetBytes((ConvertTo-Json -InputObject $entry -Depth 8 -Compress) + "`n")
	# Long enough to sit out the weekly trim, which holds the file to itself while it rewrites it (Limit-Thread).
	for ($i = 0; $i -lt 200; $i++) {
		try {
			$fs = New-Object IO.FileStream($file, [IO.FileMode]::Append, [Security.AccessControl.FileSystemRights]::AppendData, [IO.FileShare]::ReadWrite, 4096, [IO.FileOptions]::None)
			try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Close() }
			return
		} catch [IO.IOException] { Start-Sleep -Milliseconds 25 }
	}
	throw "Couldn't write to $file."
}

# Adds a thread line, filling in its id, time and who. Returns it.
function Add-Thread([string]$kind, [hashtable]$fields, [string]$who = 'conductor') {
	$entry = [ordered]@{ id = (New-ThreadId); at = (Now); who = $who; kind = $kind }
	foreach ($k in $fields.Keys) { $entry[$k] = $fields[$k] }
	Add-Line (Get-ThreadFile) $entry
	[pscustomobject]$entry
}

# A milestone. One about a task goes in the thread that task belongs to.
function Add-Event([string]$text, [string]$task = '') {
	if ($task) { Invoke-InTaskThread $task { Add-Thread 'event' @{ text = $text; task = $task } 'rocco' | Out-Null } }
	else { Add-Thread 'event' @{ text = $text; task = '' } 'rocco' | Out-Null }
}

# A step: the status line while it's working.
function Add-Activity([string]$text) {
	if ($text) { Add-Line (Get-ActivityFile) ([ordered]@{ at = (Now); text = $text }) }
}

# A file's lines, parsed, re-reading only what was added since the last call (lines are only ever appended; a file
# that shrank was trimmed, and is read again from the start).
$script:LineCache = @{}
function Read-Lines([string]$file) {
	if (-not (Test-Path -LiteralPath $file)) { return @() }
	$length = (Get-Item -LiteralPath $file).Length
	$hit = $script:LineCache[$file]
	if ($hit -and $hit.Length -eq $length) { return $hit.Items }
	if (-not $hit -or $length -lt $hit.Length) { $hit = @{ Length = 0; Items = New-Object Collections.ArrayList } }
	# Held for a moment by the weekly trim (Edit-Lines): wait it out, and failing that, show what was read last time.
	$fs = $null
	for ($i = 0; $i -lt 80 -and -not $fs; $i++) {
		try { $fs = New-Object IO.FileStream($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite) } catch [IO.IOException] { Start-Sleep -Milliseconds 25 }
	}
	if (-not $fs) { return $hit.Items }
	try {
		$length = $fs.Length
		if ($length -lt $hit.Length) { $hit = @{ Length = 0; Items = New-Object Collections.ArrayList } }
		[void]$fs.Seek($hit.Length, [IO.SeekOrigin]::Begin)
		$bytes = New-Object byte[] ($length - $hit.Length)
		$read = 0
		while ($read -lt $bytes.Length) { $n = $fs.Read($bytes, $read, $bytes.Length - $read); if ($n -le 0) { break }; $read += $n }
	} finally { $fs.Close() }
	# Up to the last whole line: one still being written is read next time.
	$end = if ($read -gt 0) { [Array]::LastIndexOf($bytes, [byte]10, $read - 1) } else { -1 }
	if ($end -ge 0) {
		foreach ($line in $Utf8.GetString($bytes, 0, $end + 1) -split "`n") {
			if ($line.Trim()) { try { [void]$hit.Items.Add(($line | ConvertFrom-Json)) } catch { } }
		}
		$hit.Length += $end + 1
	}
	$script:LineCache[$file] = $hit
	$hit.Items
}

function Get-Thread { @(Read-Lines (Get-ThreadFile)) }
function Get-Activity { @(Read-Lines (Get-ActivityFile)) }

# What's open, pending and said, worked out from the lines that came after.
function Get-ThreadState {
	$items = Get-Thread
	$answered = @{}; $decided = @{}; $expired = @{}; $handled = @{}; $asked = @{}
	foreach ($e in $items) {
		switch ($e.kind) {
			'answered' { $answered[$e.to] = $e }
			'decided' { $decided[$e.to] = $e }
			'expired' { $expired[$e.to] = $e }
			'handled' { $handled[$e.to] = $true }
			'asked' { $asked[$e.id] = $e }
		}
	}
	$open = @($items | Where-Object {
		($_.kind -eq 'asked' -and -not $answered.ContainsKey($_.id)) -or
		($_.kind -eq 'permission' -and -not $decided.ContainsKey($_.id) -and -not $expired.ContainsKey($_.id))
	})
	# A permission its hook gave up on is answered in the agent's own window: Rocco says so for a while.
	$cutoff = (Get-Date).AddMinutes(-30)
	$elsewhere = @($items | Where-Object { $_.kind -eq 'permission' -and $expired.ContainsKey($_.id) -and -not $decided.ContainsKey($_.id) -and [datetime]$expired[$_.id].at -gt $cutoff })
	# What waits on the conductor: messages, and answers no hook is waiting to hand over.
	$pending = @($items | Where-Object {
		-not $handled.ContainsKey($_.id) -and (
			($_.kind -eq 'message' -and $_.via -ne 'terminal') -or
			($_.kind -eq 'answered' -and $asked.ContainsKey($_.to) -and ($asked[$_.to].via -ne 'hook' -or $expired.ContainsKey($_.to)))
		)
	})
	[pscustomobject]@{ items = $items; open = $open; elsewhere = $elsewhere; pending = $pending; asked = $asked; expired = $expired }
}

function Find-ThreadItem([string]$id) {
	$e = Get-Thread | Where-Object { $_.id -eq $id } | Select-Object -First 1
	if (-not $e) { throw "No $id in this game's conductor thread." }
	$e
}

# ---- What the conductor is doing, in a few words, from a tool call (Claude Code's hooks) ----

function Get-ToolSummary([string]$tool, $in) {
	$leaf = { param($p) if ($p) { Split-Path ([string]$p) -Leaf } else { '' } }
	$short = { param($s, $n) $s = ([string]$s -split "`r?`n")[0].Trim(); if ($s.Length -gt $n) { $s.Substring(0, $n - 1) + '...' } else { $s } }
	switch -Regex ($tool) {
		# Its own Rocco commands (claiming a note, moving a card, watching the board) are Rocco's bookkeeping: the board
		# shows what came of them, so they're not steps the user reads.
		'^(Bash|PowerShell)$' { if ("$($in.command)" -match 'rocco\.ps1') { return '' }; if ($in.description) { return (& $short $in.description 90) }; return "Running $(& $short $in.command 70)" }
		'^Read$' { return "Reading $(& $leaf $in.file_path)" }
		'^(Edit|MultiEdit)$' { return "Editing $(& $leaf $in.file_path)" }
		'^Write$' { return "Writing $(& $leaf $in.file_path)" }
		'^NotebookEdit$' { return "Editing $(& $leaf $in.notebook_path)" }
		'^(Grep|Glob)$' { return "Searching for $(& $short $in.pattern 50)" }
		'^(Task|Agent)$' { return "Starting a worker: $(& $short $in.description 70)" }
		'^WebFetch$' { try { return "Reading $(([uri][string]$in.url).Host)" } catch { return 'Reading a web page' } }
		'^WebSearch$' { return "Looking up $(& $short $in.query 60)" }
		'^(TodoWrite|Task(Create|Update|List|Get|Output|Stop)|AskUserQuestion|ToolSearch|Skill)$' { return '' }
		'^mcp__(.+?)__(.+)$' {
			$server, $name = $Matches[1], ($Matches[2] -replace '_', ' ')
			if ($server -match 'Studio') { return "Using Studio: $name" }
			return "Using ${server}: $name"
		}
	}
	$tool
}

# A permission request, said for the user: what it wants to do, and the exact command or file.
function Get-PermissionText([string]$tool, $in) {
	$what = Get-ToolSummary $tool $in
	if (-not $what) { $what = if ("$($in.command)" -match 'rocco\.ps1') { 'Run a Rocco command' } else { $tool } }
	$detail = switch -Regex ($tool) {
		'^(Bash|PowerShell)$' { [string]$in.command }
		'^(Read|Edit|MultiEdit|Write)$' { [string]$in.file_path }
		'^(WebFetch)$' { [string]$in.url }
		default { try { (ConvertTo-Json -InputObject $in -Depth 4 -Compress) } catch { '' } }
	}
	if ($detail.Length -gt 600) { $detail = $detail.Substring(0, 597) + '...' }
	[pscustomobject]@{ text = $what; detail = $detail }
}

# ---- Trimming: kept to the last few days, once per Rocco run per game ----

$script:Trimmed = @{}

# Rewrites a file of appended lines with only the lines $keep says yes to. The file is held with no sharing from the
# read to the write, so a line another process appends meanwhile waits (Add-Line tries again) and isn't lost between
# the two. $keep is quick (no JSON parsing): it runs while everything else that writes here waits.
function Edit-Lines([string]$file, [scriptblock]$filter) {
	$fs = $null
	for ($i = 0; $i -lt 80 -and -not $fs; $i++) {
		try { $fs = New-Object IO.FileStream($file, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) } catch [IO.IOException] { Start-Sleep -Milliseconds 25 }
	}
	if (-not $fs) { return } # busy: the next Rocco run trims it
	try {
		$bytes = New-Object byte[] $fs.Length
		$read = 0
		while ($read -lt $bytes.Length) { $n = $fs.Read($bytes, $read, $bytes.Length - $read); if ($n -le 0) { break }; $read += $n }
		$lines = @($Utf8.GetString($bytes, 0, $read) -split "`n" | Where-Object { $_.Trim() })
		$kept = @(& $filter $lines)
		$out = $Utf8.GetBytes($(if ($kept.Count) { ($kept -join "`n") + "`n" } else { '' }))
		$fs.SetLength(0)
		$fs.Write($out, 0, $out.Length)
	} finally { $fs.Close() }
	$script:LineCache.Remove($file)
}

function Limit-Thread {
	if ($script:Trimmed[$Root]) { return }
	$script:Trimmed[$Root] = $true
	$keepFrom = (Get-Date).AddDays(-7)
	$activity = Get-ActivityFile
	if ((Test-Path $activity) -and (Get-Item $activity).Length -gt 1MB) {
		Edit-Lines $activity { param($lines) $lines | Select-Object -Last 3000 }
	}
	$thread = Get-ThreadFile
	if ((Test-Path $thread) -and (Get-Item $thread).Length -gt 1MB) {
		# Old lines go, except whatever is still open or pending and the lines that settle it.
		$s = Get-ThreadState
		$needed = @{}
		foreach ($e in @($s.open) + @($s.pending)) { $needed[$e.id] = $true; if ($e.to) { $needed[$e.to] = $true } }
		$stamp = $keepFrom.ToUniversalTime()
		Edit-Lines $thread {
			param($lines)
			foreach ($line in $lines) {
				$id = if ($line -match '"id":"(C-[0-9a-f]+)"') { $Matches[1] } else { '' }
				$to = if ($line -match '"to":"(C-[0-9a-f]+)"') { $Matches[1] } else { '' }
				$fresh = $false
				if ($line -match '"at":"([^"]+)"') { try { $fresh = ([datetime]$Matches[1]).ToUniversalTime() -gt $stamp } catch { } }
				if ($fresh -or ($id -and $needed.ContainsKey($id)) -or ($to -and $needed.ContainsKey($to))) { $line }
			}
		}
	}
	# Pictures for questions past the history's week, unless the question is still open.
	$files = Join-Path (Get-ThreadDir) 'files'
	if (Test-Path -LiteralPath $files) {
		$old = @(Get-ChildItem -LiteralPath $files -Directory | Where-Object { $_.LastWriteTime -lt $keepFrom.AddDays(-1) })
		if ($old.Count) {
			$open = @{}
			foreach ($e in @((Get-ThreadState).open)) { $open[$e.id] = $true }
			$old | Where-Object { -not $open.ContainsKey($_.Name) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
		}
	}
}

# ---- What the history shows ----

# The thread and steps of the last few days, and a stamp that changes when either does.
function Get-ConductorHistory {
	Limit-Thread
	$since = (Get-Date).AddDays(-7)
	$items = @(Get-Thread | Where-Object { $_.kind -ne 'handled' -and [datetime]$_.at -gt $since } | Select-Object -Last 400)
	$steps = @(Get-Activity | Where-Object { [datetime]$_.at -gt $since } | Select-Object -Last 2000)
	[pscustomobject]@{ stamp = (Get-HistoryStamp); items = $items; steps = $steps }
}

function Get-HistoryStamp {
	$len = { param($f) if (Test-Path -LiteralPath $f) { (Get-Item -LiteralPath $f).Length } else { 0 } }
	"$(& $len (Get-ThreadFile)).$(& $len (Get-ActivityFile))"
}

# For the status line: what's open, its latest step and message, and whether the user has replied since.
function Get-ConductorThread {
	$s = Get-ThreadState
	$step = Get-Activity | Select-Object -Last 1
	$last = $s.items | Where-Object { $_.kind -eq 'said' } | Select-Object -Last 1
	$replied = $last -and @($s.items | Where-Object { $_.who -eq 'you' -and [datetime]$_.at -gt [datetime]$last.at }).Count -gt 0
	# When the agent last did anything Rocco heard about (a hook, a command): not Rocco, and not the user in Rocco.
	$heard = @(@($s.items | Where-Object { $_.who -eq 'conductor' -or $_.via -eq 'terminal' } | Select-Object -Last 1) + @($step) | Where-Object { $_ } | ForEach-Object { [datetime]$_.at } | Sort-Object)
	[pscustomobject]@{
		open = @($s.open | ForEach-Object { $_ | Select-Object *, @{ n = 'expired'; e = { $s.expired.ContainsKey($_.id) } } })
		elsewhere = @($s.elsewhere)
		step = $step
		last = $(if ($last) { [pscustomobject]@{ id = $last.id; at = $last.at; text = $last.text; replied = [bool]$replied } } else { $null })
		heard = $(if ($heard.Count) { $heard[-1] } else { $null })
		pending = @($s.pending).Count
		stamp = (Get-HistoryStamp)
	}
}

# ---- The conductor's side, for rocco.ps1 wait, list -Pending and show ----

function Format-ThreadItem($e, $s) {
	$one = { param($t) $t = (([string]$t) -replace '\s+', ' ').Trim(); if ($t.Length -gt 160) { $t.Substring(0, 157) + '...' } else { $t } }
	if ($e.kind -eq 'message') { return '{0}  [message]  {1}' -f $e.id, (& $one $e.text) }
	$q = $s.asked[$e.to]
	$question = if ($q) { (@($q.questions) | ForEach-Object { $_.text }) -join ' / ' } else { '' }
	'{0}  [answer]   {1} -> {2}' -f $e.id, (& $one $question), (& $one ((@($e.answers) | Where-Object { "$_" }) -join ' / '))
}

function Show-ThreadItem([string]$id) {
	$s = Get-ThreadState
	$e = Find-ThreadItem $id
	$time = ([datetime]$e.at).ToString('HH:mm')
	switch ($e.kind) {
		'message' {
			"$($e.id)  message from $(if ($e.who -eq 'rocco') { 'Rocco itself (Fix lanes)' } else { 'the user' }), $time$(if ($e.to) { ", replying to $($e.to)" })"
			$e.text
		}
		'answered' {
			$q = $s.asked[$e.to]
			"$($e.id)  the user's answer to $($e.to), $time"
			if ($q) { $i = 0; foreach ($question in @($q.questions)) { "Q: $($question.text)"; "A: $(@($e.answers)[$i])"; $i++ } }
			if ($e.text -and -not $q) { $e.text }
		}
		default { "$($e.id)  $($e.kind), $time"; if ($e.text) { $e.text } }
	}
	if ($s.pending | Where-Object { $_.id -eq $id }) { "Waiting on you: clear $id once you've taken it in." }
}

# ---- Claude Code's hooks, for a conductor Rocco opened: the user answers in Rocco, and the hook hands it back ----

# How long a hook waits for the user before the agent's own dialog asks instead (conductor.ps1 gives Claude Code a
# little longer, so the hook always answers first).
$HookWait = 1200

function Wait-ThreadReply([string]$id, [string]$kind, [int]$seconds) {
	$deadline = (Get-Date).AddSeconds($seconds)
	while ($true) {
		$hit = Get-Thread | Where-Object { $_.kind -eq $kind -and $_.to -eq $id } | Select-Object -First 1
		if ($hit) { return $hit }
		if ((Get-Date) -gt $deadline) { return $null }
		Start-Sleep -Milliseconds 500
	}
}

# PermissionRequest: Allow or Deny from Rocco. No answer in time: nothing, so the terminal's dialog asks.
function Wait-Permission($in) {
	$p = Get-PermissionText ([string]$in.tool_name) $in.tool_input
	$e = Add-Thread 'permission' @{ tool = [string]$in.tool_name; text = $p.text; detail = $p.detail; worker = [bool]$in.agent_id }
	$decision = Wait-ThreadReply $e.id 'decided' $HookWait
	if (-not $decision) { Add-Thread 'expired' @{ to = $e.id } 'rocco' | Out-Null; return '' }
	$d = if ($decision.allow) { @{ behavior = 'allow' } } else {
		@{ behavior = 'deny'; message = "The user said no to this in Rocco. Don't work around it: if you still need it, ask them why (AskUserQuestion)." }
	}
	ConvertTo-Json -Compress -Depth 6 @{ hookSpecificOutput = @{ hookEventName = 'PermissionRequest'; decision = $d } }
}

# PreToolUse on AskUserQuestion: the questions show in Rocco, and the user's answers go back as the tool's answers.
# No answer in time: the question stays open in Rocco, and its answer comes through wait later.
function Wait-Question($in) {
	$id = New-ThreadId
	$qs = @(@($in.tool_input.questions) | ForEach-Object {
		$q = [ordered]@{ text = [string]$_.question; header = [string]$_.header; multi = [bool]$_.multiSelect
			options = @(@($_.options) | ForEach-Object { [ordered]@{ label = [string]$_.label; detail = [string]$_.description; image = '' } }); images = @() }
		# The pictures it names show with it (tasks.ps1 Add-Pictures). One that can't be found is left out.
		try { Add-Pictures $q @() @() @(@($_.options) | ForEach-Object { [string]$_.preview }) (Get-AskFilesDir $id) "$id/" } catch { }
		$q
	})
	$e = Add-Thread 'asked' @{ id = $id; questions = $qs; via = 'hook' }
	$answer = Wait-ThreadReply $e.id 'answered' $HookWait
	if (-not $answer) {
		Add-Thread 'expired' @{ to = $e.id } 'rocco' | Out-Null
		$reason = "The user hasn't answered yet. Your question stays open in Rocco, above their note box, and their answer comes back through rocco.ps1 wait as an [answer]. Carry on with whatever doesn't need it; don't ask again."
		return ConvertTo-Json -Compress -Depth 6 @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } }
	}
	Add-Thread 'handled' @{ to = $answer.id } | Out-Null
	$map = [ordered]@{}
	for ($i = 0; $i -lt $qs.Count; $i++) { $map[$qs[$i].text] = [string]@($answer.answers)[$i] }
	$updated = $in.tool_input
	$updated | Add-Member -NotePropertyName answers -NotePropertyValue ([pscustomobject]$map) -Force
	ConvertTo-Json -Compress -Depth 10 @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'allow'; updatedInput = $updated } }
}

# What the user did on the Workboard that goes to the conductor (a note, an answer, a send-back, an approval), for its
# history.
function Add-Sent([string]$act, $t, [string]$text = '') {
	Invoke-InTaskThread $t.id { Add-Thread 'sent' @{ act = $act; task = $t.id; title = $t.title; text = $text } 'you' | Out-Null }
}
