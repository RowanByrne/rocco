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
function Send-Json($ctx, $value, [int]$code = 200) { Send $ctx $code 'application/json; charset=utf-8' $Utf8.GetBytes((ConvertTo-Json -InputObject $value -Depth 10 -Compress)) }
function Send-Text($ctx, [int]$code, [string]$text) { Send $ctx $code 'text/plain; charset=utf-8' $Utf8.GetBytes($text) }

$Mime = @{
	'.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
	'.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'
	'.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'; '.webp' = 'image/webp'
	'.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.m4a' = 'audio/mp4'; '.txt' = 'text/plain; charset=utf-8'
}
$ImageExt = @{ 'image/png' = '.png'; 'image/jpeg' = '.jpg'; 'image/gif' = '.gif'; 'image/webp' = '.webp' }
# The biggest screenshot the app may add to a note. A 4K capture is a few megabytes.
$ShotMax = 25MB

# A note handed to the conductor: to plan, or (a question) to answer. A note with screenshots is handed over once
# they're in (the app says so, /release), so the conductor never reads it before its pictures are there.
function Send-Note($t) {
	$question = $t.kind -eq 'question'
	Set-Field $t 'uploading' $null
	Send-ToConductor $t $(if ($question) { 'question' } else { 'plan' })
	Save-Task $t
	Add-Sent $(if ($question) { 'question' } else { 'note' }) $t "$($t.note)" @($t.shots)
}

# A note whose app went away mid-upload (the tab closed) is handed over with what arrived.
function Send-StaleNotes {
	foreach ($t in @(Get-Tasks | Where-Object { $_.uploading -and ((Get-Date) - [datetime]$_.uploading).TotalSeconds -gt 90 })) {
		$t = Read-Task $t.id
		if ($t.uploading) { Send-Note $t; Request-Conductor | Out-Null } else { Unlock-Tasks }
	}
}

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
	# The plan's usage limits, from the status line of an agent Rocco opened (sessions.ps1 Save-Limits): it shows
	# what this answers.
	if ($path -eq '/api/limits' -and $req.HttpMethod -eq 'POST' -and $req.Headers['X-Rocco'] -eq '1') {
		Send-Text $ctx 200 (Save-Limits (Read-Json $req)); return
	}
	if ($get -and $path -notmatch '^/(api|files)/') { Send-Static $ctx $path; return }

	# Everything else is about one project, named by ?p=.
	$project = Find-Project $req.QueryString['p']
	Use-Project $project.path
	# And, for the conductor's routes, about one thread, named by ?t=: a feature's, or a card's, with an agent of its
	# own (leads.ps1). Without it, the main chat: the conductor's.
	if ($req.QueryString['t']) { try { Use-Thread ([string]$req.QueryString['t']) } catch { Send-Text $ctx 400 $_.Exception.Message; return } }
	if ($get) {
		if ($path -eq '/api/state') {
			Invoke-UpdateAuto $false | Out-Null # due game page events get queued even when Updates isn't open (updates.ps1)
			Send-StaleNotes
			Update-Leads # a feature's own agent is opened once it has a lane to work in (leads.ps1)
			Send-Json $ctx (Get-State $req.QueryString['p']); return
		}
		# What the board no longer shows (tasks.ps1): approved or deleted a while ago, searched by ?q=.
		if ($path -eq '/api/archive') { Send-Json $ctx (Get-Archive ([string]$req.QueryString['q']) ([int]$req.QueryString['skip'])); return }
		# What each task took: tokens from its sessions, and its time at work (sessions.ps1).
		if ($path -eq '/api/usage') { Send-Json $ctx (Get-ProjectUsage); return }
		# The conductor's history (thread.ps1), only when it changed since the stamp the app has.
		if ($path -eq '/api/conductor/thread') {
			if ($req.QueryString['stamp'] -and $req.QueryString['stamp'] -eq (Get-HistoryStamp)) { Send-Json $ctx @{ same = $true }; return }
			Send-Json $ctx (Get-ConductorHistory); return
		}
		if ($path -eq '/api/updates') { Send-Json $ctx (Get-Updates ($req.QueryString['refresh'] -eq '1')); return }
		if ($path -eq '/api/thumbnails') { Send-Json $ctx (Get-Thumbnails ($req.QueryString['refresh'] -eq '1')); return }
		# A thumbnail concept or an event's card image: candidates in ..\art\generated (thumbnails.ps1, updates.ps1).
		$decoded = [uri]::UnescapeDataString($path)
		if ($decoded -match '^/files/art/((thumbnails|events)/[\w .-]+/[\w .-]+\.(png|jpe?g|webp))$' -and $Matches[1] -notmatch '\.\.') {
			$file = Join-Path $Root "art\generated\$($Matches[1] -replace '/', '\')"
			if (Test-Path -LiteralPath $file -PathType Leaf) { Send $ctx 200 $Mime[[IO.Path]::GetExtension($file).ToLower()] ([IO.File]::ReadAllBytes($file)); return }
		}
		# A picture on one of the conductor's questions (thread.ps1 Get-AskFilesDir).
		if ($decoded -match '^/files/conductor/(C-[0-9a-f]{6})/([\w.-]+\.(png|jpe?g|gif|webp))$' -and $Matches[2] -notmatch '\.\.') {
			$file = Join-Path (Get-AskFilesDir $Matches[1]) $Matches[2]
			if (Test-Path -LiteralPath $file -PathType Leaf) { Send $ctx 200 $Mime[[IO.Path]::GetExtension($file).ToLower()] ([IO.File]::ReadAllBytes($file)); return }
		}
		if ($path -eq '/api/connections') { Send-Json $ctx (Get-Connections ($req.QueryString['refresh'] -eq '1')); return }
		if ($path -eq '/api/history') { Send-Json $ctx (Get-History); return }
		if ($path -eq '/api/docs') { Send-Json $ctx (Get-Docs $project.template); return }
		if ($path -eq '/api/docs/file') { Send-Json $ctx (Read-Doc $req.QueryString['path'] $project.template); return }
		if ($path -eq '/api/onboarding') { Send-Json $ctx ([pscustomobject]@{ survey = (Get-Survey $RepoDir); answers = (Read-Answers) }); return }
		# One task by its id, on the board or put away: a link to a task opens it.
		if ($path -match '^/api/tasks/(T-\d+)$') {
			try { Send-Json $ctx (Get-Task $Matches[1]) } catch { Send-Text $ctx 404 "There's no task $($Matches[1]) in this project." }
			return
		}
		if ($path -match '^/api/tasks/(T-\d+)/changes$') { Send-Json $ctx (Get-TaskChanges (Get-Task $Matches[1])); return }
		# One changed file's lines, as git shows them (history.ps1).
		if ($path -match '^/api/tasks/(T-\d+)/diff$') { Send-Json $ctx (Get-TaskDiff (Get-Task $Matches[1]) ([string]$req.QueryString['path'])); return }
		# Its agent's sessions (sessions.ps1), then each one's lines from where the app got to.
		if ($path -match '^/api/tasks/(T-\d+)/sessions$') { Send-Json $ctx @(Get-TaskSessions (Get-Task $Matches[1])); return }
		if ($path -match '^/api/tasks/(T-\d+)/session$') { Send-SessionText $ctx (Get-Task $Matches[1]) ([string]$req.QueryString['key']) ([long]$req.QueryString['from']); return }
		# A task's screenshot or audio option, or the output of a check its worker ran (check-N.txt).
		if ($path -match '^/files/(T-\d+)/([\w.-]+\.(png|jpe?g|gif|webp|mp3|ogg|wav|m4a)|check-\d+\.txt)$' -and $Matches[2] -notmatch '\.\.') {
			$name = $Matches[2]
			$file = try { Join-Path (Get-TaskDir $Matches[1]) $name } catch { '' }
			if ($file -and (Test-Path -LiteralPath $file -PathType Leaf)) { Send $ctx 200 $Mime[[IO.Path]::GetExtension($file).ToLower()] ([IO.File]::ReadAllBytes($file)); return }
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
	# The model the next conductor is opened on (Settings).
	if ($path -eq '/api/agent/model') {
		try { Send-Json $ctx (Set-AgentModel ([string](Read-Json $req).model)) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# How hard the next conductor thinks (the note box's model picker, Settings).
	if ($path -eq '/api/agent/effort') {
		try { Send-Json $ctx (Set-AgentEffort ([string](Read-Json $req).effort)) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# Whether a feature the user approves gets an agent of its own (Settings, leads.ps1).
	if ($path -eq '/api/agent/leads') { Send-Json $ctx (Set-LeadsOn ([bool](Read-Json $req).on)); return }
	# A background job the user gave up on (a new project, opening lanes): stopped, with whatever it started.
	if ($path -match '^/api/jobs/(\w+)/cancel$') {
		try { Send-Json $ctx (Stop-ScriptJob $Matches[1]) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
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
	# Fix lanes (the sidebar): lanes with work in them that went down, opened again (lanes.ps1 Repair-Lanes).
	if ($path -eq '/api/lanes/fix') {
		$down = @((Read-Json $req).down | Where-Object { $_ -and [int]$_.lane -gt 0 })
		if (-not $down.Count) { Send-Text $ctx 400 'Say which lanes went down.'; return }
		try { Send-Json $ctx (Repair-Lanes $down) } catch { Send-Text $ctx 400 $_.Exception.Message }
		return
	}
	# The conductor's thread (thread.ps1): the user answers its questions and permission requests, and writes to it. What
	# it waits on wakes it through wait, or opens one when none is running.
	if ($path -eq '/api/conductor/answer') {
		$body = Read-Json $req
		$s = Get-ThreadState
		$q = $s.open | Where-Object { $_.id -eq [string]$body.id -and $_.kind -eq 'asked' } | Select-Object -First 1
		if (-not $q) { Send-Text $ctx 409 'That question was already answered.'; return }
		Add-Thread 'answered' @{ to = $q.id; answers = @($body.answers | ForEach-Object { [string]$_ }); text = [string]$body.text } 'you' | Out-Null
		# A hook waiting on it hands it over itself; otherwise it waits for the conductor's wait.
		$waiting = $q.via -eq 'hook' -and -not $s.expired.ContainsKey($q.id)
		$script:ConductorCache = @{}
		Send-Json $ctx @{ ok = $true; opened = $(if ($waiting) { '' } else { Request-Conductor }) }; return
	}
	if ($path -eq '/api/conductor/permission') {
		$body = Read-Json $req
		$p = (Get-ThreadState).open | Where-Object { $_.id -eq [string]$body.id -and $_.kind -eq 'permission' } | Select-Object -First 1
		if (-not $p) { Send-Text $ctx 409 "That request isn't waiting any more: answer it in the agent's window."; return }
		Add-Thread 'decided' @{ to = $p.id; allow = [bool]$body.allow } 'you' | Out-Null
		$script:ConductorCache = @{}
		Send-Json $ctx @{ ok = $true }; return
	}
	if ($path -eq '/api/conductor/message') {
		$body = Read-Json $req
		$text = ([string]$body.text).Trim()
		if (-not $text) { Send-Text $ctx 400 'Write something to send.'; return }
		$e = Add-Thread 'message' @{ text = $text; to = [string]$body.to; via = 'rocco' } 'you'
		$script:ConductorCache = @{}
		Send-Json $ctx @{ id = $e.id; opened = (Request-Conductor) }; return
	}
	# Claude Code's background hooks for a conductor Rocco opened (server\hook-post.ps1).
	if ($path -eq '/api/conductor/hook') {
		try { Add-HookEvent ([string]$req.QueryString['e']) (Read-Json $req) } catch { }
		# No body: to Claude Code that's a hook with nothing to say. A JSON answer would be read as the hook's decision.
		Send $ctx 200 'text/plain; charset=utf-8' (New-Object byte[] 0); return
	}
	if ($path -eq '/api/conductor/show-window') { Send-Json $ctx @{ shown = (Show-ConductorWindow) }; return }
	# The conductor has stopped answering: end its session and open a new one on what's on the board (conductor.ps1).
	if ($path -eq '/api/conductor/restart') {
		try { Send-Json $ctx @{ agent = (Restart-Conductor) } } catch { Send-Text $ctx 400 $_.Exception.Message }
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
	if ($path -match '^/api/thumbnails/(generate|use|directions|cancel)$') {
		$body = Read-Json $req
		try {
			Send-Json $ctx $(switch ($Matches[1]) {
				'generate' { Start-ThumbConcepts ([string]$body.direction) ([int]$body.count) }
				'cancel' { Stop-ThumbConcepts }
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
	# Quit (Settings): Rocco stops once this answer is sent, and the Lync servers it ran with no windows stop now.
	if ($path -eq '/api/rocco/quit') {
		$script:Quitting = $true
		Send-Json $ctx @{ ok = $true; lync = (Stop-Lync) }; return
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
		# hold: screenshots follow. It's handed to the conductor once they're in (/release below).
		if ($body.hold) {
			Set-Field $t 'uploading' (Now)
			Set-Field $t 'waiting' 'Adding its screenshots'
			Save-Task $t
			Send-Json $ctx @{ id = $t.id; opened = '' }; return
		}
		Send-Note $t
		# opened: the agent Rocco opened as the conductor, because none was running.
		Send-Json $ctx @{ id = $t.id; opened = (Request-Conductor) }; return
	}
	# A held note's screenshots are in (or as many as would upload): over to the conductor.
	if ($path -match '^/api/tasks/(T-\d+)/release$') {
		$t = Read-Task $Matches[1]
		if ($t.uploading) { Send-Note $t; Send-Json $ctx @{ ok = $true; opened = (Request-Conductor) } } else { Send-Json $ctx @{ ok = $true; opened = '' } }
		return
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
		$tooBig = "That picture is over $([int]($ShotMax / 1MB)) MB. Crop it, or save it as a JPEG."
		if ($req.ContentLength64 -gt $ShotMax) { Send-Text $ctx 413 $tooBig; return }
		$t = Read-Task $id
		$name = 'shot-{0}{1}' -f (@(@($t.shots) | Where-Object { $_ }).Count + 1), $ext
		$file = Join-Path (Get-TaskDir $id) $name
		$out = [IO.File]::Create($file)
		$total = [long]0
		try {
			# Counted as it arrives: a size isn't always given up front.
			$buffer = New-Object byte[] 81920
			while (($n = $req.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
				$total += $n
				if ($total -gt $ShotMax) { break }
				$out.Write($buffer, 0, $n)
			}
		} finally { $out.Close() }
		if ($total -gt $ShotMax) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue; Send-Text $ctx 413 $tooBig; return }
		if (-not $total) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue; Send-Text $ctx 400 'That picture was empty.'; return }
		Set-Field $t 'shots' (@(@($t.shots) | Where-Object { $_ }) + $name)
		Save-Task $t
		Send-Json $ctx @{ name = $name }; return
	}
	if ($path -match '^/api/tasks/(T-\d+)/(approve|reopen|answer|queue|remove|followup|undo|approve-plan|revise|pause|resume|restart|assign|promote|make-task)$') {
		$id, $action = $Matches[1], $Matches[2]
		$text = [string](Read-Json $req).text
		try { Invoke-TaskAction $id $action $text } catch { Send-Text $ctx 400 $_.Exception.Message; return }
		$t = Get-Task $id
		# On the user's own question, approve is "Got it" and reopen is "Ask more".
		$said = if ($t.kind -eq 'question' -and $action -eq 'approve') { 'got-it' } elseif ($t.kind -eq 'question' -and $action -eq 'reopen') { 'ask-more' } else { $action }
		Add-Sent $said $t $text
		# What the user did may wait on the conductor now (an answer, a reopen, a plan approved). A deleted task's work
		# waits for the next conductor instead: with none running, nothing is running it either.
		# Nor does a pause open one: with no conductor there's no worker to stop (it took effect at once).
		# Whose it is to handle is opened: the conductor, or the feature's (or the card's) own agent (leads.ps1).
		$pending = $t.pending
		$opened = ''
		if ($pending -and $pending -notin 'cancel', 'stop') {
			$all = @(Get-Tasks); $byId = @{}; foreach ($x in $all) { $byId[$x.id] = $x }
			Use-Thread (Get-TaskOwner $t $byId)
			$opened = Request-Conductor
			Use-Thread ''
		} elseif ($t.lead -and -not $pending) { Update-Leads }
		Send-Json $ctx @{ ok = $true; opened = $opened }; return
	}
	Send-Text $ctx 404 'Not found'
}

# How Rocco runs in the background (rocco.ps1 start, and after an update): serve, opening the project unless it's a
# restart, whose tab is already open.
function Get-ServeArguments([string]$project, [int]$port, [bool]$restart) {
	$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $AppDir 'rocco.ps1')`"", 'serve', '-Port', $port)
	if ($project) { $arguments += '-Project', "`"$project`"" }
	$arguments + $(if ($restart) { '-Restart' } else { '-Open' })
}

# Serves until stopped: Quit (Settings), Ctrl+C when it runs in a window, or an update. Returns $true when it stopped to
# hand over to an updated Rocco. What it says goes to %APPDATA%\Rocco\rocco.log, since it usually has no window.
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
	# The log of this run, with the last three runs kept beside it (rocco.1.log is the one before): what went wrong
	# is usually in the run that just ended.
	$log = Join-Path $RoccoHome 'rocco.log'
	try {
		New-Item -ItemType Directory -Force $RoccoHome | Out-Null
		foreach ($n in 3, 2, 1) {
			$from = if ($n -eq 1) { $log } else { Join-Path $RoccoHome "rocco.$($n - 1).log" }
			if (Test-Path -LiteralPath $from) { Move-Item -LiteralPath $from -Destination (Join-Path $RoccoHome "rocco.$n.log") -Force }
		}
		Start-Transcript -Path $log -Force | Out-Null
	} catch { }
	# Nothing the server runs may wait on a console nobody can see: git asks for a password there when it has no
	# sign-in window to use.
	$env:GIT_TERMINAL_PROMPT = '0'
	Write-Host "Rocco $RoccoVersion at $url"
	Write-Host "Projects in $RoDev"
	Write-Host 'Quit it from Settings in the app (or Ctrl+C, when it runs in a window).'
	# A restart keeps the tab that's open: it reconnects, and reloads for the new version.
	if ($Open -and -not $Restart) { Start-Process $here }
	try {
		while ($listener.IsListening) {
			$next = $listener.GetContextAsync()
			while (-not $next.AsyncWaitHandle.WaitOne(250)) { }
			$ctx = $next.GetAwaiter().GetResult()
			try { Invoke-Request $ctx } catch {
				Write-Host "$((Get-Date).ToString('HH:mm:ss')) $($ctx.Request.HttpMethod) $($ctx.Request.Url.PathAndQuery): $($_.Exception.Message)"
				try { Send-Text $ctx 500 $_.Exception.Message } catch { }
			} finally { Unlock-Tasks } # a task read for a change that never came is let go (tasks.ps1)
			Use-Project $HomeProject
			Stop-OldJobs
			if ($script:Quitting) { Write-Host 'Quit.'; break }
			# Updated: the new version starts in the background and waits for this one to let go of the port.
			if ($script:Restarting) {
				Write-Host 'Updated. Rocco restarts in the background.'
				Start-Hidden "powershell.exe $((Get-ServeArguments $homeId $Port $true) -join ' ')" $AppDir | Out-Null
				break
			}
		}
	} finally {
		$listener.Close()
		Get-Job | Remove-Job -Force
		try { Stop-Transcript | Out-Null } catch { }
	}
	[bool]$script:Restarting
}
