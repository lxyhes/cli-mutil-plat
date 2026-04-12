/**
 * 每日 AI 日报服务 - 自动生成本日 AI 协作报告
 * 支持：生成/获取/导出日报，推送到飞书/Telegram
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'

export interface DailyReport {
  id: string
  date: string
  sessionsCompleted: number
  filesChanged: number
  tokensUsed: number
  estimatedCost: number
  duration: number         // 秒
  highlights: string[]     // AI 提取的关键成果
  providers: { name: string; sessions: number; tokens: number }[]
  summary: string
  generatedAt: string
}

export interface DailyReportConfig {
  autoGenerate: boolean
  generateTime: string     // '22:00'
  pushToTelegram: boolean
  pushToFeishu: boolean
  includeCost: boolean
}

export class DailyReportService {
  private db: DatabaseManager
  private config: DailyReportConfig = {
    autoGenerate: true, generateTime: '22:00',
    pushToTelegram: false, pushToFeishu: false, includeCost: true,
  }

  constructor(db: DatabaseManager) { this.db = db }

  /** 生成日报 */
  async generate(date?: string): Promise<DailyReport> {
    const targetDate = date || new Date().toISOString().slice(0, 10)

    // 从 usage_daily 汇总
    const usageRows = this.db.all<{
      session_id: string; session_name: string; provider_id: string;
      input_tokens: number; output_tokens: number; duration: number
    }>(`SELECT * FROM usage_daily WHERE date = ?`, [targetDate]) || []

    const sessionsCompleted = new Set(usageRows.map(r => r.session_id)).size
    const tokensUsed = usageRows.reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0)
    const duration = usageRows.reduce((sum, r) => sum + (r.duration || 0), 0)

    // 按Provider汇总
    const providerMap = new Map<string, { name: string; sessions: Set<string>; tokens: number }>()
    for (const r of usageRows) {
      const p = providerMap.get(r.provider_id) || { name: r.provider_id, sessions: new Set<string>(), tokens: 0 }
      p.sessions.add(r.session_id); p.tokens += (r.input_tokens || 0) + (r.output_tokens || 0)
      providerMap.set(r.provider_id, p)
    }

    const report: DailyReport = {
      id: uuid(),
      date: targetDate,
      sessionsCompleted,
      filesChanged: 0, // 从 file_changes 表获取
      tokensUsed,
      estimatedCost: tokensUsed * 0.00001, // 简单估算
      duration,
      highlights: this.generateHighlights(usageRows),
      providers: Array.from(providerMap.values()).map(p => ({ name: p.name, sessions: p.sessions.size, tokens: p.tokens })),
      summary: `今日共完成 ${sessionsCompleted} 个会话，消耗 ${this.formatTokens(tokensUsed)} tokens，运行 ${this.formatDuration(duration)}。`,
      generatedAt: new Date().toISOString(),
    }

    this.db.run(`
      INSERT OR REPLACE INTO daily_reports (id, date, sessions_completed, files_changed, tokens_used, estimated_cost, duration, highlights, providers, summary, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [report.id, report.date, report.sessionsCompleted, report.filesChanged, report.tokensUsed,
        report.estimatedCost, report.duration, JSON.stringify(report.highlights),
        JSON.stringify(report.providers), report.summary, report.generatedAt])

    return report
  }

  /** 获取日报 */
  async get(date: string): Promise<DailyReport | null> {
    return this.db.get<DailyReport>('SELECT * FROM daily_reports WHERE date = ?', [date])
  }

  /** 列出日报 */
  async list(limit?: number): Promise<DailyReport[]> {
    return this.db.all<DailyReport>('SELECT * FROM daily_reports ORDER BY date DESC LIMIT ?', [limit || 30])
  }

  /** 导出日报为 Markdown */
  async export(date: string): Promise<string> {
    const report = await this.get(date)
    if (!report) return '# 日报不存在'

    return `# AI 协作日报 - ${report.date}

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
  }

  /** 获取/设置配置 */
  async getConfig(): Promise<DailyReportConfig> { return this.config }
  async setConfig(updates: Partial<DailyReportConfig>): Promise<DailyReportConfig> {
    Object.assign(this.config, updates)
    return this.config
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
