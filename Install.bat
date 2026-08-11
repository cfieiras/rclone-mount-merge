@echo off
title Instalador - Rclone Cloud Merger ^& Mapper
cls
echo =======================================================
echo   Instalador de Rclone Cloud Merger ^& Mapper
echo =======================================================
echo.
echo Iniciando asistente de instalacion automatizada...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"

echo.
pause
