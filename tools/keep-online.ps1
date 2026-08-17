# ひらがな麻雀 オンライン見張り番
# 60秒ごとにゲームサーバと公開トンネルの生存を確認し、死んでいたら自動で立て直す。
# トンネルURLが変わったら tools/public-url.txt を更新する。
# 停止するには このスクリプトのPowerShellプロセスを終了する。
$root = Split-Path $PSScriptRoot -Parent
$urlFile = Join-Path $PSScriptRoot "public-url.txt"
$logFile = Join-Path $PSScriptRoot "keep-online.log"
$tunnelLog = Join-Path $PSScriptRoot "tunnel.log"

# 二重起動防止
$mutex = New-Object System.Threading.Mutex($false, "hiragana_mahjong_keep_online")
if (-not $mutex.WaitOne(0)) { exit }

function Log($msg) {
  $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
}
function Test-Url($u, $sec) {
  try { return (Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec $sec).StatusCode -eq 200 } catch { return $false }
}

Log "見張り番を開始"
while ($true) {
  # 1) ゲームサーバ (localhost:8737)
  if (-not (Test-Url "http://localhost:8737/api/online" 5)) {
    Log "サーバ停止を検知 → 再起動"
    Start-Process node -ArgumentList "`"$root\tools\gameserver.mjs`"","8737" -WorkingDirectory $root -WindowStyle Hidden
    Start-Sleep -Seconds 6
  }

  # 2) 公開トンネル (URLが実際に応答するかで判定)
  $u = $null
  if (Test-Path $urlFile) { $u = (Get-Content $urlFile | Select-Object -First 1).Trim() }
  $tunnelOk = $u -and (Test-Url $u 12)
  if (-not $tunnelOk) {
    Log "トンネル失効を検知 ($u) → 張り直し"
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Remove-Item $tunnelLog -Force -ErrorAction SilentlyContinue
    Start-Process "$root\tools\cloudflared.exe" -ArgumentList "tunnel","--url","http://localhost:8737" -RedirectStandardError $tunnelLog -WindowStyle Hidden
    Start-Sleep -Seconds 14
    try {
      $m = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
      if ($m) {
        $newUrl = $m.Matches[0].Value
        $newUrl | Out-File -Encoding utf8 $urlFile
        Log "新しい公開URL: $newUrl"
      } else {
        Log "URLを取得できず (次回リトライ)"
      }
    } catch { Log "URL取得エラー (次回リトライ)" }
  }

  Start-Sleep -Seconds 60
}
