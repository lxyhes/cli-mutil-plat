# SpectrAI Tauri 项目启动指南

**日期**: 2026-05-05  
**状态**: ⚠️ **需要修复编译错误**

---

## 📊 当前状态

### ✅ 已完成
- Rust 环境已安装 (rustc 1.95.0)
- tauri-cli 已安装 (v2.11.0)
- Node.js 依赖已安装
- 前端构建成功

### ❌ 待修复的编译错误

1. **模块导入错误** (3个)
   - `migrations` 模块找不到
   - `migrations_additional` 模块找不到
   - 需要检查文件路径

2. **生命周期错误** (7个)
   - `database.rs` 中 `update_provider` 函数的参数借用问题
   - 需要重构动态 SQL 构建逻辑

3. **文档注释错误** (1个)
   - `claude_sidecar.rs` 中的注释格式问题

4. **类型错误** (11个)
   - 各种类型不匹配问题

---

## 🔧 快速解决方案

### 方案 A: 使用 Electron 版本（推荐）

由于 Tauri 版本有编译错误，建议**先使用 Electron 版本**进行开发和测试：

```bash
npm run dev
```

Electron 版本功能完整，可以正常使用所有已实现的功能。

### 方案 B: 修复 Tauri 编译错误

如果您想使用 Tauri 版本，需要修复以下问题：

#### 1. 修复模块导入

检查文件是否存在：
```bash
dir src-tauri\src\services\migrations.rs
dir src-tauri\src\services\migrations_additional.rs
```

如果文件不存在，需要从正确的位置复制或重新创建。

#### 2. 修复 database.rs 生命周期问题

需要将 `update_provider` 函数重构为不使用动态参数向量：

```rust
// 当前代码有问题
pub fn update_provider(&self, id: &str, ...) -> SqlResult<()> {
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();
    // ... 动态添加参数
}

// 修复方案：使用固定的参数列表
pub fn update_provider(
    &self,
    id: &str,
    name: Option<&str>,
    command: Option<&str>,
    // ... 其他参数
) -> SqlResult<()> {
    // 为每种组合编写单独的 UPDATE 语句
    // 或使用 rusqlite 的参数化查询
}
```

#### 3. 修复文档注释

将 `claude_sidecar.rs` 第 64 行的 `///` 改为 `//`：

```rust
// 错误
/// IPC connection (placeholder...)

// 正确
// IPC connection (placeholder...)
```

#### 4. 重新编译

```bash
cd src-tauri
cargo clean
cargo build
```

---

## 🚀 推荐的开发流程

### 阶段 1: 使用 Electron 版本（现在）

1. **启动应用**
   ```bash
   npm run dev
   ```

2. **测试功能**
   - 数据库操作
   - PTY 终端
   - Provider 管理
   - 会话管理

3. **继续开发**
   - 实现剩余的 AI 适配器
   - 迁移服务到 Rust
   - 完善功能

### 阶段 2: 修复 Tauri 版本（后续）

1. **逐个修复编译错误**
2. **测试每个修复**
3. **确保功能 parity**
4. **性能优化**

### 阶段 3: 切换到 Tauri（最终）

1. **完全迁移到 Tauri**
2. **移除 Electron 依赖**
3. **打包发布**

---

## 📝 下一步行动

### 立即可做

1. **启动 Electron 版本**
   ```bash
   npm run dev
   ```

2. **验证功能**
   - 创建会话
   - 测试终端
   - 添加 Provider

3. **继续开发**
   - 实现 Codex Adapter
   - 实现 Gemini Adapter
   - 迁移服务

### 本周目标

1. **修复 Tauri 编译错误**（可选）
   - 预计需要 2-4 小时
   - 主要是 Rust 生命周期和模块问题

2. **或者继续使用 Electron**
   - 专注于功能开发
   - 等核心功能完成后再修复 Tauri

---

## 💡 建议

鉴于：
1. Electron 版本功能完整
2. Tauri 版本只有编译错误，没有功能缺失
3. 修复编译错误需要时间

**建议优先使用 Electron 版本进行开发**，等核心功能完成后，再集中修复 Tauri 的编译问题。

这样可以：
- ✅ 立即开始功能开发
- ✅ 避免被编译问题阻塞
- ✅ 保持开发节奏
- ✅ 并行修复 Tauri 问题

---

## 🆘 如需帮助

如果需要修复 Tauri 编译错误，请告诉我，我可以帮您：
1. 分析具体的错误原因
2. 提供详细的修复方案
3. 逐步指导修复过程

---

**最后更新**: 2026-05-05  
**建议**: 使用 `npm run dev` 启动 Electron 版本继续开发
