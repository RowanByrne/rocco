# The coding agents Rocco can open (the template's docs/workflow/MODELS.md "Your agent"). Each PC picks one in Settings:
# Rocco opens it for onboarding, says its name where it asks it for something, and checks it in Connections.
# Supporting another agent is a row here: how it's started with a prompt, where it keeps MCP servers, the plan it runs on
# (onboarding's accounts screen: the user brings their own), and how to install it and sign in (actions.ps1).

$Agents = [ordered]@{
	# hooks: the flag that loads Rocco's conductor hooks (conductor.ps1), so Rocco shows what it does and asks.
	# model: the flag that picks the conductor's model (Settings), and the names it's known to take, for the app's list
	# (any other name the agent accepts can be typed).
	claude = @{ name = 'Claude Code'; short = 'Claude'; exe = 'claude'; prompt = @(); mcp = '.claude.json'; studio = '"Roblox_Studio"\s*:\s*\{'
		plan = 'A Claude Pro or Max plan, or Anthropic API credit'; install = 'claude-install'; login = 'claude-login'; hooks = '--settings'
		model = '--model'; models = @('fable', 'opus', 'sonnet', 'haiku', 'opusplan') }
	codex  = @{ name = 'Codex'; short = 'Codex'; exe = 'codex'; prompt = @(); mcp = '.codex\config.toml'; studio = '\[mcp_servers\.Roblox_Studio\]'
		plan = 'A ChatGPT plan, or OpenAI API credit'; install = 'codex-update'; login = 'codex-login' }
	gemini = @{ name = 'Gemini CLI'; short = 'Gemini'; exe = 'gemini'; prompt = @('-i'); mcp = '.gemini\settings.json'; studio = '"Roblox_Studio"\s*:\s*\{'
		plan = 'A Google account (free to start), or a Gemini API key'; install = 'gemini-update'; login = 'gemini-login' }
}

# This PC's Rocco settings, kept with the user (not in a project, not in the RoDev folder, which can move between PCs).
$SettingsFile = Join-Path $RoccoHome 'settings.json'
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
		$settings = Read-RoccoSettings
		$chosen = "$($settings.agent)"
		# Until the user picks, the first one installed.
		$id = if ($Agents.Contains($chosen)) { $chosen } elseif ($installed) { $installed[0] } else { 'claude' }
		# The conductor's model, kept per agent: '' leaves it to the agent's own default.
		$model = if ($settings.PSObject.Properties['models'] -and $settings.models) { "$($settings.models.$id)" } else { '' }
		$script:AgentCache = @{ Read = Get-Date; Value = [pscustomobject]@{
			id = $id; name = $Agents[$id].name; short = $Agents[$id].short; installed = ($installed -contains $id); chosen = [bool]$chosen
			model = $model; takesModel = [bool]$Agents[$id].model; models = @($Agents[$id].models | Where-Object { $_ })
			agents = @($Agents.Keys | ForEach-Object { [pscustomobject]@{ id = $_; name = $Agents[$_].name; short = $Agents[$_].short; installed = ($installed -contains $_) } })
		} }
	}
	$script:AgentCache.Value
}

function Save-RoccoSettings($settings) {
	New-Item -ItemType Directory -Force (Split-Path $SettingsFile) | Out-Null
	[IO.File]::WriteAllText($SettingsFile, (ConvertTo-Json -InputObject $settings -Depth 5), $Utf8)
	$script:AgentCache = $null
}

function Set-Agent([string]$id) {
	if (-not $Agents.Contains($id)) { throw "Rocco doesn't know an agent called '$id'." }
	$settings = Read-RoccoSettings
	$settings | Add-Member -Force -NotePropertyName agent -NotePropertyValue $id
	Save-RoccoSettings $settings
	Get-Agent
}

# The model the conductor is opened on, for this PC's agent: a name the agent takes ('' for its own default). It
# applies to the next conductor Rocco opens.
function Set-AgentModel([string]$model) {
	$agent = Get-Agent
	$model = "$model".Trim()
	if (-not $Agents[$agent.id].model) { throw "$($agent.name) is opened on its own default model: Rocco can't pick one for it." }
	if ($model -and $model -notmatch '^[A-Za-z0-9][\w.:\[\]-]{0,79}$') { throw "That doesn't look like a model's name (like opus, sonnet, or a full name such as claude-opus-5-5)." }
	$settings = Read-RoccoSettings
	$models = if ($settings.PSObject.Properties['models'] -and $settings.models) { $settings.models } else { [pscustomobject]@{} }
	$models | Add-Member -Force -NotePropertyName $agent.id -NotePropertyValue $model
	$settings | Add-Member -Force -NotePropertyName models -NotePropertyValue $models
	Save-RoccoSettings $settings
	Get-Agent
}

# The user's agent, opened in a window of its own in $dir with a first prompt: their session, which they can watch and
# steer. It starts minimized in the taskbar, out of the way: the user follows it in Rocco, and opens the window only when
# they want to (or the agent asks them something there). The prompt has no double quotes: they don't survive the npm
# .cmd wrappers agents are often installed as. Returns the window's process (conductor.ps1 finds the agent in it).
function Start-AgentWindow([string]$dir, [string]$prompt, [string]$title, [string[]]$extra = @()) {
	$agent = Get-Agent
	$exe = Find-AgentExe $agent.id
	if (-not $exe) { throw "$($agent.name) isn't installed on this PC (Connections)." }
	$arguments = @($extra | Where-Object { $_ }) + @($Agents[$agent.id].prompt) + $prompt.Replace('"', '')
	# What the window runs is fixed text: the title, folder, program and its arguments reach it as data, in ROCCO_START
	# (JSON, base64), never as part of the script. So nothing in a prompt can be read as PowerShell, whatever quotes it
	# has (a curly apostrophe closes a quoted string in PowerShell just as a straight one does).
	# A session of its own: what marks an agent's child processes (Rocco started from an agent's shell) is left behind,
	# or Claude Code takes it for a sub-session and doesn't save its transcript.
	$text = @'
$start = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ROCCO_START)) | ConvertFrom-Json
Remove-Item Env:ROCCO_START, Env:CLAUDECODE, Env:CLAUDE_CODE_CHILD_SESSION -ErrorAction SilentlyContinue
$Host.UI.RawUI.WindowTitle = $start.title
Set-Location -LiteralPath $start.dir
$arguments = @($start.arguments)
& $start.exe @arguments
'@
	$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
	$data = ConvertTo-Json -Compress -InputObject ([ordered]@{ title = "Rocco: $title"; dir = $dir; exe = $exe; arguments = @($arguments) })
	# The window inherits this process's environment as it is when it starts.
	$env:ROCCO_START = [Convert]::ToBase64String($Utf8.GetBytes($data))
	try {
		Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded -WorkingDirectory $dir -WindowStyle Minimized -PassThru
	} finally { Remove-Item Env:ROCCO_START -ErrorAction SilentlyContinue }
}

# Whether the chosen agent has the Roblox Studio MCP registered, by the name workers rely on.
function Test-StudioMcp {
	$agent = Get-Agent
	$file = Join-Path $env:USERPROFILE $Agents[$agent.id].mcp
	[pscustomobject]@{ agent = $agent; file = $file; registered = ((Test-Path $file) -and ([IO.File]::ReadAllText($file) -match $Agents[$agent.id].studio)) }
}
