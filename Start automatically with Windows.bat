@echo off
title QCPL Lost and Found - Start automatically with Windows
rem Turns automatic start on or off. When on, the site starts (in a small window,
rem without opening a browser) every time someone signs in to this computer.
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\QCPL Lost and Found.lnk"
set "TARGET=%~dp0Start QCPL Lost and Found.bat"
set "FOLDER=%~dp0"

if exist "%LNK%" goto turnoff

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath = $env:TARGET; $s.Arguments = '/startup'; $s.WorkingDirectory = $env:FOLDER; $s.WindowStyle = 7; $s.Description = 'Starts the QCPL Lost and Found website'; $s.Save()"
if exist "%LNK%" (
  echo Automatic start is ON.
  echo The site will start by itself, in a small window, every time you sign in to Windows.
  echo Run this file again to turn it off.
) else (
  echo Sorry, automatic start could not be turned on.
)
echo.
pause
exit /b 0

:turnoff
echo Automatic start is ON at the moment.
choice /m "Turn it off"
if errorlevel 2 exit /b 0
del "%LNK%"
echo Automatic start is OFF. Start the site with "Start QCPL Lost and Found.bat" when you need it.
echo.
pause
