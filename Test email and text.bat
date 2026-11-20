@echo off
title QCPL Lost and Found - settings test
cd /d "%~dp0server"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\nodemailer" (
  echo Setting up. This takes about a minute...
  call npm install --no-audit --no-fund
  echo.
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo A settings file was created:  server\.env
  echo Open it with Notepad, fill it in, save, and run this test again.
  echo.
  pause
  exit /b 1
)

node check.mjs
echo.
pause
