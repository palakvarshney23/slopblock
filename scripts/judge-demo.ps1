# SlopBlock — Judge demo launcher (Windows)
# Verifies models, checks port 8083, starts demo service, opens demo.html

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "[SlopBlock] Checking Git LFS models..." -ForegroundColor Cyan
if (Get-Command git -ErrorAction SilentlyContinue) {
    git lfs pull 2>$null
}

if (-not (Test-Path "node_modules")) {
    Write-Host "[SlopBlock] npm install..." -ForegroundColor Cyan
    npm install
}

if (-not (Test-Path "demo.html")) {
    Write-Host "demo.html not found" -ForegroundColor Red
    exit 1
}

Write-Host "[SlopBlock] verify-models + preflight + demo service..." -ForegroundColor Cyan
Write-Host "        Press Ctrl+C to stop." -ForegroundColor DarkGray

npm run judge-demo
