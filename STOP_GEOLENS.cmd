@echo off
chcp 65001 >nul
title GeoLens Stop
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-control.ps1" stop %*
set "RC=%ERRORLEVEL%"
if "%GEO_DX_NO_PAUSE%"=="1" exit /b %RC%
echo.
echo 已停止 GeoLens 应用进程。
echo PostgreSQL / Redis 保留运行；Docker Desktop 不受影响。
pause
exit /b %RC%
