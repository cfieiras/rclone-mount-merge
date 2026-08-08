@echo off
title Rclone Cloud Merger & Mapper
echo ==========================================================
echo        Rclone Cloud Merger - Gestor de Discos
echo ==========================================================
echo.
cd /d "%~dp0"

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado en este sistema.
    echo Por favor, descarga e instala Node.js desde: https://nodejs.org
    echo.
    pause
    exit /b
)

:: Install dependencies if node_modules does not exist
if not exist node_modules (
    echo [INFO] Instalando modulos de dependencias necesarios...
    call npm install
)

:: Run Server
echo [INFO] Iniciando servidor de control local en el puerto 3000...
echo [INFO] Se abrira una ventana en tu navegador por defecto.
echo.
call npm start
