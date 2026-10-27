@echo off
chcp 866 >nul
title Planirovshchik otpuskov - server
cd /d "%~dp0"

if not exist "node_modules" goto NOMOD

if "%PORT%"=="" set PORT=3000

echo ============================================
echo   Планировщик отпусков запущен
echo   Откройте в браузере:  http://localhost:%PORT%
echo   Для остановки закройте это окно или Ctrl+C
echo ============================================
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%"

node server.js
echo.
echo Сервер остановлен.
pause
exit /b 0

:NOMOD
echo [ВНИМАНИЕ] Модули не установлены. Сначала запустите install.bat
echo.
pause
exit /b 1
