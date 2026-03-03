@echo off
cd /d "%~dp0"

:: Skip code-signing so winCodeSign (which has macOS symlinks that need
:: special Windows privileges to extract) is never downloaded.
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=
set WIN_CSC_KEY_PASSWORD=

:: Clean any corrupted winCodeSign cache left by a previous failed attempt.
set "SIGN_CACHE=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
if exist "%SIGN_CACHE%" (
  echo  Cleaning corrupted winCodeSign cache...
  rd /s /q "%SIGN_CACHE%" 2>nul
)

if not exist node_modules (
  echo.
  echo  Installing dependencies...
  echo.
  npm install
)

node scripts/build-win.mjs patch %*
pause
