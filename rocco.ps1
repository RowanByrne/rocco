# Rocco (README.md): serves the app for every project in this RoDev folder, and gives the agent the commands that
# keep a project's Workboard current. Installed once, in <RoDev>\_tools\rocco. Tasks live outside git, in
# <Game>\rocco\tasks\T-NNN\. Commands act on the project the current folder is in (a game's repo\ or a lane), or on
# -Project <folder name>; from a game's repo\, run them as ..\..\_tools\rocco\rocco.ps1.
#
#   rocco.ps1 start [-Project Game]    serve Rocco in the background, with no window (Rocco.bat), and open that project
#   rocco.ps1 [serve] [-Open] [-Project Game]   serve Rocco on http://localhost:34860/ in this window (opening that project)
#   rocco.ps1 list [-Pending]          this project's open tasks; -Pending: only what waits on the conductor
#   rocco.ps1 show T-012               one task in full: note, screenshots, questions, follow-ups, history
#   rocco.ps1 new -Title "..." [-Type bug] [-Plan T-020] [-After T-011,T-012]   add a task to Up next; prints its id
#   rocco.ps1 suggest -Title "..." [-Summary "why"]   put something you spotted in the inbox, for the user to queue or dismiss
#   rocco.ps1 plan -Title "..." -Summary "..." -Steps "Trade window UI|4|standard","Trade service|6|heavy" [-Spec docs/game/features/trading.md]
#                                      a feature plan for the user to approve; prints its id. -Spec: the feature's spec,
#                                      which the card links (set -Spec changes it)
#   rocco.ps1 ask T-012 -Question "..." -Options "A","B" [-Audio a.ogg,b.ogg]   ask the user (the task turns Stuck).
#                                      Options are a few words each; the detail goes in the question
#   rocco.ps1 ask -Question "..." [-Options "A","B"]   with no task: the conductor asks the user, above their note box;
#                                      wait returns the answer ([answer] C-xxxxxx)
#   rocco.ps1 doing "Merging the trade window"   what the conductor is doing now: Rocco's status line
#   rocco.ps1 say -Text "..."          a message to the user (a report, anything you'd tell them): Rocco's history
#   rocco.ps1 reply T-012 -Text "..."   answer a question the user asked (shows under the note box)
#   rocco.ps1 set T-012 -Status working -Lane 3 -Step "Coding" [-Progress 40] [-Branch agent/x]
#   rocco.ps1 set T-012 -Status ready -Where main -Summary "what changed" -Test "Drive a lap","Drift the hairpin"
#                                      what a card shows has to fit it: a title is 50 characters at most (one line), a
#                                      task's summary and its test (the steps to try) 30 words each. The detail goes in log
#   rocco.ps1 set T-020 -Summary "..." -Steps "...|4|standard"   a revised feature plan: new summary and steps
#   rocco.ps1 log T-012 -Text "..." [-Who conductor]
#   rocco.ps1 clear T-012              what the user asked of it (plan, answer, reopen, merge, cancel, follow-ups) is handled
#   rocco.ps1 show C-1a2b3c / clear C-1a2b3c   a message or answer the user sent the conductor; clear: it's read
#   rocco.ps1 wait [-Timeout 540]      the conductor watching the board: returns when something waits on it (as list
#                                      -Pending), or after -Timeout seconds. Rocco shows it listening meanwhile
#   rocco.ps1 hook permission|question  Claude Code's hooks, for a conductor Rocco opened (server\conductor.ps1)
#   rocco.ps1 lanes [-Count 3]         open this PC's lanes: makes any missing lane, the Main and lane places, starts
#                                      Lync for each (no window) and opens them in Studio. -Count: record this PC's number first
param(
	[Parameter(Position = 0)] [string]$Command = 'serve',
	[Parameter(Position = 1)] [string]$Id,
	[string]$Title, [string]$Note, [string]$Status, [int]$Lane = -1, [string]$Branch, [string]$Where,
	[string]$Step, [string]$Summary, [string[]]$Test, [string]$Question, [string[]]$Options, [string[]]$Audio, [string]$Waiting,
	[string]$Type, [int]$Progress = -1, [string[]]$After, [int]$Order = -1, [string]$Plan, [string[]]$Steps,
	[string]$Who = 'worker', [string]$Text, [switch]$Feature, [switch]$Pending, [switch]$Open, [int]$Port = 34860,
	[string]$Project, [string]$Spec, [int]$Timeout = 0, [int]$Count = -1,
	[switch]$Restart # started by a Rocco that just updated itself: wait for its port, and don't open another tab
)
$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot
foreach ($part in 'core', 'agents', 'tasks', 'thread', 'projects', 'conductor', 'lanes', 'connections', 'history', 'docs', 'actions', 'accounts', 'onboarding', 'roblox', 'updates', 'thumbnails', 'http') { . (Join-Path $AppDir "server\$part.ps1") }

function Format-Time($iso) { if ($iso) { ([datetime]$iso).ToString('HH:mm') } else { '' } }

# Tasks as list shows them, in Up next order.
function Format-Tasks($rows) {
	foreach ($t in $rows | Sort-Object { if ($_.status -eq 'queued' -and $_.order) { [int]$_.order } else { 9999 } }, id) {
		$laneText = if ($t.lane) { "L$($t.lane)" } else { '-' }
		$wants = if ($t.pending) { "[$($t.pending)]" } else { '' }
		$extra = @()
		if ($t.kind -eq 'plan') { $extra += 'PLAN' }
		if ($t.kind -eq 'question') { $extra += 'QUESTION: answer with reply' }
		if ($t.plan) { $extra += "in $($t.plan)" }
		if (@(Get-List $t.after).Count) { $extra += "after $((Get-List $t.after) -join ',')" }
		'{0,-6} {1,-8} {2,-4} {3,-10} {4}{5}' -f $t.id, $t.status, $laneText, $wants, $t.title, $(if ($extra) { "  ($($extra -join '; '))" })
	}
}

# What waits on the conductor: what the user asked of a task, until it's handled. A deleted task waits only to be stopped
# (cancel), once the app's Undo has had its chance.
function Get-PendingTasks {
	$undoGone = (Get-Date).AddSeconds(-$UndoSeconds)
	@(Get-Tasks | Where-Object { $_.pending -and ($_.status -ne 'removed' -or ($_.pending -eq 'cancel' -and (-not $_.undo -or [datetime]$_.undo.at -lt $undoGone))) })
}

# Everything that waits on the conductor, as list -Pending and wait print it: tasks, then what the user sent it.
function Write-Pending($rows, $thread) {
	if (@($rows).Count) { Format-Tasks $rows }
	foreach ($e in $thread.pending) { Format-ThreadItem $e $thread }
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
	if ($Plan) { Read-Task $Plan | Out-Null; Set-Field $t 'plan' $Plan }
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
		foreach ($q in Get-List $t.questions) { "Question:   $($q.text)  [$((@($q.options) | ForEach-Object { $_.label + $(if ($_.audio) { " ($($_.audio))" }) }) -join ' | ')]" }
		if ($t.waiting) { "Waiting:    $($t.waiting)" }
		if ([int]$t.followups) { "Follow-ups: $($t.followups) from the user since the last clear (latest 'you' lines below)" }
		$notes = Join-Path $dir 'notes.md'
		"Notes:      $notes$(if (-not (Test-Path $notes)) { ' (none yet)' })"
		if (@(Get-List $t.log).Count) {
			'History:'
			foreach ($e in $t.log) { '  {0}  {1,-9} {2}' -f (Format-Time $e.at), $e.who, $e.text }
		}
		# A note for the conductor to take on: Up next tells the user it's been read, and the conductor what comes first.
		if ($t.pending -eq 'plan' -and $t.status -eq 'queued') {
			if ($t.waiting -eq $ToConductor) { Set-Field $t 'waiting' ($ReadIt -f (Get-Agent).short); Save-Task $t }
			''
			"Taking it on? First: set $($t.id) -Title `"<a few words>`" -Status working -Step `"...`", so it leaves Up next. Several unrelated requests in it: a task each (new -Title `"...`" -Note `"<their words>`"), not a plan."
		}
	}

	'new' {
		if (-not $Title) { throw 'new needs -Title.' }
		Assert-CardText $false
		$t = New-Task $Title $(if ($Note) { $Note } else { $Title }) $(if ($Status) { $Status } else { 'queued' }) 'task'
		Set-Common $t
		if ($Waiting) { Set-Field $t 'waiting' $Waiting }
		Save-Task $t
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
			$q = [ordered]@{ text = $Question; header = ''; multi = $false; options = @($Options | Where-Object { $_ } | ForEach-Object { [ordered]@{ label = $_; detail = '' } }) }
			$e = Add-Thread 'asked' @{ questions = @($q); via = 'command' }
			"$($e.id) asked, above the user's note box. Their answer comes back through wait, as an [answer]."
		} else {
			$t = Read-Task $Id
			Add-Question $t $Question @($Options) @($Audio)
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
		Assert-CardText ($t.kind -ne 'plan' -and -not ($t.PSObject.Properties['auto'] -and $t.auto))
		$before = $t.status
		if ($Status) {
			if ($Status -notin $Statuses) { throw "Status must be one of: $($Statuses -join ', ')." }
			Set-Status $t $Status
		}
		if ($Where -and $Where -notin 'main', 'lane') { throw "Where must be 'main' (merged, test in Main) or 'lane' (on its branch, test in the lane's place)." }
		foreach ($name in 'Title', 'Branch', 'Where', 'Step', 'Summary', 'Waiting') {
			if ($PSBoundParameters.ContainsKey($name)) { Set-Field $t $name.ToLower() $PSBoundParameters[$name] }
		}
		if ($PSBoundParameters.ContainsKey('Test')) { Set-Field $t 'test' (Join-Steps) }
		# One question in one go; ask adds more, with audio.
		if ($Question) { Set-Field $t 'questions' @(); Add-Question $t $Question @($Options) @($Audio) }
		if ($Lane -ge 0) { Set-Field $t 'lane' $(if ($Lane -eq 0) { $null } else { $Lane }) }
		if ($Progress -ge 0) { Set-Field $t 'progress' ([Math]::Min(100, $Progress)) }
		# A revised feature plan (the user asked for changes): its new steps.
		if ($Steps) { Set-Field $t 'steps' (ConvertTo-Steps $Steps) }
		if ($Order -ge 0) { Set-Field $t 'order' $Order }
		Set-Common $t
		Save-Task $t
		# Milestones for the conductor's history in Rocco.
		if ($t.status -ne $before) {
			switch ($t.status) {
				'working' { Add-Event "$(if ($t.lane) { "Started in lane $($t.lane)" } else { 'Started' }): $($t.title)" $t.id }
				'ready' { Add-Event "Ready to test: $($t.title)" $t.id }
				'done' { if ($t.PSObject.Properties['auto'] -and $t.auto) { Add-Event "Done: $($t.title)" $t.id } }
			}
		}
		"$($t.id) $($t.status)"
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
		Set-Field $t 'summary' $Text
		Set-Status $t 'ready'
		Set-Field $t 'pending' ''
		Set-Field $t 'waiting' ''
		Add-Log $t $(if ($PSBoundParameters.ContainsKey('Who')) { $Who } else { 'conductor' }) $Text
		Save-Task $t
		Add-Thread 'said' @{ text = $Text; task = $t.id; re = $t.title } | Out-Null
	}

	'clear' {
		if ($Id -match '^C-') { Find-ThreadItem $Id | Out-Null; Add-Thread 'handled' @{ to = $Id } | Out-Null; break }
		$t = Read-Task $Id
		switch ($t.pending) {
			'merge' { Add-Event "Merged into Main: $($t.title)" $t.id }
			'cancel' { Add-Event "Stopped deleted work: $($t.title)" $t.id }
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
			default { throw "Unknown hook '$Id'." }
		}
		if ($out) {
			$bytes = $Utf8.GetBytes($out)
			$stdout = [Console]::OpenStandardOutput()
			$stdout.Write($bytes, 0, $bytes.Length)
			$stdout.Flush()
		}
	}

	default { throw "Unknown command '$Command'. Use serve, list, show, new, suggest, plan, ask, doing, say, reply, set, log, clear, wait or lanes." }
}
