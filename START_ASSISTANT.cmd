@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title GeoLens Browser Assistant (127.0.0.1:8765)

echo ========================================================
echo   GeoLens Local Browser Assistant (Selenium V2A)
echo ========================================================

set "PY_EXE="
if exist "D:\aconda\python.exe" set "PY_EXE=D:\aconda\python.exe"

if not defined PY_EXE (
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if not defined PY_EXE set "PY_EXE=%%i"
    )
)

if not defined PY_EXE (
    echo [ERROR] Python not found. Please verify Python is installed.
    pause
    exit /b 1
)

echo Python Environment: !PY_EXE!
echo Starting Assistant on http://127.0.0.1:8765 ...
echo Keep this window open while using GeoLens Browser Assistant.
echo.

"!PY_EXE!" apps\browser-assistant\start_assistant.py

if errorlevel 1 (
    echo.
    echo [ERROR] Browser Assistant stopped with code %ERRORLEVEL%
    pause
)
