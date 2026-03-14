@echo off
title OgrodzeniePRO – Launcher
color 0A
chcp 65001 >nul

echo.
echo  ╔══════════════════════════════════════╗
echo  ║     OgrodzeniePRO  –  Uruchamianie  ║
echo  ╚══════════════════════════════════════╝
echo.

set PORT=8080
set URL=http://localhost:%PORT%

REM ── Sprawdź Python ──────────────────────────
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo  [OK] Znaleziono Python
    goto :startPython
)
python3 --version >nul 2>&1
if %errorlevel% == 0 (
    echo  [OK] Znaleziono Python3
    set PYTHON_CMD=python3
    goto :startPython3
)

REM ── Sprawdź Node.js ─────────────────────────
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo  [OK] Znaleziono Node.js
    goto :startNode
)

REM ── Nic nie znaleziono ──────────────────────
echo  [BLAD] Nie znaleziono Python ani Node.js!
echo.
echo  Zainstaluj jedno z ponizszych:
echo    Python:  https://www.python.org/downloads/
echo    Node.js: https://nodejs.org/
echo.
echo  Podczas instalacji Pythona zaznacz opcje:
echo    "Add Python to PATH"
echo.
pause
exit /b 1

REM ── Start: Python ───────────────────────────
:startPython
echo  Uruchamianie serwera na %URL%
echo.
echo  Aplikacja otworzy sie w przegladarce za chwile...
echo  Aby zatrzymac serwer – zamknij to okno.
echo.
start /B cmd /c "timeout /t 2 /nobreak >nul && start %URL%"
python -m http.server %PORT% --bind 127.0.0.1
exit /b

:startPython3
echo  Uruchamianie serwera na %URL%
echo.
echo  Aplikacja otworzy sie w przegladarce za chwile...
echo  Aby zatrzymac serwer – zamknij to okno.
echo.
start /B cmd /c "timeout /t 2 /nobreak >nul && start %URL%"
python3 -m http.server %PORT% --bind 127.0.0.1
exit /b

REM ── Start: Node.js ──────────────────────────
:startNode
echo  Uruchamianie serwera na %URL%
echo.
echo  Aplikacja otworzy sie w przegladarce za chwile...
echo  Aby zatrzymac serwer – zamknij to okno.
echo.
start /B cmd /c "timeout /t 2 /nobreak >nul && start %URL%"
node "%~dp0server.js" %PORT%
exit /b
