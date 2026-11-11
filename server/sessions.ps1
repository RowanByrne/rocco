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

# What a session has used, read from the usage Claude Code records with each of the model's messages: tokens in and
# out, and tokens read from and written to the prompt cache. A message is written once per block of its content, with
# the same id and the same usage each time, so each id counts once. Claude Code's session format is its own and can
# change: when it does, a session simply shows no usage.
$UsagePattern = [regex]'"id":"(msg_\w+)","type":"message","role":"assistant".*?"usage":\{([^{}]*)'
$UsageModel = [regex]'"message":\{"model":"([^"]+)"'
function Add-SessionUsage($info, [string]$text) {
	foreach ($m in $UsagePattern.Matches($text)) {
		$id = $m.Groups[1].Value
		if ($info.seen.ContainsKey($id)) { continue }
		$info.seen[$id] = $true
		$u = $m.Groups[2].Value
		foreach ($pair in @(@('in', 'input_tokens'), @('out', 'output_tokens'), @('cacheRead', 'cache_read_input_tokens'), @('cacheWrite', 'cache_creation_input_tokens'))) {
			if ($u -match ('"' + $pair[1] + '":(\d+)')) { $info.usage[$pair[0]] = [long]$info.usage[$pair[0]] + [long]$Matches[1] }
		}
		$info.usage.messages = [int]$info.usage.messages + 1
	}
	$model = $UsageModel.Matches($text) | Select-Object -Last 1
	if ($model) { $info.usage.model = $model.Groups[1].Value }
}
function New-Usage { @{ in = [long]0; out = [long]0; cacheRead = [long]0; cacheWrite = [long]0; messages = 0; model = '' } }
function Copy-Usage($u) { [pscustomobject]@{ in = [long]$u.in; out = [long]$u.out; cacheRead = [long]$u.cacheRead; cacheWrite = [long]$u.cacheWrite; messages = [int]$u.messages; model = "$($u.model)" } }

# A session file's usage so far, by its path: the conductor's own session (conductor.ps1). $null if it can't be read.
function Get-SessionUsage([string]$path) {
	$file = Resolve-SessionPath $path
	if (-not $file) { return $null }
	try { Copy-Usage (Get-SessionInfo $file).usage } catch { $null }
}

# A session file a hook named, as a file: only one of Claude Code's own session files, under its config folder, is
# ever read. ~ stands for the user's folder.
function Resolve-SessionPath([string]$path) {
	if (-not $path) { return $null }
	if ($path.StartsWith('~')) { $path = Join-Path $env:USERPROFILE $path.Substring(1).TrimStart('/', '\') }
	try { $full = [IO.Path]::GetFullPath($path) } catch { return $null }
	$base = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
	$root = [IO.Path]::GetFullPath((Join-Path $base 'projects')).TrimEnd('\') + '\'
	if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or $full -notmatch '\.jsonl$' -or -not (Test-Path -LiteralPath $full -PathType Leaf)) { return $null }
	Get-Item -LiteralPath $full
}

# ---- Which worker is on which task, from the conductor's hooks (conductor.ps1) ----
# A worker's hooks reach Rocco with its agent id. When it runs a Rocco command on a task, that pairs its session with
# the task; when it ends, the hook names its session file. Both go in <Game>\rocco\conductor\workers.jsonl, so a
# card finds its sessions from what the agent's program reported, not only from how it lays out its files.
$WorkerCommand = [regex]'rocco(?:\.ps1)?\b[^|;&\r\n]*?\b(?:set|ask|log|result)\s+(T-\d{3,})\b'
$script:WorkerSeen = @{}
function Get-WorkersFile { Join-Path (Get-ThreadDir) 'workers.jsonl' }
function Add-WorkerEvent([string]$event, $in) {
	$agent = [string]$in.agent_id
	if ($agent -notmatch '^[\w-]{1,80}$') { return }
	if ($event -eq 'tool' -and [string]$in.tool_name -match '^(Bash|PowerShell)$') {
		$m = $WorkerCommand.Match([string]$in.tool_input.command)
		if (-not $m.Success) { return }
		$key = "$Root|$agent|$($m.Groups[1].Value)"
		if ($script:WorkerSeen[$key]) { return }
		$script:WorkerSeen[$key] = $true
		Add-Line (Get-WorkersFile) ([ordered]@{ at = (Now); agent = $agent; task = $m.Groups[1].Value; type = [string]$in.agent_type })
	}
	if ($event -eq 'worker-stop' -and $in.agent_transcript_path) {
		Add-Line (Get-WorkersFile) ([ordered]@{ at = (Now); agent = $agent; transcript = [string]$in.agent_transcript_path })
	}
}

# A file the agent may still be writing, from a byte offset: all of it, or $max bytes at most.
function Read-Shared([string]$path, [long]$from = 0, [long]$max = 0) {
	$fs = New-Object IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
	try {
		[void]$fs.Seek($from, [IO.SeekOrigin]::Begin)
		$size = [Math]::Max(0, $fs.Length - $from)
		if ($max -gt 0 -and $size -gt $max) { $size = $max }
		$bytes = New-Object byte[] $size
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
		$info = [pscustomobject]@{ length = [long]0; key = [IO.Path]::GetFileNameWithoutExtension($file.Name); path = $file.FullName; ids = @{}; started = ''; desc = ''; type = ''; usage = (New-Usage); seen = @{} }
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
	try { Add-SessionUsage $info $text } catch { }
	$info.length += $end
	$script:SessionIndex[$file.FullName] = $info
	$info
}

# A task's sessions, oldest first: only files written since the task was made are looked at. One is the task's when
# its file says so (Get-SessionInfo), or when its worker's hooks did (workers.jsonl).
function Find-TaskSessions($t) {
	$since = try { ([datetime]$t.created).ToUniversalTime().AddMinutes(-5) } catch { [datetime]::MinValue }
	$reported = @(Read-Lines (Get-WorkersFile))
	$agents = @($reported | Where-Object { $_.task -eq $t.id } | ForEach-Object { "$($_.agent)" } | Select-Object -Unique)
	$found = @{}
	foreach ($info in @(Get-SessionFiles | Where-Object { $_.LastWriteTimeUtc -ge $since } | ForEach-Object { Get-SessionInfo $_ })) {
		if ($info.ids.ContainsKey($t.id) -or ($agents -contains ($info.key -replace '^agent-', ''))) { $found[$info.path] = $info }
	}
	# A worker's session file as its last hook named it, wherever the agent's program keeps it.
	foreach ($agent in $agents) {
		$named = $reported | Where-Object { "$($_.agent)" -eq $agent -and $_.transcript } | Select-Object -Last 1
		$file = if ($named) { Resolve-SessionPath ([string]$named.transcript) } else { $null }
		if ($file -and -not $found.ContainsKey($file.FullName)) { $found[$file.FullName] = Get-SessionInfo $file }
	}
	@($found.Values | Sort-Object started)
}

function Get-TaskSessions($t) {
	@(Find-TaskSessions $t | ForEach-Object { [pscustomobject]@{ key = $_.key; desc = $_.desc; type = $_.type; started = $_.started; size = $_.length; usage = (Copy-Usage $_.usage); tasks = @($_.ids.Keys).Count } })
}

# ---- Usage: what each task took, from its sessions and its time at work ----

# Every task that has a session or time at work on record, with what it used. A session that worked on several tasks
# is shared between them evenly, so the rows add up to what was really used. Cached for a moment: it reads every
# session file (only what was added since the last look).
$script:UsageCache = @{}
function Get-ProjectUsage {
	$hit = $script:UsageCache[$Root]
	if ($hit -and ((Get-Date) - $hit.Read).TotalSeconds -lt 30) { return $hit.Value }
	$reported = @(Read-Lines (Get-WorkersFile))
	$byAgent = @{}
	foreach ($r in $reported | Where-Object { $_.task }) { if (-not $byAgent["$($r.agent)"]) { $byAgent["$($r.agent)"] = @{} }; $byAgent["$($r.agent)"]["$($r.task)"] = $true }
	$perTask = @{}
	$sessions = 0
	foreach ($info in @(Get-SessionFiles | ForEach-Object { try { Get-SessionInfo $_ } catch { } })) {
		$ids = @{}
		foreach ($k in $info.ids.Keys) { $ids[$k] = $true }
		$more = $byAgent[($info.key -replace '^agent-', '')]
		if ($more) { foreach ($k in $more.Keys) { $ids[$k] = $true } }
		if (-not $ids.Count -or -not $info.usage.messages) { continue }
		$sessions++
		foreach ($id in $ids.Keys) {
			if (-not $perTask[$id]) { $perTask[$id] = @{ in = 0.0; out = 0.0; cacheRead = 0.0; cacheWrite = 0.0; sessions = 0; models = @{} } }
			$row = $perTask[$id]
			foreach ($k in 'in', 'out', 'cacheRead', 'cacheWrite') { $row[$k] += [double]$info.usage[$k] / $ids.Count }
			$row.sessions++
			if ($info.usage.model) { $row.models[$info.usage.model] = $true }
		}
	}
	$all = @(@(Get-Tasks) + @(if (Test-Path -LiteralPath $ArchiveDir) { Read-TaskFolder $ArchiveDir }))
	$rows = @($all | Where-Object { $perTask[$_.id] -or [int]$_.worked -or $_.workSince } | ForEach-Object {
		$u = $perTask[$_.id]
		$worked = [int]$_.worked + $(if ($_.status -eq 'working' -and $_.workSince) { [int][Math]::Max(0, ((Get-Date) - [datetime]$_.workSince).TotalSeconds) } else { 0 })
		[pscustomobject]@{
			id = $_.id; title = $_.title; status = $_.status; plan = "$($_.plan)"; lane = $_.lane; attempt = [int]$_.attempt; doneAt = $_.doneAt; worked = $worked
			in = $(if ($u) { [long]$u.in } else { 0 }); out = $(if ($u) { [long]$u.out } else { 0 })
			cacheRead = $(if ($u) { [long]$u.cacheRead } else { 0 }); cacheWrite = $(if ($u) { [long]$u.cacheWrite } else { 0 })
			sessions = $(if ($u) { [int]$u.sessions } else { 0 }); models = @(if ($u) { $u.models.Keys })
		}
	} | Sort-Object { $_.in + $_.out + $_.cacheRead + $_.cacheWrite } -Descending)
	$c = Read-Conductor
	$value = [pscustomobject]@{
		tasks = $rows; sessions = $sessions
		plans = @($all | Where-Object { $_.kind -eq 'plan' } | ForEach-Object { [pscustomobject]@{ id = $_.id; title = $_.title } })
		conductor = $(if ($c -and $c.PSObject.Properties['transcript'] -and $c.transcript) { Get-SessionUsage ([string]$c.transcript) } else { $null })
	}
	$script:UsageCache[$Root] = @{ Read = Get-Date; Value = $value }
	$value
}

# A session's whole lines from a byte offset, a megabyte or so at a time (a long session is megabytes, and the app asks
# again from X-Next until it has caught up); X-Next is the offset to ask from next time.
$SessionChunk = 1MB
function Send-SessionText($ctx, $t, [string]$key, [long]$from) {
	$s = Find-TaskSessions $t | Where-Object { $_.key -eq $key } | Select-Object -First 1
	if (-not $s) { Send-Text $ctx 404 'No such session for this task'; return }
	$from = [Math]::Max(0, $from)
	$bytes = if ($from -lt $s.length) { Read-Shared $s.path $from $SessionChunk } else { , (New-Object byte[] 0) }
	# Only whole lines, and none past what's been indexed. A single line longer than a chunk is sent whole.
	$end = [Math]::Min([long]$bytes.Length, $s.length - $from)
	if ($end -ge $SessionChunk) {
		$cut = [Array]::LastIndexOf($bytes, [byte]10, [int]$end - 1) + 1
		if ($cut -gt 0) { $end = $cut } else { $bytes = Read-Shared $s.path $from; $end = [Math]::Min([long]$bytes.Length, $s.length - $from) }
	}
	if ($end -lt $bytes.Length) { [Array]::Resize([ref]$bytes, [int]$end) }
	$ctx.Response.Headers['X-Next'] = [string]($from + $bytes.Length)
	$ctx.Response.Headers['X-Size'] = [string]$s.length
	Send $ctx 200 'application/x-ndjson; charset=utf-8' ([byte[]]$bytes)
}
