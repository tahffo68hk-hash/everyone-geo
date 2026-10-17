@echo off
setlocal
cd /d "%~dp0"
title GeoLens Local Browser Assistant (127.0.0.1:8765)

echo ========================================================
echo   GeoLens Local Browser Assistant (Selenium V2A)
echo   受控本地浏览器发布助手服务
echo ========================================================

set "PY_EXE="
if exist "D:\aconda\python.exe" set "PY_EXE=D:\aconda\python.exe"
if not defined PY_EXE (
    where python >nul 2>&1 && set "PY_EXE=python"
)

if not defined PY_EXE (
    echo [ERROR] 未找到 Python 解释器。请确认 Anaconda 或 Python 已正确安装。
    pause
    exit /b 1
)

echo 使用 Python 环境: %PY_EXE%
echo 正在启动浏览器发布助手服务 (http://127.0.0.1:8765)...
echo 提示: 请保持此控制台窗口开启，关闭窗口将停止受控浏览器发布功能。
echo.

"%PY_EXE%" apps\browser-assistant\start_assistant.py
if errorlevel 1 (
    echo.
    echo [ERROR] Browser Assistant 异常退出 (Error code: %ERRORLEVEL%)
    pause
)
