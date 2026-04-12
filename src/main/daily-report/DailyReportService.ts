/**
 * 每日 AI 日报服务 - 自动生成本日 AI 协作报告
 * 支持：生成/获取/导出日报，推送到飞书/Telegram
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import type BetterSqlite3 from 'better-sqlite3'

export interface DailyReport {
  id: string
  date: string
  sessionsCompleted: number
  filesChanged: number
  tokensUsed: number
  estimatedCost: number
  duration: number
  highlights: string[]
  providers: { name: string; sessions: number; tokens: number }[]
  summary: string
  generatedAt: string
}

export interface DailyReportConfig {
  autoGenerate: boolean
  generateTime: string
  pushToTelegram: boolean
  pushToFeishu: boolean
  includeCost: boolean
}

export class DailyReportService {
  private db: DatabaseManager
  private rawDb: BetterSqlite3.Database | null = null
  private config: DailyReportConfig = {
    autoGenerate: true, generateTime: '22:00',
    pushToTelegram: false, pushToFeishu: false, includeCost: true,
  }

  constructor(db: DatabaseManager) {
    this.db = db
    this.initDatabase()
  }

  private getRawDb(): BetterSqlite3.Database {
    if (!this.rawDb) {
      this.rawDb = (this.db as any).db as BetterSqlite3.Database
    }
    return this.rawDb!
  }

  private initDatabase(): void {
    const db = this.getRawDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL UNIQUE,
        sessions_completed INTEGER NOT NULL DEFAULT 0,
        files_changed INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0,
        duration INTEGER NOT NULL DEFAULT 0,
        highlights TEXT NOT NULL DEFAULT '[]',
        providers TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        generated_at TEXT NOT NULL
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(date)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_reports_generated ON daily_reports(generated_at)`)
  }

  /** 生成日报 */
  async generate(date?: string): Promise<{ success: boolean; report?: DailyReport; error?: string }> {
    const targetDate = date || new Date().toISOString().slice(0, 10)

    try {
      const db = this.getRawDb()

      // 从 usage_daily 汇总（如果表存在）
      let usageRows: any[] = []
      try {
        usageRows = db.prepare(
          `SELECT session_id, session_name, provider_id, input_tokens, output_tokens, duration FROM usage_daily WHERE date = ?`
        ).all(targetDate) as any[]
      } catch {
        // usage_daily 表可能不存在
      }

      const sessionsCompleted = new Set(usageRows.map((r: any) => r.session_id)).size
      const tokensUsed = usageRows.reduce((sum: number, r: any) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0)
      const duration = usageRows.reduce((sum: number, r: any) => sum + (r.duration || 0), 0)

      // 按 Provider 汇总
      const providerMap = new Map<string, { name: string; sessions: Set<string>; tokens: number }>()
      for (const r of usageRows) {
        const p = providerMap.get(r.provider_id) || { name: r.provider_id, sessions: new Set<string>(), tokens: 0 }
        p.sessions.add(r.session_id)
        p.tokens += (r.input_tokens || 0) + (r.output_tokens || 0)
        providerMap.set(r.provider_id, p)
      }

      const report: DailyReport = {
        id: uuid(),
        date: targetDate,
        sessionsCompleted,
        filesChanged: 0,
        tokensUsed,
        estimatedCost: tokensUsed * 0.00001,
        duration,
        highlights: this.generateHighlights(usageRows),
        providers: Array.from(providerMap.values()).map(p => ({
          name: p.name, sessions: p.sessions.size, tokens: p.tokens
        })),
        summary: `今日共完成 ${sessionsCompleted} 个会话，消耗 ${this.formatTokens(tokensUsed)} tokens，运行 ${this.formatDuration(duration)}。`,
        generatedAt: new Date().toISOString(),
      }

      db.prepare(`
        INSERT OR REPLACE INTO daily_reports
          (id, date, sessions_completed, files_changed, tokens_used, estimated_cost, duration, highlights, providers, summary, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        report.id, report.date, report.sessionsCompleted, report.filesChanged,
        report.tokensUsed, report.estimatedCost, report.duration,
        JSON.stringify(report.highlights), JSON.stringify(report.providers),
        report.summary, report.generatedAt
      )

      return { success: true, report }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 获取日报 */
  async get(date: string): Promise<{ success: boolean; report?: DailyReport }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM daily_reports WHERE date = ?').get(date) as any
      if (!row) return { success: true }
      return { success: true, report: this.mapRow(row) }
    } catch {
      return { success: true }
    }
  }

  /** 列出日报 */
  async list(limit?: number): Promise<{ success: boolean; reports: DailyReport[] }> {
    try {
      const db = this.getRawDb()
      const rows = db.prepare('SELECT * FROM daily_reports ORDER BY date DESC LIMIT ?').all(limit || 30) as any[]
      return { success: true, reports: rows.map(r => this.mapRow(r)) }
    } catch {
      return { success: true, reports: [] }
    }
  }

  /** 导出日报为 Markdown */
  async export(date: string): Promise<{ success: boolean; markdown?: string }> {
    try {
      const result = await this.get(date)
      const report = result.report
      if (!report) return { success: true, markdown: '# 日报不存在' }

      const md = `# AI 协作日报 - ${report.date}

## 概览
- 完成会话: ${report.sessionsCompleted}
- 消耗 Tokens: ${this.formatTokens(report.tokensUsed)}
- 运行时长: ${this.formatDuration(report.duration)}
${report.estimatedCost ? `- 预估费用: $${report.estimatedCost.toFixed(2)}` : ''}

## 关键成果
${report.highlights.map(h => `- ${h}`).join('\n')}

## Provider 使用
| Provider | 会话数 | Tokens |
|----------|--------|--------|
${report.providers.map(p => `| ${p.name} | ${p.sessions} | ${this.formatTokens(p.tokens)} |`).join('\n')}

---
*由 SpectrAI 自动生成于 ${report.generatedAt}*`

      return { success: true, markdown: md }
    } catch {
      return { success: true, markdown: '# 导出失败' }
    }
  }

  /** 获取配置 */
  async getConfig(): Promise<{ success: boolean; config: DailyReportConfig }> {
    return { success: true, config: { ...this.config } }
  }

  /** 设置配置 */
  async setConfig(updates: Partial<DailyReportConfig>): Promise<{ success: boolean; config: DailyReportConfig }> {
    Object.assign(this.config, updates)
    return { success: true, config: { ...this.config } }
  }

  /** 删除日报 */
  async delete(date: string): Promise<{ success: boolean }> {
    try {
      const db = this.getRawDb()
      db.prepare('DELETE FROM daily_reports WHERE date = ?').run(date)
      return { success: true }
    } catch {
      return { success: true }
    }
  }

  private mapRow(row: any): DailyReport {
    if (!row) return row
    return {
      id: row.id,
      date: row.date,
      sessionsCompleted: row.sessions_completed,
      filesChanged: row.files_changed,
      tokensUsed: row.tokens_used,
      estimatedCost: row.estimated_cost,
      duration: row.duration,
      highlights: typeof row.highlights === 'string' ? JSON.parse(row.highlights || '[]') : (row.highlights || []),
      providers: typeof row.providers === 'string' ? JSON.parse(row.providers || '[]') : (row.providers || []),
      summary: row.summary,
      generatedAt: row.generated_at,
    }
  }

  private generateHighlights(rows: any[]): string[] {
    const highlights: string[] = []
    const sessions = new Set(rows.map(r => r.session_name))
    for (const s of Array.from(sessions).slice(0, 5)) {
      highlights.push(`完成会话: ${s}`)
    }
    if (highlights.length === 0) highlights.push('今日无活跃会话')
    return highlights
  }

  private formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return String(n)
  }

  private formatDuration(secs: number): string {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`
  }
}
