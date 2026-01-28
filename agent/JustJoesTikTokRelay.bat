@echo off
setlocal
set SCRIPT_DIR=%~dp0
cd /d %SCRIPT_DIR%
if not exist node_modules (
  echo Installing dependencies...
  npm install
)
start "JustJoe's TikTok Relay" http://localhost:5177
npm start
