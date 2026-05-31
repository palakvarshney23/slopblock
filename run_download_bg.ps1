# run_download_bg.ps1
# Wrapper to run SlopBlock dataset download + retrain in background
# Usage: Start-Process powershell -ArgumentList "-File","$PWD\run_download_bg.ps1" -WindowStyle Hidden -WorkingDirectory "$PWD"

$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

# Ensure HF token is available to Python
$token = Get-Content -LiteralPath ".hf_token" -Raw -ErrorAction SilentlyContinue
if ($token) {
    $env:HF_TOKEN = $token.Trim()
}

# Start logging
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logFile = "download_bg_$timestamp.log"

# Run the pipeline
& python download_train_cleanup.py *>> $logFile

# Keep window open briefly on error so you can check logs
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED — check $logFile" -ForegroundColor Red
    Start-Sleep -Seconds 30
}
