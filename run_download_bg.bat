@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

:: Read HF token from file
set /p HF_TOKEN=<.hf_token
set PYTHONUNBUFFERED=1

:: Run with logging
for /f "tokens=2 delims==." %%a in ('wmic os get localdatetime /value ^| find "="') do set dt=%%a
set LOG=download_bg_%dt:~0,14%.log

echo Starting download pipeline... > %LOG%
echo Time: %date% %time% >> %LOG%
echo. >> %LOG%

python download_train_cleanup.py >> %LOG% 2>&1

if %errorlevel% neq 0 (
    echo FAILED — check %LOG%
    timeout /t 30 >nul
)

endlocal
