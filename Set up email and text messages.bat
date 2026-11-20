@echo off
title QCPL Lost and Found - Set up email and text messages
cd /d "%~dp0server"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org first.
  pause
  exit /b 1
)
if not exist "node_modules\nodemailer" (
  echo Setting up. This takes about a minute...
  call npm install --no-audit --no-fund
  echo.
)
node setup-messages.mjs
echo.
pause