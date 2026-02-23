@echo off
where wt >nul 2>&1
if %errorlevel% == 0 (
    :: Windows Terminal available - open both in tabs
    wt new-tab --title "IRC Bridge" -- cmd /k "python %~dp0scripts\python\node.py" ; new-tab --title "Dispatch Board" -- cmd /k "cd /d %~dp0 && npm run dev"
) else (
    :: Fallback - open two separate windows (works on Windows 10 and older)
    start "IRC Bridge" cmd /k "python %~dp0scripts\python\node.py"
    start "Dispatch Board" cmd /k "cd /d %~dp0 && npm run dev"
)
