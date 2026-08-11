# PowerShell Automated Installer Script for Rclone Cloud Merger & Mapper
Param(
    [string]$TargetDir = "$env:LOCALAPPDATA\RcloneCloudMerger"
)

$ErrorActionPreference = "Stop"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  Instalador de Rclone Cloud Merger & Mapper" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 1. Prepare Target Directory
Write-Host "[1/4] Creando directorio de instalacion..." -ForegroundColor Yellow
if (-not (Test-Path -Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

$ScriptSource = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptSource

# 2. Copy App Files (Exclude dev folders)
Write-Host "[2/4] Copiando archivos de la aplicacion a $TargetDir..." -ForegroundColor Yellow
$ExcludeItems = @(".git", "node_modules", ".gemini", "tmp", "bin\cache")

Get-ChildItem -Path $ProjectRoot | ForEach-Object {
    $itemName = $_.Name
    if ($ExcludeItems -notcontains $itemName) {
        Copy-Item -Path $_.FullName -Destination $TargetDir -Recurse -Force
    }
}

# Ensure bin/cache directory exists in target
New-Item -ItemType Directory -Path "$TargetDir\bin\cache" -Force | Out-Null

# 3. Create Shortcuts
Write-Host "[3/4] Creando accesos directos en el Escritorio y Menu Inicio..." -ForegroundColor Yellow

$WScriptShell = New-Object -ComObject WScript.Shell
$TargetVbs = "$TargetDir\launch.vbs"

# Desktop Shortcut
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$DesktopShortcutPath = "$DesktopPath\Rclone Cloud Merger.lnk"
$DesktopShortcut = $WScriptShell.CreateShortcut($DesktopShortcutPath)
$DesktopShortcut.TargetPath = "wscript.exe"
$DesktopShortcut.Arguments = "`"$TargetVbs`""
$DesktopShortcut.WorkingDirectory = $TargetDir
$DesktopShortcut.Description = "Rclone Cloud Merger & Mapper - Integracion de Nubes"
$DesktopShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll, 275"
$DesktopShortcut.Save()

# Start Menu Shortcut
$StartMenuPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Programs)
$StartShortcutPath = "$StartMenuPath\Rclone Cloud Merger.lnk"
$StartShortcut = $WScriptShell.CreateShortcut($StartShortcutPath)
$StartShortcut.TargetPath = "wscript.exe"
$StartShortcut.Arguments = "`"$TargetVbs`""
$StartShortcut.WorkingDirectory = $TargetDir
$StartShortcut.Description = "Rclone Cloud Merger & Mapper - Integracion de Nubes"
$StartShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll, 275"
$StartShortcut.Save()

# 4. Create Uninstaller in Target
Write-Host "[4/4] Generando script de desinstalacion..." -ForegroundColor Yellow
$UninstallLines = @(
    '@echo off',
    'title Desinstalando Rclone Cloud Merger...',
    'echo =======================================================',
    'echo   Desinstalando Rclone Cloud Merger...',
    'echo =======================================================',
    'echo Eliminando accesos directos...',
    ("if exist `"{0}`" del /f /q `"{0}`"" -f $DesktopShortcutPath),
    ("if exist `"{0}`" del /f /q `"{0}`"" -f $StartShortcutPath),
    'echo Deteniendo procesos activos...',
    'taskkill /f /im node.exe 2>nul',
    'taskkill /f /im rclone.exe 2>nul',
    'echo Eliminando archivos de aplicacion...',
    'timeout /t 2 /nobreak >nul',
    ("rmdir /s /q `"{0}`" 2>nul" -f $TargetDir),
    'echo =======================================================',
    'echo   Desinstalacion completada con exito.',
    'echo =======================================================',
    'pause'
)

$UninstallPath = "$TargetDir\Uninstall.bat"
Set-Content -Path $UninstallPath -Value $UninstallLines -Encoding ASCII

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  INSTALACION COMPLETADA CON EXITO!" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "  Acceso directo creado en el Escritorio:" -ForegroundColor White
Write-Host "  -> $DesktopShortcutPath" -ForegroundColor Gray
Write-Host "  Acceso directo creado en el Menu Inicio:" -ForegroundColor White
Write-Host "  -> $StartShortcutPath" -ForegroundColor Gray
Write-Host ""
Write-Host "  Ya puedes abrir 'Rclone Cloud Merger' desde tu Escritorio." -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Green
