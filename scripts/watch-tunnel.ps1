# Vigia dos túneis do VideoGen (Quick tunnels Cloudflare + ngrok compartilhado).
# A cada execução, para cada túnel:
#   - cloudflared: testa origem direta e URL pública; se a origem está de pé mas a
#     pública falha 2x seguidas, mata o cloudflared, sobe outro e grava a URL nova.
#   - ngrok (domínio fixo): testa o proxy local, o backend direto e a URL pública;
#     reinicia só o elo que caiu (Caddy, ngrok com o MESMO --url, ou só alerta se
#     o backend/Persona caiu). Avisa tudo no log + notificação do Windows.
#
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-tunnel.ps1
# Agendar (a cada 5 min, só com usuário logado): ver docs/deployment.md
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Cloudflared = if ($env:CLOUDFLARED_BIN) { $env:CLOUDFLARED_BIN } else { "D:\tools\cloudflared.exe" }
$Ngrok = if ($env:NGROK_BIN) { $env:NGROK_BIN } else { "D:\tools\ngrok.exe" }
$Caddy = if ($env:CADDY_BIN) { $env:CADDY_BIN } else { "D:\tools\caddy.exe" }
$NeedRestart = 2        # falhas seguidas até agir
$TimeoutSec = 15

$Tunnels = @(
  @{ Name = "api"; Type = "ngrok"; OriginUrl = "http://localhost:3100"; ProxyUrl = "http://localhost:8090/videogen";
     HealthPath = "/healthz"; UrlFile = "tunnel-api.url.txt";
     RestartArgs = "http 8090 --url=graceful-fragrance-extrovert.ngrok-free.dev" },
  @{ Name = "apk"; Type = "cloudflared"; OriginUrl = "http://localhost:8080";
     HealthPath = "/"; UrlFile = "tunnel-apk.url.txt" }
)

function Log-Line($msg) { "[$(Get-Date -Format o)] $msg" | Tee-Object -FilePath (Join-Path $Root "tunnel-watch.log") -Append | Write-Host }

function Test-Http($url) {
  # UA próprio (não-browser): o ngrok free exibe página de aviso para navegadores.
  $ua = @{ 'User-Agent' = 'VideoGen-watch/1.0' }
  try {
    $r = Invoke-WebRequest -Uri $url -Headers $ua -TimeoutSec $TimeoutSec -UseBasicParsing
    $body = if ($r.Content.Length -gt 2000) { $r.Content.Substring(0, 2000) } else { [string]$r.Content }
    return @{ ok = $true; status = $r.StatusCode; body = $body }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode) { return @{ ok = $true; status = [int]$resp.StatusCode; body = "" } } # respondeu algo = vivo
    return @{ ok = $false; status = 0; body = "" }
  }
}

function Read-FirstLine($p) { if (Test-Path $p) { (Get-Content $p -TotalCount 1).Trim() } else { "" } }
function Read-FailCount($name) {
  $p = Join-Path $env:TEMP "videogen-tunnel-$name.fail"
  if (Test-Path $p) { [int](Get-Content $p -TotalCount 1) } else { 0 }
}
function Write-FailCount($name, $n) {
  $p = Join-Path $env:TEMP "videogen-tunnel-$name.fail"
  if ($n -le 0) { Remove-Item $p -Force -ErrorAction SilentlyContinue } else { Set-Content $p $n }
}

function Show-Toast($title, $msg) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.Visible = $true
    $n.ShowBalloonTip(10000, $title, $msg, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Milliseconds 11000
    $n.Dispose()
  } catch { Log-Line "toast falhou: $($_.Exception.Message)" }
}

function Find-Procs($exe, $match) {
  Get-CimInstance Win32_Process -Filter "Name='$exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$match*" }
}

function Restart-Cloudflared($t, $port) {
  foreach ($p in (Find-Procs "cloudflared.exe" ":$port")) {
    Log-Line "$($t.Name): matando cloudflared PID $($p.ProcessId)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $log = Join-Path $Root "cloudflared-$($t.Name).log"
  $started = Get-Date
  Start-Process $Cloudflared -ArgumentList "tunnel --url $($t.OriginUrl) --logfile `"$log`"" -WindowStyle Hidden
  $deadline = $started.AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $lines = @(Get-Content $log -Tail 60 -ErrorAction SilentlyContinue)
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
      $m = [regex]::Match($lines[$i], "https://[a-z0-9-]+\.trycloudflare\.com")
      if (-not $m.Success) { continue }
      $ts = [regex]::Match($lines[$i], "^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
      $fresh = $true
      if ($ts.Success) { try { $fresh = ([datetime]$ts.Value).ToUniversalTime() -gt $started.AddSeconds(-30) } catch { $fresh = $true } }
      if ($fresh) {
        Set-Content (Join-Path $Root $t.UrlFile) $m.Value
        Log-Line "$($t.Name): nova URL $($m.Value)"
        Show-Toast "VideoGen: túnel $($t.Name) reiniciado" $m.Value
        return $true
      }
    }
  }
  Log-Line "$($t.Name): não achei a URL nova no log em 90s"
  return $false
}

function Restart-Ngrok($t) {
  $domain = ([regex]::Match($t.RestartArgs, "--url=(\S+)")).Groups[1].Value
  foreach ($p in (Find-Procs "ngrok.exe" $domain)) {
    Log-Line "$($t.Name): matando ngrok PID $($p.ProcessId)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 3
  Log-Line "$($t.Name): subindo ngrok ($($t.RestartArgs))"
  Start-Process $Ngrok -ArgumentList $t.RestartArgs -WindowStyle Hidden
  return $true
}

function Restart-Caddy() {
  foreach ($p in (Find-Procs "caddy.exe" "Caddyfile.tunel")) {
    Log-Line "caddy: matando PID $($p.ProcessId)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
  Log-Line "caddy: subindo proxy (Caddyfile.tunel)"
  Start-Process $Caddy -ArgumentList "run", "--config", (Join-Path $Root "Caddyfile.tunel") -WindowStyle Hidden
}

foreach ($t in $Tunnels) {
  if ($t.Type -eq "cloudflared") {
    $port = ([regex]::Match($t.OriginUrl, ":(\d+)")).Groups[1].Value
    $origin = Test-Http ($t.OriginUrl + $t.HealthPath)
    if (-not $origin.ok) { Log-Line "$($t.Name): origem $($t.OriginUrl) fora do ar — túnel não é o problema"; continue }
    $pub = Read-FirstLine (Join-Path $Root $t.UrlFile)
    if (-not $pub) { Log-Line "$($t.Name): sem URL pública registrada; pulando checagem externa"; continue }
    $ext = Test-Http ($pub + $t.HealthPath)
    if ($ext.ok) { Write-FailCount $t.Name 0; Log-Line "$($t.Name): ok (origem $($origin.status), público $($ext.status))" }
    else {
      $n = (Read-FailCount $t.Name) + 1
      Write-FailCount $t.Name $n
      Log-Line "$($t.Name): falha pública $n/$NeedRestart ($pub)"
      if ($n -ge $NeedRestart -and (Restart-Cloudflared $t $port)) { Write-FailCount $t.Name 0 }
    }
  } else {
    # ngrok com domínio fixo: o restart recupera a MESMA url.
    $pub = Read-FirstLine (Join-Path $Root $t.UrlFile)
    if (-not $pub) { Log-Line "$($t.Name): sem URL pública registrada; pulando checagem externa"; continue }
    $ext = Test-Http ($pub + $t.HealthPath)
    # ngrok free exibe página de aviso para navegadores (HTTP 200!): só vale se o corpo é o JSON real.
    $extOk = $ext.ok -and ($ext.body -match '"ok"\s*:\s*true')
    if ($extOk) { Write-FailCount $t.Name 0; Log-Line "$($t.Name): ok (público $($ext.status))" ; continue }
    $n = (Read-FailCount $t.Name) + 1
    Write-FailCount $t.Name $n
    Log-Line "$($t.Name): falha pública $n/$NeedRestart ($pub)"
    if ($n -lt $NeedRestart) { continue }
    $proxy = Test-Http ($t.ProxyUrl + $t.HealthPath)
    $direct = Test-Http ($t.OriginUrl + $t.HealthPath)
    if (-not $direct.ok) { Log-Line "$($t.Name): backend $($t.OriginUrl) fora do ar — nada a reiniciar (só alerta)" }
    elseif (-not $proxy.ok) { Log-Line "$($t.Name): proxy fora do ar, backend ok — reiniciando Caddy"; Restart-Caddy }
    else {
      Log-Line "$($t.Name): proxy ok, túnel morto — reiniciando ngrok (mesmo domínio)"
      if (Restart-Ngrok $t) { Write-FailCount $t.Name 0 }
    }
  }
}
