$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\.."

# Read version from package.json
$pkg = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
$version = $pkg.version

Write-Host "Building release v$version..." -ForegroundColor Cyan

# Run build:all
Push-Location $root
npm run build:all
if ($LASTEXITCODE -ne 0) { Write-Error "build:all failed"; exit 1 }
Pop-Location

# Clean and create release dir
$releaseDir = "$root\release"
if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
New-Item -ItemType Directory -Path $releaseDir | Out-Null

# Zip dist + bat -> Dispatch_Board_vX.X.X.zip
$appZip = "$releaseDir\Dispatch_Board_v$version.zip"
Write-Host "Packaging $appZip..." -ForegroundColor Cyan
Compress-Archive -Path "$root\dist", "$root\Launch Dispatch Board.bat" -DestinationPath $appZip -Force

# Zip scripts\IRC -> IRC_Scripts.zip
$ircZip = "$releaseDir\IRC_Scripts.zip"
Write-Host "Packaging $ircZip..." -ForegroundColor Cyan
Compress-Archive -Path "$root\scripts\IRC\*" -DestinationPath $ircZip -Force

# Copy bridge.exe
$bridgeExe = "$root\bridge-dist\bridge.exe"
if (-not (Test-Path $bridgeExe)) { Write-Error "bridge.exe not found at $bridgeExe"; exit 1 }
Copy-Item $bridgeExe "$releaseDir\bridge.exe"

Write-Host ""
Write-Host "Release v$version ready in .\release\" -ForegroundColor Green
Write-Host "  Dispatch_Board_v$version.zip" -ForegroundColor White
Write-Host "  IRC_Scripts.zip" -ForegroundColor White
Write-Host "  bridge.exe" -ForegroundColor White
