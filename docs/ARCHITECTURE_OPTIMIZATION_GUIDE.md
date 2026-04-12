# 架构优化实施指南

本文档说明如何集成新的错误处理、并发控制和内存管理机制。

---

## 📋 目录

1. [统一错误处理](#1-统一错误处理)
2. [并发控制与锁机制](#2-并发控制与锁机制)
3. [内存管理与监控](#3-内存管理与监控)
4. [集成步骤](#4-集成步骤)
5. [测试建议](#5-测试建议)

---

## 1. 统一错误处理

### 1.1 核心文件

- `src/shared/errors.ts` - 错误类型定义、错误处理器、IPC 响应格式

### 1.2 使用方法

#### 在 IPC Handler 中使用

```typescript
// src/main/ipc/sessionHandlers.ts
import { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'

ipcMain.handle(IPC.SESSION_CREATE, async (_event, config: SessionConfig) => {
  try {
    // 验证输入
    if (!config.workingDirectory) {
      throw new SpectrAIError({
        code: ErrorCode.MISSING_REQUIRED,
        message: 'workingDirectory is required',
        userMessage: '请选择工作目录',
        context: { config }
      })
    }

    // 执行操作
    const session = await sessionManager.create(config)
    
    return createSuccessResponse(session)
  } catch (error) {
    return createErrorResponse(error, { 
      operation: 'session.create',
      config 
    })
  }
})
```

#### 在 Manager 层使用

```typescript
// src/main/session/SessionManagerV2.ts
import { SpectrAIError, ErrorCode } from '../../shared/errors'

class SessionManagerV2 {
  createSession(config: SessionConfig): string {
    // 检查资源
    if (!this.hasAvailableResources()) {
      throw new SpectrAIError({
        code: ErrorCode.RESOURCE_EXHAUSTED,
        message: 'Maximum concurrent sessions reached',
        userMessage: '已达到最大并发会话数，请先关闭一些会话',
        recoverable: true,
        context: { maxSessions: 10 }
      })
    }

    // 检查 Provider
    const provider = this.getProvider(config.providerId)
    if (!provider) {
      throw new SpectrAIError({
        code: ErrorCode.PROVIDER_NOT_FOUND,
        message: `Provider not found: ${config.providerId}`,
        userMessage: `AI Provider "${config.providerId}" 不存在`,
        context: { providerId: config.providerId }
      })
    }

    // ... 创建会话
  }
}
```

#### 在 Renderer 中处理错误

```typescript
// src/renderer/stores/sessionStore.ts
import type { IpcResponse } from '../../shared/errors'

const createSession = async (config: SessionConfig) => {
  try {
    const result: IpcResponse<Session> = await window.spectrAI.session.create(config)
    
    if (!result.success) {
      // 显示用户友好的错误信息
      set({ 
        error: result.error.userMessage,
        errorDetails: result.error 
      })
      
      // 根据错误类型决定是否重试
      if (result.error.recoverable) {
        console.log('Error is recoverable, user can retry')
      }
      
      return null
    }
    
    return result.data
  } catch (error) {
    console.error('Unexpected error:', error)
    set({ error: '发生了未知错误，请重试' })
    return null
  }
}
```

### 1.3 修复现有空 catch 块

#### 修复前（taskHandlers.ts:84）

```typescript
try { 
  await gitService.removeWorktree(repo.repoPath, wtp) 
} catch (_) {}  // ❌ 错误被完全忽略
```

#### 修复后

```typescript
try { 
  await gitService.removeWorktree(repo.repoPath, wtp) 
} catch (err) {
  // 清理失败不阻断流程，但记录日志
  console.warn(`[Cleanup] Failed to remove worktree ${wtp}:`, err)
  // 可选：收集清理失败的 worktree，稍后重试
}
```

---

## 2. 并发控制与锁机制

### 2.1 核心文件

- `src/main/concurrency/LockManager.ts` - 分布式锁管理器

### 2.2 集成到 DatabaseManager

```typescript
// src/main/storage/Database.ts
import { LockManager } from '../concurrency/LockManager'

export class DatabaseManager {
  private lockManager: LockManager

  constructor(dbPath: string) {
    // ... 初始化数据库
    this.lockManager = new LockManager(this.db)
  }

  getLockManager(): LockManager {
    return this.lockManager
  }

  cleanup(): void {
    this.lockManager.cleanup()
    // ... 其他清理
  }
}
```

### 2.3 使用场景

#### 场景 1：文件操作互斥

```typescript
// src/main/ipc/fileManagerHandlers.ts
import { createFileLock } from '../concurrency/LockManager'

ipcMain.handle(IPC.FILE_WRITE, async (_event, filePath: string, content: string, sessionId: string) => {
  const lockManager = database.getLockManager()
  const lockResource = createFileLock(filePath)

  try {
    // 使用锁保护文件写入
    await lockManager.withLock(
      lockResource,
      { owner: sessionId, timeout: 5000 },
      async () => {
        await fs.promises.writeFile(filePath, content, 'utf-8')
      }
    )
    
    return createSuccessResponse({ success: true })
  } catch (error) {
    return createErrorResponse(error, { filePath, sessionId })
  }
})
```

#### 场景 2：Git 操作互斥

```typescript
// src/main/git/GitWorktreeService.ts
import { createGitLock } from '../concurrency/LockManager'

export class GitWorktreeService {
  constructor(private lockManager: LockManager) {}

  async commit(repoPath: string, message: string, sessionId: string): Promise<void> {
    const lockResource = createGitLock(repoPath, 'commit')

    await this.lockManager.withLock(
      lockResource,
      { owner: sessionId, timeout: 30000 },
      async () => {
        // 执行 git commit
        await this.execGit(repoPath, ['commit', '-m', message])
      }
    )
  }

  async push(repoPath: string, sessionId: string): Promise<void> {
    const lockResource = createGitLock(repoPath, 'push')

    await this.lockManager.withLock(
      lockResource,
      { owner: sessionId, timeout: 60000 }, // push 可能较慢
      async () => {
        await this.execGit(repoPath, ['push'])
      }
    )
  }
}
```

#### 场景 3：Agent 执行互斥

```typescript
// src/main/agent/AgentManagerV2.ts
import { createAgentLock } from '../concurrency/LockManager'

export class AgentManagerV2 {
  constructor(
    private lockManager: LockManager,
    // ... 其他依赖
  ) {}

  async spawnAgent(parentSessionId: string, config: AgentConfig): Promise<AgentInfo> {
    const lockResource = createAgentLock(config.name)

    // 检查是否已有同名 Agent 在执行
    const lockInfo = this.lockManager.getLockInfo(lockResource)
    if (lockInfo) {
      throw new SpectrAIError({
        code: ErrorCode.RESOURCE_BUSY,
        message: `Agent "${config.name}" is already running`,
        userMessage: `Agent "${config.name}" 正在执行中，请等待完成`,
        context: { agentName: config.name, owner: lockInfo.owner }
      })
    }

    // 获取锁
    const acquired = await this.lockManager.acquire(lockResource, {
      owner: parentSessionId,
      timeout: 300000, // 5 分钟
      metadata: { agentName: config.name }
    })

    if (!acquired) {
      throw new SpectrAIError({
        code: ErrorCode.AGENT_SPAWN_FAILED,
        message: 'Failed to acquire agent lock',
        userMessage: '无法启动 Agent，请稍后重试'
      })
    }

    try {
      // 创建 Agent
      const agentInfo = this.createAgent(parentSessionId, config)
      return agentInfo
    } catch (error) {
      // 失败时释放锁
      this.lockManager.release(lockResource, parentSessionId)
      throw error
    }
  }

  // Agent 完成时释放锁
  private onAgentCompleted(agentId: string, parentSessionId: string, agentName: string): void {
    const lockResource = createAgentLock(agentName)
    this.lockManager.release(lockResource, parentSessionId)
  }
}
```

#### 场景 4：会话结束时自动释放所有锁

```typescript
// src/main/session/SessionManagerV2.ts
export class SessionManagerV2 {
  constructor(
    private lockManager: LockManager,
    // ... 其他依赖
  ) {}

  async terminateSession(sessionId: string): Promise<void> {
    // ... 终止会话逻辑

    // 释放该会话持有的所有锁
    const releasedCount = this.lockManager.releaseAllByOwner(sessionId)
    if (releasedCount > 0) {
      console.log(`[SessionManagerV2] Released ${releasedCount} locks for session ${sessionId}`)
    }
  }
}
```

---

## 3. 内存管理与监控

### 3.1 核心文件

- `src/main/memory/MemoryCoordinator.ts` - 内存管理协调器
- `src/main/tracker/FileChangeTrackerMemoryManager.ts` - 文件追踪器内存管理（已存在）

### 3.2 集成到主进程

```typescript
// src/main/index.ts
import { MemoryCoordinator, FileChangeTrackerMemoryAdapter } from './memory/MemoryCoordinator'
import { FileChangeTrackerMemoryManager } from './tracker/FileChangeTrackerMemoryManager'

// 创建内存协调器
const memoryCoordinator = new MemoryCoordinator({
  warning: 500,   // 500 MB
  critical: 800,  // 800 MB
  maximum: 1000,  // 1 GB
})

// 启动监控（每 30 秒检查一次）
memoryCoordinator.start(30000)

// 监听内存事件
memoryCoordinator.on('memory:warning', (stats) => {
  console.warn('[Memory] Warning threshold exceeded:', stats)
  // 可选：通知用户
})

memoryCoordinator.on('memory:critical', (stats) => {
  console.error('[Memory] Critical threshold exceeded:', stats)
  // 可选：显示警告对话框
})

memoryCoordinator.on('memory:restart-recommended', (stats) => {
  console.error('[Memory] Restart recommended:', stats)
  // 可选：提示用户重启应用
})

// 注册 FileChangeTracker 内存管理
const fileChangeMemoryManager = new FileChangeTrackerMemoryManager(
  fileChangeTracker,
  database
)
const fileChangeAdapter = new FileChangeTrackerMemoryAdapter(
  fileChangeTracker,
  fileChangeMemoryManager
)
memoryCoordinator.registerComponent(fileChangeAdapter)

// 应用退出时清理
app.on('before-quit', () => {
  memoryCoordinator.stop()
  memoryCoordinator.cleanup()
})
```

### 3.3 添加内存报告 IPC

```typescript
// src/main/ipc/systemHandlers.ts
ipcMain.handle('system:memory-report', async () => {
  const report = memoryCoordinator.generateReport()
  return createSuccessResponse({ report })
})

ipcMain.handle('system:memory-stats', async () => {
  const stats = memoryCoordinator.getMemoryStats()
  const trend = memoryCoordinator.getMemoryTrend()
  const components = memoryCoordinator.getComponentsInfo()
  
  return createSuccessResponse({ stats, trend, components })
})

ipcMain.handle('system:trigger-cleanup', async () => {
  await memoryCoordinator.triggerCleanup('normal')
  return createSuccessResponse({ success: true })
})
```

### 3.4 在 UI 中显示内存状态

```typescript
// src/renderer/components/settings/SystemInfo.tsx
import { useEffect, useState } from 'react'

export function SystemInfo() {
  const [memoryStats, setMemoryStats] = useState<any>(null)

  useEffect(() => {
    const fetchStats = async () => {
      const result = await window.spectrAI.system.getMemoryStats()
      if (result.success) {
        setMemoryStats(result.data)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 30000) // 每 30 秒更新

    return () => clearInterval(interval)
  }, [])

  if (!memoryStats) return null

  const { stats, trend, components } = memoryStats
  const rssMB = (stats.rss / 1024 / 1024).toFixed(2)

  return (
    <div className="system-info">
      <h3>内存使用</h3>
      <div>
        <span>当前: {rssMB} MB</span>
        <span>平均: {trend.average.toFixed(2)} MB</span>
        <span>峰值: {trend.peak.toFixed(2)} MB</span>
        <span>趋势: {trend.trend}</span>
      </div>
      
      <h4>组件内存</h4>
      <ul>
        {components.map((comp: any) => (
          <li key={comp.name}>
            {comp.name}: {comp.itemCount} 项, 
            {(comp.estimatedSize / 1024 / 1024).toFixed(2)} MB
          </li>
        ))}
      </ul>
      
      <button onClick={() => window.spectrAI.system.triggerCleanup()}>
        手动清理
      </button>
    </div>
  )
}
```

---

## 4. 集成步骤

### 步骤 1：更新 DatabaseManager

```typescript
// src/main/storage/Database.ts
import { LockManager } from '../concurrency/LockManager'

export class DatabaseManager {
  private lockManager: LockManager

  constructor(dbPath: string) {
    // ... 现有初始化代码
    this.lockManager = new LockManager(this.db)
  }

  getLockManager(): LockManager {
    return this.lockManager
  }

  cleanup(): void {
    this.lockManager.cleanup()
    // ... 现有清理代码
  }
}
```

### 步骤 2：更新主进程入口

```typescript
// src/main/index.ts
import { MemoryCoordinator } from './memory/MemoryCoordinator'
import { createErrorResponse, createSuccessResponse } from '../shared/errors'

// 创建内存协调器
const memoryCoordinator = new MemoryCoordinator()
memoryCoordinator.start()

// 注册内存管理组件
// ... (见 3.2 节)

// 传递 lockManager 给需要的组件
const lockManager = database.getLockManager()
const sessionManagerV2 = new SessionManagerV2(adapterRegistry, lockManager)
const agentManagerV2 = new AgentManagerV2(adapterRegistry, sessionManagerV2, database, lockManager)
```

### 步骤 3：更新 IPC Handlers

逐步更新所有 IPC Handler 使用新的错误处理：

```typescript
// src/main/ipc/sessionHandlers.ts
import { createErrorResponse, createSuccessResponse, ErrorCode } from '../../shared/errors'

// 替换所有返回格式
// 修改前：
return { success: false, error: error.message }

// 修改后：
return createErrorResponse(error, { operation: 'session.create' })
```

### 步骤 4：更新 Renderer Stores

更新所有 Store 处理新的错误响应格式：

```typescript
// src/renderer/stores/sessionStore.ts
import type { IpcResponse } from '../../shared/errors'

const createSession = async (config: SessionConfig) => {
  const result: IpcResponse<Session> = await safeAPI.session.create(config)
  
  if (!result.success) {
    set({ 
      error: result.error.userMessage,
      errorCode: result.error.code,
      errorRecoverable: result.error.recoverable
    })
    return null
  }
  
  return result.data
}
```

### 步骤 5：添加 React 错误边界

```typescript
// src/renderer/components/common/ErrorBoundary.tsx
import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
    // 可选：上报错误
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>出错了</h2>
          <p>应用遇到了一个错误，请刷新页面重试</p>
          <button onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

---

## 5. 测试建议

### 5.1 错误处理测试

```typescript
// tests/errors.test.ts
import { SpectrAIError, ErrorCode, ErrorHandler } from '../src/shared/errors'

describe('Error Handling', () => {
  it('should create SpectrAIError with user message', () => {
    const error = new SpectrAIError({
      code: ErrorCode.SESSION_NOT_FOUND,
      message: 'Session abc123 not found',
      context: { sessionId: 'abc123' }
    })

    expect(error.code).toBe(ErrorCode.SESSION_NOT_FOUND)
    expect(error.userMessage).toBe('会话不存在')
    expect(error.recoverable).toBe(false)
  })

  it('should handle unknown errors', () => {
    const error = ErrorHandler.handle(new Error('Unknown error'))
    expect(error).toBeInstanceOf(SpectrAIError)
    expect(error.code).toBe(ErrorCode.INTERNAL)
  })
})
```

### 5.2 并发控制测试

```typescript
// tests/lock-manager.test.ts
import { LockManager, createFileLock } from '../src/main/concurrency/LockManager'

describe('LockManager', () => {
  let lockManager: LockManager

  beforeEach(() => {
    lockManager = new LockManager(mockDb)
  })

  it('should acquire and release lock', () => {
    const resource = createFileLock('/test/file.txt')
    const acquired = lockManager.tryAcquire(resource, { owner: 'session1' })
    expect(acquired).toBe(true)

    const released = lockManager.release(resource, 'session1')
    expect(released).toBe(true)
  })

  it('should prevent concurrent access', () => {
    const resource = createFileLock('/test/file.txt')
    
    lockManager.tryAcquire(resource, { owner: 'session1' })
    const acquired2 = lockManager.tryAcquire(resource, { owner: 'session2' })
    
    expect(acquired2).toBe(false)
  })

  it('should auto-release expired locks', async () => {
    const resource = createFileLock('/test/file.txt')
    
    lockManager.tryAcquire(resource, { owner: 'session1', timeout: 100 })
    await new Promise(resolve => setTimeout(resolve, 150))
    
    const acquired2 = lockManager.tryAcquire(resource, { owner: 'session2' })
    expect(acquired2).toBe(true)
  })
})
```

### 5.3 内存管理测试

```typescript
// tests/memory-coordinator.test.ts
import { MemoryCoordinator } from '../src/main/memory/MemoryCoordinator'

describe('MemoryCoordinator', () => {
  let coordinator: MemoryCoordinator

  beforeEach(() => {
    coordinator = new MemoryCoordinator({
      warning: 100,
      critical: 200,
      maximum: 300
    })
  })

  it('should emit warning event when threshold exceeded', (done) => {
    coordinator.on('memory:warning', (stats) => {
      expect(stats).toBeDefined()
      done()
    })

    // 模拟内存使用超过阈值
    // ...
  })

  it('should trigger cleanup on high memory', async () => {
    const mockComponent = {
      name: 'TestComponent',
      cleanup: jest.fn().mockResolvedValue(undefined),
      getMemoryInfo: jest.fn().mockReturnValue({
        name: 'TestComponent',
        estimatedSize: 1000000,
        itemCount: 100
      })
    }

    coordinator.registerComponent(mockComponent)
    await coordinator.triggerCleanup('normal')

    expect(mockComponent.cleanup).toHaveBeenCalledWith('normal')
  })
})
```

---

## 6. 迁移检查清单

### 错误处理迁移

- [ ] 创建 `src/shared/errors.ts`
- [ ] 更新所有 IPC Handler 使用 `createErrorResponse` 和 `createSuccessResponse`
- [ ] 修复所有空 catch 块
- [ ] 更新 Renderer Store 处理新的错误格式
- [ ] 添加 React ErrorBoundary
- [ ] 添加错误处理单元测试

### 并发控制迁移

- [ ] 创建 `src/main/concurrency/LockManager.ts`
- [ ] 在 DatabaseManager 中集成 LockManager
- [ ] 为文件操作添加锁
- [ ] 为 Git 操作添加锁
- [ ] 为 Agent 执行添加锁
- [ ] 在会话结束时自动释放锁
- [ ] 添加并发控制单元测试

### 内存管理迁移

- [ ] 创建 `src/main/memory/MemoryCoordinator.ts`
- [ ] 在主进程中启动 MemoryCoordinator
- [ ] 集成 FileChangeTrackerMemoryManager
- [ ] 注册所有需要管理的组件
- [ ] 添加内存报告 IPC
- [ ] 在 UI 中显示内存状态
- [ ] 添加内存管理单元测试

---

## 7. 性能影响评估

### 错误处理

- **CPU 开销：** 极低（只在错误发生时）
- **内存开销：** 极低（错误对象很小）
- **延迟影响：** 无（不影响正常流程）

### 并发控制

- **CPU 开销：** 低（SQLite 查询很快）
- **内存开销：** 极低（锁表很小）
- **延迟影响：** 低（获取锁通常 < 1ms，等待锁时会阻塞）

### 内存管理

- **CPU 开销：** 低（每 30 秒检查一次）
- **内存开销：** 极低（只保留 100 条历史记录）
- **延迟影响：** 无（后台运行）

---

## 8. 常见问题

### Q1: 如何调试锁问题？

```typescript
// 列出所有活跃的锁
const locks = lockManager.listActiveLocks()
console.log('Active locks:', locks)

// 检查特定资源的锁
const lockInfo = lockManager.getLockInfo(createFileLock('/path/to/file'))
if (lockInfo) {
  console.log('Lock held by:', lockInfo.owner)
  console.log('Acquired at:', lockInfo.acquiredAt)
  console.log('Expires at:', lockInfo.expiresAt)
}

// 强制释放锁（管理员操作）
lockManager.forceRelease(createFileLock('/path/to/file'))
```

### Q2: 如何自定义内存阈值？

```typescript
const memoryCoordinator = new MemoryCoordinator({
  warning: 1000,  // 1 GB
  critical: 1500, // 1.5 GB
  maximum: 2000,  // 2 GB
})
```

### Q3: 如何添加自定义错误类型？

```typescript
// 在 src/shared/errors.ts 中添加新的错误代码
export enum ErrorCode {
  // ... 现有代码
  MY_CUSTOM_ERROR = 'ERR_MY_CUSTOM_ERROR',
}

// 在 getDefaultUserMessage 中添加用户友好的错误信息
private getDefaultUserMessage(code: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    // ... 现有消息
    [ErrorCode.MY_CUSTOM_ERROR]: '自定义错误的用户友好提示',
  }
  return messages[code] || '发生了未知错误'
}
```

---

## 9. 总结

通过实施这三个优化，项目将获得：

1. **更好的错误处理** - 用户友好的错误信息，清晰的错误边界
2. **更强的并发控制** - 防止数据竞态，保证操作原子性
3. **更稳定的内存管理** - 自动监控和清理，防止内存泄漏

建议按照以下顺序实施：

1. **第一周：** 错误处理（影响最大，实施最简单）
2. **第二周：** 并发控制（解决数据一致性问题）
3. **第三周：** 内存管理（提升长期稳定性）

每个阶段完成后进行充分测试，确保不影响现有功能。
