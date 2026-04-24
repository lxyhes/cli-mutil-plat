/**
 * 数据迁移模块
 *
 * 项目从 ClaudeOps 更名为 SpectrAI 后，Electron 的 userData 路径
 * 从 %APPDATA%/claudeops 变为 %APPDATA%/spectrai。
 * 此模块在应用启动时自动将旧目录中的数据迁移到新目录。
 *
 * @author weibin
 */

import { app } from 'electron'
import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import type { DatabaseManager } from './storage/Database'
import { logger } from './logger'

/** 旧项目名（更名前） */
const LEGACY_APP_NAME = 'claudeops'

/** 迁移完成标记文件 */
const MIGRATION_MARKER = '.migrated-from-claudeops'

/**
 * 获取旧 userData 目录路径
 * Windows: %APPDATA%/claudeops
 * macOS: ~/Library/Application Support/claudeops
 * Linux: ~/.config/claudeops
 */
function getLegacyUserDataPath(): string {
  const currentPath = app.getPath('userData')
  const parentDir = dirname(currentPath)
  return join(parentDir, LEGACY_APP_NAME)
}

/**
 * 递归复制目录
 */
function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src)
  for (const entry of entries) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * 需要迁移的文件和目录列表
 */
const MIGRATION_ITEMS = [
  { path: 'claudeops.db', type: 'file' as const },
  { path: 'claudeops.db-wal', type: 'file' as const },
  { path: 'claudeops.db-shm', type: 'file' as const },
  { path: 'window-state.json', type: 'file' as const },
  { path: 'logs', type: 'dir' as const },
  { path: 'attachments', type: 'dir' as const },
]

/**
 * 执行从旧 userData 到新 userData 的数据迁移
 *
 * 调用时机：app.whenReady() 之后、initializeManagers() 之前
 *
 * @returns 迁移结果摘要
 */
export function migrateFromLegacyUserData(): { migrated: boolean; details: string[] } {
  const currentUserData = app.getPath('userData')
  const legacyUserData = getLegacyUserDataPath()
  const details: string[] = []

  // 如果当前 userData 就是旧路径（name 没改或已回退），无需迁移
  if (currentUserData === legacyUserData) {
    return { migrated: false, details: ['当前 userData 路径与旧路径相同，无需迁移'] }
  }

  // 如果旧目录不存在，没有可迁移的数据
  if (!existsSync(legacyUserData)) {
    return { migrated: false, details: ['旧数据目录不存在，跳过迁移'] }
  }

  // 如果已经迁移过，不再重复
  const markerPath = join(currentUserData, MIGRATION_MARKER)
  if (existsSync(markerPath)) {
    return { migrated: false, details: ['已完成迁移，跳过'] }
  }

  // 如果新目录中已有数据库，说明用户已经在新版本中产生了数据，不覆盖
  const newDbPath = join(currentUserData, 'claudeops.db')
  if (existsSync(newDbPath)) {
    // 仍然写标记，避免每次启动都检查
    mkdirSync(currentUserData, { recursive: true })
    writeFileSync(markerPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      skipped: true,
      reason: '新目录已存在数据库，跳过迁移以避免覆盖'
    }))
    details.push('新目录已存在数据库，跳过迁移以避免覆盖用户数据')
    return { migrated: false, details }
  }

  // 执行迁移
  console.log(`[migration] 检测到旧数据目录: ${legacyUserData}`)
  console.log(`[migration] 开始迁移到: ${currentUserData}`)
  mkdirSync(currentUserData, { recursive: true })

  let migratedCount = 0

  for (const item of MIGRATION_ITEMS) {
    const srcPath = join(legacyUserData, item.path)
    const destPath = join(currentUserData, item.path)

    if (!existsSync(srcPath)) {
      continue
    }

    try {
      if (item.type === 'file') {
        mkdirSync(dirname(destPath), { recursive: true })
        copyFileSync(srcPath, destPath)
        details.push(`✓ 已迁移文件: ${item.path}`)
      } else {
        copyDirSync(srcPath, destPath)
        details.push(`✓ 已迁移目录: ${item.path}`)
      }
      migratedCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      details.push(`✗ 迁移失败 ${item.path}: ${msg}`)
      console.error(`[migration] 迁移 ${item.path} 失败:`, err)
    }
  }

  // 写入迁移标记
  writeFileSync(markerPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    from: legacyUserData,
    to: currentUserData,
    migratedCount,
    details
  }, null, 2))

  console.log(`[migration] 迁移完成，共迁移 ${migratedCount} 项`)
  return { migrated: migratedCount > 0, details }
}

/**
 * 迁移 AI Provider API Key 加密格式
 *
 * 历史上 API Key 使用 userData 路径派生密钥加密，更名后路径变化导致解密失败。
 * 此函数将数据库中所有 provider 的 api_key_encrypted 字段
 * 用旧密钥解密后以新的固定密钥重新加密，一次性修复。
 *
 * @param database 已初始化的 DatabaseManager
 */
export function migrateApiKeyEncryption(_database: DatabaseManager): void {
  // API key re-encryption migration is no longer needed in community edition.
}

// ==================== 数据库迁移版本管理系统 ====================

/**
 * 数据库迁移接口
 */
export interface DatabaseMigration {
  /** 迁移版本号（从 1 开始递增） */
  version: number
  /** 迁移描述 */
  description: string
  /** 升级操作 */
  up: (db: DatabaseManager) => Promise<void>
  /** 降级操作（可选，用于回滚） */
  down?: (db: DatabaseManager) => Promise<void>
}

/**
 * 迁移版本记录表结构
 */
interface MigrationRecord {
  version: number
  applied_at: string
  execution_time_ms: number
}

/**
 * 定义所有数据库迁移
 * 
 * 注意：
 * 1. 版本号必须从 1 开始连续递增
 * 2. 每个迁移应该是幂等的（可以安全地重复执行）
 * 3. down 操作应该能够完全撤销 up 操作
 */
const MIGRATIONS: DatabaseMigration[] = [
  {
    version: 1,
    description: '初始化数据库 schema（会话、任务、对话消息等基础表）',
    up: async (db: DatabaseManager) => {
      // 这些表应该在 DatabaseManager 初始化时已经创建
      // 这里仅作为迁移记录的占位符
      logger.info('[Migration v1] 基础表已存在，跳过创建')
    },
    down: async (_db: DatabaseManager) => {
      // 不建议在生产环境执行此操作
      logger.warn('[Migration v1 downgrade] 危险操作：删除所有表')
    }
  },
  {
    version: 2,
    description: '添加团队功能相关表（teams, team_members, team_tasks, team_messages）',
    up: async (db: DatabaseManager) => {
      try {
        db.getDb().exec(`
          CREATE TABLE IF NOT EXISTS teams (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            name TEXT NOT NULL,
            objective TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            template_id TEXT,
            work_dir TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            cancelled_at TEXT,
            paused_at TEXT,
            resumed_at TEXT
          );
          
          CREATE TABLE IF NOT EXISTS team_members (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            role_name TEXT NOT NULL,
            agent_session_id TEXT,
            status TEXT NOT NULL DEFAULT 'idle',
            provider_type TEXT,
            system_prompt TEXT,
            joined_at TEXT NOT NULL,
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
          );
          
          CREATE TABLE IF NOT EXISTS team_tasks (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            assigned_to TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            priority TEXT NOT NULL DEFAULT 'medium',
            dependencies TEXT,
            output TEXT,
            created_at TEXT NOT NULL,
            claimed_at TEXT,
            completed_at TEXT,
            cancelled_at TEXT,
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
          );
          
          CREATE TABLE IF NOT EXISTS team_messages (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            from_member_id TEXT,
            to_member_id TEXT,
            message_type TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
          );
        `)
        logger.info('[Migration v2] 团队功能表创建成功')
      } catch (error) {
        logger.error('[Migration v2] 创建团队表失败:', error)
        throw error
      }
    },
    down: async (db: DatabaseManager) => {
      try {
        db.getDb().exec(`
          DROP TABLE IF EXISTS team_messages;
          DROP TABLE IF EXISTS team_tasks;
          DROP TABLE IF EXISTS team_members;
          DROP TABLE IF EXISTS teams;
        `)
        logger.info('[Migration v2 downgrade] 团队功能表已删除')
      } catch (error) {
        logger.error('[Migration v2 downgrade] 删除团队表失败:', error)
        throw error
      }
    }
  },
  {
    version: 3,
    description: '添加工作上下文和待办事项表',
    up: async (db: DatabaseManager) => {
      try {
        db.getDb().exec(`
          CREATE TABLE IF NOT EXISTS working_context_todos (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            is_resolved INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            resolved_at TEXT
          );
        `)
        logger.info('[Migration v3] 工作上下文表创建成功')
      } catch (error) {
        logger.error('[Migration v3] 创建工作上下文表失败:', error)
        throw error
      }
    },
    down: async (db: DatabaseManager) => {
      try {
        db.getDb().exec('DROP TABLE IF EXISTS working_context_todos;')
        logger.info('[Migration v3 downgrade] 工作上下文表已删除')
      } catch (error) {
        logger.error('[Migration v3 downgrade] 删除工作上下文表失败:', error)
        throw error
      }
    }
  },
  // 未来迁移示例：
  // {
  //   version: 4,
  //   description: '添加知识中心表',
  //   up: async (db: DatabaseManager) => { ... },
  //   down: async (db: DatabaseManager) => { ... }
  // }
]

/**
 * 获取当前数据库迁移版本
 */
function getCurrentVersion(db: DatabaseManager): number {
  try {
    const result = db.getDb().prepare(
      "SELECT value FROM app_settings WHERE key = 'db_migration_version'"
    ).get() as { value: string } | undefined
    
    return result ? parseInt(result.value, 10) : 0
  } catch {
    // 表不存在或查询失败，返回 0
    return 0
  }
}

/**
 * 保存当前数据库迁移版本
 */
function setCurrentVersion(db: DatabaseManager, version: number): void {
  try {
    // 确保 app_settings 表存在
    db.getDb().exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    
    db.getDb().prepare(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('db_migration_version', ?)"
    ).run(version.toString())
  } catch (error) {
    logger.error('[Migration] 保存迁移版本失败:', error)
    throw error
  }
}

/**
 * 记录迁移执行历史
 */
function recordMigration(db: DatabaseManager, migration: DatabaseMigration, executionTime: number): void {
  try {
    db.getDb().exec(`
      CREATE TABLE IF NOT EXISTS migration_history (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        execution_time_ms INTEGER NOT NULL
      );
    `)
    
    db.getDb().prepare(
      `INSERT OR REPLACE INTO migration_history (version, description, applied_at, execution_time_ms)
       VALUES (?, ?, ?, ?)`
    ).run(
      migration.version,
      migration.description,
      new Date().toISOString(),
      executionTime
    )
  } catch (error) {
    logger.error('[Migration] 记录迁移历史失败:', error)
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 执行数据库迁移
 * 
 * 调用时机：DatabaseManager 初始化之后，其他服务初始化之前
 * 
 * @param db 已初始化的 DatabaseManager
 * @returns 迁移结果摘要
 */
export async function runDatabaseMigrations(db: DatabaseManager): Promise<{
  migrated: boolean
  currentVersion: number
  appliedMigrations: number[]
  details: string[]
}> {
  const details: string[] = []
  const appliedMigrations: number[] = []
  
  // 获取当前版本
  const currentVersion = getCurrentVersion(db)
  const latestVersion = MIGRATIONS.length
  
  logger.info(`[Migration] 当前版本: ${currentVersion}, 最新版本: ${latestVersion}`)
  
  // 如果已是最新版本，无需迁移
  if (currentVersion >= latestVersion) {
    details.push(`数据库已是最新版本 (v${currentVersion})`)
    return {
      migrated: false,
      currentVersion,
      appliedMigrations,
      details
    }
  }
  
  // 执行待应用的迁移
  logger.info(`[Migration] 开始执行 ${latestVersion - currentVersion} 个迁移...`)
  
  for (let i = currentVersion; i < latestVersion; i++) {
    const migration = MIGRATIONS[i]
    
    if (!migration) {
      logger.error(`[Migration] 未找到迁移版本 ${i + 1}`)
      continue
    }
    
    const startTime = Date.now()
    
    try {
      logger.info(`[Migration v${migration.version}] 开始: ${migration.description}`)
      
      await migration.up(db)
      
      const executionTime = Date.now() - startTime
      
      // 更新版本号
      setCurrentVersion(db, migration.version)
      
      // 记录迁移历史
      recordMigration(db, migration, executionTime)
      
      appliedMigrations.push(migration.version)
      
      details.push(`✓ 迁移 v${migration.version} 成功 (${executionTime}ms)`)
      logger.info(`[Migration v${migration.version}] 完成 (${executionTime}ms)`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      details.push(`✗ 迁移 v${migration.version} 失败: ${errorMsg}`)
      logger.error(`[Migration v${migration.version}] 失败:`, error)
      
      // 迁移失败时停止后续迁移
      throw new Error(
        `数据库迁移 v${migration.version} 失败: ${errorMsg}\n\n` +
        `建议：备份数据库文件后重试，或联系技术支持。`
      )
    }
  }
  
  logger.info(`[Migration] 所有迁移完成，当前版本: ${latestVersion}`)
  
  return {
    migrated: appliedMigrations.length > 0,
    currentVersion: latestVersion,
    appliedMigrations,
    details
  }
}

/**
 * 回滚到指定版本（谨慎使用！）
 * 
 * @param db 已初始化的 DatabaseManager
 * @param targetVersion 目标版本号（0 表示回滚所有迁移）
 */
export async function rollbackDatabaseMigration(
  db: DatabaseManager,
  targetVersion: number = 0
): Promise<void> {
  const currentVersion = getCurrentVersion(db)
  
  if (targetVersion >= currentVersion) {
    logger.warn(`[Rollback] 目标版本 (${targetVersion}) >= 当前版本 (${currentVersion})，无需回滚`)
    return
  }
  
  logger.warn(`[Rollback] 开始回滚: v${currentVersion} → v${targetVersion}`)
  
  // 倒序执行 down 操作
  for (let i = currentVersion; i > targetVersion; i--) {
    const migration = MIGRATIONS[i - 1]
    
    if (!migration) {
      logger.error(`[Rollback] 未找到迁移版本 ${i}`)
      continue
    }
    
    if (!migration.down) {
      logger.warn(`[Rollback v${migration.version}] 没有定义 down 操作，跳过`)
      continue
    }
    
    try {
      logger.info(`[Rollback v${migration.version}] 开始回滚...`)
      await migration.down(db)
      setCurrentVersion(db, migration.version - 1)
      logger.info(`[Rollback v${migration.version}] 回滚成功`)
    } catch (error) {
      logger.error(`[Rollback v${migration.version}] 回滚失败:`, error)
      throw error
    }
  }
  
  logger.info(`[Rollback] 回滚完成，当前版本: ${targetVersion}`)
}
