# Roblox (the template's docs/workflow/RELEASING.md "Game page"): the game page's events and thumbnails, and their
# numbers. What Roblox makes public needs no key. The user's Open Cloud API key, linked in Connections and kept as
# ROBLOX_API_KEY in their environment (where the agent's tools read it too), adds private draft events, publishing
# them, and the thumbnails' analytics. Most of these APIs are experimental or beta at Roblox, so every call expects to
# fail now and then, and a failure only leaves that part out.

$RobloxKeyName = 'ROBLOX_API_KEY'
$script:RobloxLink = $null   # the last link or check: linked, hint (last 4), note
$script:RobloxAt = [datetime]::MinValue
$script:RobloxData = @{}     # "<what>|<universe>" -> @{ Job; At; Value }

function Get-RobloxKey {
	$key = [Environment]::GetEnvironmentVariable($RobloxKeyName, 'User')
	if ($key) { $key } else { $env:ROBLOX_API_KEY }
}

# The game's experience (universe) id, from PROJECT.md's Roblox row. '' until the experience exists.
function Get-UniverseId {
	if ((Get-ProjectField 'Roblox') -match '(?i)universe\)?\s*`?(\d{4,})') { $Matches[1] } else { '' }
}

# A fetch that can take a while runs as a job; until it's done, callers get the last result and loading = true.
function Get-RobloxData([string]$what, [scriptblock]$job, [object[]]$arguments, [bool]$refresh, [int]$minutes = 10) {
	$k = "$what|$($arguments[0])"
	$e = $script:RobloxData[$k]
	if (-not $e) { $e = @{ Job = $null; At = [datetime]::MinValue; Value = $null }; $script:RobloxData[$k] = $e }
	if ($e.Job -and $e.Job.State -ne 'Running') {
		$json = Receive-Job $e.Job -ErrorAction SilentlyContinue | Select-Object -Last 1
		Remove-Job $e.Job -Force
		$e.Job = $null
		$e.At = Get-Date
		$e.Value = if ($json) { try { $json | ConvertFrom-Json } catch { $null } } else { $null }
	}
	if (-not $e.Job -and ($refresh -or ((Get-Date) - $e.At).TotalMinutes -gt $minutes)) { $e.Job = Start-Job -ScriptBlock $job -ArgumentList $arguments }
	[pscustomobject]@{ loading = [bool]$e.Job; at = $(if ($e.At -gt [datetime]::MinValue) { $e.At.ToString('o') } else { $null }); value = $e.Value }
}

# The game page's live and upcoming events: Open Cloud with the key (drafts too), else Roblox's public list. Each with
# its card image and, for public ones, how many players said they'd come.
$EventsJob = {
	param([string]$universe, [string]$key)
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	$out = @{ events = @(); source = ''; access = ''; error = '' }
	function Code($err) { try { [int]$err.Exception.Response.StatusCode } catch { 0 } }
	$list = $null
	if ($key) {
		try {
			$r = Invoke-RestMethod "https://apis.roblox.com/virtual-events/v3/universes/$universe/game-events?pageSize=50" -Headers @{ 'x-api-key' = $key } -TimeoutSec 15 -UseBasicParsing
			$list = @($r.gameEvents | Where-Object { $_ } | ForEach-Object {
				@{ id = "$($_.id)"; title = "$($_.title)"; subtitle = "$($_.subtitle)"; description = "$($_.description)"; start = "$($_.startTime)"; end = "$($_.endTime)"
					visibility = "$($_.visibility)".ToLower(); categories = @($_.categories | ForEach-Object { "$($_.category)" })
					media = "$(@($_.thumbnails | Sort-Object rank | ForEach-Object { $_.mediaId })[0])" }
			})
			$out.source = 'cloud'; $out.access = 'ok'
		} catch { $c = Code $_; $out.access = $(if ($c -eq 401) { 'rejected' } elseif ($c -eq 403) { 'denied' } else { "unreachable ($c)" }) }
	}
	if ($null -eq $list) {
		try {
			$from = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
			$r = Invoke-RestMethod "https://apis.roblox.com/virtual-events/v1/universes/$universe/virtual-events?fromUtc=$from" -TimeoutSec 15 -UseBasicParsing
			$list = @($r.data | Where-Object { $_ } | ForEach-Object {
				@{ id = "$($_.id)"; title = "$($_.title)"; subtitle = "$($_.subtitle)"; description = "$($_.description)"; start = "$($_.eventTime.startUtc)"; end = "$($_.eventTime.endUtc)"
					visibility = "$($_.eventVisibility)".ToLower(); categories = @($_.eventCategories | ForEach-Object { "$($_.category)" })
					media = "$(@($_.thumbnails | Sort-Object rank | ForEach-Object { $_.mediaId })[0])" }
			})
			$out.source = 'public'
		} catch { $out.error = 'Couldn''t read the game page''s events from Roblox.'; $list = @() }
	}
	$ids = @($list | ForEach-Object { $_.media } | Where-Object { $_ } | Select-Object -Unique)
	$urls = @{}
	if ($ids) {
		try { foreach ($t in (Invoke-RestMethod "https://thumbnails.roblox.com/v1/assets?assetIds=$($ids -join ',')&size=768x432&format=Png" -TimeoutSec 10 -UseBasicParsing).data) { $urls["$($t.targetId)"] = "$($t.imageUrl)" } } catch { }
	}
	foreach ($e in $list) {
		$e.image = $(if ($e.media) { $urls[$e.media] } else { '' })
		$e.url = "https://www.roblox.com/events/$($e.id)"
		if ($e.visibility -eq 'public') {
			try { $c = (Invoke-RestMethod "https://apis.roblox.com/virtual-events/v1/virtual-events/$($e.id)/rsvps/counters" -TimeoutSec 6 -UseBasicParsing).counters; $e.interested = [int]$c.going + [int]$c.maybeGoing } catch { }
		}
	}
	$out.events = @($list | Sort-Object { $_.start })
	$out | ConvertTo-Json -Depth 6 -Compress
}

# The game page's thumbnails, in order, and with the key, each one's numbers for the last 7 days (Analytics Query API):
# impressions, qualified plays, and qualified play-through rate. Roblox may report thumbnails the page no longer has
# (or home page ones): those come back as "other".
$ThumbsJob = {
	param([string]$universe, [string]$key)
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	$out = @{ thumbnails = @(); other = @(); access = ''; error = ''; statsError = ''; days = 7 }
	function Code($err) { try { [int]$err.Exception.Response.StatusCode } catch { 0 } }
	try {
		$media = @((Invoke-RestMethod "https://games.roblox.com/v2/games/$universe/media" -TimeoutSec 15 -UseBasicParsing).data | Where-Object { $_.assetType -eq 'Image' })
	} catch { $out.error = 'Couldn''t read the game page''s thumbnails from Roblox.'; return ($out | ConvertTo-Json -Depth 6 -Compress) }
	$urls = @{}
	$ids = @($media | ForEach-Object { "$($_.imageId)" })
	if ($ids) {
		try { foreach ($t in (Invoke-RestMethod "https://thumbnails.roblox.com/v1/assets?assetIds=$($ids -join ',')&size=768x432&format=Png" -TimeoutSec 10 -UseBasicParsing).data) { $urls["$($t.targetId)"] = "$($t.imageUrl)" } } catch { }
	}
	$rank = 0
	$thumbs = @($media | ForEach-Object { $rank++; @{ id = "$($_.imageId)"; rank = $rank; approved = [bool]$_.approved; altText = "$($_.altText)"; image = $urls["$($_.imageId)"] } })

	if ($key) {
		$end = (Get-Date).ToUniversalTime().Date
		$body = @{ granularity = 'OneDay'; startTime = $end.AddDays(-$out.days).ToString('yyyy-MM-ddTHH:mm:ssZ'); endTime = $end.ToString('yyyy-MM-ddTHH:mm:ssZ'); breakdown = @('ThumbnailAsset') }
		$stats = @{}
		foreach ($metric in 'ThumbnailImpressions', 'ThumbnailQualifiedPlays', 'ThumbnailQualifiedPTR') {
			try {
				$body.metric = $metric
				$r = Invoke-RestMethod "https://apis.roblox.com/analytics-query-api/v1/universes/$universe/metrics" -Method Post -Headers @{ 'x-api-key' = $key } -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 20 -UseBasicParsing
				# A big query comes back pending: ask for its result until it's done.
				for ($i = 0; $i -lt 20 -and -not $r.done -and $r.path; $i++) {
					Start-Sleep -Milliseconds 1500
					$path = "$($r.path)".TrimStart('/')
					$url = if ($path -like 'analytics-query-api/*') { "https://apis.roblox.com/$path" } else { "https://apis.roblox.com/analytics-query-api/$path" }
					$r = Invoke-RestMethod $url -Headers @{ 'x-api-key' = $key } -TimeoutSec 20 -UseBasicParsing
				}
				if (-not $r.done) { $out.statsError = 'Roblox took too long to answer.'; continue }
				$out.access = 'ok'
				foreach ($series in @($r.response.values)) {
					$b = @($series.breakdowns)[0]
					$asset = "$($b.value)"
					if (-not $stats[$asset]) { $stats[$asset] = @{ asset = $asset; label = "$(if ($b.displayValue) { $b.displayValue } else { $b.value })" } }
					$points = @($series.dataPoints | ForEach-Object { [double]$_.value })
					$stats[$asset][$metric] = $(if ($metric -eq 'ThumbnailQualifiedPTR') { if ($points) { ($points | Measure-Object -Average).Average } else { $null } } else { ($points | Measure-Object -Sum).Sum })
				}
			} catch {
				$c = Code $_
				$out.access = $(if ($c -eq 401) { 'rejected' } elseif ($c -eq 403) { 'denied' } else { $out.access })
				$out.statsError = $(if ($c -in 401, 403) { 'The key can''t read this game''s analytics.' } else { "Roblox's analytics didn't answer ($c)." })
				break
			}
		}
		foreach ($s in $stats.Values) {
			$n = @{ impressions = $s['ThumbnailImpressions']; plays = $s['ThumbnailQualifiedPlays']; ptr = $s['ThumbnailQualifiedPTR'] }
			if ($n.impressions -and $n.plays -ne $null -and $n.ptr -eq $null) { $n.ptr = $n.plays / $n.impressions }
			$digits = if ($s.asset -match '(\d{5,})') { $Matches[1] } else { $s.asset }
			$t = @($thumbs | Where-Object { $_.id -eq $digits })[0]
			if ($t) { $t.stats = $n } else { $out.other += @{ asset = $s.asset; label = $s.label; stats = $n } }
		}
	}
	$out.thumbnails = $thumbs
	$out | ConvertTo-Json -Depth 6 -Compress
}

# What's linked and what the last fetches said the key may do, for Connections.
function Get-RobloxItem {
	$key = Get-RobloxKey
	$hint = if ($key) { $key.Substring([Math]::Max(0, $key.Length - 4)) } else { '' }
	$universe = Get-UniverseId
	$access = @()
	foreach ($what in 'events', 'thumbs') {
		$v = $script:RobloxData["$what|$universe"].Value
		if ($v -and $v.access) { $access += @{ what = $what; access = "$($v.access)" } }
	}
	$why = 'Link your Roblox Open Cloud key in its details, for draft game page events, publishing them, and thumbnail numbers (RELEASING.md "Game page").'
	$item = if (-not $key) {
		Conn 'Roblox' 'Roblox Open Cloud' 'off' '' '' 'Not linked: Updates and Thumbnails show only what Roblox makes public.' $why ''
	} elseif (@($access | Where-Object { $_.access -eq 'rejected' }).Count) {
		Conn 'Roblox' 'Roblox Open Cloud' 'warn' '' '' 'Roblox doesn''t accept the linked key any more (keys stop working after 60 days unused).' 'Make a new key and link it in its details.' ''
	} elseif (@($access | Where-Object { $_.access -eq 'denied' }).Count) {
		$names = @($access | Where-Object { $_.access -eq 'denied' } | ForEach-Object { @{ events = 'its events'; thumbs = 'its analytics' }[$_.what] }) -join ' or '
		Conn 'Roblox' 'Roblox Open Cloud' 'warn' '' '' "Linked, but the key can't read this game's $names." 'Edit the key on the Creator Hub: add this experience, with the permissions in the key''s details here.' ''
	} else {
		Conn 'Roblox' 'Roblox Open Cloud' 'ok' '' '' $(if ($universe) { 'Linked.' } else { 'Linked. Add the game''s universe id to PROJECT.md to use it.' }) '' ''
	}
	$item | Add-Member link 'roblox'
	$item | Add-Member linked ([bool]$key)
	$item | Add-Member hint $hint
	$item
}

# A key is checked with this game's events when there's a game to check it on; a key Roblox rejects isn't kept.
function Connect-Roblox([string]$key) {
	$key = "$key".Trim()
	if (-not $key -or $key.Length -gt 2000 -or $key -match '\s') { throw 'That doesn''t look like a Roblox Open Cloud API key.' }
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	$universe = Get-UniverseId
	$note = ''
	if ($universe) {
		try { Invoke-RestMethod "https://apis.roblox.com/virtual-events/v3/universes/$universe/game-events?pageSize=1" -Headers @{ 'x-api-key' = $key } -TimeoutSec 10 -UseBasicParsing | Out-Null }
		catch {
			$code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
			if ($code -eq 401) { throw 'Roblox didn''t accept that key.' }
			elseif ($code -eq 403) { $note = "Linked, but it can't read this game's events yet: add the experience and the permissions to the key." }
			else { $note = 'Linked. Roblox couldn''t be reached to check it.' }
		}
	} else { $note = 'Linked. Add the game''s universe id to PROJECT.md, and Rocco checks it then.' }
	[Environment]::SetEnvironmentVariable($RobloxKeyName, $key, 'User')
	$env:ROBLOX_API_KEY = $key
	$script:RobloxData = @{}
	[pscustomobject]@{ note = $note }
}

function Disconnect-Roblox {
	[Environment]::SetEnvironmentVariable($RobloxKeyName, $null, 'User')
	Remove-Item Env:ROBLOX_API_KEY -ErrorAction SilentlyContinue
	$script:RobloxData = @{}
}

# A draft (private) event onto the game page: the user's click in Updates, with their key.
function Publish-GameEvent([string]$id) {
	if ($id -notmatch '^\d+$') { throw 'Not an event id.' }
	$key = Get-RobloxKey
	if (-not $key) { throw 'Link your Roblox Open Cloud key in Connections first, or publish it on the Creator Hub.' }
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	try {
		Invoke-RestMethod "https://apis.roblox.com/virtual-events/v3/game-events/$id" -Method Patch -Headers @{ 'x-api-key' = $key } -ContentType 'application/json' -Body '{"visibility":"public"}' -TimeoutSec 15 -UseBasicParsing | Out-Null
	} catch {
		$code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
		$detail = "$($_.ErrorDetails.Message)"
		throw $(if ($code -eq 403) { 'The key can''t change this game''s events: give it write access to them, or publish it on the Creator Hub.' } else { "Roblox didn't publish it ($code)$(if ($detail) { ": $detail" }). Publish it on the Creator Hub instead." })
	}
	$universe = Get-UniverseId
	if ($universe) { $script:RobloxData.Remove("events|$universe") }
}
