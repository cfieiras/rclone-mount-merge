# Release Builder Script
$dist = "$PSScriptRoot\..\dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist -Force | Out-Null

$zipPath = "$dist\RcloneCloudMerger-v1.0.0.zip"
$root = "$PSScriptRoot\.."

$items = Get-ChildItem -Path $root | Where-Object { $_.Name -notmatch '^\.(git|gemini)|node_modules|tmp|dist' }
$paths = $items.FullName

Compress-Archive -Path $paths -DestinationPath $zipPath -Force
Get-Item $zipPath
