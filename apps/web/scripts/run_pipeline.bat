@echo off
chcp 65001 >nul
cd /d "D:\dev\geo-platform"

echo ========================================================
echo   GeoLens Enterprise Pipeline Verification
echo ========================================================

echo [1/4] Building @geolens/api...
call pnpm --filter @geolens/api build
if %errorlevel% neq 0 (
    echo [ERROR] API build failed!
    exit /b 1
)

echo [2/4] Starting API and Browser Assistant...
if not exist .runtime mkdir .runtime
start /B "" "D:\tools\node24\node.exe" apps\api\dist\main.js dx-geolens-api > .runtime\api.log 2>&1
start /B "" "D:\aconda\python.exe" apps\browser-assistant\start_assistant.py > .runtime\assistant.log 2>&1

echo [3/4] Waiting for services health...
"D:\aconda\python.exe" apps\web\scripts\wait_services.py
if %errorlevel% neq 0 (
    echo [ERROR] Services failed health check!
    exit /b 1
)

echo [4/4] Executing E2E Distribution Flow Test...
"D:\aconda\python.exe" apps\web\scripts\distribution_flow_e2e.py

echo ========================================================
echo   Verification Completed
echo ========================================================
