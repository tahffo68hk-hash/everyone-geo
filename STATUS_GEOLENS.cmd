@echo off
setlocal
cd /d "%~dp0"

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-control.ps1" status

set "EXITCODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXITCODE%
