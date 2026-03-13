$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $repoRoot ".tmp-dev-runtime"
$stdoutLog = Join-Path $runtimeDir "dev-stdout.log"
$stderrLog = Join-Path $runtimeDir "dev-stderr.log"
$pidFile = Join-Path $runtimeDir "dev.pid"
$exePath = Join-Path $repoRoot "node_modules/electrobun/.cache/electrobun.exe"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$targets = Get-Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ProcessName -in @("bun", "electrobun") -and
    $_.Path -like "$repoRoot*"
  }

foreach ($process in $targets) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 500

if (!(Test-Path $exePath)) {
  throw "Electrobun executable not found at $exePath"
}

$proc = Start-Process `
  -FilePath $exePath `
  -ArgumentList "dev" `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

Set-Content -Path $pidFile -Value $proc.Id
Write-Output "started pid=$($proc.Id)"
Write-Output "stdout=$stdoutLog"
Write-Output "stderr=$stderrLog"
