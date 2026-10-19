@echo off
chcp 65001 >nul
echo ==========================================
echo Running Final Acceptance Playwright Script
echo ==========================================
python -X utf8 scripts\capture-final-acceptance.py
if errorlevel 1 (
    echo [ERROR] Playwright script failed!
    exit /b %errorlevel%
)

echo.
echo ==========================================
echo Checking Git Status and Sensitive Files
echo ==========================================
git status --short
git log -n 1 --oneline
