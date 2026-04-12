/**
 * 成本仪表盘服务 - Token 消耗换算为实际金额
 * 支持：按 Provider/项目/天/会话统计，预算管理
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

export interface BudgetConfig {
  dailyLimit: number | null
  monthlyLimit: number | null
  alertThreshold: number  // 0.8 = 80% 时告警
  currency: 'USD' | 'CNY'
  cnyRate: number         // USD→CNY 汇率
}

// 内置默认定价
const DEFAULT_PRICING: PricingTier[] = [
  { providerId: 'claude', providerName: 'Claude Code', modelId: 'claude-sonnet-4-20250514', modelName: 'Claude Sonnet 4', inputPricePer1M: 3, outputPricePer1M: 15 },
  { providerId: 'claude', providerName: 'Claude Code', modelId: 'claude-opus-4-20250514', modelName: 'Claude Opus 4', inputPricePer1M: 15, outputPricePer1M: 75 },
  { providerId: 'codex', providerName: 'Codex CLI', modelId: 'codex-1', modelName: 'Codex 1', inputPricePer1M: 5, outputPricePer1M: 20 },
  { providerId: 'gemini', providerName: 'Gemini CLI', modelId: 'gemini-2.5-pro', modelName: 'Gemini 2.5 Pro', inputPricePer1M: 1.25, outputPricePer1M: 10 },
  { providerId: 'gemini', providerName: 'Gemini CLI', modelId: 'gemini-2.5-flash', modelName: 'Gemini 2.5 Flash', inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
  { providerId: 'qwen', providerName: 'Qwen Coder', modelId: 'qwen3-coder', modelName: 'Qwen3 Coder', inputPricePer1M: 0.5, outputPricePer1M: 2 },
]

export class CostService {
  private db: DatabaseManager
  private budget: BudgetConfig = {
    dailyLimit: null, monthlyLimit: null,
    alertThreshold: 0.8, currency: 'CNY', cnyRate: 7.25,
  }
  private pricing: PricingTier[] = [...DEFAULT_PRICING]

  constructor(db: DatabaseManager) { this.db = db }

  /** 获取成本汇总 */
  async getSummary(days?: number): Promise<CostSummary> {
    const usageRows = this.db.all<{
      sessionId: string; sessionName: string; providerId: string;
      totalInputTokens: number; totalOutputTokens: number; date: string
    }>(`SELECT * FROM usage_daily ORDER BY date DESC`, []) || []

    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    let todayCost = 0, todayTokens = 0, monthCost = 0, monthTokens = 0, totalCost = 0, totalTokens = 0
    const providerMap = new Map<string, { cost: number; tokens: number; name: string }>()
    const sessionMap = new Map<string, { cost: number; tokens: number; name: string }>()

    for (const row of usageRows) {
      const pricing = this.pricing.find(p => p.providerId === row.providerId)
      const inputCost = (row.totalInputTokens / 1_000_000) * (pricing?.inputPricePer1M || 1)
      const outputCost = (row.totalOutputTokens / 1_000_000) * (pricing?.outputPricePer1M || 3)
      const cost = inputCost + outputCost
      const tokens = row.totalInputTokens + row.totalOutputTokens

      totalCost += cost; totalTokens += tokens
      if (row.date === today) { todayCost += cost; todayTokens += tokens }
      if (row.date >= monthStart) { monthCost += cost; monthTokens += tokens }

      const pv = providerMap.get(row.providerId) || { cost: 0, tokens: 0, name: pricing?.providerName || row.providerId }
      pv.cost += cost; pv.tokens += tokens; providerMap.set(row.providerId, pv)

      const sv = sessionMap.get(row.sessionId) || { cost: 0, tokens: 0, name: row.sessionName }
      sv.cost += cost; sv.tokens += tokens; sessionMap.set(row.sessionId, sv)
    }

    return {
      todayCost, todayTokens, monthCost, monthTokens, totalCost, totalTokens,
      byProvider: Array.from(providerMap.entries()).map(([id, v]) => ({ providerId: id, providerName: v.name, ...v })),
      bySession: Array.from(sessionMap.entries()).map(([id, v]) => ({ sessionId: id, sessionName: v.name, ...v })),
    }
  }

  /** 获取成本历史 */
  async getHistory(days: number = 30): Promise<{ date: string; cost: number; tokens: number }[]> {
    const rows = this.db.all<{ date: string; totalCost: number; totalTokens: number }>(`
      SELECT date, SUM(input_tokens + output_tokens) as totalTokens,
             0 as totalCost FROM usage_daily GROUP BY date ORDER BY date DESC LIMIT ?
    `, [days]) || []
    return rows.map(r => ({ date: r.date, cost: r.totalCost || 0, tokens: r.totalTokens || 0 }))
  }

  /** 获取/设置预算 */
  async getBudget(): Promise<BudgetConfig> { return this.budget }
  async setBudget(config: Partial<BudgetConfig>): Promise<BudgetConfig> {
    Object.assign(this.budget, config)
    return this.budget
  }

  /** 获取/更新定价 */
  getPricing(): PricingTier[] { return this.pricing }
  updatePricing(tiers: PricingTier[]): void { this.pricing = tiers }

  /** 检查是否超预算 */
  checkBudget(summary: CostSummary): { exceeded: boolean; level: 'none' | 'warning' | 'danger'; message: string } {
    if (this.budget.dailyLimit && summary.todayCost >= this.budget.dailyLimit) {
      return { exceeded: true, level: 'danger', message: `今日花费 $${summary.todayCost.toFixed(2)} 已超过日预算 $${this.budget.dailyLimit}` }
    }
    if (this.budget.dailyLimit && summary.todayCost >= this.budget.dailyLimit * this.budget.alertThreshold) {
      return { exceeded: false, level: 'warning', message: `今日花费已达日预算的 ${Math.round(summary.todayCost / this.budget.dailyLimit * 100)}%` }
    }
    if (this.budget.monthlyLimit && summary.monthCost >= this.budget.monthlyLimit) {
      return { exceeded: true, level: 'danger', message: `本月花费 $${summary.monthCost.toFixed(2)} 已超过月预算 $${this.budget.monthlyLimit}` }
    }
    return { exceeded: false, level: 'none', message: '' }
  }
}
