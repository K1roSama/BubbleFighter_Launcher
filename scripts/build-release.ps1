$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$package = Get-Content -Raw -LiteralPath (Join-Path $root 'launcher\package.json') | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A stable semantic version is required.' }
if ($env:GITHUB_REF_TYPE -eq 'tag' -and $env:GITHUB_REF_NAME -ne "v$version") {
    throw "Tag $env:GITHUB_REF_NAME does not match package version v$version."
}

Push-Location $root
try {
    foreach ($source in Get-ChildItem -LiteralPath 'launcher' -File -Filter '*.js') {
        & node --check $source.FullName
        if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $($source.Name)" }
    }
    & npm.cmd run package --prefix launcher
    if ($LASTEXITCODE -ne 0) { throw 'Electron package build failed.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File local_server/build_launcher.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Launcher entry build failed.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File local_server/native/build.ps1
    if ($LASTEXITCODE -ne 0) { throw 'Multi-client helper build failed.' }

    $releaseRoot = Join-Path $root 'release'
    $staging = Join-Path $releaseRoot "staging\v$version"
    if (Test-Path -LiteralPath $staging) {
        $resolvedStaging = [IO.Path]::GetFullPath($staging)
        if (!$resolvedStaging.StartsWith([IO.Path]::GetFullPath($releaseRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Invalid staging path.'
        }
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
    $applicationDirectory = Join-Path $staging 'launcher\dist'
    $multiDirectory = Join-Path $staging 'local_server\native\build'
    New-Item -ItemType Directory -Force -Path $applicationDirectory,$multiDirectory | Out-Null
    Copy-Item -LiteralPath 'launcher\dist\BubbleFighterLauncher-win32-x64' -Destination $applicationDirectory -Recurse
    Copy-Item -LiteralPath 'GameLauncher.exe','README.md','LICENSE','THIRD_PARTY_NOTICES.md','CHANGELOG.md' -Destination $staging
    Copy-Item -LiteralPath 'docs' -Destination $staging -Recurse
    Copy-Item -LiteralPath 'launcher\settings.example.json' -Destination (Join-Path $staging 'launcher')
    Copy-Item -LiteralPath 'local_server\native\build\multi_client.exe' -Destination $multiDirectory

    $application = Join-Path $applicationDirectory 'BubbleFighterLauncher-win32-x64'
    foreach ($required in @('BubbleFighterLauncher.exe','resources\app.asar','resources\app.asar.unpacked\native\GameProcess.exe','LICENSE','LICENSES.chromium.html')) {
        if (!(Test-Path -LiteralPath (Join-Path $application $required) -PathType Leaf)) {
            throw "Missing application file: $required"
        }
    }
    $asarFiles = & node 'launcher/node_modules/@electron/asar/bin/asar.mjs' list (Join-Path $application 'resources\app.asar')
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect app.asar.' }
    $asarFiles = @($asarFiles | ForEach-Object { $_.Replace('\', '/') })
    foreach ($required in @('/main.js','/preload.js','/renderer.js','/client.js','/session.js','/game-state.js','/errors.js','/index.html','/dist-css/app.css','/custom.css','/splash.html','/splash.css','/native/GameProcess.exe')) {
        if ($asarFiles -notcontains $required) { throw "Missing packaged resource: $required" }
    }
    $unexpectedFiles = @($asarFiles -match '(^|/)(tests?|node_modules|dev(?:-[^/]*)?\.js|settings[^/]*|package-lock\.json)(/|$)|\.(cs|ps1|test\.js|spec\.js)$')
    if ($unexpectedFiles.Count) {
        throw "Unexpected packaged files: $($unexpectedFiles -join ', ')"
    }

    $zipName = "BubbleFighterLauncher-v$version-win32-x64.zip"
    $zipPath = Join-Path $releaseRoot $zipName
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'SHA256SUMS.txt'), "$hash  $zipName`n", [Text.Encoding]::ASCII)
    Write-Output "Release archive: $zipPath"
    Write-Output "SHA256: $hash"
} finally {
    Pop-Location
}
