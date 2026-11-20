@echo off
title QCPL Lost and Found - Run all tests
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org first.
  pause
  exit /b 1
)
echo Runs every test on throwaway data. The live site and its data are not touched.
echo This takes about 10 minutes. Browser windows may open and close by themselves.
node tests\run-all.mjs %*
echo.
pause