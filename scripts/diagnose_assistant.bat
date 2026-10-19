@echo off
chcp 65001 >nul
echo === 1. Checking Python Environment ===
where python
python --version
if exist "D:\aconda\python.exe" (
    echo Found D:\aconda\python.exe
    D:\aconda\python.exe --version
)

echo.
echo === 2. Testing Python Imports for Browser Assistant ===
python -c "import sys; print('sys.executable:', sys.executable)"
python -c "import fastapi, uvicorn, pydantic, selenium; print('All browser assistant dependencies imported successfully!')" 2>nul
if errorlevel 1 (
    echo [MISSING DEPS on default python] Checking D:\aconda\python.exe ...
    if exist "D:\aconda\python.exe" (
        D:\aconda\python.exe -c "import fastapi, uvicorn, pydantic, selenium; print('All deps imported on D:\aconda\python.exe!')" 2>nul
        if errorlevel 1 (
            echo [MISSING DEPS on D:\aconda\python.exe]
        )
    )
)

echo.
echo === 3. Checking Port 8765 status ===
netstat -ano | findstr 8765
