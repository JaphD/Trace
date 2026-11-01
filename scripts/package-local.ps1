$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $releaseRoot
& node -e "if (!require('./scripts/release-utils.cjs').buildCurrent(process.cwd())) { console.error('Run npm run build before packaging.'); process.exit(1); }"
if ($LASTEXITCODE -ne 0) { throw 'The compiled release is stale.' }
$version = (Get-Content -LiteralPath (Join-Path $releaseRoot 'package.json') -Raw | ConvertFrom-Json).version
$releaseName = 'TRACE-v' + $version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$releaseOutput = Join-Path $releaseRoot 'releases'
$releaseStage = Join-Path $releaseOutput $releaseName
New-Item -ItemType Directory -Path $releaseStage -Force | Out-Null
$fileListJson = & node -e "process.stdout.write(JSON.stringify(require('./scripts/release-utils.cjs').packageFiles(process.cwd())))"
if ($LASTEXITCODE -ne 0) { throw 'Could not generate release file list.' }
foreach ($file in ($fileListJson | ConvertFrom-Json)) {
    $destination = Join-Path $releaseStage $file
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $releaseRoot $file) -Destination $destination
}
$archivePath = Join-Path $releaseOutput ($releaseName + '.zip')
Compress-Archive -LiteralPath $releaseStage -DestinationPath $archivePath
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
Set-Content -LiteralPath ($archivePath + '.sha256') -Value ($hash + '  ' + (Split-Path -Leaf $archivePath)) -Encoding ascii
Write-Host ('Local release: ' + $archivePath)
Write-Host ('SHA256: ' + $hash)
