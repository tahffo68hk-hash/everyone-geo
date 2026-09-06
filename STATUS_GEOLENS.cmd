@echo off
chcp 65001 >nul
title GeoLens Status
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-control.ps1" status %*
exit /b %ERRORLEVEL%
