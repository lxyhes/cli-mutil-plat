/**
 * 分布式锁管理器（基于 SQLite）
 * 用于多会话并发控制和文件操作互斥
 * @author weibin
 */

import type { Database } from 'better-sqlite3'

export interface LockOptions {
  /** 锁超时时间（毫秒），默认 30 秒 */
  timeout?: number
  /** 锁持有者标识（通常是 sessionId） */
  owner: string
  /** 锁的元数据 */
  metadata?: Record<string, any>
}

export interface LockInfo {
  resource: string
  owner: string
  acquiredAt: string
  expiresAt: string
  metadata?: Record<string, any>
}

/**
 * 分布式锁管理器
 *
 * 使用场景：
 * 1. 文件操作互斥（防止多会话同时修改同一文件）
 * 2. Git 操作互斥（防止并发 commit/push）
 * 3. 数据库事务互斥（跨 Repository 操作）
 * 4. Agent 执行互斥（防止重复执行）
 */
export class LockManager {
  private db: Database | null
  private cleanupInterval: NodeJS.Timeout | null = null
  private readonly DEFAULT_TIMEOUT = 30000 // 30 秒

  constructor(db: Database | null) {
    this.db = db
    this.initializeSchema()
    this.startCleanupTask()
  }

  /**
   * 初始化锁表
   */
  private initializeSchema(): void {
    if (!this.db) return

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resource_locks (
        resource TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_locks_expires_at ON resource_locks(expires_at);
      CREATE INDEX IF NOT EXISTS idx_locks_owner ON resource_locks(owner);
    `)
  }

  /**
   * 启动定期清理过期锁的任务
   */
  private startCleanupTask(): void {
    // 每 10 秒清理一次过期锁
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredLocks()
    }, 10000)
  }

  /**
   * 清理过期锁
   */
  private cleanupExpiredLocks(): void {
    if (!this.db) return

    try {
      const now = new Date().toISOString()
      const result = this.db.prepare(`
        DELETE FROM resource_locks
        WHERE expires_at < ?
      `).run(now)

      if (result.changes > 0) {
        console.log(`[LockManager] Cleaned up ${result.changes} expired locks`)
      }
    } catch (err) {
      console.error('[LockManager] Failed to cleanup expired locks:', err)
    }
  }

  /**
   * 获取锁（阻塞式，会重试直到获取成功或超时）
   *
   * @param resource 资源标识（如文件路径、操作名称）
   * @param options 锁选项
   * @returns 是否成功获取锁
   */
  async acquire(resource: string, options: LockOptions): Promise<boolean> {
    const timeout = options.timeout || this.DEFAULT_TIMEOUT
    const startTime = Date.now()
    const retryInterval = 100 // 100ms 重试间隔

    while (Date.now() - startTime < timeout) {
      if (this.tryAcquire(resource, options)) {
        return true
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, retryInterval))
    }

    console.warn(`[LockManager] Failed to acquire lock for ${resource} after ${timeout}ms`)
    return false
  }

  /**
   * 尝试获取锁（非阻塞）
   *
   * @param resource 资源标识
   * @param options 锁选项
   * @returns 是否成功获取锁
   */
  tryAcquire(resource: string, options: LockOptions): boolean {
    if (!this.db) {
      // 无数据库时降级为无锁模式（开发环境）
      console.warn('[LockManager] Database not available, lock disabled')
      return true
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + (options.timeout || this.DEFAULT_TIMEOUT))

    try {
      // 先清理该资源的过期锁
      this.db.prepare(`
        DELETE FROM resource_locks
        WHERE resource = ? AND expires_at < ?
      `).run(resource, now.toISOString())

      // 尝试插入锁记录
      const result = this.db.prepare(`
        INSERT INTO resource_locks (resource, owner, acquired_at, expires_at, metadata)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        resource,
        options.owner,
        now.toISOString(),
        expiresAt.toISOString(),
        options.metadata ? JSON.stringify(options.metadata) : null
      )

      return result.changes > 0
    } catch (err: any) {
      // UNIQUE constraint 冲突表示锁已被占用
      if (err.code === 'SQLITE_CONSTRAINT') {
        return false
      }
      console.error('[LockManager] Failed to acquire lock:', err)
      return false
    }
  }

  /**
   * 释放锁
   *
   * @param resource 资源标识
   * @param owner 锁持有者（必须匹配才能释放）
   * @returns 是否成功释放
   */
  release(resource: string, owner: string): boolean {
    if (!this.db) return true

    try {
      const result = this.db.prepare(`
        DELETE FROM resource_locks
        WHERE resource = ? AND owner = ?
      `).run(resource, owner)

      if (result.changes === 0) {
        console.warn(`[LockManager] Lock not found or owner mismatch: ${resource}`)
        return false
      }

      return true
    } catch (err) {
      console.error('[LockManager] Failed to release lock:', err)
      return false
    }
  }

  /**
   * 强制释放锁（管理员操作，忽略 owner 检查）
   *
   * @param resource 资源标识
   * @returns 是否成功释放
   */
  forceRelease(resource: string): boolean {
    if (!this.db) return true

    try {
      const result = this.db.prepare(`
        DELETE FROM resource_locks
        WHERE resource = ?
      `).run(resource)

      return result.changes > 0
    } catch (err) {
      console.error('[LockManager] Failed to force release lock:', err)
      return false
    }
  }

  /**
   * 检查锁是否被占用
   *
   * @param resource 资源标识
   * @returns 锁信息，如果未被占用则返回 null
   */
  getLockInfo(resource: string): LockInfo | null {
    if (!this.db) return null

    try {
      const now = new Date().toISOString()

      // 先清理过期锁
      this.db.prepare(`
        DELETE FROM resource_locks
        WHERE resource = ? AND expires_at < ?
      `).run(resource, now)

      // 查询锁信息
      const row = this.db.prepare(`
        SELECT resource, owner, acquired_at, expires_at, metadata
        FROM resource_locks
        WHERE resource = ?
      `).get(resource) as any

      if (!row) return null

      return {
        resource: row.resource,
        owner: row.owner,
        acquiredAt: row.acquired_at,
        expiresAt: row.expires_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }
    } catch (err) {
      console.error('[LockManager] Failed to get lock info:', err)
      return null
    }
  }

  /**
   * 列出所有活跃的锁
   *
   * @returns 锁信息列表
   */
  listActiveLocks(): LockInfo[] {
    if (!this.db) return []

    try {
      const now = new Date().toISOString()

      const rows = this.db.prepare(`
        SELECT resource, owner, acquired_at, expires_at, metadata
        FROM resource_locks
        WHERE expires_at >= ?
        ORDER BY acquired_at DESC
      `).all(now) as any[]

      return rows.map(row => ({
        resource: row.resource,
        owner: row.owner,
        acquiredAt: row.acquired_at,
        expiresAt: row.expires_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }))
    } catch (err) {
      console.error('[LockManager] Failed to list active locks:', err)
      return []
    }
  }

  /**
   * 释放指定 owner 的所有锁（会话结束时调用）
   *
   * @param owner 锁持有者
   * @returns 释放的锁数量
   */
  releaseAllByOwner(owner: string): number {
    if (!this.db) return 0

    try {
      const result = this.db.prepare(`
        DELETE FROM resource_locks
        WHERE owner = ?
      `).run(owner)

      if (result.changes > 0) {
        console.log(`[LockManager] Released ${result.changes} locks for owner: ${owner}`)
      }

      return result.changes
    } catch (err) {
      console.error('[LockManager] Failed to release locks by owner:', err)
      return 0
    }
  }

  async releaseAllLocksForOwner(owner: string): Promise<number> {
    return this.releaseAllByOwner(owner)
  }

  /**
   * 使用锁执行操作（自动获取和释放）
   *
   * @param resource 资源标识
   * @param options 锁选项
   * @param fn 要执行的操作
   * @returns 操作结果
   */
  async withLock<T>(
    resource: string,
    options: LockOptions,
    fn: () => Promise<T>
  ): Promise<T> {
    const acquired = await this.acquire(resource, options)

    if (!acquired) {
      throw new Error(`Failed to acquire lock for resource: ${resource}`)
    }

    try {
      return await fn()
    } finally {
      this.release(resource, options.owner)
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 文件锁：防止多会话同时修改同一文件
 */
export function createFileLock(filePath: string): string {
  return `file:${filePath}`
}

/**
 * Git 操作锁：防止并发 Git 操作
 */
export function createGitLock(repoPath: string, operation: string): string {
  return `git:${repoPath}:${operation}`
}

/**
 * Agent 执行锁：防止重复执行
 */
export function createAgentLock(agentId: string): string {
  return `agent:${agentId}`
}

/**
 * 数据库事务锁：跨 Repository 操作
 */
export function createTransactionLock(transactionId: string): string {
  return `transaction:${transactionId}`
}
