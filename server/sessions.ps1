# A card's session: what the agent that worked on a task did and said, word for word (README "A card's session").
# Claude Code keeps each worker's session as a file of JSON lines: <config>\projects\<folder, other characters as ->\
# <conductor's session>\subagents\agent-<id>.jsonl, with agent-<id>.meta.json naming it, and a session started in a
# lane as <lane's folder>\<session>.jsonl. A session is the task's when it was made for it (the conductor names the
# task in it) or when the agent ran a Rocco command on it. Other agents keep theirs elsewhere: their cards show History.

$script:SessionIndex = @{}  # path -> what a session file says about itself, read on as the file grows

# A JSON string's characters, escapes included, so a quoted path inside a command doesn't end it.
$JsonChars = '(?:[^"\\]|\\.)'
$SessionNamed = [regex]('"content":"' + $JsonChars + '{0,400}?\b(T-\d{3,})\b')
$SessionCommand = [regex]('"command":"' + $JsonChars + '*?rocco' + $JsonChars + '*?\b(?:set|ask|log)\s+(T-\d{3,})\b')

function Get-AgentProjectDir([string]$dir) {
	$base = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
	Join-Path $base ('projects\' + ($dir -replace '[^A-Za-z0-9]', '-'))
}

# A file the agent may still be writing, from a byte offset.
function Read-Shared([string]$path, [long]$from = 0) {
	$fs = New-Object IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
	try {
		[void]$fs.Seek($from, [IO.SeekOrigin]::Begin)
		$bytes = New-Object byte[] ([Math]::Max(0, $fs.Length - $from))
		$read = 0
		while ($read -lt $bytes.Length) { $n = $fs.Read($bytes, $read, $bytes.Length - $read); if ($n -le 0) { break }; $read += $n }
		if ($read -lt $bytes.Length) { [Array]::Resize([ref]$bytes, $read) }
		, $bytes
	} finally { $fs.Close() }
}

# Every session file that could be a task's: the conductor's workers, and sessions started in a lane.
function Get-SessionFiles {
	$files = @()
	$repo = Get-AgentProjectDir $RepoDir
	if (Test-Path -LiteralPath $repo) { $files += @(Get-ChildItem -LiteralPath $repo -Directory | ForEach-Object { Get-ChildItem -LiteralPath (Join-Path $_.FullName 'subagents') -Filter 'agent-*.jsonl' -File -ErrorAction SilentlyContinue }) }
	foreach ($lane in @(Get-ChildItem (Join-Path $Root 'lanes') -Directory -Filter 'lane*' -ErrorAction SilentlyContinue)) {
		$dir = Get-AgentProjectDir $lane.FullName
		if (Test-Path -LiteralPath $dir) { $files += @(Get-ChildItem -LiteralPath $dir -Filter '*.jsonl' -File) }
	}
	$files
}

# What a session file says about itself: the tasks it's for, when it started, and the conductor's name for it. Only
# what was added since the last look is read, since the files only grow.
function Get-SessionInfo($file) {
	$info = $script:SessionIndex[$file.FullName]
	if ($info -and $info.length -eq $file.Length) { return $info }
	if (-not $info -or $file.Length -lt $info.length) {
		$info = [pscustomobject]@{ length = [long]0; key = [IO.Path]::GetFileNameWithoutExtension($file.Name); path = $file.FullName; ids = @{}; started = ''; desc = ''; type = '' }
		$meta = [IO.Path]::ChangeExtension($file.FullName, '.meta.json')
		if (Test-Path -LiteralPath $meta) {
			try { $m = [IO.File]::ReadAllText($meta, $Utf8) | ConvertFrom-Json; $info.desc = [string]$m.description; $info.type = [string]$m.agentType } catch { }
			foreach ($x in [regex]::Matches($info.desc, 'T-\d{3,}')) { $info.ids[$x.Value] = $true }
		}
	}
	$bytes = Read-Shared $file.FullName $info.length
	$end = [Array]::LastIndexOf($bytes, [byte]10) + 1
	$text = $Utf8.GetString($bytes, 0, $end)
	if ($info.length -eq 0) {
		# The task its first prompt is for ("You are the worker for T-052"), and when it started.
		$named = $SessionNamed.Match(($text -split "`n", 2)[0])
		if ($named.Success) { $info.ids[$named.Groups[1].Value] = $true }
		$at = [regex]::Match($text, '"timestamp":"([^"]+)"')
		$info.started = if ($at.Success) { $at.Groups[1].Value } else { $file.CreationTimeUtc.ToString('o') }
	}
	foreach ($x in $SessionCommand.Matches($text)) { $info.ids[$x.Groups[1].Value] = $true }
	$info.length += $end
	$script:SessionIndex[$file.FullName] = $info
	$info
}

# A task's sessions, oldest first: only files written since the task was made are looked at.
function Find-TaskSessions($t) {
	$since = try { ([datetime]$t.created).ToUniversalTime().AddMinutes(-5) } catch { [datetime]::MinValue }
	@(Get-SessionFiles | Where-Object { $_.LastWriteTimeUtc -ge $since } | ForEach-Object { Get-SessionInfo $_ } |
		Where-Object { $_.ids.ContainsKey($t.id) } | Sort-Object started)
}

function Get-TaskSessions($t) {
	@(Find-TaskSessions $t | ForEach-Object { [pscustomobject]@{ key = $_.key; desc = $_.desc; type = $_.type; started = $_.started; size = $_.length } })
}

# A session's whole lines from a byte offset; X-Next is the offset to ask from next time.
function Send-SessionText($ctx, $t, [string]$key, [long]$from) {
	$s = Find-TaskSessions $t | Where-Object { $_.key -eq $key } | Select-Object -First 1
	if (-not $s) { Send-Text $ctx 404 'No such session for this task'; return }
	$bytes = if ($from -ge 0 -and $from -lt $s.length) { Read-Shared $s.path $from } else { , (New-Object byte[] 0) }
	$end = [Math]::Min([long]$bytes.Length, $s.length - [Math]::Max(0, $from))
	if ($end -lt $bytes.Length) { [Array]::Resize([ref]$bytes, [int]$end) }
	$ctx.Response.Headers['X-Next'] = [string]([Math]::Max(0, $from) + $bytes.Length)
	Send $ctx 200 'application/x-ndjson; charset=utf-8' ([byte[]]$bytes)
}
