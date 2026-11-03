# Onboarding (the template's docs/workflow/SETUP.md): the survey a new or brought-in game starts with, the user's
# answers in docs/game/ONBOARDING.md, and handing them to the user's agent with a Workboard card.

# The survey: the project's own (its template release), else the template's. A template checkout from before the
# survey existed is brought up to date first, as new-project.ps1 does.
function Get-Survey([string]$repo = '') {
	$template = Join-Path $RoDev 'template\repo'
	$pull = $null
	foreach ($try in 1, 2) {
		foreach ($dir in @($repo, $template) | Where-Object { $_ }) {
			$file = Join-Path $dir 'tools\onboarding.json'
			if (Test-Path $file) { return [IO.File]::ReadAllText($file, $Utf8) | ConvertFrom-Json }
		}
		if ($try -eq 1) { $pull = Invoke-GitText $template pull --ff-only }
	}
	throw "There's no onboarding survey in the template (tools\onboarding.json), and updating it didn't work$(if ($pull.text) { ": $($pull.text.TrimEnd('.'))" }). In template\repo, run: git pull"
}

function Get-AnswersPath { Join-Path $RepoDir 'docs\game\ONBOARDING.md' }
$FlowNames = @{ new = 'A new game'; existing = 'A game brought in' }

# ONBOARDING.md back into answers: each one follows its <!-- answer: id --> marker and heading, up to its *For:* line.
function Read-Answers {
	$path = Get-AnswersPath
	$result = [pscustomobject]@{ flow = ''; source = ''; started = ''; answers = [ordered]@{} }
	if (-not (Test-Path $path)) { return $result }
	$text = [IO.File]::ReadAllText($path, $Utf8) -replace "`r`n", "`n"
	if ($text -match '(?m)^- \*\*Flow:\*\* (.+)$') { $name = $Matches[1].Trim(); $result.flow = @($FlowNames.Keys | Where-Object { $FlowNames[$_] -eq $name })[0] }
	if ($text -match '(?m)^- \*\*Source:\*\* (.+)$') { $result.source = $Matches[1].Trim() }
	if ($text -match '(?m)^- \*\*Started:\*\* (.+)$') { $result.started = $Matches[1].Trim() }
	foreach ($m in [regex]::Matches($text, '<!-- answer: ([\w-]+) -->\n#+ [^\n]*\n\n([\s\S]*?)\n\n\*For: [^\n]*\*')) {
		$result.answers[$m.Groups[1].Value] = $m.Groups[2].Value.Trim()
	}
	$result
}

# The whole file, in the survey's order: the flow's steps, then the tiles under "More detail". Unanswered questions
# are left out, so the agent only sees what the user said.
function Format-Answers($survey, [string]$flow, [string]$source, [string]$started, $answers) {
	$lines = @('# Onboarding', '',
		'The user''s answers from Rocco''s onboarding, in their own words. An agent turns them into the docs (docs/workflow/SETUP.md). Rocco''s "Add game details" adds more, and they can be edited here.', '',
		"- **Flow:** $($FlowNames[$flow])")
	if ($source) { $lines += "- **Source:** $source" }
	$lines += "- **Started:** $(if ($started) { $started } else { (Get-Date).ToString('yyyy-MM-dd') })", ''
	$block = { param($q, [string]$heading)
		$answer = "$($answers[$q.id])".Trim()
		if (-not $answer) { return @() }
		@("<!-- answer: $($q.id) -->", "$heading $($q.prompt)", '', $answer, '', "*For: $(@($q.for) -join ', ')*", '')
	}
	foreach ($step in $survey.flows.$flow.steps) {
		$body = @(foreach ($q in $step.questions) { & $block $q '###' })
		if ($body) { $lines += "## $($step.title)", ''; $lines += $body }
	}
	$tiles = @(foreach ($tile in $survey.tiles) {
		$body = @(foreach ($q in $tile.questions) { & $block $q '####' })
		if ($body) { "### $($tile.title)"; ''; $body }
	})
	if ($tiles) { $lines += '## More detail', ''; $lines += $tiles }
	($lines -join "`n").TrimEnd() + "`n"
}

# The user's answers, merged into what's there (an empty answer clears one), committed as the user, and pushed.
function Save-Answers([string]$flow, [string]$source, $posted) {
	$survey = Get-Survey $RepoDir
	$current = Read-Answers
	if (-not $flow) { $flow = $current.flow }
	if (-not $FlowNames.Contains($flow)) { $flow = 'new' }
	if (-not $source) { $source = $current.source }
	$answers = $current.answers
	foreach ($p in $posted.PSObject.Properties) {
		$value = "$($p.Value)".Trim()
		if ($value) { $answers[$p.Name] = $value } elseif ($answers.Contains($p.Name)) { $answers.Remove($p.Name) }
	}
	$path = Get-AnswersPath
	$first = -not (Test-Path $path)
	New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
	[IO.File]::WriteAllText($path, (Format-Answers $survey $flow $source $current.started $answers), $Utf8)
	$script:DocsCache = @{}

	$relative = 'docs/game/ONBOARDING.md'
	if (-not (Invoke-GitText $RepoDir status --porcelain '--' $relative).text) { return [pscustomobject]@{ saved = $true; committed = $false; pushed = $false; note = '' } }
	$messageFile = [IO.Path]::GetTempFileName()
	try {
		[IO.File]::WriteAllText($messageFile, $(if ($first) { 'Onboarding: the user''s answers' } else { 'Onboarding: more answers' }), $Utf8)
		$add = Invoke-GitText $RepoDir add '--' $relative
		$commit = if ($add.ok) { Invoke-GitText $RepoDir commit -F $messageFile --only '--' $relative } else { $add }
	} finally { Remove-Item -LiteralPath $messageFile -ErrorAction SilentlyContinue }
	if (-not $commit.ok) { throw "Saved the answers, but git couldn't commit them: $($commit.text)" }
	$result = [pscustomobject]@{ saved = $true; committed = $true; pushed = $false; note = '' }
	$branch = "$(Invoke-Git $RepoDir rev-parse --abbrev-ref HEAD)"
	if (-not (Invoke-Git $RepoDir remote get-url origin)) { $result.note = 'Committed. No GitHub repo yet, so not pushed.' }
	elseif ($branch -ne 'main') { $result.note = "Committed on $branch. Not pushed: your agent sorts out the branches when it brings the game in." }
	else {
		$problem = Push-Main
		if ($problem) { $result.note = "Committed, but $problem" } else { $result.pushed = $true }
	}
	$result
}

# Hands the answers to the user's agent: a Workboard card that needs no review (it approves itself when it's ready), and
# the agent opened on SETUP.md in its own window (minimized), as the project's conductor. A conductor already running gets the card
# instead. Without an agent installed, the card waits in Up next, and the prompt comes back for copying.
function Start-Setup([string]$part, [string[]]$tiles) {
	$parts = @{ new = 'New game'; existing = 'Existing game'; more = 'More detail' }
	if (-not $parts.Contains($part)) { throw "Not a setup part: '$part'." }
	$survey = Get-Survey $RepoDir
	$titles = @($tiles | ForEach-Object { $id = $_; @($survey.tiles | Where-Object { $_.id -eq $id })[0].title } | Where-Object { $_ })
	if ($part -eq 'more' -and -not $titles) { throw 'Pick at least one tile with answers.' }
	# A game brought in from its own repo has no template files yet: the brief is read from the template's checkout.
	$brief = if (Test-Path (Join-Path $RepoDir 'docs\workflow\SETUP.md')) { 'docs/workflow/SETUP.md' } else { '../../template/repo/docs/workflow/SETUP.md' }
	$which = if ($part -eq 'more') { "part More detail, for $($titles -join ', ')" } else { "part $($parts[$part])" }
	$title = switch ($part) {
		'new' { 'Write the first docs from the onboarding answers' }
		'existing' { 'Bring the game in, and fill in its docs from its code' }
		'more' { "Fill in more detail: $($titles -join ', ')" }
	}
	$prompt = "Follow $brief, $which. The answers are in docs/game/ONBOARDING.md."
	$t = New-Task $title $prompt 'queued' 'task'
	Set-Field $t 'auto' $true
	$prompt = "Follow $brief, $which, for Workboard task $($t.id). The answers are in docs/game/ONBOARDING.md."
	$agent = Get-Agent
	$opened = $false
	$running = (Get-Conductor).state -ne 'none'
	if ($agent.installed -and -not $running) {
		try { Open-Conductor "$prompt $WatchBoard" | Out-Null; $opened = $true } catch { }
	}
	if ($opened) {
		Set-Status $t 'working'
		Set-Field $t 'step' 'Writing the docs'
		Add-Log $t 'conductor' "Opened $($agent.name) on it."
	} else {
		Send-ToConductor $t 'plan'
	}
	Save-Task $t
	[pscustomobject]@{ task = $t.id; opened = $opened; running = $running; agent = $agent.name; prompt = $prompt }
}
