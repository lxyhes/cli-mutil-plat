# SpectrAI Tauri 启动脚本 (PowerShell)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting SpectrAI Tauri Development Mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set Rust path
$env:PATH += ";C:\Users\Laobool\.cargo\bin"

# Check Rust
Write-Host "Checking Rust installation..." -ForegroundColor Yellow
try {
    $rustVersion = rustc --version
    Write-Host "✓ Rust installed: $rustVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Rust not found!" -ForegroundColor Red
    Write-Host "Please install Rust from https://rustup.rs/" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js installed: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ ERROR: Node.js not found!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

# Navigate to project directory
Set-Location "E:\fuke-spec\spectrai-community"

# Install dependencies if needed
if (-Not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Start Tauri dev mode
Write-Host "Starting Tauri development mode..." -ForegroundColor Cyan
Write-Host "This may take a few minutes for the first build..." -ForegroundColor Yellow
Write-Host ""

npm run tauri:dev

Read-Host "Press Enter to exit"
