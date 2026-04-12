/**
 * 成本仪表盘服务 - Token 消耗换算为实际金额
 * 支持：按 Provider/项目/天/会话统计，预算管理，汇率设置
 * @author spectrai
 */
import { DatabaseManager } from '../storage/Database'

export interface PricingTier {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  inputPricePer1M: number   // 每百万 token 输入价格（美元）
  outputPricePer1M: number  // 每百万 token 输出价格（美元）
}

export interface CostSummary {
  todayCost: number
  todayTokens: number
  monthCost: number
  monthTokens: number
  totalCost: number
  totalTokens: number
  byProvider: { providerId: string; providerName: string; cost: number; tokens: number }[]
  bySession: { sessionId: string; sessionName: string; cost: number; tokens: number }[]
}

export interface CostHistoryPoint {
  date: string
  cost: number
  tokens: number
  sessions: number
}

export interface BudgetConfig {
  dailyLimit: number | null
  monthlyLimit: number | null
  alertThreshold: number  // 0.8 = 80% 时告警
  currency: 'USD' | 'CNY'
  cnyRate: number         // USD→CNY 汇率
}

export interface BudgetCheckResult {
  exceeded: boolean
  level: 'none' | 'warning' | 'danger'
  message: string
}

// 内置默认定价（2025 年官方定价）
const DEFAULT_PRICING: PricingTier[] = [
  { providerId: 'claude-code', providerName: 'Claude Code', modelId: 'claude-sonnet-4-20250514', modelName: 'Claude Sonnet 4', inputPricePer1M: 3, outputPricePer1M: 15 },
  { providerId: 'claude-code', providerName: 'Claude Code', modelId: 'claude-opus-4-20250514', modelName: 'Claude Opus 4', inputPricePer1M: 15, outputPricePer1M: 75 },
  { providerId: 'codex', providerName: 'Codex CLI', modelId: 'codex-1', modelName: 'Codex 1', inputPricePer1M: 5, outputPricePer1M: 20 },
  { providerId: 'gemini-cli', providerName: 'Gemini CLI', modelId: 'gemini-2.5-pro', modelName: 'Gemini 2.5 Pro', inputPricePer1M: 1.25, outputPricePer1M: 10 },
  { providerId: 'gemini-cli', providerName: 'Gemini CLI', modelId: 'gemini-2.5-flash', modelName: 'Gemini 2.5 Flash', inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
  { providerId: 'qwen-coder', providerName: 'Qwen Coder', modelId: 'qwen3-coder', modelName: 'Qwen3 Coder', inputPricePer1M: 0.5, outputPricePer1M: 2 },
  { providerId: 'iflow', providerName: 'iFlow CLI', modelId: 'default', modelName: 'iFlow Default', inputPricePer1M: 2, outputPricePer1M: 8 },
  { providerId: 'opencode', providerName: 'OpenCode', modelId: 'default', modelName: 'OpenCode Default', inputPricePer1M: 3, outputPricePer1M: 15 },
]

export class CostService {
  private rawDb: any  // better-sqlite3 底层实例
  private pricing: PricingTier[]
  private budget: BudgetConfig

  constructor(db: DatabaseManager) {
    this.rawDb = (db as any).db || db
    this.pricing = [...DEFAULT_PRICING]
    this.budget = {
      dailyLimit: null, monthlyLimit: null,
      alertThreshold: 0.8, currency: 'CNY', cnyRate: 7.25,
    }
    this.ensureTable()
    this.loadBudget()
  }

  /** 创建 cost_settings 表（持久化预算和定价） */
  private ensureTable(): void {
    try {
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS cost_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS cost_daily_detail (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          provider_id TEXT NOT NULL DEFAULT '',
          date DATE NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          active_minutes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
      `)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_cost_daily_date ON cost_daily_detail(date DESC)`)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_cost_daily_session ON cost_daily_detail(session_id, date DESC)`)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_cost_daily_provider ON cost_daily_detail(provider_id, date DESC)`)

      // 迁移：如果 usage_stats 有数据但 cost_daily_detail 为空，做一次迁移
      this.migrateFromUsageStats()
    } catch (err) {
      console.error('[CostService] ensureTable failed:', err)
    }
  }

  /** 迁移 usage_stats 旧数据到 cost_daily_detail */
  private migrateFromUsageStats(): void {
    try {
      const count = this.rawDb.prepare('SELECT COUNT(*) as c FROM cost_daily_detail').get() as any
      if (count?.c > 0) return // 已有数据，跳过

      const oldRows = this.rawDb.prepare(`
        SELECT u.session_id, s.provider_id, u.date, u.estimated_tokens, u.active_minutes
        FROM usage_stats u
        LEFT JOIN sessions s ON s.id = u.session_id
      `).all() as any[]

      if (oldRows.length === 0) return

      const insert = this.rawDb.prepare(`
        INSERT INTO cost_daily_detail (session_id, provider_id, date, input_tokens, output_tokens, active_minutes)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      const insertMany = this.rawDb.transaction((rows: any[]) => {
        for (const r of rows) {
          // 旧数据没有 input/output 分离，按 60%/40% 粗略拆分
          const input = Math.round(r.estimated_tokens * 0.6)
          const output = r.estimated_tokens - input
          insert.run(r.session_id, r.provider_id || '', r.date, input, output, r.active_minutes || 0)
        }
      })
      insertMany(oldRows)
      console.log(`[CostService] Migrated ${oldRows.length} rows from usage_stats to cost_daily_detail`)
    } catch (err) {
      console.warn('[CostService] Migration from usage_stats failed:', err)
    }
  }

  /** 从数据库加载预算设置 */
  private loadBudget(): void {
    try {
      const row = this.rawDb.prepare("SELECT value FROM cost_settings WHERE key = 'budget'").get() as any
      if (row?.value) {
        Object.assign(this.budget, JSON.parse(row.value))
      }
    } catch { /* ignore */ }
  }

  /** 保存预算设置到数据库 */
  private saveBudget(): void {
    try {
      const value = JSON.stringify(this.budget)
      this.rawDb.prepare(`
        INSERT INTO cost_settings (key, value) VALUES ('budget', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(value)
    } catch (err) {
      console.error('[CostService] saveBudget failed:', err)
    }
  }

  /**
   * 保存用量明细（由 systemHandlers 的 usage-update 事件调用）
   * 与 UsageRepository 并行工作，存储更细粒度的数据
   */
  saveUsageDetail(sessionId: string, providerId: string, inputTokens: number, outputTokens: number): void {
    try {
      const today = new Date().toISOString().slice(0, 10)

      // Upsert：同 session + provider + date 合并
      const existing = this.rawDb.prepare(
        'SELECT id, input_tokens, output_tokens FROM cost_daily_detail WHERE session_id = ? AND provider_id = ? AND date = ?'
      ).get(sessionId, providerId, today) as any

      if (existing) {
        this.rawDb.prepare(
          'UPDATE cost_daily_detail SET input_tokens = ?, output_tokens = ? WHERE id = ?'
        ).run(existing.input_tokens + inputTokens, existing.output_tokens + outputTokens, existing.id)
      } else {
        this.rawDb.prepare(`
          INSERT INTO cost_daily_detail (session_id, provider_id, date, input_tokens, output_tokens)
          VALUES (?, ?, ?, ?, ?)
        `).run(sessionId, providerId, today, inputTokens, outputTokens)
      }
    } catch (err) {
      console.warn('[CostService] saveUsageDetail failed:', err)
    }
  }

  /** 根据 providerId 获取定价 */
  private getPricingForProvider(providerId: string): PricingTier | undefined {
    // 精确匹配
    let p = this.pricing.find(t => t.providerId === providerId)
    if (p) return p
    // 模糊匹配（如 "claude-code" 匹配 "claude"）
    const shortId = providerId.split('-')[0]
    p = this.pricing.find(t => t.providerId.startsWith(shortId))
    return p
  }

  /** 计算单行成本（美元） */
  private calcCost(inputTokens: number, outputTokens: number, providerId: string): number {
    const pricing = this.getPricingForProvider(providerId)
    const inputCost = (inputTokens / 1_000_000) * (pricing?.inputPricePer1M || 1)
    const outputCost = (outputTokens / 1_000_000) * (pricing?.outputPricePer1M || 3)
    return inputCost + outputCost
  }

  /** 获取成本汇总 */
  async getSummary(days?: number): Promise<CostSummary> {
    try {
      const rows = this.rawDb.prepare(`
        SELECT d.session_id, d.provider_id, d.date,
               SUM(d.input_tokens) as totalInputTokens,
               SUM(d.output_tokens) as totalOutputTokens
        FROM cost_daily_detail d
        ${days ? `WHERE d.date >= date('now', '-' || ? || ' days')` : ''}
        GROUP BY d.session_id, d.provider_id
      `).all(...(days ? [days] : [])) as any[]

      const now = new Date()
      const today = now.toISOString().slice(0, 10)
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

      let todayCost = 0, todayTokens = 0, monthCost = 0, monthTokens = 0, totalCost = 0, totalTokens = 0
      const providerMap = new Map<string, { cost: number; tokens: number; name: string }>()
      const sessionMap = new Map<string, { cost: number; tokens: number; name: string; providerId: string }>()

      for (const row of rows) {
        const cost = this.calcCost(row.totalInputTokens, row.totalOutputTokens, row.provider_id)
        const tokens = row.totalInputTokens + row.totalOutputTokens

        totalCost += cost; totalTokens += tokens

        // 今日
        const todayRows = this.rawDb.prepare(`
          SELECT SUM(input_tokens) as inp, SUM(output_tokens) as outp
          FROM cost_daily_detail WHERE date = ?
        `).get(today) as any
        if (todayRows) {
          // 从所有 provider 行获取今日数据（后面会覆盖）
        }

        if (row.date === today) { todayCost += cost; todayTokens += tokens }
        if (row.date >= monthStart) { monthCost += cost; monthTokens += tokens }

        const pricing = this.getPricingForProvider(row.provider_id)
        const pv = providerMap.get(row.provider_id) || { cost: 0, tokens: 0, name: pricing?.providerName || row.provider_id }
        pv.cost += cost; pv.tokens += tokens; providerMap.set(row.provider_id, pv)

        const sv = sessionMap.get(row.session_id) || { cost: 0, tokens: 0, name: row.session_id.slice(0, 8), providerId: row.provider_id }
        sv.cost += cost; sv.tokens += tokens; sessionMap.set(row.session_id, sv)
      }

      // 补充今日数据（直接从 DB 查询更准确）
      const todayData = this.rawDb.prepare(`
        SELECT provider_id, SUM(input_tokens) as inp, SUM(output_tokens) as outp
        FROM cost_daily_detail WHERE date = ? GROUP BY provider_id
      `).all(today) as any[]
      todayCost = 0; todayTokens = 0
      for (const r of todayData) {
        todayCost += this.calcCost(r.inp, r.outp, r.provider_id)
        todayTokens += r.inp + r.outp
      }

      // 补充本月数据
      const monthData = this.rawDb.prepare(`
        SELECT provider_id, SUM(input_tokens) as inp, SUM(output_tokens) as outp
        FROM cost_daily_detail WHERE date >= ? GROUP BY provider_id
      `).all(monthStart) as any[]
      monthCost = 0; monthTokens = 0
      for (const r of monthData) {
        monthCost += this.calcCost(r.inp, r.outp, r.provider_id)
        monthTokens += r.inp + r.outp
      }

      // 总计
      const totalData = this.rawDb.prepare(`
        SELECT provider_id, SUM(input_tokens) as inp, SUM(output_tokens) as outp
        FROM cost_daily_detail GROUP BY provider_id
      `).all() as any[]
      totalCost = 0; totalTokens = 0
      for (const r of totalData) {
        totalCost += this.calcCost(r.inp, r.outp, r.provider_id)
        totalTokens += r.inp + r.outp
      }

      // 获取会话名称
      const sessionNames = this.rawDb.prepare('SELECT id, name FROM sessions').all() as any[]
      const nameMap = new Map(sessionNames.map((s: any) => [s.id, s.name]))

      return {
        todayCost, todayTokens, monthCost, monthTokens, totalCost, totalTokens,
        byProvider: Array.from(providerMap.entries()).map(([id, v]) => ({ providerId: id, providerName: v.name, ...v })),
        bySession: Array.from(sessionMap.entries()).map(([id, v]) => ({
          sessionId: id, sessionName: nameMap.get(id) || v.name, cost: v.cost, tokens: v.tokens
        })),
      }
    } catch (err) {
      console.error('[CostService] getSummary error:', err)
      return {
        todayCost: 0, todayTokens: 0, monthCost: 0, monthTokens: 0, totalCost: 0, totalTokens: 0,
        byProvider: [], bySession: [],
      }
    }
  }

  /** 获取成本历史（按天聚合） */
  async getHistory(days: number = 30): Promise<CostHistoryPoint[]> {
    try {
      const rows = this.rawDb.prepare(`
        SELECT date, SUM(input_tokens) as totalInputTokens, SUM(output_tokens) as totalOutputTokens,
               COUNT(DISTINCT session_id) as sessions
        FROM cost_daily_detail
        WHERE date >= date('now', '-' || ? || ' days')
        GROUP BY date
        ORDER BY date ASC
      `).all(days) as any[]

      return rows.map(r => {
        const cost = this.calcCost(r.totalInputTokens, r.totalOutputTokens, '') // 聚合无法按 provider 算，用平均价
        // 更精确：按 provider 分别计算
        const providerRows = this.rawDb.prepare(`
          SELECT provider_id, SUM(input_tokens) as inp, SUM(output_tokens) as outp
          FROM cost_daily_detail WHERE date = ? GROUP BY provider_id
        `).all(r.date) as any[]
        let dayCost = 0
        for (const pr of providerRows) {
          dayCost += this.calcCost(pr.inp, pr.outp, pr.provider_id)
        }
        return {
          date: r.date,
          cost: dayCost,
          tokens: r.totalInputTokens + r.totalOutputTokens,
          sessions: r.sessions || 0,
        }
      })
    } catch (err) {
      console.error('[CostService] getHistory error:', err)
      return []
    }
  }

  /** 获取按会话的成本明细 */
  async getBySession(sessionId: string): Promise<{ inputTokens: number; outputTokens: number; cost: number; byDate: { date: string; cost: number; tokens: number }[] }> {
    try {
      const rows = this.rawDb.prepare(`
        SELECT date, provider_id, SUM(input_tokens) as inp, SUM(output_tokens) as outp
        FROM cost_daily_detail WHERE session_id = ?
        GROUP BY date, provider_id
        ORDER BY date ASC
      `).all(sessionId) as any[]

      let inputTokens = 0, outputTokens = 0, cost = 0
      const dateMap = new Map<string, { cost: number; tokens: number }>()

      for (const r of rows) {
        const c = this.calcCost(r.inp, r.outp, r.provider_id)
        inputTokens += r.inp; outputTokens += r.outp; cost += c
        const dv = dateMap.get(r.date) || { cost: 0, tokens: 0 }
        dv.cost += c; dv.tokens += r.inp + r.outp
        dateMap.set(r.date, dv)
      }

      return {
        inputTokens, outputTokens, cost,
        byDate: Array.from(dateMap.entries()).map(([date, v]) => ({ date, ...v })),
      }
    } catch {
      return { inputTokens: 0, outputTokens: 0, cost: 0, byDate: [] }
    }
  }

  /** 获取按 Provider 的成本明细 */
  async getByProvider(): Promise<{ providerId: string; providerName: string; inputTokens: number; outputTokens: number; cost: number; sessions: number }[]> {
    try {
      const rows = this.rawDb.prepare(`
        SELECT provider_id, SUM(input_tokens) as totalInputTokens, SUM(output_tokens) as totalOutputTokens,
               COUNT(DISTINCT session_id) as sessions
        FROM cost_daily_detail
        GROUP BY provider_id
        ORDER BY totalOutputTokens DESC
      `).all() as any[]

      return rows.map(r => {
        const pricing = this.getPricingForProvider(r.provider_id)
        const cost = this.calcCost(r.totalInputTokens, r.totalOutputTokens, r.provider_id)
        return {
          providerId: r.provider_id,
          providerName: pricing?.providerName || r.provider_id,
          inputTokens: r.totalInputTokens || 0,
          outputTokens: r.totalOutputTokens || 0,
          cost,
          sessions: r.sessions || 0,
        }
      })
    } catch {
      return []
    }
  }

  /** 获取/设置预算 */
  async getBudget(): Promise<BudgetConfig> { return { ...this.budget } }

  async setBudget(config: Partial<BudgetConfig>): Promise<BudgetConfig> {
    Object.assign(this.budget, config)
    this.saveBudget()
    return { ...this.budget }
  }

  /** 获取/更新定价 */
  getPricing(): PricingTier[] { return [...this.pricing] }

  updatePricing(tiers: PricingTier[]): void {
    this.pricing = [...tiers]
    // 持久化定价
    try {
      const value = JSON.stringify(this.pricing)
      this.rawDb.prepare(`
        INSERT INTO cost_settings (key, value) VALUES ('pricing', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(value)
    } catch (err) {
      console.error('[CostService] savePricing failed:', err)
    }
  }

  /** 检查是否超预算 */
  checkBudget(summary: CostSummary): BudgetCheckResult {
    if (this.budget.dailyLimit && summary.todayCost >= this.budget.dailyLimit) {
      return { exceeded: true, level: 'danger', message: `今日花费 $${summary.todayCost.toFixed(2)} 已超过日预算 $${this.budget.dailyLimit}` }
    }
    if (this.budget.dailyLimit && summary.todayCost >= this.budget.dailyLimit * this.budget.alertThreshold) {
      return { exceeded: false, level: 'warning', message: `今日花费已达日预算的 ${Math.round(summary.todayCost / this.budget.dailyLimit * 100)}%` }
    }
    if (this.budget.monthlyLimit && summary.monthCost >= this.budget.monthlyLimit) {
      return { exceeded: true, level: 'danger', message: `本月花费 $${summary.monthCost.toFixed(2)} 已超过月预算 $${this.budget.monthlyLimit}` }
    }
    if (this.budget.monthlyLimit && summary.monthCost >= this.budget.monthlyLimit * this.budget.alertThreshold) {
      return { exceeded: false, level: 'warning', message: `本月花费已达月预算的 ${Math.round(summary.monthCost / this.budget.monthlyLimit * 100)}%` }
    }
    return { exceeded: false, level: 'none', message: '' }
  }
}
