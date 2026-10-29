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

function Get-MainHistory {
	$hasRemote = [bool](Invoke-Git $RepoDir rev-parse --verify --quiet origin/main)
	$unpushed = @{}
	if ($hasRemote) { foreach ($hash in @(Invoke-Git $RepoDir rev-list origin/main..main)) { $unpushed[$hash] = $true } }
	$commits = foreach ($line in @(Invoke-Git $RepoDir log main -40 '--format=%H%x09%h%x09%P%x09%an%x09%cI%x09%s%x09%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)')) {
		$f = $line -split "`t"
		if ($f.Count -lt 6) { continue }
		$branch = if ($f[5] -match "^Merge (?:remote-tracking )?branch '([^']+)'") { $Matches[1] -replace '^origin/', '' } else { '' }
		[pscustomobject]@{
			full = $f[0]; hash = $f[1]; author = $f[3]; at = $f[4]; subject = $f[5]
			merge = @($f[2] -split ' ' | Where-Object { $_ }).Count -gt 1
			branch = $branch
			claude = ($f.Count -gt 6 -and $f[6] -match 'Claude')
			pushed = -not $unpushed[$f[0]]
		}
	}
	[pscustomobject]@{ remote = $hasRemote; unpushed = $unpushed.Count; total = [int](Invoke-Git $RepoDir rev-list --count main); commits = @($commits) }
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
		$events = foreach ($line in @(Invoke-Git $w.path reflog -n 30 --date=iso-strict '--format=%h%x09%gd%x09%gs')) {
			$f = $line -split "`t", 3
			if ($f.Count -lt 3 -or -not $f[2]) { continue } # creating the checkout leaves an entry with no message
			$kind, $text = Get-ReflogEvent $f[2]
			[pscustomobject]@{ hash = $f[0]; at = $(if ($f[1] -match '\{(.+)\}') { $Matches[1] } else { $null }); kind = $kind; text = $text }
		}
		[pscustomobject]@{
			lane = $w.lane; branch = $w.branch; head = $w.head.Substring(0, [Math]::Min(7, $w.head.Length))
			dirty = $dirty; open = $open -contains $w.lane; events = @($events)
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
