$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12+ first.' }
& node (Join-Path $PSScriptRoot 'scripts/launch-trace.cjs')
if ($LASTEXITCODE -ne 0) { throw 'TRACE did not start. See the message above.' }

