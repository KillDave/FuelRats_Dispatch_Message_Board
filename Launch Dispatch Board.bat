@echo off
set "DIST=%~dp0dist"

if not exist "%DIST%\" (
    echo ERROR: dist folder not found. Ensure all files are extracted correctly.
    pause
    exit /b 1
)

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Install Python 3 from https://python.org and add it to PATH.
    pause
    exit /b 1
)

where wt >nul 2>&1
if %errorlevel% == 0 (
    wt new-tab --title "Dispatch Board" -- cmd /k python -m http.server 5173 --directory "%DIST%" ; new-tab --title "Browser" -- cmd /k "start http://localhost:5173 && exit"
    if %errorlevel% neq 0 goto fallback
    exit /b
)

:fallback
start "Dispatch Board" cmd /k python -m http.server 5173 --directory "%DIST%"
timeout /t 2 >nul
start http://localhost:5173
