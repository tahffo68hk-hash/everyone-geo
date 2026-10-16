@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo  Starting GeoLens Local Browser Assistant (Selenium V2A)
echo ========================================================
python apps\browser-assistant\start_assistant.py
if errorlevel 1 (
    echo.
    echo Browser Assistant stopped with error %ERRORLEVEL%
    pause
)
