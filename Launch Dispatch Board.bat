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
    echo ERROR: Python not found on PATH.
    echo.
    echo Python 3 is used only to serve this folder over HTTP. The board cannot
    echo be opened straight from disk - browsers block ES modules on file:// and
    echo the FuelRats sign-in needs a real address to return to.
    echo.
    echo Install Python 3 from https://python.org and tick "Add python.exe to PATH".
    echo If typing python opens the Microsoft Store, that stub is not a real
    echo install - use the python.org installer instead.
    pause
    exit /b 1
)

start "Dispatch Board" cmd /k python -m http.server 5173 --directory "%DIST%"
timeout /t 2 >nul
start http://localhost:5173
