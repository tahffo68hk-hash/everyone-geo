@echo off
chcp 65001 >nul
title GeoLens One-Click Start
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-control.ps1" start %*
set "RC=%ERRORLEVEL%"
if "%GEO_DX_NO_PAUSE%"=="1" exit /b %RC%
echo.
echo ========================================
echo   GeoLens 启动流程已结束。
echo   （窗口可关闭；服务在后台运行）
echo ========================================
pause
exit /b %RC%
