/**
 * 内存管理协调器
 * 集成 FileChangeTrackerMemoryManager 和其他内存管理组件
 * @author weibin
 */

import { EventEmitter } from 'events'

export interface MemoryStats {
  heapUsed: number
  heapTotal: number
  external: number
  rss: number
  timestamp: string
}

export interface MemoryThresholds {
  /** 警告阈值（MB） */
  warning: number
  /** 严重阈值（MB） */
  critical: number
  /** 最大阈值（MB），超过后强制清理 */
  maximum: number
}

export interface ComponentMemoryInfo {
  name: string
  estimatedSize: number
  itemCount: number
  lastCleanup?: string
}

/**
 * 内存管理协调器
 *
 * 职责：
 * 1. 监控全局内存使用
 * 2. 协调各组件的内存清理
 * 3. 触发自动清理策略
 * 4. 提供内存使用报告
 */
export class MemoryCoordinator extends EventEmitter {
  private monitorInterval: NodeJS.Timeout | null = null
  private components: Map<string, MemoryManagedComponent> = new Map()
  private memoryHistory: MemoryStats[] = []
  private readonly MAX_HISTORY = 100

  private thresholds: MemoryThresholds = {
    warning: 500,   // 500 MB
    critical: 800,  // 800 MB
    maximum: 1000,  // 1 GB
  }

  constructor(thresholds?: Partial<MemoryThresholds>) {
    super()
    if (thresholds) {
      this.thresholds = { ...this.thresholds, ...thresholds }
    }
  }

  /**
   * 启动内存监控
   */
  start(intervalMs: number = 30000): void {
    if (this.monitorInterval) {
      console.warn('[MemoryCoordinator] Already started')
      return
    }

    console.log('[MemoryCoordinator] Starting memory monitoring')
    this.monitorInterval = setInterval(() => {
      this.checkMemory()
    }, intervalMs)

    // 立即执行一次检查
    this.checkMemory()
  }

  /**
   * 停止内存监控
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
      console.log('[MemoryCoordinator] Stopped memory monitoring')
    }
  }

  /**
   * 注册需要管理的组件
   */
  registerComponent(component: MemoryManagedComponent): void {
    this.components.set(component.name, component)
    console.log(`[MemoryCoordinator] Registered component: ${component.name}`)
  }

  /**
   * 注销组件
   */
  unregisterComponent(name: string): void {
    this.components.delete(name)
    console.log(`[MemoryCoordinator] Unregistered component: ${name}`)
  }

  /**
   * 检查内存使用情况
   */
  private checkMemory(): void {
    const stats = this.getMemoryStats()
    this.memoryHistory.push(stats)

    // 保持历史记录在限制内
    if (this.memoryHistory.length > this.MAX_HISTORY) {
      this.memoryHistory.shift()
    }

    const heapUsedMB = stats.heapUsed / 1024 / 1024
    const rssMB = stats.rss / 1024 / 1024

    // 检查阈值
    if (rssMB >= this.thresholds.maximum) {
      console.error(`[MemoryCoordinator] CRITICAL: Memory usage ${rssMB.toFixed(2)} MB exceeds maximum ${this.thresholds.maximum} MB`)
      this.emit('memory:critical', stats)
      this.forceCleanup()
    } else if (rssMB >= this.thresholds.critical) {
      console.warn(`[MemoryCoordinator] WARNING: Memory usage ${rssMB.toFixed(2)} MB exceeds critical threshold ${this.thresholds.critical} MB`)
      this.emit('memory:high', stats)
      this.triggerCleanup('aggressive')
    } else if (rssMB >= this.thresholds.warning) {
      console.log(`[MemoryCoordinator] INFO: Memory usage ${rssMB.toFixed(2)} MB exceeds warning threshold ${this.thresholds.warning} MB`)
      this.emit('memory:warning', stats)
      this.triggerCleanup('normal')
    }

    // 定期发送内存统计
    this.emit('memory:stats', stats)
  }

  /**
   * 获取当前内存统计
   */
  getMemoryStats(): MemoryStats {
    const usage = process.memoryUsage()
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * 触发清理
   */
  private async triggerCleanup(mode: 'normal' | 'aggressive'): Promise<void> {
    console.log(`[MemoryCoordinator] Triggering ${mode} cleanup`)

    const cleanupPromises: Promise<void>[] = []

    for (const [name, component] of this.components) {
      try {
        cleanupPromises.push(
          component.cleanup(mode).then(() => {
            console.log(`[MemoryCoordinator] Cleaned up component: ${name}`)
          })
        )
      } catch (err) {
        console.error(`[MemoryCoordinator] Failed to cleanup component ${name}:`, err)
      }
    }

    await Promise.all(cleanupPromises)

    // 触发 V8 垃圾回收（如果可用）
    if (global.gc) {
      console.log('[MemoryCoordinator] Triggering manual GC')
      global.gc()
    }
  }

  /**
   * 强制清理（内存超过最大阈值时）
   */
  private async forceCleanup(): Promise<void> {
    console.error('[MemoryCoordinator] FORCE CLEANUP initiated')

    // 先执行 aggressive 清理
    await this.triggerCleanup('aggressive')

    // 再次检查内存
    const stats = this.getMemoryStats()
    const rssMB = stats.rss / 1024 / 1024

    if (rssMB >= this.thresholds.maximum) {
      console.error('[MemoryCoordinator] Memory still high after cleanup, consider restarting')
      this.emit('memory:restart-recommended', stats)
    }
  }

  /**
   * 获取所有组件的内存信息
   */
  getComponentsInfo(): ComponentMemoryInfo[] {
    const info: ComponentMemoryInfo[] = []

    for (const [name, component] of this.components) {
      try {
        info.push(component.getMemoryInfo())
      } catch (err) {
        console.error(`[MemoryCoordinator] Failed to get info for ${name}:`, err)
      }
    }

    return info
  }

  /**
   * 获取内存使用趋势
   */
  getMemoryTrend(): {
    current: number
    average: number
    peak: number
    trend: 'increasing' | 'stable' | 'decreasing'
  } {
    if (this.memoryHistory.length === 0) {
      return { current: 0, average: 0, peak: 0, trend: 'stable' }
    }

    const recent = this.memoryHistory.slice(-10)
    const current = recent[recent.length - 1].rss / 1024 / 1024
    const average = recent.reduce((sum, s) => sum + s.rss, 0) / recent.length / 1024 / 1024
    const peak = Math.max(...this.memoryHistory.map(s => s.rss)) / 1024 / 1024

    // 简单趋势判断：比较最近 5 个和之前 5 个的平均值
    let trend: 'increasing' | 'stable' | 'decreasing' = 'stable'
    if (recent.length >= 10) {
      const firstHalf = recent.slice(0, 5)
      const secondHalf = recent.slice(5, 10)
      const firstAvg = firstHalf.reduce((sum, s) => sum + s.rss, 0) / firstHalf.length
      const secondAvg = secondHalf.reduce((sum, s) => sum + s.rss, 0) / secondHalf.length

      const diff = secondAvg - firstAvg
      const threshold = firstAvg * 0.1 // 10% 变化

      if (diff > threshold) {
        trend = 'increasing'
      } else if (diff < -threshold) {
        trend = 'decreasing'
      }
    }

    return { current, average, peak, trend }
  }

  /**
   * 生成内存报告
   */
  generateReport(): string {
    const stats = this.getMemoryStats()
    const trend = this.getMemoryTrend()
    const components = this.getComponentsInfo()

    const lines = [
      '=== Memory Report ===',
      '',
      'Current Usage:',
      `  Heap Used: ${(stats.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `  Heap Total: ${(stats.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      `  RSS: ${(stats.rss / 1024 / 1024).toFixed(2)} MB`,
      `  External: ${(stats.external / 1024 / 1024).toFixed(2)} MB`,
      '',
      'Trend:',
      `  Current: ${trend.current.toFixed(2)} MB`,
      `  Average: ${trend.average.toFixed(2)} MB`,
      `  Peak: ${trend.peak.toFixed(2)} MB`,
      `  Trend: ${trend.trend}`,
      '',
      'Thresholds:',
      `  Warning: ${this.thresholds.warning} MB`,
      `  Critical: ${this.thresholds.critical} MB`,
      `  Maximum: ${this.thresholds.maximum} MB`,
      '',
      'Components:',
    ]

    for (const comp of components) {
      lines.push(`  ${comp.name}:`)
      lines.push(`    Items: ${comp.itemCount}`)
      lines.push(`    Estimated Size: ${(comp.estimatedSize / 1024 / 1024).toFixed(2)} MB`)
      if (comp.lastCleanup) {
        lines.push(`    Last Cleanup: ${comp.lastCleanup}`)
      }
    }

    return lines.join('\n')
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stop()
    this.components.clear()
    this.memoryHistory = []
  }
}

/**
 * 内存管理组件接口
 * 所有需要内存管理的组件都应实现此接口
 */
export interface MemoryManagedComponent {
  /** 组件名称 */
  name: string

  /**
   * 清理内存
   * @param mode normal: 常规清理, aggressive: 激进清理
   */
  cleanup(mode: 'normal' | 'aggressive'): Promise<void>

  /**
   * 获取内存信息
   */
  getMemoryInfo(): ComponentMemoryInfo
}

// ============================================================
// 使用示例
// ============================================================

/**
 * FileChangeTracker 的内存管理适配器
 */
export class FileChangeTrackerMemoryAdapter implements MemoryManagedComponent {
  name = 'FileChangeTracker'

  constructor(
    private tracker: any, // FileChangeTracker 实例
    private memoryManager: any // FileChangeTrackerMemoryManager 实例
  ) {}

  async cleanup(mode: 'normal' | 'aggressive'): Promise<void> {
    if (mode === 'aggressive') {
      // 激进清理：清理所有非活跃会话的数据
      this.memoryManager.forceCleanup()
    } else {
      // 常规清理：只清理过期数据
      this.memoryManager.cleanup()
    }
  }

  getMemoryInfo(): ComponentMemoryInfo {
    return this.memoryManager.getMemoryStats()
  }
}

/**
 * ConversationStore 的内存管理适配器
 */
export class ConversationMemoryAdapter implements MemoryManagedComponent {
  name = 'ConversationStore'

  constructor(private conversationRepo: any) {}

  async cleanup(mode: 'normal' | 'aggressive'): Promise<void> {
    // 清理超过 7 天的对话消息
    const daysToKeep = mode === 'aggressive' ? 3 : 7
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

    // TODO: 实现清理逻辑
    console.log(`[ConversationMemoryAdapter] Cleaning up messages older than ${daysToKeep} days`)
  }

  getMemoryInfo(): ComponentMemoryInfo {
    // TODO: 实现统计逻辑
    return {
      name: this.name,
      estimatedSize: 0,
      itemCount: 0,
    }
  }
}
