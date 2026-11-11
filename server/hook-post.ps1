# Claude Code's background hooks for a conductor Rocco opened (conductor.ps1, Write-ConductorHooks), for a Claude Code
# too old to post a hook itself: passes what the hook was given to Rocco, which shows it: a step, the conductor's
# message at the end of a turn, or what the user typed in its window. A current Claude Code posts these straight to
# Rocco and never runs this. Kept apart from rocco.ps1 so it starts quickly, and quiet: Rocco not running is fine.
param([string]$Event, [string]$Project, [int]$Port = 34860)
try {
	# The hook's JSON as it came (UTF-8), passed on untouched: decoding it here could garble it.
	$in = New-Object IO.MemoryStream
	[Console]::OpenStandardInput().CopyTo($in)
	$bytes = $in.ToArray()
	$request = [Net.HttpWebRequest]::Create("http://localhost:$Port/api/conductor/hook?p=$([uri]::EscapeDataString($Project))&e=$Event")
	$request.Method = 'POST'
	$request.Timeout = 4000
	$request.ContentType = 'application/json; charset=utf-8'
	$request.Headers.Add('X-Rocco', '1')
	$stream = $request.GetRequestStream()
	try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Close() }
	$request.GetResponse().Close()
} catch { }
