# The accounts RoDev runs on, for onboarding's accounts screen (web/src/dialogs/onboarding.js). Nothing is included or
# shared: each AI tool needs the user's own plan, signed in on this PC. Each check asks the tool itself where it can,
# side by side so the screen answers in a second or two. Signing in runs the tool's own login in a window (actions.ps1).

$script:AccountsCache = $null

# A program started without a window, through cmd so npm's shims work. Read-Quick waits for it.
function Start-Quick([string]$exe, [string]$arguments) {
	if (-not $exe) { return $null }
	$info = New-Object Diagnostics.ProcessStartInfo 'cmd.exe', "/d /s /c `"`"$exe`" $arguments`""
	$info.UseShellExecute = $false
	$info.CreateNoWindow = $true
	$info.RedirectStandardOutput = $true
	$info.RedirectStandardError = $true
	try {
		$p = [Diagnostics.Process]::Start($info)
		@{ Process = $p; Out = $p.StandardOutput.ReadToEndAsync(); Err = $p.StandardError.ReadToEndAsync() }
	} catch { $null }
}

# What it printed, and its exit code: -1 when it didn't start or took too long.
function Read-Quick($run, [int]$ms = 8000) {
	$none = @{ out = ''; err = ''; code = -1 }
	if (-not $run) { return $none }
	if (-not $run.Process.WaitForExit($ms)) { try { $run.Process.Kill() } catch { }; return $none }
	@{ out = "$($run.Out.Result)".Trim(); err = "$($run.Err.Result)".Trim(); code = $run.Process.ExitCode }
}

function Get-UserEnv([string]$name) {
	$value = [Environment]::GetEnvironmentVariable($name, 'User')
	if ($value) { $value } else { [Environment]::GetEnvironmentVariable($name, 'Process') }
}

# A program's name when it's on PATH (cmd finds its shim), else where it is.
function Get-AgentCommand([string]$id) {
	if (Get-Command $Agents[$id].exe -ErrorAction SilentlyContinue) { $Agents[$id].exe } else { Find-AgentExe $id }
}

# state: ok (ready), signin (installed, not signed in), expired, missing (not installed), info (nothing to check).
function Account([string]$state, [string]$detail) { [pscustomobject]@{ state = $state; detail = $detail } }

function Get-ClaudeAccount($run) {
	$r = Read-Quick $run
	$config = Join-Path $env:USERPROFILE '.claude.json'
	$email = if ((Test-Path $config) -and ([IO.File]::ReadAllText($config) -match '"oauthAccount"\s*:\s*\{[^}]*?"emailAddress"\s*:\s*"([^"]+)"')) { $Matches[1] } else { '' }
	$status = $null
	try { $status = $r.out | ConvertFrom-Json } catch { }
	if ($status -and $null -ne $status.loggedIn) {
		if ($status.loggedIn) {
			$who = if ($status.email) { $status.email } else { $email }
			$plan = if ($status.subscriptionType) { " ($($status.subscriptionType))" } else { '' }
			return Account 'ok' $(if ($who) { "Signed in as $who$plan" } else { "Signed in$plan" })
		}
		if ($email) { return Account 'expired' "Signed out, or the sign-in for $email expired" }
		return Account 'signin' 'Not signed in'
	}
	# An older Claude Code without "claude auth": its saved account is the best guess.
	if ($email) { Account 'ok' "Signed in as $email" } else { Account 'signin' 'Not signed in' }
}

function Get-CodexAccount($run) {
	$r = Read-Quick $run
	$text = "$($r.out)`n$($r.err)"
	if ($text -match 'Logged in using ChatGPT') { return Account 'ok' 'Signed in with ChatGPT' }
	if ($text -match 'Logged in using an API key') { return Account 'ok' 'Signed in with an API key' }
	if ($r.code -eq 0 -and $text -match 'Logged in') { return Account 'ok' 'Signed in' }
	if ($r.code -eq -1 -and (Test-Path (Join-Path $env:USERPROFILE '.codex\auth.json'))) { return Account 'ok' 'Signed in' }
	Account 'signin' 'Not signed in'
}

function Get-GeminiAccount {
	if (Test-Path (Join-Path $env:USERPROFILE '.gemini\oauth_creds.json')) { return Account 'ok' 'Signed in with Google' }
	if (Get-UserEnv 'GEMINI_API_KEY') { return Account 'ok' 'Uses a Gemini API key' }
	Account 'signin' 'Not signed in'
}

function Get-Accounts([bool]$refresh) {
	if (-not $refresh -and $script:AccountsCache -and ((Get-Date) - $script:AccountsCache.At).TotalSeconds -lt 15) { return $script:AccountsCache.Value }
	$script:AgentCache = $null # one installed since the last look counts
	$agent = Get-Agent
	$commands = @{}
	foreach ($id in $Agents.Keys) { $commands[$id] = Get-AgentCommand $id }
	$gh = [bool](Get-Command gh -ErrorAction SilentlyContinue)

	# The slow checks run side by side.
	$claudeRun = Start-Quick $commands.claude 'auth status --json'
	$codexRun = Start-Quick $commands.codex 'login status'
	$ghRun = if ($gh) { Start-Quick 'gh' 'auth status --hostname github.com' } else { $null }

	$found = @{
		claude = if ($commands.claude) { Get-ClaudeAccount $claudeRun } else { Account 'missing' 'Not installed' }
		codex  = if ($commands.codex) { Get-CodexAccount $codexRun } else { Account 'missing' 'Not installed' }
		gemini = if ($commands.gemini) { Get-GeminiAccount } else { Account 'missing' 'Not installed' }
	}
	$agents = @($Agents.Keys | ForEach-Object {
		$a = $Agents[$_]
		[pscustomobject]@{ id = $_; name = $a.name; short = $a.short; plan = $a.plan; state = $found[$_].state; detail = $found[$_].detail
			chosen = ($_ -eq $agent.id); install = $a.install; login = $a.login }
	})

	$github = if ($gh) {
		$r = Read-Quick $ghRun
		$text = "$($r.out)`n$($r.err)"
		if ($r.code -eq 0) {
			$who = if ($text -match 'account (\S+)') { $Matches[1] } elseif ($text -match 'as (\S+)') { $Matches[1] } else { '' }
			Account 'ok' $(if ($who) { "Signed in as $who" } else { 'Signed in' })
		} else { Account 'signin' 'Not signed in to the GitHub CLI' }
	} else { Account 'info' 'Git asks you to sign in the first time it pushes.' }
	$github | Add-Member login $(if ($gh -and $github.state -ne 'ok') { 'gh-login' } else { '' })

	$hint = { param($key) if ($key) { $key.Substring([Math]::Max(0, $key.Length - 4)) } else { '' } }
	$eleven = Get-ElevenLabsKey
	$roblox = Get-RobloxKey
	$value = [pscustomobject]@{
		agent = $agent.id
		ready = ($found[$agent.id].state -eq 'ok')
		agents = $agents
		images = [pscustomobject]@{ state = $found.codex.state; detail = $found.codex.detail; login = 'codex-login'; install = 'codex-update' }
		github = $github
		elevenlabs = [pscustomobject]@{ linked = [bool]$eleven; hint = (& $hint $eleven) }
		roblox = [pscustomobject]@{ linked = [bool]$roblox; hint = (& $hint $roblox) }
	}
	$script:AccountsCache = @{ At = Get-Date; Value = $value }
	$value
}
