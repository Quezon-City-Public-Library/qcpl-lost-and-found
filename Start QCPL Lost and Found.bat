@echo off
title QCPL Lost and Found
cd /d "%~dp0server"
rem "/startup" = started by Windows at sign-in: no browser window
if /i "%~1"=="/startup" set "QCPL_NO_BROWSER=1"

echo ============================================================
echo   QCPL Lost and Found
echo ============================================================
echo.

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
  echo Open it with Notepad to turn on email, text messages or online photo reading.
  echo The website works without them.
  echo.
)

rem If the site is still running from an earlier window, stop that one first
set "WAS_RUNNING="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8360 .*LISTENING"') do (
  echo stop> "%TEMP%\qcpl-stopping.flag"
  taskkill /PID %%p /F >nul 2>nul
  set "WAS_RUNNING=1"
)
if defined WAS_RUNNING (
  echo The site was still running in another window. Restarting it...
  ping -n 3 127.0.0.1 >nul
  echo.
)

rem First start (no database yet): open the setup page to create the head administrator
set "QCPL_URL=http://localhost:8360"
if not exist "%LOCALAPPDATA%\QCPL Lost and Found\data\qcpl.db" if not exist "data\qcpl.db" set "QCPL_URL=http://localhost:8360/setup"
echo Opening %QCPL_URL% in your browser...
echo Keep this window open while you use the website. Close it to stop.
echo.
if not "%QCPL_NO_BROWSER%"=="1" start "" "%QCPL_URL%"
del "%TEMP%\qcpl-stopping.flag" >nul 2>nul
set /a CRASHES=0
:run
node server.mjs
set "CODE=%errorlevel%"
rem Exit code 3 = the server asked to be started again (for example after restoring a backup)
if "%CODE%"=="3" (
  echo.
  echo Restarting the server...
  echo.
  goto run
)
rem Anything else but a normal stop: start it again (up to 5 times), so the site stays up
if not "%CODE%"=="0" (
  set /a CRASHES+=1
  call :again
  if errorlevel 1 goto run
)

echo.
echo The server has stopped.
pause
exit /b 0

:again
rem Stopped on purpose by another window (a new start, or adding an admin): don't restart
if exist "%TEMP%\qcpl-stopping.flag" (
  echo.
  echo The site was stopped by another window. This window will close.
  timeout /t 3 /nobreak >nul
  exit
)
if %CRASHES% GTR 5 (
  echo.
  echo The server stopped unexpectedly 5 times. Please check the messages above.
  exit /b 0
)
echo.
echo The server stopped unexpectedly. Starting it again in 10 seconds... (close this window to stop)
timeout /t 10 /nobreak >nul
exit /b 1
