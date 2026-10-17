@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title GeoLens Browser Assistant (127.0.0.1:8765)

set "PY_EXE="
if exist "D:\aconda\python.exe" set "PY_EXE=D:\aconda\python.exe"

if not defined PY_EXE (
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if not defined PY_EXE set "PY_EXE=%%i"
    )
)

echo Starting GeoLens Browser Assistant on 127.0.0.1:8765 using !PY_EXE!...
"!PY_EXE!" start_assistant.py

if errorlevel 1 (
    echo.
    echo [ERROR] Browser Assistant exited with error %ERRORLEVEL%
    pause
)
