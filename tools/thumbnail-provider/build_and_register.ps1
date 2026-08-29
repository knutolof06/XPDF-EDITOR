$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$regasm = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\RegAsm.exe"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

$csFile = Join-Path $scriptDir "XpdfThumbnailProvider.cs"
$dllFile = Join-Path $scriptDir "XpdfThumbnailProvider.dll"
$logoSrc = Join-Path $scriptDir "..\..\build\icon.png"
$logoDst = Join-Path $scriptDir "logo.png"

if (Test-Path $logoSrc) {
    Copy-Item $logoSrc $logoDst -Force
}

Write-Host "Compiling XPDF Windows Explorer Thumbnail Provider..." -ForegroundColor Cyan
& $csc /target:library /out:"$dllFile" /platform:anycpu /optimize+ "$csFile"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Compilation successful: $dllFile" -ForegroundColor Green
    Write-Host "Registering COM Shell Thumbnail Provider with Windows..." -ForegroundColor Cyan
    & $regasm /codebase "$dllFile"
    
    # Restart Windows Thumbnail Cache
    Write-Host "Refreshing Windows icon/thumbnail cache..." -ForegroundColor Cyan
    taskkill /f /im explorer.exe 2>$null
    Start-Process explorer.exe
    Write-Host "Windows Explorer PDF Thumbnail Preview with XPDF badge is now ACTIVE!" -ForegroundColor Green
} else {
    Write-Host "Compilation failed with exit code $LASTEXITCODE" -ForegroundColor Red
}
