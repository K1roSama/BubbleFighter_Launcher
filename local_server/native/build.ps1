$ErrorActionPreference = 'Stop'
$buildDirectory = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $vswhere) {
    $vcvars = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'VC\Auxiliary\Build\vcvars32.bat' | Select-Object -First 1
    if ($vcvars) {
        $compilerEnvironment = & $env:ComSpec /d /c "call `"$vcvars`" >nul && set"
        if ($LASTEXITCODE -ne 0) { throw 'Failed to configure the MSVC x86 environment.' }
        foreach ($line in $compilerEnvironment) {
            $separator = $line.IndexOf('=')
            if ($separator -gt 0) {
                [Environment]::SetEnvironmentVariable($line.Substring(0, $separator), $line.Substring($separator + 1), 'Process')
            }
        }
    }
}
if (!(Get-Command cl.exe -ErrorAction SilentlyContinue) -or $env:VSCMD_ARG_TGT_ARCH -ne 'x86') {
    throw 'Install MSVC x86/x64 build tools and Windows SDK, or use an x86 Developer PowerShell.'
}

Push-Location $buildDirectory
try {
    & cl.exe /nologo /O2 /W4 /DUNICODE /D_UNICODE /MT (Join-Path $PSScriptRoot 'multi_client.c') /Fe:multi_client.exe /link /MACHINE:X86
    if ($LASTEXITCODE -ne 0) { throw 'Multi-client helper build failed.' }
} finally {
    Pop-Location
}
