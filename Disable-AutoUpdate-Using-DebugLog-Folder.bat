@echo off
setlocal EnableExtensions

set "LOGDIR=%~1"

if "%LOGDIR%"=="" (
  echo Usage:
  echo   %~nx0 "C:\Path\To\ARMGDDN Companion"
  echo.
  echo Tip: In ARMGDDN Companion, right-click the tray icon and choose "Open Log Folder".
  echo Then copy the opened folder path and pass it here.
  exit /b 2
)

if not exist "%LOGDIR%" (
  echo ERROR: Folder does not exist:
  echo %LOGDIR%
  exit /b 3
)

set "DBGLOG=%LOGDIR%\debug.log"
set "CFG=%LOGDIR%\config.json"

if not exist "%DBGLOG%" (
  echo WARNING: debug.log was not found at:
  echo %DBGLOG%
  echo Continuing anyway.
)

if not exist "%CFG%" (
  echo ERROR: config.json was not found at:
  echo   %CFG%
  echo.
  echo This script expects config.json to live alongside debug.log in the same folder.
  exit /b 4
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Date -Format yyyyMMdd_HHmmss"`) do set "TS=%%I"
set "BACKUP=%CFG%.bak.%TS%"

copy /y "%CFG%" "%BACKUP%" >nul
if errorlevel 1 (
  echo ERROR: Failed to create backup:
  echo   %BACKUP%
  exit /b 5
)

echo Backup created:
echo   %BACKUP%

echo Disabling auto-update in:
echo   %CFG%

echo NOTE: Please close ARMGDDN Companion before running this script.

echo.

echo Writing updated config.json...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = '%CFG%'; $raw = Get-Content -LiteralPath $p -Raw; $obj = $raw | ConvertFrom-Json; if ($null -eq $obj) { throw 'Invalid JSON'; } $obj.autoUpdate = $false; $obj | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $p -Encoding UTF8" 
if errorlevel 1 (
  echo ERROR: Failed to update config.json.
  echo Restoring backup...
  copy /y "%BACKUP%" "%CFG%" >nul
  exit /b 6
)

echo.

echo SUCCESS: autoUpdate has been set to false.

echo.

echo You can confirm by opening:
echo   %CFG%
echo and checking for:
echo   "autoUpdate": false

exit /b 0
