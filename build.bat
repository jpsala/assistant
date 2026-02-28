@echo off
setlocal

:: ============================================================
:: AI Assistant — Build script
:: Creates a dist/ folder with the compiled exe and all runtime files
:: ============================================================

set "SRC=%~dp0"
set "DIST=%SRC%dist"

:: Find Ahk2Exe — check common locations
set "AHK2EXE="
if exist "C:\Program Files\AutoHotkey\Compiler\Ahk2Exe.exe" set "AHK2EXE=C:\Program Files\AutoHotkey\Compiler\Ahk2Exe.exe"
if exist "%LOCALAPPDATA%\Programs\AutoHotkey\Compiler\Ahk2Exe.exe" set "AHK2EXE=%LOCALAPPDATA%\Programs\AutoHotkey\Compiler\Ahk2Exe.exe"
for /f "delims=" %%i in ('where Ahk2Exe.exe 2^>nul') do set "AHK2EXE=%%i"
if "%AHK2EXE%"=="" (
    echo Ahk2Exe not found. Attempting to install it...
    set "AHK_V2=%LOCALAPPDATA%\Programs\AutoHotkey\v2\AutoHotkey64.exe"
    set "INSTALLER=%LOCALAPPDATA%\Programs\AutoHotkey\UX\install-ahk2exe.ahk"
    if exist "%LOCALAPPDATA%\Programs\AutoHotkey\v2\AutoHotkey64.exe" (
        if exist "%LOCALAPPDATA%\Programs\AutoHotkey\UX\install-ahk2exe.ahk" (
            "%LOCALAPPDATA%\Programs\AutoHotkey\v2\AutoHotkey64.exe" "%LOCALAPPDATA%\Programs\AutoHotkey\UX\install-ahk2exe.ahk"
            timeout /t 3 >nul
        )
    )
    :: Check again after install
    if exist "%LOCALAPPDATA%\Programs\AutoHotkey\Compiler\Ahk2Exe.exe" set "AHK2EXE=%LOCALAPPDATA%\Programs\AutoHotkey\Compiler\Ahk2Exe.exe"
    for /f "delims=" %%i in ('where Ahk2Exe.exe 2^>nul') do set "AHK2EXE=%%i"
)
if "%AHK2EXE%"=="" (
    echo ERROR: Ahk2Exe not found and auto-install failed.
    echo        Run this manually first:
    echo        "%LOCALAPPDATA%\Programs\AutoHotkey\v2\AutoHotkey64.exe" "%LOCALAPPDATA%\Programs\AutoHotkey\UX\install-ahk2exe.ahk"
    pause
    exit /b 1
)

:: Find AutoHotkey v2 base (64-bit)
set "BASE="
if exist "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe" set "BASE=C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"
if exist "%LOCALAPPDATA%\Programs\AutoHotkey\v2\AutoHotkey64.exe" set "BASE=%LOCALAPPDATA%\Programs\AutoHotkey\v2\AutoHotkey64.exe"
if "%BASE%"=="" (
    echo ERROR: AutoHotkey v2 base AutoHotkey64.exe not found.
    pause
    exit /b 1
)

echo Building AI Assistant...
echo Source: %SRC%
echo Compiler: %AHK2EXE%
echo Base: %BASE%
echo Output: %DIST%
echo.

:: Clean dist
if exist "%DIST%" rmdir /s /q "%DIST%"
mkdir "%DIST%"
mkdir "%DIST%\ui"
mkdir "%DIST%\lib\32bit"
mkdir "%DIST%\lib\64bit"

:: Compile
echo Compiling...
set "ICON_FLAG="
if exist "%SRC%icon.ico" set "ICON_FLAG=/icon "%SRC%icon.ico""
"%AHK2EXE%" /in "%SRC%ai-assistant.ahk" /out "%DIST%\ai-assistant.exe" /base "%BASE%" /cp 65001 %ICON_FLAG% /silent verbose
if errorlevel 1 (
    echo ERROR: Compilation failed.
    pause
    exit /b 1
)

:: Copy runtime files
echo Copying runtime files...
copy "%SRC%ui\index.html" "%DIST%\ui\" >nul
copy "%SRC%ui\settings.html" "%DIST%\ui\" >nul
copy "%SRC%ui\prompt-editor.html" "%DIST%\ui\" >nul
copy "%SRC%ui\prompt-confirm.html" "%DIST%\ui\" >nul
copy "%SRC%ui\picker.html" "%DIST%\ui\" >nul
copy "%SRC%prompts.json" "%DIST%\" >nul
copy "%SRC%lib\32bit\WebView2Loader.dll" "%DIST%\lib\32bit\" >nul
copy "%SRC%lib\64bit\WebView2Loader.dll" "%DIST%\lib\64bit\" >nul
if exist "%SRC%icon.ico" copy "%SRC%icon.ico" "%DIST%\" >nul

:: Copy prompt files if @file: references are used
if exist "%SRC%prompts\*.md" (
    if not exist "%DIST%\prompts" mkdir "%DIST%\prompts"
    copy "%SRC%prompts\*.md" "%DIST%\prompts\" >nul
)

:: Copy README for end users
if exist "%SRC%README.dist.md" copy "%SRC%README.dist.md" "%DIST%\README.md" >nul

:: Copy config files if present in source
if exist "%SRC%.env.dist" copy "%SRC%.env.dist" "%DIST%\.env" >nul
if exist "%SRC%model.conf" copy "%SRC%model.conf" "%DIST%\" >nul
if exist "%SRC%settings.conf" copy "%SRC%settings.conf" "%DIST%\" >nul

:: Create zip archive
echo Creating zip...
set "ZIP=%SRC%ai-assistant.zip"
if exist "%ZIP%" del "%ZIP%"
powershell -NoProfile -Command "Compress-Archive -Path '%DIST%\*' -DestinationPath '%ZIP%'"
if errorlevel 1 (
    echo WARNING: Failed to create zip archive.
) else (
    echo Created: ai-assistant.zip
)

echo.
echo Build complete! Output in dist\
echo.
dir /b "%DIST%"
echo.
pause
