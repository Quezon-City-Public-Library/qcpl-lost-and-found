@echo off
title QCPL Lost and Found - Restore a backup
cd /d "%~dp0server"
echo ============================================================
echo   QCPL Lost and Found - restore a backup
echo ============================================================
echo.
echo Use this only when nobody can sign in, or on a new computer.
echo Normally, restore from the Backups page in the administrator area.
echo.
if "%~1"=="" (
  echo Drag a backup file ^(.qcplbak^) onto this file to restore it.
  echo.
  pause
  exit /b 1
)
node restore.mjs "%~1"
echo.
pause
