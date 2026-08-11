@echo off
title Desinstalador - Rclone Cloud Merger & Mapper
cls
echo =======================================================
echo   Desinstalador - Rclone Cloud Merger & Mapper
echo =======================================================
echo.

set TARGET_DIR=%LOCALAPPDATA%\RcloneCloudMerger
set DESKTOP_LNK=%USERPROFILE%\Desktop\Rclone Cloud Merger.lnk
set START_LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Rclone Cloud Merger.lnk

echo [1/3] Eliminando accesos directos de Windows...
if exist "%DESKTOP_LNK%" del /f /q "%DESKTOP_LNK%"
if exist "%START_LNK%" del /f /q "%START_LNK%"

echo [2/3] Deteniendo procesos de Rclone y Node...
taskkill /f /im rclone.exe 2>nul
taskkill /f /im node.exe 2>nul

echo [3/3] Eliminando directorio de instalacion...
if exist "%TARGET_DIR%" rmdir /s /q "%TARGET_DIR%" 2>nul

echo.
echo =======================================================
echo   ¡Desinstalacion completada con exito!
echo =======================================================
echo.
pause
