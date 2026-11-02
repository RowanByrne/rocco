# Thumbnails (the template's docs/workflow/RELEASING.md "Thumbnails"): the game page's thumbnails and how each is doing
# (roblox.ps1), directions to try next, and concepts made with Codex in one click (the template's tools\imagegen.ps1).
# Concepts are candidates (ART-PIPELINE.md): they stay in ..\art\generated\thumbnails\<direction>\, each with its prompt
# and hash beside it in a .json file, until the user picks one and the agent takes it from there.

$ThumbDirectionsFile = 'live/GAME-PAGE.md'
$script:ConceptRuns = @{}   # project folder -> @{ Job; Direction; Files; Started; Error }

# A section of a doc, without the template's prompts (lines starting with >) and blank lines, cut to a sentence or two.
function Get-DocGist([string]$relative, [string]$heading, [int]$max = 260) {
	$path = Join-Path $RepoDir $relative
	if (-not (Test-Path $path)) { return '' }
	$text = [IO.File]::ReadAllText($path, $Utf8) -replace "`r`n", "`n"
	$m = [regex]::Match($text, "(?ms)^## $([regex]::Escape($heading))[ \t]*\n(.*?)(?=^## |\z)")
	if (-not $m.Success) { return '' }
	$lines = @($m.Groups[1].Value -split "`n" | Where-Object { $_.Trim() -and $_ -notmatch '^\s*>' -and $_ -notmatch '^\s*<!--' } | ForEach-Object { ($_ -replace '^\s*[-*]\s+', '' -replace '\*\*', '').Trim() })
	$gist = ($lines -join ' ').Trim()
	if ($gist.Length -gt $max) { $gist = $gist.Substring(0, $max).TrimEnd() + '...' }
	$gist
}

# What a thumbnail prompt needs to know about the game: its name, its hook, and its look.
function Get-GameBrief {
	$answers = (Read-Answers).answers
	$name = Get-ProjectField 'Game'
	if (-not $name -or $name -like '*{{*') { $name = Split-Path $Root -Leaf }
	$hook = Get-DocGist 'docs/game/PITCH.md' 'Hook'
	if (-not $hook) { $hook = "$($answers['idea'])".Trim() }
	$look = Get-DocGist 'docs/game/ART-DIRECTION.md' 'Pillars'
	if (-not $look) { $look = "$($answers['look'])".Trim() }
	[pscustomobject]@{ name = $name; hook = $hook; look = $look }
}

# Ways a Roblox thumbnail often wins, for a game whose agent hasn't suggested its own yet.
$StarterDirections = @(
	@{ id = 'big-moment'; name = 'The big moment'; why = 'Players click what looks exciting: the most dramatic second of the game, mid-action, with a character reacting.'; shot = 'The single most exciting moment of the game, mid-action, a player character in the foreground with a big, readable reaction' }
	@{ id = 'the-reward'; name = 'The reward'; why = 'A huge, shiny reward says what players get: the rarest item or creature, front and centre.'; shot = 'The rarest, most desirable reward or creature in the game, huge and glowing in the centre, with an amazed player character beside it' }
	@{ id = 'before-after'; name = 'Small to huge'; why = 'Progress sells the loop: where a player starts beside where they can end up.'; shot = 'A split composition: on the left a tiny, humble start; on the right the same thing grown huge and impressive, showing how far players progress' }
	@{ id = 'mystery'; name = 'The mystery'; why = 'Curiosity gets clicks: something intriguing, half-hidden, that players want to see.'; shot = 'Something mysterious and intriguing half-hidden in the scene, glowing or silhouetted, with a player character leaning in curiously' }
)

function Get-StarterPrompt($d, $brief) {
	$end = { param($s) "$s".Trim().TrimEnd('.', ' ') + '.' }
	$parts = @((& $end "Roblox game thumbnail for $($brief.name)$(if ($brief.hook) { ": $($brief.hook)" })"), (& $end $d.shot))
	if ($brief.look) { $parts += & $end "Style: $($brief.look)" }
	$parts += 'Bold and readable at a small size, bright saturated colours, strong contrast, no text, no logos, no real brands. Wide 16:9 landscape composition, the main subject centred with space around it.'
	$parts -join ' '
}

# The agent's directions (live/GAME-PAGE.md "Thumbnail directions", marked blocks), else the starters.
function Get-ThumbDirections {
	$path = Join-Path $RepoDir 'live\GAME-PAGE.md'
	$text = if (Test-Path $path) { [IO.File]::ReadAllText($path, $Utf8) -replace "`r`n", "`n" } else { '' }
	$own = @(foreach ($m in [regex]::Matches($text, '(?m)^<!-- direction: ([\w-]+) -->[ \t]*$')) {
		$rest = $text.Substring($m.Index + $m.Length)
		$end = [regex]::Match($rest, '(?m)^(<!-- direction: |## )')
		$block = if ($end.Success) { $rest.Substring(0, $end.Index) } else { $rest }
		$name = if ($block -match '(?m)^#{2,4}\s+(.+)$') { $Matches[1].Trim() } else { $m.Groups[1].Value }
		$why = if ($block -match '(?m)^- \*\*Why:\*\*\s*(.+)$') { $Matches[1].Trim() } else { '' }
		$prompt = if ($block -match '(?m)^- \*\*Prompt:\*\*\s*(.+)$') { $Matches[1].Trim().Trim('`') } else { '' }
		if ($prompt) { [pscustomobject]@{ id = $m.Groups[1].Value; name = $name; why = $why; prompt = $prompt; starter = $false } }
	})
	if ($own) { return $own }
	$brief = Get-GameBrief
	@($StarterDirections | ForEach-Object { [pscustomobject]@{ id = $_.id; name = $_.name; why = $_.why; prompt = (Get-StarterPrompt $_ $brief); starter = $true } })
}

function Get-ImagegenPath {
	foreach ($p in (Join-Path $RepoDir 'tools\imagegen.ps1'), (Join-Path $RoDev 'template\repo\tools\imagegen.ps1')) { if (Test-Path $p) { return $p } }
	''
}

# Concepts made so far, newest first, with what's beside each: its direction, prompt, and whether it was picked.
function Get-Concepts {
	$dir = Join-Path $Root 'art\generated\thumbnails'
	if (-not (Test-Path $dir)) { return @() }
	@(Get-ChildItem $dir -Recurse -File | Where-Object { $_.Extension -in '.png', '.jpg', '.jpeg', '.webp' } | Sort-Object LastWriteTime -Descending | Select-Object -First 60 | ForEach-Object {
		$meta = $null
		if (Test-Path "$($_.FullName).json") { try { $meta = [IO.File]::ReadAllText("$($_.FullName).json", $Utf8) | ConvertFrom-Json } catch { } }
		[pscustomobject]@{
			file = "thumbnails/$($_.Directory.Name)/$($_.Name)"; direction = $(if ($meta.direction) { "$($meta.direction)" } else { $_.Directory.Name }); created = $_.LastWriteTime.ToString('o')
			prompt = "$($meta.prompt)"; status = $(if ($meta.status) { "$($meta.status)" } else { 'candidate' }); task = "$($meta.task)"
		}
	})
}

# Makes concepts one after another, through the template's image tool, each beside a .json with its prompt and hash.
$ConceptJob = {
	param([string]$imagegen, [string]$outDir, [string]$slug, [string]$prompt, [int]$count, [int]$start, [string]$direction)
	$utf8 = New-Object Text.UTF8Encoding $false
	New-Item -ItemType Directory -Force $outDir | Out-Null
	$failed = @()
	$quote = { param($s) "'" + ("$s" -replace "'", "''") + "'" }
	for ($i = 0; $i -lt $count; $i++) {
		$out = Join-Path $outDir ('{0}-{1:D2}.png' -f $slug, ($start + $i))
		$text = "& $(& $quote $imagegen) -Prompt $(& $quote $prompt) -Out $(& $quote $out)"
		$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
		# A plain Process with no window, its output read back: what imagegen says has the hash.
		$psi = New-Object System.Diagnostics.ProcessStartInfo 'powershell.exe'
		$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
		$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
		$psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
		$p = [Diagnostics.Process]::Start($psi)
		$stdout = $p.StandardOutput.ReadToEndAsync(); $stderr = $p.StandardError.ReadToEndAsync()
		$p.WaitForExit()
		$said = "$($stdout.Result)`n$($stderr.Result)"
		if (Test-Path $out) {
			$meta = [ordered]@{ direction = $direction; prompt = $prompt; tool = 'tools\imagegen.ps1 (Codex)'; created = (Get-Date).ToString('o')
				size = $(if ($said -match 'size=(\d+x\d+)') { $Matches[1] } else { '' }); sha256 = $(if ($said -match 'sha256=([0-9A-Fa-f]+)') { $Matches[1] } else { '' }); status = 'candidate' }
			[IO.File]::WriteAllText("$out.json", ($meta | ConvertTo-Json), $utf8)
		} else {
			$failed += (@($said -split "`r?`n" | Where-Object { $_.Trim() }) | Select-Object -Last 3) -join ' '
		}
	}
	$failed -join "`n"
}

function Get-ConceptRun {
	$run = $script:ConceptRuns[$Root]
	if (-not $run) { return $null }
	if ($run.Job -and $run.Job.State -ne 'Running') {
		$said = "$(Receive-Job $run.Job -ErrorAction SilentlyContinue | Select-Object -Last 1)".Trim()
		Remove-Job $run.Job -Force
		$run.Job = $null
		$run.Error = $said
		$run.Finished = Get-Date
	}
	$done = @($run.Files | Where-Object { Test-Path $_ }).Count
	[pscustomobject]@{ running = [bool]$run.Job; direction = $run.Direction; count = $run.Files.Count; done = $done; started = $run.Started.ToString('o'); error = "$($run.Error)" }
}

# One click on a direction: a few concepts, made in the background with the user's Codex.
function Start-ThumbConcepts([string]$id, [int]$count) {
	if ($count -lt 1 -or $count -gt 6) { $count = 3 }
	$run = Get-ConceptRun
	if ($run -and $run.running) { throw 'Concepts are already being made. Wait for those first.' }
	if (-not (Find-AgentExe 'codex')) { throw 'Concepts are made with Codex, and it isn''t on this PC. Install the Codex app and sign in (Connections).' }
	$imagegen = Get-ImagegenPath
	if (-not $imagegen) { throw 'The image tool (tools\imagegen.ps1) isn''t in this project or the template. Update the template.' }
	$direction = @(Get-ThumbDirections | Where-Object { $_.id -eq $id })[0]
	if (-not $direction) { throw "There's no direction '$id'." }
	$outDir = Join-Path $Root "art\generated\thumbnails\$id"
	$taken = @(Get-ChildItem $outDir -File -Filter "$id-*.png" -ErrorAction SilentlyContinue | ForEach-Object { if ($_.BaseName -match '-(\d+)$') { [int]$Matches[1] } })
	$start = 1 + [int]($taken | Measure-Object -Maximum).Maximum
	$files = @(0..($count - 1) | ForEach-Object { Join-Path $outDir ('{0}-{1:D2}.png' -f $id, ($start + $_)) })
	$job = Start-Job -ScriptBlock $ConceptJob -ArgumentList $imagegen, $outDir, $id, $direction.prompt, $count, $start, $direction.name
	$script:ConceptRuns[$Root] = @{ Job = $job; Direction = $direction.name; Files = $files; Started = Get-Date; Error = '' }
	Get-ConceptRun
}

# The Thumbnails view.
function Get-Thumbnails([bool]$refresh) {
	$universe = Get-UniverseId
	$key = Get-RobloxKey
	$page = [pscustomobject]@{ universe = $universe; linked = [bool]$key; loading = $false; error = ''; statsError = ''; access = ''; days = 7; thumbnails = @(); other = @() }
	if ($universe) {
		$data = Get-RobloxData 'thumbs' $ThumbsJob @($universe, $key) $refresh 30
		$page.loading = $data.loading
		if ($data.value) { foreach ($k in 'error', 'statsError', 'access', 'days', 'thumbnails', 'other') { if ($null -ne $data.value.$k) { $page.$k = $data.value.$k } } }
		$page.thumbnails = @($page.thumbnails); $page.other = @($page.other)
	}
	$directions = @(Get-ThumbDirections)
	[pscustomobject]@{
		page = $page; hints = @(Get-ThumbHints $page); directions = $directions; ownDirections = -not ($directions | Where-Object { $_.starter })
		concepts = @(Get-Concepts); run = (Get-ConceptRun); codex = [bool](Find-AgentExe 'codex')
	}
}

# What Rocco can say from the numbers alone. The agent's directions go further.
function Get-ThumbHints($page) {
	$hints = @()
	$thumbs = @($page.thumbnails)
	if (-not $page.universe) { return @('Add the game''s universe id to PROJECT.md (the Roblox row) to see its thumbnails here.') }
	if (-not $thumbs) { return $hints }
	if ($thumbs.Count -eq 1) { $hints += 'The game page has one thumbnail. Add two or three more, so players see more of the game and you can compare them.' }
	if (-not $page.linked) { $hints += 'Link your Roblox Open Cloud key in Connections to see how each thumbnail does: impressions and qualified play-through.'; return $hints }
	$measured = @($thumbs | Where-Object { $_.stats -and $_.stats.impressions -ge 200 -and $null -ne $_.stats.ptr } | Sort-Object { [double]$_.stats.ptr } -Descending)
	if ($measured.Count -ge 2) {
		$best = $measured[0]; $worst = $measured[-1]
		$pct = { param($v) '{0:0.0}%' -f (100 * [double]$v) }
		if ([double]$worst.stats.ptr -gt 0 -and [double]$best.stats.ptr / [double]$worst.stats.ptr -ge 1.25) {
			$hints += "Thumbnail $($best.rank) turns $(& $pct $best.stats.ptr) of impressions into qualified plays; thumbnail $($worst.rank) only $(& $pct $worst.stats.ptr). Try a new direction in place of $($worst.rank)$(if ($best.rank -ne 1) { ", and put $($best.rank) first" })."
		} else { $hints += "Your thumbnails do about the same ($(& $pct $worst.stats.ptr) to $(& $pct $best.stats.ptr) qualified play-through). A bolder new direction is the way to learn more." }
	} elseif ($thumbs | Where-Object { $_.stats }) { $hints += "Too few impressions in the last $($page.days) days to compare the thumbnails yet." }
	$hints
}

# The user's pick: the agent approves it, fits it to the game page, and puts it up (or hands it to the user).
function Use-ThumbConcept([string]$file) {
	if ($file -notmatch '^thumbnails/[\w .-]+/[\w .-]+\.(png|jpe?g|webp)$' -or $file -match '\.\.') { throw 'Not a thumbnail concept.' }
	$path = Join-Path $Root "art\generated\$($file -replace '/', '\')"
	if (-not (Test-Path -LiteralPath $path)) { throw 'That concept isn''t there any more.' }
	$relative = "..\art\generated\$($file -replace '/', '\')"
	$note = "The user picked the thumbnail concept $relative (its prompt and hash are in the .json beside it). " +
		'Follow docs/workflow/RELEASING.md "Thumbnails": approve it into assets/marketing/ (ART-PIPELINE.md), fit it to 1920 x 1080, ' +
		'put it on the game page (with ROBLOX_API_KEY, or hand it to the user), and record it in live/GAME-PAGE.md.'
	$t = New-Task "Thumbnail: put $(Split-Path $path -Leaf) on the game page" $note 'queued' 'task'
	Send-ToConductor $t 'plan'
	Save-Task $t
	$metaPath = "$path.json"
	$meta = if (Test-Path $metaPath) { try { [IO.File]::ReadAllText($metaPath, $Utf8) | ConvertFrom-Json } catch { [pscustomobject]@{} } } else { [pscustomobject]@{} }
	$meta | Add-Member -Force status 'picked'
	$meta | Add-Member -Force task $t.id
	[IO.File]::WriteAllText($metaPath, ($meta | ConvertTo-Json), $Utf8)
	[pscustomobject]@{ task = $t.id }
}

# New directions from the agent, with the numbers it should start from.
function Request-ThumbDirections {
	$page = (Get-Thumbnails $false).page
	$numbers = @($page.thumbnails | Where-Object { $_.stats } | ForEach-Object {
		"thumbnail $($_.rank) (image $($_.id)): $([int]$_.stats.impressions) impressions, $([int]$_.stats.plays) qualified plays, $('{0:0.0}%' -f (100 * [double]$_.stats.ptr)) qualified play-through"
	})
	$note = 'Suggest 3 to 5 directions for new game page thumbnails, in live/GAME-PAGE.md "Thumbnail directions" (docs/workflow/RELEASING.md "Thumbnails"): ' +
		'each with why it should work for this game and the exact image prompt. Rocco shows them in Thumbnails, where the user makes concepts from them in one click.' +
		$(if ($numbers) { " The game page now, last $($page.days) days: $($numbers -join '; ')." } else { '' })
	$t = New-Task 'Thumbnail directions' $note 'queued' 'task'
	Send-ToConductor $t 'plan'
	Save-Task $t
	[pscustomobject]@{ task = $t.id }
}
