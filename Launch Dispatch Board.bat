@echo off

:: -------------------------------------------------------
:: Launch services
:: -------------------------------------------------------
where wt >nul 2>&1
if %errorlevel% == 0 (
    wt new-tab --title "Dispatch Board" -- cmd /k "python -m http.server 5173 --directory %~dp0dist" ; new-tab --title "Browser" -- cmd /k "start http://localhost:5173 && exit"
) else (
    start "Dispatch Board" cmd /k "python -m http.server 5173 --directory %~dp0dist"
    timeout /t 2 >nul
    start http://localhost:5173
)
