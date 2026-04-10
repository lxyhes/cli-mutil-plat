/**
 * Database - SQLite 数据库访问层（带内存降级方案）
 * @author weibin
 */

import type { ActivityEvent, AIProvider } from '../../shared/types'
import type { AgentInfo, AgentResult } from '../agent/types'
import { BUILTIN_MCPS } from '../mcp/builtinMcps'
import { BUILTIN_SKILLS } from '../skill/builtinSkills'
import { MIGRATIONS } from './migrations'
import { runMigrations } from './migrationRunner'

// re-export types
export * from './types'

// 导入所有 repository
import { TaskRepository } from './repositories/TaskRepository'
import { SessionRepository } from './repositories/SessionRepository'
import { LogRepository } from './repositories/LogRepository'
import { UsageRepository } from './repositories/UsageRepository'
import { ProviderRepository } from './repositories/ProviderRepository'
import { DirectoryRepository } from './repositories/DirectoryRepository'
import { AgentRepository } from './repositories/AgentRepository'
import { ConversationRepository } from './repositories/ConversationRepository'
import { SettingsRepository } from './repositories/SettingsRepository'
import { WorkspaceRepository } from './repositories/WorkspaceRepository'
import { McpRepository } from './repositories/McpRepository'
import { SkillRepository } from './repositories/SkillRepository'
import { LockManager } from '../concurrency/LockManager'
import type { MemoryManagedComponent, ComponentMemoryInfo } from '../memory/MemoryCoordinator'


/**
 * 数据库管理器
 * 优先使用 better-sqlite3，加载失败时自动降级为内存存储
 */
export class DatabaseManager implements MemoryManagedComponent {
  name = 'DatabaseManager'
  private db: any = null
  private usingSqlite: boolean = false
  private lockManager!: LockManager
  private lastCleanupTime?: Date

  // 所有 repository 实例
  private taskRepo!: TaskRepository
  private sessionRepo!: SessionRepository
  private logRepo!: LogRepository
  private usageRepo!: UsageRepository
  private providerRepo!: ProviderRepository
  private directoryRepo!: DirectoryRepository
  private agentRepo!: AgentRepository
  private conversationRepo!: ConversationRepository
  private settingsRepo!: SettingsRepository
  private workspaceRepo!: WorkspaceRepository
  private mcpRepo!: McpRepository
  private skillRepo!: SkillRepository


  constructor(dbPath: string) {
    try {
      // 尝试加载 better-sqlite3
      const Database = require('better-sqlite3')
      const path = require('path')
      const fs = require('fs')

      const dbDir = path.dirname(dbPath)
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true })
      }

      this.db = new Database(dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('foreign_keys = ON')
      this.initializeSchema()
      this.migrateSchema()
      this.usingSqlite = true
      console.log('[Database] SQLite initialized at', dbPath)
    } catch (error) {
      console.warn('[Database] better-sqlite3 unavailable, using in-memory fallback:', (error as Error).message)
      this.usingSqlite = false
    }

    // 初始化所有 repository
    this.taskRepo = new TaskRepository(this.db, this.usingSqlite)
    this.sessionRepo = new SessionRepository(this.db, this.usingSqlite)
    this.logRepo = new LogRepository(this.db, this.usingSqlite)
    this.usageRepo = new UsageRepository(this.db, this.usingSqlite)
    this.providerRepo = new ProviderRepository(this.db, this.usingSqlite)
    this.directoryRepo = new DirectoryRepository(this.db, this.usingSqlite)
    this.agentRepo = new AgentRepository(this.db, this.usingSqlite)
    this.conversationRepo = new ConversationRepository(this.db, this.usingSqlite)
    this.settingsRepo = new SettingsRepository(this.db, this.usingSqlite)
    this.workspaceRepo = new WorkspaceRepository(this.db, this.usingSqlite)
    this.mcpRepo = new McpRepository(this.db, this.usingSqlite)
    this.skillRepo = new SkillRepository(this.db, this.usingSqlite)

    // 初始化 LockManager
    this.lockManager = new LockManager(this.db)

    // 初始化内置预置数据
    this.insertBuiltinData()
  }

  private initializeSchema(): void {
    if (!this.db) return

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'medium',
        tags TEXT,
        parent_task_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        exit_code INTEGER,
        estimated_tokens INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL,
        claude_session_id TEXT
      );
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL,
        detail TEXT NOT NULL,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS session_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        chunk TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        date DATE NOT NULL,
        estimated_tokens INTEGER NOT NULL DEFAULT 0,
        active_minutes INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS favorite_directories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 1,
        last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS agent_sessions (
        agent_id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        prompt TEXT,
        work_dir TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_results (
        agent_id TEXT PRIMARY KEY,
        success INTEGER,
        exit_code INTEGER,
        output TEXT,
        error TEXT,
        artifacts TEXT,
        completed_at TEXT
      );
    `)

    // FTS5 虚拟表（需要单独创建，不能在多语句 exec 中）
    this.initializeFTS()
  }

  /**
   * 初始化 FTS5 全文搜索（需要单独执行）
   */
  private initializeFTS(): void {
    if (!this.db) return
    try {
      // 检查 FTS5 表是否已存在
      const exists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='session_logs_fts'"
      ).get()

      if (!exists) {
        this.db.exec(`
          CREATE VIRTUAL TABLE session_logs_fts USING fts5(
            session_id UNINDEXED,
            chunk,
            content='session_logs',
            content_rowid='id'
          );
        `)
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS session_logs_ai AFTER INSERT ON session_logs BEGIN
            INSERT INTO session_logs_fts(rowid, session_id, chunk)
            VALUES (new.id, new.session_id, new.chunk);
          END;
        `)
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS session_logs_ad AFTER DELETE ON session_logs BEGIN
            DELETE FROM session_logs_fts WHERE rowid = old.id;
          END;
        `)
        this.db.exec(`
          CREATE TRIGGER IF NOT EXISTS session_logs_au AFTER UPDATE ON session_logs BEGIN
            DELETE FROM session_logs_fts WHERE rowid = old.id;
            INSERT INTO session_logs_fts(rowid, session_id, chunk)
            VALUES (new.id, new.session_id, new.chunk);
          END;
        `)
        console.log('[Database] FTS5 full-text search index created')
      }
    } catch (err) {
      console.warn('[Database] FTS5 initialization failed (may not be supported):', (err as Error).message)
    }
  }

  /**
   * 数据库迁移 - 委托给版本化迁移运行器
   * 迁移定义见 ./migrations.ts，运行器见 ./migrationRunner.ts
   */
  private migrateSchema(): void {
    runMigrations(this.db, MIGRATIONS)
    
    // ★ 紧急修复：如果 team_instances 表不存在，手动创建（v31 迁移可能失败）
    this.ensureTeamsTablesExist()
  }

  /**
   * 确保 Agent Teams 表存在（紧急修复）
   */
  private ensureTeamsTablesExist(): void {
    if (!this.db || !this.usingSqlite) return
    
    try {
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'team_%'").all()
      const existingTables = tables.map((t: any) => t.name)
      
      if (!existingTables.includes('team_instances')) {
        console.log('[Database] Creating missing team_instances table...')
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS team_instances (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            template_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            work_dir TEXT NOT NULL,
            session_id TEXT NOT NULL,
            objective TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            completed_at DATETIME
          )
        `)
      }
      
      if (!existingTables.includes('team_members')) {
        console.log('[Database] Creating missing team_members table...')
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS team_members (
            id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            role_name TEXT NOT NULL,
            role_identifier TEXT NOT NULL,
            role_icon TEXT,
            role_color TEXT,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'idle',
            provider_id TEXT NOT NULL,
            current_task_id TEXT,
            joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_active_at DATETIME,
            FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
          )
        `)
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_team_members_instance ON team_members(instance_id)')
      }
      
      if (!existingTables.includes('team_tasks')) {
        console.log('[Database] Creating missing team_tasks table...')
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS team_tasks (
            id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            assigned_to TEXT,
            claimed_by TEXT,
            claimed_at DATETIME,
            priority TEXT NOT NULL DEFAULT 'medium',
            dependencies TEXT,
            result TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
          )
        `)
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_team_tasks_instance_status ON team_tasks(instance_id, status)')
      }
      
      if (!existingTables.includes('team_messages')) {
        console.log('[Database] Creating missing team_messages table...')
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS team_messages (
            id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            from_member_id TEXT NOT NULL,
            to_member_id TEXT,
            type TEXT NOT NULL DEFAULT 'role_message',
            content TEXT NOT NULL,
            timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
          )
        `)
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_team_messages_instance_timestamp ON team_messages(instance_id, timestamp DESC)')
      }
      
      if (!existingTables.includes('team_templates')) {
        console.log('[Database] Creating missing team_templates table...')
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS team_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            roles TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `)
      }
      
      // 更新 schema_version 到 31（如果低于 31）
      const row = this.db.prepare('SELECT MAX(version) AS max_ver FROM schema_version').get() as any
      const currentVersion = row?.max_ver ?? 0
      if (currentVersion < 31) {
        this.db.prepare('INSERT OR IGNORE INTO schema_version (version, description) VALUES (?, ?)').run(31, 'create Agent Teams tables (emergency fix)')
        console.log('[Database] Updated schema_version to 31')
      }
    } catch (err) {
      console.error('[Database] ensureTeamsTablesExist failed:', err)
    }
  }

  // ==================== 委托方法（保持 API 完全不变）====================

  // Tasks
  createTask = (...args: Parameters<TaskRepository['createTask']>) => this.taskRepo.createTask(...args)
  getTask = (...args: Parameters<TaskRepository['getTask']>) => this.taskRepo.getTask(...args)
  getAllTasks = () => this.taskRepo.getAllTasks()
  updateTask = (...args: Parameters<TaskRepository['updateTask']>) => this.taskRepo.updateTask(...args)
  deleteTask = (...args: Parameters<TaskRepository['deleteTask']>) => this.taskRepo.deleteTask(...args)

  // Sessions
  createSession = (...args: Parameters<SessionRepository['createSession']>) => this.sessionRepo.createSession(...args)
  updateSession = (...args: Parameters<SessionRepository['updateSession']>) => this.sessionRepo.updateSession(...args)
  deleteSession = (...args: Parameters<SessionRepository['deleteSession']>) => this.sessionRepo.deleteSession(...args)
  getSession = (...args: Parameters<SessionRepository['getSession']>) => this.sessionRepo.getSession(...args)
  isSessionNameLocked = (...args: Parameters<SessionRepository['isSessionNameLocked']>) => this.sessionRepo.isSessionNameLocked(...args)
  getAllSessions = () => this.sessionRepo.getAllSessions()
  getSessionActivities = (...args: Parameters<SessionRepository['getSessionActivities']>) => this.sessionRepo.getSessionActivities(...args)
  addActivityEvent = (...args: Parameters<SessionRepository['addActivityEvent']>) => this.sessionRepo.addActivityEvent(...args)
  resolveAllInterrupted = () => this.sessionRepo.resolveAllInterrupted()
  cleanupOrphanedSessions = () => this.sessionRepo.cleanupOrphanedSessions()

  // Logs
  appendLog = (...args: Parameters<LogRepository['appendLog']>) => this.logRepo.appendLog(...args)
  getSessionLogs = (...args: Parameters<LogRepository['getSessionLogs']>) => this.logRepo.getSessionLogs(...args)
  searchLogs = (...args: Parameters<LogRepository['searchLogs']>) => this.logRepo.searchLogs(...args)
  searchSessionLogs = (...args: Parameters<LogRepository['searchSessionLogs']>) => this.logRepo.searchSessionLogs(...args)
  cleanupOldLogs = (...args: Parameters<LogRepository['cleanupOldLogs']>) => this.logRepo.cleanupOldLogs(...args)

  // Usage
  saveUsageStat = (...args: Parameters<UsageRepository['saveUsageStat']>) => this.usageRepo.saveUsageStat(...args)
  getUsageSummary = () => this.usageRepo.getUsageSummary()
  getUsageHistory = (...args: Parameters<UsageRepository['getUsageHistory']>) => this.usageRepo.getUsageHistory(...args)

  // Providers
  getAllProviders = () => this.providerRepo.getAllProviders()
  getProvider = (...args: Parameters<ProviderRepository['getProvider']>) => this.providerRepo.getProvider(...args)
  createProvider = (...args: Parameters<ProviderRepository['createProvider']>) => this.providerRepo.createProvider(...args)
  updateProvider = (...args: Parameters<ProviderRepository['updateProvider']>) => this.providerRepo.updateProvider(...args)
  deleteProvider = (...args: Parameters<ProviderRepository['deleteProvider']>) => this.providerRepo.deleteProvider(...args)
  reorderProviders = (...args: Parameters<ProviderRepository['reorderProviders']>) => this.providerRepo.reorderProviders(...args)

  // Directories
  recordDirectoryUsage = (...args: Parameters<DirectoryRepository['recordDirectoryUsage']>) => this.directoryRepo.recordDirectoryUsage(...args)
  getRecentDirectories = (...args: Parameters<DirectoryRepository['getRecentDirectories']>) => this.directoryRepo.getRecentDirectories(...args)
  toggleDirectoryPin = (...args: Parameters<DirectoryRepository['toggleDirectoryPin']>) => this.directoryRepo.toggleDirectoryPin(...args)
  removeDirectory = (...args: Parameters<DirectoryRepository['removeDirectory']>) => this.directoryRepo.removeDirectory(...args)

  // Agent Sessions
  createAgentSession = (...args: Parameters<AgentRepository['createAgentSession']>) => this.agentRepo.createAgentSession(...args)
  updateAgentStatus = (...args: Parameters<AgentRepository['updateAgentStatus']>) => this.agentRepo.updateAgentStatus(...args)
  saveAgentResult = (...args: Parameters<AgentRepository['saveAgentResult']>) => this.agentRepo.saveAgentResult(...args)
  getAgentsByParent = (...args: Parameters<AgentRepository['getAgentsByParent']>) => this.agentRepo.getAgentsByParent(...args)
  getAgentInfo = (...args: Parameters<AgentRepository['getAgentInfo']>) => this.agentRepo.getAgentInfo(...args)
  addSessionSummary = (...args: Parameters<AgentRepository['addSessionSummary']>) => this.agentRepo.addSessionSummary(...args)
  getLatestSummary = (...args: Parameters<AgentRepository['getLatestSummary']>) => this.agentRepo.getLatestSummary(...args)
  getSessionSummaries = (...args: Parameters<AgentRepository['getSessionSummaries']>) => this.agentRepo.getSessionSummaries(...args)
  getAllSessionLatestSummaries = () => this.agentRepo.getAllSessionLatestSummaries()
  logAICall = (...args: Parameters<AgentRepository['logAICall']>) => this.agentRepo.logAICall(...args)
  getAICallLogs = (...args: Parameters<AgentRepository['getAICallLogs']>) => this.agentRepo.getAICallLogs(...args)

  // Conversation Messages
  insertConversationMessage = (...args: Parameters<ConversationRepository['insertConversationMessage']>) => this.conversationRepo.insertConversationMessage(...args)
  getConversationMessages = (...args: Parameters<ConversationRepository['getConversationMessages']>) => this.conversationRepo.getConversationMessages(...args)
  deleteConversationMessages = (...args: Parameters<ConversationRepository['deleteConversationMessages']>) => this.conversationRepo.deleteConversationMessages(...args)

  // App Settings
  getAppSettings = () => this.settingsRepo.getAppSettings()
  updateAppSetting = (...args: Parameters<SettingsRepository['updateAppSetting']>) => this.settingsRepo.updateAppSetting(...args)

  // Workspaces
  getAllWorkspaces = () => this.workspaceRepo.getAllWorkspaces()
  getWorkspace = (...args: Parameters<WorkspaceRepository['getWorkspace']>) => this.workspaceRepo.getWorkspace(...args)
  createWorkspace = (...args: Parameters<WorkspaceRepository['createWorkspace']>) => this.workspaceRepo.createWorkspace(...args)
  updateWorkspace = (...args: Parameters<WorkspaceRepository['updateWorkspace']>) => this.workspaceRepo.updateWorkspace(...args)
  deleteWorkspace = (...args: Parameters<WorkspaceRepository['deleteWorkspace']>) => this.workspaceRepo.deleteWorkspace(...args)

  // ─── MCP 操作 ───

  getAllMcps() { return this.mcpRepo.getAll() }
  getMcp(id: string) { return this.mcpRepo.get(id) }
  createMcp(server: Parameters<McpRepository['create']>[0]) { return this.mcpRepo.create(server) }
  updateMcp(id: string, updates: Parameters<McpRepository['update']>[1]) { return this.mcpRepo.update(id, updates) }
  deleteMcp(id: string) { return this.mcpRepo.delete(id) }
  getEnabledMcpsForProvider(providerId: string) { return this.mcpRepo.getEnabledForProvider(providerId) }
  toggleMcp(id: string, enabled: boolean) { return this.mcpRepo.toggleGlobal(id, enabled) }

  // ─── Skill 操作 ───

  getAllSkills() { return this.skillRepo.getAll() }
  getSkill(id: string) { return this.skillRepo.get(id) }
  getSkillByCommand(command: string) { return this.skillRepo.getBySlashCommand(command) }
  createSkill(skill: Parameters<SkillRepository['create']>[0]) { return this.skillRepo.create(skill) }
  updateSkill(id: string, updates: Parameters<SkillRepository['update']>[1]) { return this.skillRepo.update(id, updates) }
  deleteSkill(id: string) { return this.skillRepo.delete(id) }
  toggleSkill(id: string, enabled: boolean) { return this.skillRepo.toggleEnabled(id, enabled) }
  getCompatibleSkills(providerId: string) { return this.skillRepo.getCompatibleWith(providerId) }

  // ─── 内置数据初始化 ───

  private insertBuiltinData(): void {
    // 清理历史遗留的 session-ID 格式脏数据 skill（早期 bug 写入）
    this.skillRepo.cleanupSessionSkills()
    // 写入内置 MCP 服务器（INSERT OR IGNORE，已存在则跳过）
    for (const mcp of BUILTIN_MCPS) {
      this.mcpRepo.insertOrIgnore(mcp)
    }
    // 写入内置技能（INSERT OR IGNORE，已存在则跳过）
    for (const skill of BUILTIN_SKILLS) {
      this.skillRepo.insertOrIgnore(skill)
    }
  }

  /**
   * 获取 LockManager 实例
   */
  getLockManager(): LockManager {
    return this.lockManager
  }

  // ============================================================
  // 内存管理接口实现
  // ============================================================

  /**
   * 清理内存
   * @param mode normal: 常规清理（清理 30 天前的日志）, aggressive: 激进清理（清理 7 天前的日志 + VACUUM）
   */
  async cleanup(mode: 'normal' | 'aggressive'): Promise<void> {
    if (!this.usingSqlite || !this.db) {
      return
    }

    try {
      if (mode === 'normal') {
        // 常规清理：清理 30 天前的日志
        this.cleanupOldLogs(30)
      } else {
        // 激进清理：清理 7 天前的日志
        this.cleanupOldLogs(7)
      }

      // VACUUM（压缩数据库文件，回收空间）
      // 注意：VACUUM 会锁定整个数据库，可能耗时较长
      if (mode === 'aggressive') {
        console.log('[DatabaseManager] Running VACUUM...')
        this.db.exec('VACUUM')
        console.log('[DatabaseManager] VACUUM completed')
      }

      this.lastCleanupTime = new Date()
    } catch (err) {
      console.warn('[DatabaseManager] Cleanup failed:', err)
    }
  }

  /**
   * 获取内存信息
   */
  getMemoryInfo(): ComponentMemoryInfo {
    if (!this.usingSqlite || !this.db) {
      return {
        name: this.name,
        itemCount: 0,
        estimatedSize: 0,
        lastCleanup: this.lastCleanupTime?.toISOString()
      }
    }

    try {
      // 查询数据库统计信息
      const stats = this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM sessions) as sessionCount,
          (SELECT COUNT(*) FROM session_logs) as logCount,
          (SELECT COUNT(*) FROM conversation_messages) as messageCount,
          (SELECT COUNT(*) FROM activity_events) as activityCount
      `).get() as {
        sessionCount: number
        logCount: number
        messageCount: number
        activityCount: number
      }

      // 估算内存占用（SQLite 缓存 + 查询结果）
      // 日志每条约 500 字节，消息每条约 2KB，活动每条约 500 字节
      const estimatedSize =
        (stats.logCount * 500) +
        (stats.messageCount * 2000) +
        (stats.activityCount * 500)

      return {
        name: this.name,
        itemCount: stats.sessionCount,
        estimatedSize,
        lastCleanup: this.lastCleanupTime?.toISOString(),
        metadata: {
          sessionCount: stats.sessionCount,
          logCount: stats.logCount,
          messageCount: stats.messageCount,
          activityCount: stats.activityCount,
          usingSqlite: this.usingSqlite
        }
      }
    } catch (err) {
      console.warn('[DatabaseManager] Failed to get memory info:', err)
      return {
        name: this.name,
        itemCount: 0,
        estimatedSize: 0,
        lastCleanup: this.lastCleanupTime?.toISOString()
      }
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close()
      } catch (_err) { /* ignore */ }
    }
  }
}
