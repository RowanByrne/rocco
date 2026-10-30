# The HTTP side: the app's files from web\, the JSON API (rocco\README.md "API"), and the server loop.

function Send($ctx, [int]$code, [string]$type, [byte[]]$bytes) {
	$res = $ctx.Response
	$res.StatusCode = $code
	$res.ContentType = $type
	$res.Headers['Cache-Control'] = 'no-store'
	$res.ContentLength64 = $bytes.Length
	$res.OutputStream.Write($bytes, 0, $bytes.Length)
	$res.OutputStream.Close()
}
function Send-Json($ctx, $value, [int]$code = 200) { Send $ctx $code 'application/json; charset=utf-8' $Utf8.GetBytes((ConvertTo-Json -InputObject $value -Depth 8 -Compress)) }
function Send-Text($ctx, [int]$code, [string]$text) { Send $ctx $code 'text/plain; charset=utf-8' $Utf8.GetBytes($text) }

$Mime = @{
	'.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
	'.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'
	'.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'
	'.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.m4a' = 'audio/mp4'
}
$ImageExt = @{ 'image/png' = '.png'; 'image/jpeg' = '.jpg'; 'image/gif' = '.gif'; 'image/webp' = '.webp' }

function Read-Json($req) {
	$body = (New-Object IO.StreamReader($req.InputStream, $Utf8)).ReadToEnd()
	if ($body) { $body | ConvertFrom-Json } else { [pscustomobject]@{} }
}

# A file from web\, never from outside it.
function Send-Static($ctx, [string]$path) {
	$relative = if ($path -eq '/') { 'index.html' } else { $path.TrimStart('/') }
	if ($relative -match '^[\w./-]+$' -and $relative -notmatch '\.\.') {
		$file = [IO.Path]::GetFullPath((Join-Path $WebRoot $relative))
		$type = $Mime[[IO.Path]::GetExtension($file).ToLower()]
		if ($type -and $file.StartsWith($WebRoot + '\') -and (Test-Path -LiteralPath $file -PathType Leaf)) { Send $ctx 200 $type ([IO.File]::ReadAllBytes($file)); return }
	}
	Send-Text $ctx 404 'Not found'
}

function Invoke-Request($ctx) {
	$req = $ctx.Request
	$path = $req.Url.AbsolutePath
	$get = $req.HttpMethod -eq 'GET'

	# Not about one project.
	if ($get -and $path -eq '/api/projects') {
		Send-Json $ctx ([pscustomobject]@{ home = (Split-Path $HomeProject -Leaf); projects = @(Get-Projects | Select-Object id, name, phase, template) }); return
	}
	if ($get -and $path -eq '/api/me') { Send-Json $ctx (Get-Me); return }
	if ($get -and $path -match '^/api/jobs/(\w+)$') { Send-Json $ctx (Get-JobStatus $Matches[1]); return }
	if ($get -and $path -notmatch '^/(api|files)/') { Send-Static $ctx $path; return }

	# Everything else is about one project, named by ?p=.
	Use-Project (Find-Project $req.QueryString['p']).path
	if ($get) {
		if ($path -eq '/api/state') { Send-Json $ctx (Get-State $req.QueryString['p']); return }
		if ($path -eq '/api/connections') { Send-Json $ctx (Get-Connections ($req.QueryString['refresh'] -eq '1')); return }
		if ($path -eq '/api/history') { Send-Json $ctx (Get-History); return }
		if ($path -match '^/api/tasks/(T-\d+)/changes$') { Send-Json $ctx (Get-TaskChanges (Read-Task $Matches[1])); return }
		# A task's screenshot or audio option.
		if ($path -match '^/files/(T-\d+)/([\w.-]+\.(png|jpe?g|gif|webp|mp3|ogg|wav|m4a))$' -and $Matches[2] -notmatch '\.\.') {
			$file = Join-Path (Join-Path $TasksDir $Matches[1]) $Matches[2]
			if (Test-Path -LiteralPath $file -PathType Leaf) { Send $ctx 200 $Mime[[IO.Path]::GetExtension($file).ToLower()] ([IO.File]::ReadAllBytes($file)); return }
		}
		Send-Text $ctx 404 'Not found'; return
	}

	# Writes only from the app itself: a cross-site page can't send this header without a preflight, which is never answered.
	if ($req.HttpMethod -ne 'POST' -or $req.Headers['X-Rocco'] -ne '1') { Send-Text $ctx 403 'Forbidden'; return }
	if ($path -eq '/api/projects/new') {
		$body = Read-Json $req
		Send-Json $ctx @{ job = (Start-NewProject ([string]$body.name) ([string]$body.code) ([string]$body.repo)) }; return
	}
	# The user's note goes straight to the queue, for the conductor to plan.
	if ($path -eq '/api/note') {
		$body = Read-Json $req
		$text = [string]$body.text
		$type = if ([string]$body.type -in $Types) { [string]$body.type } else { '' }
		$title = if ($text) { ($text -split "`r?`n")[0] } else { 'Screenshot' }
		if ($title.Length -gt 120) { $title = $title.Substring(0, 117) + '...' }
		$t = New-Task $title $text 'queued' 'note' $type
		Send-ToConductor $t 'plan'
		Save-Task $t
		Send-Json $ctx @{ id = $t.id }; return
	}
	if ($path -eq '/api/send') { Send-Json $ctx @{ sent = (Send-Inbox) }; return }
	if ($path -eq '/api/order') {
		$ids = @((Read-Json $req).ids | Where-Object { "$_" -match '^T-\d+$' })
		Set-QueueOrder $ids
		Send-Json $ctx @{ ok = $true }; return
	}
	if ($path -eq '/api/history/bookmark') {
		Send-Json $ctx @{ bookmarked = (Switch-Bookmark ([string](Read-Json $req).hash)) }; return
	}
	if ($path -match '^/api/tasks/(T-\d+)/shot$') {
		$id = $Matches[1]
		$ext = $ImageExt[($req.ContentType -split ';')[0].Trim().ToLower()]
		if (-not $ext) { Send-Text $ctx 415 'Screenshots must be PNG, JPEG, GIF or WebP.'; return }
		$t = Read-Task $id
		$name = 'shot-{0}{1}' -f (@(@($t.shots) | Where-Object { $_ }).Count + 1), $ext
		$out = [IO.File]::Create((Join-Path (Get-TaskDir $id) $name))
		try { $req.InputStream.CopyTo($out) } finally { $out.Close() }
		Set-Field $t 'shots' (@(@($t.shots) | Where-Object { $_ }) + $name)
		Save-Task $t
		Send-Json $ctx @{ name = $name }; return
	}
	if ($path -match '^/api/tasks/(T-\d+)/(approve|reopen|answer|queue|remove|followup|undo|approve-plan|revise)$') {
		$id, $action = $Matches[1], $Matches[2]
		Invoke-TaskAction $id $action ([string](Read-Json $req).text)
		Send-Json $ctx @{ ok = $true }; return
	}
	Send-Text $ctx 404 'Not found'
}

function Start-Rocco {
	$url = "http://localhost:$Port/"
	$here = "$url`?p=$([uri]::EscapeDataString((Split-Path $HomeProject -Leaf)))"
	$listener = New-Object Net.HttpListener
	$listener.Prefixes.Add($url)
	try { $listener.Start() } catch {
		# Already running for this RoDev folder (started from any project): just open it on this project.
		Write-Host "Rocco is already running at $url (or the port is taken: $($_.Exception.Message))."
		if ($Open) { Start-Process $here }
		return
	}
	try { $Host.UI.RawUI.WindowTitle = "Rocco - $url" } catch { }
	Write-Host "Rocco: $url"
	Write-Host "Projects in $RoDev"
	Write-Host 'Leave this window open while you use it. Ctrl+C stops it.'
	if ($Open) { Start-Process $here }
	try {
		while ($listener.IsListening) {
			$next = $listener.GetContextAsync()
			while (-not $next.AsyncWaitHandle.WaitOne(250)) { }
			$ctx = $next.GetAwaiter().GetResult()
			try { Invoke-Request $ctx } catch {
				Write-Host "$($ctx.Request.HttpMethod) $($ctx.Request.Url.PathAndQuery): $($_.Exception.Message)"
				try { Send-Text $ctx 500 $_.Exception.Message } catch { }
			}
			Use-Project $HomeProject
		}
	} finally {
		$listener.Close()
		Get-Job | Remove-Job -Force
	}
}
