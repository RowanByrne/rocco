# Connections: this project's links (checked every time, they're cheap) and the tools on this PC
# (slow, so checked in a background job while the app shows the last result).

function Conn([string]$group, [string]$name, [string]$status, [string]$version, [string]$latest, [string]$detail, [string]$update, [string]$command) {
	[pscustomobject]@{ group = $group; name = $name; status = $status; version = $version; latest = $latest; detail = $detail; update = $update; command = $command }
}

# ---- Template releases (the template's docs/workflow/TEMPLATE.md) ----
# A game takes the template only as releases, tags named template/vX.Y.Z. Their tags are fetched in the background
# every half hour, so the Template row says when a newer one is out; the conductor brings it in.

$script:TemplateFetch = @{}   # repo -> @{ At; Job }
function Update-TemplateTags([bool]$refresh) {
	$f = $script:TemplateFetch[$RepoDir]
	if ($f -and $f.Job -and $f.Job.State -ne 'Running') { Remove-Job $f.Job -Force; $f.Job = $null }
	if ($f -and ($f.Job -or (-not $refresh -and ((Get-Date) - $f.At).TotalMinutes -lt 30))) { return }
	# Git's messages are caught here: anything a job's programs write to stderr fails the job.
	$job = Start-Job -ArgumentList $RepoDir -ScriptBlock {
		param([string]$repo)
		$env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
		git -C $repo fetch --quiet --tags --force template 2>&1 | Out-Null
	}
	$script:TemplateFetch[$RepoDir] = @{ At = Get-Date; Job = $job }
}
function Test-TemplateFetching { $f = $script:TemplateFetch[$RepoDir]; [bool]($f -and $f.Job -and $f.Job.State -eq 'Running') }

function Get-TemplateConnection([bool]$refresh) {
	$releases = @(Invoke-Git $RepoDir tag -l 'template/v*' --sort=-v:refname)
	$short = @($releases | ForEach-Object { $_ -replace '^template/', '' })
	if ((Get-ProjectField 'Game') -like '*{{*') {
		if (-not $releases) { return Conn 'Project' 'Template' 'ok' '' '' 'This is the template every game is copied from. Not released yet.' 'To release it, say "release the template" (TEMPLATE.md).' '' }
		$since = [int](Invoke-Git $RepoDir rev-list --count "$($releases[0])..main")
		$detail = "This is the template every game is copied from. Released as $($short[0])$(if ($since) { "; $since commit$(if ($since -ne 1) { 's' }) on main since" })."
		return Conn 'Project' 'Template' 'ok' $short[0] '' $detail $(if ($since) { 'Games get them in the next release: say "release the template" (TEMPLATE.md).' } else { '' }) ''
	}
	if (-not (Invoke-Git $RepoDir remote get-url template)) {
		return Conn 'Project' 'Template' 'warn' '' '' 'No template remote, so this game can''t take template updates.' 'Add it in repo\:' 'git remote add template https://github.com/RowanByrne/rodev_template.git'
	}
	Update-TemplateTags $refresh
	if (-not $releases) { return Conn 'Project' 'Template' 'ok' '' '' 'The template has no releases yet (as of the last check).' '' '' }
	$current = "$(Invoke-Git $RepoDir describe --tags --abbrev=0 --match 'template/v*' main)" -replace '^template/', ''
	# Releases this game doesn't have yet, newest first.
	$newer = @($releases | Where-Object { -not (Invoke-GitText $RepoDir merge-base --is-ancestor $_ main).ok })
	if (-not $newer) { return Conn 'Project' 'Template' 'ok' $current $short[0] "On the newest template release, $($short[0]) (as of the last check)." '' '' }
	$notes = @($newer | Select-Object -First 5 | ForEach-Object { "$($_ -replace '^template/', '')`n$((@(Invoke-Git $RepoDir tag -l $_ '--format=%(contents)') -join "`n").Trim())" }) -join "`n`n"
	$item = Conn 'Project' 'Template' 'update' $current $short[0] "Template $($short[0]) is out; this game is on $(if ($current) { $current } else { 'an earlier version' })." 'Ask Claude to bring it in: it merges the release and keeps this game''s own docs (TEMPLATE.md).' ''
	$item | Add-Member release ([pscustomobject]@{ tag = $releases[0]; notes = $notes; action = 'ask' })
	$item
}

# The template, GitHub, the commit check, and this project's Lync servers.
function Get-ProjectConnections([bool]$refresh) {
	Get-TemplateConnection $refresh

	$origin = Invoke-Git $RepoDir remote get-url origin
	if (-not $origin) {
		Conn 'Project' 'GitHub' 'warn' '' '' 'No GitHub repo yet, so nothing is backed up.' 'Create an empty private repo, then in repo\ add it and push (NEW-PROJECT.md):' 'git remote add origin <url>'
	} else {
		$ahead = [int](Invoke-Git $RepoDir rev-list --count origin/main..main)
		$name = "$origin" -replace '^(https://github\.com/|git@github\.com:)', '' -replace '\.git$', ''
		if ($ahead) { Conn 'Project' 'GitHub' 'warn' '' '' "$name $Dot $ahead commits on main not pushed." 'Push main, or say "refresh" to the conductor.' '' }
		else { Conn 'Project' 'GitHub' 'ok' '' '' $name '' '' }
	}

	if ("$(Invoke-Git $RepoDir config core.hooksPath)" -eq 'tools/hooks') { Conn 'Project' 'Commit check' 'ok' '' '' 'Refuses files over 5 MB.' '' '' }
	else { Conn 'Project' 'Commit check' 'warn' '' '' 'Off: big files can get into git.' 'Turn it on in repo\:' 'git config core.hooksPath tools/hooks' }

	$lanes = Get-Lanes
	if ($lanes.main) {
		$open = @($lanes.open).Count
		Conn 'Project' 'Studio sync' 'ok' '' '' "Lync is serving Main$(if ($open) { " and $open lane$(if ($open -ne 1) { 's' })" })." '' ''
	} else {
		Conn 'Project' 'Studio sync' 'off' '' '' 'Lync isn''t serving, so Studio isn''t syncing.' 'Run tools\serve-all.bat.' ''
	}
}

# ---- Libraries the game vendors (CODING.md "Third-party code") ----
# The record is ARCHITECTURE.md "Vendored libraries". Libraries most games use are also found in src/ by their folder,
# with the version their own files declare, so one that was never recorded, or recorded wrong, shows up.

$KnownLibraries = @{
	TopbarPlus = @{ repo = '1ForeverHD/TopbarPlus'; file = 'VERSION.lua'; pattern = 'appVersion\s*=\s*"([^"]+)"' }
	Cmdr       = @{ repo = 'evaera/Cmdr'; file = 'BuiltInCommands\Debug\version.lua'; pattern = 'local version\s*=\s*"([^"]+)"' }
}
$script:LibLatest = @{}   # GitHub repo -> @{ tag; at }
$script:LibJob = $null

# Latest releases on GitHub, as a job: the API is slow next to everything else here.
$CheckReleases = {
	param([string[]]$repos)
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	foreach ($repo in $repos) {
		try { [pscustomobject]@{ repo = $repo; tag = "$((Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -TimeoutSec 5 -UseBasicParsing).tag_name)" } }
		catch { [pscustomobject]@{ repo = $repo; tag = '' } }
	}
}

function Get-VersionText([string]$text) { if ($text -match '\d+\.\d+(\.\d+)?') { $Matches[0] } else { '' } }
function Test-Newer([string]$latest, [string]$installed) {
	try { [version](Get-VersionText $latest) -gt [version](Get-VersionText $installed) } catch { $false }
}

function Get-RecordedLibraries {
	$file = Join-Path $RepoDir 'docs\game\ARCHITECTURE.md'
	if (-not (Test-Path $file)) { return }
	$inTable = $false
	foreach ($line in [IO.File]::ReadAllLines($file)) {
		if ($line -match '^## ') { $inTable = $line -match '^## Vendored libraries'; continue }
		if (-not $inTable -or $line -notmatch '^\|') { continue }
		$cells = @(($line.Trim().Trim('|') -split '\|') | ForEach-Object { $_.Trim().Trim('`').Trim() })
		if ($cells.Count -lt 4 -or -not $cells[0] -or $cells[0] -eq 'Library' -or $cells[0] -match '^-+$') { continue }
		[pscustomobject]@{ name = $cells[0]; version = $cells[1]; source = $cells[2]; patches = $cells[3] }
	}
}

function Find-Library([string]$name) {
	$known = $KnownLibraries[$name]
	$src = Join-Path $RepoDir 'src'
	if (-not $known -or -not (Test-Path $src)) { return $null }
	$dir = Get-ChildItem $src -Recurse -Directory -Filter $name -ErrorAction SilentlyContinue | Select-Object -First 1
	if (-not $dir) { return $null }
	$file = Join-Path $dir.FullName $known.file
	$version = if ((Test-Path $file) -and ([IO.File]::ReadAllText($file) -match $known.pattern)) { $Matches[1] } else { '' }
	[pscustomobject]@{ path = ($dir.FullName.Substring($RepoDir.Length + 1) -replace '\\', '/'); version = $version }
}

function Get-LibraryConnections([bool]$refresh) {
	if ($script:LibJob -and $script:LibJob.State -ne 'Running') {
		foreach ($r in @(Receive-Job $script:LibJob -ErrorAction SilentlyContinue)) {
			# A failed check is tried again in half an hour, not six.
			if ($r.repo) { $script:LibLatest[$r.repo] = @{ tag = "$($r.tag)"; at = $(if ($r.tag) { Get-Date } else { (Get-Date).AddHours(-5.5) }) } }
		}
		Remove-Job $script:LibJob -Force
		$script:LibJob = $null
	}
	$libs = [ordered]@{}
	foreach ($r in @(Get-RecordedLibraries)) { $libs[$r.name] = @{ name = $r.name; version = $r.version; source = $r.source; patches = $r.patches; recorded = $true } }
	foreach ($name in $KnownLibraries.Keys) {
		$found = Find-Library $name
		if (-not $found) { continue }
		if (-not $libs.Contains($name)) { $libs[$name] = @{ name = $name; version = ''; source = "github.com/$($KnownLibraries[$name].repo)"; patches = ''; recorded = $false } }
		$libs[$name].found = $found
	}
	$stale = @()
	$items = foreach ($l in $libs.Values) {
		$repo = if ("$($l.source)" -match 'github\.com/([\w.-]+/[\w.-]+)') { $Matches[1] -replace '\.git$', '' } elseif ($KnownLibraries[$l.name]) { $KnownLibraries[$l.name].repo } else { '' }
		$cached = if ($repo) { $script:LibLatest[$repo] } else { $null }
		if ($repo -and ($refresh -or -not $cached -or ((Get-Date) - $cached.at).TotalHours -gt 6)) { $stale += $repo }
		$latest = if ($cached) { $cached.tag } else { '' }
		$version = if ($l.version) { $l.version } elseif ($l.found) { $l.found.version } else { '' }
		$patched = if ($l.patches -and $l.patches -notmatch '^(none|no|-)$') { "local patches: $($l.patches)" } else { 'no local patches' }
		$detail = "$(if ($repo) { "github.com/$repo" } else { $l.source }) $Dot $patched"
		if (-not $l.recorded) {
			Conn 'Libraries' $l.name 'warn' $version $latest "In $($l.found.path), but not in ARCHITECTURE.md." 'Record its version, source and local patches in ARCHITECTURE.md "Vendored libraries" (CODING.md).' ''
		} elseif ($l.found -and $l.found.version -and $l.version -and (Get-VersionText $l.found.version) -ne (Get-VersionText $l.version)) {
			Conn 'Libraries' $l.name 'warn' $l.found.version $latest "ARCHITECTURE.md says $($l.version), but src has $($l.found.version)." 'Correct the version in ARCHITECTURE.md "Vendored libraries".' ''
		} elseif ($latest -and (Test-Newer $latest $version)) {
			Conn 'Libraries' $l.name 'update' $version $latest $detail 'Ask the conductor to update it: vendor the new release, re-apply any local patches, and update ARCHITECTURE.md (CODING.md "Third-party code").' ''
		} else {
			Conn 'Libraries' $l.name 'ok' $version $latest $detail '' ''
		}
	}
	if ($stale -and -not $script:LibJob) { $script:LibJob = Start-Job -ScriptBlock $CheckReleases -ArgumentList (, [string[]]@($stale | Select-Object -Unique)) }
	@($items)
}

# Everything installed on this PC, against the latest versions online. Runs as a job, so it can't
# use anything defined outside this block.
$CheckPc = {
	param([string]$roDev, [string]$roccoDir)
	$ErrorActionPreference = 'SilentlyContinue'
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	$net = @{ up = $true }
	function Latest([string]$url) {
		if (-not $net.up) { return $null }
		try { Invoke-RestMethod $url -TimeoutSec 5 -UseBasicParsing } catch { $net.up = $false; $null }
	}
	function Run([string]$exe, [string]$arguments) {
		try {
			$psi = New-Object Diagnostics.ProcessStartInfo $exe, $arguments
			$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardInput = $true; $psi.CreateNoWindow = $true
			$p = [Diagnostics.Process]::Start($psi)
			$p.StandardInput.Close() # some programs (git) wait on an inherited input until killed
			$out = $p.StandardOutput.ReadToEndAsync()
			if (-not $p.WaitForExit(8000)) { $p.Kill(); return '' }
			$out.Result
		} catch { '' }
	}
	function Ver([string]$text) { if ($text -match '\d+\.\d+(\.\d+)?') { $Matches[0] } else { '' } }
	function Newer([string]$latest, [string]$installed) { try { [version](Ver $latest) -gt [version](Ver $installed) } catch { $false } }
	function Item([string]$group, [string]$name, [string]$status, [string]$version, [string]$latest, [string]$detail, [string]$update, [string]$command) {
		[pscustomobject]@{ group = $group; name = $name; status = $status; version = $version; latest = $latest; detail = $detail; update = $update; command = $command }
	}
	function Status([string]$installed, [string]$latest) { if (-not $installed) { 'missing' } elseif ($latest -and (Newer $latest $installed)) { 'update' } else { 'ok' } }
	$claudeConfig = Join-Path $env:USERPROFILE '.claude.json'
	$claudeText = if (Test-Path $claudeConfig) { [IO.File]::ReadAllText($claudeConfig) } else { '' }

	$items = @()

	# Claude Code: on PATH, or the copy the Claude desktop app keeps.
	$version = ''; $how = ''; $cmd = ''
	if (Get-Command claude) { $version = Ver (Run 'cmd.exe' '/d /c claude --version'); $how = 'Update it:'; $cmd = 'claude update' }
	$appDir = Join-Path $env:APPDATA 'Claude\claude-code'
	if (-not $version -and (Test-Path $appDir)) {
		$version = (Get-ChildItem $appDir -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).Name
		$how = 'It updates with the Claude app: restart the app.'
	}
	$latest = (Latest 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest').version
	$account = if ($claudeText -match '"oauthAccount"\s*:\s*\{[^}]*?"emailAddress"\s*:\s*"([^"]+)"') { $Matches[1] } else { '' }
	$items += Item 'AI' 'Claude Code' (Status $version $latest) $version $latest $(if ($account) { "Signed in as $account" } else { 'Not signed in' }) $how $cmd

	# Codex: makes the images (tools\imagegen.ps1).
	$codex = (Get-Command codex | Select-Object -First 1).Source; $how = 'Update it:'; $cmd = 'npm install -g @openai/codex@latest'
	if (-not $codex) {
		$exe = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Recurse -Filter codex.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
		if ($exe) { $codex = $exe.FullName; $how = 'It updates with the Codex app: restart the app.'; $cmd = '' }
	}
	$version = if ($codex) { Ver (Run 'cmd.exe' "/d /c `"$codex`" --version") } else { '' }
	$latest = (Latest 'https://registry.npmjs.org/@openai/codex/latest').version
	$signedIn = Test-Path (Join-Path $env:USERPROFILE '.codex\auth.json')
	$detail = if (-not $codex) { 'Not installed: images can''t be made on this PC.' } elseif ($signedIn) { "Signed in $([char]0x00B7) makes images" } else { 'Not signed in: open the Codex app and sign in.' }
	$items += Item 'AI' 'Codex' (Status $version $latest) $version $latest $detail $(if ($codex) { $how } else { 'Install the Codex app and sign in (WORKSTATION.md).' }) $cmd

	# Roblox Studio: up to date when the current release is among the installed versions.
	$versions = Join-Path $env:LOCALAPPDATA 'Roblox\Versions'
	$studio = @(Get-ChildItem $versions -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'RobloxStudioBeta.exe') } | Sort-Object LastWriteTime -Descending)
	$version = if ($studio) { ((Get-Item (Join-Path $studio[0].FullName 'RobloxStudioBeta.exe')).VersionInfo.FileVersion -replace ',\s*', '.') -replace '^(\d+\.\d+\.\d+).*', '$1' } else { '' }
	$current = Latest 'https://clientsettings.roblox.com/v2/client-version/WindowsStudio64'
	$status = if (-not $studio) { 'missing' } elseif ($current -and -not ($studio.Name -contains $current.clientVersionUpload)) { 'update' } else { 'ok' }
	$open = @(Get-Process RobloxStudioBeta).Count
	$items += Item 'Roblox' 'Roblox Studio' $status $version $(if ($current) { $current.version -replace '^(\d+\.\d+\.\d+).*', '$1' }) "$(if ($open) { "$open open" } else { 'Not open' })" 'Studio updates itself the next time it opens.' ''

	# The Studio MCP: workers only get Studio tools under this exact name.
	if ($claudeText -match '"Roblox_Studio"\s*:\s*\{') { $items += Item 'Roblox' 'Studio MCP' 'ok' '' '' 'Registered as Roblox_Studio' '' '' }
	else { $items += Item 'Roblox' 'Studio MCP' 'warn' '' '' 'Not registered as Roblox_Studio, so workers get no Studio tools.' 'Register it under that exact name (WORKSTATION.md).' '' }

	# Lync: the RoDev folder's copy. It reports only its major version ("Alpha 30"); releases are 0.<major>.<patch>.
	$lync = Join-Path $roDev '_tools\lync\lync.exe'
	if (-not (Test-Path $lync)) { $lync = (Get-Command lync | Select-Object -First 1).Source }
	$version = ''
	if ($lync -and (Test-Path $lync)) {
		$recorded = Join-Path (Split-Path $lync) 'VERSION'
		if (Test-Path $recorded) { $version = (Get-Content $recorded -Raw).Trim() }
		elseif ([Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($lync)) -match "VERSION = ['""]((Alpha|Beta) [^'""]+)['""]") { $version = $Matches[1] }
	}
	$release = Latest 'https://api.github.com/repos/Iron-Stag-Games/Lync/releases/latest'
	$status = if (-not $version) { 'missing' } elseif (-not $release) { 'ok' }
		elseif ($version -match '^Alpha (\d+)$') { if ($release.tag_name -match "^v?0\.$($Matches[1])\.") { 'ok' } else { 'update' } }
		elseif (Newer $release.tag_name $version) { 'update' } else { 'ok' }
	$items += Item 'Roblox' 'Lync' $status $version $(if ($release) { $release.tag_name }) $(if ($lync) { 'In the RoDev folder''s _tools\lync' } else { 'Not installed' }) 'Download the latest release into _tools\lync (WORKSTATION.md).' ''

	# Studio plugins: the version a plugin declares, against its GitHub releases when it names a repo.
	foreach ($f in Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Roblox\Plugins') -File | Where-Object { $_.Extension -in '.rbxm', '.rbxmx' }) {
		$name = $f.BaseName
		if ($name -eq 'Lync') { $items += Item 'Roblox' 'Lync plugin' 'ok' '' '' 'Lync installs and updates it.' '' ''; continue }
		$text = if ($f.Extension -eq '.rbxmx') { [IO.File]::ReadAllText($f.FullName) } else { '' }
		$version = if ($text -match 'CURRENT_VERSION\s*=\s*"v?(\d+\.\d+(\.\d+)?)"') { $Matches[1] } else { '' }
		$repo = if ($text -match 'available[^\r\n]{0,60}github\.com/([\w.-]+/[\w.-]+)') { $Matches[1] } else { '' }
		$release = if ($repo) { Latest "https://api.github.com/repos/$repo/releases/latest" }
		$status = if ($version -and $release -and (Newer $release.tag_name $version)) { 'update' } else { 'ok' }
		$label = if ($repo) { ($repo -split '/')[1] } else { $name -replace '(?i)\s*plugin$', '' }
		$items += Item 'Roblox' "$label plugin" $status $version $(if ($release) { $release.tag_name -replace '^v', '' }) $(if ($repo) { "github.com/$repo" } else { 'Studio plugin' }) $(if ($repo) { "Get the new version from github.com/$repo/releases." } else { '' }) ''
	}

	# ElevenLabs (AUDIO-PIPELINE.md): the linked key's plan and credits. Read from the user's environment, so a key
	# linked after this server started still counts. Only raw facts here; Get-ElevenLabsItem words them.
	$key = [Environment]::GetEnvironmentVariable('ELEVENLABS_API_KEY', 'User')
	if (-not $key) { $key = $env:ELEVENLABS_API_KEY }
	$eleven = @{ linked = [bool]$key; hint = $(if ($key) { $key.Substring([Math]::Max(0, $key.Length - 4)) } else { '' }) }
	if ($key -and $net.up) {
		try {
			$s = Invoke-RestMethod 'https://api.elevenlabs.io/v1/user/subscription' -Headers @{ 'xi-api-key' = $key } -TimeoutSec 6 -UseBasicParsing
			$eleven.tier = "$($s.tier)"; $eleven.used = $s.character_count; $eleven.limit = $s.character_limit
		} catch {
			$err = $_; $code = 0; try { $code = [int]$err.Exception.Response.StatusCode } catch { }
			$eleven.error = if ($code -eq 401 -and "$($err.ErrorDetails.Message)" -match 'permission') { 'scope' } elseif ($code -eq 401) { 'rejected' } else { 'unreachable' }
		}
	}

	# Rocco itself (README.md "Updating"). A release newer than the installed commit is an update; a development copy,
	# ahead of every release, is never offered an older one. A check in the background never asks anyone to sign in.
	# Git's complaints go to nul: anything this job's programs write to stderr fails the whole job. No ^ in the
	# arguments (cmd eats it), and no quotes nested in quotes (Windows PowerShell drops what follows them).
	$env:GIT_TERMINAL_PROMPT = '0'; $env:GCM_INTERACTIVE = 'never'
	function RoccoGit([string]$arguments) { $out = Run 'cmd.exe' ('/d /c git -C "' + $roccoDir + '" ' + $arguments + ' 2>nul'); "$out".Trim() }
	function RoccoTest([string]$arguments) { (Run 'cmd.exe' ('/d /c git -C "' + $roccoDir + '" ' + $arguments + ' >nul 2>nul && echo yes')) -match 'yes' }
	$installed = RoccoGit 'describe --tags --exact-match --match v* HEAD'
	$onBranch = RoccoGit 'symbolic-ref --short -q HEAD'
	$version = if ($installed) { $installed } else { $onBranch + ' @ ' + (RoccoGit 'rev-parse --short HEAD') }
	$hasOrigin = [bool](RoccoGit 'remote get-url origin')
	$fetched = $hasOrigin -and (RoccoTest 'fetch --tags --force --quiet origin')
	$newest = @((RoccoGit 'tag -l v* --sort=-v:refname') -split '\r?\n')[0]
	$newer = $newest -and $newest -ne $installed -and (RoccoGit 'rev-parse HEAD') -ne (RoccoGit "rev-list -n 1 $newest") -and (RoccoTest "merge-base --is-ancestor HEAD $newest")
	$detail = if ($installed) { 'In the RoDev folder''s _tools\rocco' } else { "Development copy on $(if ($onBranch) { $onBranch } else { 'no branch' })" }
	if ($hasOrigin -and -not $fetched) { $detail += " $([char]0x00B7) couldn't check for updates" }
	$rocco = Item 'Tools' 'Rocco' $(if ($newer) { 'update' } else { 'ok' }) $version $newest $detail $(if ($newer) { "Update it from here, or in _tools\rocco check out $newest and restart Rocco." } else { '' }) ''
	if ($newer) { $rocco | Add-Member release ([pscustomobject]@{ tag = $newest; notes = (RoccoGit "tag -l $newest --format=%(contents)") }) }
	$items += $rocco

	# Git and the GitHub CLI.
	$version = Ver (Run 'cmd.exe' '/d /c git --version')
	$release = Latest 'https://api.github.com/repos/git-for-windows/git/releases/latest'
	$items += Item 'Tools' 'Git' (Status $version $release.tag_name) $version $(Ver $release.tag_name) 'Git for Windows' 'Update it:' 'git update-git-for-windows'
	if (Get-Command gh) {
		$version = Ver (Run 'cmd.exe' '/d /c gh --version')
		$release = Latest 'https://api.github.com/repos/cli/cli/releases/latest'
		$items += Item 'Tools' 'GitHub CLI' (Status $version $release.tag_name) $version $(Ver $release.tag_name) 'gh' 'Update it:' 'winget upgrade GitHub.cli'
	} else {
		$items += Item 'Tools' 'GitHub CLI' 'off' '' '' 'Optional, not installed.' 'Install it if you want Claude to handle GitHub for you:' 'winget install GitHub.cli'
	}

	ConvertTo-Json -InputObject ([pscustomobject]@{ online = $net.up; items = $items; eleven = [pscustomobject]$eleven }) -Depth 4 -Compress
}

# ---- ElevenLabs: linked by the user in Connections, kept as ELEVENLABS_API_KEY in their environment ----

$ElevenKeyName = 'ELEVENLABS_API_KEY'
$script:Eleven = $null      # what the last check or link found: linked, hint (last 4), tier, used, limit, error
$script:ElevenAt = [datetime]::MinValue

function Get-ElevenLabsKey {
	$key = [Environment]::GetEnvironmentVariable($ElevenKeyName, 'User')
	if ($key) { $key } else { $env:ELEVENLABS_API_KEY }
}

function Get-ElevenLabsItem {
	$e = $script:Eleven
	if (-not $e) { $key = Get-ElevenLabsKey; $e = @{ linked = [bool]$key; error = 'checking' } }
	$link = 'Link your ElevenLabs account in its details, to make sound effects and music (AUDIO-PIPELINE.md).'
	$item = if (-not $e.linked) {
		Conn 'AI' 'ElevenLabs' 'off' '' '' 'Not linked: sound effects and music can''t be generated on this PC.' $link ''
	} elseif ($e.error -eq 'rejected') {
		Conn 'AI' 'ElevenLabs' 'warn' '' '' 'ElevenLabs doesn''t accept the linked key any more.' 'Link a new key in its details.' ''
	} elseif ($e.error -eq 'scope') {
		Conn 'AI' 'ElevenLabs' 'ok' '' '' 'Linked. The key can''t read the plan: check it allows commercial use.' '' ''
	} elseif ($e.error -or -not $e.tier) {
		Conn 'AI' 'ElevenLabs' 'ok' '' '' $(if ($e.error -eq 'checking') { 'Linked. Checking the plan...' } else { 'Linked (couldn''t reach ElevenLabs to check the plan).' }) '' ''
	} else {
		$plan = (Get-Culture).TextInfo.ToTitleCase(("$($e.tier)" -replace '_', ' '))
		$credits = if ($e.limit) { " $Dot {0:N0} of {1:N0} credits used" -f [double]$e.used, [double]$e.limit } else { '' }
		if ($e.tier -eq 'free') { Conn 'AI' 'ElevenLabs' 'warn' '' '' "Linked $Dot Free plan$credits" 'The free plan doesn''t allow commercial use: upgrade to Starter or above before making game audio.' '' }
		else { Conn 'AI' 'ElevenLabs' 'ok' '' '' "Linked $Dot $plan plan$credits" '' '' }
	}
	$item | Add-Member link 'elevenlabs'
	$item | Add-Member linked ([bool]$e.linked)
	$item | Add-Member hint "$($e.hint)"
	$item
}

# Check the key with ElevenLabs first; only a key it accepts is kept.
function Connect-ElevenLabs([string]$key) {
	$key = "$key".Trim()
	if (-not $key -or $key.Length -gt 200 -or $key -match '\s') { throw 'That doesn''t look like an ElevenLabs API key.' }
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	$e = @{ linked = $true; hint = $key.Substring([Math]::Max(0, $key.Length - 4)) }
	try {
		$s = Invoke-RestMethod 'https://api.elevenlabs.io/v1/user/subscription' -Headers @{ 'xi-api-key' = $key } -TimeoutSec 8 -UseBasicParsing
		$e.tier = "$($s.tier)"; $e.used = $s.character_count; $e.limit = $s.character_limit
	} catch {
		$err = $_; $code = 0; try { $code = [int]$err.Exception.Response.StatusCode } catch { }
		if ($code -eq 401 -and "$($err.ErrorDetails.Message)" -match 'permission') { $e.error = 'scope' }
		elseif ($code -eq 401) { throw 'ElevenLabs didn''t accept that key.' }
		else { throw 'Couldn''t reach ElevenLabs to check the key. Try again when you''re online.' }
	}
	[Environment]::SetEnvironmentVariable($ElevenKeyName, $key, 'User')
	$env:ELEVENLABS_API_KEY = $key
	$script:Eleven = $e
	$script:ElevenAt = Get-Date
	[pscustomobject]@{ tier = "$($e.tier)" }
}

function Disconnect-ElevenLabs {
	[Environment]::SetEnvironmentVariable($ElevenKeyName, $null, 'User')
	Remove-Item Env:ELEVENLABS_API_KEY -ErrorAction SilentlyContinue
	$script:Eleven = @{ linked = $false }
	$script:ElevenAt = Get-Date
}

# One-click update (README.md "Updating"): this copy moves to a newer release; the server then restarts on it.
function Update-Rocco([string]$tag) {
	if ($tag -notmatch '^v\d+(\.\d+)*$') { throw "Not a Rocco release: '$tag'." }
	if (-not (Invoke-Git $AppDir rev-parse --verify --quiet "refs/tags/$tag")) { throw "There's no release $tag here. Check for updates again." }
	if (@(Invoke-Git $AppDir status --porcelain --untracked-files=no | Where-Object { $_ }).Count) { throw 'Rocco has changes of its own in _tools\rocco, so it won''t update over them.' }
	$here = "$(Invoke-Git $AppDir rev-parse HEAD)"
	$target = "$(Invoke-Git $AppDir rev-list -n 1 $tag)"
	$newer = $here -ne $target -and (Invoke-GitText $AppDir merge-base --is-ancestor HEAD $tag).ok
	if (-not $newer) { throw "$tag isn't newer than this Rocco ($RoccoVersion)." }
	$checkout = Invoke-GitText $AppDir checkout --quiet $tag
	if (-not $checkout.ok) { throw "Couldn't switch to ${tag}: $($checkout.text)" }
	$script:PcResult = $null # the next check reads the new version
}

$script:PcJob = $null
$script:PcStarted = $null
$script:PcResult = $null
function Get-Connections([bool]$refresh) {
	if ($script:PcJob -and $script:PcJob.State -ne 'Running') {
		$json = Receive-Job $script:PcJob -ErrorAction SilentlyContinue | Select-Object -Last 1
		Remove-Job $script:PcJob -Force
		$script:PcJob = $null
		if ($json) {
			$script:PcResult = @{ At = (Now); Value = ($json | ConvertFrom-Json) }
			# A link or unlink after the check started is newer than what the check saw.
			$found = $script:PcResult.Value.eleven
			if ($found -and $script:PcStarted -gt $script:ElevenAt) {
				$script:Eleven = @{}
				foreach ($p in $found.PSObject.Properties) { $script:Eleven[$p.Name] = $p.Value }
			}
		}
	}
	$stale = -not $script:PcResult -or ((Get-Date) - [datetime]$script:PcResult.At).TotalMinutes -gt 30
	if (($refresh -or $stale) -and -not $script:PcJob) { $script:PcStarted = Get-Date; $script:PcJob = Start-Job -ScriptBlock $CheckPc -ArgumentList $RoDev, $AppDir }
	$checkedAt = $null; $online = $true; $pcItems = @()
	if ($script:PcResult) { $checkedAt = $script:PcResult.At; $online = $script:PcResult.Value.online; $pcItems = @($script:PcResult.Value.items) }
	$items = @(@(Get-ProjectConnections $refresh) + @(Get-LibraryConnections $refresh) + $pcItems + @(Get-ElevenLabsItem))
	[pscustomobject]@{ checking = [bool]$script:PcJob -or [bool]$script:LibJob -or (Test-TemplateFetching); checkedAt = $checkedAt; online = $online; items = $items }
}
