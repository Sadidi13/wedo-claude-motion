@echo off
rem Starts WeDo Claude Motion and opens it in your browser (double-click, or the desktop shortcut).
rem The server runs in a minimised window called "WeDo Claude Motion server"; close it to stop.
setlocal
title WeDo Claude Motion
cd /d "%~dp0.."

if not exist node_modules (
  echo   First start: installing the app's packages. This takes about a minute...
  call pnpm install
  if errorlevel 1 goto failed
)

call node scripts\motion-bridge.mjs status >nul 2>&1
if errorlevel 1 (
  echo   Starting WeDo Claude Motion...
  start "WeDo Claude Motion server - close this window to stop" /min cmd /k pnpm dev
)

call node scripts\motion-bridge.mjs open --wait 180
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo   WeDo Claude Motion could not start. The server window shows the reason.
pause
exit /b 1
