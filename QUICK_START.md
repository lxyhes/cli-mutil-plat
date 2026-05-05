# 🚀 Tauri 迁移项目 - 快速启动指南

## 📋 前置要求

### 必需软件
1. **Node.js** (v18+)
2. **Rust** (最新稳定版)
3. **Git**

### 安装 Rust（如果尚未安装）

#### Windows
```bash
# 方法 1: 使用 winget
winget install Rustlang.Rust.MSVC

# 方法 2: 使用 rustup（推荐）
# 下载并运行 https://rustup.rs
```

#### 验证安装
```bash
rustc --version
cargo --version
```

---

## 🔧 快速开始

### 1. 克隆项目（如果还没有）
```bash
cd E:\fuke-spec\spectrai-community
```

### 2. 安装依赖
```bash
npm install
```

### 3. 编译检查（可选，推荐）
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

**预期输出**:
```
    Checking prismops v0.4.6
    Finished dev [unoptimized + debuginfo] target(s) in XXs
```

如果有错误，请检查：
- Rust 版本是否最新
- 所有依赖是否正确安装

### 4. 运行开发模式
```bash
npm run tauri:dev
```

**首次运行会**:
1. 编译 Rust 代码（可能需要 5-10 分钟）
2. 启动 Vite 开发服务器
3. 打开应用窗口
4. **自动创建数据库**并运行所有迁移

### 5. 验证数据库创建

#### 检查数据库文件
```bash
# Windows
dir %APPDATA%\spectrai\claudeops.db
```

#### 查看数据库内容（可选）
使用 SQLite 浏览器或命令行：
```bash
# 安装 sqlite3
winget install SQLite.SQLite

# 查看表列表
sqlite3 %APPDATA%\spectrai\claudeops.db ".tables"

# 查看 schema 版本
sqlite3 %APPDATA%\spectrai\claudeops.db "SELECT * FROM schema_version;"
```

**预期输出**:
```
ai_call_logs              plan_steps
ai_providers              plan_tasks
app_settings              prompt_feedback
... (25+ 个表)
schema_version

48|2026-05-05 12:00:00
```

---

## ✅ 验证清单

运行应用后，检查以下功能：

### 基础功能
- [ ] 应用窗口正常显示
- [ ] React UI 渲染正常
- [ ] 系统托盘图标出现
- [ ] 右键托盘菜单可用（显示窗口/退出）

### 快捷键
- [ ] `Ctrl+Shift+N` - 新建会话（发送事件到前端）
- [ ] `Ctrl+1` - 切换到网格视图
- [ ] `Ctrl+2` - 切换到标签视图
- [ ] `Ctrl+3` - 切换到仪表板视图

### 数据库
- [ ] 数据库文件已创建
- [ ] schema_version 表存在
- [ ] 当前版本为 48
- [ ] 所有必需的表已创建

### 日志
查看日志文件：
```bash
# Windows 日志位置
%APPDATA%\com.weibin.prismops\logs\prismops.log
```

**应该看到**:
```
INFO prismops::services::migrations: Current database schema version: 0
INFO prismops::services::migrations: Total migrations available: 48
INFO prismops::services::migrations: Running migration v1: add claude_session_id column to sessions
...
INFO prismops::services::migrations: Migration v48 completed successfully
INFO prismops::services::migrations: Database schema updated to version: 48
```

---

## 🐛 常见问题

### 问题 1: Cargo 未找到
**错误**: `'cargo' 不是内部或外部命令`

**解决**:
1. 确认 Rust 已安装
2. 重启终端
3. 检查 PATH 环境变量

### 问题 2: 编译错误
**错误**: 编译时出现各种错误

**解决**:
```bash
# 清理并重新编译
cargo clean --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

### 问题 3: 数据库创建失败
**错误**: 无法创建数据库文件

**解决**:
1. 检查目录权限
2. 手动创建目录：
   ```bash
   mkdir %APPDATA%\spectrai
   ```
3. 重新运行应用

### 问题 4: 迁移执行失败
**错误**: 某个迁移版本执行失败

**解决**:
1. 查看日志文件确定失败的迁移
2. 删除数据库文件重新开始：
   ```bash
   del %APPDATA%\spectrai\claudeops.db
   ```
3. 重新运行应用

### 问题 5: Tauri dev 启动慢
**原因**: 首次编译需要时间

**解决**:
- 耐心等待（首次可能需要 5-10 分钟）
- 后续启动会快很多（增量编译）

---

## 📊 性能基准

### 编译时间
| 类型 | 时间 | 说明 |
|------|------|------|
| 首次完整编译 | 5-10 分钟 | 下载依赖 + 编译 |
| 增量编译 | 30 秒 - 2 分钟 | 仅编译修改的文件 |
| Release 构建 | 10-15 分钟 | 优化级别更高 |

### 运行时性能
| 指标 | 预期值 |
|------|--------|
| 应用启动时间 | < 2 秒 |
| 数据库迁移时间 | < 1 秒（48 个迁移） |
| 内存占用 | ~150-200 MB |
| CPU 占用（空闲） | < 1% |

---

## 🎯 下一步开发

数据库迁移完成后，可以继续以下工作：

### 优先级 P0
1. **实现数据库写操作**
   - 在 `database.rs` 中添加 INSERT/UPDATE 方法
   - 实现事务支持

2. **测试现有功能**
   - 验证所有查询方法正常工作
   - 测试并发访问

### 优先级 P1
3. **PTY 终端仿真**
   - 实现 ANSI 解析器
   - 连接 PTY 输出到前端

4. **AgentBridge WebSocket**
   - 实现 MCP 通信服务器

### 优先级 P2
5. **AI 适配器迁移**
   - 从最简单的 OpenAI Compatible 开始

6. **服务迁移**
   - 按依赖顺序迁移 60+ 服务

---

## 📚 相关文档

- [TAURI_MIGRATION_PROGRESS.md](./TAURI_MIGRATION_PROGRESS.md) - 完整迁移进度报告
- [DATABASE_MIGRATION_COMPLETE.md](./DATABASE_MIGRATION_COMPLETE.md) - 数据库迁移详细说明
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - 实现总结
- [giggly-roaming-sunset.md](./giggly-roaming-sunset.md) - 原始迁移规划

---

## 💡 提示

### 开发技巧
1. **使用 `tauri dev` 而非 `tauri build`**
   - 开发模式支持热重载
   - 编译更快

2. **定期清理**
   ```bash
   cargo clean --manifest-path src-tauri/Cargo.toml
   ```

3. **查看实时日志**
   ```bash
   # Windows PowerShell
   Get-Content $env:APPDATA\com.weibin.prismops\logs\prismops.log -Wait
   ```

4. **使用 DevTools**
   - 在应用中按 `Ctrl+Shift+I` 打开开发者工具
   - 可以调试 React 前端

### 调试技巧
1. **启用详细日志**
   在 `main.rs` 中修改日志级别：
   ```rust
   .level(tauri_plugin_log::log::LevelFilter::Debug)
   ```

2. **检查数据库状态**
   ```bash
   sqlite3 %APPDATA%\spectrai\claudeops.db "PRAGMA user_version;"
   ```

3. **重置数据库**
   ```bash
   del %APPDATA%\spectrai\claudeops.db
   npm run tauri:dev
   ```

---

## 🆘 获取帮助

如果遇到问题：

1. **查看日志文件**
   - 位置：`%APPDATA%\com.weibin.prismops\logs\prismops.log`

2. **检查 GitHub Issues**
   - Tauri 官方: https://github.com/tauri-apps/tauri/issues

3. **查阅文档**
   - Tauri v2 文档: https://v2.tauri.app/
   - rusqlite 文档: https://docs.rs/rusqlite/

4. **社区支持**
   - Tauri Discord: https://discord.gg/tauri
   - Rust 中文社区: https://rustcc.cn/

---

**祝开发顺利！** 🎉
