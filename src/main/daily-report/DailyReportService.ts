/**
 * 每日 AI 日报服务 - 自动生成本日 AI 协作报告
 * 支持：生成/获取/导出日报，推送到飞书/Telegram，配置持久化
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import type { FileChangeTracker } from '../tracker/FileChangeTracker'
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
  telegramBotToken?: string
  telegramChatId?: string
  feishuWebhookUrl?: string
}

export class DailyReportService {
  private db: DatabaseManager
  private rawDb: BetterSqlite3.Database | null = null
  private fileChangeTracker: FileChangeTracker | null = null
  private config: DailyReportConfig = {
    autoGenerate: true, generateTime: '22:00',
    pushToTelegram: false, pushToFeishu: false, includeCost: true,
  }

  constructor(db: DatabaseManager, fileChangeTracker?: FileChangeTracker) {
    this.db = db
    this.fileChangeTracker = fileChangeTracker || null
    this.initDatabase()
    this.loadConfig()
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_report_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  }

  private loadConfig(): void {
    try {
      const db = this.getRawDb()
      const row = db.prepare("SELECT value FROM daily_report_config WHERE key = 'config'").get() as any
      if (row?.value) {
        this.config = { ...this.config, ...JSON.parse(row.value) }
      }
    } catch { /* use defaults */ }
  }

  private saveConfig(): void {
    try {
      const db = this.getRawDb()
      db.prepare(`
        INSERT INTO daily_report_config (key, value) VALUES ('config', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(this.config))
    } catch { /* ignore */ }
  }

  /** 注入 FileChangeTracker（延迟注入，因为初始化顺序） */
  setFileChangeTracker(tracker: FileChangeTracker): void {
    this.fileChangeTracker = tracker
  }

  /** 生成日报 */
  async generate(date?: string): Promise<{ success: boolean; report?: DailyReport; error?: string }> {
    const targetDate = date || new Date().toISOString().slice(0, 10)

    try {
      const db = this.getRawDb()

      // 从 usage_daily 汇总
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

      // 获取文件改动数量（从 FileChangeTracker）
      let filesChanged = 0
      if (this.fileChangeTracker) {
        try {
          // 回退：从 conversation_messages 统计 tool_use 类型的文件操作
          const fileOps = db.prepare(`
            SELECT COUNT(DISTINCT json_extract(content, '$.file')) as file_count
            FROM conversation_messages
            WHERE date(timestamp) = ? AND role = 'assistant'
          `).get(targetDate) as any
          filesChanged = fileOps?.file_count || 0
        } catch {
          filesChanged = 0
        }
      }

      // 按 Provider 汇总
      const providerMap = new Map<string, { name: string; sessions: Set<string>; tokens: number }>()
      for (const r of usageRows) {
        const p = providerMap.get(r.provider_id) || { name: r.provider_id, sessions: new Set<string>(), tokens: 0 }
        p.sessions.add(r.session_id)
        p.tokens += (r.input_tokens || 0) + (r.output_tokens || 0)
        providerMap.set(r.provider_id, p)
      }

      const estimatedCost = tokensUsed * 0.00001 // 粗略估算

      const report: DailyReport = {
        id: uuid(),
        date: targetDate,
        sessionsCompleted,
        filesChanged,
        tokensUsed,
        estimatedCost,
        duration,
        highlights: this.generateHighlights(usageRows, filesChanged),
        providers: Array.from(providerMap.values()).map(p => ({
          name: p.name, sessions: p.sessions.size, tokens: p.tokens
        })),
        summary: `今日共完成 ${sessionsCompleted} 个会话，改动 ${filesChanged} 个文件，消耗 ${this.formatTokens(tokensUsed)} tokens，运行 ${this.formatDuration(duration)}。`,
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

      // 推送通知
      if (this.config.pushToTelegram) {
        this.pushToTelegram(report).catch(err => {
          console.warn('[DailyReport] Telegram 推送失败:', err.message)
        })
      }
      if (this.config.pushToFeishu) {
        this.pushToFeishu(report).catch(err => {
          console.warn('[DailyReport] 飞书推送失败:', err.message)
        })
      }

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
- 改动文件: ${report.filesChanged}
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
    this.saveConfig()
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

  // ── 推送通知 ──────────────────────────────────────────

  /** 推送到 Telegram */
  private async pushToTelegram(report: DailyReport): Promise<void> {
    if (!this.config.telegramBotToken || !this.config.telegramChatId) return

    const text = `📊 *AI 协作日报 - ${report.date}*\n\n` +
      `✅ 完成会话: ${report.sessionsCompleted}\n` +
      `📝 改动文件: ${report.filesChanged}\n` +
      `🔢 Tokens: ${this.formatTokens(report.tokensUsed)}\n` +
      `⏱ 时长: ${this.formatDuration(report.duration)}\n` +
      (this.config.includeCost ? `💰 费用: $${report.estimatedCost.toFixed(2)}\n` : '') +
      `\n${report.highlights.slice(0, 3).map(h => `• ${h}`).join('\n')}`

    const url = `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.config.telegramChatId,
        text,
        parse_mode: 'Markdown',
      }),
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as any
      throw new Error(`Telegram API error: ${errData.description || response.status}`)
    }
  }

  /** 推送到飞书 */
  private async pushToFeishu(report: DailyReport): Promise<void> {
    if (!this.config.feishuWebhookUrl) return

    const content = {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: `📊 AI 协作日报 - ${report.date}` } },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**完成会话**: ${report.sessionsCompleted}\n**改动文件**: ${report.filesChanged}\n**Tokens**: ${this.formatTokens(report.tokensUsed)}\n**时长**: ${this.formatDuration(report.duration)}` +
                (this.config.includeCost ? `\n**费用**: $${report.estimatedCost.toFixed(2)}` : ''),
            },
          },
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**关键成果**:\n${report.highlights.slice(0, 3).map(h => `- ${h}`).join('\n')}`,
            },
          },
        ],
      },
    }

    const response = await fetch(this.config.feishuWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    })

    if (!response.ok) {
      throw new Error(`Feishu webhook error: ${response.status}`)
    }
  }

  // ── 内部方法 ──────────────────────────────────────────

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

  private generateHighlights(rows: any[], filesChanged: number): string[] {
    const highlights: string[] = []
    const sessions = new Set(rows.map(r => r.session_name))
    for (const s of Array.from(sessions).slice(0, 5)) {
      highlights.push(`完成会话: ${s}`)
    }
    if (filesChanged > 0) {
      highlights.push(`共改动 ${filesChanged} 个文件`)
    }
    const totalTokens = rows.reduce((sum: number, r: any) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0)
    if (totalTokens > 0) {
      highlights.push(`消耗 ${this.formatTokens(totalTokens)} tokens`)
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
