# Shared by the server and the commands: where things are, and small helpers.
# Keep every .ps1 here ASCII: Windows PowerShell reads a .ps1 without a BOM as ANSI.

$Utf8 = New-Object System.Text.UTF8Encoding $false
$Dot = [char]0x00B7

# Git without stopping on its messages: Windows PowerShell turns redirected stderr into errors.
function Invoke-Git([string]$dir) {
	$ErrorActionPreference = 'Continue'
	git -C $dir @args 2>$null
}

# Git, keeping what it says, to show the user when something fails.
function Invoke-GitText([string]$dir) {
	$ErrorActionPreference = 'Continue'
	$text = @(git -C $dir @args 2>&1 | ForEach-Object { "$_" }) -join "`n"
	[pscustomobject]@{ ok = ($LASTEXITCODE -eq 0); text = $text.Trim() }
}

function Now { (Get-Date).ToString('o') }

# Rocco is installed once per RoDev folder, in <RoDev>\_tools\rocco (README.md "Install").
$WebRoot = Join-Path $AppDir 'web'
$ToolsDir = Split-Path $AppDir -Parent
if ((Split-Path $ToolsDir -Leaf) -ne '_tools') { throw "Rocco runs from a RoDev folder's _tools\rocco, not from $AppDir (README.md `"Install`")." }
$RoDev = Split-Path $ToolsDir -Parent

# A project: a folder whose repo\ has PROJECT.md, or ONBOARDING.md (a game brought in, before the template is merged into it).
function Test-ProjectDir([string]$dir) { $dir -and ((Test-Path (Join-Path $dir 'repo\docs\game\PROJECT.md')) -or (Test-Path (Join-Path $dir 'repo\docs\game\ONBOARDING.md'))) }

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
$RoccoVersion = Get-RoccoVersion

# The project a command or request is about. Its Rocco data (tasks, screenshots) lives outside git, in <Game>\rocco\.
function Use-Project([string]$dir) {
	$script:Root = $dir
	$script:RepoDir = Join-Path $dir 'repo'
	$script:TasksDir = Join-Path $dir 'rocco\tasks'
}
Use-Project $HomeProject
