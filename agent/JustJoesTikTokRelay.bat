@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node 18+ and retry.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Reinstall Node.js and retry.
  pause
  exit /b 1
)

if not exist "node_modules" call :install
if not exist "node_modules\busboy" call :install
if not exist "node_modules\obs-websocket-js" call :install
if not exist "node_modules\eventsource" call :install
if not exist "node_modules\ws" call :install

start "" http://localhost:5177
echo Starting agent...
set "LOG_FILE=%SCRIPT_DIR%agent-start.log"
echo ===== %DATE% %TIME% ===== > "%LOG_FILE%"
powershell -NoProfile -Command "npm start 2>&1 | Tee-Object -FilePath '%LOG_FILE%'"
echo Agent exited with code %errorlevel%.
pause
exit /b

:install
echo Installing dependencies...
npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)
exit /b 0
