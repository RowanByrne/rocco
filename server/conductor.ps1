# The conductor (the template's CONDUCTOR.md): the user's agent session that handles the Workboard. Rocco knows one is
# running from <Game>\rocco\conductor.json: written when Rocco opens one, and kept fresh by `rocco.ps1 wait` while it
# watches the board. When the user hands over work and no conductor is running, Rocco opens one.

function Get-ConductorFile { Join-Path $Root 'rocco\conductor.json' }

function Read-Conductor {
	$file = Get-ConductorFile
	if (Test-Path $file) { try { return [IO.File]::ReadAllText($file, $Utf8) | ConvertFrom-Json } catch { } }
	$null
}

function Save-Conductor($c) {
	$file = Get-ConductorFile
	New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
	[IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $c), $Utf8)
	$script:ConductorCache = @{}
}

$AgentProcesses = 'claude', 'codex', 'gemini', 'node'
function Get-ProcessStart([int]$id) { try { (Get-Process -Id $id -ErrorAction Stop).StartTime.ToString('o') } catch { '' } }
function Test-ProcessAlive([int]$id, [string]$started) { $id -and (Get-ProcessStart $id) -and (-not $started -or (Get-ProcessStart $id) -eq $started) }

# The agent a command runs under: the first agent program above this process (agent, shell, PowerShell, this).
function Find-AgentAbove([int]$id) {
	for ($i = 0; $i -lt 6 -and $id; $i++) {
		$p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
		if (-not $p) { break }
		if ($i -gt 0 -and [IO.Path]::GetFileNameWithoutExtension($p.Name) -in $AgentProcesses) { return [int]$p.ProcessId }
		$id = [int]$p.ParentProcessId
	}
	0
}

# The agent in a window Rocco opened: a child of the window, or of its .cmd wrapper.
function Find-AgentBelow([int]$window) {
	$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
	$level = @($window)
	for ($depth = 0; $depth -lt 3 -and $level; $depth++) {
		$kids = @($all | Where-Object { $level -contains [int]$_.ParentProcessId })
		$agent = $kids | Where-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) -in $AgentProcesses } | Select-Object -First 1
		if ($agent) { return [int]$agent.ProcessId }
		$level = @($kids | ForEach-Object { [int]$_.ProcessId })
	}
	0
}

# 'listening' (waiting on the board now), 'busy' (running, doing something), or 'none'.
$script:ConductorCache = @{}
function Get-Conductor {
	$hit = $script:ConductorCache[$Root]
	if ($hit -and ((Get-Date) - $hit.Read).TotalSeconds -lt 3) { return $hit.Value }
	$c = Read-Conductor
	$value = [pscustomobject]@{ state = 'none'; agent = '' }
	if ($c) {
		# Opened by Rocco a moment ago: its agent may not have started yet.
		if (-not $c.pid -and $c.window -and (Test-ProcessAlive $c.window $c.windowStarted)) {
			$found = Find-AgentBelow $c.window
			if ($found) { $c.pid = $found; $c.started = Get-ProcessStart $found; Save-Conductor $c }
		}
		$alive = if ($c.pid) { Test-ProcessAlive $c.pid $c.started } else { $c.window -and ((Get-Date) - [datetime]$c.at).TotalSeconds -lt 60 -and (Test-ProcessAlive $c.window $c.windowStarted) }
		$fresh = $c.waiting -and ((Get-Date) - [datetime]$c.at).TotalSeconds -lt 20
		$value.agent = "$($c.agent)"
		$value.state = if ($fresh) { 'listening' } elseif ($alive) { 'busy' } else { 'none' }
	}
	$script:ConductorCache[$Root] = @{ Read = Get-Date; Value = $value }
	$value
}

# The user's agent, opened in its own window as this project's conductor, on a first prompt. Returns the agent.
function Open-Conductor([string]$prompt) {
	$agent = Get-Agent
	if (-not $agent.installed) { throw "$($agent.name) isn't installed on this PC (Connections)." }
	$window = Start-AgentWindow $RepoDir $prompt "$($agent.name), conductor on $(Split-Path $Root -Leaf)"
	Save-Conductor ([pscustomobject]@{ agent = $agent.name; window = $window.Id; windowStarted = (Get-ProcessStart $window.Id); pid = 0; started = ''; waiting = $false; at = (Now) })
	$agent
}

# What every conductor Rocco opens is told after its first job: keep watching the board. Rocco's README has the command,
# so this works whatever template release the game is on.
$WatchBoard = 'Then keep watching the Workboard: ..\..\_tools\rocco\rocco.ps1 wait returns as soon as something new waits on you (..\..\_tools\rocco\README.md, Commands).'

# Tasks left Working with no conductor running: a conductor that stopped mid-round (its window closed, the PC restarted),
# and the workers it ran with it.
function Get-CutOff { @(Get-Tasks | Where-Object { $_.status -eq 'working' }) }

# The user handed something over (a note, an answer, a plan to approve), or work was cut off. No conductor running: open
# one on it. Work that was cut off is picked up from the board and the lanes: an agent's old session may not have been
# saved, so a new one starts from what's on disk. Returns the agent's name when one was opened, else ''.
function Request-Conductor {
	if ((Get-Conductor).state -ne 'none') { return '' }
	$agent = Get-Agent
	if (-not $agent.installed) { return '' }
	$cut = @(Get-CutOff)
	$prompt = if ($cut.Count) {
		"Your conductor session for this game stopped mid-round, and its workers with it: $(($cut | ForEach-Object { $_.id }) -join ', ') are still Working on the Workboard. " +
		'Check each one''s lane (its branch, commits and uncommitted work), make sure its place is open and syncing (..\..\_tools\rocco\rocco.ps1 lanes opens whatever isn''t), and carry them on (docs/workflow/CONDUCTOR.md). ' +
		"Handle anything else waiting on you too (rocco.ps1 list -Pending). $WatchBoard"
	} else { "You are the conductor for this game (docs/workflow/CONDUCTOR.md). Handle what waits on you on the Workboard (..\..\_tools\rocco\rocco.ps1 list -Pending). $WatchBoard" }
	try { Open-Conductor $prompt | Out-Null; $agent.name } catch { '' }
}

# rocco.ps1 wait: marks the conductor as listening while it waits, so Rocco shows it, and doesn't open another.
$script:WaitAgent = $null
function Register-Waiting([bool]$waiting) {
	$c = Read-Conductor
	if ($null -eq $script:WaitAgent) { $script:WaitAgent = Find-AgentAbove $PID }
	$agentPid = $script:WaitAgent
	if (-not $c -or ($agentPid -and $c.pid -ne $agentPid)) {
		$c = [pscustomobject]@{ agent = (Get-Agent).name; window = 0; windowStarted = ''; pid = $agentPid; started = (Get-ProcessStart $agentPid); waiting = $waiting; at = (Now) }
	}
	$c.waiting = $waiting
	$c.at = Now
	Save-Conductor $c
}
