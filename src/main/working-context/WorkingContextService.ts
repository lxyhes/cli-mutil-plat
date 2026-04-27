/**
 * WorkingContextService - 会话级工作记忆
 *
 * 每个会话关联一个轻量工作上下文（当前任务、遇到的问题、已做决策、待办、关键代码片段）
 * 切换会话时自动快照，切回来时一键恢复
 *
 * 持久化：SQLite 存储，重启后自动恢复
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { DatabaseManager } from '../storage/Database'
import type BetterSqlite3 from 'better-sqlite3'

// ─── 类型定义 ─────────────────────────────────────────────

export interface WorkingContext {
  /** 关联的会话 ID */
  sessionId: string
  /** 当前任务描述 */
  currentTask: string
  /** 遇到的问题 */
  problems: ContextItem[]
  /** 已做决策 */
  decisions: ContextItem[]
  /** 待办事项 */
  todos: ContextItem[]
  /** 关键代码片段 */
  codeSnippets: CodeSnippet[]
  /** AI 自动提取的关键点 */
  autoExtractedPoints: string[]
  /** 最后更新时间 */
  updatedAt: string
  /** 快照列表 */
  snapshots: ContextSnapshot[]
}

export interface ContextItem {
  id: string
  content: string
  createdAt: string
  isPinned?: boolean
  resolved?: boolean
  resolvedAt?: string
}

export interface CodeSnippet {
  id: string
  filePath: string
  lineRange?: string
  content: string
  note?: string
  createdAt: string
  isPinned?: boolean
}

export interface ContextSnapshot {
  id: string
  timestamp: string
  trigger: 'manual' | 'session-switch' | 'auto-interval'
  summary: string
  items: {
    task: string
    problemCount: number
    decisionCount: number
    todoCount: number
    unresolvedProblems: number
  }
}

// ─── 服务 ─────────────────────────────────────────────────

export class WorkingContextService extends EventEmitter {
  private contexts: Map<string, WorkingContext> = new Map()
  private autoExtractInterval: ReturnType<typeof setInterval> | null = null
  private rawDb: BetterSqlite3.Database | null = null
  private db: DatabaseManager

  constructor(db: DatabaseManager) {
    super()
    this.db = db
    this.initDatabase()
    this.loadFromDatabase()
  }

  private getRawDb(): BetterSqlite3.Database {
    if (!this.rawDb) {
      this.rawDb = (this.db as any).db as BetterSqlite3.Database
    }
    return this.rawDb!
  }

  private ensureColumn(db: BetterSqlite3.Database, table: string, column: string, definition: string): void {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some(item => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  /** 初始化数据库表 */
  private initDatabase(): void {
    const db = this.getRawDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS working_contexts (
        session_id TEXT PRIMARY KEY,
        current_task TEXT NOT NULL DEFAULT '',
        auto_extracted_points TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS working_context_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        file_path TEXT,
        line_range TEXT,
        note TEXT,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES working_contexts(session_id) ON DELETE CASCADE
      )
    `)
    this.ensureColumn(db, 'working_context_items', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0')
    db.exec('CREATE INDEX IF NOT EXISTS idx_wci_session ON working_context_items(session_id, category)')
    db.exec(`
      CREATE TABLE IF NOT EXISTS working_context_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        items_json TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES working_contexts(session_id) ON DELETE CASCADE
      )
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_wcs_session ON working_context_snapshots(session_id)')
  }

  /** 从数据库恢复所有上下文 */
  private loadFromDatabase(): void {
    try {
      const db = this.getRawDb()

      // 加载所有上下文
      const contexts = db.prepare('SELECT * FROM working_contexts').all() as any[]
      for (const row of contexts) {
        const sessionId = row.session_id
        const ctx: WorkingContext = {
          sessionId,
          currentTask: row.current_task || '',
          problems: [],
          decisions: [],
          todos: [],
          codeSnippets: [],
          autoExtractedPoints: JSON.parse(row.auto_extracted_points || '[]'),
          updatedAt: row.updated_at,
          snapshots: [],
        }

        // 加载条目
        const items = db.prepare('SELECT * FROM working_context_items WHERE session_id = ? ORDER BY created_at').all(sessionId) as any[]
        for (const item of items) {
          const baseItem: ContextItem = {
            id: item.id,
            content: item.content,
            createdAt: item.created_at,
            isPinned: item.is_pinned === 1,
            resolved: item.resolved === 1,
            resolvedAt: item.resolved_at || undefined,
          }

          switch (item.category) {
            case 'problem':
              ctx.problems.push(baseItem)
              break
            case 'decision':
              ctx.decisions.push(baseItem)
              break
            case 'todo':
              ctx.todos.push(baseItem)
              break
            case 'codeSnippet':
              ctx.codeSnippets.push({
                id: item.id,
                filePath: item.file_path || '',
                lineRange: item.line_range || undefined,
                content: item.content,
                note: item.note || undefined,
                createdAt: item.created_at,
                isPinned: item.is_pinned === 1,
              })
              break
          }
        }

        // 加载快照
        const snapshots = db.prepare('SELECT * FROM working_context_snapshots WHERE session_id = ? ORDER BY timestamp').all(sessionId) as any[]
        for (const snap of snapshots) {
          ctx.snapshots.push({
            id: snap.id,
            timestamp: snap.timestamp,
            trigger: snap.trigger_type as ContextSnapshot['trigger'],
            summary: snap.summary,
            items: JSON.parse(snap.items_json || '{}'),
          })
        }

        this.contexts.set(sessionId, ctx)
      }

      console.log(`[WorkingContext] 从数据库恢复了 ${contexts.length} 个工作上下文`)
    } catch (err) {
      console.error('[WorkingContext] 加载数据失败:', err)
    }
  }

  /** 持久化上下文元数据到 DB */
  private persistContext(ctx: WorkingContext): void {
    try {
      const db = this.getRawDb()
      db.prepare(`
        INSERT OR REPLACE INTO working_contexts (session_id, current_task, auto_extracted_points, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(ctx.sessionId, ctx.currentTask, JSON.stringify(ctx.autoExtractedPoints), ctx.updatedAt)
    } catch (err) {
      console.error('[WorkingContext] 持久化上下文失败:', err)
    }
  }

  /** 持久化单个条目到 DB */
  private persistItem(sessionId: string, category: string, item: ContextItem | CodeSnippet): void {
    try {
      const db = this.getRawDb()
      if (category === 'codeSnippet') {
        const snippet = item as CodeSnippet
        db.prepare(`
          INSERT OR REPLACE INTO working_context_items (id, session_id, category, content, file_path, line_range, note, is_pinned, resolved, resolved_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
        `).run(snippet.id, sessionId, category, snippet.content, snippet.filePath, snippet.lineRange || null, snippet.note || null, snippet.isPinned ? 1 : 0, snippet.createdAt)
      } else {
        const ctxItem = item as ContextItem
        db.prepare(`
          INSERT OR REPLACE INTO working_context_items (id, session_id, category, content, is_pinned, resolved, resolved_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(ctxItem.id, sessionId, category, ctxItem.content, ctxItem.isPinned ? 1 : 0, ctxItem.resolved ? 1 : 0, ctxItem.resolvedAt || null, ctxItem.createdAt)
      }
    } catch (err) {
      console.error('[WorkingContext] 持久化条目失败:', err)
    }
  }

  /** 更新条目置顶状态 */
  private persistItemPinned(sessionId: string, itemId: string, pinned: boolean): void {
    try {
      const db = this.getRawDb()
      db.prepare(`
        UPDATE working_context_items SET is_pinned = ? WHERE session_id = ? AND id = ?
      `).run(pinned ? 1 : 0, sessionId, itemId)
    } catch (err) {
      console.error('[WorkingContext] 更新条目置顶状态失败:', err)
    }
  }

  /** 更新条目解决状态 */
  private persistItemResolved(sessionId: string, itemId: string, resolved: boolean, resolvedAt: string | undefined): void {
    try {
      const db = this.getRawDb()
      db.prepare(`
        UPDATE working_context_items SET resolved = ?, resolved_at = ? WHERE id = ?
      `).run(resolved ? 1 : 0, resolvedAt || null, itemId)
    } catch (err) {
      console.error('[WorkingContext] 更新条目状态失败:', err)
    }
  }

  /** 从 DB 删除条目 */
  private deleteItemFromDb(itemId: string): void {
    try {
      const db = this.getRawDb()
      db.prepare('DELETE FROM working_context_items WHERE id = ?').run(itemId)
    } catch (err) {
      console.error('[WorkingContext] 删除条目失败:', err)
    }
  }

  /** 持久化快照 */
  private persistSnapshot(sessionId: string, snapshot: ContextSnapshot): void {
    try {
      const db = this.getRawDb()
      db.prepare(`
        INSERT OR REPLACE INTO working_context_snapshots (id, session_id, trigger_type, summary, items_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(snapshot.id, sessionId, snapshot.trigger, snapshot.summary, JSON.stringify(snapshot.items), snapshot.timestamp)
    } catch (err) {
      console.error('[WorkingContext] 持久化快照失败:', err)
    }
  }

  /** 从 DB 删除上下文 */
  private deleteContextFromDb(sessionId: string): void {
    try {
      const db = this.getRawDb()
      db.prepare('DELETE FROM working_context_snapshots WHERE session_id = ?').run(sessionId)
      db.prepare('DELETE FROM working_context_items WHERE session_id = ?').run(sessionId)
      db.prepare('DELETE FROM working_contexts WHERE session_id = ?').run(sessionId)
    } catch (err) {
      console.error('[WorkingContext] 删除上下文失败:', err)
    }
  }

  // ── CRUD ────────────────────────────────────────────────

  /** 获取或创建会话的工作上下文 */
  getOrCreateContext(sessionId: string): WorkingContext {
    if (!this.contexts.has(sessionId)) {
      const ctx: WorkingContext = {
        sessionId,
        currentTask: '',
        problems: [],
        decisions: [],
        todos: [],
        codeSnippets: [],
        autoExtractedPoints: [],
        updatedAt: new Date().toISOString(),
        snapshots: [],
      }
      this.contexts.set(sessionId, ctx)
      this.persistContext(ctx)
    }
    return this.contexts.get(sessionId)!
  }

  /** 获取上下文（不创建） */
  getContext(sessionId: string): WorkingContext | null {
    return this.contexts.get(sessionId) || null
  }

  /** 更新当前任务 */
  updateTask(sessionId: string, task: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.currentTask = task
    ctx.updatedAt = new Date().toISOString()
    this.persistContext(ctx)
    this.emitChange(sessionId, 'task-updated', ctx)
    return ctx
  }

  /** 添加问题 */
  addProblem(sessionId: string, content: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const item: ContextItem = {
      id: `prob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      createdAt: new Date().toISOString(),
    }
    ctx.problems.push(item)
    ctx.updatedAt = new Date().toISOString()
    this.persistContext(ctx)
    this.persistItem(sessionId, 'problem', item)
    this.emitChange(sessionId, 'problem-added', ctx)
    return ctx
  }

  /** 标记问题已解决 */
  resolveProblem(sessionId: string, problemId: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const prob = ctx.problems.find(p => p.id === problemId)
    if (prob) {
      prob.resolved = true
      prob.resolvedAt = new Date().toISOString()
      ctx.updatedAt = new Date().toISOString()
      this.persistContext(ctx)
      this.persistItemResolved(sessionId, problemId, true, prob.resolvedAt)
      this.emitChange(sessionId, 'problem-resolved', ctx)
    }
    return ctx
  }

  /** 添加决策 */
  addDecision(sessionId: string, content: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const item: ContextItem = {
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      createdAt: new Date().toISOString(),
    }
    ctx.decisions.push(item)
    ctx.updatedAt = new Date().toISOString()
    this.persistContext(ctx)
    this.persistItem(sessionId, 'decision', item)
    this.emitChange(sessionId, 'decision-added', ctx)
    return ctx
  }

  /** 添加待办 */
  addTodo(sessionId: string, content: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const item: ContextItem = {
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      createdAt: new Date().toISOString(),
    }
    ctx.todos.push(item)
    ctx.updatedAt = new Date().toISOString()
    this.persistContext(ctx)
    this.persistItem(sessionId, 'todo', item)
    this.emitChange(sessionId, 'todo-added', ctx)
    return ctx
  }

  /** 标记待办完成 */
  resolveTodo(sessionId: string, todoId: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const todo = ctx.todos.find(t => t.id === todoId)
    if (todo) {
      todo.resolved = true
      todo.resolvedAt = new Date().toISOString()
      ctx.updatedAt = new Date().toISOString()
      this.persistContext(ctx)
      this.persistItemResolved(sessionId, todoId, true, todo.resolvedAt)
      this.emitChange(sessionId, 'todo-resolved', ctx)
    }
    return ctx
  }

  /** 添加代码片段 */
  addCodeSnippet(sessionId: string, snippet: Omit<CodeSnippet, 'id' | 'createdAt'>): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const item: CodeSnippet = {
      id: `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...snippet,
      createdAt: new Date().toISOString(),
    }
    ctx.codeSnippets.push(item)
    ctx.updatedAt = new Date().toISOString()
    this.persistContext(ctx)
    this.persistItem(sessionId, 'codeSnippet', item)
    this.emitChange(sessionId, 'snippet-added', ctx)
    return ctx
  }

  /** 删除条目 */
  removeItem(sessionId: string, category: 'problems' | 'decisions' | 'todos' | 'codeSnippets', itemId: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const list = ctx[category] as ContextItem[] | CodeSnippet[]
    const idx = list.findIndex(item => item.id === itemId)
    if (idx >= 0) {
      list.splice(idx, 1)
      ctx.updatedAt = new Date().toISOString()
      this.persistContext(ctx)
      this.deleteItemFromDb(itemId)
      this.emitChange(sessionId, 'item-removed', ctx)
    }
    return ctx
  }

  /** 置顶/取消置顶关键上下文条目 */
  setItemPinned(sessionId: string, category: 'problems' | 'decisions' | 'todos' | 'codeSnippets', itemId: string, pinned: boolean): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const list = ctx[category] as ContextItem[] | CodeSnippet[]
    const item = list.find(entry => entry.id === itemId)
    if (item) {
      item.isPinned = pinned
      ctx.updatedAt = new Date().toISOString()
      this.persistContext(ctx)
      this.persistItemPinned(sessionId, itemId, pinned)
      this.emitChange(sessionId, pinned ? 'item-pinned' : 'item-unpinned', ctx)
    }
    return ctx
  }

  // ── 快照 ────────────────────────────────────────────────

  /** 创建快照 */
  createSnapshot(sessionId: string, trigger: ContextSnapshot['trigger'] = 'manual'): ContextSnapshot | null {
    const ctx = this.contexts.get(sessionId)
    if (!ctx) return null

    const snapshot: ContextSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      trigger,
      summary: ctx.currentTask || '未命名任务',
      items: {
        task: ctx.currentTask,
        problemCount: ctx.problems.length,
        decisionCount: ctx.decisions.length,
        todoCount: ctx.todos.length,
        unresolvedProblems: ctx.problems.filter(p => !p.resolved).length,
      },
    }

    ctx.snapshots.push(snapshot)
    ctx.updatedAt = new Date().toISOString()
    this.persistContext(ctx)
    this.persistSnapshot(sessionId, snapshot)
    this.emitChange(sessionId, 'snapshot-created', ctx)
    return snapshot
  }

  /** 会话切换时自动快照（从旧会话切出） */
  onSessionSwitchOut(fromSessionId: string): ContextSnapshot | null {
    const ctx = this.contexts.get(fromSessionId)
    if (!ctx || !ctx.currentTask) return null
    return this.createSnapshot(fromSessionId, 'session-switch')
  }

  /** 生成上下文摘要文本（注入给 AI 作为隐藏上下文） */
  generateContextPrompt(sessionId: string): string {
    const ctx = this.contexts.get(sessionId)
    if (!ctx) return ''

    const parts: string[] = []

    const pinnedLines = [
      ...ctx.problems.filter(item => item.isPinned && !item.resolved).map(item => `- [问题] ${item.content}`),
      ...ctx.decisions.filter(item => item.isPinned).map(item => `- [决策] ${item.content}`),
      ...ctx.todos.filter(item => item.isPinned && !item.resolved).map(item => `- [待办] ${item.content}`),
      ...ctx.codeSnippets.filter(item => item.isPinned).map(item => {
        const location = [item.filePath, item.lineRange].filter(Boolean).join(':')
        const content = item.content.length > 800 ? `${item.content.slice(0, 800)}...` : item.content
        return `- [代码片段] ${location}${item.note ? `（${item.note}）` : ''}\n${content}`
      }),
    ]

    if (pinnedLines.length > 0) {
      parts.push(`置顶关键上下文:\n${pinnedLines.join('\n')}`)
    }

    if (ctx.currentTask) {
      parts.push(`当前任务: ${ctx.currentTask}`)
    }

    const unresolvedProblems = ctx.problems.filter(p => !p.resolved && !p.isPinned)
    if (unresolvedProblems.length > 0) {
      parts.push(`未解决的问题:\n${unresolvedProblems.map(p => `- ${p.content}`).join('\n')}`)
    }

    const regularDecisions = ctx.decisions.filter(d => !d.isPinned)
    if (regularDecisions.length > 0) {
      parts.push(`已做决策:\n${regularDecisions.map(d => `- ${d.content}`).join('\n')}`)
    }

    const unresolvedTodos = ctx.todos.filter(t => !t.resolved && !t.isPinned)
    if (unresolvedTodos.length > 0) {
      parts.push(`待办事项:\n${unresolvedTodos.map(t => `- ${t.content}`).join('\n')}`)
    }

    if (ctx.autoExtractedPoints.length > 0) {
      parts.push(`自动提取的关键点:\n${ctx.autoExtractedPoints.map(p => `- ${p}`).join('\n')}`)
    }

    return parts.length > 0
      ? `[工作上下文记忆]\n${parts.join('\n\n')}\n[/工作上下文记忆]`
      : ''
  }

  /** AI 自动从对话中提取关键点（由外部调用） */
  setAutoExtractedPoints(sessionId: string, points: string[]): void {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.autoExtractedPoints = points
    ctx.updatedAt = new Date().toISOString()
    this.persistContext(ctx)
    this.emitChange(sessionId, 'auto-extracted', ctx)
  }

  // ── 清理 ────────────────────────────────────────────────

  /** 清理会话的工作上下文 */
  removeContext(sessionId: string): boolean {
    const deleted = this.contexts.delete(sessionId)
    if (deleted) {
      this.deleteContextFromDb(sessionId)
      this.emitChange(sessionId, 'context-removed', null)
    }
    return deleted
  }

  /** 获取所有活跃上下文的会话 ID */
  getActiveSessionIds(): string[] {
    return [...this.contexts.keys()]
  }

  // ── 生命周期 ────────────────────────────────────────────

  /** 启动自动提取定时器 */
  startAutoExtract(intervalMs = 300000): void {
    if (this.autoExtractInterval) return
    this.autoExtractInterval = setInterval(() => {
      this.emit('auto-extract-tick', [...this.contexts.keys()])
    }, intervalMs)
  }

  /** 停止自动提取 */
  stopAutoExtract(): void {
    if (this.autoExtractInterval) {
      clearInterval(this.autoExtractInterval)
      this.autoExtractInterval = null
    }
  }

  /** 清理所有上下文（仅内存，不删DB） */
  cleanup(): void {
    this.stopAutoExtract()
    this.contexts.clear()
    this.removeAllListeners()
  }

  // ── Private ─────────────────────────────────────────────

  private emitChange(sessionId: string, eventType: string, context: WorkingContext | null): void {
    this.emit('context-changed', { sessionId, eventType, context })
    try {
      sendToRenderer(IPC.WORKING_CONTEXT_STATUS, { type: eventType, sessionId, context })
    } catch { /* ignore */ }
  }
}
