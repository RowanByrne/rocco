# A feature's own agent (README.md "Feature threads", and LEAD.md, which the agent reads). The conductor sorts what
# the user sends, does small fixes, and merges into main. A feature the user approves is built by an agent of its own,
# in a lane it keeps for the feature's life: the user talks to it directly, in the feature's own thread (thread.ps1),
# and what they ask of its tasks goes to it, not through the conductor. A card can be given one too: the app offers
# the third time it's sent back. "A lead" below is that agent, and its thread's id is the plan's or the card's.
#
# A lead is tracked, opened, watched and stopped exactly as the conductor is (conductor.ps1): the same code, with its
# thread in use (core.ps1 Use-Thread).

# On unless this PC turned it off (Settings). Off, the conductor builds an approved feature with its workers.
function Test-LeadsOn { $s = Read-RoccoSettings; -not ($s.PSObject.Properties['leads'] -and $s.leads -eq $false) }
function Set-LeadsOn([bool]$on) {
	$settings = Read-RoccoSettings
	$settings | Add-Member -Force -NotePropertyName leads -NotePropertyValue $on
	Save-RoccoSettings $settings
	Get-Agent
}

# Whose a task is: '' for the conductor, or the id of the thread whose agent has it. A feature with its own agent has
# its plan and its steps; a card with one has itself. Merging into main stays the conductor's whoever built it, and
# so does a card that's being handed over, until its worker has let go. $work: who is working on it, whatever is
# being asked of it right now.
function Get-TaskOwner($t, $byId, [bool]$work = $false) {
	if (-not $work -and $t.pending -in 'merge', 'handoff') { return '' }
	if ($t.lead -and $t.status -ne 'removed') { return "$($t.id)" }
	$p = if ($t.plan) { $byId["$($t.plan)"] } else { $null }
	if ($p -and $p.lead -and $p.status -ne 'removed') { return "$($p.id)" }
	''
}

# The lane a lead works in: the one it has, else the one the user picked for it if that's free, else the first free
# one. 0 when every lane is busy.
function Get-LeadLane($t, $tasks) {
	if ($t.lane) { return [int]$t.lane }
	$free = @(Get-FreeLanes $tasks)
	if ($t.wantLane -and $free -contains [int]$t.wantLane) { return [int]$t.wantLane }
	if ($free.Count) { return [int]$free[0] }
	0
}

# What a lead is told when it's opened: what it is, where to read how, and to watch for what the user sends. No
# double quotes: they don't survive some agents' wrappers (agents.ps1).
function Get-LeadPrompt($t, [int]$lane) {
	$tools = Get-ToolsPath
	$what = if ($t.kind -eq 'plan') { "the feature $($t.id) ($($t.title))" } else { "the task $($t.id) ($($t.title))" }
	$cut = @(Get-CutOff | ForEach-Object { $_.id })
	$head = if ($t.leadOpened) {
		"You are the agent for $what in this game, picking it up again: your last session ended. " +
		$(if ($cut.Count) { "$($cut -join ', ') $(if ($cut.Count -eq 1) { 'is' } else { 'are' }) still marked Working: check this lane (its branch, its commits, anything uncommitted) and carry on from there. " } else { '' })
	} elseif ($t.kind -eq 'plan') {
		"You are the agent for $what in this game. The user approved its plan: you build it yourself, step by step, in this lane (lane $lane), and they talk to you directly in Rocco. "
	} else {
		"You now have $what to yourself: the user gave it an agent of its own, to work it through with them directly. This is its lane (lane $lane)$(if ($t.branch) { ", and its work so far is on $($t.branch)" }). "
	}
	"$head Read $tools\LEAD.md first, then run $tools\rocco.ps1 show $($t.id) and $tools\rocco.ps1 list -Pending. $(Get-WatchText)"
}

# Opens a thread's agent if it should be running and isn't. First it's given its lane, which it keeps. Returns the
# agent's name when one was opened, else '' (the task's waiting line says what it's waiting for). Called with the
# thread in use.
function Start-Lead([string]$id) {
	$t = Get-Task $id
	if (-not $t.lead -or $t.status -in 'done', 'removed' -or $t.pending -eq 'handoff') { return '' }
	$lane = Get-LeadLane $t @(Get-Tasks)
	$dir = Join-Path $Root "lanes\lane$lane"
	$waiting = if (-not [int](Get-Lanes).count) { 'This PC opens no lanes yet. Open some (Lanes, in the sidebar), and its agent starts' }
		elseif (-not $lane) { 'Waiting for a free lane: its agent starts when one is' }
		elseif (-not (Test-Path -LiteralPath $dir)) { "Lane $lane has no checkout on this PC yet. Open the lanes (the sidebar), and its agent starts" }
		else { '' }
	if ($waiting -or [int]$t.lane -ne $lane) {
		$t = Read-Task $id
		if (-not $waiting) { Set-Field $t 'lane' $lane }
		Set-Field $t 'waiting' $waiting
		Save-Task $t
	}
	if ($waiting) { return '' }
	if ($env:ROCCO_NO_CONDUCTOR -or (Get-Conductor).state -ne 'none') { return '' }
	$agent = Get-Agent
	if (-not $agent.installed) { return '' }
	Open-Conductor (Get-LeadPrompt $t $lane) $dir "$($t.title) ($id), lane $lane" | Out-Null
	$t = Read-Task $id
	Set-Field $t 'leadOpened' (Now)
	if ($t.waiting -match 'agent') { Set-Field $t 'waiting' '' }
	Save-Task $t
	$agent.name
}

# The user sent a thread something, or asked something of one of its tasks: its agent is opened if none is running.
# Called with that thread in use (Request-Conductor does, for any thread but the conductor's).
function Request-Lead {
	try { Start-Lead $script:ThreadId } catch { '' }
}

# As the board is looked at: a lead that has never been opened is, once it can be (it has a lane to take, and a card's
# old worker has let go of it). After that it's opened again only when something waits on it, like the conductor.
function Update-Leads {
	foreach ($t in @(Get-Tasks | Where-Object { $_.lead -and -not $_.leadOpened -and $_.status -notin 'done', 'removed' -and $_.pending -ne 'handoff' })) {
		try { Use-Thread $t.id; Start-Lead $t.id | Out-Null } catch { } finally { Use-Thread '' }
	}
}

# Ends a thread's agent: its feature is finished or deleted, or its card approved. Its thread says so.
function Stop-Lead([string]$id, [string]$why) {
	$was = $script:ThreadId
	try {
		Use-Thread $id
		if (Stop-Conductor) { Add-Thread 'event' @{ text = $why; task = $id } 'rocco' | Out-Null }
	} catch { } finally { $script:ThreadId = $was }
}

# What the app shows for each thread with an agent of its own, among the tasks the board carries: what it's for, and
# its agent's state, as for the conductor (Get-Conductor).
function Get-LeadsState($tasks) {
	$was = $script:ThreadId
	try {
		@($tasks | Where-Object { $_.lead } | ForEach-Object {
			Use-Thread $_.id
			[pscustomobject]@{
				id = $_.id; title = $_.title; kind = $(if ($_.kind -eq 'plan') { 'feature' } else { 'card' }); lane = $_.lane
				done = ($_.status -eq 'done'); handoff = ($_.pending -eq 'handoff'); waiting = "$($_.waiting)"; opened = [bool]$_.leadOpened
				conductor = (Get-Conductor)
			}
		})
	} finally { $script:ThreadId = $was }
}
