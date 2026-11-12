@echo off
title PhotoChooser
echo  ___  _           _         ____ _                                
echo ^|  _ \^| ^|__   ___ ^| ^|_ ___  / ___^| ^|__   ___   ___  ___  ___ _ __ 
echo ^| ^|_) ^| '_ \ / _ \^| __/ _ \^| ^|   ^| '_ \ / _ \ / _ \/ __^|/ _ \^| '__|
echo ^|  __/^| ^| ^| ^| (_) ^| ^|^| (_) ^| ^|___^| ^| ^| ^| (_) ^| (_) \__ \  __/^| ^|   
echo ^|_^|   ^|_^| ^|_^|\___/ \__\___/ \____^|_^| ^|_^|\___/ \___/^|___/\___^|^|_^|   
echo.
echo  Demarrage en cours...
echo.

cd /d "%~dp0"
rem Ouvre l'application dans sa propre fenetre (Edge ou Chrome en mode application).
rem Pour l'ouvrir dans un onglet normal a la place : set PHOTOCHOOSER_TAB=1
set PHOTOCHOOSER_WINDOW=1
.venv\Scripts\python.exe app.py
pause
