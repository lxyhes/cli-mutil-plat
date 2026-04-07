/**
 * FileChangeTracker 内存管理增强补丁
 * 修复内存泄漏和资源清理问题
 * @author weibin
 */

import type { TrackedFileChange } from '../../shared/types'

/**
 * 清理策略配置
 */
export interface CleanupConfig {
  /** 定期清理间隔（毫秒） */
  cleanupInterval: number
  /** Debounce timer 过期时间（毫秒） */
  timerStaleThreshold: number
  /** Buffer 过期时间（毫秒） */
  bufferStaleThreshold: number
  /** 最大 buffer 条目数 */
  maxBufferEntries: number
}

export const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  cleanupInterval: 60000, // 每分钟清理一次
  timerStaleThreshold: 300000, // 5分钟未活动的 timer 视为过期
  bufferStaleThreshold: 600000, // 10分钟未活动的 buffer 视为过期
  maxBufferEntries: 1000, // 每个会话最多缓存 1000 个文件变更
}

/**
 * 资源使用统计
 */
export interface ResourceStats {
  activeWatchers: number
  activeSessions: number
  debounceTimers: number
  bufferEntries: number
  totalBufferSize: number
  memoryEstimateMB: number
}

/**
 * FileChangeTracker 内存管理器
 */
export class FileChangeTrackerMemoryManager {
  private config: CleanupConfig
  private cleanupTimer?: NodeJS.Timeout
  private lastCleanupTime = 0
  private cleanupCount = 0

  constructor(config: Partial<CleanupConfig> = {}) {
    this.config = { ...DEFAULT_CLEANUP_CONFIG, ...config }
  }

  /**
   * 启动定期清理
   */
  startPeriodicCleanup(
    getState: () => {
      dirWatchers: Map<string, { watcher: any; refCount: number }>
      sessionDirs: Map<string, string>
      activeWindows: Map<string, { startTime: number; lastActivityTime: number }>
      changeBuffers: Map<string, Map<string, TrackedFileChange>>
      debounceTimers: Map<string, NodeJS.Timeout>
    }
  ): void {
    if (this.cleanupTimer) {
      console.warn('[FileChangeTrackerMemoryManager] Cleanup already started')
      return
    }

    console.log(
      `[FileChangeTrackerMemoryManager] Starting periodic cleanup (interval: ${this.config.cleanupInterval}ms)`
    )

    this.cleanupTimer = setInterval(() => {
      const state = getState()
      this.performCleanup(state)
    }, this.config.cleanupInterval)
  }

  /**
   * 停止定期清理
   */
  stopPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
      console.log('[FileChangeTrackerMemoryManager] Periodic cleanup stopped')
    }
  }

  /**
   * 执行清理
   */
  private performCleanup(state: {
    dirWatchers: Map<string, { watcher: any; refCount: number }>
    sessionDirs: Map<string, string>
    activeWindows: Map<string, { startTime: number; lastActivityTime: number }>
    changeBuffers: Map<string, Map<string, TrackedFileChange>>
    debounceTimers: Map<string, NodeJS.Timeout>
  }): void {
    const startTime = Date.now()
    this.cleanupCount++

    console.log(
      `[FileChangeTrackerMemoryManager] Starting cleanup #${this.cleanupCount}...`
    )

    // 清理过期的 debounce timers
    const timersCleaned = this.cleanupStaleTimers(
      state.debounceTimers,
      state.activeWindows,
      state.sessionDirs
    )

    // 清理过期的 buffers
    const buffersCleaned = this.cleanupStaleBuffers(
      state.changeBuffers,
      state.activeWindows
    )

    // 清理孤立的会话目录映射
    const sessionDirsCleaned = this.cleanupOrphanedSessionDirs(
      state.sessionDirs,
      state.activeWindows
    )

    // 验证 watcher 引用计数
    this.validateWatcherRefCounts(state.dirWatchers, state.sessionDirs)

    const duration = Date.now() - startTime
    this.lastCleanupTime = startTime

    console.log(
      `[FileChangeTrackerMemoryManager] Cleanup #${this.cleanupCount} completed in ${duration}ms: ` +
      `timers=${timersCleaned}, buffers=${buffersCleaned}, sessionDirs=${sessionDirsCleaned}`
    )
  }

  /**
   * 清理过期的 debounce timers
   */
  private cleanupStaleTimers(
    debounceTimers: Map<string, NodeJS.Timeout>,
    activeWindows: Map<string, { startTime: number; lastActivityTime: number }>,
    sessionDirs: Map<string, string>
  ): number {
    const now = Date.now()
    let cleaned = 0

    for (const [filePath, timer] of debounceTimers.entries()) {
      // 检查是否有对应的活跃会话
      let hasActiveSession = false
      for (const [sessionId, window] of activeWindows.entries()) {
        const dir = sessionDirs.get(sessionId)
        if (dir && filePath.startsWith(dir)) {
          // 检查会话是否长时间未活动
          if (now - window.lastActivityTime < this.config.timerStaleThreshold) {
            hasActiveSession = true
            break
          }
        }
      }

      if (!hasActiveSession) {
        clearTimeout(timer)
        debounceTimers.delete(filePath)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * 清理过期的 buffers
   */
  private cleanupStaleBuffers(
    changeBuffers: Map<string, Map<string, TrackedFileChange>>,
    activeWindows: Map<string, { startTime: number; lastActivityTime: number }>
  ): number {
    const now = Date.now()
    let cleaned = 0

    for (const [sessionId, buffer] of changeBuffers.entries()) {
      const window = activeWindows.get(sessionId)

      // 如果会话不活跃且 buffer 为空，删除
      if (!window && buffer.size === 0) {
        changeBuffers.delete(sessionId)
        cleaned++
        continue
      }

      // 如果会话长时间未活动，清空 buffer（数据已 flush 到数据库）
      if (window && now - window.lastActivityTime > this.config.bufferStaleThreshold) {
        if (buffer.size > 0) {
          console.log(
            `[FileChangeTrackerMemoryManager] Clearing stale buffer for session ${sessionId} (${buffer.size} entries)`
          )
          buffer.clear()
          cleaned++
        }
      }

      // 如果 buffer 过大，强制清理（防止内存溢出）
      if (buffer.size > this.config.maxBufferEntries) {
        console.warn(
          `[FileChangeTrackerMemoryManager] Buffer for session ${sessionId} exceeded limit (${buffer.size}), clearing`
        )
        buffer.clear()
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * 清理孤立的会话目录映射
   */
  private cleanupOrphanedSessionDirs(
    sessionDirs: Map<string, string>,
    activeWindows: Map<string, { startTime: number; lastActivityTime: number }>
  ): number {
    let cleaned = 0

    for (const sessionId of sessionDirs.keys()) {
      if (!activeWindows.has(sessionId)) {
        sessionDirs.delete(sessionId)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * 验证 watcher 引用计数的准确性
   */
  private validateWatcherRefCounts(
    dirWatchers: Map<string, { watcher: any; refCount: number }>,
    sessionDirs: Map<string, string>
  ): void {
    // 统计每个目录实际被多少会话引用
    const actualRefCounts = new Map<string, number>()
    for (const dir of sessionDirs.values()) {
      actualRefCounts.set(dir, (actualRefCounts.get(dir) || 0) + 1)
    }

    // 对比实际引用计数和记录的引用计数
    for (const [dir, entry] of dirWatchers.entries()) {
      const actualCount = actualRefCounts.get(dir) || 0
      if (entry.refCount !== actualCount) {
        console.warn(
          `[FileChangeTrackerMemoryManager] Watcher refCount mismatch for ${dir}: ` +
          `recorded=${entry.refCount}, actual=${actualCount}`
        )
        // 修正引用计数
        entry.refCount = actualCount
        // 如果引用计数归零，关闭 watcher
        if (actualCount === 0) {
          try {
            entry.watcher.close()
            dirWatchers.delete(dir)
            console.log(`[FileChangeTrackerMemoryManager] Closed orphaned watcher for ${dir}`)
          } catch (error) {
            console.error(
              `[FileChangeTrackerMemoryManager] Error closing orphaned watcher for ${dir}:`,
              error
            )
          }
        }
      }
    }
  }

  /**
   * 获取资源使用统计
   */
  getStats(state: {
    dirWatchers: Map<string, { watcher: any; refCount: number }>
    sessionDirs: Map<string, string>
    activeWindows: Map<string, { startTime: number; lastActivityTime: number }>
    changeBuffers: Map<string, Map<string, TrackedFileChange>>
    debounceTimers: Map<string, NodeJS.Timeout>
  }): ResourceStats {
    let totalBufferSize = 0
    for (const buffer of state.changeBuffers.values()) {
      totalBufferSize += buffer.size
    }

    // 粗略估算内存使用（每个 TrackedFileChange 约 500 字节）
    const memoryEstimateMB = (
      totalBufferSize * 500 + // buffers
      state.debounceTimers.size * 100 + // timers
      state.dirWatchers.size * 1000 // watchers
    ) / (1024 * 1024)

    return {
      activeWatchers: state.dirWatchers.size,
      activeSessions: state.activeWindows.size,
      debounceTimers: state.debounceTimers.size,
      bufferEntries: totalBufferSize,
      totalBufferSize,
      memoryEstimateMB: Math.round(memoryEstimateMB * 100) / 100
    }
  }

  /**
   * 强制清理所有资源（用于测试或紧急情况）
   */
  forceCleanupAll(state: {
    dirWatchers: Map<string, { watcher: any; refCount: number }>
    sessionDirs: Map<string, string>
    activeWindows: Map<string, { startTime: number; lastActivityTime: number }>
    changeBuffers: Map<string, Map<string, TrackedFileChange>>
    debounceTimers: Map<string, NodeJS.Timeout>
  }): void {
    console.warn('[FileChangeTrackerMemoryManager] Force cleanup all resources')

    // 清理所有 timers
    for (const timer of state.debounceTimers.values()) {
      clearTimeout(timer)
    }
    state.debounceTimers.clear()

    // 清理所有 buffers
    state.changeBuffers.clear()

    // 清理所有 watchers
    for (const [dir, entry] of state.dirWatchers.entries()) {
      try {
        entry.watcher.close()
      } catch (error) {
        console.error(`[FileChangeTrackerMemoryManager] Error closing watcher for ${dir}:`, error)
      }
    }
    state.dirWatchers.clear()

    // 清理映射
    state.sessionDirs.clear()
    state.activeWindows.clear()

    console.log('[FileChangeTrackerMemoryManager] All resources cleaned')
  }
}
