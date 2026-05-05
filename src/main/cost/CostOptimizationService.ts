/**
 * 成本优化路由服务
 * 
 * 功能:
 * 1. 基于任务类型和预算智能选择最经济的 Provider
 * 2. 实时追踪各 Provider 的成本效率（tokens/$）
 * 3. 提供成本预测和建议
 * 4. 自动降级策略（预算不足时切换低成本模型）
 * 5. 成本效益分析和报告
 */

import { EventEmitter } from 'events'
import type { AIProvider } from '../../shared/types'
import type { DatabaseManager } from '../storage/Database'
import type { CostService, PricingTier } from '../cost/CostService'
import type { ProviderHealthService } from '../provider/ProviderHealthService'

export interface TaskProfile {
  taskType: 'code_generation' | 'code_review' | 'debugging' | 'architecture' | 'documentation' | 'refactoring' | 'testing' | 'general'
  complexity: 'simple' | 'medium' | 'complex' | 'critical'
  estimatedTokens?: number
  budgetLimit?: number // 美元
  urgency: 'low' | 'normal' | 'high' | 'critical'
}

export interface ProviderCostEfficiency {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  inputPricePer1M: number
  outputPricePer1M: number
  averageTokensPerDollar: number // tokens/$ 效率指标
  successRate: number // 成功率
  avgResponseTimeMs: number // 平均响应时间
  costScore: number // 综合成本评分 (0-100，越高越好)
  isHealthy: boolean
}

export interface RoutingDecision {
  selectedProvider: AIProvider
  reason: string
  alternatives: Array<{
    provider: AIProvider
    estimatedCost: number
    pros: string[]
    cons: string[]
  }>
  estimatedCost: number
  estimatedTokens: number
  costSavingVsDefault: number // 相比默认 Provider 节省的金额
  confidence: number // 决策置信度 (0-1)
}

export interface BudgetAlert {
  level: 'info' | 'warning' | 'danger' | 'critical'
  message: string
  currentCost: number
  budgetLimit: number
  usagePercent: number
  suggestedAction?: string
}

export interface CostOptimizationConfig {
  enabled: boolean
  autoRoutingEnabled: boolean // 自动路由开关
  budgetAlertThresholds: {
    warning: number // 0.7 = 70%
    danger: number // 0.85 = 85%
    critical: number // 0.95 = 95%
  }
  minCostSavingThreshold: number // 最小节省金额才触发切换（美元）
  qualityWeight: number // 质量权重 (0-1)
  costWeight: number // 成本权重 (0-1)
  speedWeight: number // 速度权重 (0-1)
  fallbackStrategy: 'cheapest' | 'balanced' | 'fastest' // 降级策略
}

export class CostOptimizationService extends EventEmitter {
  private db: DatabaseManager
  private costService: CostService
  private healthService: ProviderHealthService
  private config: CostOptimizationConfig
  private dailyBudgetUsed: Map<string, number> = new Map() // date -> cost
  private monthlyBudgetUsed: Map<string, number> = new Map() // month -> cost

  constructor(
    db: DatabaseManager,
    costService: CostService,
    healthService: ProviderHealthService,
    config?: Partial<CostOptimizationConfig>
  ) {
    super()
    this.db = db
    this.costService = costService
    this.healthService = healthService
    this.config = {
      enabled: config?.enabled ?? true,
      autoRoutingEnabled: config?.autoRoutingEnabled ?? false,
      budgetAlertThresholds: {
        warning: config?.budgetAlertThresholds?.warning ?? 0.7,
        danger: config?.budgetAlertThresholds?.danger ?? 0.85,
        critical: config?.budgetAlertThresholds?.critical ?? 0.95,
      },
      minCostSavingThreshold: config?.minCostSavingThreshold ?? 0.01, // $0.01
      qualityWeight: config?.qualityWeight ?? 0.4,
      costWeight: config?.costWeight ?? 0.4,
      speedWeight: config?.speedWeight ?? 0.2,
      fallbackStrategy: config?.fallbackStrategy ?? 'balanced',
    }
  }

  /**
   * 根据任务特征智能选择最优 Provider
   */
  async selectOptimalProvider(
    taskProfile: TaskProfile,
    preferredProviderId?: string
  ): Promise<RoutingDecision> {
    if (!this.config.enabled) {
      // 如果未启用，返回首选或默认 Provider
      const provider = preferredProviderId
        ? this.db.getProvider(preferredProviderId)
        : this.getDefaultProvider()
      
      return {
        selectedProvider: provider!,
        reason: '成本优化已禁用，使用默认 Provider',
        alternatives: [],
        estimatedCost: 0,
        estimatedTokens: taskProfile.estimatedTokens || 1000,
        costSavingVsDefault: 0,
        confidence: 1,
      }
    }

    // 获取所有可用且健康的 Provider
    const availableProviders = this.getAvailableProviders()
    if (availableProviders.length === 0) {
      throw new Error('没有可用的 Provider')
    }

    // 计算每个 Provider 的成本效率
    const efficiencies = await Promise.all(
      availableProviders.map(p => this.calculateCostEfficiency(p))
    )

    // 过滤掉不健康的 Provider
    const healthyEfficiencies = efficiencies.filter(e => e.isHealthy)
    if (healthyEfficiencies.length === 0) {
      throw new Error('没有健康的 Provider 可用')
    }

    // 评分并排序
    const scored = healthyEfficiencies.map(eff => ({
      efficiency: eff,
      score: this.calculateProviderScore(eff, taskProfile),
    }))

    scored.sort((a, b) => b.score - a.score)

    // 选择最佳 Provider
    const best = scored[0]
    const selectedProvider = this.db.getProvider(best.efficiency.providerId)!

    // 生成备选方案
    const alternatives = scored.slice(1, 4).map(s => ({
      provider: this.db.getProvider(s.efficiency.providerId)!,
      estimatedCost: this.estimateTaskCost(s.efficiency, taskProfile),
      pros: this.getProviderPros(s.efficiency, taskProfile),
      cons: this.getProviderCons(s.efficiency, taskProfile),
    }))

    // 估算成本
    const estimatedCost = this.estimateTaskCost(best.efficiency, taskProfile)
    const defaultProvider = this.getDefaultProvider()
    const defaultEfficiency = await this.calculateCostEfficiency(defaultProvider)
    const defaultCost = this.estimateTaskCost(defaultEfficiency, taskProfile)
    const costSaving = Math.max(0, defaultCost - estimatedCost)

    // 生成推荐理由
    const reason = this.generateRoutingReason(best.efficiency, taskProfile, costSaving)

    return {
      selectedProvider,
      reason,
      alternatives,
      estimatedCost,
      estimatedTokens: taskProfile.estimatedTokens || 1000,
      costSavingVsDefault: costSaving,
      confidence: Math.min(1, best.score / 100),
    }
  }

  /**
   * 检查预算状态并发出告警
   */
  checkBudgetStatus(): BudgetAlert | null {
    const budget = this.costService.getBudgetConfig()
    if (!budget || !budget.dailyLimit) return null

    const today = new Date().toISOString().slice(0, 10)
    const currentCost = this.dailyBudgetUsed.get(today) || 0
    const usagePercent = currentCost / budget.dailyLimit

    let level: BudgetAlert['level'] = 'info'
    let message = ''
    let suggestedAction: string | undefined

    if (usagePercent >= this.config.budgetAlertThresholds.critical) {
      level = 'critical'
      message = `预算即将耗尽！今日已用 ${this.formatCurrency(currentCost)} / ${this.formatCurrency(budget.dailyLimit)} (${(usagePercent * 100).toFixed(1)}%)`
      suggestedAction = '建议立即切换到最低成本模型或暂停非关键任务'
    } else if (usagePercent >= this.config.budgetAlertThresholds.danger) {
      level = 'danger'
      message = `预算紧张！今日已用 ${this.formatCurrency(currentCost)} / ${this.formatCurrency(budget.dailyLimit)} (${(usagePercent * 100).toFixed(1)}%)`
      suggestedAction = '建议后续任务使用低成本模型'
    } else if (usagePercent >= this.config.budgetAlertThresholds.warning) {
      level = 'warning'
      message = `预算使用过半，今日已用 ${this.formatCurrency(currentCost)} / ${this.formatCurrency(budget.dailyLimit)} (${(usagePercent * 100).toFixed(1)}%)`
      suggestedAction = '注意控制成本'
    } else {
      return null // 未达到告警阈值
    }

    const alert: BudgetAlert = {
      level,
      message,
      currentCost,
      budgetLimit: budget.dailyLimit,
      usagePercent,
      suggestedAction,
    }

    // 发射告警事件
    this.emit('budget-alert', alert)

    return alert
  }

  /**
   * 记录成本使用
   */
  recordCostUsage(cost: number): void {
    const today = new Date().toISOString().slice(0, 10)
    const current = this.dailyBudgetUsed.get(today) || 0
    this.dailyBudgetUsed.set(today, current + cost)

    const month = new Date().toISOString().slice(0, 7)
    const monthlyCurrent = this.monthlyBudgetUsed.get(month) || 0
    this.monthlyBudgetUsed.set(month, monthlyCurrent + cost)

    // 检查是否需要告警
    this.checkBudgetStatus()
  }

  /**
   * 获取成本效益分析报告
   */
  async getCostEfficiencyReport(days: number = 7): Promise<{
    providers: ProviderCostEfficiency[]
    totalCost: number
    totalTokens: number
    averageCostPerToken: number
    recommendations: string[]
  }> {
    const providers = this.db.getAllProviders()
    const efficiencies = await Promise.all(
      providers.map((p: AIProvider) => this.calculateCostEfficiency(p))
    )

    const sorted = efficiencies.sort((a: ProviderCostEfficiency, b: ProviderCostEfficiency) => b.costScore - a.costScore)

    const totalCost = sorted.reduce((sum: number, e: ProviderCostEfficiency) => sum + this.getProviderTotalCost(e.providerId, days), 0)
    const totalTokens = sorted.reduce((sum: number, e: ProviderCostEfficiency) => sum + this.getProviderTotalTokens(e.providerId, days), 0)
    const averageCostPerToken = totalTokens > 0 ? totalCost / totalTokens : 0

    // 生成建议
    const recommendations = this.generateRecommendations(sorted)

    return {
      providers: sorted,
      totalCost,
      totalTokens,
      averageCostPerToken,
      recommendations,
    }
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<CostOptimizationConfig>): void {
    this.config = { ...this.config, ...updates }
    console.log('[CostOptimization] Config updated:', this.config)
  }

  /**
   * 获取当前配置
   */
  getConfig(): CostOptimizationConfig {
    return { ...this.config }
  }

  /**
   * 获取所有 Provider 的成本效率
   */
  async getAllEfficiencies(): Promise<ProviderCostEfficiency[]> {
    const providers = this.db.getAllProviders()
    const efficiencies = await Promise.all(
      providers.map((p: AIProvider) => this.calculateCostEfficiency(p))
    )
    return efficiencies.sort((a: ProviderCostEfficiency, b: ProviderCostEfficiency) => b.costScore - a.costScore)
  }

  // ==================== 私有方法 ====================

  /**
   * 计算 Provider 的成本效率
   */
  private async calculateCostEfficiency(provider: AIProvider): Promise<ProviderCostEfficiency> {
    const pricing = this.costService.getPricingForProvider(provider.id)
    
    // 获取健康状态
    const healthStatus = this.healthService.getHealthStatus(provider.id)
    const isHealthy = healthStatus?.status === 'healthy'

    // 获取历史数据（过去7天）
    const stats = await this.getProviderStats(provider.id, 7)

    // 计算 tokens per dollar
    const totalCost = stats.totalCost
    const totalTokens = stats.inputTokens + stats.outputTokens
    const tokensPerDollar = totalCost > 0 ? totalTokens / totalCost : 0

    // 计算综合评分
    const costScore = this.calculateCostScore({
      pricing,
      tokensPerDollar,
      successRate: healthStatus?.successRate || 1,
      responseTime: healthStatus?.responseTimeMs || 1000,
      isHealthy,
    })

    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId: provider.defaultModel || '',
      modelName: provider.defaultModel || '',
      inputPricePer1M: pricing?.inputPricePer1M || 0,
      outputPricePer1M: pricing?.outputPricePer1M || 0,
      averageTokensPerDollar: tokensPerDollar,
      successRate: healthStatus?.successRate || 1,
      avgResponseTimeMs: healthStatus?.responseTimeMs || 0,
      costScore,
      isHealthy,
    }
  }

  /**
   * 计算 Provider 综合评分
   */
  private calculateProviderScore(
    efficiency: ProviderCostEfficiency,
    taskProfile: TaskProfile
  ): number {
    // 基础成本评分
    const costComponent = efficiency.costScore * this.config.costWeight

    // 质量评分（基于成功率和响应时间）
    const qualityScore = (
      efficiency.successRate * 50 +
      Math.max(0, 100 - efficiency.avgResponseTimeMs / 100) * 0.5
    )
    const qualityComponent = qualityScore * this.config.qualityWeight

    // 速度评分
    const speedScore = Math.max(0, 100 - efficiency.avgResponseTimeMs / 50)
    const speedComponent = speedScore * this.config.speedWeight

    // 任务适配性调整
    let taskAdjustment = 0
    
    switch (taskProfile.taskType) {
      case 'code_generation':
        // 代码生成需要高质量模型
        if (efficiency.modelId.includes('sonnet') || efficiency.modelId.includes('gpt-4')) {
          taskAdjustment += 10
        }
        break
      case 'code_review':
        // 代码审查可以用低成本模型
        if (efficiency.inputPricePer1M < 2) {
          taskAdjustment += 15
        }
        break
      case 'debugging':
        // 调试需要快速响应
        if (efficiency.avgResponseTimeMs < 2000) {
          taskAdjustment += 10
        }
        break
      case 'architecture':
        // 架构设计需要高质量
        if (efficiency.modelId.includes('opus') || efficiency.modelId.includes('gpt-4')) {
          taskAdjustment += 15
        }
        break
      case 'documentation':
        // 文档可以用低成本模型
        if (efficiency.inputPricePer1M < 1) {
          taskAdjustment += 20
        }
        break
    }

    // 复杂度调整
    if (taskProfile.complexity === 'simple' && efficiency.inputPricePer1M > 5) {
      taskAdjustment -= 20 // 简单任务用昂贵模型扣分
    }
    if (taskProfile.complexity === 'critical' && efficiency.successRate < 0.9) {
      taskAdjustment -= 30 // 关键任务用低成功率模型扣分
    }

    return Math.max(0, Math.min(100, costComponent + qualityComponent + speedComponent + taskAdjustment))
  }

  /**
   * 计算成本评分
   */
  private calculateCostScore(params: {
    pricing?: PricingTier | null
    tokensPerDollar: number
    successRate: number
    responseTime: number
    isHealthy: boolean
  }): number {
    if (!params.isHealthy) return 0

    const { pricing, tokensPerDollar, successRate, responseTime } = params

    // 价格因素 (40%)
    const avgPrice = pricing
      ? (pricing.inputPricePer1M + pricing.outputPricePer1M) / 2
      : 10
    const priceScore = Math.max(0, 100 - (avgPrice / 20) * 100) // $20/M = 0分, $0/M = 100分

    // 效率因素 (30%)
    const efficiencyScore = Math.min(100, (tokensPerDollar / 1000000) * 100) // 1M tokens/$ = 100分

    // 可靠性因素 (20%)
    const reliabilityScore = successRate * 100

    // 响应时间因素 (10%)
    const speedScore = Math.max(0, 100 - (responseTime / 5000) * 100) // 5s = 0分, 0s = 100分

    return (
      priceScore * 0.4 +
      efficiencyScore * 0.3 +
      reliabilityScore * 0.2 +
      speedScore * 0.1
    )
  }

  /**
   * 估算任务成本
   */
  private estimateTaskCost(
    efficiency: ProviderCostEfficiency,
    taskProfile: TaskProfile
  ): number {
    const estimatedTokens = taskProfile.estimatedTokens || 1000
    
    // 根据任务类型调整输入输出比例
    let inputRatio = 0.7
    let outputRatio = 0.3

    switch (taskProfile.taskType) {
      case 'code_generation':
        inputRatio = 0.4
        outputRatio = 0.6
        break
      case 'code_review':
        inputRatio = 0.8
        outputRatio = 0.2
        break
      case 'debugging':
        inputRatio = 0.6
        outputRatio = 0.4
        break
    }

    const inputTokens = estimatedTokens * inputRatio
    const outputTokens = estimatedTokens * outputRatio

    const inputCost = (inputTokens / 1_000_000) * efficiency.inputPricePer1M
    const outputCost = (outputTokens / 1_000_000) * efficiency.outputPricePer1M

    return inputCost + outputCost
  }

  /**
   * 获取可用的 Provider 列表
   */
  private getAvailableProviders(): AIProvider[] {
    const allProviders = this.db.getAllProviders()
    return allProviders.filter((p: AIProvider) => {
      const health = this.healthService.getHealthStatus(p.id)
      return health && health.status !== 'unhealthy'
    })
  }

  /**
   * 获取默认 Provider
   */
  private getDefaultProvider(): AIProvider {
    // 优先返回 Claude Code
    const claude = this.db.getProvider('claude-code')
    if (claude) return claude

    // 否则返回第一个可用的
    const providers = this.db.getAllProviders()
    return providers[0]
  }

  /**
   * 生成推荐理由
   */
  private generateRoutingReason(
    efficiency: ProviderCostEfficiency,
    taskProfile: TaskProfile,
    costSaving: number
  ): string {
    const reasons: string[] = []

    if (costSaving > this.config.minCostSavingThreshold) {
      reasons.push(`预计节省 $${costSaving.toFixed(4)}`)
    }

    if (efficiency.costScore > 80) {
      reasons.push('成本效益优秀')
    }

    if (efficiency.successRate > 0.95) {
      reasons.push('高成功率')
    }

    if (efficiency.avgResponseTimeMs < 1500) {
      reasons.push('响应速度快')
    }

    // 任务特定理由
    switch (taskProfile.taskType) {
      case 'documentation':
        if (efficiency.inputPricePer1M < 1) {
          reasons.push('适合文档任务的低成本模型')
        }
        break
      case 'architecture':
        if (efficiency.modelId.includes('opus') || efficiency.modelId.includes('gpt-4')) {
          reasons.push('适合架构设计的高质量模型')
        }
        break
    }

    return reasons.join('，') || '综合评分最高'
  }

  /**
   * 获取 Provider 优势
   */
  private getProviderPros(
    efficiency: ProviderCostEfficiency,
    taskProfile: TaskProfile
  ): string[] {
    const pros: string[] = []

    if (efficiency.inputPricePer1M < 2) {
      pros.push('输入成本低')
    }
    if (efficiency.outputPricePer1M < 5) {
      pros.push('输出成本低')
    }
    if (efficiency.successRate > 0.9) {
      pros.push('高成功率')
    }
    if (efficiency.avgResponseTimeMs < 2000) {
      pros.push('响应快')
    }
    if (efficiency.averageTokensPerDollar > 500000) {
      pros.push('性价比高')
    }

    return pros
  }

  /**
   * 获取 Provider 劣势
   */
  private getProviderCons(
    efficiency: ProviderCostEfficiency,
    taskProfile: TaskProfile
  ): string[] {
    const cons: string[] = []

    if (efficiency.inputPricePer1M > 10) {
      cons.push('输入成本高')
    }
    if (efficiency.outputPricePer1M > 30) {
      cons.push('输出成本高')
    }
    if (efficiency.successRate < 0.8) {
      cons.push('成功率较低')
    }
    if (efficiency.avgResponseTimeMs > 3000) {
      cons.push('响应较慢')
    }

    return cons
  }

  /**
   * 生成优化建议
   */
  private generateRecommendations(efficiencies: ProviderCostEfficiency[]): string[] {
    const recommendations: string[] = []

    if (efficiencies.length === 0) return recommendations

    const cheapest = efficiencies[efficiencies.length - 1]
    const mostExpensive = efficiencies[0]

    // 建议1: 成本差异大的场景
    if (mostExpensive.inputPricePer1M > cheapest.inputPricePer1M * 5) {
      recommendations.push(
        `对于简单任务（如文档、代码审查），建议使用 ${cheapest.providerName}，成本可降低 ${(1 - cheapest.inputPricePer1M / mostExpensive.inputPricePer1M) * 100}%`
      )
    }

    // 建议2: 低使用率的 Provider
    const lowUsageProviders = efficiencies.filter(e => e.averageTokensPerDollar < 100000)
    if (lowUsageProviders.length > 0) {
      recommendations.push(
        `${lowUsageProviders.map(p => p.providerName).join('、')} 的成本效益较低，建议评估是否继续使用`
      )
    }

    // 建议3: 预算告警
    const budget = this.costService.getBudgetConfig()
    if (budget && budget.dailyLimit) {
      const today = new Date().toISOString().slice(0, 10)
      const used = this.dailyBudgetUsed.get(today) || 0
      const percent = used / budget.dailyLimit
      
      if (percent > 0.8) {
        recommendations.push(
          `今日预算已使用 ${(percent * 100).toFixed(0)}%，建议开启自动路由以优化成本`
        )
      }
    }

    // 建议4: 启用自动路由
    if (!this.config.autoRoutingEnabled) {
      recommendations.push('建议启用自动路由功能，系统将根据任务类型自动选择最优 Provider')
    }

    return recommendations
  }

  /**
   * 获取 Provider 统计数据
   */
  private async getProviderStats(providerId: string, days: number): Promise<{
    inputTokens: number
    outputTokens: number
    totalCost: number
  }> {
    try {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
      const startDateStr = startDate.toISOString().slice(0, 10)

      // 从 cost_daily_detail 表查询
      const rows = this.costService.getRawDatabase().prepare(`
        SELECT SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens
        FROM cost_daily_detail
        WHERE provider_id = ? AND date >= ?
      `).get(providerId, startDateStr) as any

      const inputTokens = rows?.inputTokens || 0
      const outputTokens = rows?.outputTokens || 0

      const pricing = this.costService.getPricingForProvider(providerId)
      const totalCost = pricing
        ? (inputTokens / 1_000_000) * pricing.inputPricePer1M +
          (outputTokens / 1_000_000) * pricing.outputPricePer1M
        : 0

      return { inputTokens, outputTokens, totalCost }
    } catch (err) {
      console.error('[CostOptimization] getProviderStats failed:', err)
      return { inputTokens: 0, outputTokens: 0, totalCost: 0 }
    }
  }

  /**
   * 获取 Provider 总成本
   */
  private getProviderTotalCost(providerId: string, days: number): number {
    const stats = this.getProviderStats(providerId, days)
    // 注意：这里是同步调用，实际应该等待异步结果
    // 为了简化，这里假设已经缓存了数据
    return 0 // TODO: 实现缓存机制
  }

  /**
   * 获取 Provider 总 Tokens
   */
  private getProviderTotalTokens(providerId: string, days: number): number {
    const stats = this.getProviderStats(providerId, days)
    return 0 // TODO: 实现缓存机制
  }

  /**
   * 格式化货币
   */
  private formatCurrency(amount: number): string {
    const budget = this.costService.getBudgetConfig()
    const currency = budget?.currency || 'USD'
    const rate = budget?.cnyRate || 1

    if (currency === 'CNY') {
      return `¥${(amount * rate).toFixed(2)}`
    }
    return `$${amount.toFixed(2)}`
  }
}
