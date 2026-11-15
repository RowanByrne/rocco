# Ask this Codex installation for the identity of Rocco's Stop hook. The app server reads
# configuration locally. It does not start a turn or write settings.
function Get-CodexWatchHookList([string]$exe, [string]$dir, [string[]]$config) {
	$arguments = 'app-server' + (($config | ForEach-Object { ' -c "' + $_ + '"' }) -join '')
	$info = if ($exe -like '*.exe') { New-Object Diagnostics.ProcessStartInfo $exe, $arguments }
		else { New-Object Diagnostics.ProcessStartInfo 'cmd.exe', "/d /s /c `"`"$exe`" $arguments`"" }
	$info.WorkingDirectory = $dir
	$info.UseShellExecute = $false
	$info.CreateNoWindow = $true
	$info.RedirectStandardInput = $true
	$info.RedirectStandardOutput = $true
	$info.RedirectStandardError = $true
	$info.StandardOutputEncoding = [Text.Encoding]::UTF8
	$process = $null
	$limit = 4000
	$timer = [Diagnostics.Stopwatch]::StartNew()
	function Read-CodexWatchReply([int]$id) {
		while ($timer.ElapsedMilliseconds -lt $limit) {
			$line = $process.StandardOutput.ReadLineAsync()
			if (-not $line.Wait([Math]::Max(0, $limit - [int]$timer.ElapsedMilliseconds)) -or $null -eq $line.Result) { return }
			try { $reply = $line.Result | ConvertFrom-Json } catch { continue }
			if ($reply.id -eq $id -and -not $reply.method) { return $reply.result }
		}
	}
	try {
		$process = [Diagnostics.Process]::Start($info)
		$stderr = $process.StandardError.ReadToEndAsync()
		$process.StandardInput.WriteLine('{"method":"initialize","id":1,"params":{"clientInfo":{"name":"rocco","version":"1.0.0"},"capabilities":{"experimentalApi":true}}}')
		if (-not (Read-CodexWatchReply 1)) { return }
		$process.StandardInput.WriteLine('{"method":"initialized"}')
		$request = @{ method = 'hooks/list'; id = 2; params = @{ cwds = @($dir) } } | ConvertTo-Json -Compress -Depth 4
		$bytes = [Text.Encoding]::UTF8.GetBytes("$request`n")
		$process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
		$process.StandardInput.BaseStream.Flush()
		Read-CodexWatchReply 2
	} catch { }
	finally {
		if ($process) {
			try { $process.StandardInput.Close() } catch { }
			if (-not $process.WaitForExit(300)) { try { & taskkill.exe /T /F /PID $process.Id 2>$null | Out-Null } catch { } }
			$process.Dispose()
		}
	}
}

function Get-CodexWatchArguments([string]$dir) {
	$exe = Find-AgentExe 'codex'
	if (-not $exe -or $exe -notmatch '\.(exe|cmd)$') { return }
	# The command has no embedded double quotes, so Windows PowerShell splats it as one
	# config argument. The launch window gives it the absolute board path as data.
	$scriptText = 'if ($env:ROCCO_CODEX_BOARD -and $env:ROCCO_CODEX_DIR) { Set-Location -LiteralPath $env:ROCCO_CODEX_DIR -ErrorAction Stop; & $env:ROCCO_CODEX_BOARD hook codex-stop }'
	$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scriptText))
	$command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
	$timeout = 3600
	$status = 'Watching Rocco'
	$definition = "hooks.Stop=[{hooks=[{type='command',command='$command',timeout=$timeout,statusMessage='$status'}]}]"
	$list = Get-CodexWatchHookList $exe $dir @($definition)
	$candidates = @($list.data.hooks | Where-Object {
		$_.source -ceq 'sessionFlags' -and $_.eventName -ceq 'stop' -and $_.handlerType -ceq 'command' -and
		$_.command -ceq $command -and $_.timeoutSec -eq $timeout -and $_.statusMessage -ceq $status -and
		-not $_.async -and $_.enabled -and -not $_.isManaged
	})
	if ($candidates.Count -ne 1) { return }
	$hook = $candidates[0]
	if ($hook.key -notmatch '^[A-Za-z]:\\<session-flags>\\config\.toml:stop:\d+:\d+$' -or $hook.currentHash -notmatch '^sha256:[0-9a-f]{64}$') { return }
	# Trust only the exact hook Codex found in the session flag configuration. This state
	# is also a session flag, leaving user, project, and plugin hook permissions alone.
	'-c', $definition, '-c', "hooks.state={ '$($hook.key)'={trusted_hash='$($hook.currentHash)'} }"
}
