$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\.."

# Read version from package.json
$pkg = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
$version = $pkg.version

Write-Host "Building release v$version..." -ForegroundColor Cyan

Push-Location $root

# The board, then the two executables. FRBoard.exe embeds dist/, so the vite
# build has to finish before it is packed.
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "vite build failed"; exit 1 }
npm run board:build
if ($LASTEXITCODE -ne 0) { Write-Error "board:build failed"; exit 1 }
npm run installer:build
if ($LASTEXITCODE -ne 0) { Write-Error "installer:build failed"; exit 1 }

Pop-Location

# Clean and create release dir
$releaseDir = "$root\release"
if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
New-Item -ItemType Directory -Path $releaseDir | Out-Null

<#
    Zips are written with Python's zipfile rather than Compress-Archive.

    Compress-Archive stores entry names with backslash separators -- "dist\a.js"
    -- which the ZIP spec does not permit. Windows extractors cope, so it looks
    fine, but on Linux and macOS each entry becomes a single file with a
    backslash in its name instead of a directory tree. That is what would have
    broken the EDMC plugin zip, and it silently defeats any tooling that reads
    the archive by path.
#>
function New-Zip {
    param([string]$Destination, [hashtable]$Entries)

    $lines = @(
        "import sys, zipfile",
        "dest = sys.argv[1]",
        "z = zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED)"
    )
    foreach ($name in $Entries.Keys) {
        $src = ($Entries[$name] -replace '\\', '/')
        $lines += "z.write(r'$src', '$name')"
    }
    $lines += "z.close()"

    $script = Join-Path $env:TEMP "frb-zip-$([guid]::NewGuid().ToString('N')).py"
    Set-Content -Path $script -Value $lines -Encoding utf8
    python $script $Destination
    if ($LASTEXITCODE -ne 0) { Remove-Item $script -Force; Write-Error "zip failed: $Destination"; exit 1 }
    Remove-Item $script -Force
}

# --- IRC client scripts, still installed by hand or by FRBoard-Setup ---------
$ircZip = "$releaseDir\IRC_Scripts.zip"
Write-Host "Packaging $ircZip..." -ForegroundColor Cyan
$ircEntries = @{}
Get-ChildItem "$root\scripts\IRC" -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring("$root\scripts\IRC\".Length) -replace '\\', '/'
    $ircEntries[$rel] = $_.FullName
}
New-Zip -Destination $ircZip -Entries $ircEntries

# --- the board on its own, for anyone not using the single exe --------------
$appZip = "$releaseDir\Dispatch_Board_v$version.zip"
Write-Host "Packaging $appZip..." -ForegroundColor Cyan
$appEntries = @{}
Get-ChildItem "$root\dist" -Recurse -File | ForEach-Object {
    $rel = "dist/" + ($_.FullName.Substring("$root\dist\".Length) -replace '\\', '/')
    $appEntries[$rel] = $_.FullName
}
$bat = "$root\Launch Dispatch Board.bat"
if (Test-Path $bat) { $appEntries["Launch Dispatch Board.bat"] = $bat }
New-Zip -Destination $appZip -Entries $appEntries

# --- executables ------------------------------------------------------------
foreach ($exe in @("FRBoard.exe", "FRBoard-Setup.exe")) {
    $src = "$root\bridge-dist\$exe"
    if (-not (Test-Path $src)) { Write-Error "$exe not found at $src"; exit 1 }
    Copy-Item $src "$releaseDir\$exe"
}

Write-Host ""
Write-Host "Release v$version ready in .\release\" -ForegroundColor Green
Get-ChildItem $releaseDir | ForEach-Object {
    Write-Host ("  {0,-32} {1,10:N0} bytes" -f $_.Name, $_.Length) -ForegroundColor White
}
