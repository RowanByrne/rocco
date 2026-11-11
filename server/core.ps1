# Shared by the server and the commands: where things are, and small helpers.
# Keep every .ps1 here ASCII: Windows PowerShell reads a .ps1 without a BOM as ANSI.

$Utf8 = New-Object System.Text.UTF8Encoding $false
$Dot = [char]0x00B7

# Git writes UTF-8 (a commit's subject, a file's name, a folder under a user with an accent in their name), and Windows
# PowerShell reads a program's output in the console's own code page. So the console reads UTF-8 while git runs, and
# goes back to what it was: a command run in the user's own terminal leaves it as it found it.
function Use-Utf8Output([scriptblock]$run) {
	$was = $null
	try { $was = [Console]::OutputEncoding; if ($was.CodePage -ne 65001) { [Console]::OutputEncoding = $Utf8 } else { $was = $null } } catch { $was = $null }
	try { & $run } finally { if ($was) { try { [Console]::OutputEncoding = $was } catch { } } }
}

# Git without stopping on its messages: Windows PowerShell turns redirected stderr into errors.
function Invoke-Git([string]$dir) {
	$ErrorActionPreference = 'Continue'
	$rest = $args
	Use-Utf8Output { git -C $dir @rest 2>$null }
}

# Git, keeping what it says, to show the user when something fails.
function Invoke-GitText([string]$dir) {
	$ErrorActionPreference = 'Continue'
	$rest = $args
	Use-Utf8Output {
		# A blank line on stderr comes back as just the exception's type name: leave those out.
		$text = @(git -C $dir @rest 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -ne 'System.Management.Automation.RemoteException' }) -join "`n"
		[pscustomobject]@{ ok = ($LASTEXITCODE -eq 0); text = $text.Trim() }
	}
}

# One argument as a program's command line takes it (the C runtime's rules): quoted when it has a space or a quote,
# with the backslashes before a quote doubled.
function ConvertTo-Argument([string]$s) {
	if ($s -ne '' -and $s -notmatch '[\s"]') { return $s }
	'"' + ($s -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

# Git over the network (fetch, push), which can stall: the server handles one request at a time, so a call that never
# came back would freeze the app. Git gives up on a transfer that stops moving, never asks for a password in a console
# nobody can see, and is stopped after $seconds whatever it's doing. $signIn: the user started this (a button), so
# Git's own sign-in window may open; without it (Rocco's own pushes in the background) nothing may ask.
function Invoke-GitNet([string]$dir, [string[]]$arguments, [int]$seconds = 60, [bool]$signIn = $true) {
	$all = @('-C', $dir, '-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=20') + $arguments
	$psi = New-Object Diagnostics.ProcessStartInfo 'git'
	$psi.Arguments = ($all | ForEach-Object { ConvertTo-Argument $_ }) -join ' '
	$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
	$psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
	$psi.StandardOutputEncoding = $Utf8; $psi.StandardErrorEncoding = $Utf8
	$psi.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
	if (-not $signIn) { $psi.EnvironmentVariables['GCM_INTERACTIVE'] = 'never' }
	try { $p = [Diagnostics.Process]::Start($psi) } catch { return [pscustomobject]@{ ok = $false; text = "Git couldn't be started: $($_.Exception.Message)"; timedOut = $false } }
	$p.StandardInput.Close()
	$out = $p.StandardOutput.ReadToEndAsync(); $err = $p.StandardError.ReadToEndAsync()
	if (-not $p.WaitForExit($seconds * 1000)) {
		# Git and whatever it started (its https helper, a sign-in window).
		try { & taskkill.exe /T /F /PID $p.Id 2>$null | Out-Null } catch { }
		try { if (-not $p.HasExited) { $p.Kill() } } catch { }
		return [pscustomobject]@{ ok = $false; text = "no answer after $seconds seconds, so Rocco stopped waiting"; timedOut = $true }
	}
	[pscustomobject]@{ ok = ($p.ExitCode -eq 0); text = ("$($out.Result)`n$($err.Result)").Trim(); timedOut = $false }
}

function Now { (Get-Date).ToString('o') }

# Where this PC's Rocco keeps its own things (settings, the log): with the user, not in a project or the RoDev folder.
# ROCCO_HOME moves it, so a test run leaves the user's settings and log alone.
$RoccoHome = if ($env:ROCCO_HOME) { $env:ROCCO_HOME } else { Join-Path $env:APPDATA 'Rocco' }

# Rocco is installed once per RoDev folder, in <RoDev>\_tools\rocco (README.md "Install").
$WebRoot = Join-Path $AppDir 'web'
$ToolsDir = Split-Path $AppDir -Parent
if ((Split-Path $ToolsDir -Leaf) -ne '_tools') { throw "Rocco runs from a RoDev folder's _tools\rocco, not from $AppDir (README.md `"Install`")." }
$RoDev = Split-Path $ToolsDir -Parent

# A project: a folder whose repo\ has PROJECT.md, or a game being brought in (new-project.ps1 -Existing): its own git
# repo with lanes\ next to it, before the template is merged into it.
function Test-ProjectDir([string]$dir) {
	$dir -and ((Test-Path (Join-Path $dir 'repo\docs\game\PROJECT.md')) -or ((Test-Path (Join-Path $dir 'repo\.git')) -and (Test-Path (Join-Path $dir 'lanes'))))
}

# The project Rocco opens on, and that a command is about: -Project, else the project the current folder is in
# (its repo\ or a lane, found through git), else the template, else the first project.
function Find-HomeProject([string]$id) {
	if ($id) {
		$dir = Join-Path $RoDev $id
		if (-not (Test-ProjectDir $dir)) { throw "There's no project '$id' in $RoDev." }
		return $dir
	}
	$common = Invoke-Git (Get-Location).ProviderPath rev-parse --path-format=absolute --git-common-dir
	if ($common) {
		$dir = [IO.Path]::GetFullPath((Split-Path (Split-Path $common -Parent) -Parent))
		if ((Split-Path $dir -Parent) -ieq [IO.Path]::GetFullPath($RoDev).TrimEnd('\') -and (Test-ProjectDir $dir)) { return $dir }
	}
	$first = Get-ChildItem $RoDev -Directory | Where-Object { Test-ProjectDir $_.FullName } | Sort-Object { $_.Name -ne 'template' }, Name | Select-Object -First 1
	if ($first) { $first.FullName } else { Join-Path $RoDev 'template' }
}
$HomeProject = Find-HomeProject $Project

# This copy of Rocco: a release sits on its v* tag; anything else is a development copy (README.md "Releasing").
# Read once, so it names the code that's running even after an update has switched the files under it.
function Get-RoccoVersion {
	$tag = "$(Invoke-Git $AppDir describe --tags --exact-match --match 'v*' HEAD)"
	$onBranch = "$(Invoke-Git $AppDir symbolic-ref --short -q HEAD)"
	$commit = "$(Invoke-Git $AppDir rev-parse --short HEAD)"
	if ($tag) { $tag } elseif ($onBranch) { "$onBranch @ $commit" } else { $commit }
}
# Only the server shows it: an agent's command doesn't pay for three git calls it has no use for.
$RoccoVersion = if ($Command -eq 'serve') { Get-RoccoVersion } else { '' }

# The project a command or request is about. Its Rocco data (tasks, screenshots) lives outside git, in <Game>\rocco\.
# archive\ holds tasks finished long ago (tasks.ps1), out of the way of the board's every look.
function Use-Project([string]$dir) {
	$script:Root = $dir
	$script:RepoDir = Join-Path $dir 'repo'
	$script:TasksDir = Join-Path $dir 'rocco\tasks'
	$script:ArchiveDir = Join-Path $dir 'rocco\archive'
	$script:ThreadId = ''
}

# The conversation a command or request is about: '' for the conductor's (the main chat), or the id of a feature (or
# of a card given its own agent), which has a thread and an agent of its own (thread.ps1, leads.ps1).
function Use-Thread([string]$id) {
	if ($id -and $id -notmatch '^T-\d+$') { throw "Not a thread: '$id' (a feature's or a card's id, like T-020)." }
	$script:ThreadId = "$id"
}
Use-Project $HomeProject
