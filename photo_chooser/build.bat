@echo off
setlocal
cd /d "%~dp0"
rem Photo Studio - build everything for the version in version.json:
rem   dist\Photo Studio\       the installed app (launcher + libraries + code)
rem   dist\release\X.Y.Z\      installer, update package, notes
rem To publish: build.bat --publish   (see PUBLIER.md)

if exist ".venv\Scripts\activate.bat" call .venv\Scripts\activate.bat
pip install --quiet --upgrade pyinstaller
python release.py %*
if errorlevel 1 (
    echo.
    echo [ERREUR] Voir les messages ci-dessus.
)
pause
