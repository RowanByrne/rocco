# Updates (the template's live/CALENDAR.md): the user's cards for upcoming updates, the game page events that announce
# them, and handing an update's event to the agent. Cards are marked blocks in CALENDAR.md, so the agent and every PC see
# them. Rocco rewrites only the card it changes, and keeps any field it doesn't know.

$CalendarFile = 'live/CALENDAR.md'
$CardKinds = @('Update', 'Live event', 'Timed release')
$AutoLeadDefault = 14

function Read-CalendarText {
	$path = Join-Path $RepoDir 'live\CALENDAR.md'
	if (Test-Path $path) { [IO.File]::ReadAllText($path, $Utf8) -replace "`r`n", "`n" } else { '' }
}

# Each card's block: from its marker to the next card, the next ## heading, or the end of the file.
function Get-CardBlocks([string]$text) {
	foreach ($m in [regex]::Matches($text, '(?m)^<!-- update: ([\w-]+) -->[ \t]*$')) {
		$after = $m.Index + $m.Length
		$next = [regex]::Match($text.Substring($after), '(?m)^(<!-- update: |## )')
		$length = if ($next.Success) { $m.Length + $next.Index } else { $text.Length - $m.Index }
		[pscustomobject]@{ id = $m.Groups[1].Value; start = $m.Index; length = $length; text = $text.Substring($m.Index, $length) }
	}
}

# What a card's "Game page event" line says, as a state: notyet, queued (with its task), drafted, scheduled, live, over, none.
function Get-EventState([string]$value) {
	$v = $value.Trim()
	if (-not $v -or $v -match '^Not yet') { return @{ state = 'notyet'; task = '' } }
	if ($v -match '^Queued') { return @{ state = 'queued'; task = $(if ($v -match '(T-\d+)') { $Matches[1] } else { '' }) } }
	foreach ($s in 'Drafted', 'Scheduled', 'Live', 'Over', 'None') { if ($v -match "^$s") { return @{ state = $s.ToLower(); task = '' } } }
	@{ state = 'notyet'; task = '' }
}

function ConvertFrom-CardBlock($block) {
	$title = ''; $fields = [ordered]@{}; $notes = @(); $part = 'title'
	foreach ($line in @($block.text.TrimEnd() -split "`n" | Select-Object -Skip 1)) {
		if ($part -eq 'title') {
			if ($line -match '^#{2,4}\s+(.+)$') { $title = $Matches[1].Trim(); $part = 'fields' }
			continue
		}
		if ($part -eq 'fields') {
			if ($line -match '^- \*\*([^*]+?):\*\*\s*(.*)$') { $fields[$Matches[1].Trim()] = $Matches[2].Trim(); continue }
			if (-not $line.Trim()) { continue }
			$part = 'notes'
		}
		$notes += $line
	}
	$date = ''; $time = ''
	if ("$($fields['When'])" -match '(\d{4}-\d{2}-\d{2})(?:\D+(\d{1,2}:\d{2}))?') { $date = $Matches[1]; $time = "$($Matches[2])" }
	$event = Get-EventState "$($fields['Game page event'])"
	[pscustomobject]@{
		id = $block.id; title = $title; date = $date; time = $time
		kind = $(if ($fields['Kind']) { "$($fields['Kind'])" } else { 'Update' })
		notes = ($notes -join "`n").Trim()
		event = $event.state; task = $event.task; eventText = "$($fields['Game page event'])"
		eventId = $(if ("$($fields['Event id'])" -match '(\d+)') { $Matches[1] } else { '' })
		image = "$($fields['Card image'])".Trim('`', ' ')
		fields = $fields
	}
}

function ConvertTo-CardBlock($card) {
	$fields = [ordered]@{}
	$fields['When'] = "$($card.date)$(if ($card.time) { " $($card.time) UTC" })"
	$fields['Kind'] = $card.kind
	$fields['Game page event'] = $card.eventText
	foreach ($k in $card.fields.Keys) { if (-not $fields.Contains($k)) { $fields[$k] = $card.fields[$k] } }
	$lines = @("<!-- update: $($card.id) -->", "### $($card.title)", '')
	foreach ($k in $fields.Keys) { $lines += "- **${k}:** $($fields[$k])".TrimEnd() }
	$lines += ''
	if ($card.notes) { $lines += $card.notes.Trim(); $lines += '' }
	($lines -join "`n") + "`n"
}

# Every card, soonest first, and how far ahead Rocco queues game page events (0: never).
function Read-Calendar {
	$text = Read-CalendarText
	$cards = @(Get-CardBlocks $text | ForEach-Object { ConvertFrom-CardBlock $_ } | Sort-Object { if ($_.date) { $_.date } else { '9999' } }, time)
	$lead = $AutoLeadDefault
	if ($text -match '(?m)^\*\*Auto-queue game page events:\*\*\s*(.+)$') { $lead = if ($Matches[1] -match '(\d+)') { [int]$Matches[1] } else { 0 } }
	[pscustomobject]@{ exists = [bool]$text; text = $text; cards = $cards; lead = $lead }
}

# A card's block put in place: over the old one, or among the upcoming cards in date order.
function Set-CardInText([string]$text, $card) {
	$block = ConvertTo-CardBlock $card
	$old = @(Get-CardBlocks $text | Where-Object { $_.id -eq $card.id })[0]
	if ($old) { return $text.Remove($old.start, $old.length).Insert($old.start, $block) }
	if (-not $text) { $text = "# Calendar`n" }
	$upcoming = [regex]::Match($text, '(?m)^## Upcoming[ \t]*$')
	if (-not $upcoming.Success) { return $text.TrimEnd() + "`n`n## Upcoming`n`n" + $block }
	$sectionStart = $upcoming.Index + $upcoming.Length
	$next = [regex]::Match($text.Substring($sectionStart), '(?m)^## ')
	$sectionEnd = if ($next.Success) { $sectionStart + $next.Index } else { $text.Length }
	# Before the first later card in Upcoming, else at the end of the section.
	foreach ($b in @(Get-CardBlocks $text | Where-Object { $_.start -ge $sectionStart -and $_.start -lt $sectionEnd })) {
		$c = ConvertFrom-CardBlock $b
		if ($c.date -and $card.date -and $c.date -gt $card.date) { return $text.Insert($b.start, $block) }
	}
	$before = $text.Substring(0, $sectionEnd).TrimEnd()
	$after = $text.Substring($sectionEnd)
	$before + "`n`n" + $block + $(if ($after) { "`n" + $after } else { '' })
}

function Save-Calendar([string]$text, [string]$message) {
	Assert-OnMain
	Save-RepoFile $CalendarFile $text $message
}

function New-CardId([string]$title, $cards) {
	$slug = ($title.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
	if (-not $slug) { $slug = 'update' }
	if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40).Trim('-') }
	$id = $slug; $n = 2
	while (@($cards | Where-Object { $_.id -eq $id }).Count) { $id = "$slug-$n"; $n++ }
	$id
}

# The user's card, new or changed. Announce off means no game page event; on again means one is wanted.
function Save-UpdateCard($posted) {
	$title = "$($posted.title)".Trim() -replace '[\r\n]+', ' '
	if (-not $title) { throw 'Give the update a name.' }
	$date = "$($posted.date)".Trim()
	if ($date -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'Give the update a date.' }
	$time = "$($posted.time)".Trim()
	if ($time -and $time -notmatch '^\d{1,2}:\d{2}$') { throw 'The time is HH:MM, in UTC.' }
	$kind = if ($CardKinds -contains "$($posted.kind)") { "$($posted.kind)" } else { 'Update' }
	$calendar = Read-Calendar
	$card = @($calendar.cards | Where-Object { $_.id -eq "$($posted.id)" })[0]
	$isNew = -not $card
	if ($isNew) { $card = [pscustomobject]@{ id = (New-CardId $title $calendar.cards); eventText = 'Not yet'; event = 'notyet'; fields = [ordered]@{} } }
	$card | Add-Member -Force title $title
	$card | Add-Member -Force date $date
	$card | Add-Member -Force time $time
	$card | Add-Member -Force kind $kind
	$card | Add-Member -Force notes ("$($posted.notes)" -replace "`r`n", "`n").Trim()
	if ($posted.PSObject.Properties['announce']) {
		if (-not $posted.announce) { $card.eventText = 'None' }
		elseif ($card.event -eq 'none') { $card.eventText = 'Not yet' }
	}
	$saved = Save-Calendar (Set-CardInText $calendar.text $card) $(if ($isNew) { "Calendar: plan $title" } else { "Calendar: $title" })
	[pscustomobject]@{ id = $card.id; saved = $saved }
}

function Remove-UpdateCard([string]$id) {
	$text = Read-CalendarText
	$block = @(Get-CardBlocks $text | Where-Object { $_.id -eq $id })[0]
	if (-not $block) { throw "There's no update '$id' in $CalendarFile." }
	$card = ConvertFrom-CardBlock $block
	$text = $text.Remove($block.start, $block.length) -replace "`n{3,}", "`n`n"
	[pscustomobject]@{ saved = (Save-Calendar $text "Calendar: remove $($card.title)") }
}

# Hands updates' game page events to the agent: a Workboard task each, and the card says it's queued. One commit.
function Add-EventTasks([string[]]$ids, [bool]$auto) {
	$calendar = Read-Calendar
	$text = $calendar.text
	$queued = @()
	foreach ($id in $ids) {
		$card = @($calendar.cards | Where-Object { $_.id -eq $id })[0]
		if (-not $card) { throw "There's no update '$id' in $CalendarFile." }
		if ($card.event -notin 'notyet', 'none') { continue }
		$when = "$($card.date)$(if ($card.time) { " $($card.time) UTC" })"
		$note = "The update `"$($card.title)`" on $when ($CalendarFile, card $($card.id)) gets an event on the game page. " +
			'Follow docs/workflow/RELEASING.md "Game page events": draft its title and description, make its 1024 x 576 card, ' +
			'put it on the game page to start when the update does, and record it on the card.'
		$t = New-Task "Game page event: $($card.title)" $note 'queued' 'task'
		Send-ToConductor $t 'plan'
		Add-Log $t 'conductor' $(if ($auto) { "Queued by Rocco: the update is less than $($calendar.lead) days away." } else { 'Queued from Updates.' })
		Save-Task $t
		$card.eventText = "Queued ($($t.id))"
		$text = Set-CardInText $text $card
		$queued += [pscustomobject]@{ id = $card.id; title = $card.title; task = $t.id }
	}
	if (-not $queued) { return [pscustomobject]@{ queued = @(); saved = $null } }
	$names = ($queued | ForEach-Object { $_.title }) -join ', '
	[pscustomobject]@{ queued = $queued; saved = (Save-Calendar $text "Calendar: game page event queued for $names") }
}

# Cards close enough to need their event, and still without one.
function Get-DueCards($calendar) {
	if ($calendar.lead -le 0) { return @() }
	$today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
	$until = (Get-Date).ToUniversalTime().AddDays($calendar.lead).ToString('yyyy-MM-dd')
	@($calendar.cards | Where-Object { $_.event -eq 'notyet' -and $_.date -and $_.date -ge $today -and $_.date -le $until })
}

# Rocco queues due events by itself: when Updates loads, and on the Workboard's polling at most every half hour.
$script:AutoAt = @{}
function Invoke-UpdateAuto([bool]$force) {
	$last = $script:AutoAt[$RepoDir]
	if (-not $force -and $last -and ((Get-Date) - $last).TotalMinutes -lt 30) { return $null }
	$script:AutoAt[$RepoDir] = Get-Date
	if ("$(Invoke-Git $RepoDir rev-parse --abbrev-ref HEAD)" -ne 'main') { return $null }
	$due = @(Get-DueCards (Read-Calendar))
	if (-not $due) { return $null }
	try { Add-EventTasks @($due | ForEach-Object { $_.id }) $true } catch { $null }
}

# How far ahead Rocco queues events: a number of days, or 0 for never. A line near the top of CALENDAR.md.
function Set-AutoLead([int]$days) {
	if ($days -lt 0 -or $days -gt 90) { throw 'Between 0 (never) and 90 days.' }
	$text = Read-CalendarText
	$line = "**Auto-queue game page events:** $(if ($days) { "$days days ahead" } else { 'off' })"
	if ($text -match '(?m)^\*\*Auto-queue game page events:\*\*.*$') { $text = $text -replace '(?m)^\*\*Auto-queue game page events:\*\*.*$', $line }
	else {
		$heading = [regex]::Match($text, '(?m)^## ')
		$text = if ($heading.Success) { $text.Insert($heading.Index, "$line`n`n") } else { $text.TrimEnd() + "`n`n$line`n" }
	}
	[pscustomobject]@{ saved = (Save-Calendar $text "Calendar: auto-queue game page events $(if ($days) { "$days days ahead" } else { 'off' })") }
}

# Card images the agent made for an update's event, waiting for the user to pick one: ..\art\generated\events\<card id>\.
function Get-CardCandidates([string]$id) {
	$dir = Join-Path $Root "art\generated\events\$id"
	if (-not (Test-Path $dir)) { return @() }
	@(Get-ChildItem $dir -File | Where-Object { $_.Extension -in '.png', '.jpg', '.jpeg', '.webp' } | Sort-Object Name | ForEach-Object { "events/$id/$($_.Name)" })
}

# The Updates view: the cards, the game page's events, and each card's event as Roblox has it. Rocco queues due events
# first, so they show as queued straight away.
function Get-Updates([bool]$refresh) {
	$auto = Invoke-UpdateAuto $true
	$calendar = Read-Calendar
	$universe = Get-UniverseId
	$roblox = [pscustomobject]@{ universe = $universe; linked = [bool](Get-RobloxKey); loading = $false; source = ''; access = ''; error = ''; events = @() }
	if ($universe) {
		$data = Get-RobloxData 'events' $EventsJob @($universe, (Get-RobloxKey)) $refresh 5
		$roblox.loading = $data.loading
		if ($data.value) { $roblox.source = "$($data.value.source)"; $roblox.access = "$($data.value.access)"; $roblox.error = "$($data.value.error)"; $roblox.events = @($data.value.events) }
	}
	$now = (Get-Date).ToUniversalTime()
	$cards = @($calendar.cards | ForEach-Object {
		$c = $_
		$e = if ($c.eventId) { @($roblox.events | Where-Object { "$($_.id)" -eq $c.eventId })[0] } else { $null }
		$state = $c.event
		if ($e) {
			$state = if ($e.visibility -ne 'public') { 'drafted' } elseif ($e.start -and ([datetime]$e.start).ToUniversalTime() -gt $now) { 'scheduled' } elseif ($e.end -and ([datetime]$e.end).ToUniversalTime() -lt $now) { 'over' } else { 'live' }
		}
		[pscustomobject]@{ id = $c.id; title = $c.title; date = $c.date; time = $c.time; kind = $c.kind; notes = $c.notes; event = $state; task = $c.task
			eventId = $c.eventId; onRoblox = [bool]$e; image = $c.image; candidates = @(Get-CardCandidates $c.id) }
	})
	[pscustomobject]@{ file = $CalendarFile; exists = $calendar.exists; lead = $calendar.lead; cards = $cards; roblox = $roblox; auto = $auto }
}

# The user's pick of an update's card image: kept on the card, and passed to the agent's task if it's still open.
function Set-CardImage([string]$id, [string]$image) {
	if ($image -notmatch "^events/$([regex]::Escape($id))/[\w .-]+\.(png|jpe?g|webp)$" -or $image -match '\.\.') { throw 'Not one of this update''s card images.' }
	$calendar = Read-Calendar
	$card = @($calendar.cards | Where-Object { $_.id -eq $id })[0]
	if (-not $card) { throw "There's no update '$id' in $CalendarFile." }
	$path = "..\art\generated\$($image -replace '/', '\')"
	$card.fields['Card image'] = "``$path``"
	$saved = Save-Calendar (Set-CardInText $calendar.text $card) "Calendar: card image for $($card.title)"
	if ($card.task) {
		try {
			$t = Read-Task $card.task
			if ($t.status -notin 'done', 'removed') { Invoke-TaskAction $card.task 'followup' "The card image for the event: $path" }
		} catch { }
	}
	[pscustomobject]@{ saved = $saved }
}

# Publishing a draft event: the user's click. The card says so too, for the agent and other PCs.
function Publish-UpdateEvent([string]$eventId) {
	Publish-GameEvent $eventId
	$calendar = Read-Calendar
	$card = @($calendar.cards | Where-Object { $_.eventId -eq $eventId })[0]
	$saved = $null
	if ($card) {
		$card.eventText = 'Scheduled'
		$saved = Save-Calendar (Set-CardInText $calendar.text $card) "Calendar: $($card.title)'s game page event published"
	}
	[pscustomobject]@{ published = $true; saved = $saved }
}
