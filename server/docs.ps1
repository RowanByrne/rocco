# Docs: every Markdown file in the repo by folder, each with a preview for the hover; one doc in full; and the
# user's own edit to a doc, committed on main as the user and pushed to GitHub.

# Files the template owns (CLAUDE.md "Template-owned files"). In a game they change only through the template.
$TemplateOwned = '^(CLAUDE\.md|AGENTS\.md|\.claude/|docs/workflow/|tools/|rocco/)'
function Test-TemplateOwned([string]$path, [bool]$template) { (-not $template) -and $path -match $TemplateOwned }

# Git, keeping what it says, to show the user when something fails.
function Invoke-GitText([string]$dir) {
	$ErrorActionPreference = 'Continue'
	$text = @(git -C $dir @args 2>&1 | ForEach-Object { "$_" }) -join "`n"
	[pscustomobject]@{ ok = ($LASTEXITCODE -eq 0); text = $text.Trim() }
}

# Line endings don't count: the app edits with LF, and a doc may be stored with CRLF.
function Get-TextHash([string]$text) {
	$sha = [Security.Cryptography.SHA1]::Create()
	try { -join ($sha.ComputeHash($Utf8.GetBytes(($text -replace "`r`n", "`n"))) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
}

# A doc's path as the app names it (relative to repo\, with /) to its file. Only .md files inside the repo.
function Resolve-Doc([string]$path) {
	$path = $path.Replace('\', '/').TrimStart('/')
	if ($path -notmatch '^[\w .()/-]+\.md$' -or $path -match '(^|/)\.\.?(/|$)' -or $path -match '^\.git/') { throw "Not a doc: '$path'." }
	$root = [IO.Path]::GetFullPath($RepoDir).TrimEnd('\') + '\'
	$file = [IO.Path]::GetFullPath((Join-Path $RepoDir $path))
	if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "There's no doc $path." }
	[pscustomobject]@{ path = $path; file = $file }
}

# What the hover shows: the title, the first paragraph without its Markdown, and the section headings.
function Get-DocSummary([string]$text) {
	$title = ''; $sections = @(); $para = @(); $inCode = $false; $inFront = $false; $done = $false; $n = 0
	foreach ($line in $text -split "`r?`n") {
		$n++
		if ($n -eq 1 -and $line -eq '---') { $inFront = $true; continue }
		# Front matter (agent files): its name stands in for a title.
		if ($inFront) { if ($line -eq '---') { $inFront = $false } elseif (-not $title -and $line -match '^name:\s*(.+)$') { $title = $Matches[1].Trim() }; continue }
		if ($line -match '^\s*(```|~~~)') { $inCode = -not $inCode; if ($para) { $done = $true }; continue }
		if ($inCode) { continue }
		if (-not $title -and $line -match '^#\s+(.+)$') { $title = $Matches[1].Trim(); continue }
		if ($line -match '^#{2,3}\s+(.+)$') {
			if ($sections.Count -lt 8) { $sections += ($Matches[1].Trim() -replace '`', '') }
			if ($para) { $done = $true }
			continue
		}
		if ($done) { continue }
		if (-not $line.Trim()) { if ($para) { $done = $true }; continue }
		# Tables, quotes, rules, comments and imports aren't prose.
		if ($line -match '^\s*(\||>|---|<!--|@)') { if ($para) { $done = $true }; continue }
		$para += ($line.Trim() -replace '^([-*+]|\d+\.)\s+', '')
	}
	$preview = ($para -join ' ') -replace '!?\[([^\]]*)\]\([^)]*\)', '$1' -replace '\*\*|__|`', '' -replace '(?<![\w*])\*([^*]+)\*', '$1'
	$preview = ($preview -replace '\s+', ' ').Trim()
	if ($preview.Length -gt 240) {
		$cut = $preview.LastIndexOf(' ', 236)
		$preview = $preview.Substring(0, $(if ($cut -gt 120) { $cut } else { 236 })).TrimEnd(',', ';', ':', ' ') + [char]0x2026
	}
	[pscustomobject]@{ title = $title; preview = $preview; sections = @($sections) }
}

# Every doc: tracked, or new and not ignored. Summaries are re-read only for files that changed.
$script:DocsCache = @{}
$script:SummaryCache = @{}
function Get-Docs([bool]$template) {
	$hit = $script:DocsCache[$RepoDir]
	if ($hit -and $hit.Template -eq $template -and ((Get-Date) - $hit.Read).TotalSeconds -lt 5) { return $hit.Value }

	$dirty = @{}
	foreach ($line in @(Invoke-Git $RepoDir -c core.quotepath=false status --porcelain --untracked-files=all -- '*.md')) {
		if ("$line".Length -gt 3) { $dirty[("$line".Substring(3) -replace '^.* -> ', '').Trim('"')] = $true }
	}
	# The last commit to each doc, from one walk of the history.
	$last = @{}; $at = ''; $by = ''
	foreach ($line in @(Invoke-Git $RepoDir -c core.quotepath=false log -n 400 '--format=@@%cI%x09%an' --name-only -- '*.md')) {
		if ("$line".StartsWith('@@')) { $at, $by = "$line".Substring(2) -split "`t", 2 }
		elseif ($line -and -not $last.ContainsKey("$line")) { $last["$line"] = @($at, $by) }
	}

	$docs = foreach ($path in @(Invoke-Git $RepoDir -c core.quotepath=false ls-files --cached --others --exclude-standard -- '*.md') | Sort-Object -Unique) {
		$file = Join-Path $RepoDir $path
		if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue } # deleted, not committed yet
		$info = Get-Item -LiteralPath $file
		$cached = $script:SummaryCache[$info.FullName]
		if (-not $cached -or $cached.Stamp -ne $info.LastWriteTimeUtc.Ticks) {
			$text = [IO.File]::ReadAllText($info.FullName, $Utf8)
			$cached = @{ Stamp = $info.LastWriteTimeUtc.Ticks; Summary = (Get-DocSummary $text); Hash = (Get-TextHash $text) }
			$script:SummaryCache[$info.FullName] = $cached
		}
		$changed = [bool]$dirty[$path]
		$commit = $last[$path]
		[pscustomobject]@{
			path = $path; title = $cached.Summary.title; preview = $cached.Summary.preview; sections = $cached.Summary.sections
			hash = $cached.Hash; size = $info.Length; dirty = $changed; locked = (Test-TemplateOwned $path $template)
			# An uncommitted change is newer than any commit.
			at = $(if ($commit -and -not $changed) { $commit[0] } else { $info.LastWriteTime.ToString('o') })
			by = $(if ($commit -and -not $changed) { $commit[1] } else { '' })
		}
	}
	$value = [pscustomobject]@{ repo = Get-RepoUrl; template = $template; docs = @($docs) }
	$script:DocsCache[$RepoDir] = @{ Read = Get-Date; Template = $template; Value = $value }
	$value
}

function Read-Doc([string]$path, [bool]$template) {
	$doc = Resolve-Doc $path
	$text = [IO.File]::ReadAllText($doc.file, $Utf8)
	$line = "$(Invoke-Git $RepoDir log -1 '--format=%cI%x09%an%x09%s' -- $doc.path)"
	$at, $by, $subject = if ($line) { $line -split "`t", 3 } else { '', '', '' }
	[pscustomobject]@{
		path = $doc.path; text = $text; hash = (Get-TextHash $text); locked = (Test-TemplateOwned $doc.path $template)
		dirty = [bool](Invoke-Git $RepoDir status --porcelain -- $doc.path)
		last = [pscustomobject]@{ at = $at; by = $by; subject = $subject }
	}
}

# The user's own edit: written, committed on main as the user (only this file), then pushed. Main on GitHub is
# merged in first, never rebased (CLAUDE.md "Git"). A doc that changed since it was opened isn't overwritten:
# the app gets { conflict } and the current hash, and the user decides.
function Save-Doc([string]$path, [string]$text, [string]$base, [string]$message, [bool]$template) {
	$doc = Resolve-Doc $path
	if (Test-TemplateOwned $doc.path $template) { throw "$($doc.path) belongs to the template, so it changes there, not in a game (CLAUDE.md `"Template-owned files`"). Ask Claude to change it." }
	$branch = "$(Invoke-Git $RepoDir rev-parse --abbrev-ref HEAD)"
	if ($branch -ne 'main') { throw "repo\ is on '$branch', not main. Ask Claude to put it back on main first." }
	if (Test-Path "$(Invoke-Git $RepoDir rev-parse --path-format=absolute --git-path MERGE_HEAD)") { throw 'repo\ is in the middle of a merge. Ask Claude to finish it first.' }

	$bytes = [IO.File]::ReadAllBytes($doc.file)
	$bom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
	$old = [IO.File]::ReadAllText($doc.file, $Utf8)
	if ((Get-TextHash $old) -ne $base) { return [pscustomobject]@{ conflict = $true; hash = (Get-TextHash $old) } }
	$new = $text -replace "`r`n", "`n"
	if ($old.Contains("`r`n")) { $new = $new -replace "`n", "`r`n" }
	if ($new -eq $old) { return [pscustomobject]@{ nothing = $true } }
	[IO.File]::WriteAllText($doc.file, $new, (New-Object Text.UTF8Encoding $bom))
	$script:DocsCache = @{}

	# The message goes through a file: Windows PowerShell mangles quotes in native arguments.
	if (-not $message.Trim()) { $message = "$(Split-Path $doc.path -Leaf): edited in Rocco" }
	$messageFile = [IO.Path]::GetTempFileName()
	try {
		[IO.File]::WriteAllText($messageFile, $message.Trim(), $Utf8)
		$add = Invoke-GitText $RepoDir add -- $doc.path
		$commit = if ($add.ok) { Invoke-GitText $RepoDir commit -F $messageFile --only -- $doc.path } else { $add }
	} finally { Remove-Item -LiteralPath $messageFile -ErrorAction SilentlyContinue }
	if (-not $commit.ok) { throw "Saved the file, but git couldn't commit it: $($commit.text)" }
	$script:HistoryCache = @{}; $script:MainCache = @{}; $script:ProjectCache = $null

	$result = [pscustomobject]@{ saved = $true; commit = "$(Invoke-Git $RepoDir rev-parse --short HEAD)"; pushed = $false; note = '' }
	if (-not (Invoke-Git $RepoDir remote get-url origin)) { $result.note = 'Committed on main. This project has no GitHub repo yet, so nothing was pushed.'; return $result }
	$fetch = Invoke-GitText $RepoDir fetch origin main
	if (-not $fetch.ok) { $result.note = "Committed on main, but GitHub couldn't be reached, so it isn't pushed: $($fetch.text)"; return $result }
	if (-not (Invoke-GitText $RepoDir merge-base --is-ancestor origin/main HEAD).ok) {
		$merge = Invoke-GitText $RepoDir merge --no-edit origin/main
		if (-not $merge.ok) {
			Invoke-GitText $RepoDir merge --abort | Out-Null
			$result.note = 'Committed on main, but not pushed: main on GitHub has changes that clash with it. Say "refresh" to Claude to merge them.'
			return $result
		}
	}
	$push = Invoke-GitText $RepoDir push origin main
	if ($push.ok) { $result.pushed = $true } else { $result.note = "Committed on main, but the push failed: $($push.text)" }
	$script:HistoryCache = @{}; $script:MainCache = @{}
	$result
}
