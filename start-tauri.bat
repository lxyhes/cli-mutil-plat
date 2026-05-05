@echo off
echo ========================================
echo Starting SpectrAI Tauri Development Mode
echo ========================================
echo.

:: Set Rust path
set PATH=%PATH%;C:\Users\Laobool\.cargo\bin

:: Check Rust
echo Checking Rust installation...
rustc --version
if errorlevel 1 (
    echo ERROR: Rust not found! Please install Rust first.
    pause
    exit /b 1
)
echo.

:: Check Node.js
echo Checking Node.js installation...
node --version
if errorlevel 1 (
    echo ERROR: Node.js not found!
    pause
    exit /b 1
)
echo.

:: Navigate to project directory
cd /d E:\fuke-spec\spectrai-community

:: Install dependencies if needed
if not exist node_modules (
    echo Installing dependencies...
    npm install
    echo.
)

:: Start Tauri dev mode
echo Starting Tauri development mode...
echo This may take a few minutes for the first build...
echo.

npm run tauri:dev

pause
