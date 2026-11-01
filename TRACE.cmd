@echo off
where node.exe >nul 2>&1
if errorlevel 1 (
  echo TRACE needs Node.js 22.12 or newer. Install it from https://nodejs.org then retry.
  pause
  exit /b 1
)
node "%~dp0scripts\launch-trace.cjs"
if errorlevel 1 pause
