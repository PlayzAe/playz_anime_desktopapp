@echo off
REM ===========================================================================
REM  PlayzAnime - local test launcher
REM    start.bat          development mode: hot reload, DevTools on F12
REM    start.bat built    production build of the app, run straight from source
REM    start.bat setup    development mode, showing first-run setup again
REM  Close the app window to stop.
REM ===========================================================================
setlocal
title PlayzAnime
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js is not installed or not on PATH.
  echo  Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo [PlayzAnime] First run: installing dependencies. This happens once.
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :failed
)

if /i "%~1"=="built" (
  echo [PlayzAnime] Building and starting the production app...
  call npm start
) else (
  if /i "%~1"=="setup" set PLAYZANIME_FORCE_SETUP=1
  echo [PlayzAnime] Starting in development mode...
  call npm run dev
)
exit /b %ERRORLEVEL%

:failed
echo.
echo  Installing dependencies failed. Check your internet connection and try again.
pause
exit /b 1
