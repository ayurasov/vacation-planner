@echo off
chcp 866 >nul
title Planirovshchik otpuskov - ustanovka
cd /d "%~dp0"
echo.
echo ============================================
echo   Установка зависимостей (выполняется один раз)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto NONODE

echo Найден Node.js:
node -v
echo.
echo Устанавливаю модули. Это может занять 1-3 минуты...
echo.
call npm install
if errorlevel 1 goto FAIL

echo.
echo Готово. Теперь запускайте start.bat
echo.
pause
exit /b 0

:NONODE
echo [ОШИБКА] Node.js не найден.
echo Установите Node.js LTS 18+ с сайта https://nodejs.org и запустите снова.
echo.
pause
exit /b 1

:FAIL
echo.
echo [ОШИБКА] Установка не удалась.
echo Если ошибка про сборку better-sqlite3 - установите Visual Studio Build Tools
echo (компонент Desktop development with C++) или переустановите Node.js LTS
echo с галочкой автоустановки инструментов, затем запустите install.bat снова.
echo.
pause
exit /b 1
