@echo off
set "DIST=%~dp0dist"
for /d %%P in ("%LOCALAPPDATA%\Programs\Python\Python*") do set "PATH=%%P;%%P\Scripts;%PATH%"

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

start "Dispatch Board" cmd /k python -m http.server 5173 --directory "%DIST%"
timeout /t 2 >nul
start http://localhost:5173
