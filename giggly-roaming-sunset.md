# SpectrAI → PrismOps：Electron → Tauri + Rust 全量迁移方案

## Context

用户明确要求将项目从 Electron（Node.js）迁移到 Tauri + Rust，驱动因素：
- 消除 JS 事件循环瓶颈
- 消除垃圾回收暂停 UI 渲染
- 消除解释器开销
- jemalloc/mimalloc 内存优化

现有代码量：35+ IPC 处理器文件、200+ IPC 通道、7 个 AI 适配器、34 个 Zustand stores、60+ 服务类。

---

## 架构设计

### 整体架构
```
┌─────────────────────────────────────────────────┐
│  Tauri App (Rust 主进程)                          │
│  ├── 所有服务 (数据库、PTY、WS、Git 等)            │
│  ├── Tauri 事件总线                              │
│  └── IPC 桥接 (Unix Domain Socket / Named Pipe)  │
│         ↕ binary framed 协议 (4字节头+JSON)      │
│  ┌──────────────────────────────┐               │
│  │  Node.js Sidecar 进程         │               │
│  │  └── ClaudeSdkAdapter (@anthropic-ai/sdk)     │
│  └──────────────────────────────┘               │
│  React Renderer (src/renderer/) — 基本不变        │
└─────────────────────────────────────────────────┘
```

### Rust 专属组件（替代 Node.js 原生模块）
| 原 Node 模块 | Rust 替代 | Crate |
|---|---|---|
| better-sqlite3 | rusqlite | rusqlite |
| node-pty | portable-pty | portable-pty |
| ws (WebSocket) | tokio-tungstenite | tokio-tungstenite |
| Electron 桌面 API | Tauri plugin 系统 | tauri-plugin-* |
| electron-updater | tauri-plugin-updater | tauri-plugin-updater |

### 唯一保留 Node.js 的组件
**Claude SDK 适配器** — `@anthropic-ai/sdk` 是 Node.js only 包，无法直接迁移。采用 Node.js sidecar 进程方案：
- 进程间通信：二进制帧协议（4字节长度前缀 + JSON payload）
- Windows: Named Pipe (`\\.\pipe\prismops-claude-sidecar`)
- Unix: Unix Domain Socket (`/tmp/prismops-claude-sidecar.sock`)

---

## 实施阶段

### Phase 0: 项目脚手架（2-3 周）
**目标：** 让 Tauri shell 能启动现有 React renderer

关键文件：
- `src-tauri/Cargo.toml` — 依赖定义
- `src-tauri/tauri.conf.json` — 窗口/托盘/权限配置
- `src-tauri/src/main.rs` — 入口
- `src-tauri/src/lib.rs` — 服务注册框架

验证：`npm run tauri dev` 能显示 React UI

Cargo 核心依赖：
```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "devtools"] }
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-updater = "2"
tauri-plugin-log = "2"
tauri-plugin-notification = "2"
rusqlite = { version = "0.32", features = ["bundled"] }
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
tokio-tungstenite = "0.26"
portable-pty = "0.8"
mimalloc = "0.1"  # Windows 内存优化
tracing = "0.1"
thiserror = "2"
anyhow = "1"

[profile.release]
lto = true
codegen-units = 1
opt-level = 3
```

### Phase 1: 数据库迁移（4-6 周）
**目标：** rusqlite 替代 better-sqlite3，打开同一个 `.db` 文件

关键文件：`src-tauri/storage/schema.rs`、`src-tauri/storage/migrations.rs`、`src-tauri/storage/repositories/*.rs`（21 个 repository）

策略：翻译 `src/main/storage/migrations.ts` 中的所有 SQL schema，保留 Repository 模式

### Phase 2: 终端仿真（3-4 周）
**目标：** portable-pty 替代 node-pty

关键文件：`src-tauri/pty/manager.rs`、`src-tauri/pty/ansi.rs`

参考现有：`src/main/parser/OutputParser.ts` 中的 ANSI 解析逻辑 → 翻译为 Rust

### Phase 3: AgentBridge WebSocket 服务器（2-3 周）
**目标：** tokio-tungstenite 替代 ws 库，端口 63721

关键文件：`src-tauri/services/agent_bridge.rs`

### Phase 4: 6 个非 Claude 适配器迁移（3-4 周）
| 适配器 | Rust 实现方式 |
|---|---|
| CodexAppServerAdapter | tokio::process::Command (stdio JSON-RPC) |
| GeminiHeadlessAdapter | tokio::process::Command (stdio NDJSON) |
| QwenSdkAdapter | tokio::process::Command (stdio ACP) |
| IFlowAcpAdapter | tokio::process::Command (stdio ACP) |
| OpenCodeSdkAdapter | tokio::process::Command + HTTP |
| OpenAICompatibleAdapter | reqwest 直接 HTTP |

### Phase 5: Claude Sidecar（4-6 周）⭐最难
**目标：** Node.js sidecar + Rust IPC 客户端

关键文件：
- `src-tauri/ipc/named_pipe.rs` (Windows) / `ipc/unix.rs` (Unix)
- `src-tauri/ipc/protocol.rs` (binary framed 协议)
- `src-tauri/services/adapters/claude_sidecar_client.rs`
- `node-sidecar/src/main.ts` (Node.js sidecar 入口)

### Phase 6: 所有服务迁移（6-8 周）
60+ 服务类并行迁移，按依赖复杂度分组。参考：`src/main/index.ts` 中的 `initializeManagers()`

### Phase 7: IPC 命令注册（2-3 周）
**目标：** 200+ Tauri commands 注册完成

关键文件：`src-tauri/commands/*.rs`（35 个文件对应 35 个 IPC handler）

### Phase 8: 系统集成（2-3 周）
托盘、窗口管理、自动更新、全局快捷键、文件对话框等

### Phase 9: 最终清理（2-3 周）
移除所有 Electron 依赖，保留 `src/renderer/` 和 `src/shared/`

---

## 关键参考文件

| 文件 | 作用 |
|---|---|
| `src/main/index.ts` | 主入口，所有服务初始化顺序 |
| `src/main/ipc/index.ts` | 35 个 handler 注册，200+ IPC 通道定义源 |
| `src/preload/index.ts` | 1302 行完整 API surface，迁移后 preload 必须复制此形状 |
| `src/shared/types.ts` | 1296 行跨进程类型定义 → Rust 类型 |
| `src/shared/constants.ts` | IPC 通道名称常量 → Tauri 命令名 |
| `src/main/storage/migrations.ts` | 48 个数据库迁移 → Rust schema |
| `src/main/adapter/ClaudeSdkAdapter.ts` | 最难迁移目标 → Node.js sidecar |
| `src/main/adapter/*.ts` | 其他 6 个适配器 → Rust stdio 客户端 |

---

## 验证方案

1. **Phase 0 验证：** `tauri dev` 启动 → 显示 React UI → 无崩溃
2. **Phase 1 验证：** 相同 SQL 查询在 better-sqlite3 和 rusqlite 上输出一致
3. **Phase 2 验证：** PTY 会话创建/写入/读取/终止端到端测试
4. **Phase 3 验证：** 现有 MCP 客户端能连接 Rust WS 服务器
5. **Phase 4-6 验证：** 每个 provider adapter 会话创建→发送消息→接收输出→终止
6. **Phase 7 验证：** 200+ IPC 通道逐一测试响应正确
7. **最终验证：** 对比 Electron vs Tauri 启动时间、内存占用、GC 暂停次数

---

## 预期总工期

| Phase | 周数 |
|---|---|
| Phase 0: 脚手架 | 2-3 |
| Phase 1: 数据库 | 4-6 |
| Phase 2: 终端 | 3-4 |
| Phase 3: AgentBridge | 2-3 |
| Phase 4: 适配器 | 3-4 |
| Phase 5: Claude Sidecar | 4-6 |
| Phase 6: 服务迁移 | 6-8 |
| Phase 7: IPC 注册 | 2-3 |
| Phase 8: 系统集成 | 2-3 |
| Phase 9: 清理 | 2-3 |
| **总计** | **28-43 周** |

> 建议 Phase 6 服务迁移并行分配 3-4 名工程师同时进行。
