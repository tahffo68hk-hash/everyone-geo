@echo off
setlocal
cd /d "%~dp0"
title GeoLens Browser Assistant (127.0.0.1:8765)

set "PY_EXE="
if exist "D:\aconda\python.exe" set "PY_EXE=D:\aconda\python.exe"
if not defined PY_EXE (
    where python >nul 2>&1 && set "PY_EXE=python"
)

echo Starting GeoLens Browser Assistant on 127.0.0.1:8765 using %PY_EXE%...
"%PY_EXE%" start_assistant.py
if errorlevel 1 (
    echo.
    echo Browser Assistant exited with error %ERRORLEVEL%
    pause
)
