@echo off
chcp 65001 >nul
echo ========================================
echo Starting SpectrAI Tauri Development Mode
echo ========================================
echo.

:: Set Rust path
set CARGO_BIN=C:\Users\Laobool\.cargo\bin
set PATH=%PATH%;%CARGO_BIN%

:: Verify Rust
echo [1/4] Checking Rust environment...
%CARGO_BIN%\rustc.exe --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Rust not found
    pause
    exit /b 1
)
echo OK: Rust is ready
echo.

:: Verify Node.js
echo [2/4] Checking Node.js environment...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found
    pause
    exit /b 1
)
echo OK: Node.js is ready
echo.

:: Change to project directory
cd /d E:\fuke-spec\spectrai-community

:: Kill existing instances
echo [3/4] Closing existing PrismOps instances...
taskkill /F /IM prismops.exe 2>nul
if not errorlevel 1 (
    echo OK: Existing instance closed
) else (
    echo INFO: No existing instance found
)
echo.

:: Start Tauri dev mode
echo [4/4] Starting Tauri development mode...
echo WARNING: First build may take 10-20 minutes
echo.

%CARGO_BIN%\cargo.exe tauri dev

pause
