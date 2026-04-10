/**
 * SummaryRepository - 会话摘要相关数据库操作
 */

export type SummaryType = 'auto' | 'manual' | 'key_points'

export interface SessionSummary {
  id?: number
  sessionId: string
  summary: string
  keyPoints?: string
  aiProvider?: string
  aiModel?: string
  inputTokens?: number
  outputTokens?: number
  tokensUsed?: number
  costUsd?: number
  qualityScore?: number
  summaryType: SummaryType
  updatedAt?: string
  createdAt?: string
}

export class SummaryRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  /**
   * 创建会话摘要
   */
  addSummary(data: {
    sessionId: string
    summary: string
    keyPoints?: string
    aiProvider?: string
    aiModel?: string
    inputTokens?: number
    outputTokens?: number
    tokensUsed?: number
    costUsd?: number
    qualityScore?: number
    summaryType?: SummaryType
  }): number | null {
    if (!this.db) return null
    try {
      const result = this.db.prepare(`
        INSERT INTO session_summaries
        (session_id, summary, key_points, ai_provider, ai_model, input_tokens, output_tokens,
         tokens_used, cost_usd, quality_score, summary_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.sessionId,
        data.summary,
        data.keyPoints || null,
        data.aiProvider || null,
        data.aiModel || null,
        data.inputTokens || null,
        data.outputTokens || null,
        data.tokensUsed || null,
        data.costUsd || null,
        data.qualityScore || null,
        data.summaryType || 'auto',
        new Date().toISOString()
      )
      return result.lastInsertRowid ?? null
    } catch (err) {
      console.error('[SummaryRepository] addSummary error:', err)
      return null
    }
  }

  /**
   * 更新会话摘要
   */
  updateSummary(id: number, updates: {
    summary?: string
    keyPoints?: string
    qualityScore?: number
    summaryType?: SummaryType
  }): boolean {
    if (!this.db) return false
    try {
      const sets: string[] = []
      const values: any[] = []
      if (updates.summary !== undefined) { sets.push('summary = ?'); values.push(updates.summary) }
      if (updates.keyPoints !== undefined) { sets.push('key_points = ?'); values.push(updates.keyPoints) }
      if (updates.qualityScore !== undefined) { sets.push('quality_score = ?'); values.push(updates.qualityScore) }
      if (updates.summaryType !== undefined) { sets.push('summary_type = ?'); values.push(updates.summaryType) }
      if (sets.length === 0) return false
      sets.push('updated_at = ?')
      values.push(new Date().toISOString())
      values.push(id)
      const changes = this.db.prepare(`UPDATE session_summaries SET ${sets.join(', ')} WHERE id = ?`).run(...values).changes
      return changes > 0
    } catch (err) {
      console.error('[SummaryRepository] updateSummary error:', err)
      return false
    }
  }

  /**
   * 获取会话的最新摘要
   */
  getLatestSummary(sessionId: string): SessionSummary | null {
    if (!this.db) return null
    try {
      const row = this.db.prepare(`
        SELECT id, session_id, summary, key_points, ai_provider, ai_model,
               input_tokens, output_tokens, tokens_used, cost_usd, quality_score,
               summary_type, updated_at, created_at
        FROM session_summaries
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(sessionId) as any
      if (!row) return null
      return this.mapRow(row)
    } catch (err) {
      console.error('[SummaryRepository] getLatestSummary error:', err)
      return null
    }
  }

  /**
   * 获取单个摘要
   */
  getSummary(id: number): SessionSummary | null {
    if (!this.db) return null
    try {
      const row = this.db.prepare(`
        SELECT id, session_id, summary, key_points, ai_provider, ai_model,
               input_tokens, output_tokens, tokens_used, cost_usd, quality_score,
               summary_type, updated_at, created_at
        FROM session_summaries
        WHERE id = ?
      `).get(id) as any
      if (!row) return null
      return this.mapRow(row)
    } catch (err) {
      console.error('[SummaryRepository] getSummary error:', err)
      return null
    }
  }

  /**
   * 获取会话的所有摘要
   */
  listSummaries(sessionId: string, limit: number = 20): SessionSummary[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare(`
        SELECT id, session_id, summary, key_points, ai_provider, ai_model,
               input_tokens, output_tokens, tokens_used, cost_usd, quality_score,
               summary_type, updated_at, created_at
        FROM session_summaries
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(sessionId, limit) as any[]
      return rows.map((row) => this.mapRow(row))
    } catch (err) {
      console.error('[SummaryRepository] listSummaries error:', err)
      return []
    }
  }

  /**
   * 获取所有会话的最新摘要（跨会话引用）
   */
  listAllLatestSummaries(limit: number = 50): (SessionSummary & { sessionName?: string; sessionStatus?: string })[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare(`
        SELECT ss.id, ss.session_id, ss.summary, ss.key_points, ss.ai_provider, ss.ai_model,
               ss.input_tokens, ss.output_tokens, ss.tokens_used, ss.cost_usd, ss.quality_score,
               ss.summary_type, ss.updated_at, ss.created_at,
               COALESCE(s.name, '') as session_name,
               COALESCE(s.status, '') as session_status
        FROM session_summaries ss
        LEFT JOIN sessions s ON ss.session_id = s.id
        WHERE ss.id IN (
          SELECT MAX(id) FROM session_summaries GROUP BY session_id
        )
        ORDER BY ss.created_at DESC
        LIMIT ?
      `).all(limit) as any[]
      return rows.map((row) => ({
        ...this.mapRow(row),
        sessionName: row.session_name,
        sessionStatus: row.session_status,
      }))
    } catch (err) {
      console.error('[SummaryRepository] listAllLatestSummaries error:', err)
      return []
    }
  }

  /**
   * 删除摘要
   */
  deleteSummary(id: number): boolean {
    if (!this.db) return false
    try {
      const changes = this.db.prepare('DELETE FROM session_summaries WHERE id = ?').run(id).changes
      return changes > 0
    } catch (err) {
      console.error('[SummaryRepository] deleteSummary error:', err)
      return false
    }
  }

  /**
   * 删除会话的所有摘要
   */
  deleteSessionSummaries(sessionId: string): number {
    if (!this.db) return 0
    try {
      const result = this.db.prepare('DELETE FROM session_summaries WHERE session_id = ?').run(sessionId)
      return result.changes
    } catch (err) {
      console.error('[SummaryRepository] deleteSessionSummaries error:', err)
      return 0
    }
  }

  private mapRow(row: any): SessionSummary {
    return {
      id: row.id,
      sessionId: row.session_id,
      summary: row.summary,
      keyPoints: row.key_points,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      tokensUsed: row.tokens_used,
      costUsd: row.cost_usd,
      qualityScore: row.quality_score,
      summaryType: row.summary_type || 'auto',
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    }
  }
}
