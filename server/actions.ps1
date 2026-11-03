# One-click fixes on Connections: what each row's button does. The app only names an action; what runs is defined
# here, never sent by the page. Quick fixes run at once. Updates to this PC's tools run in a window of their own, so
# the user sees them and can answer anything they ask (an installer's prompt, a sign-in), and Rocco waits for the
# window to close. Changes to the game itself are the agent's: those rows add a note to Up next instead (in the app).

# Main to GitHub, with GitHub's main merged in first, never rebased (CLAUDE.md "Git"). Returns why it didn't push, or ''.
# It won't merge into uncommitted work: a merge that went wrong couldn't be backed out without losing it.
function Push-Main {
	$fetch = Invoke-GitText $RepoDir fetch origin main
	if (-not $fetch.ok) { return "GitHub couldn't be reached, so it isn't pushed: $($fetch.text)" }
	if (-not (Invoke-GitText $RepoDir merge-base --is-ancestor origin/main HEAD).ok) {
		if (@(Invoke-Git $RepoDir status --porcelain --untracked-files=no | Where-Object { $_ }).Count) {
			return 'not pushed: main on GitHub has newer commits, and repo\ has uncommitted changes. Say "refresh" to your agent.'
		}
		$merge = Invoke-GitText $RepoDir merge --no-edit origin/main
		if (-not $merge.ok) {
			Invoke-GitText $RepoDir merge --abort | Out-Null
			return 'not pushed: main on GitHub has changes that clash with it. Say "refresh" to your agent to merge them.'
		}
	}
	$push = Invoke-GitText $RepoDir push origin main
	$script:HistoryCache = @{}; $script:MainCache = @{}
	if ($push.ok) { '' } else { "the push failed: $($push.text)" }
}

# One file the app wrote (Updates, Thumbnails), committed as the user, only that file, and pushed when it can be.
# Line endings follow the file already there. Returns { committed, pushed, note }.
function Save-RepoFile([string]$relative, [string]$text, [string]$message) {
	$path = Join-Path $RepoDir $relative
	$old = if (Test-Path $path) { [IO.File]::ReadAllText($path, $Utf8) } else { '' }
	$new = $text -replace "`r`n", "`n"
	if ($old.Contains("`r`n")) { $new = $new -replace "`n", "`r`n" }
	$result = [pscustomobject]@{ committed = $false; pushed = $false; note = '' }
	if ($new -eq $old) { return $result }
	New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
	[IO.File]::WriteAllText($path, $new, $Utf8)
	$script:DocsCache = @{}
	$messageFile = [IO.Path]::GetTempFileName()
	try {
		[IO.File]::WriteAllText($messageFile, $message.Trim(), $Utf8)
		$add = Invoke-GitText $RepoDir add '--' $relative
		$commit = if ($add.ok) { Invoke-GitText $RepoDir commit -F $messageFile --only '--' $relative } else { $add }
	} finally { Remove-Item -LiteralPath $messageFile -ErrorAction SilentlyContinue }
	if (-not $commit.ok) { throw "Saved $relative, but git couldn't commit it: $($commit.text)" }
	$result.committed = $true
	$script:HistoryCache = @{}; $script:MainCache = @{}
	if (-not (Invoke-Git $RepoDir remote get-url origin)) { $result.note = 'Committed. No GitHub repo yet, so not pushed.'; return $result }
	$problem = Push-Main
	if ($problem) { $result.note = "Committed, but $problem" } else { $result.pushed = $true }
	$result
}

function Assert-OnMain {
	if ("$(Invoke-Git $RepoDir rev-parse --abbrev-ref HEAD)" -ne 'main') { throw 'repo\ isn''t on main. Ask your agent to put it back first.' }
	if (Test-Path "$(Invoke-Git $RepoDir rev-parse --path-format=absolute --git-path MERGE_HEAD)") { throw 'repo\ is in the middle of a merge. Ask your agent to finish it first.' }
}

# The updates that run in their own window: the title, then the steps (PowerShell, setting $code on failure).
$LyncUpdate = @'
$dir = '__LYNC__'
if (Get-Process lync -ErrorAction SilentlyContinue) {
	Write-Host 'Lync is running. Close its server windows, then update it again.'
	$code = 1
} else {
	try {
		[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
		# The newest release, from where GitHub's "latest" page points: no API, so no rate limit.
		$request = [Net.WebRequest]::Create('https://github.com/Iron-Stag-Games/Lync/releases/latest')
		$request.AllowAutoRedirect = $false
		$response = $request.GetResponse()
		$tag = ("$($response.Headers['Location'])" -split '/tag/')[-1]
		$response.Close()
		if ($tag -notmatch '^[\w.-]+$') { throw 'Could not find the newest Lync release.' }
		$zip = Join-Path $env:TEMP "lync-$tag.zip"
		$out = Join-Path $env:TEMP "lync-$tag"
		Write-Host "Downloading Lync $tag ..."
		Invoke-WebRequest "https://github.com/Iron-Stag-Games/Lync/releases/download/$tag/lync-$tag-windows-x64.zip" -OutFile $zip -UseBasicParsing
		Expand-Archive $zip $out -Force
		$exe = Get-ChildItem $out -Recurse -Filter lync.exe | Select-Object -First 1
		if (-not $exe) { throw 'The download has no lync.exe in it.' }
		New-Item -ItemType Directory -Force $dir | Out-Null
		# Its config (lync-config.json) stays as it is.
		Copy-Item $exe.FullName (Join-Path $dir 'lync.exe') -Force
		$license = Get-ChildItem $out -Recurse -Filter 'LICENSE*' | Select-Object -First 1
		if ($license) { Copy-Item $license.FullName (Join-Path $dir 'LICENSE.md') -Force }
		Set-Content (Join-Path $dir 'VERSION') $tag -Encoding ascii
		Remove-Item $zip, $out -Recurse -Force -ErrorAction SilentlyContinue
		Write-Host "Lync $tag is in $dir. Its Studio plugin updates on the next serve: restart Studio after."
	} catch { Write-Host $_.Exception.Message; $code = 1 }
}
'@
$WindowActions = @{
	'claude-update' = @('Updating Claude Code', 'claude update; $code = $LASTEXITCODE')
	'codex-update'  = @('Updating Codex', 'npm install -g @openai/codex@latest; $code = $LASTEXITCODE')
	'gemini-update' = @('Installing the latest Gemini CLI', 'npm install -g @google/gemini-cli@latest; $code = $LASTEXITCODE')
	'git-update'    = @('Updating Git for Windows', 'git update-git-for-windows; $code = $LASTEXITCODE')
	'gh-update'     = @('Updating the GitHub CLI', 'winget upgrade --id GitHub.cli --exact; $code = $LASTEXITCODE')
	'gh-install'    = @('Installing the GitHub CLI', 'winget install --id GitHub.cli --exact; $code = $LASTEXITCODE')
	'lync-update'   = @('Updating Lync', $LyncUpdate)
	# Installing an agent, and signing in to the user's own accounts (onboarding's accounts screen, accounts.ps1).
	'claude-install' = @('Installing Claude Code', 'winget install --id Anthropic.ClaudeCode --exact; $code = $LASTEXITCODE')
	'claude-login'   = @('Signing in to Claude Code', 'claude auth login; $code = $LASTEXITCODE')
	'codex-login'    = @('Signing in to Codex', '& ''__CODEX__'' login; $code = $LASTEXITCODE')
	'gemini-login'   = @('Signing in to Gemini CLI', 'Write-Host ''Choose to sign in with Google, and finish in your browser. Then type /quit to close this window.''; Write-Host ''''; gemini; $code = $LASTEXITCODE')
	'gh-login'       = @('Signing in to GitHub', 'gh auth login --hostname github.com --git-protocol https --web; $code = $LASTEXITCODE')
}

$script:ActionRuns = @{}   # run id -> @{ Process; Action; Label }
function Start-ActionWindow([string]$action) {
	# One window per action at a time: a second click finds the one already running.
	foreach ($key in @($script:ActionRuns.Keys)) {
		$r = $script:ActionRuns[$key]
		if ($r.Action -eq $action -and -not $r.Process.HasExited) { return [pscustomobject]@{ run = $key } }
	}
	$label, $steps = $WindowActions[$action]
	$steps = $steps.Replace('__LYNC__', (Join-Path $RoDev '_tools\lync').Replace("'", "''"))
	if ($steps.Contains('__CODEX__')) {
		$codex = Find-AgentExe 'codex'
		if (-not $codex) { throw 'Codex isn''t installed on this PC.' }
		$steps = $steps.Replace('__CODEX__', $codex.Replace("'", "''"))
	}
	# A missing program counts as failing too. The window stays open only when something failed, so the user can read why.
	$text = "`$Host.UI.RawUI.WindowTitle = 'Rocco: $label'`nWrite-Host 'Rocco: $label'`nWrite-Host ''`n`$code = 0`n`$ErrorActionPreference = 'Stop'`n" +
		"try {`n$steps`n} catch { Write-Host `$_.Exception.Message; `$code = 1 }`n" +
		"if (`$code) { Write-Host ''; Write-Host `"That didn't work (exit `$code). Press Enter to close this window.`"; [void](Read-Host) }`nexit `$code`n"
	$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
	$process = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded -PassThru
	$null = $process.Handle # without holding the handle, ExitCode reads as empty once it exits
	$id = [guid]::NewGuid().ToString('N').Substring(0, 8)
	$script:ActionRuns[$id] = @{ Process = $process; Action = $action; Label = $label }
	$script:PcResult = $null; $script:AccountsCache = $null # what the next check sees is what counts
	[pscustomobject]@{ run = $id; label = $label }
}

function Get-ActionRun([string]$id) {
	$r = $script:ActionRuns[$id]
	if (-not $r) { throw "No run $id." }
	$running = -not $r.Process.HasExited
	[pscustomobject]@{ running = $running; ok = (-not $running -and $r.Process.ExitCode -eq 0); label = $r.Label }
}

# A row's button. Returns { run } for an update in its own window, else { message } once it's done.
function Invoke-ConnectionAction([string]$action, [string]$value) {
	if ($WindowActions.ContainsKey($action)) { return Start-ActionWindow $action }
	switch ($action) {
		'hooks-on' {
			$r = Invoke-GitText $RepoDir config core.hooksPath tools/hooks
			if (-not $r.ok) { throw $r.text }
			return [pscustomobject]@{ message = 'The commit check is on.' }
		}
		'template-remote' {
			$r = Invoke-GitText $RepoDir remote add template https://github.com/RowanByrne/rodev_template.git
			if (-not $r.ok) { throw $r.text }
			Update-TemplateTags $true
			return [pscustomobject]@{ message = 'Template remote added. Checking its releases.' }
		}
		# Lync for Main and this PC's lanes, with no windows (lanes.ps1).
		'lync-start' {
			$started = @(Start-ProjectLync)
			$script:ListenCache = $null
			return [pscustomobject]@{ message = $(if ($started.Count) { "Lync is starting for $($started.Count) place$(if ($started.Count -ne 1) { 's' }), in the background." } else { 'Lync is already serving.' }) }
		}
		'lync-stop' {
			$n = Stop-Lync -Project
			return [pscustomobject]@{ message = "Lync stopped$(if ($n -ne 1) { " ($n servers)" })." }
		}
		'push' {
			Assert-OnMain
			$problem = Push-Main
			if ($problem) { throw "Main is $problem" }
			return [pscustomobject]@{ message = 'Main is pushed to GitHub.' }
		}
		# The game's empty GitHub repo (NEW-PROJECT.md step 3): connected as origin, then main pushed to it.
		'github-connect' {
			$url = $value.Trim()
			if ($url -notmatch '^(https://github\.com/[\w.-]+/[\w.-]+?(\.git)?|git@github\.com:[\w.-]+/[\w.-]+?(\.git)?)$') { throw 'That isn''t a GitHub repo address, like https://github.com/you/game.git' }
			Assert-OnMain
			if (Invoke-Git $RepoDir remote get-url origin) { throw 'This project already has a GitHub repo.' }
			$add = Invoke-GitText $RepoDir remote add origin $url
			if (-not $add.ok) { throw $add.text }
			$push = Invoke-GitText $RepoDir push -u origin main
			if (-not $push.ok) { throw "Connected, but the push failed (is the repo empty, and can you reach it?): $($push.text)" }
			return [pscustomobject]@{ message = 'Connected to GitHub, and main is pushed.' }
		}
		default { throw "Unknown action '$action'." }
	}
}
