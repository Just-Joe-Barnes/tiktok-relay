@echo off
setlocal
cd /d %~dp0\agent
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":5177 .*LISTENING"') do (
  echo Stopping process on port 5177 (PID %%a)...
  taskkill /F /PID %%a >nul 2>nul
)
call JustJoesTikTokRelay.bat
