@echo off
setlocal
cd /d "%~dp0"
echo Starting GeoLens Browser Assistant on 127.0.0.1:8765...
python start_assistant.py
if errorlevel 1 (
    echo.
    echo Browser Assistant exited with error %ERRORLEVEL%
    pause
)
