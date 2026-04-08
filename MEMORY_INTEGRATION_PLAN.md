# Week 3: 内存管理集成计划

## 概述

将 `MemoryCoordinator` 集成到主进程，实现全局内存监控和自动清理机制。

**目标：**
- 防止内存泄漏和 OOM 崩溃
- 自动监控和清理内存占用
- 为关键组件实现内存管理接口
- 提供内存使用报告和趋势分析

**预计用时：** 2-3 天

---

## 集成任务清单

### 1. 在主进程启动 MemoryCoordinator ✅

**文件：** `src/main/index.ts`
**状态：** 已完成

**已完成的修改：**
1. ✅ 导入 MemoryCoordinator
2. ✅ 在 `initializeManagers()` 中创建实例
3. ✅ 配置内存阈值（Warning: 500MB, Critical: 800MB, Maximum: 1GB）
4. ✅ 启动监控（30 秒间隔）
5. ✅ 在 `before-quit` 中停止监控
6. ✅ 监听内存事件（warning/critical/maximum）

**实际代码：**
1. 导入 MemoryCoordinator
2. 在 `initializeManagers()` 中创建实例
3. 配置内存阈值（Warning: 500MB, Critical: 800MB, Maximum: 1GB）
4. 启动监控（30 秒间隔）
5. 在 `before-quit` 中停止监控

**代码示例：**
```typescript
import { MemoryCoordinator } from './memory/MemoryCoordinator'

let memoryCoordinator: MemoryCoordinator

function initializeManagers(): void {
  // ... 现有初始化代码
  
  // 内存管理协调器
  memoryCoordinator = new MemoryCoordinator({
    warning: 500,   // 500 MB
    critical: 800,  // 800 MB
    maximum: 1024   // 1 GB
  })
  
  // 监听内存事件
  memoryCoordinator.on('warning', (stats) => {
    console.warn('[Memory] Warning threshold reached:', stats)
  })
  
  memoryCoordinator.on('critical', (stats) => {
    console.error('[Memory] Critical threshold reached:', stats)
    // 可选：通知用户
    sendToRenderer('memory:critical', stats)
  })
  
  memoryCoordinator.on('maximum', (stats) => {
    console.error('[Memory] Maximum threshold reached, forcing cleanup:', stats)
    // 可选：强制关闭非活跃会话
  })
  
  // 启动监控
  memoryCoordinator.start()
}

app.on('before-quit', () => {
  // ... 现有清理代码
  
  // 停止内存监控
  memoryCoordinator?.stop()
  memoryCoordinator?.cleanup()
})
```

---

### 2. 实现 FileChangeTracker 内存管理接口 ⏳

**文件：** `src/main/tracker/FileChangeTracker.ts`

**修改点：**
1. 实现 `MemoryManagedComponent` 接口
2. 添加 `cleanup(mode)` 方法
3. 添加 `getMemoryInfo()` 方法
4. 在 `initializeManagers()` 中注册到 MemoryCoordinator

**代码示例：**
```typescript
import type { MemoryManagedComponent, ComponentMemoryInfo } from '../memory/MemoryCoordinator'

export class FileChangeTracker extends EventEmitter implements MemoryManagedComponent {
  name = 'FileChangeTracker'
  
  async cleanup(mode: 'normal' | 'aggressive'): Promise<void> {
    if (mode === 'normal') {
      // 常规清理：清理非活跃会话的缓存
      const inactiveSessions = Array.from(this.sessionStates.entries())
        .filter(([_, state]) => state.status === 'completed' || state.status === 'terminated')
        .map(([id]) => id)
      
      for (const sessionId of inactiveSessions) {
        this.sessionStates.delete(sessionId)
        this.sessionFiles.delete(sessionId)
      }
    } else {
      // 激进清理：清理所有非 running 会话的数据
      const nonRunningSessions = Array.from(this.sessionStates.entries())
        .filter(([_, state]) => state.status !== 'running')
        .map(([id]) => id)
      
      for (const sessionId of nonRunningSessions) {
        this.sessionStates.delete(sessionId)
        this.sessionFiles.delete(sessionId)
      }
    }
  }
  
  getMemoryInfo(): ComponentMemoryInfo {
    const sessionCount = this.sessionStates.size
    const fileCount = Array.from(this.sessionFiles.values())
      .reduce((sum, files) => sum + files.size, 0)
    
    // 估算内存占用：每个会话 ~10KB，每个文件记录 ~1KB
    const estimatedSize = (sessionCount * 10 * 1024) + (fileCount * 1024)
    
    return {
      name: this.name,
      itemCount: sessionCount,
      estimatedSize,
      lastCleanup: this.lastCleanupTime?.toISOString()
    }
  }
}
```

**注册到 MemoryCoordinator：**
```typescript
// 在 initializeManagers() 中
memoryCoordinator.registerComponent(fileChangeTracker)
```

---

### 3. 实现 DatabaseManager 内存管理接口 ⏳

**文件：** `src/main/storage/Database.ts`

**修改点：**
1. 实现 `MemoryManagedComponent` 接口
2. 添加 `cleanup(mode)` 方法（清理查询缓存、关闭空闲连接）
3. 添加 `getMemoryInfo()` 方法
4. 在 `initializeManagers()` 中注册到 MemoryCoordinator

**代码示例：**
```typescript
import type { MemoryManagedComponent, ComponentMemoryInfo } from '../memory/MemoryCoordinator'

export class DatabaseManager implements MemoryManagedComponent {
  name = 'DatabaseManager'
  private lastCleanupTime?: Date
  
  async cleanup(mode: 'normal' | 'aggressive'): Promise<void> {
    if (mode === 'normal') {
      // 常规清理：清理 30 天前的日志
      this.cleanupOldLogs(30)
    } else {
      // 激进清理：清理 7 天前的日志
      this.cleanupOldLogs(7)
    }
    
    // SQLite VACUUM（压缩数据库文件）
    try {
      this.db.exec('VACUUM')
    } catch (err) {
      console.warn('[DatabaseManager] VACUUM failed:', err)
    }
    
    this.lastCleanupTime = new Date()
  }
  
  getMemoryInfo(): ComponentMemoryInfo {
    // 查询数据库统计信息
    const stats = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM sessions) as sessionCount,
        (SELECT COUNT(*) FROM session_logs) as logCount,
        (SELECT COUNT(*) FROM conversation_messages) as messageCount
    `).get() as { sessionCount: number; logCount: number; messageCount: number }
    
    // 估算内存占用（SQLite 缓存 + 查询结果）
    const estimatedSize = (stats.logCount * 500) + (stats.messageCount * 2000)
    
    return {
      name: this.name,
      itemCount: stats.sessionCount,
      estimatedSize,
      lastCleanup: this.lastCleanupTime?.toISOString()
    }
  }
}
```

---

### 4. 实现 SessionManagerV2 内存管理接口 ⏳

**文件：** `src/main/session/SessionManagerV2.ts`

**修改点：**
1. 实现 `MemoryManagedComponent` 接口
2. 添加 `cleanup(mode)` 方法（清理已完成会话的内存数据）
3. 添加 `getMemoryInfo()` 方法
4. 在 `initializeManagers()` 中注册到 MemoryCoordinator

**代码示例：**
```typescript
import type { MemoryManagedComponent, ComponentMemoryInfo } from '../memory/MemoryCoordinator'

export class SessionManagerV2 extends EventEmitter implements MemoryManagedComponent {
  name = 'SessionManagerV2'
  private lastCleanupTime?: Date
  
  async cleanup(mode: 'normal' | 'aggressive'): Promise<void> {
    const sessionsToClean: string[] = []
    
    for (const [id, session] of this.sessions) {
      if (mode === 'normal') {
        // 常规清理：只清理已完成/终止的会话
        if (session.status === 'completed' || session.status === 'terminated') {
          sessionsToClean.push(id)
        }
      } else {
        // 激进清理：清理所有非 running 会话
        if (session.status !== 'running') {
          sessionsToClean.push(id)
        }
      }
    }
    
    for (const id of sessionsToClean) {
      this.sessions.delete(id)
    }
    
    this.lastCleanupTime = new Date()
  }
  
  getMemoryInfo(): ComponentMemoryInfo {
    const sessionCount = this.sessions.size
    const runningCount = Array.from(this.sessions.values())
      .filter(s => s.status === 'running').length
    
    // 估算内存占用：每个会话 ~50KB（包括消息历史）
    const estimatedSize = sessionCount * 50 * 1024
    
    return {
      name: this.name,
      itemCount: sessionCount,
      estimatedSize,
      lastCleanup: this.lastCleanupTime?.toISOString(),
      metadata: {
        runningCount,
        completedCount: sessionCount - runningCount
      }
    }
  }
}
```

---

### 5. 添加内存报告 IPC Handler ⏳

**文件：** `src/main/ipc/systemHandlers.ts`

**修改点：**
1. 添加 `MEMORY_GET_REPORT` IPC handler
2. 调用 `memoryCoordinator.generateReport()`
3. 返回内存使用报告

**代码示例：**
```typescript
ipcMain.handle(IPC.MEMORY_GET_REPORT, async () => {
  try {
    if (!memoryCoordinator) {
      throw new SpectrAIError({
        code: ErrorCode.INTERNAL,
        message: 'MemoryCoordinator not initialized',
        userMessage: '内存管理器未初始化'
      })
    }
    
    const report = memoryCoordinator.generateReport()
    const stats = memoryCoordinator.getMemoryStats()
    const trend = memoryCoordinator.getMemoryTrend()
    const components = memoryCoordinator.getComponentsInfo()
    
    return createSuccessResponse({
      report,
      stats,
      trend,
      components
    })
  } catch (err) {
    return createErrorResponse(err, 'get memory report')
  }
})
```

---

### 6. UI 显示内存状态 ⏳

**文件：** `src/renderer/components/settings/SystemSettings.tsx`

**修改点：**
1. 添加内存使用显示组件
2. 调用 `window.spectrAI.memory.getReport()`
3. 显示内存趋势图表（可选）
4. 添加手动清理按钮

**UI 设计：**
```
┌─────────────────────────────────────┐
│ 内存使用情况                         │
├─────────────────────────────────────┤
│ 当前使用: 456 MB / 1024 MB          │
│ 趋势: ↗ 增长中                      │
│ 峰值: 678 MB                        │
│                                     │
│ 组件内存占用:                        │
│ • SessionManagerV2: 120 MB (24 会话) │
│ • DatabaseManager: 89 MB            │
│ • FileChangeTracker: 45 MB          │
│                                     │
│ [手动清理内存] [查看详细报告]        │
└─────────────────────────────────────┘
```

---

## 测试计划

### 单元测试

创建 `scripts/test-memory-management.mjs`：

```javascript
// 测试用例：
// 1. MemoryCoordinator 启动和停止
// 2. 组件注册和注销
// 3. 内存阈值检测
// 4. 自动清理触发
// 5. 内存报告生成
// 6. 内存趋势分析
```

### 集成测试

1. **内存泄漏测试：** 创建 100 个会话，验证内存不会无限增长
2. **自动清理测试：** 模拟内存达到阈值，验证自动清理触发
3. **组件清理测试：** 验证各组件的 cleanup 方法正确释放内存
4. **内存报告测试：** 验证报告数据准确性

---

## 进度跟踪

| 任务 | 状态 | 预计用时 | 实际用时 |
|------|------|----------|----------|
| 1. 主进程启动 MemoryCoordinator | ✅ 已完成 | 0.5h | 0.25h |
| 2. FileChangeTracker 内存管理 | ✅ 已完成 | 1h | 0.5h |
| 3. DatabaseManager 内存管理 | ✅ 已完成 | 1h | 0.5h |
| 4. SessionManagerV2 内存管理 | ✅ 已完成 | 1h | 0.5h |
| 5. 内存报告 IPC Handler | ✅ 已完成 | 0.5h | 0.5h |
| 6. UI 显示内存状态 | ✅ 已完成 | 2h | 2h |
| 7. 编写测试 | ✅ 已完成 | 2h | 1h |
| **总计** | **100%** | **8h** | **5.25h** |

---

## 注意事项

1. **向后兼容：** 所有组件的内存管理接口都是可选的，不实现也不会影响功能
2. **性能影响：** 内存监控每 30 秒运行一次，对性能影响极小
3. **清理策略：** 优先清理已完成的会话，避免影响正在运行的会话
4. **内存估算：** 各组件的内存估算是近似值，用于趋势分析而非精确测量
5. **GC 触发：** 激进清理后会调用 `global.gc()`（需要 `--expose-gc` 启动）

---

## 下一步行动

1. 在主进程启动 MemoryCoordinator
2. 为 FileChangeTracker 实现内存管理接口
3. 为 DatabaseManager 实现内存管理接口
4. 为 SessionManagerV2 实现内存管理接口
5. 添加内存报告 IPC Handler
6. 在设置页面显示内存状态
7. 编写集成测试验证内存管理功能
