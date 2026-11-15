# Shared lanes (the template's LANES.md "Lending a lane"; plans\shared-lanes.md has the trial behind it). A task's
# agent works in a checkout of its own, <Game>\work\<name>\: a git worktree on the task's branch, with no Studio and no
# Lync, so as many tasks as the PC's agents can carry are in progress at once. A lane (lanes.ps1) stays open in Studio
# with its Lync running, and is lent to one task at a time, by commit: the lane's checkout is switched, detached, to the
# commit the task's checkout is on, and Lync syncs the difference into the lane's place. So this PC's lanes are how
# many things can be tested at once, not how many are being built.
#
# A loan is the task's own lane field, as a lane always was: no second record to fall out of step with the board.
# What's new is that the task holds it only while it tests (borrow ... return), while the user tests it (ready, in a
# lane), or while its merge is checked. A task without a checkout (the lane-a-task way) holds its lane as before, and
# both kinds share the lanes.

# ---- Which way a game works ----

# The template's docs say which: a game whose LANES.md has "Lending a lane" has agents that borrow. Its agents follow
# those docs, so Rocco reads them too, and a game on an older template carries on a lane a task.
$script:SharedCache = @{}
function Test-SharedLanes {
	$hit = $script:SharedCache[$RepoDir]
	if (-not $hit -or ((Get-Date) - $hit.Read).TotalSeconds -gt 20) {
		$doc = Join-Path $RepoDir 'docs\workflow\LANES.md'
		$hit = @{ Read = Get-Date; Value = [bool]((Test-Path $doc) -and ([IO.File]::ReadAllText($doc, $Utf8) -match '(?m)^##\s+Lending a lane')) }
		$script:SharedCache[$RepoDir] = $hit
	}
	$hit.Value
}

# ---- A task's checkout ----

function Get-WorkName([string]$branch) { $branch -replace '[\\/]+', '-' }
function Get-WorkDir($t) { if ($t.PSObject.Properties['work'] -and $t.work) { Join-Path $Root "work\$($t.work)" } else { '' } }

function Test-BranchName([string]$branch) { $branch -match '^[A-Za-z0-9][\w./-]{0,120}$' -and $branch -notmatch '\.\.|//|\.lock$|/$' }

# The commit a name stands for in the game's repo, '' when there's none.
function Resolve-Commit([string]$name, [string]$dir = $RepoDir) {
	$ErrorActionPreference = 'Continue'
	$x = git -C $dir rev-parse --verify -q "$name^{commit}" 2>$null
	if ($LASTEXITCODE -eq 0 -and $x) { "$x".Trim() } else { '' }
}

# How many agents this PC works at once: Settings' number, else two per lane. With no lane to hold each task back, a
# big plan would otherwise start an agent per step.
function Get-AgentsLimit { [Math]::Max(1, [int](Get-Lanes).agents) }
# Settings: how many agents at once (0: two per lane again), and whether the user's testing keeps a lane.
$MostAgents = 24
function Set-LaneSettings($body) {
	$settings = Read-RoccoSettings
	if ($body.PSObject.Properties['agentsAtOnce']) {
		$n = [int]$body.agentsAtOnce
		if ($n -lt 0 -or $n -gt $MostAgents) { throw "Agents at once: 1 to $MostAgents, or 0 for two per lane." }
		$settings | Add-Member -Force -NotePropertyName agentsAtOnce -NotePropertyValue $n
	}
	if ($body.PSObject.Properties['keepLane']) { $settings | Add-Member -Force -NotePropertyName keepLane -NotePropertyValue ([bool]$body.keepLane) }
	Save-RoccoSettings $settings
	Get-Agent
}
function Get-AgentsAtWork($tasks) { @($tasks | Where-Object { $_.kind -ne 'plan' -and $_.status -in 'working', 'stuck' }).Count }

# A task's checkout, made if it isn't there: work\<its branch> on that branch, from $base (a feature's branch, for one
# of its pieces), else from GitHub's main, as a lane is made (the template's tools\add-lane.ps1). A branch that
# exists already, here or on GitHub, is carried on. Several tasks on one branch (a feature's steps) share its checkout.
function Add-Work($t, [string]$branch, [string]$base) {
	if (-not (Test-BranchName $branch)) { throw "'$branch' isn't a branch name (letters, numbers, / - _ . , like agent/trade-window)." }
	if ($base -and -not (Test-BranchName $base)) { throw "'$base' isn't a branch name." }
	$name = Get-WorkName $branch
	$dir = Join-Path $Root "work\$name"
	if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
		$on = "$(Invoke-Git $dir symbolic-ref --short -q HEAD)".Trim()
		if ($on -ne $branch) { throw "work\$name is there already, but on $(if ($on) { $on } else { 'no branch' }), not $branch. Put it back on $branch (git -C `"$dir`" switch $branch), or pick another branch name." }
	} else {
		$others = @(Get-Tasks)
		$limit = Get-AgentsLimit
		if ($t.status -notin 'working', 'stuck' -and (Get-AgentsAtWork $others) -ge $limit) {
			throw "$limit agents are at work, which is this PC's limit (Settings, Agents at once). Park it: set $($t.id) -ForLane, and wait hands it back ([lane]) when one finishes."
		}
		$hasOrigin = [bool]"$(Invoke-Git $RepoDir remote get-url origin)"
		# Not being able to reach GitHub this minute doesn't stop the work: it branches from what was last fetched.
		if ($hasOrigin) { Invoke-GitNet $RepoDir @('fetch', 'origin') 60 $false | Out-Null }
		New-Item -ItemType Directory -Force (Join-Path $Root 'work') | Out-Null
		$r = if (Resolve-Commit "refs/heads/$branch") { Invoke-GitText $RepoDir worktree add --relative-paths $dir $branch }
			elseif (Resolve-Commit "refs/remotes/origin/$branch") { Invoke-GitText $RepoDir worktree add --relative-paths -b $branch $dir "origin/$branch" }
			else {
				$from = if ($base) {
					if (Resolve-Commit "refs/heads/$base") { $base } elseif (Resolve-Commit "refs/remotes/origin/$base") { "origin/$base" } else { throw "There's no branch $base to start from." }
				} elseif ($hasOrigin -and (Resolve-Commit 'refs/remotes/origin/main')) { 'origin/main' } else { 'main' }
				# Not tracking what it started from: its first push -u makes its own branch on GitHub.
				Invoke-GitText $RepoDir worktree add --relative-paths --no-track -b $branch $dir $from
			}
		if (-not $r.ok -or -not (Test-Path -LiteralPath (Join-Path $dir '.git'))) {
			throw "Couldn't make work\$name on ${branch}: $($r.text) (A branch is checked out in one place at a time; relative links need Git 2.48 or newer.)"
		}
	}
	Set-Field $t 'work' $name
	Set-Field $t 'branch' $branch
	$dir
}

# A finished task's checkout goes, once nothing else is on it and nothing in it is uncommitted. Returns what to tell
# the conductor, '' when there's nothing to say.
function Remove-Work($t) {
	$dir = Get-WorkDir $t
	if (-not $dir) { return '' }
	$name = $t.work
	if ($t.lane) { Clear-Loan $t }
	Set-Field $t 'work' ''
	if (-not (Test-Path -LiteralPath $dir)) { return '' }
	if (@(Get-Tasks | Where-Object { $_.id -ne $t.id -and $_.PSObject.Properties['work'] -and $_.work -eq $name -and $_.status -notin 'done', 'removed' }).Count) { return '' }
	if ("$(Invoke-Git $dir status --porcelain)".Trim()) { return "work\$name has changes that aren't committed, so it's left where it is. Commit or drop them, then: git worktree remove `"$dir`"" }
	$r = Invoke-GitText $RepoDir worktree remove $dir
	if ($r.ok) { "work\$name is gone (its branch stays until you delete it)." } else { "work\$name couldn't be removed: $($r.text)" }
}

# ---- One lender at a time ----
# Which lane a task gets, and switching it, is decided by one command at a time across the project: a lock file open
# with no sharing, as a task's is (tasks.ps1). Always taken before a task's own lock, never after.

$script:LanesLock = $null
function Lock-Lanes {
	if ($script:LanesLock) { return }
	$dir = Join-Path $Root 'rocco'
	New-Item -ItemType Directory -Force $dir | Out-Null
	$file = Join-Path $dir 'lanes.lock'
	for ($i = 0; $i -lt 2400; $i++) {
		try { $script:LanesLock = New-Object IO.FileStream($file, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None); return }
		catch [IO.IOException] { Start-Sleep -Milliseconds 50 } catch [UnauthorizedAccessException] { Start-Sleep -Milliseconds 50 }
	}
	throw 'The lanes are being handed out by something else right now. Try again in a moment.'
}
function Unlock-Lanes { if ($script:LanesLock) { try { $script:LanesLock.Close() } catch { }; $script:LanesLock = $null } }

# ---- Switching a lane ----

function Get-LaneDir([int]$n) { Join-Path $Root "lanes\lane$n" }

# Whether a task with a checkout holds the lane it has: while its agent tests, while the user tests it, and while its
# merge is checked. Back in Up next (sent back, paused) it has let go.
function Test-HoldsLoan($t) {
	$t.status -in 'working', 'stuck' -or ($t.status -eq 'ready' -and $t.where -eq 'lane') -or $t.pending -eq 'merge'
}

# Why a lane can't be lent this minute, '' when it can: its place has to be open and syncing, and its checkout as a
# switch left it. A lane someone is working in directly (the lane-a-task way) is on a branch, or has changes.
function Get-LaneTrouble([int]$n, $lanes) {
	$dir = Get-LaneDir $n
	if (-not (Test-Path -LiteralPath (Join-Path $dir '.git'))) { return 'has no checkout on this PC' }
	if (@($lanes.open) -notcontains $n) { return 'has no Lync serving it' }
	if ($null -ne $lanes.studio -and @($lanes.studio) -notcontains $n) { return 'isn''t open in Studio' }
	if ("$(Invoke-Git $dir symbolic-ref --short -q HEAD)".Trim()) { return 'is on a branch (something works in it directly)' }
	if ("$(Invoke-Git $dir status --porcelain)".Trim()) { return 'has changes that aren''t committed' }
	''
}

# A folder that is itself a script (it has an init file) stays behind in the place when Lync sees the folder and its
# init file go at once; a plain folder goes as it should (Lync Alpha 30, measured: plans\shared-lanes.md). So a switch
# is two steps: the init files of folders the new commit doesn't have go first, Lync turns those into plain folders,
# and then git switches, which removes them. Returns whether anything changed.
$InitFile = '(^|/)init(\.(server|client))?\.luau?$'
$LyncSettle = 2500
function Switch-Lane([int]$n, [string]$commit) {
	$lane = Get-LaneDir $n
	if ((Resolve-Commit 'HEAD' $lane) -eq $commit) { return $false }
	$going = @(Invoke-Git $lane -c core.quotepath=off diff --no-renames --name-only --diff-filter=D HEAD $commit | ForEach-Object { "$_" } | Where-Object { $_ -match $InitFile } | Where-Object {
		$folder = $_ -replace '/[^/]+$', ''
		-not @(Invoke-Git $lane -c core.quotepath=off ls-tree -r --name-only $commit '--' $folder | Select-Object -First 1).Count
	})
	foreach ($f in $going) { Remove-Item -LiteralPath (Join-Path $lane ($f -replace '/', '\')) -Force -ErrorAction SilentlyContinue }
	if ($going.Count) { Start-Sleep -Milliseconds $LyncSettle }
	$r = Invoke-GitText $lane switch --detach $commit
	if (-not $r.ok) {
		# The files this took away come back: the lane is as it was.
		if ($going.Count) { Invoke-Git $lane checkout HEAD '--' @going | Out-Null }
		throw "Lane $n couldn't be switched to $($commit.Substring(0, 7)): $($r.text)"
	}
	$true
}

# ---- What the place should hold ----
# A count and a fingerprint of every script the lane's checkout syncs, for the agent to compare with the place (the
# checker below, run through the Studio MCP): the proof a lane holds the commit it was lent for, and nothing left from
# the one before. Line ends are read as Studio keeps them.

function Get-SyncedFolders {
	$json = Join-Path $RepoDir 'default.project.json'
	$found = New-Object Collections.Generic.List[object]
	if (-not (Test-Path $json)) { return @() }
	$walk = {
		param($node, [string[]]$at)
		if ($null -eq $node -or $node -isnot [pscustomobject]) { return }
		foreach ($p in $node.PSObject.Properties) {
			if ($p.Name -eq '$path' -and $p.Value -is [string]) { $found.Add([pscustomobject]@{ path = $p.Value; at = $at }) }
			elseif ($p.Name -notmatch '^\$') { & $walk $p.Value (@($at) + $p.Name) }
		}
	}
	& $walk (Get-Content $json -Raw | ConvertFrom-Json).tree @()
	$found.ToArray()
}

function Get-SourceFingerprint([string]$checkout) {
	if (-not ('RoccoFingerprint' -as [type])) {
		Add-Type -TypeDefinition @'
using System; using System.IO; using System.Collections.Generic; using System.Text;
public static class RoccoFingerprint {
	static uint Hash(byte[] b, int n) { uint s = 0; unchecked { for (int i = 0; i < n; i++) s = s * 31 + b[i]; } return s; }
	public static string Of(string[] folders) {
		var keys = new List<string>();
		foreach (var folder in folders) {
			if (!Directory.Exists(folder)) continue;
			foreach (var file in Directory.GetFiles(folder, "*", SearchOption.AllDirectories)) {
				var ext = Path.GetExtension(file).ToLowerInvariant();
				if (ext != ".luau" && ext != ".lua") continue;
				var raw = File.ReadAllBytes(file);
				var text = new byte[raw.Length]; int n = 0;
				for (int i = 0; i < raw.Length; i++) { if (raw[i] == 13 && i + 1 < raw.Length && raw[i + 1] == 10) continue; text[n++] = raw[i]; }
				keys.Add(n + ":" + Hash(text, n));
			}
		}
		keys.Sort(StringComparer.Ordinal);
		var all = Encoding.ASCII.GetBytes(string.Join("|", keys));
		return "scripts=" + keys.Count + " digest=" + Hash(all, all.Length);
	}
}
'@
	}
	[RoccoFingerprint]::Of([string[]]@(Get-SyncedFolders | ForEach-Object { Join-Path $checkout ($_.path -replace '/', '\') }))
}

# The same fingerprint, taken in the place: Luau for the Studio MCP's execute_luau (Edit). Written to <Game>\rocco\,
# with the places this game syncs into.
function Save-LaneCheck {
	$roots = @(Get-SyncedFolders | ForEach-Object {
		$at = @($_.at)
		if (-not $at.Count) { return }
		'add(' + (($at | ForEach-Object { '"' + ($_ -replace '["\\]', '') + '"' }) -join ', ') + ')'
	})
	$code = @"
-- From Rocco (rocco.ps1 borrow / sync): a count and a fingerprint of every script in the folders this game syncs, to
-- compare with the line borrow printed. Run it in the lane's place with the Studio MCP's execute_luau, in Edit.
local roots = {}
local function add(service, ...)
	local at = game:GetService(service)
	for _, name in { ... } do at = at and at:FindFirstChild(name) end
	if at then table.insert(roots, at) end
end
$($roots -join "`n")
local function hash(text)
	local b = buffer.fromstring(text)
	local s = 0
	for i = 0, buffer.len(b) - 1 do s = (s * 31 + buffer.readu8(b, i)) % 4294967296 end
	return s
end
local keys = {}
for _, root in roots do
	for _, d in root:GetDescendants() do
		if d:IsA("LuaSourceContainer") then table.insert(keys, #d.Source .. ":" .. hash(d.Source)) end
	end
end
table.sort(keys)
return string.format("scripts=%d digest=%d", #keys, hash(table.concat(keys, "|")))
"@
	$file = Join-Path $Root 'rocco\lane-check.luau'
	New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
	[IO.File]::WriteAllText($file, ($code -replace "`r`n", "`n"), $Utf8)
	$file
}

# ---- Waiting in line ----
# Agents that asked for a lane while all were busy get one in the order they asked: a file each in
# <Game>\rocco\lanes-waiting\, holding when it first asked, written again every few seconds while its command waits.
# One that stopped waiting (its command ended) is passed over, and keeps its place if it asks again within ten minutes.

$WaitBeat = 15
function Get-WaitFile([string]$id) { Join-Path $Root "rocco\lanes-waiting\$id" }
function Enter-LaneLine([string]$id) {
	$file = Get-WaitFile $id
	New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
	$asked = ''
	if (Test-Path -LiteralPath $file) {
		try { $asked = [IO.File]::ReadAllText($file).Trim(); [datetime]$asked | Out-Null } catch { $asked = '' }
		# Long gone: it asks afresh, behind whoever is waiting now.
		$idle = ((Get-Date) - (Get-Item -LiteralPath $file).LastWriteTime).TotalSeconds
		if ($asked -and $idle -gt 600) { $asked = '' }
	}
	if (-not $asked) { $asked = Now }
	[IO.File]::WriteAllText($file, $asked)
}
function Exit-LaneLine([string]$id) { Remove-Item -LiteralPath (Get-WaitFile $id) -Force -ErrorAction SilentlyContinue }
# How many are waiting now that asked before this one.
function Get-AheadInLine([string]$id) {
	$dir = Split-Path (Get-WaitFile $id)
	if (-not (Test-Path -LiteralPath $dir)) { return 0 }
	$mine = Get-WaitFile $id
	$asked = if (Test-Path -LiteralPath $mine) { try { [datetime][IO.File]::ReadAllText($mine).Trim() } catch { Get-Date } } else { Get-Date }
	@(Get-ChildItem -LiteralPath $dir -File | Where-Object { $_.Name -ne $id -and ((Get-Date) - $_.LastWriteTime).TotalSeconds -le $WaitBeat } | Where-Object {
		try { [datetime][IO.File]::ReadAllText($_.FullName).Trim() -lt $asked } catch { $false }
	}).Count
}

# ---- Lending ----

# Whether the user's own testing keeps a lane however many agents wait (Settings, Keep a lane for my testing).
function Test-KeepLane { $s = Read-RoccoSettings; [bool]($s.PSObject.Properties['keepLane'] -and $s.keepLane) }

function Set-Loan($t, [int]$n, [string]$for) {
	Set-Field $t 'lane' $n
	Set-Field $t 'laneFor' $for
	Set-Field $t 'laneAt' (Now)
}
function Clear-Loan($t) {
	Set-Field $t 'lane' $null
	Set-Field $t 'laneFor' ''
	Set-Field $t 'laneAt' $null
}
# A loan ends by itself when its task stops testing: sent back, paused, deleted, or merged and cleared. Every save of
# a task comes through here (tasks.ps1 Save-Task), so no path that changes a task has to remember the lane.
function Clear-EndedLoan($t) { if ($t.lane -and (Get-WorkDir $t) -and -not (Test-HoldsLoan $t)) { Clear-Loan $t } }
# A card the user is to test in a lane, with no lane holding it just now: the app offers Load into a lane.
function Test-NeedsLane($t) { [bool]((Get-WorkDir $t) -and -not $t.lane -and $t.status -eq 'ready' -and $t.where -eq 'lane') }

# One go at a lane for a task, with the lanes held: the one it has, a free one, or (for an agent) one the user's
# testing holds, the longest-held first. Switches it to the task's commit and records it. Returns the lane, 0 when
# there's none this minute, with why in $script:NoLane.
function Get-LaneNow([string]$id, [string]$for) {
	$script:NoLane = ''
	$tasks = @(Get-Tasks)
	$t = $tasks | Where-Object { $_.id -eq $id } | Select-Object -First 1
	$dir = Get-WorkDir $t
	$commit = Resolve-Commit 'HEAD' $dir
	if (-not $commit) { throw "$id's checkout ($dir) has no commit to lend a lane for." }
	$lanes = Get-Lanes
	$n = 0
	$from = $null
	if ($t.lane -and (Test-HoldsLoan $t)) { $n = [int]$t.lane }
	else {
		$trouble = @{}
		$free = @(Get-FreeLanes $tasks | Where-Object { $trouble[$_] = Get-LaneTrouble $_ $lanes; -not $trouble[$_] })
		$ahead = if ($for -eq 'agent') { Get-AheadInLine $id } else { 0 }
		if ($free.Count -gt $ahead) { $n = if ($t.wantLane -and $free -contains [int]$t.wantLane) { [int]$t.wantLane } else { $free[0] } }
		elseif ($for -ne 'user' -and -not $free.Count) {
			# The user's testing gives way to work that's waiting: a lane is back in their hands in seconds (Load into a
			# lane, on the card), since its Studio is already open. Unless they keep one, which the last of them is.
			$theirs = @($tasks | Where-Object { $_.lane -and (Get-WorkDir $_) -and $_.status -eq 'ready' -and $_.where -eq 'lane' -and $_.pending -ne 'merge' -and -not (Get-LaneTrouble ([int]$_.lane) $lanes) } |
				Sort-Object { if ($_.laneAt) { [datetime]$_.laneAt } else { [datetime]::MinValue } })
			if ($theirs.Count -gt $(if (Test-KeepLane) { 1 } else { 0 })) { $from = $theirs[0]; $n = [int]$from.lane }
		}
		if (-not $n) {
			$count = [int]$lanes.count
			$down = @(if ($count) { 1..$count | Where-Object { $trouble[$_] } | ForEach-Object { "lane $_ $($trouble[$_])" } })
			$script:NoLane = if (-not $count) { 'This PC opens no lanes yet (Lanes, in Rocco''s sidebar).' }
				elseif ($down.Count -eq $count) { "No lane can be lent: $($down -join '; '). Rocco's Lanes (or rocco.ps1 lanes) opens what isn't." }
				else { "Every lane is busy$(if ($down.Count) { " ($($down -join '; '))" })." }
			return 0
		}
	}
	if ($from) {
		$other = Read-Task $from.id
		Clear-Loan $other
		Add-Log $other 'conductor' "Lane $n went to $id, which was waiting to test. Load into a lane, on this card, puts it back in one."
		Save-Task $other
	}
	Switch-Lane $n $commit | Out-Null
	$t = Read-Task $id
	Set-Loan $t $n $(if ($t.pending -eq 'merge') { 'conductor' } else { $for })
	Save-Task $t
	$n
}

# A lane for a task: at once if there is one, else (an agent) waiting in line for up to $seconds. The user's own
# loan (a card ready to test, or Load into a lane) never waits and never takes a lane from anyone: with none free the
# card says so, and offers it. Returns { lane, text }.
function Invoke-Borrow([string]$id, [string]$for, [int]$seconds) {
	$t = Get-Task $id
	if (-not (Get-WorkDir $t)) { throw "$id has no checkout of its own: work $id -Branch agent/<slug> makes one. (A task given a lane with set -Lane works in that lane, and has nothing to borrow.)" }
	if (-not (Test-Path -LiteralPath (Get-WorkDir $t))) { throw "$id's checkout, $(Get-WorkDir $t), isn't on this PC. work $id -Branch $($t.branch) makes it." }
	if ($for -eq 'agent' -and -not (Test-HoldsLoan $t)) { throw "$id is $($t.status): a lane is lent to a task that's being worked on (set $id -Status working), tested by the user, or merged." }
	$deadline = (Get-Date).AddSeconds($seconds)
	$waited = $false
	try {
		while ($true) {
			if ($for -eq 'agent') { Enter-LaneLine $id }
			Lock-Lanes
			try { $n = Get-LaneNow $id $for } finally { Unlock-Lanes; Unlock-Tasks }
			if ($n) { return [pscustomobject]@{ lane = $n; text = (Get-LoanText (Get-Task $id) $waited) } }
			if ($for -ne 'agent') { return [pscustomobject]@{ lane = 0; text = "$($script:NoLane) $id waits for one: its card offers Load into a lane." } }
			if ((Get-Date) -ge $deadline) { throw "$($script:NoLane) $id kept its place in line: run borrow $id again to go on waiting." }
			$waited = $true
			Start-Sleep -Seconds 3
		}
	} finally { if ($for -eq 'agent' -and $n) { Exit-LaneLine $id } }
}

# A lane on loan whose place has closed is opened again, as Fix lanes would: Studio sometimes goes down just after a
# large sync (measured: plans\shared-lanes.md), and a place opened with the code already on disk holds exactly that
# code, as long as its file was never saved with scripts in it. Returns whether it had to.
function Restore-LanePlace([int]$n) {
	$code = (Get-ProjectField 'Code').Trim('`', ' ')
	if (-not $code -or $code -match '\{\{') { return $false }
	$place = Find-PlaceFile "$code-Lane$n"
	if (-not (Test-Path -LiteralPath $place) -or (Test-PlaceOpen $place)) { return $false }
	# Nothing has the place open (Test-PlaceOpen looked three ways), so a lock is a crash's leftover.
	Remove-Item -LiteralPath "$place.lock" -Force -ErrorAction SilentlyContinue
	Start-Hidden "cmd.exe /d /c start `"`" `"$place`"" $Root | Out-Null
	$true
}

# What borrow and sync say: where to test, what the place should hold, and what isn't in it.
function Get-LoanText($t, [bool]$waited = $false) {
	$n = [int]$t.lane
	$dir = Get-WorkDir $t
	$code = (Get-ProjectField 'Code').Trim('`', ' ')
	$subject = "$(Invoke-Git $dir log -1 '--format=%h %s')".Trim()
	$loose = @("$(Invoke-Git $dir status --porcelain)" -split "`n" | Where-Object { $_.Trim() }).Count
	$reopened = Restore-LanePlace $n
	@(
		"$($t.id) has lane $n$(if ($waited) { ' (it waited for one)' }): the place $code-Lane$n in Studio now holds $subject."
		$(if ($reopened) { "That place had closed (Studio went down), so Rocco is opening it again: wait for $code-Lane$n to show in list_roblox_studios, about 20 seconds, before you check." })
		"Check it synced: run $(Save-LaneCheck) through execute_luau in that place (Edit). It should return: $(Get-SourceFingerprint (Get-LaneDir $n))"
		$(if ($loose) { "Not in the lane: $loose file$(if ($loose -ne 1) { 's' }) in $dir not committed yet. A lane gets commits: commit, then sync $($t.id)." })
		"Edit only in $dir, never in the lane. After more commits: sync $($t.id). Done testing for now (no playtest left running): return $($t.id). Keep the lane after your last test before you report: the user tests there."
	) | Where-Object { $_ }
}

# The lane a task has, switched to its checkout's latest commit.
function Invoke-Sync([string]$id) {
	Lock-Lanes
	try {
		$t = Get-Task $id
		if (-not $t.lane -or -not (Get-WorkDir $t) -or -not (Test-HoldsLoan $t)) { throw "$id has no lane just now: borrow $id." }
		$commit = Resolve-Commit 'HEAD' (Get-WorkDir $t)
		Switch-Lane ([int]$t.lane) $commit | Out-Null
		# Approved, and now its merge is being checked here: the lane says so.
		if ($t.pending -eq 'merge' -and $t.laneFor -ne 'conductor') { $t = Read-Task $id; Set-Field $t 'laneFor' 'conductor'; Save-Task $t }
	} finally { Unlock-Lanes; Unlock-Tasks }
	Get-LoanText (Get-Task $id)
}

# A task lets go of its lane. The lane stays on the commit it had: the next loan switches it. A card the user is
# still to test then waits for a lane again (its card offers one).
function Invoke-Return([string]$id) {
	Lock-Lanes
	try {
		$t = Read-Task $id
		if (-not (Get-WorkDir $t)) { throw "$id has no checkout of its own, so its lane isn't a loan: set $id -Lane 0 takes it out of its lane." }
		if (-not $t.lane) { Unlock-Tasks; return "$id has no lane to return." }
		$n = [int]$t.lane
		Clear-Loan $t
		Save-Task $t
	} finally { Unlock-Lanes }
	Exit-LaneLine $id
	"$id returned lane $n."
}
