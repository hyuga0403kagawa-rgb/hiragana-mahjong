@echo off
rem 見張り番 (サーバ+トンネルの自動復旧ループ) をバックグラウンドで起動し、現在のURLを表示する
start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0tools\keep-online.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Write-Host '公開URLを確認中... (最大40秒)';" ^
  "$f = '%~dp0tools\public-url.txt';" ^
  "for ($i=0; $i -lt 40; $i++) {" ^
  "  Start-Sleep 1;" ^
  "  if (Test-Path $f) { $u = (Get-Content $f | Select-Object -First 1).Trim();" ^
  "    try { if ((Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) {" ^
  "      Set-Clipboard -Value $u -ErrorAction SilentlyContinue;" ^
  "      Write-Host ''; Write-Host '============================================';" ^
  "      Write-Host ('  公開URL (コピー済み): ' + $u);" ^
  "      Write-Host '  このURLをスマホや友達に送れば遊べます';" ^
  "      Write-Host '  切れても見張り番が自動で張り直します';" ^
  "      Write-Host '  (URLが変わったら tools\public-url.txt を確認)';" ^
  "      Write-Host '============================================'; break } } catch {} } }"
pause
