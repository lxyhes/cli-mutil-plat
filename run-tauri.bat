@echo off
chcp 65001 >nul
echo ========================================
echo 启动 SpectrAI Tauri 开发模式
echo ========================================
echo.

:: 设置 Rust 路径
set PATH=%PATH%;C:\Users\Laobool\.cargo\bin

:: 验证 Rust
echo [1/3] 检查 Rust 环境...
rustc --version >nul 2>&1
if errorlevel 1 (
    echo ✗ 错误: 未找到 Rust，请确保已安装
    pause
    exit /b 1
)
echo ✓ Rust 已就绪
echo.

:: 验证 Node.js
echo [2/3] 检查 Node.js 环境...
node --version >nul 2>&1
if errorlevel 1 (
    echo ✗ 错误: 未找到 Node.js
    pause
    exit /b 1
)
echo ✓ Node.js 已就绪
echo.

:: 进入项目目录
cd /d E:\fuke-spec\spectrai-community

:: 启动 Tauri
echo [3/3] 启动 Tauri 开发模式...
echo ⚠️  首次编译可能需要 10-20 分钟，请耐心等待
echo.

npm run tauri:dev
