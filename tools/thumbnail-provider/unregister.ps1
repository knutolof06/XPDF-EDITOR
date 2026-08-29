$regasm = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$dllFile = Join-Path $scriptDir "XpdfThumbnailProvider.dll"

Write-Host "Unregistering XPDF Windows Explorer Thumbnail Provider..." -ForegroundColor Yellow
if (Test-Path $dllFile) {
    & $regasm /u "$dllFile"
}

# Clean registry key
Remove-Item -Path "HKCR:\.pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}" -Recurse -ErrorAction SilentlyContinue

# Restart Windows Explorer to clear cached preview handlers
taskkill /f /im explorer.exe 2>$null
Start-Process explorer.exe
Write-Host "Unregistered successfully." -ForegroundColor Green
