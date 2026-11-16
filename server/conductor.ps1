# The conductor (the template's CONDUCTOR.md): the user's agent session that handles the Workboard. Rocco knows one is
# running from <Game>\rocco\conductor.json: written when Rocco opens one, and kept fresh by `rocco.ps1 wait` while it
# watches the board. When the user hands over work and no conductor is running, Rocco opens one.

# A feature's own agent (leads.ps1) is tracked the same way, in its thread's folder: everything here works on the
# thread in use (core.ps1 Use-Thread), the conductor's when none is named.
function Get-ConductorFile { if ($script:ThreadId) { Join-Path (Get-ThreadDir) 'agent.json' } else { Join-Path $Root 'rocco\conductor.json' } }
function Get-ThreadKey { "$Root|$($script:ThreadId)" }

function Read-Conductor {
	$file = Get-ConductorFile
	if (Test-Path $file) { try { return [IO.File]::ReadAllText($file, $Utf8) | ConvertFrom-Json } catch { } }
	$null
}

function Save-Conductor($c) {
	$file = Get-ConductorFile
	New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
	[IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $c), $Utf8)
	$script:ConductorCache = @{}
}

$AgentProcesses = 'claude', 'codex', 'gemini', 'node'
# '' when it isn't running. Asked quietly: a cmdlet's stopping error is written to the log even when it's caught, and
# this is asked about a process that has gone on every look at the board.
function Get-ProcessStart([int]$id) {
	if (-not $id) { return '' }
	$p = Get-Process -Id $id -ErrorAction SilentlyContinue
	if ($p) { try { $p.StartTime.ToString('o') } catch { '' } } else { '' }
}
function Test-ProcessAlive([int]$id, [string]$started) { $id -and (Get-ProcessStart $id) -and (-not $started -or (Get-ProcessStart $id) -eq $started) }

# The agent a command runs under: the first agent program above this process (agent, shell, PowerShell, this).
function Find-AgentAbove([int]$id) {
	# A test run (ROCCO_NO_CONDUCTOR) has no agent of its own above it: what's up there is whoever started the tests,
	# perhaps the user's own agent session, and recording it would let a test's Stop or close end that session.
	if ($env:ROCCO_NO_CONDUCTOR) { return 0 }
	for ($i = 0; $i -lt 6 -and $id; $i++) {
		$p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
		if (-not $p) { break }
		if ($i -gt 0 -and [IO.Path]::GetFileNameWithoutExtension($p.Name) -in $AgentProcesses) { return [int]$p.ProcessId }
		$id = [int]$p.ParentProcessId
	}
	0
}

# The agent in a window Rocco opened: a child of the window, or of its .cmd wrapper.
function Find-AgentBelow([int]$window) {
	$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
	$level = @($window)
	for ($depth = 0; $depth -lt 3 -and $level; $depth++) {
		$kids = @($all | Where-Object { $level -contains [int]$_.ParentProcessId })
		$agent = $kids | Where-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) -in $AgentProcesses } | Select-Object -First 1
		if ($agent) { return [int]$agent.ProcessId }
		$level = @($kids | ForEach-Object { [int]$_.ProcessId })
	}
	0
}

# 'listening' (waiting on the board now), 'busy' (running, doing something), or 'none'. With what Rocco's status line
# shows (thread.ps1): what it's doing, its open questions and permission requests, and its latest message.
$script:ConductorCache = @{}
$script:HookHeard = @{}   # project -> when a hook of its conductor, or of one of its workers, last reached Rocco
$script:TurnEnded = @{}   # thread -> when its agent last ended a turn (its Stop hook)
$script:WindowAsk = @{}   # thread -> a dialog waiting in the agent's own window (Add-HookEvent): { id, text, at, agent }
$StalledMinutes = 5
function Get-Conductor {
	$hit = $script:ConductorCache[(Get-ThreadKey)]
	if ($hit -and ((Get-Date) - $hit.Read).TotalSeconds -lt 3) { return $hit.Value }
	$c = Read-Conductor
	$thread = Get-ConductorThread
	$value = [pscustomobject]@{ state = 'none'; agent = ''; doing = ''; doingAt = ''; open = $thread.open; elsewhere = $thread.elsewhere; last = $thread.last; stamp = $thread.stamp }
	if ($c) {
		# Opened by Rocco a moment ago: its agent may not have started yet.
		if (-not $c.pid -and $c.window -and (Test-ProcessAlive $c.window $c.windowStarted)) {
			$found = Find-AgentBelow $c.window
			if ($found) { $c.pid = $found; $c.started = Get-ProcessStart $found; Save-Conductor $c }
		}
		$alive = if ($c.pid) { Test-ProcessAlive $c.pid $c.started } else { $c.window -and ((Get-Date) - [datetime]$c.at).TotalSeconds -lt 60 -and (Test-ProcessAlive $c.window $c.windowStarted) }
		$fresh = $c.waiting -and ((Get-Date) - [datetime]$c.at).TotalSeconds -lt 20
		$value.agent = "$($c.agent)"
		$value.state = if ($fresh) { 'listening' } elseif ($alive) { 'busy' } else { 'none' }
		# When it last ended a turn (its Stop hook, kept on its record so a restart of Rocco doesn't lose it), and when
		# it was opened: the chat's line under a message it picked up ends with that turn (conductor.js).
		$ended = if ($c.PSObject.Properties['turnEndedAt'] -and $c.turnEndedAt) { [string]$c.turnEndedAt } elseif ($script:TurnEnded[(Get-ThreadKey)]) { ([datetime]$script:TurnEnded[(Get-ThreadKey)]).ToString('o') } else { '' }
		if ($ended) { $value | Add-Member -NotePropertyName turnEndedAt -NotePropertyValue $ended }
		$opened = if ($c.PSObject.Properties['opened'] -and $c.opened) { [string]$c.opened } else { [string]$c.started }
		if ($opened) { $value | Add-Member -NotePropertyName openedAt -NotePropertyValue $opened }
		$ask = $script:WindowAsk[(Get-ThreadKey)]
		if ($ask -and $value.state -ne 'none') { $value | Add-Member -NotePropertyName windowAsk -NotePropertyValue ([pscustomobject]@{ id = $ask.id; text = $ask.text; at = $ask.at }) }
		# Its latest step, while it's working and the step is recent.
		if ($value.state -eq 'busy' -and $thread.step -and ((Get-Date) - [datetime]$thread.step.at).TotalMinutes -lt 3) {
			$value.doing = $thread.step.text
			$value.doingAt = $thread.step.at
		}
		# Opened with Rocco's hooks, and not a word from them since: it's asking something in its own window, before any
		# hook runs (the first time an agent opens in a folder, it asks whether the user trusts it).
		if ($value.state -eq 'busy' -and $c.PSObject.Properties['hooks'] -and $c.hooks -and $c.opened) {
			$since = ((Get-Date) - [datetime]$c.opened).TotalSeconds
			$value | Add-Member -NotePropertyName inWindow -NotePropertyValue ($since -gt 20 -and (-not $thread.heard -or $thread.heard -lt [datetime]$c.opened))
		}
		# Running, not watching the board, not a word from it or its workers for a while, and something waits on it: it
		# stopped mid-way (its Stop hook lets a turn end after three tries, or it's asking in its own window). The app
		# says so and offers its window, or a restart. The user decides: a long quiet job looks the same from here.
		if ($value.state -eq 'busy') {
			$heard = @(@($thread.heard, $script:HookHeard[(Get-ThreadKey)], [datetime]$c.at) | Where-Object { $_ } | Sort-Object)[-1]
			$quiet = ((Get-Date) - $heard).TotalMinutes
			$waiting = @(Get-PendingTasks).Count + [int]$thread.pending
			$value | Add-Member -NotePropertyName stalled -NotePropertyValue ($quiet -ge $StalledMinutes -and $waiting -gt 0)
			$value | Add-Member -NotePropertyName quiet -NotePropertyValue ([int]$quiet)
			$value | Add-Member -NotePropertyName waiting -NotePropertyValue $waiting
		}
		# The model it was opened on, and what its session has used so far (sessions.ps1), when its agent keeps a
		# session file Rocco can read.
		if ($value.state -ne 'none') {
			if ($c.PSObject.Properties['model'] -and $c.model) { $value | Add-Member -NotePropertyName model -NotePropertyValue "$($c.model)" }
			if ($c.PSObject.Properties['effort'] -and $c.effort) { $value | Add-Member -NotePropertyName effort -NotePropertyValue "$($c.effort)" }
			if ($c.PSObject.Properties['transcript'] -and $c.transcript) { $value | Add-Member -NotePropertyName usage -NotePropertyValue (Get-SessionUsage ([string]$c.transcript)) }
		}
	}
	$script:ConductorCache[(Get-ThreadKey)] = @{ Read = Get-Date; Value = $value }
	$value
}

# The user's agent, opened in its own window as this project's conductor, on a first prompt. An agent that takes
# Rocco's hooks (agents.ps1) gets them, so Rocco shows what it does and the user answers it in Rocco. Returns the agent.
# $dir and $as: for a feature's own agent (leads.ps1), the lane it works in and what it's opened as. Its window carries
# ROCCO_THREAD, so every Rocco command run in it is about its own thread without having to say so.
function Open-Conductor([string]$prompt, [string]$dir = '', [string]$as = '') {
	$agent = Get-Agent
	if (-not $agent.installed) { throw "$($agent.name) isn't installed on this PC (Connections)." }
	$extra = @()
	if (-not $dir) { $dir = $RepoDir }
	$set = @{ ROCCO_THREAD = "$($script:ThreadId)" }
	$codexWatch = @()
	$hooks = [bool]$Agents[$agent.id].hooks
	if ($hooks) { $extra = $Agents[$agent.id].hooks, (Write-ConductorHooks); $prompt = "$prompt $InRocco" }
	# Codex: Rocco's Stop hook watches the board at the end of each turn, where its version supports one (codex-watch.ps1).
	if ($agent.id -eq 'codex') {
		$codexWatch = @(Get-CodexWatchArguments $dir)
		if ($codexWatch.Count) {
			$extra += $codexWatch
			$set.ROCCO_CODEX_BOARD = Join-Path $AppDir 'rocco.ps1'
			$set.ROCCO_CODEX_DIR = $dir
		}
	}
	$prompt = "$prompt $(Get-WatchText ([bool]$codexWatch.Count))"
	# The model the user picked for the conductor in Settings, for an agent that takes one on its command line.
	if ($agent.model -and $Agents[$agent.id].model) { $extra += $Agents[$agent.id].model, $agent.model }
	# And how hard it thinks.
	$effort = if ($agent.effort -and $Agents[$agent.id].effort) { $agent.effort } else { '' }
	if ($effort) { $extra += $Agents[$agent.id].effort, $effort }
	if (-not $as) { $as = "conductor on $(Split-Path $Root -Leaf)" }
	# Its window inherits Rocco's PATH: with anything installed since Rocco started (FFmpeg from Connections, say).
	Update-EnvPath
	$window = Start-AgentWindow $dir $prompt "$($agent.name), $as" $extra $set
	Save-Conductor ([pscustomobject]@{ agent = $agent.name; window = $window.Id; windowStarted = (Get-ProcessStart $window.Id); pid = 0; started = ''; waiting = $false; at = (Now)
		hooks = $hooks; opened = (Now); model = "$($agent.model)"; effort = $effort; transcript = ''; session = '' })
	$on = @($(if ($agent.model -and $Agents[$agent.id].model) { $agent.model }), $effort) | Where-Object { $_ }
	Add-Event "Rocco opened $($agent.name) $(if ($script:ThreadId) { 'on this' } else { 'as the conductor' })$(if ($on) { " ($($on -join ', '))" })"
	$agent
}

# Ends the conductor's session: its window and everything started in it (the agent, its workers, their commands).
# Returns whether anything was running.
function Stop-Conductor {
	$c = Read-Conductor
	if (-not $c) { return $false }
	# Its window goes with it, so no PowerShell is left open behind it: the one recorded, else the window Rocco opened
	# around it (a record a `wait` rewrote has only the agent). An agent in a terminal of the user's own leaves that open.
	$id = if ($c.window -and (Test-ProcessAlive $c.window $c.windowStarted)) { [int]$c.window }
		elseif ($c.pid -and (Test-ProcessAlive $c.pid $c.started)) { $w = Get-AgentWindow $c.pid; if ($w) { $w } else { [int]$c.pid } }
		else { 0 }
	if ($id) { try { & taskkill.exe /T /F /PID $id 2>$null | Out-Null } catch { } }
	Remove-Item -LiteralPath (Get-ConductorFile) -Force -ErrorAction SilentlyContinue
	$script:ConductorCache = @{}
	[bool]$id
}

# The user's way out when the conductor has stopped answering: its session is ended and a new one opened, which picks
# the work up from the board and the lanes (Request-Conductor). Returns the agent opened, or ''.
function Restart-Conductor {
	if (Stop-Conductor) { Add-Event 'You restarted the conductor'; Start-Sleep -Milliseconds 700 }
	Request-Conductor
}

# Told to a conductor that has Rocco's hooks. Also how Rocco knows its own prompt when the hook passes it on.
$InRocco = 'Rocco shows the user what you do, your messages, your questions (AskUserQuestion) and permission prompts, so talk to them as usual: they read Rocco, not this window. What they write to you comes back through wait, as a [message]. To ask them something, ask it once, with AskUserQuestion, and put any reasons in the question itself: don''t write the same thing out as a message first.'

# Claude Code's settings for a conductor Rocco opens (--settings), so only that session and its workers load them:
#   PermissionRequest, and PreToolUse on AskUserQuestion: rocco.ps1 hook waits for the user's answer in Rocco
#   PreToolUse (every tool), Stop, UserPromptSubmit, SubagentStop: the step, its last message, what the user typed in
#   its window, or a worker's session ending, sent straight to Rocco (an http hook: Claude Code posts the hook's JSON
#   itself, so nothing is started for it. A hook that ran a program started PowerShell on every tool call of the
#   conductor and of each worker). Rocco not running, or busy: the hook gives up in a moment and nothing is held up
#   Notification: a dialog in its own window no hook can answer (Add-HookEvent), so the app says where to answer it
#   Stop: rocco.ps1 hook stop keeps it from ending a turn while something waits on it, or with no wait watching the board
# Written at each launch, so its paths follow the RoDev folder wherever it is.

# Whether this PC's Claude Code can post a hook itself. Checked on 2.1.317; the hooks reference describes http
# hooks' fields as of 2.1.295, so anything older, or a version that can't be read, gets the script instead.
function Test-HttpHooks {
	try {
		$said = Read-Quick (Start-Quick (Find-AgentExe 'claude') '--version') 6000
		if ("$($said.out)" -match '(\d+\.\d+\.\d+)') { return [version]$Matches[1] -ge [version]'2.1.295' }
	} catch { }
	$false
}

function Write-ConductorHooks {
	$id = Split-Path $Root -Leaf
	$exe = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File'
	# A feature's own agent: its hooks name its thread, so its questions and steps show in that feature's chat.
	$feature = if ($script:ThreadId) { " -Thread $($script:ThreadId)" } else { '' }
	$t = if ($script:ThreadId) { "&t=$($script:ThreadId)" } else { '' }
	$wait = { param($hook) "$exe `"$((Join-Path $AppDir 'rocco.ps1').Replace('\', '/'))`" hook $hook -Project `"$id`"$feature" }
	$command = { param($text) [ordered]@{ type = 'command'; command = $text; timeout = $HookWait + 120 } }
	$post = if (Test-HttpHooks) {
		{ param($event) [ordered]@{ type = 'http'; url = "http://localhost:$Port/api/conductor/hook?p=$([uri]::EscapeDataString($id))&e=$event$t"; headers = [ordered]@{ 'X-Rocco' = '1' }; timeout = 3 } }
	} else {
		# A Claude Code from before http hooks: the same posts, made by a small script in the background.
		{ param($event) [ordered]@{ type = 'command'; command = "$exe `"$((Join-Path $AppDir 'server\hook-post.ps1').Replace('\', '/'))`" -Event $event -Project `"$id`" -Port $Port$feature"; async = $true } }
	}
	$settings = [ordered]@{ hooks = [ordered]@{
		PermissionRequest = @([ordered]@{ hooks = @(& $command (& $wait 'permission')) })
		PreToolUse = @(
			[ordered]@{ matcher = 'AskUserQuestion'; hooks = @(& $command (& $wait 'question')) },
			[ordered]@{ matcher = '*'; hooks = @(& $post 'tool') }
		)
		Stop = @([ordered]@{ hooks = @((& $post 'stop'), (& $command (& $wait 'stop'))) })
		UserPromptSubmit = @([ordered]@{ hooks = @(& $post 'prompt') })
		SubagentStop = @([ordered]@{ hooks = @(& $post 'worker-stop') })
		Notification = @([ordered]@{ hooks = @(& $post 'notify') })
	}
	# Its status line hands Rocco the plan's 5-hour and weekly limits (sessions.ps1 Save-Limits), and shows what Rocco
	# answers: those two, as the sidebar does. curl.exe comes with Windows, and is light enough to run after each message.
	statusLine = [ordered]@{ type = 'command'; command = "curl.exe -s -m 2 -H `"X-Rocco: 1`" -H `"Content-Type: application/json`" --data-binary `"@-`" http://localhost:$Port/api/limits"; padding = 0 }
	}
	$file = Join-Path (Get-ThreadDir) 'claude-settings.json'
	New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
	[IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $settings -Depth 10), $Utf8)
	$file
}

# What the agent's own program puts into a session as if it were typed: a notice that background work finished, a
# worker handing back its report, a reminder. They open with a tag of their own (<task-notification>, <agent-message
# from="...">, <system-reminder>): none of it is the user's words.
$NotTyped = '^\s*<[a-z]+(-[a-z]+)+[\s>]'

# What the agent wrote in its window earlier in the turn that just ended, before the message it ended on: read from
# Claude Code's session file. An answer written there, followed by a few commands and a short last line, would
# otherwise never reach the chat (2026-11-16: the user asked how the road's sides are built, the conductor explained it
# in its window, then ended on "The worker is still running", and the chat showed only that). Only what reads as a
# message ($TurnTextMin characters or more): the short lines between its commands ("Reading the road code") are its
# steps. The end of the file is read, back to where the turn began: what the user typed, or a notice that started it.
$TurnTextMin = 280
$TurnTailBytes = 2MB
function Get-TurnTexts([string]$path, [string]$last) {
	if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return @() }
	try {
		$bytes = Read-Shared $path ([Math]::Max(0, (Get-Item -LiteralPath $path).Length - $TurnTailBytes))
		$lines = $Utf8.GetString($bytes) -split "`n"
	} catch { return @() }
	$texts = New-Object Collections.Generic.List[string]
	for ($i = $lines.Count - 1; $i -ge 0; $i--) {
		$line = $lines[$i]
		if ($line -match '^\{"parentUuid"' -or $line -match '"type":"(user|assistant)"') {
			if ($line -match '"isSidechain":true') { continue } # a helper's
			# A stop check that kept the turn going (Rocco's own) began what came after it: what came before was
			# posted when it stopped then. Any other line marked meta is a reminder, inside the turn.
			if ($line -match '"isMeta":true') { if ($line -match 'Stop hook feedback') { break }; continue }
			if ($line -match '"type":"user"') {
				# A command's result is part of the turn. Anything else from the user's side began it.
				if ($line -match '"tool_use_id"') { continue }
				break
			}
			if ($line -notmatch '"type":"text"') { continue }
			try { $entry = $line | ConvertFrom-Json } catch { continue }
			foreach ($block in @($entry.message.content)) {
				if ($block.type -eq 'text' -and "$($block.text)".Trim()) { $texts.Insert(0, "$($block.text)".Trim()) }
			}
		}
	}
	@($texts | Where-Object { $_.Length -ge $TurnTextMin -and $_ -ne $last.Trim() })
}

# What a hook passed on: a step, the conductor's message at the end of a turn, or something the user typed in its
# window. Its workers' steps are left out (their cards show them), but a worker's hooks still say it's alive, and
# which task its session is for (sessions.ps1).
function Add-HookEvent([string]$event, $in) {
	$key = Get-ThreadKey
	$script:HookHeard[$key] = Get-Date
	# A dialog in the agent's own window that no hook can answer: Claude Code's "Read outside the working directories?",
	# a sandboxed command's network request, an MCP server asking for input. Its Notification hook (about six seconds
	# into the dialog) is the only word of it, so the app says where to answer it. A request Rocco is already showing
	# (its PermissionRequest hook waits on it) is answered in Rocco, so that one isn't said twice.
	if ($event -eq 'notify') {
		if ("$($in.notification_type)" -notin 'permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input') { return }
		if (@((Get-ThreadState).open | Where-Object { $_.kind -eq 'permission' }).Count) { return }
		$text = "$($in.message)".Trim()
		if (-not $text) { $text = 'It needs your answer' }
		$script:WindowAsk[$key] = [pscustomobject]@{ id = New-ThreadId; text = $text; at = (Get-Date).ToString('o'); agent = "$($in.agent_id)" }
		$script:ConductorCache = @{}
		return
	}
	# Anything else from the same agent means the dialog was answered and it moved on (no hook says so itself).
	$ask = $script:WindowAsk[$key]
	if ($ask -and ($ask.agent -eq "$($in.agent_id)" -or $event -eq 'stop')) { $script:WindowAsk.Remove($key); $script:ConductorCache = @{} }
	if ($in.agent_id) { Add-WorkerEvent $event $in; return }
	# The conductor's own session file, from the first hook that names it: its usage is read from there.
	if ($in.transcript_path) {
		$c = Read-Conductor
		if ($c -and "$($c.transcript)" -ne [string]$in.transcript_path) {
			$c | Add-Member -Force -NotePropertyName transcript -NotePropertyValue ([string]$in.transcript_path)
			$c | Add-Member -Force -NotePropertyName session -NotePropertyValue ([string]$in.session_id)
			Save-Conductor $c
		}
	}
	switch ($event) {
		'tool' { Add-Activity (Get-ToolSummary ([string]$in.tool_name) $in.tool_input) }
		'stop' {
			$text = "$($in.last_assistant_message)".Trim()
			if (-not $text) { break }
			# The same short line it ended its last turn on ("Watching." after every look at the board) says nothing
			# new: within the hour it's kept once.
			$items = @(Get-Thread)
			$last = $items | Where-Object { $_.kind -eq 'said' } | Select-Object -Last 1
			$again = $last -and $text.Length -le 40 -and "$($last.text)".Trim() -eq $text -and ((Get-Date) - [datetime]$last.at).TotalMinutes -lt 60
			# It already told the user this turn (reply on a note, say): the message it ends on is that again, in other
			# words, for its own window. The turn began when it last ended one, or (after a restart of Rocco) after the
			# last message it ended on or the user's last message.
			$from = -1
			for ($i = $items.Count - 1; $i -ge 0; $i--) {
				$e = $items[$i]
				if (($e.kind -eq 'said' -and $e.via -eq 'hook') -or ($e.kind -eq 'message' -and $e.who -eq 'you')) { $from = $i; break }
			}
			$since = $script:TurnEnded[$key]
			$script:TurnEnded[$key] = Get-Date
			$c = Read-Conductor
			if ($c) { $c | Add-Member -Force -NotePropertyName turnEndedAt -NotePropertyValue (Now); Save-Conductor $c; $script:ConductorCache = @{} }
			$told = @($items | Select-Object -Skip ($from + 1) | Where-Object { $_.kind -eq 'said' -and (-not $since -or [datetime]$_.at -gt $since) }).Count
			if (-not $told) {
				# What it wrote earlier this turn that reads as a message (Get-TurnTexts), then what it ended on.
				# Never one the chat already has: what an earlier stop in the same turn posted, or a say.
				$posted = @{}; foreach ($x in @($items | Select-Object -Last 200)) { if ($x.kind -eq 'said') { $posted["$($x.text)".Trim()] = $true } }
				foreach ($earlier in @(Get-TurnTexts ([string]$in.transcript_path) $text)) {
					if (-not $posted.ContainsKey($earlier)) { Add-Thread 'said' @{ text = $earlier; via = 'hook' } | Out-Null; $posted[$earlier] = $true }
				}
				if (-not $again) { Add-Thread 'said' @{ text = $text; via = 'hook' } | Out-Null }
			}
		}
		'prompt' {
			$text = "$($in.prompt)".Trim()
			# Rocco's own prompts, and what the agent's program puts in by itself, aren't the user's.
			if ($text -and -not $text.Contains($InRocco) -and $text -notmatch $NotTyped) { Add-Thread 'message' @{ text = $text; via = 'terminal' } 'you' | Out-Null }
		}
	}
}

# Brings the conductor's window up: for a permission request its hook stopped waiting on, answered there.
function Show-ConductorWindow {
	if (-not ('Rocco.Win' -as [type])) {
		Add-Type -Namespace Rocco -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);'
	}
	$c = Read-Conductor
	foreach ($start in @($c.window, $c.pid) | Where-Object { $_ }) {
		$id = [int]$start
		# The window belongs to the agent's console, or to whatever started it.
		for ($i = 0; $i -lt 5 -and $id; $i++) {
			$p = Get-Process -Id $id -ErrorAction SilentlyContinue
			if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
				[void][Rocco.Win]::ShowWindow($p.MainWindowHandle, 9)
				[void][Rocco.Win]::SetForegroundWindow($p.MainWindowHandle)
				return $true
			}
			$id = [int](Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue).ParentProcessId
		}
	}
	$false
}

# What every conductor Rocco opens is told after its first job: keep watching the board. Rocco's README has the command,
# so this works whatever template release the game is on.
# Where Rocco is from where the agent runs: the conductor in repo\, a feature's own agent in its lane.
function Get-ToolsPath { if ($script:ThreadId) { '..\..\..\_tools\rocco' } else { '..\..\_tools\rocco' } }
function Get-WaitCommand([string]$agent = 'claude') {
	$wait = "$(Get-ToolsPath)\rocco.ps1 wait"
	if ($agent -eq 'claude') {
		return "$wait as a background command (run_in_background, with no -Timeout). Handle what it lists when it returns, then start it again"
	}
	if ($agent -eq 'codex') {
		return "$wait -Timeout 540 with exec_command. If it returns a session ID, poll it with write_stdin until the command exits. Keep the turn open while waiting. Handle what it lists and start the next wait, including after a timeout"
	}
	"$wait -Timeout 540 and wait for it to exit. Handle what it lists and start the next wait, including after a timeout"
}
function Get-WatchText([bool]$codexHook = $false) {
	if ($codexHook) { return 'After handling what is pending, finish your turn. The Rocco Stop hook watches this Workboard thread and continues your turn when something waits on you.' }
	$wait = Get-WaitCommand (Get-Agent).id
	if ($script:ThreadId) { "Then keep watching for what the user sends you. Run $wait. See $(Get-ToolsPath)\LEAD.md." }
	else { "Then keep watching the Workboard. Run $wait. See ..\..\_tools\rocco\README.md, Commands." }
}

# Tasks left Working with nothing running them: a conductor that stopped mid-round (its window closed, the PC
# restarted), and the workers it ran with it. A feature's own agent is asked about its own tasks, the conductor
# about the rest.
function Get-CutOff {
	$tasks = @(Get-Tasks)
	$byId = @{}; foreach ($x in $tasks) { $byId[$x.id] = $x }
	@($tasks | Where-Object { $_.status -eq 'working' -and (Get-TaskOwner $_ $byId $true) -eq $script:ThreadId })
}

# The user handed something over (a note, an answer, a plan to approve), or work was cut off. No conductor running: open
# one on it. Work that was cut off is picked up from the board and the lanes: an agent's old session may not have been
# saved, so a new one starts from what's on disk. Returns the agent's name when one was opened, else ''.
function Request-Conductor {
	# ROCCO_NO_CONDUCTOR: a test run, which must never open the user's agent.
	if ($env:ROCCO_NO_CONDUCTOR) { return '' }
	# A feature's thread: its own agent (leads.ps1).
	if ($script:ThreadId) { return (Request-Lead) }
	if ((Get-Conductor).state -ne 'none') { return '' }
	$agent = Get-Agent
	if (-not $agent.installed) { return '' }
	$cut = @(Get-CutOff)
	$prompt = if ($cut.Count) {
		"Your conductor session for this game stopped mid-round, and its workers with it: $(($cut | ForEach-Object { $_.id }) -join ', ') are still Working on the Workboard. " +
		'Check each one''s lane (its branch, commits and uncommitted work), make sure its place is open and syncing (..\..\_tools\rocco\rocco.ps1 lanes opens whatever isn''t), and carry them on (docs/workflow/CONDUCTOR.md). ' +
		'Handle anything else waiting on you too (rocco.ps1 list -Pending).'
	} else { 'You are the conductor for this game (docs/workflow/CONDUCTOR.md). Handle what waits on you on the Workboard (..\..\_tools\rocco\rocco.ps1 list -Pending).' }
	# What Rocco itself adds to the conductor's job, whatever the game's template says (README.md "Sorting").
	$prompt += ' Sort each new note first, as ..\..\_tools\rocco\README.md "Sorting" says. Answer questions, handle errands, assign fixes, and plan features. A feature the user approves may get its own agent in a lane. Follow any game-specific workflow in docs/game/PROJECT.md when deciding how to delegate and when to merge.'
	if (Test-RequiresLaneApproval) { $prompt += ' Every game code fix goes to a worker in a lane at the task''s tier, including small fixes. Put the checked result up for the user to try in that lane. Merge only when the user approves that card.' }
	try { Open-Conductor $prompt | Out-Null; $agent.name } catch { '' }
}

# Whether a wait is watching the board: one just started may take a few seconds to say so.
function Wait-ForWatch([int]$seconds) {
	$until = (Get-Date).AddSeconds($seconds)
	while ($true) {
		$c = Read-Conductor
		if ($c -and $c.waiting -and ((Get-Date) - [datetime]$c.at).TotalSeconds -lt 20) { return $true }
		if ((Get-Date) -ge $until) { return $false }
		Start-Sleep -Seconds 1
	}
}

# rocco.ps1 wait: marks the conductor as listening while it waits, so Rocco shows it, and doesn't open another.
$script:WaitAgent = $null
function Register-Waiting([bool]$waiting) {
	$c = Read-Conductor
	if ($null -eq $script:WaitAgent) { $script:WaitAgent = Find-AgentAbove $PID }
	$agentPid = $script:WaitAgent
	if (-not $c -or ($agentPid -and $c.pid -ne $agentPid)) {
		$c = [pscustomobject]@{ agent = (Get-Agent).name; window = 0; windowStarted = ''; pid = $agentPid; started = (Get-ProcessStart $agentPid); waiting = $waiting; at = (Now) }
	}
	$c.waiting = $waiting
	$c.at = Now
	Save-Conductor $c
}
