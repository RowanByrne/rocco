# The HTTP side: the app's files from web\, the JSON API (README.md "API"), and the server loop.

function Send($ctx, [int]$code, [string]$type, [byte[]]$bytes) {
	$res = $ctx.Response
	$res.StatusCode = $code
	$res.ContentType = $type
	$res.Headers['Cache-Control'] = 'no-store'
	$res.ContentLength64 = $bytes.Length
	# A HEAD request (a check that the server is up) gets the headers only.
	if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
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
	$get = $req.HttpMethod -in 'GET', 'HEAD' # HEAD: the same answer without its body (Send)

	# Not about one project.
	if ($get -and $path -eq '/api/projects') {
		Send-Json $ctx ([pscustomobject]@{ home = (Split-Path $HomeProject -Leaf); projects = @(Get-Projects | Select-Object id, name, phase, template) }); return
	}
	if ($get -and $path -eq '/api/me') { Send-Json $ctx (Get-Me); return }
	if ($get -and $path -match '^/api/jobs/(\w+)$') { Send-Json $ctx (Get-JobStatus $Matches[1]); return }
	if ($get -and $path -match '^/api/actions/runs/(\w+)$') { Send-Json $ctx (Get-ActionRun $Matches[1]); return }
	if ($get -and $path -eq '/api/agent') { Send-Json $ctx (Get-Agent); return }
	# The user's own accounts on this PC (accounts.ps1): onboarding's first screen.
	if ($get -and $path -eq '/api/accounts') { Send-Json $ctx (Get-Accounts ($req.QueryString['refresh'] -eq '1')); return }
	# The onboarding survey for a game that doesn't exist yet: the template's.
	if ($get -and $path -eq '/api/onboarding/survey') { Send-Json $ctx (Get-Survey); return }
	# This PC's memory and threads, and how many lanes to suggest (lanes.ps1): for a game being made too, so ?p= is optional.
	if ($get -and $path -eq '/api/lanes') {
		$named = $req.QueryString['p']
		if ($named) { Use-Project (Find-Project $named).path }
		Send-Json $ctx (Get-LaneAdvice ([bool]$named)); return
	}
	if ($get -and $path -notmatch '^/(api|files)/') { Send-Static $ctx $path; return }

	# Everything else is about one project, named by ?p=.
	$project = Find-Project $req.QueryString['p']
	Use-Project $project.path
	if ($get) {
		if ($path -eq '/api/state') {
			Invoke-UpdateAuto $false | Out-Null # due game page events get queued even when Updates isn't open (updates.ps1)
			Send-Json $ctx (Get-State $req.QueryString['p']); return
		}
		if ($path -eq '/api/updates') { Send-Json $ctx (Get-Updates ($req.QueryString['refresh'] -eq '1')); return }
		if ($path -eq '/api/thumbnails') { Send-Json $ctx (Get-Thumbnails ($req.QueryString['refresh'] -eq '1')); return }
		# A thumbnail concept or an event's card image: candidates in ..\art\generated (thumbnails.ps1, updates.ps1).
		$decoded = [uri]::UnescapeDataString($path)
		if ($decoded -match '^/files/art/((thumbnails|events)/[\w .-]+/[\w .-]+\.(png|jpe?g|webp))$' -and $Matches[1] -notmatch '\.\.') {
			$file = Join-Path $Root "art\generated\$($Matches[1] -replace '/', '\')"
			if (Test-Path -LiteralPath $file -PathType Leaf) { Send $ctx 200 $Mime[[IO.Path]::GetExtension($file).ToLower()] ([IO.File]::ReadAllBytes($file)); return }
		}
		if ($path -eq '/api/connections') { Send-Json $ctx (Get-Connections ($req.QueryString['refresh'] -eq '1')); return }
		if ($path -eq '/api/history') { Send-Json $ctx (Get-History); return }
		if ($path -eq '/api/docs') { Send-Json $ctx (Get-Docs $project.template); return }
		if ($path -eq '/api/docs/file') { Send-Json $ctx (Read-Doc $req.QueryString['path'] $project.template); return }
		if ($path -eq '/api/onboarding') { Send-Json $ctx ([pscustomobject]@{ survey = (Get-Survey $RepoDir); answers = (Read-Answers) }); return }
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
		try { Send-Json $ctx @{ job = (Start-NewProject ([string]$body.name) ([string]$body.code) ([string]$body.repo) ([string]$body.existing.kind) ([string]$body.existing.from)) } }
		catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# This PC's agent (agents.ps1). The tools check runs again, so Connections marks the new one.
	if ($path -eq '/api/agent') {
		try { $agent = Set-Agent ([string](Read-Json $req).id) } catch { Send-Text $ctx 400 $_.Exception.Message; return }
		$script:PcResult = $null
		Send-Json $ctx $agent; return
	}
	# Onboarding (onboarding.ps1): the user's answers into docs/game/ONBOARDING.md, then their agent on SETUP.md.
	if ($path -eq '/api/onboarding/answers') {
		$body = Read-Json $req
		try { Send-Json $ctx (Save-Answers ([string]$body.flow) ([string]$body.source) $body.answers) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	if ($path -eq '/api/onboarding/setup') {
		$body = Read-Json $req
		try { Send-Json $ctx (Start-Setup ([string]$body.part) @($body.tiles | Where-Object { $_ })) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# This PC's lanes (lanes.ps1): { count } records how many it opens, then they're opened in the background.
	if ($path -eq '/api/lanes') {
		$count = (Read-Json $req).count
		try { Send-Json $ctx (Start-OpenLanes $(if ($null -ne $count) { [int]$count } else { $null })) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# The user's agent as this project's conductor, when none is running (conductor.ps1).
	if ($path -eq '/api/conductor') {
		if ((Get-Conductor).state -ne 'none') { Send-Json $ctx @{ agent = ''; running = $true }; return }
		try { Send-Json $ctx @{ agent = (Request-Conductor) } } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# Updates (updates.ps1): the user's cards on the game's calendar, and their game page events.
	if ($path -match '^/api/updates/(save|remove|queue|lead|image|publish)$') {
		$body = Read-Json $req
		try {
			Send-Json $ctx $(switch ($Matches[1]) {
				'save' { Save-UpdateCard $body }
				'remove' { Remove-UpdateCard ([string]$body.id) }
				'queue' { Add-EventTasks @([string]$body.id) $false }
				'lead' { Set-AutoLead ([int]$body.days) }
				'image' { Set-CardImage ([string]$body.id) ([string]$body.image) }
				'publish' { Publish-UpdateEvent ([string]$body.eventId) }
			})
		} catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# Thumbnails (thumbnails.ps1): concepts from a direction, the user's pick, new directions from the agent.
	if ($path -match '^/api/thumbnails/(generate|use|directions)$') {
		$body = Read-Json $req
		try {
			Send-Json $ctx $(switch ($Matches[1]) {
				'generate' { Start-ThumbConcepts ([string]$body.direction) ([int]$body.count) }
				'use' { Use-ThumbConcept ([string]$body.file) }
				'directions' { Request-ThumbDirections }
			})
		} catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# Accounts linked on this PC (Connections). The key goes into the user's environment; it never comes back out.
	if ($path -eq '/api/links/roblox') {
		try { Send-Json $ctx (Connect-Roblox ([string](Read-Json $req).key)) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	if ($path -eq '/api/links/roblox/remove') { Disconnect-Roblox; Send-Json $ctx @{ ok = $true }; return }
	if ($path -eq '/api/links/elevenlabs') {
		try { Send-Json $ctx (Connect-ElevenLabs ([string](Read-Json $req).key)) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	if ($path -eq '/api/links/elevenlabs/remove') { Disconnect-ElevenLabs; Send-Json $ctx @{ ok = $true }; return }
	# A Connections row's button (actions.ps1): only actions defined there can run.
	if ($path -match '^/api/actions/([\w-]+)$') {
		try { Send-Json $ctx (Invoke-ConnectionAction $Matches[1] ([string](Read-Json $req).value)) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# Rocco moves to a newer release, then restarts on it once this answer is sent (README.md "Updating").
	if ($path -eq '/api/rocco/update') {
		try { Update-Rocco ([string](Read-Json $req).tag) } catch { Send-Text $ctx 400 $_.Exception.Message; return }
		$script:Restarting = $true
		Send-Json $ctx @{ ok = $true }; return
	}
	# The user's note goes straight to the queue, for the conductor to plan. A question goes to the conductor to answer (rocco.ps1 reply).
	if ($path -eq '/api/note') {
		$body = Read-Json $req
		$text = [string]$body.text
		$type = if ([string]$body.type -in $Types) { [string]$body.type } else { '' }
		$title = if ($text) { ($text -split "`r?`n")[0] } else { 'Screenshot' }
		if ($title.Length -gt 120) { $title = $title.Substring(0, 117) + '...' }
		$question = $type -eq 'question'
		$t = New-Task $title $text 'queued' $(if ($question) { 'question' } else { 'note' }) $type
		Send-ToConductor $t $(if ($question) { 'question' } else { 'plan' })
		Save-Task $t
		# opened: the agent Rocco opened as the conductor, because none was running.
		Send-Json $ctx @{ id = $t.id; opened = (Request-Conductor) }; return
	}
	# The user's own edit to a doc: committed on main and pushed. { conflict } if it changed since the user opened it.
	if ($path -eq '/api/docs/save') {
		$body = Read-Json $req
		try { Send-Json $ctx (Save-Doc ([string]$body.path) ([string]$body.text) ([string]$body.base) ([string]$body.message) $project.template) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	if ($path -eq '/api/send') { $sent = Send-Inbox; Send-Json $ctx @{ sent = $sent; opened = $(if ($sent) { Request-Conductor } else { '' }) }; return }
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
		# What the user did may wait on the conductor now (an answer, a reopen, a plan approved).
		Send-Json $ctx @{ ok = $true; opened = $(if ((Read-Task $id).pending) { Request-Conductor } else { '' }) }; return
	}
	Send-Text $ctx 404 'Not found'
}

# Serves until stopped. Returns $true when it stopped to hand over to an updated Rocco in a new window.
function Start-Rocco {
	$url = "http://localhost:$Port/"
	$homeId = Split-Path $HomeProject -Leaf
	$here = "$url`?p=$([uri]::EscapeDataString($homeId))"
	# After an update, the Rocco that started this one may still be letting go of the port.
	$deadline = (Get-Date).AddSeconds($(if ($Restart) { 15 } else { 0 }))
	while ($true) {
		$listener = New-Object Net.HttpListener
		$listener.Prefixes.Add($url)
		try { $listener.Start(); break } catch {
			$listener.Close()
			if ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300; continue }
			# Already running for this RoDev folder (started from any project): just open it on this project.
			Write-Host "Rocco is already running at $url (or the port is taken: $($_.Exception.Message))."
			if ($Open -and -not $Restart) { Start-Process $here }
			return $false
		}
	}
	try { $Host.UI.RawUI.WindowTitle = "Rocco - $url" } catch { }
	Write-Host "Rocco $RoccoVersion at $url"
	Write-Host "Projects in $RoDev"
	Write-Host 'Leave this window open while you use it. Ctrl+C stops it.'
	# A restart keeps the tab that's open: it reconnects, and reloads for the new version.
	if ($Open -and -not $Restart) { Start-Process $here }
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
			# Updated: the new version starts in its own window and waits for this one to let go of the port.
			if ($script:Restarting) {
				Write-Host 'Updated. Rocco restarts in a new window.'
				Start-Process (Join-Path $AppDir 'Rocco.bat') -ArgumentList '-Restart', '-Port', $Port, '-Project', "`"$homeId`""
				break
			}
		}
	} finally {
		$listener.Close()
		Get-Job | Remove-Job -Force
	}
	[bool]$script:Restarting
}
