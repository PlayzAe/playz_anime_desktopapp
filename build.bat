@echo off
REM ===========================================================================
REM  PlayzAnime - release builder
REM  Produces, in the release folder:
REM    PlayzAnime-Setup-<version>.exe     installer with Start menu and desktop shortcuts
REM    PlayzAnime-Portable-<version>.exe  single file, runs without installing
REM    win-unpacked\PlayzAnime.exe        the unpacked app folder
REM ===========================================================================
setlocal
title PlayzAnime build
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo  Node.js is not installed. Get the LTS version from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo [build] Installing dependencies...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :failed
)

echo [build] Drawing icons...
call npm run icons
if errorlevel 1 goto :failed

echo [build] Checking types...
call npm run typecheck
if errorlevel 1 goto :failed

echo [build] Packaging installer and portable exe...
call npm run dist
if errorlevel 1 goto :failed

echo.
echo  Done. Your files are in the release folder.
start "" "%~dp0release"
exit /b 0

:failed
echo.
echo  The build stopped with an error (see above).
pause
exit /b 1
