@echo off
setlocal
set SCRIPT_DIR=%~dp0
cd /d %SCRIPT_DIR%
if not exist node_modules (
  echo Installing dependencies...
  npm install
)
start "JustJoe's TikTok Relay" cmd /c "npm start"
timeout /t 2 /nobreak >nul
start "" http://localhost:5177
