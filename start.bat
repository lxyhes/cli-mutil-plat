@echo off
echo ========================================
echo Starting SpectrAI Tauri Dev Mode
echo ========================================
echo.

:: Set Rust path using full path
set CARGO_BIN=C:\Users\Laobool\.cargo\bin
set PATH=%PATH%;%CARGO_BIN%

:: Verify Rust
echo [1/3] Checking Rust environment...
%CARGO_BIN%\rustc.exe --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Rust not found
    pause
    exit /b 1
)
echo OK: Rust is ready
echo.

:: Verify Node.js
echo [2/3] Checking Node.js environment...
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

:: Start Tauri with full cargo path
echo [3/3] Starting Tauri development mode...
echo WARNING: First build may take 10-20 minutes
echo.

:: Use full path to cargo
%CARGO_BIN%\cargo.exe tauri dev

pause
