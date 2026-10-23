@echo off
rem Starts the Motion Studio autopilot (docs/CLAUDE-DESKTOP.md): Ask Claude requests from the
rem editor are answered automatically by Claude Code with your Claude subscription. Waiting is
rem free; each request is one short Claude Code run. Starts Motion Studio too if it is not running.
setlocal
title Motion Studio autopilot
cd /d "%~dp0.."

where claude >nul 2>&1
if errorlevel 1 (set "CLAUDE_BIN=%USERPROFILE%\.local\bin\claude.exe") else (set "CLAUDE_BIN=claude")
if defined MOTION_STUDIO_CLAUDE_BIN set "CLAUDE_BIN=%MOTION_STUDIO_CLAUDE_BIN%"

call node scripts\motion-bridge.mjs status >nul 2>&1
if errorlevel 1 (
  echo   Starting Motion Studio in its own window ^(keep that window open^)...
  start "Motion Studio - pnpm dev" /d "%cd%" cmd /k pnpm dev
  echo.
)

:run
node scripts\motion-autopilot.mjs %*
if errorlevel 3 goto stopped
if errorlevel 2 goto login
goto stopped

:login
echo.
echo   Sign in to Claude Code with your Claude account in the browser window that opens.
echo   Use the same account as your Claude subscription.
echo.
call "%CLAUDE_BIN%" auth login --claudeai
if errorlevel 1 goto stopped
echo.
goto run

:stopped
echo.
echo   The autopilot stopped. Press any key to start it again, or close this window.
pause >nul
goto run
