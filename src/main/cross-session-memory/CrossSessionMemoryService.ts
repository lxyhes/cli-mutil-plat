/**
 * CrossSessionMemoryService - 跨会话语义记忆
 *
 * 对话摘要自动入库时生成关键词索引（轻量方案，无需向量数据库）
 * 新建会话时自动检索相关历史记忆，作为隐藏上下文注入
 * 用户可搜索"之前处理 X 问题是怎么做的"
 *
 * 设计决策：Phase 1 用 SQLite FTS（全文搜索）替代向量数据库，
 * 避免引入 faiss-wasm 等重量级依赖，同时保持未来可升级
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { DatabaseManager } from '../storage/Database'
import type { SummaryService } from '../summary/SummaryService'

// ─── 类型定义 ─────────────────────────────────────────────

export interface MemoryEntry {
  /** 唯一 ID */
  id: string
  /** 来源会话 ID */
  sessionId: string
  /** 会话名称 */
  sessionName: string
  /** 摘要内容 */
  summary: string
  /** 关键点 */
  keyPoints: string
  /** 提取的关键词（逗号分隔） */
  keywords: string
  /** 创建时间 */
  createdAt: string
  /** 相关性评分（搜索时填充） */
  relevanceScore?: number
}

export interface MemorySearchResult {
  /** 搜索关键词 */
  query: string
  /** 匹配的记忆条目 */
  entries: MemoryEntry[]
  /** 搜索时间 */
  searchedAt: string
}

export interface CrossSessionConfig {
  /** 自动索引新摘要（默认 true） */
  autoIndex: boolean
  /** 搜索返回最大条数（默认 5） */
  maxSearchResults: number
  /** 新会话自动注入相关记忆（默认 true） */
  autoInjectOnNewSession: boolean
  /** 注入的最大记忆条数（默认 3） */
  maxInjectEntries: number
}

const DEFAULT_CONFIG: CrossSessionConfig = {
  autoIndex: true,
  maxSearchResults: 5,
  autoInjectOnNewSession: true,
  maxInjectEntries: 3,
}

// ─── 服务 ─────────────────────────────────────────────────

export class CrossSessionMemoryService extends EventEmitter {
  private db: DatabaseManager
  private summaryService: SummaryService | null = null
  private config: CrossSessionConfig
  private sqliteDb: any = null

  constructor(db: DatabaseManager, config?: Partial<CrossSessionConfig>) {
    super()
    this.db = db
    this.config = { ...DEFAULT_CONFIG, ...config }
    // 获取底层 SQLite 实例
    this.sqliteDb = (db as any).db || null
    this.ensureSchema()
  }

  /** 注入 SummaryService */
  setSummaryService(summaryService: SummaryService): void {
    this.summaryService = summaryService
  }

  // ── 索引 ────────────────────────────────────────────────

  /** 确保数据库表和 FTS 索引存在 */
  private ensureSchema(): void {
    if (!this.sqliteDb) return
    try {
      // 创建记忆索引表
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS cross_session_memory (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          session_name TEXT DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          key_points TEXT DEFAULT '',
          keywords TEXT DEFAULT '',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)

      // 创建 FTS5 虚拟表（全文搜索）
      const ftsExists = this.sqliteDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='cross_session_memory_fts'"
      ).get()
      if (!ftsExists) {
        this.sqliteDb.exec(`
          CREATE VIRTUAL TABLE cross_session_memory_fts USING fts5(
            summary,
            key_points,
            keywords,
            content='cross_session_memory',
            content_rowid='rowid'
          )
        `)
        // 同步触发器：插入
        this.sqliteDb.exec(`
          CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON cross_session_memory BEGIN
            INSERT INTO cross_session_memory_fts(rowid, summary, key_points, keywords)
            VALUES (new.rowid, new.summary, new.key_points, new.keywords);
          END
        `)
        // 同步触发器：删除
        this.sqliteDb.exec(`
          CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON cross_session_memory BEGIN
            INSERT INTO cross_session_memory_fts(cross_session_memory_fts, rowid, summary, key_points, keywords)
            VALUES ('delete', old.rowid, old.summary, old.key_points, old.keywords);
          END
        `)
        // 同步触发器：更新
        this.sqliteDb.exec(`
          CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON cross_session_memory BEGIN
            INSERT INTO cross_session_memory_fts(cross_session_memory_fts, rowid, summary, key_points, keywords)
            VALUES ('delete', old.rowid, old.summary, old.key_points, old.keywords);
            INSERT INTO cross_session_memory_fts(rowid, summary, key_points, keywords)
            VALUES (new.rowid, new.summary, new.key_points, new.keywords);
          END
        `)
      }

      // 索引
      this.sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_csm_session_id ON cross_session_memory(session_id)
      `)
    } catch (err) {
      console.warn('[CrossSessionMemory] Schema creation failed:', err)
    }
  }

  /** 从摘要自动索引 */
  indexSummary(sessionId: string, sessionName: string, summary: string, keyPoints: string): MemoryEntry | null {
    if (!this.sqliteDb || !this.config.autoIndex) return null

    const keywords = this.extractKeywords(`${summary} ${keyPoints}`).join(', ')
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      // 检查是否已索引（同一会话同一摘要内容跳过）
      const existing = this.sqliteDb.prepare(
        'SELECT id FROM cross_session_memory WHERE session_id = ? AND summary = ?'
      ).get(sessionId, summary)
      if (existing) return null

      this.sqliteDb.prepare(`
        INSERT INTO cross_session_memory (id, session_id, session_name, summary, key_points, keywords, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, sessionId, sessionName, summary, keyPoints, keywords, new Date().toISOString())

      const entry: MemoryEntry = {
        id, sessionId, sessionName, summary, keyPoints, keywords,
        createdAt: new Date().toISOString(),
      }

      this.emit('memory-indexed', entry)
      return entry
    } catch (err) {
      console.warn('[CrossSessionMemory] Index failed:', err)
      return null
    }
  }

  // ── 搜索 ────────────────────────────────────────────────

  /** 全文搜索 */
  search(query: string, limit?: number): MemorySearchResult {
    const maxResults = limit || this.config.maxSearchResults
    const entries: MemoryEntry[] = []

    if (!this.sqliteDb) {
      return { query, entries, searchedAt: new Date().toISOString() }
    }

    try {
      // 使用 FTS5 搜索
      const ftsQuery = query.replace(/"/g, '""')  // escape double quotes
      const rows = this.sqliteDb.prepare(`
        SELECT m.*, fts.rank as relevance_score
        FROM cross_session_memory_fts fts
        JOIN cross_session_memory m ON fts.rowid = m.rowid
        WHERE cross_session_memory_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(`"${ftsQuery}"`, maxResults) as any[]

      for (const row of rows) {
        entries.push({
          id: row.id,
          sessionId: row.session_id,
          sessionName: row.session_name,
          summary: row.summary,
          keyPoints: row.key_points,
          keywords: row.keywords,
          createdAt: row.created_at,
          relevanceScore: row.relevance_score,
        })
      }
    } catch (err) {
      // FTS5 可能不支持某些查询，降级为 LIKE
      try {
        const likePattern = `%${query}%`
        const rows = this.sqliteDb.prepare(`
          SELECT * FROM cross_session_memory
          WHERE summary LIKE ? OR key_points LIKE ? OR keywords LIKE ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(likePattern, likePattern, likePattern, maxResults) as any[]

        for (const row of rows) {
          entries.push({
            id: row.id,
            sessionId: row.session_id,
            sessionName: row.session_name,
            summary: row.summary,
            keyPoints: row.key_points,
            keywords: row.keywords,
            createdAt: row.created_at,
          })
        }
      } catch (likeErr) {
        console.warn('[CrossSessionMemory] Search fallback failed:', likeErr)
      }
    }

    return { query, entries, searchedAt: new Date().toISOString() }
  }

  /** 为新会话生成相关记忆注入文本 */
  generateInjectionPrompt(sessionGoal: string): string {
    if (!this.config.autoInjectOnNewSession || !sessionGoal) return ''

    const result = this.search(sessionGoal, this.config.maxInjectEntries)
    if (result.entries.length === 0) return ''

    const memoryLines = result.entries.map((entry, i) => {
      const parts = [`[${i + 1}] 会话「${entry.sessionName || entry.sessionId}」`]
      if (entry.summary) parts.push(`摘要: ${entry.summary.slice(0, 200)}`)
      if (entry.keyPoints) parts.push(`关键点: ${entry.keyPoints.slice(0, 150)}`)
      return parts.join('\n    ')
    })

    return [
      `[跨会话相关记忆]`,
      `以下历史会话与当前目标可能相关，供参考：`,
      memoryLines.join('\n\n'),
      `[/跨会话相关记忆]`,
    ].join('\n')
  }

  // ── 管理 ────────────────────────────────────────────────

  /** 获取所有记忆条目 */
  listAll(limit = 50): MemoryEntry[] {
    if (!this.sqliteDb) return []
    try {
      const rows = this.sqliteDb.prepare(
        'SELECT * FROM cross_session_memory ORDER BY created_at DESC LIMIT ?'
      ).all(limit) as any[]

      return rows.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        sessionName: row.session_name,
        summary: row.summary,
        keyPoints: row.key_points,
        keywords: row.keywords,
        createdAt: row.created_at,
      }))
    } catch {
      return []
    }
  }

  /** 删除记忆条目 */
  deleteEntry(id: string): boolean {
    if (!this.sqliteDb) return false
    try {
      const result = this.sqliteDb.prepare('DELETE FROM cross_session_memory WHERE id = ?').run(id)
      return result.changes > 0
    } catch {
      return false
    }
  }

  /** 清理指定会话的记忆 */
  deleteBySession(sessionId: string): number {
    if (!this.sqliteDb) return 0
    try {
      const result = this.sqliteDb.prepare('DELETE FROM cross_session_memory WHERE session_id = ?').run(sessionId)
      return result.changes
    } catch {
      return 0
    }
  }

  /** 更新配置 */
  updateConfig(updates: Partial<CrossSessionConfig>): void {
    Object.assign(this.config, updates)
  }

  /** 获取配置 */
  getConfig(): CrossSessionConfig {
    return { ...this.config }
  }

  /** 获取统计信息 */
  getStats(): { totalEntries: number; uniqueSessions: number } {
    if (!this.sqliteDb) return { totalEntries: 0, uniqueSessions: 0 }
    try {
      const stats = this.sqliteDb.prepare(`
        SELECT COUNT(*) as total, COUNT(DISTINCT session_id) as sessions FROM cross_session_memory
      `).get() as any
      return { totalEntries: stats.total || 0, uniqueSessions: stats.sessions || 0 }
    } catch {
      return { totalEntries: 0, uniqueSessions: 0 }
    }
  }

  /** 清理所有资源 */
  cleanup(): void {
    this.removeAllListeners()
  }

  // ── Private ─────────────────────────────────────────────

  /** 提取关键词（简易中英文混合） */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = []
    const seen = new Set<string>()

    // 英文关键词（3+ 字符）
    const englishWords = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
      'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'this',
      'that', 'with', 'from', 'they', 'been', 'said', 'each', 'which',
      'their', 'will', 'other', 'about', 'many', 'then', 'them',
    ])
    for (const w of englishWords) {
      if (!stopWords.has(w) && !seen.has(w)) {
        seen.add(w)
        keywords.push(w)
      }
    }

    // 中文关键词（2字组合）
    const chineseSegments = text.match(/[\u4e00-\u9fff]+/g) || []
    const cnStopWords = new Set(['的', '了', '是', '在', '和', '有', '不', '这', '我', '你', '个', '上', '也', '到', '说', '要'])
    for (const segment of chineseSegments) {
      for (let i = 0; i < segment.length - 1; i++) {
        const bigram = segment.slice(i, i + 2)
        if (!cnStopWords.has(bigram) && !seen.has(bigram)) {
          seen.add(bigram)
          keywords.push(bigram)
        }
      }
    }

    return keywords.slice(0, 20)  // 限制关键词数量
  }
}
