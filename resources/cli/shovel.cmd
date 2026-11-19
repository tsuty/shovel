@echo off
rem shovel command line tool (Windows). Starts shovel with the arguments and returns at once.
rem Kept ASCII-only: cmd.exe reads batch files in the console code page.
setlocal

set "SHOVEL_VERSION=__SHOVEL_VERSION__"
set "SHOVEL_APP=%~dp0..\shovel.exe"

if /i "%~1"=="-h" goto usage
if /i "%~1"=="--help" goto usage
if /i "%~1"=="/?" goto usage
if /i "%~1"=="-v" goto version
if /i "%~1"=="--version" goto version

set "SHOVEL_TARGET=%~1"
if "%~1"=="--" set "SHOVEL_TARGET=%~2"
if "%~1"=="--" set "SHOVEL_LITERAL=1"
if "%~1"=="--" shift
if not "%~2"=="" (
  echo shovel: too many arguments 1>&2
  echo Try 'shovel --help' for more information. 1>&2
  exit /b 2
)
if not defined SHOVEL_LITERAL if defined SHOVEL_TARGET if "%SHOVEL_TARGET:~0,1%"=="-" (
  echo shovel: unknown option: %SHOVEL_TARGET% 1>&2
  echo Try 'shovel --help' for more information. 1>&2
  exit /b 2
)

if not exist "%SHOVEL_APP%" (
  echo shovel: the shovel application was not found: %SHOVEL_APP% 1>&2
  echo Reinstall shovel. 1>&2
  exit /b 1
)

if not defined SHOVEL_TARGET (
  start "" "%SHOVEL_APP%" --shovel-cli
) else (
  start "" "%SHOVEL_APP%" --shovel-cli -- "%SHOVEL_TARGET%"
)
exit /b 0

:usage
echo Usage: shovel [path]
echo.
echo Open the directory at ^<path^> as a shovel project (default: the current directory).
echo.
echo   - If a shovel project already uses the directory, it is opened.
echo   - Otherwise a project is added from the Docker Sandboxes sandbox whose
echo     workspace is the directory (sbx ls). No sandbox is created.
echo.
echo Options:
echo   -h, --help       Show this help and exit.
echo   -v, --version    Show the version and exit.
exit /b 0

:version
echo shovel %SHOVEL_VERSION%
exit /b 0
