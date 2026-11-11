# Docs: every Markdown file in the repo by folder, each with a preview for the hover; one doc in full; and the
# user's own edit to a doc, committed on main as the user and pushed to GitHub.

# Files the template owns (AGENTS.md "Template-owned files"). In a game they change only through the template.
$TemplateOwned = '^(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.claude/|docs/workflow/|tools/)'
function Test-TemplateOwned([string]$path, [bool]$template) { (-not $template) -and $path -match $TemplateOwned }

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
	# Its path as the file system has it, not as it was typed: docs//workflow/X.md and docs/workflow/X.md are one
	# file, and what's checked against the template's own files (Test-TemplateOwned) has to be that one name.
	[pscustomobject]@{ path = $file.Substring($root.Length).Replace('\', '/'); file = $file }
}

# A doc's text and how it's stored, so a save writes it back the same way. Rocco edits UTF-8 (with or without its
# mark) and UTF-16 with its mark. Anything else (an old ANSI file) is shown as best it can be but not edited: saving
# it as UTF-8 would change every accented letter in it.
function Read-DocText([string]$file) {
	$bytes = [IO.File]::ReadAllBytes($file)
	$has = { param([byte[]]$mark) $bytes.Length -ge $mark.Length -and -not @(0..($mark.Length - 1) | Where-Object { $bytes[$_] -ne $mark[$_] }).Count }
	if (& $has ([byte[]](0xEF, 0xBB, 0xBF))) { return [pscustomobject]@{ text = $Utf8.GetString($bytes, 3, $bytes.Length - 3); encoding = (New-Object Text.UTF8Encoding $true); editable = $true } }
	if (& $has ([byte[]](0xFF, 0xFE))) { return [pscustomobject]@{ text = [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2); encoding = [Text.Encoding]::Unicode; editable = $true } }
	if (& $has ([byte[]](0xFE, 0xFF))) { return [pscustomobject]@{ text = [Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2); encoding = [Text.Encoding]::BigEndianUnicode; editable = $true } }
	try { return [pscustomobject]@{ text = (New-Object Text.UTF8Encoding $false, $true).GetString($bytes); encoding = $Utf8; editable = $true } } catch { }
	[pscustomobject]@{ text = [Text.Encoding]::GetEncoding(1252).GetString($bytes); encoding = $null; editable = $false }
}
$NotUtf8 = 'This doc isn''t saved as UTF-8, so Rocco shows it but won''t edit it: saving would change its accented letters. Ask your agent to convert it to UTF-8.'

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
	foreach ($line in @(Invoke-Git $RepoDir -c core.quotepath=false status --porcelain --untracked-files=all '--' '*.md')) {
		if ("$line".Length -gt 3) { $dirty[("$line".Substring(3) -replace '^.* -> ', '').Trim('"')] = $true }
	}
	# The last commit to each doc, from one walk of the history.
	$last = @{}; $at = ''; $by = ''
	foreach ($line in @(Invoke-Git $RepoDir -c core.quotepath=false log -n 400 '--format=@@%cI%x09%an' --name-only '--' '*.md')) {
		if ("$line".StartsWith('@@')) { $at, $by = "$line".Substring(2) -split "`t", 2 }
		elseif ($line -and -not $last.ContainsKey("$line")) { $last["$line"] = @($at, $by) }
	}

	$docs = foreach ($path in @(Invoke-Git $RepoDir -c core.quotepath=false ls-files --cached --others --exclude-standard '--' '*.md') | Sort-Object -Unique) {
		$file = Join-Path $RepoDir $path
		if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue } # deleted, not committed yet
		$info = Get-Item -LiteralPath $file
		$cached = $script:SummaryCache[$info.FullName]
		if (-not $cached -or $cached.Stamp -ne $info.LastWriteTimeUtc.Ticks) {
			$text = (Read-DocText $info.FullName).text
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
	$read = Read-DocText $doc.file
	$text = $read.text
	# '--' is quoted throughout: a bare one ends a PowerShell function's arguments instead of reaching git.
	$line = "$(Invoke-Git $RepoDir log -1 '--format=%cI%x09%an%x09%s' '--' $doc.path)"
	$at, $by, $subject = if ($line) { $line -split "`t", 3 } else { '', '', '' }
	[pscustomobject]@{
		path = $doc.path; text = $text; hash = (Get-TextHash $text); locked = ((Test-TemplateOwned $doc.path $template) -or -not $read.editable)
		lockedWhy = $(if (-not $read.editable) { $NotUtf8 } else { '' })
		dirty = [bool](Invoke-Git $RepoDir status --porcelain '--' $doc.path)
		last = [pscustomobject]@{ at = $at; by = $by; subject = $subject }
	}
}

# The user's own edit: written, committed on main as the user (only this file), then pushed. Main on GitHub is
# merged in first, never rebased (CLAUDE.md "Git"). A doc that changed since it was opened isn't overwritten:
# the app gets { conflict } and the current hash, and the user decides.
function Save-Doc([string]$path, [string]$text, [string]$base, [string]$message, [bool]$template) {
	$doc = Resolve-Doc $path
	if (Test-TemplateOwned $doc.path $template) { throw "$($doc.path) belongs to the template, so it changes there, not in a game (AGENTS.md `"Template-owned files`"). Ask your agent to change it." }
	$branch = "$(Invoke-Git $RepoDir rev-parse --abbrev-ref HEAD)"
	if ($branch -ne 'main') { throw "repo\ is on '$branch', not main. Ask your agent to put it back on main first." }
	if (Test-Path "$(Invoke-Git $RepoDir rev-parse --path-format=absolute --git-path MERGE_HEAD)") { throw 'repo\ is in the middle of a merge. Ask your agent to finish it first.' }

	$before = [IO.File]::ReadAllBytes($doc.file)
	$read = Read-DocText $doc.file
	if (-not $read.editable) { throw $NotUtf8 }
	$old = $read.text
	if ((Get-TextHash $old) -ne $base) { return [pscustomobject]@{ conflict = $true; hash = (Get-TextHash $old) } }
	$new = $text -replace "`r`n", "`n"
	if ($old.Contains("`r`n")) { $new = $new -replace "`n", "`r`n" }
	if ($new -eq $old) { return [pscustomobject]@{ nothing = $true } }
	[IO.File]::WriteAllText($doc.file, $new, $read.encoding)
	$script:DocsCache = @{}

	# The message goes through a file: Windows PowerShell mangles quotes in native arguments. A commit git refuses
	# puts the doc back as it was (actions.ps1): the user's words are still in the app's editor, to save again.
	if (-not $message.Trim()) { $message = "$(Split-Path $doc.path -Leaf): edited in Rocco" }
	Invoke-FileCommit $doc.path $message { [IO.File]::WriteAllBytes($doc.file, $before) }
	$script:HistoryCache = @{}; $script:MainCache = @{}; $script:ProjectCache = $null

	$result = [pscustomobject]@{ saved = $true; commit = "$(Invoke-Git $RepoDir rev-parse --short HEAD)"; pushed = $false; note = '' }
	if (-not (Invoke-Git $RepoDir remote get-url origin)) { $result.note = 'Committed on main. This project has no GitHub repo yet, so nothing was pushed.'; return $result }
	$problem = Push-Main
	if ($problem) { $result.note = "Committed on main, but $problem" } else { $result.pushed = $true }
	$result
}
