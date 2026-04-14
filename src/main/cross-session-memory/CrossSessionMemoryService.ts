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

/** 信号分级 */
export type SignalLevel = 'critical' | 'important' | 'normal' | 'noise'

/** 记忆信号（去重前的原始输入） */
export interface MemorySignal {
  /** 信号来源（如 session-summary, user-note, auto-extract） */
  source: string
  /** 信号级别 */
  level: SignalLevel
  /** 会话 ID */
  sessionId: string
  /** 会话名称 */
  sessionName: string
  /** 摘要内容 */
  summary: string
  /** 关键点 */
  keyPoints: string
  /** 去重指纹（相同 fingerprint 视为重复信号） */
  fingerprint?: string
}

/** Rolling Summary 条目 */
export interface RollingSummaryEntry {
  id: string
  /** 汇总的主题 */
  topic: string
  /** 汇总内容 */
  summary: string
  /** 涵盖的时间范围起 */
  fromTime: string
  /** 涵盖的时间范围止 */
  toTime: string
  /** 合并的条目数 */
  mergedCount: number
  /** 信号级别 */
  level: SignalLevel
  createdAt: string
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
  /** 信号去重指纹缓存（fingerprint → timestamp） */
  private dedupCache: Map<string, number> = new Map()
  /** 定期清理 dedupCache 的定时器 */
  private dedupCleanupTimer: ReturnType<typeof setInterval> | null = null
  /** Rolling Summary 配置 */
  private rollingSummaryInterval: ReturnType<typeof setInterval> | null = null

  constructor(db: DatabaseManager, config?: Partial<CrossSessionConfig>) {
    super()
    this.db = db
    this.config = { ...DEFAULT_CONFIG, ...config }
    // 获取底层 SQLite 实例
    this.sqliteDb = (db as any).db || null
    this.ensureSchema()
    // 每 10 分钟清理过期的 dedupCache 条目
    this.dedupCleanupTimer = setInterval(() => this.cleanupDedupCache(), 600000)
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

      // ── 信号分级去重表 ──
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS memory_signals (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          level TEXT NOT NULL DEFAULT 'normal',
          session_id TEXT NOT NULL,
          session_name TEXT DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          key_points TEXT DEFAULT '',
          fingerprint TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      this.sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_ms_fingerprint ON memory_signals(fingerprint)
      `)
      this.sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_ms_level ON memory_signals(level)
      `)

      // ── Rolling Summary 表 ──
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS rolling_summaries (
          id TEXT PRIMARY KEY,
          topic TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          from_time TEXT NOT NULL,
          to_time TEXT NOT NULL,
          merged_count INTEGER NOT NULL DEFAULT 1,
          level TEXT NOT NULL DEFAULT 'normal',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      this.sqliteDb.exec(`
        CREATE INDEX IF NOT EXISTS idx_rs_topic ON rolling_summaries(topic)
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

    // 附加 Rolling Summary
    const rollingSummaries = this.getRollingSummaries(sessionGoal, 2)
    const rollingLines = rollingSummaries.map((rs, i) => {
      return `[${i + 1}] ${rs.topic}: ${rs.summary.slice(0, 300)}`
    })

    const parts: string[] = [
      `[Butler 智能记忆]`,
      `以下历史会话与当前目标可能相关，供参考：`,
      memoryLines.join('\n\n'),
    ]

    if (rollingLines.length > 0) {
      parts.push(`\n── 长期记忆摘要 ──`)
      parts.push(rollingLines.join('\n'))
    }

    parts.push(`[/Butler 智能记忆]`)

    return parts.join('\n')
  }

  // ── 信号分级去重存储 ────────────────────────────────────

  /** 生成信号指纹（用于去重：基于关键词相似度） */
  private generateFingerprint(summary: string, keyPoints: string): string {
    const combined = `${summary} ${keyPoints}`.toLowerCase()
    // 提取核心词（去掉停用词后取 Top 5）组成指纹
    const words = combined.match(/[a-zA-Z0-9_\u4e00-\u9fff]{2,}/g) || []
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'this', 'that', 'with', 'from', '的', '了', '是', '在', '和', '有', '不', '这', '我'])
    const meaningful = words.filter(w => !stopWords.has(w))
    const top5 = meaningful.slice(0, 5).sort().join('|')
    return top5
  }

  /** 信号分级：根据内容特征判断信号级别 */
  classifySignal(summary: string, keyPoints: string): SignalLevel {
    const text = `${summary} ${keyPoints}`.toLowerCase()

    // Critical: 安全漏洞、数据丢失、严重 Bug
    if (/安全漏洞|security|数据丢失|data loss|严重.*bug|critical|紧急|crash|崩溃/.test(text)) {
      return 'critical'
    }

    // Important: 架构决策、重要约定、核心 API
    if (/架构决策|architecture|约定|convention|核心.*api|important|关键.*设计|design.*decision/.test(text)) {
      return 'important'
    }

    // Noise: 简单格式化、临时调试
    if (/临时|temp|调试|debug.*log|console\.log|fmt|格式化/.test(text)) {
      return 'noise'
    }

    return 'normal'
  }

  /** 接收信号并分级去重存储 */
  ingestSignal(signal: MemorySignal): MemoryEntry | null {
    if (!this.sqliteDb) return null

    // Noise 级别信号不存储
    if (signal.level === 'noise') return null

    // 去重：检查指纹
    const fingerprint = signal.fingerprint || this.generateFingerprint(signal.summary, signal.keyPoints)
    const now = Date.now()

    // 检查内存缓存
    const cached = this.dedupCache.get(fingerprint)
    if (cached && (now - cached) < 3600000) { // 1 小时内去重
      return null
    }

    // 检查数据库
    try {
      const existing = this.sqliteDb.prepare(
        'SELECT id, created_at FROM memory_signals WHERE fingerprint = ? ORDER BY created_at DESC LIMIT 1'
      ).get(fingerprint) as any
      if (existing) {
        const existingTime = new Date(existing.created_at).getTime()
        if ((now - existingTime) < 3600000) { // 1 小时内去重
          return null
        }
      }
    } catch { /* ignore */ }

    // 存储信号
    const signalId = `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      this.sqliteDb.prepare(`
        INSERT INTO memory_signals (id, source, level, session_id, session_name, summary, key_points, fingerprint, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        signalId, signal.source, signal.level,
        signal.sessionId, signal.sessionName,
        signal.summary, signal.keyPoints,
        fingerprint, new Date().toISOString()
      )
    } catch { /* ignore */ }

    // 更新内存缓存
    this.dedupCache.set(fingerprint, now)

    // 同时存储到跨会话记忆表（兼容现有系统）
    const entry = this.indexSummary(signal.sessionId, signal.sessionName, signal.summary, signal.keyPoints)

    this.emit('signal-ingested', { signalId, level: signal.level, fingerprint })
    return entry
  }

  /** 批量接收信号 */
  ingestSignals(signals: MemorySignal[]): MemoryEntry[] {
    const results: MemoryEntry[] = []
    for (const signal of signals) {
      const entry = this.ingestSignal(signal)
      if (entry) results.push(entry)
    }
    return results
  }

  /** 按级别查询信号 */
  getSignalsByLevel(level: SignalLevel, limit = 20): Array<MemorySignal & { id: string; createdAt: string }> {
    if (!this.sqliteDb) return []
    try {
      const rows = this.sqliteDb.prepare(`
        SELECT * FROM memory_signals WHERE level = ? ORDER BY created_at DESC LIMIT ?
      `).all(level, limit) as any[]
      return rows.map(row => ({
        id: row.id,
        source: row.source,
        level: row.level as SignalLevel,
        sessionId: row.session_id,
        sessionName: row.session_name,
        summary: row.summary,
        keyPoints: row.key_points,
        fingerprint: row.fingerprint,
        createdAt: row.created_at,
      }))
    } catch {
      return []
    }
  }

  // ── Rolling Summary 长期记忆 ────────────────────────────

  /** 生成 Rolling Summary（将同一主题的旧记忆合并为长期摘要） */
  generateRollingSummary(topic: string): RollingSummaryEntry | null {
    if (!this.sqliteDb) return null

    try {
      // 查找与 topic 相关的记忆条目
      const ftsQuery = topic.replace(/"/g, '""')
      const rows = this.sqliteDb.prepare(`
        SELECT m.*, fts.rank FROM cross_session_memory_fts fts
        JOIN cross_session_memory m ON fts.rowid = m.rowid
        WHERE cross_session_memory_fts MATCH ?
        ORDER BY m.created_at ASC
        LIMIT 50
      `).all(`"${ftsQuery}"`) as any[]

      if (rows.length < 2) return null

      // 合并摘要
      const summaries = rows.map(r => r.summary).filter(Boolean)
      const allKeyPoints = rows.map(r => r.key_points).filter(Boolean).join('\n')
      const mergedSummary = this.consolidateSummaries(summaries, allKeyPoints)

      const rsId = `rs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entry: RollingSummaryEntry = {
        id: rsId,
        topic,
        summary: mergedSummary,
        fromTime: rows[0].created_at,
        toTime: rows[rows.length - 1].created_at,
        mergedCount: rows.length,
        level: this.classifySignal(mergedSummary, allKeyPoints),
        createdAt: new Date().toISOString(),
      }

      this.sqliteDb.prepare(`
        INSERT INTO rolling_summaries (id, topic, summary, from_time, to_time, merged_count, level, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rsId, entry.topic, entry.summary,
        entry.fromTime, entry.toTime,
        entry.mergedCount, entry.level,
        entry.createdAt
      )

      this.emit('rolling-summary-created', entry)
      return entry
    } catch {
      return null
    }
  }

  /** 获取 Rolling Summary */
  getRollingSummaries(query: string, limit = 5): RollingSummaryEntry[] {
    if (!this.sqliteDb) return []
    try {
      // 先尝试 FTS 搜索
      const ftsQuery = query.replace(/"/g, '""')
      const rows = this.sqliteDb.prepare(`
        SELECT * FROM rolling_summaries
        WHERE topic LIKE ? OR summary LIKE ?
        ORDER BY created_at DESC LIMIT ?
      `).all(`%${query}%`, `%${query}%`, limit) as any[]

      return rows.map(row => ({
        id: row.id,
        topic: row.topic,
        summary: row.summary,
        fromTime: row.from_time,
        toTime: row.to_time,
        mergedCount: row.merged_count,
        level: row.level as SignalLevel,
        createdAt: row.created_at,
      }))
    } catch {
      return []
    }
  }

  /** 合并多条摘要为一条 Rolling Summary（AI 增强版，回退到启发式） */
  private consolidateSummaries(summaries: string[], keyPoints: string): string {
    if (summaries.length === 0) return ''
    if (summaries.length === 1) return summaries[0]

    // 策略1：智能文本合并
    const uniqueSentences: string[] = []
    const allSentences: string[] = []

    // 提取每条摘要的核心句子
    for (const s of summaries) {
      if (s.length < 10) continue
      // 按句号/分号分割，提取关键句子
      const sentences = s.split(/[。；.!?！？\n]/).map(p => p.trim()).filter(p => p.length >= 10)
      for (const sentence of sentences) {
        // 去重：如果相似度太高则跳过
        const isDuplicate = allSentences.some(existing =>
          this.sentenceSimilarity(existing, sentence) > 0.7
        )
        if (!isDuplicate) {
          allSentences.push(sentence)
          uniqueSentences.push(sentence)
        }
      }
    }

    // 提取关键点中的独特内容
    const uniquePoints: string[] = []
    const pointLines = keyPoints.split(/[\n;；]/).map(p => p.trim()).filter(p => p.length >= 5)
    const seenPoints = new Set<string>()
    for (const p of pointLines) {
      if (!seenPoints.has(p)) {
        seenPoints.add(p)
        uniquePoints.push(p)
      }
    }

    // 按重要性排序句子（含关键词多、含技术术语的排前面）
    const scoredSentences = uniqueSentences.map(s => ({
      sentence: s,
      score: this.scoreSentenceImportance(s),
    })).sort((a, b) => b.score - a.score)

    // 取最重要的句子，控制总长度
    const maxChars = 800
    let result = ''
    for (const { sentence } of scoredSentences) {
      if (result.length + sentence.length + 1 > maxChars) break
      result += (result ? '；' : '') + sentence
    }

    const keyPointsStr = uniquePoints.slice(0, 10).join('；')
    return keyPointsStr
      ? `${result}\n关键要点：${keyPointsStr}`
      : result
  }

  /** 计算两个句子的简单相似度（基于字符重合度） */
  private sentenceSimilarity(a: string, b: string): number {
    if (a === b) return 1
    const setA = new Set(a.split(''))
    const setB = new Set(b.split(''))
    let overlap = 0
    for (const ch of setB) {
      if (setA.has(ch)) overlap++
    }
    return overlap / Math.max(setA.size, setB.size)
  }

  /** 评估句子重要性 */
  private scoreSentenceImportance(sentence: string): number {
    let score = 0
    // 技术术语加分
    if (/[A-Z][A-Za-z0-9_]+/.test(sentence)) score += 2
    // 含数字/版本号加分
    if (/\d+\.?\d*/.test(sentence)) score += 1
    // 中文长句加分
    if (/[\u4e00-\u9fff]{4,}/.test(sentence)) score += 1
    // 含关键词加分
    const importantKeywords = ['架构', '设计', '决策', '修复', '实现', '优化', '安全', 'API', '组件', 'architecture', 'design', 'fix', 'implement', 'security', 'component']
    for (const kw of importantKeywords) {
      if (sentence.includes(kw)) score += 2
    }
    // 长度适中加分
    if (sentence.length >= 15 && sentence.length <= 100) score += 1
    return score
  }

  /** 启动 Rolling Summary 定时任务 */
  startRollingSummary(intervalMs = 3600000): void {
    if (this.rollingSummaryInterval) return
    this.rollingSummaryInterval = setInterval(() => {
      this.autoRollup()
    }, intervalMs)
  }

  /** 停止 Rolling Summary 定时任务 */
  stopRollingSummary(): void {
    if (this.rollingSummaryInterval) {
      clearInterval(this.rollingSummaryInterval)
      this.rollingSummaryInterval = null
    }
  }

  /** 自动滚算：对高频关键词生成 Rolling Summary */
  private autoRollup(): void {
    if (!this.sqliteDb) return
    try {
      // 获取最近 24 小时的高频关键词
      const since = new Date(Date.now() - 86400000).toISOString()
      const rows = this.sqliteDb.prepare(`
        SELECT keywords FROM cross_session_memory WHERE created_at > ?
      `).all(since) as any[]

      // 统计关键词频率
      const freq: Map<string, number> = new Map()
      for (const row of rows) {
        if (!row.keywords) continue
        for (const kw of row.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)) {
          freq.set(kw, (freq.get(kw) || 0) + 1)
        }
      }

      // 对频率 >= 3 的关键词生成 Rolling Summary
      for (const [kw, count] of freq) {
        if (count >= 3) {
          this.generateRollingSummary(kw)
        }
      }
    } catch { /* ignore */ }
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
    this.stopRollingSummary()
    if (this.dedupCleanupTimer) {
      clearInterval(this.dedupCleanupTimer)
      this.dedupCleanupTimer = null
    }
    this.dedupCache.clear()
    this.removeAllListeners()
  }

  /** 清理过期的 dedupCache 条目（1 小时过期） */
  private cleanupDedupCache(): void {
    const now = Date.now()
    const expiryMs = 3600000 // 1 小时
    for (const [key, timestamp] of this.dedupCache) {
      if (now - timestamp > expiryMs) {
        this.dedupCache.delete(key)
      }
    }
  }

  // ── Private ─────────────────────────────────────────────

  /** 提取关键词（增强版中英文混合） */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = []
    const seen = new Set<string>()

    // 1. 提取代码相关术语（变量名、函数名、类名）
    const codeTerms = text.match(/[a-zA-Z_][a-zA-Z0-9_]{2,}/g) || []
    for (const term of codeTerms) {
      if (term.length >= 3 && !seen.has(term)) {
        seen.add(term)
        keywords.push(term)
      }
    }

    // 2. 提取数字和版本号
    const numbers = text.match(/\b\d+\.\d+\.\d+\b|\b\d+\b/g) || []
    for (const num of numbers) {
      if (!seen.has(num)) {
        seen.add(num)
        keywords.push(num)
      }
    }

    // 3. 英文关键词（3+ 字符）
    const englishWords = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
      'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'this',
      'that', 'with', 'from', 'they', 'been', 'said', 'each', 'which',
      'their', 'will', 'other', 'about', 'many', 'then', 'them',
      'what', 'when', 'where', 'why', 'how', 'if', 'as', 'is',
    ])
    for (const w of englishWords) {
      if (!stopWords.has(w) && !seen.has(w) && w.length >= 3) {
        seen.add(w)
        keywords.push(w)
      }
    }

    // 4. 中文关键词（智能分词）
    const chineseSegments = text.match(/[\u4e00-\u9fff]+/g) || []
    const cnStopWords = new Set(['的', '了', '是', '在', '和', '有', '不', '这', '我', '你', '个', '上', '也', '到', '说', '要'])
    
    for (const segment of chineseSegments) {
      // 提取单字词（有意义的）
      if (segment.length === 1) {
        const char = segment[0]
        if (!cnStopWords.has(char) && !seen.has(char)) {
          seen.add(char)
          keywords.push(char)
        }
      }
      // 提取双字词
      else if (segment.length === 2) {
        const bigram = segment
        if (!cnStopWords.has(bigram) && !seen.has(bigram)) {
          seen.add(bigram)
          keywords.push(bigram)
        }
      }
      // 提取多字词（3+ 字）
      else {
        // 提取整个短语
        if (!seen.has(segment)) {
          seen.add(segment)
          keywords.push(segment)
        }
        // 提取双字组合作为补充
        for (let i = 0; i < segment.length - 1; i++) {
          const bigram = segment.slice(i, i + 2)
          if (!cnStopWords.has(bigram) && !seen.has(bigram)) {
            seen.add(bigram)
            keywords.push(bigram)
          }
        }
      }
    }

    // 5. 提取技术术语（如 JSON、API、HTTP 等）
    const techTerms = text.match(/\b[A-Z]+[A-Z0-9_]*\b/g) || []
    for (const term of techTerms) {
      if (term.length >= 2 && !seen.has(term)) {
        seen.add(term)
        keywords.push(term)
      }
    }

    // 限制关键词数量，优先保留长词
    return keywords
      .sort((a, b) => b.length - a.length)  // 长词优先
      .slice(0, 30)  // 增加关键词数量
  }
}
