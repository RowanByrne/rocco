# The coding agents Rocco can open (the template's docs/workflow/MODELS.md "Your agent"). Each PC picks one in Settings:
# Rocco opens it for onboarding, says its name where it asks it for something, and checks it in Connections.
# Supporting another agent is a row here: how it's started with a prompt, where it keeps MCP servers, the plan it runs on
# (onboarding's accounts screen: the user brings their own), and how to install it and sign in (actions.ps1).

$Agents = [ordered]@{
	claude = @{ name = 'Claude Code'; short = 'Claude'; exe = 'claude'; prompt = @(); mcp = '.claude.json'; studio = '"Roblox_Studio"\s*:\s*\{'
		plan = 'A Claude Pro or Max plan, or Anthropic API credit'; install = 'claude-install'; login = 'claude-login' }
	codex  = @{ name = 'Codex'; short = 'Codex'; exe = 'codex'; prompt = @(); mcp = '.codex\config.toml'; studio = '\[mcp_servers\.Roblox_Studio\]'
		plan = 'A ChatGPT plan, or OpenAI API credit'; install = 'codex-update'; login = 'codex-login' }
	gemini = @{ name = 'Gemini CLI'; short = 'Gemini'; exe = 'gemini'; prompt = @('-i'); mcp = '.gemini\settings.json'; studio = '"Roblox_Studio"\s*:\s*\{'
		plan = 'A Google account (free to start), or a Gemini API key'; install = 'gemini-update'; login = 'gemini-login' }
}

# This PC's Rocco settings, kept with the user (not in a project, not in the RoDev folder, which can move between PCs).
$SettingsFile = Join-Path $env:APPDATA 'Rocco\settings.json'
function Read-RoccoSettings {
	if (Test-Path $SettingsFile) { try { return [IO.File]::ReadAllText($SettingsFile, $Utf8) | ConvertFrom-Json } catch { } }
	[pscustomobject]@{}
}

# Where an agent's program is: on PATH, or the copy its desktop app keeps. '' when it isn't on this PC.
function Find-AgentExe([string]$id) {
	$command = Get-Command $Agents[$id].exe -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($command) { return $command.Source }
	if ($id -eq 'codex') {
		$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Recurse -Filter codex.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
		if ($exe) { return $exe.FullName }
	}
	''
}

$script:AgentCache = $null
function Get-Agent {
	if (-not $script:AgentCache -or ((Get-Date) - $script:AgentCache.Read).TotalSeconds -gt 60) {
		$installed = @($Agents.Keys | Where-Object { Find-AgentExe $_ })
		$chosen = "$((Read-RoccoSettings).agent)"
		# Until the user picks, the first one installed.
		$id = if ($Agents.Contains($chosen)) { $chosen } elseif ($installed) { $installed[0] } else { 'claude' }
		$script:AgentCache = @{ Read = Get-Date; Value = [pscustomobject]@{
			id = $id; name = $Agents[$id].name; short = $Agents[$id].short; installed = ($installed -contains $id); chosen = [bool]$chosen
			agents = @($Agents.Keys | ForEach-Object { [pscustomobject]@{ id = $_; name = $Agents[$_].name; short = $Agents[$_].short; installed = ($installed -contains $_) } })
		} }
	}
	$script:AgentCache.Value
}

function Set-Agent([string]$id) {
	if (-not $Agents.Contains($id)) { throw "Rocco doesn't know an agent called '$id'." }
	$settings = Read-RoccoSettings
	if ($settings.PSObject.Properties['agent']) { $settings.agent = $id } else { $settings | Add-Member agent $id }
	New-Item -ItemType Directory -Force (Split-Path $SettingsFile) | Out-Null
	[IO.File]::WriteAllText($SettingsFile, (ConvertTo-Json -InputObject $settings), $Utf8)
	$script:AgentCache = $null
	Get-Agent
}

# The user's agent, opened in a window of its own in $dir with a first prompt: their session, which they watch and steer.
# The prompt has no double quotes: they don't survive the npm .cmd wrappers agents are often installed as.
function Start-AgentWindow([string]$dir, [string]$prompt, [string]$title) {
	$agent = Get-Agent
	$exe = Find-AgentExe $agent.id
	if (-not $exe) { throw "$($agent.name) isn't installed on this PC (Connections)." }
	$quote = { param($s) "'" + ("$s" -replace "'", "''") + "'" }
	$arguments = @($Agents[$agent.id].prompt) + $prompt.Replace('"', '')
	$text = "`$Host.UI.RawUI.WindowTitle = $(& $quote "Rocco: $title")`nSet-Location -LiteralPath $(& $quote $dir)`n" +
		"& $(& $quote $exe) $(($arguments | ForEach-Object { & $quote $_ }) -join ' ')`n"
	$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
	Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded -WorkingDirectory $dir
	$agent
}

# Whether the chosen agent has the Roblox Studio MCP registered, by the name workers rely on.
function Test-StudioMcp {
	$agent = Get-Agent
	$file = Join-Path $env:USERPROFILE $Agents[$agent.id].mcp
	[pscustomobject]@{ agent = $agent; file = $file; registered = ((Test-Path $file) -and ([IO.File]::ReadAllText($file) -match $Agents[$agent.id].studio)) }
}
