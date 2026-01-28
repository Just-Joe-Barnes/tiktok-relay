@echo off
setlocal
set SCRIPT_DIR=%~dp0
cd /d %SCRIPT_DIR%

where node >nul 2>nul || (
  echo Node.js not found. Install Node 18+ and retry.
  pause
  exit /b 1
)

where npm >nul 2>nul || (
  echo npm not found. Reinstall Node.js and retry.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist node_modules\\busboy (
  echo Updating dependencies (busboy missing)...
  npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

start "" http://localhost:5177
echo Starting agent...
set LOG_FILE=%SCRIPT_DIR%agent-start.log
echo ===== %DATE% %TIME% ===== > "%LOG_FILE%"
npm start >> "%LOG_FILE%" 2>&1
echo Agent exited with code %errorlevel%.
echo --- Agent log ---
type "%LOG_FILE%"
pause
