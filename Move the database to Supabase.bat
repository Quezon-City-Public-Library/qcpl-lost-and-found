@echo off
title QCPL Lost and Found - Move the database to Supabase
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org first.
  pause
  exit /b 1
)
if not exist "node_modules\pg" (
  echo Setting up. This takes about a minute...
  call npm install --no-audit --no-fund
  echo.
)
rem The site must be stopped while the data is copied
set "WAS_RUNNING="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8360 .*LISTENING"') do (
  echo stop> "%TEMP%\qcpl-stopping.flag"
  taskkill /PID %%p /F >nul 2>nul
  set "WAS_RUNNING=1"
)
if defined WAS_RUNNING (
  echo The site was stopped while the data is copied. It starts again afterwards.
  ping -n 3 127.0.0.1 >nul
  echo.
)
node move-to-supabase.mjs
echo.
echo Press any key to start the site again...
pause >nul
start "" "%~dp0Start QCPL Lost and Found.bat"