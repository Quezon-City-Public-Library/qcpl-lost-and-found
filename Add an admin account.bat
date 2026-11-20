@echo off
title QCPL Lost and Found - Add an admin account
cd /d "%~dp0server"

echo ============================================================
echo   Add a head administrator account
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org first.
  echo.
  pause
  exit /b 1
)

rem The site must be stopped while the account is added
set "WAS_RUNNING="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8360 .*LISTENING"') do (
  echo stop> "%TEMP%\qcpl-stopping.flag"
  taskkill /PID %%p /F >nul 2>nul
  set "WAS_RUNNING=1"
)
if defined WAS_RUNNING (
  echo The site was running. It was stopped and will start again afterwards.
  ping -n 3 127.0.0.1 >nul
  echo.
)

node add-admin.mjs
echo.
echo Write the password down now. Press any key to start the site again...
pause >nul
start "" "%~dp0Start QCPL Lost and Found.bat"
