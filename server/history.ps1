# History: main's recent commits, the branches not yet merged, and what each lane has done
# (its own HEAD reflog: every commit, switch, merge and refresh made in that checkout).

function Get-RepoUrl {
	$origin = "$(Invoke-Git $RepoDir remote get-url origin)"
	if ($origin -match 'github\.com[:/]([\w.-]+/[\w.-]+?)(\.git)?$') { "https://github.com/$($Matches[1])" } else { '' }
}

# Every lane checkout: a worktree in a folder named laneN.
function Get-Worktrees {
	$list = @(); $current = $null
	foreach ($line in @(Invoke-Git $RepoDir worktree list --porcelain)) {
		if ($line -like 'worktree *') { if ($current) { $list += $current }; $current = @{ path = $line.Substring(9); head = ''; branch = '' } }
		elseif ($line -like 'HEAD *') { $current.head = $line.Substring(5) }
		elseif ($line -like 'branch *') { $current.branch = $line.Substring(7) -replace '^refs/heads/', '' }
	}
	if ($current) { $list += $current }
	foreach ($w in $list) {
		if ((Split-Path $w.path -Leaf) -match '^lane(\d+)$') {
			[pscustomobject]@{ lane = [int]$Matches[1]; path = $w.path; head = $w.head; branch = $w.branch }
		}
	}
}

# Builds published to players: each release/<date> tag (RELEASING.md), newest first. The newest is live.
function Get-Releases {
	$tags = @(Invoke-Git $RepoDir for-each-ref refs/tags/release --sort=-creatordate '--format=%(refname:short)%09%(*objectname)%09%(objectname)')
	foreach ($line in $tags) {
		$f = "$line" -split "`t"
		if ($f.Count -lt 3) { continue }
		# An annotated tag points at its commit through *objectname; a lightweight one points at it directly.
		[pscustomobject]@{ tag = $f[0]; commit = $(if ($f[1]) { $f[1] } else { $f[2] }) }
	}
}

# Commits the user bookmarked, kept with the project's Rocco data (outside git).
function Get-MarksPath { Join-Path $Root 'rocco\history.json' }
function Get-Bookmarks {
	$path = Get-MarksPath
	if (Test-Path $path) { @(([IO.File]::ReadAllText($path, $Utf8) | ConvertFrom-Json).bookmarks | Where-Object { $_ }) } else { @() }
}
function Switch-Bookmark([string]$hash) {
	if ($hash -notmatch '^[0-9a-f]{7,40}$') { throw "Not a commit: '$hash'." }
	$marks = @(Get-Bookmarks)
	$on = $marks -notcontains $hash
	$marks = if ($on) { @($marks) + $hash } else { @($marks | Where-Object { $_ -ne $hash }) }
	New-Item -ItemType Directory -Force (Split-Path (Get-MarksPath)) | Out-Null
	[IO.File]::WriteAllText((Get-MarksPath), (ConvertTo-Json -InputObject ([pscustomobject]@{ bookmarks = @($marks) }) -Depth 3), $Utf8)
	$script:HistoryCache = @{}
	$on
}

# Where a task's changes are in git: its merge into main if it's merged, else its branch against main. $null when
# it has no branch, or the branch is gone and was never merged.
function Get-TaskRange($t) {
	$branch = "$($t.branch)"
	$repo = Get-RepoUrl
	if (-not $branch) { return $null }
	$merge = "$(Invoke-Git $RepoDir log main --merges -1 --format=%H --fixed-strings "--grep=Merge branch '$branch'")"
	if ($merge) { return [pscustomobject]@{ range = @("$merge^1", $merge); source = 'merged'; url = $(if ($repo) { "$repo/commit/$merge" } else { '' }) } }
	$ref = if (Invoke-Git $RepoDir rev-parse --verify --quiet "refs/heads/$branch") { "refs/heads/$branch" } elseif (Invoke-Git $RepoDir rev-parse --verify --quiet "refs/remotes/origin/$branch") { "refs/remotes/origin/$branch" } else { '' }
	if (-not $ref) { return $null }
	[pscustomobject]@{ range = @("main...$ref"); source = 'branch'; url = $(if ($repo) { "$repo/compare/main...$branch" } else { '' }) }
}

# What a task changed: each file, with its lines added and removed. A file that was renamed shows as one removed and
# one added, so every path here is a file's own name (Get-TaskDiff takes one).
function Get-TaskChanges($t) {
	$r = Get-TaskRange $t
	if (-not $r) { return [pscustomobject]@{ source = ''; url = ''; files = @() } }
	$range = @($r.range)
	$files = foreach ($line in @(Invoke-Git $RepoDir -c core.quotepath=false diff --numstat --no-renames @range)) {
		$f = "$line" -split "`t"
		if ($f.Count -ge 3) { [pscustomobject]@{ path = $f[2]; added = $(if ($f[0] -eq '-') { 0 } else { [int]$f[0] }); removed = $(if ($f[1] -eq '-') { 0 } else { [int]$f[1] }); binary = ($f[0] -eq '-') } }
	}
	[pscustomobject]@{ source = $r.source; url = $r.url; files = @($files) }
}

# One changed file's lines as git shows them (a unified diff), for the card to show. Only a file the task changed is
# looked up: the path is checked against Get-TaskChanges, never passed on as it came. A very long diff is cut.
$DiffMax = 300KB
function Get-TaskDiff($t, [string]$path) {
	$r = Get-TaskRange $t
	$file = if ($r) { @((Get-TaskChanges $t).files | Where-Object { $_.path -ceq $path })[0] } else { $null }
	if (-not $file) { throw "That file isn't one this task changed." }
	if ($file.binary) { return [pscustomobject]@{ path = $path; binary = $true; text = ''; cut = $false } }
	$range = @($r.range)
	$text = (@(Invoke-Git $RepoDir -c core.quotepath=false diff --no-color --no-renames --unified=3 @range '--' $path) -join "`n")
	$cut = $text.Length -gt $DiffMax
	if ($cut) { $text = $text.Substring(0, $DiffMax); $text = $text.Substring(0, [Math]::Max(0, $text.LastIndexOf("`n"))) }
	[pscustomobject]@{ path = $path; binary = $false; text = $text; cut = $cut }
}

function Get-MainHistory {
	$hasRemote = [bool](Invoke-Git $RepoDir rev-parse --verify --quiet origin/main)
	$unpushed = @{}
	if ($hasRemote) { foreach ($hash in @(Invoke-Git $RepoDir rev-list origin/main..main)) { $unpushed[$hash] = $true } }
	$releases = @(Get-Releases)
	$releaseOf = @{}
	foreach ($r in $releases) { if (-not $releaseOf[$r.commit]) { $releaseOf[$r.commit] = $r.tag } }
	$live = if ($releases) { $releases[0].commit } else { '' }
	$bookmarks = @(Get-Bookmarks)
	$commits = foreach ($line in @(Invoke-Git $RepoDir log main -40 '--format=%H%x09%h%x09%P%x09%an%x09%cI%x09%s%x09%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)')) {
		$f = $line -split "`t"
		if ($f.Count -lt 6) { continue }
		$branch = if ($f[5] -match "^Merge (?:remote-tracking )?branch '([^']+)'") { $Matches[1] -replace '^origin/', '' } else { '' }
		[pscustomobject]@{
			full = $f[0]; hash = $f[1]; author = $f[3]; at = $f[4]; subject = $f[5]
			merge = @($f[2] -split ' ' | Where-Object { $_ }).Count -gt 1
			branch = $branch
			# The agent that co-wrote it, from its Co-Authored-By line ("Claude Opus 5.5", "Codex", ...).
			agent = $(if ($f.Count -gt 6 -and $f[6] -match '^\s*([^<,]+?)\s*<') { $Matches[1] } else { '' })
			pushed = -not $unpushed[$f[0]]
			release = "$($releaseOf[$f[0]])"
			live = ($f[0] -eq $live)
			bookmarked = ($bookmarks -contains $f[0])
		}
	}
	[pscustomobject]@{
		remote = $hasRemote; unpushed = $unpushed.Count; total = [int](Invoke-Git $RepoDir rev-list --count main); commits = @($commits)
		live = $(if ($releases) { [pscustomobject]@{ tag = $releases[0].tag; commit = $releases[0].commit } } else { $null })
	}
}

# Branches other than main, local and on GitHub, each with how far it is from main and the lane it's checked out in.
function Get-Branches($worktrees) {
	$laneOf = @{}
	foreach ($w in $worktrees) { if ($w.branch) { $laneOf[$w.branch] = $w.lane } }
	$seen = @{}
	# refs/heads sorts before refs/remotes, so a branch's local copy comes first.
	$rows = foreach ($line in @(Invoke-Git $RepoDir for-each-ref refs/heads refs/remotes/origin '--format=%(refname)%09%(refname:short)%09%(committerdate:iso-strict)%09%(subject)%09%(authorname)')) {
		$f = $line -split "`t"
		if ($f[0] -eq 'refs/heads/main' -or $f[0] -match '^refs/remotes/origin/(HEAD|main)$') { continue }
		$remote = $f[0] -like 'refs/remotes/*'
		$name = if ($remote) { $f[1] -replace '^origin/', '' } else { $f[1] }
		if ($seen[$name]) { $seen[$name].pushed = $true; continue }
		$counts = "$(Invoke-Git $RepoDir rev-list --left-right --count "main...$($f[0])")" -split '\s+'
		$row = [pscustomobject]@{
			name = $name; local = -not $remote; pushed = $remote; at = $f[2]; subject = $f[3]; author = $f[4]
			behind = [int]$counts[0]; ahead = [int]$counts[1]; lane = $laneOf[$name]
		}
		$seen[$name] = $row
		$row
	}
	@($rows)
}

# One reflog line as something to show: a kind for its icon, and words.
function Get-ReflogEvent([string]$message) {
	switch -regex ($message) {
		'^commit \(merge\): (.*)' { return 'merge', $Matches[1] }
		'^commit(?: \([^)]*\))?: (.*)' { return 'commit', $Matches[1] }
		'^checkout: moving from \S+ to (.+)$' {
			$to = $Matches[1]
			if ($to -match '^(origin/)?main$' -or $to -match '^[0-9a-f]{7,40}$') { return 'refresh', 'Back on the latest main' }
			return 'switch', "Switched to $to"
		}
		'^merge (\S+): (.*)' { return 'merge', "Merged $($Matches[1])" }
		'^pull[^:]*: (.*)' { return 'pull', "Pulled ($($Matches[1]))" }
		'^reset: moving to (.+)$' { return 'reset', "Reset to $($Matches[1])" }
		default { return 'other', $message }
	}
}

function Get-LaneHistory($worktrees) {
	$open = @((Get-Lanes).open)
	foreach ($w in $worktrees | Sort-Object lane) {
		$dirty = @(Invoke-Git $w.path status --porcelain | Where-Object { $_ }).Count
		# Commits a detached lane holds that main doesn't have yet: the conductor checking a merge or a fix there
		# before it pushes (CONDUCTOR.md "Checking in a lane").
		$ahead = if ($w.branch) { 0 } else { [int]("$(Invoke-Git $w.path rev-list --count origin/main..HEAD)".Trim()) }
		$events = foreach ($line in @(Invoke-Git $w.path reflog -n 30 --date=iso-strict '--format=%h%x09%gd%x09%gs')) {
			$f = $line -split "`t", 3
			if ($f.Count -lt 3 -or -not $f[2]) { continue } # creating the checkout leaves an entry with no message
			$kind, $text = Get-ReflogEvent $f[2]
			[pscustomobject]@{ hash = $f[0]; at = $(if ($f[1] -match '\{(.+)\}') { $Matches[1] } else { $null }); kind = $kind; text = $text }
		}
		[pscustomobject]@{
			lane = $w.lane; branch = $w.branch; head = $w.head.Substring(0, [Math]::Min(7, $w.head.Length))
			dirty = $dirty; ahead = $ahead; open = $open -contains $w.lane; events = @($events)
		}
	}
}

$script:HistoryCache = @{}
function Get-History {
	$hit = $script:HistoryCache[$RepoDir]
	if (-not $hit -or ((Get-Date) - $hit.Read).TotalSeconds -gt 8) {
		$worktrees = @(Get-Worktrees)
		$hit = @{ Read = Get-Date; Value = [pscustomobject]@{
			repo = Get-RepoUrl
			main = Get-MainHistory
			branches = @(Get-Branches $worktrees)
			lanes = @(Get-LaneHistory $worktrees)
		} }
		$script:HistoryCache[$RepoDir] = $hit
	}
	$hit.Value
}
