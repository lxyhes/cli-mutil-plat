/**
 * 知识中心服务
 * 整合项目知识库、跨会话记忆、工作记忆的管理与查询
 *
 * 架构设计：
 * - 统一数据模型：按 范围×生命周期 矩阵组织
 * - 统一查询接口：支持跨类型搜索和过滤
 * - 统一注入机制：协调各种知识的注入时机和内容
 */
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  UnifiedKnowledgeEntry,
  UnifiedKnowledgeType,
  UnifiedKnowledgeQuery,
  UnifiedKnowledgeResult,
  CreateUnifiedKnowledgeParams,
  UpdateUnifiedKnowledgeParams,
  UnifiedKnowledgeExport,
  KnowledgeInjectionConfig,
  KnowledgeInjectionResult
} from '../../shared/knowledgeCenterTypes'
import { ProjectKnowledgeService } from './ProjectKnowledgeService'
import { CrossSessionMemoryService } from '../cross-session-memory/CrossSessionMemoryService'
import { WorkingContextService } from '../working-context/WorkingContextService'

// 默认注入配置
const DEFAULT_INJECTION_CONFIG: KnowledgeInjectionConfig = {
  maxProjectKnowledgeLength: 4000,
  maxCrossSessionMemoryLength: 2000,
  maxWorkingContextLength: 2000,
  minPriorityToInject: 'low',
  enableDeduplication: true,
  deduplicationThreshold: 0.85,
  adaptiveLength: true
}

export class KnowledgeCenterService {
  private db: Database.Database | null = null
  private config: KnowledgeInjectionConfig

  // 子服务引用
  private projectKnowledgeService: ProjectKnowledgeService | null = null
  private crossSessionMemoryService: CrossSessionMemoryService | null = null
  private workingContextService: WorkingContextService | null = null

  constructor(config: Partial<KnowledgeInjectionConfig> = {}) {
    this.config = { ...DEFAULT_INJECTION_CONFIG, ...config }
  }

  /**
   * 初始化服务
   */
  async initialize(
    db: Database.Database,
    projectKnowledgeService: ProjectKnowledgeService,
    crossSessionMemoryService: CrossSessionMemoryService,
    workingContextService: WorkingContextService
  ): Promise<void> {
    this.db = db
    this.projectKnowledgeService = projectKnowledgeService
    this.crossSessionMemoryService = crossSessionMemoryService
    this.workingContextService = workingContextService

    // 创建统一的知识中心表
    this.createTables()

    console.log('[KnowledgeCenter] 初始化完成')
  }

  /**
   * 创建数据库表
   */
  private createTables(): void {
    if (!this.db) return

    // 统一知识表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS unified_knowledge (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        project_path TEXT,
        session_id TEXT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT, -- JSON 数组
        priority TEXT NOT NULL,
        auto_inject INTEGER DEFAULT 0,
        source TEXT NOT NULL,
        view_count INTEGER DEFAULT 0,
        use_count INTEGER DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT -- JSON 对象
      );

      CREATE INDEX IF NOT EXISTS idx_unified_knowledge_type ON unified_knowledge(type);
      CREATE INDEX IF NOT EXISTS idx_unified_knowledge_project ON unified_knowledge(project_path);
      CREATE INDEX IF NOT EXISTS idx_unified_knowledge_session ON unified_knowledge(session_id);
      CREATE INDEX IF NOT EXISTS idx_unified_knowledge_auto_inject ON unified_knowledge(project_path, auto_inject) WHERE auto_inject = 1;
      CREATE INDEX IF NOT EXISTS idx_unified_knowledge_updated ON unified_knowledge(updated_at DESC);
    `)

    // FTS5 全文搜索表
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS unified_knowledge_fts USING fts5(
        title,
        content,
        content='unified_knowledge',
        content_rowid='id'
      );

      -- 触发器：自动同步 FTS
      CREATE TRIGGER IF NOT EXISTS unified_knowledge_fts_insert AFTER INSERT ON unified_knowledge BEGIN
        INSERT INTO unified_knowledge_fts(rowid, title, content)
        VALUES (new.id, new.title, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS unified_knowledge_fts_update AFTER UPDATE ON unified_knowledge BEGIN
        UPDATE unified_knowledge_fts SET
          title = new.title,
          content = new.content
        WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS unified_knowledge_fts_delete AFTER DELETE ON unified_knowledge BEGIN
        DELETE FROM unified_knowledge_fts WHERE rowid = old.id;
      END;
    `)
  }

  /**
   * 创建知识条目
   */
  async createEntry(params: CreateUnifiedKnowledgeParams): Promise<UnifiedKnowledgeEntry> {
    if (!this.db) throw new Error('数据库未初始化')

    const now = new Date().toISOString()
    const entry: UnifiedKnowledgeEntry = {
      id: uuidv4(),
      type: params.type,
      scope: params.scope,
      lifecycle: params.lifecycle,
      projectPath: params.projectPath,
      sessionId: params.sessionId,
      category: params.category,
      title: params.title,
      content: params.content,
      tags: params.tags || [],
      priority: params.priority || 'medium',
      autoInject: params.autoInject ?? false,
      source: params.source || 'manual',
      viewCount: 0,
      useCount: 0,
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata || {}
    }

    const stmt = this.db.prepare(`
      INSERT INTO unified_knowledge (
        id, type, scope, lifecycle, project_path, session_id,
        category, title, content, tags, priority, auto_inject, source,
        view_count, use_count, created_at, updated_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      entry.id,
      entry.type,
      entry.scope,
      entry.lifecycle,
      entry.projectPath || null,
      entry.sessionId || null,
      entry.category,
      entry.title,
      entry.content,
      JSON.stringify(entry.tags),
      entry.priority,
      entry.autoInject ? 1 : 0,
      entry.source,
      entry.viewCount,
      entry.useCount,
      entry.createdAt,
      entry.updatedAt,
      JSON.stringify(entry.metadata)
    )

    console.log(`[KnowledgeCenter] 创建知识条目: ${entry.title} (${entry.type})`)
    return entry
  }

  /**
   * 查询知识条目
   */
  async queryEntries(query: UnifiedKnowledgeQuery): Promise<UnifiedKnowledgeResult> {
    if (!this.db) throw new Error('数据库未初始化')

    const page = query.page || 1
    const pageSize = query.pageSize || 20
    const offset = (page - 1) * pageSize

    // 构建 WHERE 子句
    const whereConditions: string[] = ['1=1']
    const params: any[] = []

    if (query.type) {
      if (Array.isArray(query.type)) {
        whereConditions.push(`type IN (${query.type.map(() => '?').join(',')})`)
        params.push(...query.type)
      } else {
        whereConditions.push('type = ?')
        params.push(query.type)
      }
    }

    if (query.scope) {
      whereConditions.push('scope = ?')
      params.push(query.scope)
    }

    if (query.lifecycle) {
      whereConditions.push('lifecycle = ?')
      params.push(query.lifecycle)
    }

    if (query.projectPath) {
      whereConditions.push('project_path = ?')
      params.push(query.projectPath)
    }

    if (query.sessionId) {
      whereConditions.push('session_id = ?')
      params.push(query.sessionId)
    }

    if (query.category) {
      if (Array.isArray(query.category)) {
        whereConditions.push(`category IN (${query.category.map(() => '?').join(',')})`)
        params.push(...query.category)
      } else {
        whereConditions.push('category = ?')
        params.push(query.category)
      }
    }

    if (query.tags && query.tags.length > 0) {
      // 使用 JSON 提取检查标签
      whereConditions.push(`EXISTS (
        SELECT 1 FROM json_each(tags)
        WHERE json_each.value IN (${query.tags.map(() => '?').join(',')})
      )`)
      params.push(...query.tags)
    }

    if (query.autoInject !== undefined) {
      whereConditions.push('auto_inject = ?')
      params.push(query.autoInject ? 1 : 0)
    }

    if (query.priority) {
      if (Array.isArray(query.priority)) {
        whereConditions.push(`priority IN (${query.priority.map(() => '?').join(',')})`)
        params.push(...query.priority)
      } else {
        whereConditions.push('priority = ?')
        params.push(query.priority)
      }
    }

    if (query.createdAfter) {
      whereConditions.push('created_at >= ?')
      params.push(query.createdAfter)
    }

    if (query.createdBefore) {
      whereConditions.push('created_at <= ?')
      params.push(query.createdBefore)
    }

    // 全文搜索
    let searchJoin = ''
    let searchWhere = ''
    if (query.searchQuery) {
      searchJoin = `
        INNER JOIN unified_knowledge_fts fts ON fts.rowid = k.id
      `
      searchWhere = ` AND unified_knowledge_fts MATCH ?`
      params.push(query.searchQuery)
    }

    const whereClause = whereConditions.join(' AND ')
    const sortColumn = query.sortBy === 'priority'
      ? `CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`
      : `k.${query.sortBy || 'updated_at'}`
    const sortOrder = query.sortOrder?.toUpperCase() || 'DESC'

    // 查询数据
    const dataStmt = this.db.prepare(`
      SELECT k.* FROM unified_knowledge k
      ${searchJoin}
      WHERE ${whereClause}${searchWhere}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `)

    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as total FROM unified_knowledge k
      ${searchJoin}
      WHERE ${whereClause}${searchWhere}
    `)

    const rows = dataStmt.all(...params, pageSize, offset) as any[]
    const countResult = countStmt.get(...params.slice(0, -2)) as { total: number }

    const entries: UnifiedKnowledgeEntry[] = rows.map(row => this.rowToEntry(row))
    const total = countResult?.total || 0

    return {
      entries,
      total,
      hasMore: offset + entries.length < total,
      page,
      pageSize
    }
  }

  /**
   * 更新知识条目
   */
  async updateEntry(id: string, updates: UpdateUnifiedKnowledgeParams): Promise<UnifiedKnowledgeEntry> {
    if (!this.db) throw new Error('数据库未初始化')

    const sets: string[] = []
    const params: any[] = []

    if (updates.category !== undefined) {
      sets.push('category = ?')
      params.push(updates.category)
    }
    if (updates.title !== undefined) {
      sets.push('title = ?')
      params.push(updates.title)
    }
    if (updates.content !== undefined) {
      sets.push('content = ?')
      params.push(updates.content)
    }
    if (updates.tags !== undefined) {
      sets.push('tags = ?')
      params.push(JSON.stringify(updates.tags))
    }
    if (updates.priority !== undefined) {
      sets.push('priority = ?')
      params.push(updates.priority)
    }
    if (updates.autoInject !== undefined) {
      sets.push('auto_inject = ?')
      params.push(updates.autoInject ? 1 : 0)
    }
    if (updates.metadata !== undefined) {
      sets.push('metadata = ?')
      params.push(JSON.stringify(updates.metadata))
    }

    sets.push('updated_at = ?')
    params.push(new Date().toISOString())
    params.push(id)

    const stmt = this.db.prepare(`
      UPDATE unified_knowledge SET ${sets.join(', ')} WHERE id = ?
    `)
    stmt.run(...params)

    // 返回更新后的条目
    const result = this.db.prepare('SELECT * FROM unified_knowledge WHERE id = ?').get(id) as any
    return this.rowToEntry(result)
  }

  /**
   * 批量更新
   */
  async updateBatch(ids: string[], updates: UpdateUnifiedKnowledgeParams): Promise<UnifiedKnowledgeEntry[]> {
    const updated: UnifiedKnowledgeEntry[] = []
    for (const id of ids) {
      updated.push(await this.updateEntry(id, updates))
    }
    return updated
  }

  /**
   * 删除知识条目
   */
  async deleteEntry(id: string): Promise<void> {
    if (!this.db) throw new Error('数据库未初始化')

    const stmt = this.db.prepare('DELETE FROM unified_knowledge WHERE id = ?')
    stmt.run(id)
  }

  /**
   * 批量删除
   */
  async deleteBatch(ids: string[]): Promise<void> {
    if (!this.db) throw new Error('数据库未初始化')

    const stmt = this.db.prepare(`DELETE FROM unified_knowledge WHERE id IN (${ids.map(() => '?').join(',')})`)
    stmt.run(...ids)
  }

  /**
   * 搜索记忆（跨会话记忆专用）
   */
  async searchMemory(query: string, limit: number = 10): Promise<UnifiedKnowledgeEntry[]> {
    if (!this.db) throw new Error('数据库未初始化')

    // 尝试 FTS5 搜索
    try {
      const stmt = this.db.prepare(`
        SELECT k.* FROM unified_knowledge k
        INNER JOIN unified_knowledge_fts fts ON fts.rowid = k.id
        WHERE unified_knowledge_fts MATCH ? AND k.type = 'cross-session-memory'
        ORDER BY rank
        LIMIT ?
      `)
      const rows = stmt.all(query, limit) as any[]
      return rows.map(row => this.rowToEntry(row))
    } catch (err) {
      // FTS 搜索失败，回退到 LIKE
      const stmt = this.db.prepare(`
        SELECT * FROM unified_knowledge
        WHERE type = 'cross-session-memory'
        AND (title LIKE ? OR content LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      const likeQuery = `%${query}%`
      const rows = stmt.all(likeQuery, likeQuery, limit) as any[]
      return rows.map(row => this.rowToEntry(row))
    }
  }

  /**
   * 生成注入 Prompt
   * 统一协调项目知识、跨会话记忆和工作记忆的注入
   */
  async generateInjectionPrompt(
    projectPath: string,
    sessionGoal?: string,
    sessionId?: string
  ): Promise<KnowledgeInjectionResult> {
    const injectedEntries: KnowledgeInjectionResult['injectedEntries'] = []
    const sections: string[] = []
    let totalLength = 0
    let truncated = false

    // 1. 项目知识注入
    const projectKnowledge = await this.getProjectKnowledgeForInjection(projectPath)
    if (projectKnowledge.length > 0) {
      const projectSection = this.formatProjectKnowledge(projectKnowledge)
      if (totalLength + projectSection.length <= this.config.maxProjectKnowledgeLength) {
        sections.push(projectSection)
        totalLength += projectSection.length
        injectedEntries.push(...projectKnowledge.map(k => ({
          type: 'project-knowledge' as const,
          id: k.id,
          title: k.title,
          priority: k.priority
        })))
      } else {
        truncated = true
      }
    }

    // 2. 跨会话记忆注入
    if (sessionGoal && this.crossSessionMemoryService) {
      const memoryPrompt = this.crossSessionMemoryService.generateInjectionPrompt(sessionGoal)
      if (memoryPrompt && totalLength + memoryPrompt.length <= this.config.maxCrossSessionMemoryLength) {
        sections.push(memoryPrompt)
        totalLength += memoryPrompt.length
      }
    }

    // 3. 工作记忆注入（如果有会话ID）
    if (sessionId && this.workingContextService) {
      const workingContext = await this.workingContextService.getContext(sessionId)
      if (workingContext) {
        const workingSection = this.formatWorkingContext(workingContext)
        if (totalLength + workingSection.length <= this.config.maxWorkingContextLength) {
          sections.push(workingSection)
          totalLength += workingSection.length
        }
      }
    }

    // 更新使用统计
    for (const entry of injectedEntries) {
      await this.incrementUseCount(entry.id)
    }

    return {
      prompt: sections.filter(Boolean).join('\n\n'),
      injectedEntries,
      totalLength,
      truncated
    }
  }

  /**
   * 获取项目知识用于注入
   */
  private async getProjectKnowledgeForInjection(projectPath: string): Promise<UnifiedKnowledgeEntry[]> {
    const result = await this.queryEntries({
      type: 'project-knowledge',
      projectPath,
      autoInject: true,
      pageSize: 50
    })
    return result.entries.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 }
      return priorityOrder[b.priority] - priorityOrder[a.priority]
    })
  }

  /**
   * 格式化项目知识
   */
  private formatProjectKnowledge(entries: UnifiedKnowledgeEntry[]): string {
    const lines = ['## 项目知识', '']
    for (const entry of entries) {
      lines.push(`### ${entry.title}`)
      lines.push(`[${entry.category}] ${entry.content}`)
      lines.push('')
    }
    return lines.join('\n')
  }

  /**
   * 格式化工作记忆
   */
  private formatWorkingContext(context: any): string {
    const lines = ['## 当前工作上下文', '']

    if (context.currentTask) {
      lines.push(`**当前任务**: ${context.currentTask}`)
    }

    if (context.problems?.length > 0) {
      lines.push('**待解决问题**:')
      context.problems.forEach((p: any) => {
        if (!p.resolved) lines.push(`- ${p.content}`)
      })
    }

    if (context.decisions?.length > 0) {
      lines.push('**关键决策**:')
      context.decisions.forEach((d: any) => lines.push(`- ${d.content}`))
    }

    if (context.todos?.length > 0) {
      lines.push('**待办事项**:')
      context.todos.forEach((t: any) => {
        if (!t.resolved) lines.push(`- [ ] ${t.content}`)
      })
    }

    return lines.join('\n')
  }

  /**
   * 增加使用计数
   */
  private async incrementUseCount(id: string): Promise<void> {
    if (!this.db) return

    const stmt = this.db.prepare(`
      UPDATE unified_knowledge
      SET use_count = use_count + 1, last_used_at = ?
      WHERE id = ?
    `)
    stmt.run(new Date().toISOString(), id)
  }

  /**
   * 导出数据
   */
  async exportData(projectPath?: string): Promise<UnifiedKnowledgeExport> {
    const query: UnifiedKnowledgeQuery = projectPath
      ? { projectPath, pageSize: 10000 }
      : { pageSize: 10000 }

    const result = await this.queryEntries(query)

    const byType: Record<string, number> = {}
    const byCategory: Record<string, number> = {}

    for (const entry of result.entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1
    }

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      projectPath,
      entries: result.entries,
      stats: {
        total: result.total,
        byType: byType as any,
        byCategory: byCategory as any
      }
    }
  }

  /**
   * 导入数据
   */
  async importData(data: UnifiedKnowledgeExport): Promise<number> {
    let count = 0
    for (const entry of data.entries) {
      try {
        await this.createEntry({
          type: entry.type,
          scope: entry.scope,
          lifecycle: entry.lifecycle,
          projectPath: entry.projectPath,
          sessionId: entry.sessionId,
          category: entry.category,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
          priority: entry.priority,
          autoInject: entry.autoInject,
          source: entry.source,
          metadata: entry.metadata
        })
        count++
      } catch (err) {
        console.warn(`[KnowledgeCenter] 导入条目失败: ${entry.title}`, err)
      }
    }
    return count
  }

  /**
   * 自动提取项目知识
   */
  async autoExtract(projectPath: string): Promise<{ count: number; extracted: string[] }> {
    if (!this.projectKnowledgeService) {
      return { count: 0, extracted: [] }
    }

    // 使用原有的 ProjectKnowledgeService 进行提取
    const result = await this.projectKnowledgeService.autoExtract(projectPath)

    if (result.success && result.count > 0) {
      // 刷新统一知识表
      await this.syncFromProjectKnowledge(projectPath)
    }

    return { count: result.count, extracted: result.extracted }
  }

  /**
   * 从会话提取知识
   */
  async extractFromSession(sessionId: string, projectPath: string): Promise<{ count: number; extracted: string[] }> {
    if (!this.projectKnowledgeService) {
      return { count: 0, extracted: [] }
    }

    const result = await this.projectKnowledgeService.extractFromSession(sessionId, projectPath)

    if (result.success && result.count > 0) {
      await this.syncFromProjectKnowledge(projectPath)
    }

    return { count: result.count, extracted: result.extracted }
  }

  /**
   * 从 ProjectKnowledgeService 同步数据
   */
  private async syncFromProjectKnowledge(projectPath: string): Promise<void> {
    if (!this.projectKnowledgeService || !this.db) return

    // 获取项目知识
    const entries = await this.projectKnowledgeService.getAll(projectPath)

    for (const entry of entries) {
      // 检查是否已存在
      const existing = this.db.prepare(
        'SELECT id FROM unified_knowledge WHERE id = ?'
      ).get(entry.id) as any

      if (!existing) {
        // 转换为统一格式并创建
        await this.createEntry({
          type: 'project-knowledge',
          scope: 'project',
          lifecycle: 'persistent',
          projectPath: entry.projectPath,
          category: entry.category as any,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
          priority: entry.priority as any,
          autoInject: entry.autoInject,
          source: entry.source as any
        })
      }
    }
  }

  /**
   * 公开迁移方法 - 从所有旧表迁移数据到新统一表
   * 可被主进程调用以执行初始数据迁移
   */
  async migrateAllData(): Promise<{
    projectKnowledge: number
    crossSessionMemory: number
    workingMemory: number
    total: number
  }> {
    const result = {
      projectKnowledge: 0,
      crossSessionMemory: 0,
      workingMemory: 0,
      total: 0
    }

    if (!this.db) {
      console.error('[KnowledgeCenter] 数据库未初始化，无法迁移')
      return result
    }

    try {
      // 1. 从 project_knowledge 迁移
      if (this.projectKnowledgeService) {
        const projectEntries = this.rawDbAll('SELECT * FROM project_knowledge')
        for (const row of projectEntries) {
          const existing = this.db.prepare(
            'SELECT id FROM unified_knowledge WHERE id = ?'
          ).get(row.id) as any

          if (!existing) {
            await this.createEntry({
              type: 'project-knowledge',
              scope: 'project',
              lifecycle: 'persistent',
              projectPath: row.project_path,
              category: row.category as any,
              title: row.title,
              content: row.content,
              tags: JSON.parse(row.tags || '[]'),
              priority: row.priority as any,
              autoInject: Boolean(row.auto_inject),
              source: row.source as any,
              metadata: {}
            })
            result.projectKnowledge++
          }
        }
      }

      // 2. 从 cross_session_memory 迁移 (如果表存在)
      if (this.crossSessionMemoryService) {
        try {
          const memoryEntries = this.rawDbAll(`
            SELECT * FROM cross_session_memory
            ORDER BY created_at DESC
            LIMIT 1000
          `)
          for (const row of memoryEntries) {
            // 为每个记忆生成统一条目
            await this.createEntry({
              type: 'cross-session-memory',
              scope: 'global',
              lifecycle: 'persistent',
              sessionId: row.session_id,
              category: 'summary',
              title: row.session_name || '会话摘要',
              content: row.summary || '',
              tags: JSON.parse(row.keywords || '[]'),
              priority: 'medium',
              autoInject: true,
              source: 'ai-generated',
              metadata: {
                keyPoints: row.key_points || '',
                originalId: row.id
              }
            })
            result.crossSessionMemory++
          }
        } catch (err) {
          console.warn('[KnowledgeCenter] 跨会话记忆表可能不存在:', err)
        }
      }

      // 3. 从 working_context 迁移 (如果表存在)
      if (this.workingContextService) {
        try {
          const contextEntries = this.rawDbAll(`
            SELECT * FROM working_context
            ORDER BY updated_at DESC
            LIMIT 1000
          `)
          for (const row of contextEntries) {
            const context = JSON.parse(row.context_data || '{}')
            
            // 迁移当前任务
            if (context.currentTask) {
              await this.createEntry({
                type: 'working-memory',
                scope: 'project',
                lifecycle: 'temporary',
                sessionId: row.session_id,
                category: 'task',
                title: '当前任务',
                content: context.currentTask,
                priority: 'medium',
                autoInject: true,
                source: 'manual',
                metadata: { itemType: 'task' }
              })
            }

            // 迁移问题
            if (context.problems) {
              for (const problem of context.problems) {
                await this.createEntry({
                  type: 'working-memory',
                  scope: 'project',
                  lifecycle: 'temporary',
                  sessionId: row.session_id,
                  category: 'task',
                  title: '问题',
                  content: problem.content,
                  priority: 'medium',
                  autoInject: false,
                  source: 'manual',
                  metadata: { itemType: 'problem', resolved: problem.resolved }
                })
                result.workingMemory++
              }
            }

            // 迁移决策
            if (context.decisions) {
              for (const decision of context.decisions) {
                await this.createEntry({
                  type: 'working-memory',
                  scope: 'project',
                  lifecycle: 'temporary',
                  sessionId: row.session_id,
                  category: 'task',
                  title: '决策',
                  content: decision.content,
                  priority: 'medium',
                  autoInject: false,
                  source: 'manual',
                  metadata: { itemType: 'decision' }
                })
                result.workingMemory++
              }
            }

            // 迁移待办
            if (context.todos) {
              for (const todo of context.todos) {
                await this.createEntry({
                  type: 'working-memory',
                  scope: 'project',
                  lifecycle: 'temporary',
                  sessionId: row.session_id,
                  category: 'task',
                  title: '待办',
                  content: todo.content,
                  priority: 'medium',
                  autoInject: false,
                  source: 'manual',
                  metadata: { itemType: 'todo', resolved: todo.resolved }
                })
                result.workingMemory++
              }
            }
          }
        } catch (err) {
          console.warn('[KnowledgeCenter] 工作记忆表可能不存在:', err)
        }
      }

      result.total = result.projectKnowledge + result.crossSessionMemory + result.workingMemory
      console.log(`[KnowledgeCenter] 数据迁移完成: 项目知识 ${result.projectKnowledge}, 跨会话记忆 ${result.crossSessionMemory}, 工作记忆 ${result.workingMemory}`)
    } catch (err) {
      console.error('[KnowledgeCenter] 数据迁移失败:', err)
    }

    return result
  }

  /**
   * 辅助方法 - 执行原始 SQL 查询获取所有行
   */
  private rawDbAll(sql: string): any[] {
    if (!this.db) return []
    try {
      const stmt = this.db.prepare(sql)
      return stmt.all()
    } catch {
      return []
    }
  }

  /**
   * 行数据转换为条目对象
   */
  private rowToEntry(row: any): UnifiedKnowledgeEntry {
    return {
      id: row.id,
      type: row.type,
      scope: row.scope,
      lifecycle: row.lifecycle,
      projectPath: row.project_path,
      sessionId: row.session_id,
      category: row.category,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      priority: row.priority,
      autoInject: Boolean(row.auto_inject),
      source: row.source,
      viewCount: row.view_count,
      useCount: row.use_count,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata || '{}')
    }
  }
}

// 导出单例
export const knowledgeCenterService = new KnowledgeCenterService()
