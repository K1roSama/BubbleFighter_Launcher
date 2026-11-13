$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'GameLauncher.exe'
& $compiler /nologo /codepage:65001 /target:winexe /reference:System.Windows.Forms.dll "/out:$target" (Join-Path $PSScriptRoot 'LauncherEntry.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
Get-Item -LiteralPath $target | Select-Object FullName,Length
