@echo off
setlocal
set SCRIPT_DIR=%~dp0
cd /d %SCRIPT_DIR%

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":5177 .*LISTENING"') do (
  echo Stopping process on port 5177 (PID %%a)...
  taskkill /F /PID %%a >nul 2>nul
)

where node >nul 2>nul || (
  echo Node.js not found. Install Node 18+ and retry.
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

start "" http://localhost:5177
npm start
pause
