@echo off
cd /d "%~dp0"
echo ======================================================================
echo  XPDF - Windows Explorer PDF Kucuk Resim Onizlemelerini Etkinlestirme
echo ======================================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_and_register.ps1"
echo.
echo Islem tamamlandi!
pause
