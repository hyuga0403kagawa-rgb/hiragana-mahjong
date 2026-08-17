# ひらがな麻雀 公開サーバ起動スクリプト
# ゲームサーバ + Cloudflare Quick Tunnel を起動し、公開URLを表示する。
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# 既に起動済みなら二重起動しない
$alive = $false
try { $alive = (Invoke-WebRequest -Uri "http://localhost:8737/api/online" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $alive) {
  Start-Process node -ArgumentList "tools\gameserver.mjs","8737" -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

Remove-Item "$root\tools\tunnel.log" -Force -ErrorAction SilentlyContinue
Start-Process "$root\tools\cloudflared.exe" -ArgumentList "tunnel","--url","http://localhost:8737" -RedirectStandardError "$root\tools\tunnel.log" -WindowStyle Hidden

Write-Host "公開URLを取得中... (最大30秒)"
$url = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $m = Select-String -Path "$root\tools\tunnel.log" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  } catch {}
}

if ($url) {
  $url | Out-File -Encoding utf8 "$root\tools\public-url.txt"
  try { Set-Clipboard -Value $url } catch {}
  Write-Host ""
  Write-Host "======================================================"
  Write-Host "  公開URL (コピー済み): $url"
  Write-Host "  このURLをスマホや友達に送れば遊べます"
  Write-Host "  ※PCを閉じる/スリープすると止まります"
  Write-Host "======================================================"
} else {
  Write-Host "URLを取得できませんでした。tools\tunnel.log を確認してください。"
}
Read-Host "Enterで閉じる"
