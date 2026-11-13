$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$target = Join-Path $PSScriptRoot 'GameProcess.exe'
& $compiler /nologo /codepage:65001 /target:exe "/out:$target" (Join-Path $PSScriptRoot 'GameProcess.cs')
if ($LASTEXITCODE -ne 0) { throw '启动辅助程序编译失败。' }
