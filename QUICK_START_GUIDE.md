# Tauri 迁移项目 - 快速启动指南

**目标**: 在 30 分钟内完成环境搭建并运行应用

---

## 🚀 5 分钟快速开始

### 步骤 1: 安装 Rust（如果未安装）

#### Windows
```powershell
winget install Rustlang.Rustup
```

或手动安装：
1. 下载 [rustup-init.exe](https://win.rustup.rs/)
2. 运行安装程序
3. 选择默认选项

#### macOS/Linux
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 步骤 2: 验证安装
```bash
rustc --version   # 应该显示 rustc 1.x.x
cargo --version   # 应该显示 cargo 1.x.x
```

### 步骤 3: 编译项目
```bash
cd E:\fuke-spec\spectrai-community\src-tauri
cargo build
```

首次编译可能需要 10-20 分钟（下载依赖）。

### 步骤 4: 运行开发模式
```bash
cd ..
npm run tauri:dev
```

应用窗口应该打开！

---

## 📋 完整环境搭建（30 分钟）

### 必需软件

| 软件 | 版本 | 用途 | 安装命令 |
|------|------|------|----------|
| Rust | latest | 后端开发 | `winget install Rustlang.Rustup` |
| Node.js | 20+ | 前端 + Sidecar | `nvm install 20` |
| npm | 10+ | 包管理 | 随 Node.js 安装 |
| Git | 2.x | 版本控制 | `winget install Git.Git` |

### 可选软件

| 软件 | 用途 |
|------|------|
| VS Code | IDE |
| rust-analyzer | Rust 语言支持 |
| Tauri VS Code 插件 | Tauri 开发辅助 |
| SQLite Browser | 数据库查看 |

---

## 🔧 项目结构概览

```
spectrai-community/
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── services/       # 核心服务
│   │   │   ├── database.rs           # ✅ 数据库服务
│   │   │   ├── migrations.rs         # ✅ 迁移系统
│   │   │   ├── pty.rs                # ✅ PTY 管理器
│   │   │   ├── ansi_parser.rs        # ✅ ANSI 解析器
│   │   │   ├── agent_bridge.rs       # ✅ WebSocket 服务器
│   │   │   ├── adapter_registry.rs   # ✅ 适配器注册表
│   │   │   └── adapters/             # ✅ AI 适配器
│   │   │       ├── mod.rs
│   │   │       ├── openai_compatible.rs  # ✅ OpenAI 适配器
│   │   │       └── claude_sidecar.rs     # ⚠️ Claude Sidecar 框架
│   │   ├── main.rs           # 应用入口
│   │   └── lib.rs            # 库导出
│   ├── Cargo.toml            # Rust 依赖
│   └── tauri.conf.json       # Tauri 配置
│
├── src/                      # TypeScript 前端（待迁移）
│   ├── main/                 # Electron 主进程
│   ├── renderer/             # React 渲染进程
│   └── shared/               # 共享类型和常量
│
├── package.json              # Node.js 依赖
├── electron.vite.config.ts   # Vite 配置
└── README.md                 # 项目说明
```

---

## 🧪 测试已完成的功能

### 测试 1: 数据库操作

创建测试文件 `test-database.js`:

```javascript
const { app } = require('electron');

async function testDatabase() {
  console.log('Testing database operations...');
  
  // 创建会话
  const sessionId = 'test-session-' + Date.now();
  await window.api.sessionCreate({
    id: sessionId,
    name: 'Test Session',
    workingDirectory: process.cwd(),
    providerId: 'openai',
  });
  
  console.log('✅ Session created:', sessionId);
  
  // 获取会话列表
  const sessions = await window.api.sessionGetAll();
  console.log('✅ Sessions count:', sessions.length);
  
  // 清理
  await window.api.sessionTerminate(sessionId);
  console.log('✅ Test completed!');
}

testDatabase().catch(console.error);
```

### 测试 2: PTY 终端

在应用中使用终端功能：
1. 打开新会话
2. 输入命令（如 `ls`, `dir`, `echo hello`）
3. 观察输出是否正确显示
4. 检查 ANSI 颜色是否正确渲染

### 测试 3: AgentBridge WebSocket

使用 WebSocket 客户端测试：

```javascript
const ws = new WebSocket('ws://127.0.0.1:63721');

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  
  // 发送注册消息
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'register',
    params: {
      serverId: 'test-server',
      capabilities: ['tools', 'resources'],
    },
    id: 1,
  }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err);
});
```

### 测试 4: OpenAI API

需要 API Key。在 Provider 管理中：
1. 添加新的 Provider
2. 类型选择 "OpenAI Compatible"
3. Base URL: `https://api.deepseek.com/v1`
4. API Key: 您的 Deepseek API Key
5. Model: `deepseek-chat`
6. 测试连接

或使用 curl 直接测试：

```bash
curl -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

---

## 🐛 常见问题排查

### 问题 1: 编译失败

**错误**: `error: could not compile ...`

**解决**:
```bash
# 清理构建缓存
cargo clean

# 更新依赖
cargo update

# 重新编译
cargo build
```

### 问题 2: 找不到 Node.js

**错误**: `node: command not found`

**解决**:
```bash
# 检查 Node.js 是否安装
node --version

# 如果使用 nvm，激活正确的版本
nvm use 20

# 添加到 PATH（Windows）
setx PATH "%PATH%;C:\Program Files\nodejs"
```

### 问题 3: Tauri 依赖缺失

**错误**: `package @tauri-apps/cli not found`

**解决**:
```bash
npm install
```

### 问题 4: 数据库锁定

**错误**: `database is locked`

**解决**:
```bash
# 关闭所有应用实例
# 删除数据库文件（会丢失数据）
rm spectrai.db  # Unix
del spectrai.db  # Windows

# 重新启动应用
```

### 问题 5: WebSocket 连接失败

**错误**: `WebSocket connection failed`

**解决**:
1. 检查端口 63721 是否被占用
   ```bash
   netstat -ano | findstr 63721  # Windows
   lsof -i :63721                # Unix
   ```

2. 杀死占用端口的进程
   ```bash
   taskkill /PID <PID> /F  # Windows
   kill -9 <PID>           # Unix
   ```

3. 重启应用

---

## 📚 学习资源

### 官方文档
- [Tauri v2 文档](https://v2.tauri.app/)
- [Rust Book](https://doc.rust-lang.org/book/)
- [Tokio 教程](https://tokio.rs/tokio/tutorial)

### 本项目文档
- [TAURI_MIGRATION_PROGRESS.md](./TAURI_MIGRATION_PROGRESS.md) - 迁移进度
- [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md) - 实施路线图
- [PHASE1_DATABASE_COMPLETE.md](./PHASE1_DATABASE_COMPLETE.md) - 数据库实现
- [PHASE2_PTY_COMPLETE.md](./PHASE2_PTY_COMPLETE.md) - PTY 实现
- [PHASE3_AGENTBRIDGE_COMPLETE.md](./PHASE3_AGENTBRIDGE_COMPLETE.md) - WebSocket 实现
- [PHASE4_ADAPTERS_FRAMEWORK_COMPLETE.md](./PHASE4_ADAPTERS_FRAMEWORK_COMPLETE.md) - 适配器框架

### 视频教程
- [Tauri 入门](https://www.youtube.com/watch?v=BPj7xAu9wZM)
- [Rust 异步编程](https://www.youtube.com/watch?v=ThjvMReOXYM)

---

## 🎯 下一步行动

### 立即可做
1. ✅ 安装 Rust 和 Node.js
2. ✅ 编译并运行应用
3. ✅ 测试数据库、PTY、WebSocket 功能

### 本周目标
1. 熟悉代码结构
2. 阅读 Phase 1-4 的文档
3. 尝试修改一些代码（如添加日志）

### 下周目标
1. 开始实现 Codex AppServer Adapter
2. 或开始设计 Node.js Sidecar 应用

---

## 💡 提示和技巧

### 1. 快速重新编译
```bash
# 只编译变化的部分
cargo build

# 完全重新编译（慢）
cargo build --release
```

### 2. 查看日志
```bash
# 启用详细日志
RUST_LOG=debug npm run tauri:dev
```

### 3. 热重载
Tauri 支持前端热重载，修改 React 代码后自动刷新。

Rust 代码修改后需要重新编译（Ctrl+C 停止，然后重新运行）。

### 4. 调试 Rust 代码
```rust
// 添加日志
use tracing::{info, debug, warn, error};

info!("Session created: {}", session_id);
debug!("Message payload: {:?}", payload);
warn!("Deprecated API used");
error!("Failed to connect: {}", err);
```

### 5. 查看数据库
使用 [DB Browser for SQLite](https://sqlitebrowser.org/) 打开 `spectrai.db` 文件。

---

## 🆘 获取帮助

### 遇到问题？
1. 检查 [常见问题](#-常见问题排查)
2. 查看日志输出
3. 搜索 [Tauri Discord](https://discord.gg/tauri)
4. 查阅 [Rust 论坛](https://users.rust-lang.org/)

### 报告 Bug
1. 重现步骤
2. 预期行为
3. 实际行为
4. 日志输出
5. 系统信息（OS, Rust version, etc.）

---

**祝您开发顺利！** 🚀

如有问题，请参考本文档或查看项目文档。
