@echo off
rem Registers the Motion Studio connector in Claude Desktop (docs/CLAUDE-DESKTOP.md).
rem Claude Desktop rewrites its config while it runs, so this waits until it is closed,
rem registers the connector, starts Motion Studio if needed and opens Claude again.
setlocal
title Connect the Claude chat to Motion Studio
cd /d "%~dp0.."

echo.
echo   Connect the Claude chat to Motion Studio
echo   ----------------------------------------
echo   Claude Desktop must be closed while its settings are changed.
echo   Quit it now: right-click the Claude icon next to the clock, then Quit.
echo   This window continues by itself as soon as Claude is closed.
echo.

:waitclose
powershell -NoProfile -Command "if (Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\WindowsApps\Claude_*' -or $_.Path -like '*\AnthropicClaude\*' }) { exit 1 }"
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto waitclose
)
echo   Claude is closed.
echo.

call node scripts\motion-bridge.mjs install-chat
if errorlevel 1 goto failed

echo.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:3000/api/bridge/status | Out-Null } catch { exit 1 }"
if errorlevel 1 (
  echo   Starting Motion Studio in its own window ^(keep that window open^)...
  start "Motion Studio - pnpm dev" /d "%cd%" cmd /k pnpm dev
) else (
  echo   Motion Studio is already running.
)

echo   Opening Claude...
powershell -NoProfile -Command "$app = Get-StartApps | Where-Object Name -eq 'Claude' | Select-Object -First 1; if ($app) { Start-Process ('shell:AppsFolder\' + $app.AppID) } else { exit 1 }"
if errorlevel 1 echo   Could not find Claude in the Start menu. Open it yourself.

echo.
echo   Done. In a new Claude chat, ask for a video, or say "listen to Motion Studio".
echo   This window closes in 20 seconds.
timeout /t 20 >nul
exit /b 0

:failed
echo.
echo   Registering the connector failed; see the message above.
pause
exit /b 1
