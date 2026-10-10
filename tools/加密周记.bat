@echo off
setlocal
chcp 65001 >nul
title Apex - Encrypt weekly note
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0weekly-file-dialog.ps1" -Mode encrypt
set "result=%errorlevel%"
echo.
pause
exit /b %result%
