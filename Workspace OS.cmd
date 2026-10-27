@echo off
rem Workspace OS: sets up and checks the toolkit on this PC, then shows the dashboard in your browser.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Workspace OS needs Node.js. Install the LTS version from nodejs.org, then run this again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node "%~dp0app\server.mjs" --open %*
if errorlevel 1 pause
