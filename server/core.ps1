# Shared by the server and the commands: where things are, and small helpers.
# Keep every .ps1 here ASCII: Windows PowerShell reads a .ps1 without a BOM as ANSI.

$Utf8 = New-Object System.Text.UTF8Encoding $false
$Dot = [char]0x00B7

# Git without stopping on its messages: Windows PowerShell turns redirected stderr into errors.
function Invoke-Git([string]$dir) {
	$ErrorActionPreference = 'Continue'
	git -C $dir @args 2>$null
}

function Now { (Get-Date).ToString('o') }

# This project: the parent of the main checkout, found through git so this works from repo\ or a lane.
$common = Invoke-Git $AppDir rev-parse --path-format=absolute --git-common-dir
$HomeProject = if ($common) { Split-Path (Split-Path $common -Parent) -Parent } else { Split-Path (Split-Path $AppDir -Parent) -Parent }
$RoDev = Split-Path $HomeProject -Parent
$WebRoot = Join-Path $AppDir 'web'

# The project a command or request is about. Its Rocco data (tasks, screenshots) lives outside git, in <Game>\rocco\.
function Use-Project([string]$dir) {
	$script:Root = $dir
	$script:RepoDir = Join-Path $dir 'repo'
	$script:TasksDir = Join-Path $dir 'rocco\tasks'
}
Use-Project $HomeProject
