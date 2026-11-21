# Vigia dos túneis Cloudflare (quick tunnel) do VideoGen.
# A cada execução: testa a origem local e a URL pública; se a origem está de pé
# mas a URL pública falha 2 vezes seguidas, mata o cloudflared daquele túnel,
# sobe outro e grava a URL nova em tunnel-<nome>.url.txt (fora do Git) + aviso no Windows.
#
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-tunnel.ps1
# Agendar (a cada 5 min, só com usuário logado):
#   $a = New-ScheduledTaskAction -Execute powershell.exe -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PWD\scripts\watch-tunnel.ps1`""
#   $t = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
#   Register-ScheduledTask -TaskName "VideoGen Tunnel Watch" -Action $a -Trigger $t -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Cloudflared = if ($env:CLOUDFLARED_BIN) { $env:CLOUDFLARED_BIN } else { "D:\tools\cloudflared.exe" }
$NeedRestart = 2        # falhas seguidas até reiniciar
$TimeoutSec = 15

$Tunnels = @(
  @{ Name = "api"; LocalUrl = "http://localhost:3100"; HealthPath = "/healthz"; Log = "cloudflared.log"; UrlFile = "tunnel-api.url.txt" },
  @{ Name = "apk"; LocalUrl = "http://localhost:8080"; HealthPath = "/";        Log = "cloudflared-apk.log"; UrlFile = "tunnel-apk.url.txt" }
)

function Log-Line($msg) { "[$(Get-Date -Format o)] $msg" | Tee-Object -FilePath (Join-Path $Root "tunnel-watch.log") -Append | Write-Host }

function Test-Http($url) {
  try {
    $r = Invoke-WebRequest -Uri $url -TimeoutSec $TimeoutSec -UseBasicParsing
    return @{ ok = $true; status = $r.StatusCode }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode) { return @{ ok = $true; status = [int]$resp.StatusCode } } # respondeu algo: origem/túnel vivos
    return @{ ok = $false; status = 0 }
  }
}

function Read-UrlFile($t) {
  $p = Join-Path $Root $t.UrlFile
  if (Test-Path $p) { (Get-Content $p -TotalCount 1).Trim() } else { "" }
}

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

function Restart-Tunnel($t) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*localhost:*" -and $_.CommandLine -like "*$($t.LocalUrl.Split(':')[-1])*" }
  foreach ($p in $procs) {
    Log-Line "$($t.Name): matando cloudflared PID $($p.ProcessId)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $log = Join-Path $Root $t.Log
  $args = "tunnel --url $($t.LocalUrl) --logfile `"$log`""
  Log-Line "$($t.Name): subindo novo túnel ($args)"
  $started = Get-Date
  Start-Process $Cloudflared -ArgumentList $args -WindowStyle Hidden
  $deadline = $started.AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-Path $log) {
      $lines = @(Get-Content $log -Tail 60 -ErrorAction SilentlyContinue)
      for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        $m = [regex]::Match($lines[$i], "https://[a-z0-9-]+\.trycloudflare\.com")
        if (-not $m.Success) { continue }
        # Aceita só URL de log recente (evita pegar URL de reinício antigo)
        $ts = [regex]::Match($lines[$i], "^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
        $fresh = $true
        if ($ts.Success) { try { $fresh = ([datetime]$ts.Value).ToUniversalTime() -gt $started.AddSeconds(-30) } catch { $fresh = $true } }
        if ($fresh) {
          $url = $m.Value
          Set-Content (Join-Path $Root $t.UrlFile) $url
          Log-Line "$($t.Name): nova URL $url"
          Show-Toast "VideoGen: túnel $($t.Name) reiniciado" $url
          return $true
        }
      }
    }
  }
  Log-Line "$($t.Name): não achei a URL nova no log em 60s (verifique $($t.Log))"
  return $false
}

if (-not (Test-Path $Cloudflared)) { Log-Line "ERRO: cloudflared não encontrado em $Cloudflared (defina CLOUDFLARED_BIN)"; exit 1 }

foreach ($t in $Tunnels) {
  $origin = Test-Http ($t.LocalUrl + $t.HealthPath)
  if (-not $origin.ok) { Log-Line "$($t.Name): origem $($t.LocalUrl) fora do ar — túnel não é o problema (nada a fazer)"; continue }
  $pub = Read-UrlFile $t
  if (-not $pub) { Log-Line "$($t.Name): sem URL pública registrada em $($t.UrlFile); pulando checagem externa"; continue }
  $ext = Test-Http $pub
  if ($ext.ok) {
    Write-FailCount $t.Name 0
    Log-Line "$($t.Name): ok (origem $($origin.status), público $($ext.status))"
  } else {
    $n = (Read-FailCount $t.Name) + 1
    Write-FailCount $t.Name $n
    Log-Line "$($t.Name): falha pública $n/$NeedRestart ($pub)"
    if ($n -ge $NeedRestart -and (Restart-Tunnel $t)) { Write-FailCount $t.Name 0 }
  }
}
