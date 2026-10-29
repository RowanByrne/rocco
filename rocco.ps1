# Rocco (rocco\README.md): serves the app for every project in this RoDev folder, and gives Claude the
# commands that keep a project's Workboard current. Tasks live outside git, in <Game>\rocco\tasks\T-NNN\.
#
#   rocco.ps1 [serve] [-Open]          serve Rocco on http://localhost:34860/
#   rocco.ps1 list [-Pending]          this project's open tasks; -Pending: only what waits on the conductor
#   rocco.ps1 show T-012               one task in full: note, screenshot paths, history, notes file
#   rocco.ps1 new -Title "..."         add a task (queued); prints its id
#   rocco.ps1 set T-012 -Status working -Lane 3 -Step "Coding"
#   rocco.ps1 log T-012 -Text "..." [-Who conductor]
#   rocco.ps1 clear T-012              the user's request on it (plan, answer, reopen, merge) is handled
param(
	[Parameter(Position = 0)] [string]$Command = 'serve',
	[Parameter(Position = 1)] [string]$Id,
	[string]$Title, [string]$Note, [string]$Status, [int]$Lane = -1, [string]$Branch, [string]$Where,
	[string]$Step, [string]$Summary, [string]$Test, [string]$Question, [string[]]$Options, [string]$Waiting,
	[string]$Who = 'worker', [string]$Text, [switch]$Feature, [switch]$Pending, [switch]$Open, [int]$Port = 34860
)
$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot
foreach ($part in 'core', 'tasks', 'projects', 'connections', 'history', 'http') { . (Join-Path $AppDir "server\$part.ps1") }

function Format-Time($iso) { if ($iso) { ([datetime]$iso).ToString('HH:mm') } else { '' } }

switch ($Command) {
	'serve' { Start-Rocco }

	'list' {
		$rows = @(Get-Tasks | Where-Object { ($_.status -notin 'done', 'removed') -or $_.pending })
		if ($Pending) { $rows = @($rows | Where-Object { $_.pending }) }
		if (-not $rows.Count) { $(if ($Pending) { 'Nothing waiting on the conductor.' } else { 'Nothing on the Workboard.' }); break }
		foreach ($t in $rows | Sort-Object id) {
			$laneText = if ($t.lane) { "L$($t.lane)" } else { '-' }
			$wants = if ($t.pending) { "[$($t.pending)]" } else { '' }
			'{0,-6} {1,-8} {2,-4} {3,-9} {4}' -f $t.id, $t.status, $laneText, $wants, $t.title
		}
	}

	'show' {
		$t = Read-Task $Id
		$dir = Get-TaskDir $Id
		$head = "$($t.id)  $($t.status)"
		if ($t.lane) { $head += "  lane $($t.lane)" }
		if ($t.branch) { $head += "  $($t.branch)" }
		$head += "  attempt $($t.attempt)"
		if ($t.pending) { $head += "  waiting on the conductor: $($t.pending)" }
		$head
		"Title:      $($t.title)"
		if ($t.note -and $t.note -ne $t.title) { "Note:       $($t.note)" }
		foreach ($s in @($t.shots) | Where-Object { $_ }) { "Screenshot: $(Join-Path $dir $s)" }
		if ($t.step) { "Step:       $($t.step)" }
		if ($t.summary) { "Summary:    $($t.summary)" }
		if ($t.test) { "Test:       $($t.test)" }
		if ($t.question) { "Question:   $($t.question)  [$(@($t.options) -join ' | ')]" }
		if ($t.waiting) { "Waiting:    $($t.waiting)" }
		$notes = Join-Path $dir 'notes.md'
		"Notes:      $notes$(if (-not (Test-Path $notes)) { ' (none yet)' })"
		if (@($t.log | Where-Object { $_ }).Count) {
			'History:'
			foreach ($e in $t.log) { '  {0}  {1,-9} {2}' -f (Format-Time $e.at), $e.who, $e.text }
		}
	}

	'new' {
		if (-not $Title) { throw 'new needs -Title.' }
		$t = New-Task $Title $(if ($Note) { $Note } else { $Title }) $(if ($Status) { $Status } else { 'queued' }) 'task'
		if ($Feature) { Set-Field $t 'feature' $true; Save-Task $t }
		$t.id
	}

	'set' {
		$t = Read-Task $Id
		if ($Status) {
			if ($Status -notin $Statuses) { throw "Status must be one of: $($Statuses -join ', ')." }
			Set-Status $t $Status
		}
		if ($Where -and $Where -notin 'main', 'lane') { throw "Where must be 'main' (merged, test in Main) or 'lane' (on its branch, test in the lane's place)." }
		foreach ($name in 'Title', 'Branch', 'Where', 'Step', 'Summary', 'Test', 'Question', 'Waiting') {
			if ($PSBoundParameters.ContainsKey($name)) { Set-Field $t $name.ToLower() $PSBoundParameters[$name] }
		}
		if ($PSBoundParameters.ContainsKey('Options')) { Set-Field $t 'options' @($Options) }
		if ($Lane -ge 0) { Set-Field $t 'lane' $(if ($Lane -eq 0) { $null } else { $Lane }) }
		if ($Feature) { Set-Field $t 'feature' $true }
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

	'clear' {
		$t = Read-Task $Id
		Set-Field $t 'pending' ''
		Save-Task $t
	}

	default { throw "Unknown command '$Command'. Use serve, list, show, new, set, log or clear." }
}
