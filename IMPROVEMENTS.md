# SpectrAI 项目功能完善建议

> 基于代码审查的完善方案 - 2026/04/07

## 🔴 高优先级问题

### 1. window.spectrAI 未定义问题的系统性解决

**现状：**
- 已在 App.tsx 中实现 `waitForSpectrAI` 轮询机制
- 部分 Store 已添加 `window.spectrAI?.xxx` 可选链保护
- 但仍有 23 个文件直接访问 `window.spectrAI`，存在竞态风险

**完善方案：**

#### 方案 A：创建统一的 API 访问层（推荐）

```typescript
// src/renderer/utils/api.ts
export class SpectrAIAPI {
  private static instance: SpectrAIAPI
  private api: typeof window.spectrAI | null = null
  private readyPromise: Promise<void>
  private resolveReady!: () => void

  private constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    this.waitForAPI()
  }

  static getInstance(): SpectrAIAPI {
    if (!SpectrAIAPI.instance) {
      SpectrAIAPI.instance = new SpectrAIAPI()
    }
    return SpectrAIAPI.instance
  }

  private async waitForAPI(): Promise<void> {
    let retries = 100
    while (retries > 0 && !window.spectrAI) {
      await new Promise(resolve => setTimeout(resolve, 50))
      retries--
    }
    
    if (window.spectrAI) {
      this.api = window.spectrAI
      this.resolveReady()
      console.log('[SpectrAIAPI] API ready')
    } else {
      console.error('[SpectrAIAPI] Failed to initialize after 5 seconds')
      throw new Error('SpectrAI API not available')
    }
  }

  async ready(): Promise<void> {
    return this.readyPromise
  }

  get session() {
    if (!this.api) throw new Error('SpectrAI API not ready')
    return this.api.session
  }

  get task() {
    if (!this.api) throw new Error('SpectrAI API not ready')
    return this.api.task
  }

  // ... 其他 API
}

// 使用示例
const api = SpectrAIAPI.getInstance()
await api.ready()
const sessions = await api.session.getAll()
```

#### 方案 B：增强 preload 脚本的可靠性

```typescript
// src/preload/index.ts 末尾添加
// 向主进程报告 preload 加载完成
ipcRenderer.send('preload:ready')

// 在渲染进程中等待确认
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Preload] DOMContentLoaded, spectrAI available:', !!window.spectrAI)
})
```

```typescript
// src/main/index.ts 中监听
ipcMain.on('preload:ready', () => {
  console.log('[Main] Preload script loaded successfully')
  if (mainWindow) {
    mainWindow.webContents.send('main:preload-confirmed')
  }
})
```

**推荐实施：方案 A + 方案 B 结合**

---

### 2. SessionManagerV2 错误处理增强

**发现的问题：**
- Adapter 事件监听器缺少错误边界
- 会话状态转换缺少完整的状态机验证
- 异常会话清理机制不完善

**完善方案：**

```typescript
// src/main/session/SessionManagerV2.ts

// 添加状态转换验证
private validateStateTransition(
  sessionId: string, 
  from: SessionStatus, 
  to: SessionStatus
): boolean {
  const validTransitions: Record<SessionStatus, SessionStatus[]> = {
    'starting': ['running', 'error', 'terminated'],
    'running': ['idle', 'waiting_input', 'completed', 'error', 'terminated'],
    'idle': ['running', 'completed', 'terminated'],
    'waiting_input': ['running', 'completed', 'error', 'terminated'],
    'completed': [], // 终态
    'error': [], // 终态
    'terminated': [], // 终态
    'interrupted': ['running', 'terminated'], // 可恢复
  }

  const allowed = validTransitions[from] || []
  if (!allowed.includes(to)) {
    console.warn(
      `[SessionManagerV2] Invalid state transition for ${sessionId}: ${from} -> ${to}`
    )
    return false
  }
  return true
}

// 添加错误边界包装
private wrapAdapterListener(
  sessionId: string,
  handler: (event: ProviderEvent) => void
): (event: ProviderEvent) => void {
  return (event: ProviderEvent) => {
    try {
      handler(event)
    } catch (error) {
      console.error(
        `[SessionManagerV2] Error in adapter listener for ${sessionId}:`,
        error
      )
      this.handleSessionError(sessionId, error as Error)
    }
  }
}

// 添加会话超时检测
private startSessionWatchdog(sessionId: string): void {
  const STARTUP_TIMEOUT = 60000 // 60秒启动超时
  const IDLE_TIMEOUT = 300000 // 5分钟无活动超时

  const timer = setTimeout(() => {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.status === 'starting') {
      console.error(`[SessionManagerV2] Session ${sessionId} startup timeout`)
      this.terminateSession(sessionId, 'Startup timeout')
    }
  }, STARTUP_TIMEOUT)

  this.sessionTimers.set(sessionId, timer)
}
```

---

### 3. FileChangeTracker 内存泄漏风险

**发现的问题：**
- `debounceTimers` Map 可能无限增长
- `changeBuffers` 在会话结束后未清理
- FSWatcher 引用计数可能不准确

**完善方案：**

```typescript
// src/main/tracker/FileChangeTracker.ts

// 添加定期清理机制
private startPeriodicCleanup(): void {
  setInterval(() => {
    this.cleanupStaleTimers()
    this.cleanupStaleBuffers()
  }, 60000) // 每分钟清理一次
}

private cleanupStaleTimers(): void {
  const now = Date.now()
  const STALE_THRESHOLD = 300000 // 5分钟

  for (const [filePath, timer] of this.debounceTimers.entries()) {
    // 检查是否有对应的活跃会话
    const hasActiveSession = Array.from(this.activeWindows.keys()).some(
      sessionId => {
        const dir = this.sessionDirs.get(sessionId)
        return dir && filePath.startsWith(dir)
      }
    )

    if (!hasActiveSession) {
      clearTimeout(timer)
      this.debounceTimers.delete(filePath)
    }
  }
}

private cleanupStaleBuffers(): void {
  for (const [sessionId, buffer] of this.changeBuffers.entries()) {
    if (!this.activeWindows.has(sessionId) && buffer.size === 0) {
      this.changeBuffers.delete(sessionId)
    }
  }
}

// 增强 stopWatching 的引用计数准确性
private stopWatching(dir: string): void {
  const entry = this.dirWatchers.get(dir)
  if (!entry) return

  entry.refCount--
  console.log(`[FileChangeTracker] stopWatching ${dir}, refCount: ${entry.refCount}`)

  if (entry.refCount <= 0) {
    try {
      entry.watcher.close()
      this.dirWatchers.delete(dir)
      console.log(`[FileChangeTracker] Closed watcher for ${dir}`)
    } catch (error) {
      console.error(`[FileChangeTracker] Error closing watcher for ${dir}:`, error)
    }
  }
}

// 添加会话清理钩子
onSessionDestroyed(sessionId: string): void {
  // 清理该会话的所有资源
  this.activeWindows.delete(sessionId)
  this.changeBuffers.delete(sessionId)
  this.sessionDirs.delete(sessionId)
  this.sessionMainRepos.delete(sessionId)

  // 清理相关的 debounce timers
  const dir = this.sessionDirs.get(sessionId)
  if (dir) {
    for (const [filePath, timer] of this.debounceTimers.entries()) {
      if (filePath.startsWith(dir)) {
        clearTimeout(timer)
        this.debounceTimers.delete(filePath)
      }
    }
  }
}
```

---

## 🟡 中优先级改进

### 4. Agent Teams 功能完善

**当前状态：**
- 基础架构已完成（TeamManager, SharedTaskList, TeamBus）
- MCP 工具已实现（team_claim_task, team_message_role 等）
- 缺少完整的错误恢复和状态同步机制

**完善方案：**

#### 4.1 添加团队健康检查

```typescript
// src/main/team/TeamManager.ts

private startTeamHealthCheck(instanceId: string): void {
  const interval = setInterval(async () => {
    const instance = await this.database.team.getInstance(instanceId)
    if (!instance || instance.status === 'completed' || instance.status === 'failed') {
      clearInterval(interval)
      return
    }

    // 检查成员存活状态
    const members = await this.database.team.getMembers(instanceId)
    for (const member of members) {
      const session = this.sessionManager.getSession(member.sessionId)
      if (!session || session.status === 'error' || session.status === 'terminated') {
        console.warn(`[TeamManager] Member ${member.roleId} session dead, marking as failed`)
        await this.database.team.updateMember(member.id, { status: 'failed' })
        this.emit('team:member-failed', { instanceId, memberId: member.id, roleId: member.roleId })
      }
    }

    // 检查是否有任务卡住
    const tasks = await this.sharedTaskList.getTasks(instanceId, { status: 'in_progress' })
    const now = Date.now()
    for (const task of tasks) {
      const claimedAt = new Date(task.claimedAt!).getTime()
      if (now - claimedAt > 600000) { // 10分钟无进展
        console.warn(`[TeamManager] Task ${task.id} stuck, releasing`)
        await this.sharedTaskList.releaseTask(task.id)
      }
    }
  }, 30000) // 每30秒检查一次

  this.teamHealthChecks.set(instanceId, interval)
}
```

#### 4.2 添加消息重试机制

```typescript
// src/main/team/TeamBus.ts

async sendMessage(
  instanceId: string,
  from: string,
  to: string,
  content: string,
  retries = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const member = await this.database.team.getMemberByRole(instanceId, to)
      if (!member) {
        throw new Error(`Member ${to} not found`)
      }

      // 通过 AgentManager 发送消息到目标会话
      await this.agentManager.sendToAgent(member.sessionId, content)

      // 记录消息
      await this.database.team.addMessage({
        instanceId,
        from,
        to,
        content,
        timestamp: new Date().toISOString(),
      })

      return true
    } catch (error) {
      console.error(
        `[TeamBus] Send message attempt ${attempt}/${retries} failed:`,
        error
      )
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }
  return false
}
```

---

### 5. 数据库查询优化

**发现的问题：**
- 缺少必要的索引
- 存在 N+1 查询问题
- 大量历史数据未归档

**完善方案：**

```typescript
// src/main/storage/migrations/008_add_indexes.ts

export const migration_008 = {
  version: 8,
  name: 'add_performance_indexes',
  up: (db: any) => {
    // 会话查询优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_status_started 
      ON sessions(status, startedAt DESC);
    `)

    // 对话消息查询优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversation_session_timestamp 
      ON conversation_messages(sessionId, timestamp DESC);
    `)

    // 活动事件查询优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_activity_session_timestamp 
      ON activity_events(sessionId, timestamp DESC);
    `)

    // Agent 查询优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_parent_status 
      ON agents(parentSessionId, status);
    `)

    // 文件改动查询优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_changes_session_timestamp 
      ON file_changes(sessionId, timestamp DESC);
    `)

    // Team 任务查询优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_tasks_instance_status 
      ON team_tasks(instanceId, status);
    `)
  },
  down: (db: any) => {
    db.exec('DROP INDEX IF EXISTS idx_sessions_status_started')
    db.exec('DROP INDEX IF EXISTS idx_conversation_session_timestamp')
    db.exec('DROP INDEX IF EXISTS idx_activity_session_timestamp')
    db.exec('DROP INDEX IF EXISTS idx_agents_parent_status')
    db.exec('DROP INDEX IF EXISTS idx_file_changes_session_timestamp')
    db.exec('DROP INDEX IF EXISTS idx_team_tasks_instance_status')
  }
}
```

```typescript
// src/main/storage/repositories/SessionRepository.ts

// 优化批量查询，避免 N+1
async getSessionsWithAgents(limit = 100): Promise<SessionWithAgents[]> {
  const sessions = this.db
    .prepare(`
      SELECT * FROM sessions 
      WHERE status IN ('running', 'idle', 'waiting_input')
      ORDER BY startedAt DESC 
      LIMIT ?
    `)
    .all(limit)

  if (sessions.length === 0) return []

  // 一次性查询所有相关的 agents
  const sessionIds = sessions.map(s => s.id)
  const placeholders = sessionIds.map(() => '?').join(',')
  const agents = this.db
    .prepare(`
      SELECT * FROM agents 
      WHERE parentSessionId IN (${placeholders})
      ORDER BY createdAt DESC
    `)
    .all(...sessionIds)

  // 组装结果
  const agentsBySession = new Map<string, any[]>()
  for (const agent of agents) {
    if (!agentsBySession.has(agent.parentSessionId)) {
      agentsBySession.set(agent.parentSessionId, [])
    }
    agentsBySession.get(agent.parentSessionId)!.push(agent)
  }

  return sessions.map(session => ({
    ...session,
    agents: agentsBySession.get(session.id) || []
  }))
}
```

---

## 🟢 低优先级优化

### 6. 日志系统改进

```typescript
// src/main/logger.ts

// 添加结构化日志
export class StructuredLogger {
  private context: Record<string, any> = {}

  setContext(key: string, value: any): void {
    this.context[key] = value
  }

  log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, any>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      ...meta
    }
    
    // 写入文件
    electronLog[level](JSON.stringify(entry))
    
    // 发送到渲染进程（用于实时监控）
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log:entry', entry)
    }
  }
}
```

### 7. 性能监控

```typescript
// src/main/monitoring/PerformanceMonitor.ts

export class PerformanceMonitor {
  private metrics = new Map<string, number[]>()

  recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, [])
    }
    const values = this.metrics.get(name)!
    values.push(value)
    
    // 只保留最近 1000 个数据点
    if (values.length > 1000) {
      values.shift()
    }
  }

  getStats(name: string): { avg: number; p50: number; p95: number; p99: number } | null {
    const values = this.metrics.get(name)
    if (!values || values.length === 0) return null

    const sorted = [...values].sort((a, b) => a - b)
    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    }
  }
}

// 使用示例
const perfMonitor = new PerformanceMonitor()

// 监控会话创建时间
const start = Date.now()
await sessionManager.createSession(config)
perfMonitor.recordMetric('session.create.duration', Date.now() - start)
```

---

## 📝 实施优先级建议

1. **立即实施（本周）：**
   - window.spectrAI 统一访问层（方案 A）
   - SessionManagerV2 状态转换验证
   - FileChangeTracker 内存泄漏修复

2. **短期实施（2周内）：**
   - 数据库索引优化
   - Agent Teams 健康检查
   - 错误边界增强

3. **中期实施（1个月内）：**
   - 性能监控系统
   - 结构化日志
   - 数据归档机制

---

## 🧪 测试建议

### 单元测试覆盖

```typescript
// tests/unit/SessionManagerV2.test.ts
describe('SessionManagerV2', () => {
  it('should validate state transitions', () => {
    const manager = new SessionManagerV2(...)
    expect(manager.validateStateTransition('starting', 'running')).toBe(true)
    expect(manager.validateStateTransition('completed', 'running')).toBe(false)
  })

  it('should handle adapter errors gracefully', async () => {
    const manager = new SessionManagerV2(...)
    const adapter = createMockAdapter()
    adapter.emit('error', new Error('Test error'))
    
    // 验证会话状态变为 error
    const session = manager.getSession(sessionId)
    expect(session.status).toBe('error')
  })
})
```

### 集成测试

```typescript
// tests/integration/agent-teams.test.ts
describe('Agent Teams', () => {
  it('should recover from member failure', async () => {
    const team = await teamManager.createInstance(teamDef, goal)
    
    // 模拟成员失败
    await sessionManager.terminateSession(memberSessionId)
    
    // 等待健康检查检测到
    await sleep(35000)
    
    // 验证任务被释放
    const tasks = await sharedTaskList.getTasks(team.id, { status: 'pending' })
    expect(tasks.length).toBeGreaterThan(0)
  })
})
```

---

## 📚 文档完善

建议补充以下文档：

1. **架构决策记录（ADR）**
   - 为什么选择 Adapter 模式
   - 为什么使用 SQLite 而非其他数据库
   - Agent Teams 的设计权衡

2. **故障排查指南**
   - window.spectrAI 未定义的诊断步骤
   - 会话卡住的排查流程
   - 文件改动未追踪的调试方法

3. **性能优化指南**
   - 数据库查询最佳实践
   - 大量会话场景的优化建议
   - 内存使用监控方法

---

**生成时间：** 2026-04-07  
**审查范围：** 核心模块（SessionManagerV2, AgentManagerV2, FileChangeTracker, TeamManager, Database）  
**审查方法：** 静态代码分析 + 架构审查
