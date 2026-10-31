# Starts the game server (if it is not already running) and a Cloudflare quick tunnel, then prints the public URL.
# Temporary link only: it stops working when this computer sleeps, shuts down, or the processes end.
$root = $PSScriptRoot
$cf = Join-Path $root 'work\cloudflared.exe'
if (-not (Test-Path $cf)) { Write-Error '缺少 work\cloudflared.exe，先下载 cloudflared 放到 work 目录'; exit 1 }
try { Invoke-WebRequest http://127.0.0.1:4317/healthz -UseBasicParsing -TimeoutSec 2 | Out-Null }
catch {
  Start-Process node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root 'work\server.log') -RedirectStandardError (Join-Path $root 'work\server-error.log')
  Start-Sleep 2
}
$log = Join-Path $root 'work\tunnel.log'
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process $cf -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:4317', '--protocol', 'http2', '--logfile', $log -WindowStyle Hidden
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep 1
  $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { "公开地址：$($m.Matches[0].Value)"; exit 0 }
}
Write-Error '40 秒内没有拿到隧道地址，请查看 work\tunnel.log'
exit 1
