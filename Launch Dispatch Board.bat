@echo off

:: -------------------------------------------------------
:: Launch services
:: -------------------------------------------------------
where wt >nul 2>&1
if %errorlevel% == 0 (
    wt new-tab --title "IRC Bridge" -- cmd /k "python %~dp0scripts\python\node.py" ; new-tab --title "Dispatch Board" -- cmd /k "cd /d %~dp0 && npm run dev"
) else (
    start "IRC Bridge" cmd /k "python %~dp0scripts\python\node.py"
    start "Dispatch Board" cmd /k "cd /d %~dp0 && npm run dev"
)
