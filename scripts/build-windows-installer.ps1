$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "electrobun.config.ts"
$issPath = Join-Path $PSScriptRoot "windows-installer.iss"
$stableBuildDir = Join-Path $projectRoot "build\stable-win-x64\Assistant"
$outputDir = Join-Path $projectRoot "artifacts\windows-installer"
$iconPath = Join-Path $projectRoot "assets\tray-icon.ico"

function Get-InnoSetupCompiler {
  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  throw "ISCC.exe not found. Install Inno Setup 6 and retry."
}

function Get-ConfigValue([string]$pattern, [string]$fallback) {
  $content = Get-Content -Path $configPath -Raw
  $match = [regex]::Match($content, $pattern)
  if ($match.Success) {
    return $match.Groups[1].Value
  }
  return $fallback
}

$appName = Get-ConfigValue 'name:\s*"([^"]+)"' 'Assistant'
$appVersion = Get-ConfigValue 'version:\s*"([^"]+)"' '0.1.0'

Write-Host "Building stable Windows bundle..."
Push-Location $projectRoot
try {
  bun run build -- --env=stable
} finally {
  Pop-Location
}

if (-not (Test-Path $stableBuildDir)) {
  throw "Stable build output not found at $stableBuildDir"
}

if (-not (Test-Path $issPath)) {
  throw "Inno Setup script not found at $issPath"
}

$iscc = Get-InnoSetupCompiler
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Write-Host "Creating Inno Setup installer with $iscc"
& $iscc `
  "/DMyAppName=$appName" `
  "/DMyAppVersion=$appVersion" `
  "/DAppSourceDir=$stableBuildDir" `
  "/DAppIconFile=$iconPath" `
  "/DOutputDir=$outputDir" `
  $issPath

Write-Host "Windows installer created in $outputDir"
