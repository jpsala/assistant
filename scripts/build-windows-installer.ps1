$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot "electrobun.config.ts"
$issPath = Join-Path $PSScriptRoot "windows-installer.iss"
$stableBuildDir = Join-Path $projectRoot "build\stable-win-x64\Assistant"
$stableArchivePath = Join-Path $projectRoot "build\stable-win-x64\Assistant-Setup.tar.zst"
$stagingDir = Join-Path $projectRoot "build\stable-win-x64\installer-stage"
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

function Normalize-WindowsLauncher([string]$bundleDir) {
  $binDir = Join-Path $bundleDir "bin"
  $launcherPath = Join-Path $binDir "launcher"
  $launcherExePath = Join-Path $binDir "launcher.exe"

  if (Test-Path $launcherExePath) {
    return $launcherExePath
  }

  if (Test-Path $launcherPath) {
    Rename-Item -Path $launcherPath -NewName "launcher.exe"
    return $launcherExePath
  }

  throw "Launcher binary not found in $binDir"
}

function Expand-StableBundle([string]$archivePath, [string]$destinationDir) {
  if (-not (Test-Path $archivePath)) {
    throw "Stable archive not found at $archivePath"
  }

  if (Test-Path $destinationDir) {
    Remove-Item -Recurse -Force $destinationDir
  }

  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
  tar --extract --zstd -f $archivePath -C $destinationDir

  $expandedEntries = Get-ChildItem -Path $destinationDir -Directory
  if ($expandedEntries.Count -ne 1) {
    throw "Expected one app bundle directory in $destinationDir after extracting $archivePath"
  }

  return $expandedEntries[0].FullName
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

$stagedAppDir = Expand-StableBundle $stableArchivePath $stagingDir
$launcherExePath = Normalize-WindowsLauncher $stagedAppDir
Write-Host "Using staged app at $stagedAppDir"
Write-Host "Using launcher at $launcherExePath"

$iscc = Get-InnoSetupCompiler
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Write-Host "Creating Inno Setup installer with $iscc"
& $iscc `
  "/DMyAppName=$appName" `
  "/DMyAppVersion=$appVersion" `
  "/DAppSourceDir=$stagedAppDir" `
  "/DAppIconFile=$iconPath" `
  "/DOutputDir=$outputDir" `
  $issPath

Write-Host "Windows installer created in $outputDir"
