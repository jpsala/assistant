Get-Process -Name 'bun','electrobun' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
node_modules/electrobun/.cache/electrobun.exe dev
