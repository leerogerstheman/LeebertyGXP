@echo off
REM ===========================================================================
REM  LeebertyGXP - one-click launcher
REM
REM  Starts the server, then opens the workbench in its own Edge --app window
REM  the server loads the configuration library, provisions the built-in role
REM  accounts AND generates the demonstration dataset, so a single launch gives
REM  the domain picker with real records behind it. There is no separate
REM  "generate demo data" step.
REM
REM  PURE ASCII ON PURPOSE. cmd.exe reads a .bat file using the ACTIVE console
REM  code page, so non-ASCII content breaks in two ways:
REM    1. GBK text + chcp 65001  -> cmd desynchronises mid-file and starts
REM       executing fragments of comments, flooding the screen with
REM       "'xxx' is not recognized as an internal or external command".
REM    2. UTF-8 text + code page 936 -> the Chinese renders as mojibake.
REM  Pure ASCII is byte-identical under every code page, which is what lets us
REM  safely switch the console to UTF-8 for the Node process. All user-facing
REM  Chinese lives in src/server.js. DO NOT add non-ASCII text to this file.
REM
REM  Environment switches:
REM    GXP_BUILTIN_ACCOUNTS=0   no demo accounts, and no demo dataset either
REM    GXP_AUTO_SEED_DEMO=0     keep the demo accounts but start empty
REM    GXP_MONITOR=0            do not start the background workflow monitor
REM    GXP_PORT=8790            use a different port (or pass it as argument 1)
REM ===========================================================================
setlocal EnableExtensions
title LeebertyGXP

cd /d "%~dp0"

set "GXP_PORT=8788"
if not "%~1"=="" set "GXP_PORT=%~1"
set "GXP_OPEN_BROWSER=1"

REM Click-and-use default: provision the built-in role accounts - and with them
REM the demonstration dataset on first run - unless the caller turned them off.
if not defined GXP_BUILTIN_ACCOUNTS set "GXP_BUILTIN_ACCOUNTS=1"

REM Switch the console to UTF-8 so the Node banner renders Chinese correctly.
chcp 65001 >nul 2>&1

echo.
echo   ============================================================
echo    LeebertyGXP
echo   ============================================================
echo.

REM ---------------------------------------------------------------- Node.js --
set "NODE_EXE="
where node >nul 2>&1 && set "NODE_EXE=node"

if not defined NODE_EXE (
  for %%P in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
    "%APPDATA%\nvm\node.exe"
    "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  ) do (
    if not defined NODE_EXE if exist %%P set "NODE_EXE=%%~P"
  )
)

if not defined NODE_EXE (
  echo   [ERROR] Node.js was not found.
  echo.
  echo   This workbench needs Node.js 22.5 or newer, because it relies on the
  echo   built-in node:sqlite module.
  echo.
  echo   Install the LTS build from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%V in ('"%NODE_EXE%" --version 2^>nul') do set "NODE_VERSION=%%V"
echo   Node.js        %NODE_VERSION%

REM ------------------------------------------------------------- first run --
if not exist "data" mkdir "data" >nul 2>&1

REM ----------------------------------------------------- port already in use --
netstat -ano -p TCP | findstr /r /c:"LISTENING" | findstr /c:":%GXP_PORT% " >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   [NOTE] Port %GXP_PORT% is already in use - the workbench may already
  echo          be running.
  echo.
  choice /c YN /n /m "  Open the browser anyway? [Y/N] "
  if errorlevel 2 (
    echo.
    echo   To use a different port run:  start.bat 8790
    echo.
    pause
    exit /b 1
  )
  start "" "http://127.0.0.1:%GXP_PORT%"
  exit /b 0
)

echo   Port           %GXP_PORT%
echo.

REM ---------------------------------------------------------------- launch --
"%NODE_EXE%" "src\server.js"

set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo   [ERROR] The server exited with code %EXITCODE%.
  echo.
  if "%EXITCODE%"=="2" (
    echo   This was an audit trail integrity failure. Do NOT keep restarting.
    echo   Preserve the data folder and investigate before starting again.
    echo.
  )
)
echo   Stopped.
pause
endlocal
