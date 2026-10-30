# Rocco (rocco\README.md): serves the app for every project in this RoDev folder, and gives Claude the
# commands that keep a project's Workboard current. Tasks live outside git, in <Game>\rocco\tasks\T-NNN\.
#
#   rocco.ps1 [serve] [-Open]          serve Rocco on http://localhost:34860/
#   rocco.ps1 list [-Pending]          this project's open tasks; -Pending: only what waits on the conductor
#   rocco.ps1 show T-012               one task in full: note, screenshots, questions, follow-ups, history
#   rocco.ps1 new -Title "..." [-Type bug] [-Plan T-020] [-After T-011,T-012]   add a task to Up next; prints its id
#   rocco.ps1 suggest -Title "..." [-Summary "why"]   put something you spotted in the inbox, for the user to queue or dismiss
#   rocco.ps1 plan -Title "..." -Summary "..." -Steps "Trade window UI|4|standard","Trade service|6|heavy"
#                                      a feature plan for the user to approve; prints its id
#   rocco.ps1 ask T-012 -Question "..." -Options "A","B" [-Audio a.ogg,b.ogg]   ask the user (the task turns Stuck)
#   rocco.ps1 reply T-012 -Text "..."   answer a question the user asked (shows under the note box)
#   rocco.ps1 set T-012 -Status working -Lane 3 -Step "Coding" [-Progress 40] [-Branch agent/x]
#   rocco.ps1 log T-012 -Text "..." [-Who conductor]
#   rocco.ps1 clear T-012              what the user asked of it (plan, answer, reopen, merge, follow-ups) is handled
param(
	[Parameter(Position = 0)] [string]$Command = 'serve',
	[Parameter(Position = 1)] [string]$Id,
	[string]$Title, [string]$Note, [string]$Status, [int]$Lane = -1, [string]$Branch, [string]$Where,
	[string]$Step, [string]$Summary, [string]$Test, [string]$Question, [string[]]$Options, [string[]]$Audio, [string]$Waiting,
	[string]$Type, [int]$Progress = -1, [string[]]$After, [int]$Order = -1, [string]$Plan, [string[]]$Steps,
	[string]$Who = 'worker', [string]$Text, [switch]$Feature, [switch]$Pending, [switch]$Open, [int]$Port = 34860
)
$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot
foreach ($part in 'core', 'tasks', 'projects', 'connections', 'history', 'http') { . (Join-Path $AppDir "server\$part.ps1") }

function Format-Time($iso) { if ($iso) { ([datetime]$iso).ToString('HH:mm') } else { '' } }

# The fields new and set share.
function Set-Common($t) {
	if ($Type) {
		if ($Type -notin $Types) { throw "Type must be one of: $($Types -join ', ')." }
		Set-Field $t 'type' $Type
	}
	if ($Plan) { Read-Task $Plan | Out-Null; Set-Field $t 'plan' $Plan }
	if ($PSBoundParameters.ContainsKey('After') -or $After) { Set-Field $t 'after' @($After | ForEach-Object { $_ -split ',' } | Where-Object { $_ -match '^T-\d+$' }) }
	if ($Feature) { Set-Field $t 'feature' $true }
}

switch ($Command) {
	'serve' { Start-Rocco }

	'list' {
		$rows = @(Get-Tasks | Where-Object { ($_.status -notin 'done', 'removed') -or $_.pending })
		if ($Pending) { $rows = @($rows | Where-Object { $_.pending }) }
		if (-not $rows.Count) { $(if ($Pending) { 'Nothing waiting on the conductor.' } else { 'Nothing on the Workboard.' }); break }
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

	'show' {
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
		if ($t.test) { "Test:       $($t.test)" }
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
	}

	'new' {
		if (-not $Title) { throw 'new needs -Title.' }
		$t = New-Task $Title $(if ($Note) { $Note } else { $Title }) $(if ($Status) { $Status } else { 'queued' }) 'task'
		Set-Common $t
		if ($Waiting) { Set-Field $t 'waiting' $Waiting }
		Save-Task $t
		$t.id
	}

	'suggest' {
		if (-not $Title) { throw 'suggest needs -Title.' }
		$t = New-Task $Title $(if ($Note) { $Note } else { $Title }) 'inbox' 'suggestion'
		if ($Summary) { Set-Field $t 'summary' $Summary }
		Set-Common $t
		Save-Task $t
		$t.id
	}

	'plan' {
		if (-not $Title) { throw 'plan needs -Title.' }
		if (-not $Steps) { throw 'plan needs -Steps "title|lane|tier", one per task.' }
		$t = New-Task $Title $Title 'inbox' 'plan' 'feature'
		Set-Field $t 'feature' $true
		if ($Summary) { Set-Field $t 'summary' $Summary }
		Set-Field $t 'steps' @($Steps | ForEach-Object {
			$f = $_ -split '\|'
			[pscustomobject]@{ title = $f[0].Trim(); lane = $(if ($f.Count -gt 1 -and $f[1].Trim() -match '^\d+$') { [int]$f[1] } else { $null }); tier = $(if ($f.Count -gt 2) { $f[2].Trim() } else { '' }) }
		})
		Save-Task $t
		$t.id
	}

	'ask' {
		if (-not $Question) { throw 'ask needs -Question.' }
		$t = Read-Task $Id
		Add-Question $t $Question @($Options) @($Audio)
		Set-Status $t 'stuck'
		Save-Task $t
		"$($t.id) stuck: $(@(Get-List $t.questions).Count) question(s)"
	}

	'set' {
		$t = Read-Task $Id
		if ($Status) {
			if ($Status -notin $Statuses) { throw "Status must be one of: $($Statuses -join ', ')." }
			Set-Status $t $Status
		}
		if ($Where -and $Where -notin 'main', 'lane') { throw "Where must be 'main' (merged, test in Main) or 'lane' (on its branch, test in the lane's place)." }
		foreach ($name in 'Title', 'Branch', 'Where', 'Step', 'Summary', 'Test', 'Waiting') {
			if ($PSBoundParameters.ContainsKey($name)) { Set-Field $t $name.ToLower() $PSBoundParameters[$name] }
		}
		# One question in one go; ask adds more, with audio.
		if ($Question) { Set-Field $t 'questions' @(); Add-Question $t $Question @($Options) @($Audio) }
		if ($Lane -ge 0) { Set-Field $t 'lane' $(if ($Lane -eq 0) { $null } else { $Lane }) }
		if ($Progress -ge 0) { Set-Field $t 'progress' ([Math]::Min(100, $Progress)) }
		if ($Order -ge 0) { Set-Field $t 'order' $Order }
		Set-Common $t
		Save-Task $t
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
	}

	'clear' {
		$t = Read-Task $Id
		Set-Field $t 'pending' ''
		Set-Field $t 'followups' 0
		Save-Task $t
	}

	default { throw "Unknown command '$Command'. Use serve, list, show, new, suggest, plan, ask, reply, set, log or clear." }
}
