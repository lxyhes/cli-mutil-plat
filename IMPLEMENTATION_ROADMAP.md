# Tauri 迁移项目 - 完整实施路线图

**生成日期**: 2026-05-05  
**当前进度**: 40-45% 完成  
**预计剩余**: 17-30 周  

---

## 📋 Phase 完成情况概览

```
Phase 0: 项目脚手架        ████████████████████░░ 90%  ✅ 基本完成
Phase 1: 数据库迁移        ███████████████████░░░ 95%  ✅ 接近完成
Phase 2: 终端仿真          ██████████████░░░░░░░░ 70%  ✅ 核心功能完成
Phase 3: AgentBridge WS    ████████████████░░░░░░ 80%  ✅ 核心功能完成
Phase 4: AI 适配器         ██████░░░░░░░░░░░░░░░░ 30%  ✅ 框架完成
Phase 5: Claude Sidecar    ░░░░░░░░░░░░░░░░░░░░░░  0%  ❌ 未开始
Phase 6: 服务迁移          █░░░░░░░░░░░░░░░░░░░░░  5%  ❌ 未开始
Phase 7: IPC 命令注册      █░░░░░░░░░░░░░░░░░░░░░  5%  ❌ 未开始
Phase 8: 系统集成          ████████████░░░░░░░░░░ 60%  ✅ 部分完成
Phase 9: 最终清理          ░░░░░░░░░░░░░░░░░░░░░░  0%  ❌ 未开始
```

---

## 🎯 立即行动项（本周）

### P0 - 最高优先级

#### 1. 测试验证已完成的功能
**工作量**: 1-2 天  
**负责人**: 开发团队

```bash
# 1. 安装 Rust 环境
winget install Rustlang.Rustup  # Windows
# 或
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh  # Unix

# 2. 编译项目
cd src-tauri
cargo build

# 3. 运行开发模式
npm run tauri:dev

# 4. 验证功能
# - 数据库读写操作
# - PTY 终端输出
# - WebSocket 连接
# - OpenAI API 调用
```

**验收标准**:
- [ ] 应用成功启动
- [ ] 数据库可以创建和查询
- [ ] PTY 会话可以创建和交互
- [ ] AgentBridge WebSocket 可以接受连接
- [ ] OpenAI Adapter 可以发送请求

#### 2. 修复编译错误和警告
**工作量**: 1 天  
**依赖**: Rust 环境安装

```bash
# 检查编译问题
cargo check
cargo clippy

# 修复所有警告和错误
# 重点关注：
# - unused imports
# - type mismatches
# - async/await 问题
```

---

## 📅 短期目标（2-4 周）

### Week 1-2: 完成 Phase 4 - AI 适配器

#### 任务 4.1: Codex AppServer Adapter
**工作量**: 3-4 天  
**文件**: `src-tauri/src/services/adapters/codex_appserver.rs`

**实现步骤**:
1. [ ] 创建 `CodexAppServerAdapter` 结构体
2. [ ] 实现 stdio JSON-RPC 通信
   ```rust
   use tokio::process::Command;
   use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
   
   let mut child = Command::new("codex")
       .arg("app-server")
       .stdin(Stdio::piped())
       .stdout(Stdio::piped())
       .stderr(Stdio::piped())
       .spawn()?;
   ```
3. [ ] 实现 NDJSON 解析器
4. [ ] 实现权限确认处理
5. [ ] 实现流式响应
6. [ ] 添加到适配器注册表

**参考**: `src/main/adapter/CodexAppServerAdapter.ts` (579+ 行)

#### 任务 4.2: Gemini Headless Adapter
**工作量**: 3-4 天  
**文件**: `src-tauri/src/services/adapters/gemini_headless.rs`

**实现步骤**:
1. [ ] 创建 `GeminiHeadlessAdapter` 结构体
2. [ ] 实现 stdio NDJSON 通信
3. [ ] 实现 OAuth 认证流程
4. [ ] 实现会话管理
5. [ ] 实现流式响应
6. [ ] 添加到适配器注册表

**参考**: `src/main/adapter/GeminiHeadlessAdapter.ts`

#### 任务 4.3: Qwen/IFlow ACP Adapters
**工作量**: 4-5 天  
**文件**: 
- `src-tauri/src/services/adapters/qwen_acp.rs`
- `src-tauri/src/services/adapters/iflow_acp.rs`

**实现步骤**:
1. [ ] 实现 shared process 管理
2. [ ] 实现 JSON-RPC over stdio
3. [ ] 实现 MCP 配置注入
4. [ ] 实现权限确认处理
5. [ ] 实现会话预热（IFlow）
6. [ ] 添加到适配器注册表

**参考**: 
- `src/main/adapter/QwenSdkAdapter.ts` (608+ 行)
- `src/main/adapter/IFlowAcpAdapter.ts` (1200+ 行)

#### 任务 4.4: OpenCode SDK Adapter
**工作量**: 2-3 天  
**文件**: `src-tauri/src/services/adapters/opencode_sdk.rs`

**实现步骤**:
1. [ ] 实现 HTTP server spawn
2. [ ] 实现 SSE 事件订阅
3. [ ] 实现 SDK 客户端管理
4. [ ] 添加到适配器注册表

**参考**: `src/main/adapter/OpenCodeSdkAdapter.ts` (502+ 行)

---

### Week 3-4: 开始 Phase 5 - Claude Sidecar

#### 任务 5.1: 设计 Node.js Sidecar 应用
**工作量**: 3-4 天  
**目录**: `node-sidecar/`

**项目结构**:
```
node-sidecar/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts           # 入口文件
│   ├── ipc/
│   │   ├── protocol.ts   # IPC 协议实现
│   │   ├── named-pipe.ts # Windows Named Pipe
│   │   └── unix-socket.ts # Unix Socket
│   ├── claude/
│   │   ├── sdk-wrapper.ts # Claude SDK 封装
│   │   └── query-api.ts   # V1 Query API
│   └── utils/
│       └── logger.ts
└── README.md
```

**实现步骤**:
1. [ ] 初始化 Node.js 项目
   ```bash
   mkdir node-sidecar
   cd node-sidecar
   npm init -y
   npm install @anthropic-ai/claude-agent-sdk ws uuid
   npm install -D typescript @types/node @types/ws
   ```

2. [ ] 实现 IPC 协议
   ```typescript
   // 4-byte length prefix + JSON payload
   function encodeMessage(msg: any): Buffer {
     const json = JSON.stringify(msg);
     const length = Buffer.alloc(4);
     length.writeUInt32BE(json.length, 0);
     return Buffer.concat([length, Buffer.from(json)]);
   }
   
   function decodeMessage(buffer: Buffer): any {
     const length = buffer.readUInt32BE(0);
     const json = buffer.slice(4, 4 + length).toString();
     return JSON.parse(json);
   }
   ```

3. [ ] 实现 Named Pipe (Windows)
   ```typescript
   import * as net from 'net';
   
   const pipeName = '\\\\.\\pipe\\claude-sidecar';
   const server = net.createServer((socket) => {
     socket.on('data', (data) => {
       const msg = decodeMessage(data);
       handleMessage(msg, socket);
     });
   });
   
   server.listen(pipeName);
   ```

4. [ ] 实现 Unix Socket (Unix)
   ```typescript
   import * as net from 'net';
   import * as fs from 'fs';
   
   const socketPath = '/tmp/claude-sidecar.sock';
   if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
   
   const server = net.createServer((socket) => {
     socket.on('data', (data) => {
       const msg = decodeMessage(data);
       handleMessage(msg, socket);
     });
   });
   
   server.listen(socketPath);
   ```

5. [ ] 封装 Claude SDK
   ```typescript
   import { query } from '@anthropic-ai/claude-agent-sdk';
   
   async function handleQuery(params: any, socket: net.Socket) {
     const q = await query({
       workingDirectory: params.workingDirectory,
       mcpServers: params.mcpServers,
       settingSources: params.settingSources,
     });
     
     // Send session ID back
     sendResponse(socket, { sessionId: q.sessionId });
     
     // Stream events
     for await (const event of q) {
       sendEvent(socket, event);
     }
   }
   ```

6. [ ] 实现消息路由
   ```typescript
   async function handleMessage(msg: IpcMessage, socket: net.Socket) {
     switch (msg.msg_type) {
       case 'query':
         await handleQuery(msg.payload, socket);
         break;
       case 'prompt':
         await handlePrompt(msg.payload, socket);
         break;
       case 'interrupt':
         await handleInterrupt(msg.payload, socket);
         break;
       default:
         sendError(socket, `Unknown message type: ${msg.msg_type}`);
     }
   }
   ```

#### 任务 5.2: 实现 Rust IPC 客户端
**工作量**: 4-5 天  
**文件**: `src-tauri/src/services/ipc/`

**实现步骤**:
1. [ ] 创建 IPC 模块
   ```
   src-tauri/src/services/ipc/
   ├── mod.rs
   ├── protocol.rs      # 二进制帧协议
   ├── named_pipe.rs    # Windows Named Pipe
   └── unix_socket.rs   # Unix Socket
   ```

2. [ ] 实现二进制帧协议
   ```rust
   pub fn encode_message(msg: &IpcMessage) -> Result<Vec<u8>> {
       let json = serde_json::to_vec(msg)?;
       let length = (json.len() as u32).to_be_bytes();
       let mut buffer = Vec::with_capacity(4 + json.len());
       buffer.extend_from_slice(&length);
       buffer.extend_from_slice(&json);
       Ok(buffer)
   }
   
   pub fn decode_message(buffer: &[u8]) -> Result<IpcMessage> {
       let length = u32::from_be_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]) as usize;
       let json = &buffer[4..4 + length];
       Ok(serde_json::from_slice(json)?)
   }
   ```

3. [ ] 实现 Windows Named Pipe
   ```rust
   #[cfg(windows)]
   use windows::Win32::System::Pipes::*;
   
   pub struct NamedPipeClient {
       handle: HANDLE,
   }
   
   impl NamedPipeClient {
       pub fn connect(pipe_name: &str) -> Result<Self> {
           let handle = unsafe {
               CreateFileW(
                   pipe_name,
                   GENERIC_READ | GENERIC_WRITE,
                   0,
                   None,
                   OPEN_EXISTING,
                   FILE_FLAG_OVERLAPPED,
                   None,
               )?
           };
           Ok(Self { handle })
       }
       
       pub async fn send(&self, data: &[u8]) -> Result<()> {
           // Implement async write
       }
       
       pub async fn receive(&self) -> Result<Vec<u8>> {
           // Implement async read
       }
   }
   ```

4. [ ] 实现 Unix Socket
   ```rust
   #[cfg(unix)]
   use tokio::net::UnixStream;
   
   pub struct UnixSocketClient {
       stream: UnixStream,
   }
   
   impl UnixSocketClient {
       pub async fn connect(socket_path: &str) -> Result<Self> {
           let stream = UnixStream::connect(socket_path).await?;
           Ok(Self { stream })
       }
       
       pub async fn send(&mut self, data: &[u8]) -> Result<()> {
           self.stream.write_all(data).await?;
           Ok(())
       }
       
       pub async fn receive(&mut self) -> Result<Vec<u8>> {
           let mut buffer = vec![0u8; 4096];
           let n = self.stream.read(&mut buffer).await?;
           Ok(buffer[..n].to_vec())
       }
   }
   ```

5. [ ] 集成到 ClaudeSidecarAdapter
   ```rust
   impl ClaudeSidecarAdapter {
       async fn send_ipc_message(&self, msg: IpcMessage) -> Result<()> {
           let encoded = encode_message(&msg)?;
           
           #[cfg(windows)]
           self.named_pipe_client.send(&encoded).await?;
           
           #[cfg(unix)]
           self.unix_socket_client.send(&encoded).await?;
           
           Ok(())
       }
       
       async fn receive_ipc_event(&self) -> Result<IpcMessage> {
           #[cfg(windows)]
           let data = self.named_pipe_client.receive().await?;
           
           #[cfg(unix)]
           let data = self.unix_socket_client.receive().await?;
           
           decode_message(&data)
       }
   }
   ```

#### 任务 5.3: 测试和调试
**工作量**: 2-3 天

**测试场景**:
1. [ ] Sidecar 进程启动和停止
2. [ ] IPC 连接建立
3. [ ] 消息发送和接收
4. [ ] Claude SDK 调用
5. [ ] 流式响应处理
6. [ ] 错误处理和恢复

---

## 📅 中期目标（5-12 周）

### Week 5-10: Phase 6 - 服务迁移

#### 高优先级服务（Week 5-7）
1. [ ] **CostService** - 成本追踪
2. [ ] **CheckpointService** - 会话快照
3. [ ] **MemoryCoordinator** - 记忆协调
4. [ ] **ConcurrencyManager** - 并发控制
5. [ ] **NotificationService** - 通知推送
6. [ ] **FileChangeTracker** - 文件监控

#### 中优先级服务（Week 8-9）
7. [ ] **TeamService** - 团队协作
8. [ ] **SchedulerService** - 任务调度
9. [ ] **WorkflowService** - 工作流编排
10. [ ] **GoalService** - 目标管理
11. [ ] **KnowledgeService** - 知识库
12. [ ] **CodeReviewService** - 代码审查

#### 低优先级服务（Week 10）
13. [ ] **VoiceService** - 语音合成
14. [ ] **CommunityService** - 社区功能
15. [ ] **TelegramService** - Telegram 集成
16. [ ] **FeishuService** - 飞书集成

**迁移模式**:
```rust
// TypeScript 原始代码
export class CostService {
  async trackUsage(sessionId: string, usage: TokenUsage) {
    await db.execute(
      "INSERT INTO cost_records ...",
      [sessionId, usage.inputTokens, usage.outputTokens]
    );
  }
}

// Rust 迁移后
pub struct CostService {
    db: Arc<DatabaseService>,
}

impl CostService {
    pub async fn track_usage(&self, session_id: &str, usage: &TokenUsage) -> Result<()> {
        self.db.execute_params(
            "INSERT INTO cost_records (session_id, input_tokens, output_tokens, created_at)
             VALUES (?1, ?2, ?3, datetime('now'))",
            &[&session_id, &usage.input_tokens, &usage.output_tokens],
        )?;
        Ok(())
    }
}
```

---

### Week 11-12: Phase 7 - IPC 命令注册

#### 任务 7.1: 实现 IPC 命令处理器
**工作量**: 2 周

**命令分类**:
1. **Session Commands** (30+)
   - session:create, session:terminate, session:send-message
   - session:get-all, session:get-history, session:rename
   - ...

2. **Provider Commands** (20+)
   - provider:list, provider:add, provider:update
   - provider:test-executable, provider:check-cli
   - ...

3. **Task Commands** (15+)
   - task:create, task:update, task:delete
   - task:get-all, task:start-session
   - ...

4. **MCP Commands** (15+)
   - mcp:get-all, mcp:create, mcp:update
   - mcp:test-connection, mcp:install-python-package
   - ...

5. **System Commands** (20+)
   - app:get-info, app:minimize, app:maximize
   - system:open-terminal, system:check-update
   - ...

**实现模式**:
```rust
// src-tauri/src/ipc/session_handlers.rs
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn session_create(
    app: AppHandle,
    config: SessionConfig,
) -> Result<SessionInfo, String> {
    let session_manager = app.state::<SessionManager>();
    
    let session_id = session_manager.create_session(config).await
        .map_err(|e| e.to_string())?;
    
    Ok(SessionInfo { id: session_id })
}

#[tauri::command]
pub async fn session_send_message(
    app: AppHandle,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let adapter_registry = app.state::<AdapterRegistry>();
    
    // Route to appropriate adapter based on provider
    let adapter = adapter_registry.get_adapter("claude-code").await
        .ok_or("Adapter not found")?;
    
    adapter.send_message(&session_id, &message).await
        .map_err(|e| e.to_string())?;
    
    Ok(())
}

// Register commands in main.rs
fn setup_ipc(app: &mut tauri::App) {
    tauri::generate_handler![
        session_create,
        session_send_message,
        // ... more commands
    ];
}
```

---

## 📅 长期目标（13-30 周）

### Week 13-20: 性能优化和测试

#### 任务 8.1: 性能优化
1. [ ] 实现数据库连接池（r2d2）
2. [ ] 添加查询缓存
3. [ ] SIMD 加速 ANSI 解析
4. [ ] 内存使用优化
5. [ ] 启动时间优化

#### 任务 8.2: 测试覆盖
1. [ ] 单元测试（目标：80% 覆盖率）
2. [ ] 集成测试
3. [ ] 端到端测试
4. [ ] 压力测试
5. [ ] 性能基准测试

### Week 21-26: 功能增强

#### 任务 9.1: 高级功能
1. [ ] 代码图可视化
2. [ ] 智能代码补全
3. [ ] 自动化测试生成
4. [ ] 部署流水线集成
5. [ ] 团队协作增强

#### 任务 9.2: 用户体验
1. [ ] UI/UX 优化
2. [ ] 主题系统
3. [ ] 快捷键自定义
4. [ ] 插件系统
5. [ ] 国际化支持

### Week 27-30: 发布准备

#### 任务 10.1: 发布流程
1. [ ] 自动更新配置
2. [ ] 安装包构建（Windows/macOS/Linux）
3. [ ] 代码签名
4. [ ] 文档完善
5. [ ] 用户指南

#### 任务 10.2: 质量保证
1. [ ] 安全审计
2. [ ] 性能基准
3. [ ] 兼容性测试
4. [ ] 用户反馈收集
5. [ ] Bug 修复

---

## 🛠️ 开发工具和资源

### 必需工具
```bash
# Rust 工具链
rustup toolchain install stable
rustup component add clippy rustfmt

# Node.js (for sidecar)
nvm install 20
nvm use 20

# Tauri CLI
cargo install tauri-cli

# Testing tools
cargo install cargo-nextest
cargo install cargo-tarpaulin  # Code coverage
```

### 推荐 IDE 插件
- **VS Code**: rust-analyzer, Tauri, Better TOML
- **IntelliJ**: Rust, Tauri
- **Cursor**: 内置 Rust 支持

### 学习资源
- [Tauri v2 文档](https://v2.tauri.app/)
- [Tokio 教程](https://tokio.rs/tokio/tutorial)
- [Rust Book](https://doc.rust-lang.org/book/)
- [rusqlite 文档](https://docs.rs/rusqlite)
- [reqwest 文档](https://docs.rs/reqwest)

---

## 📊 进度跟踪模板

### 每周检查点
```markdown
## Week X Progress Report

### Completed
- [ ] Task 1
- [ ] Task 2

### In Progress
- [ ] Task 3 (50%)

### Blocked
- [ ] Task 4 (waiting for ...)

### Next Week Plan
- [ ] Task 5
- [ ] Task 6

### Issues/Risks
- Issue 1: ...
- Risk 1: ...
```

### 里程碑检查
- [ ] Week 2: Phase 4 完成
- [ ] Week 4: Phase 5 框架完成
- [ ] Week 10: Phase 6 完成
- [ ] Week 12: Phase 7 完成
- [ ] Week 20: 测试和优化完成
- [ ] Week 30: 发布准备完成

---

## 💡 最佳实践

### 代码规范
1. **命名约定**
   - 函数/变量: `snake_case`
   - 结构体/枚举: `PascalCase`
   - 常量: `SCREAMING_SNAKE_CASE`

2. **错误处理**
   ```rust
   // ✅ 推荐
   pub fn do_something() -> Result<(), Box<dyn Error>> {
       // ...
       Ok(())
   }
   
   // ❌ 避免
   pub fn do_something() {
       panic!("Something went wrong");
   }
   ```

3. **异步编程**
   ```rust
   // ✅ 推荐
   pub async fn fetch_data() -> Result<Data> {
       let response = reqwest::get(url).await?;
       let data = response.json().await?;
       Ok(data)
   }
   
   // ❌ 避免 blocking
   pub fn fetch_data() -> Data {
       let response = reqwest::blocking::get(url).unwrap();
       response.json().unwrap()
   }
   ```

4. **线程安全**
   ```rust
   // ✅ 推荐
   use std::sync::Arc;
   use tokio::sync::RwLock;
   
   struct SharedState {
       data: Arc<RwLock<HashMap<String, String>>>,
   }
   
   // ❌ 避免 Mutex 在 async 中
   use std::sync::Mutex;  // 可能导致死锁
   ```

### 测试策略
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_database_create_session() {
        let db = DatabaseService::new(":memory:").unwrap();
        
        db.create_session("test-id", "Test", "running", None, None)
            .await
            .unwrap();
        
        let session = db.get_session("test-id").await.unwrap();
        assert!(session.is_some());
    }
}
```

---

## 🎯 成功指标

### 技术指标
- [ ] 编译时间 < 5 分钟
- [ ] 启动时间 < 3 秒
- [ ] 内存占用 < 100 MB
- [ ] CPU 使用率 < 10%（空闲时）
- [ ] 测试覆盖率 > 80%

### 功能指标
- [ ] 所有 Phase 完成
- [ ] 185+ IPC 命令实现
- [ ] 60+ 服务迁移
- [ ] 6+ AI Provider 支持
- [ ] 跨平台支持（Windows/macOS/Linux）

### 质量指标
- [ ] 零 critical bugs
- [ ] 零 security vulnerabilities
- [ ] 用户满意度 > 4.5/5
- [ ] 文档完整性 100%

---

**最后更新**: 2026-05-05  
**下次更新**: 根据实际进度每周更新
