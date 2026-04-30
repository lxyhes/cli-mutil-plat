/**
 * Provider 健康检查服务
 * 
 * 功能:
 * 1. 定期检查各 Provider 的可用性
 * 2. 记录健康状态历史
 * 3. 自动切换到备用 Provider
 * 4. 提供健康状态查询 API
 */

import { EventEmitter } from 'events'
import type { AIProvider } from '../../shared/types'
import type { DatabaseManager } from '../storage/DatabaseManager'
import type { AdapterRegistry } from '../adapter/AdapterRegistry'

export interface ProviderHealthStatus {
  providerId: string
  providerName: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  lastCheckedAt: string
  responseTimeMs?: number
  errorMessage?: string
  consecutiveFailures: number
  successRate: number // 最近10次检查的成功率
}

export interface HealthCheckResult {
  providerId: string
  isHealthy: boolean
  responseTimeMs: number
  error?: string
}

export interface AutoSwitchConfig {
  enabled: boolean
  maxConsecutiveFailures: number
  minSuccessRate: number
  checkIntervalMs: number
  fallbackProviderIds: string[] // 备用 Provider 列表（按优先级排序）
}

export class ProviderHealthService extends EventEmitter {
  private db: DatabaseManager
  private adapterRegistry: AdapterRegistry
  private healthStatuses: Map<string, ProviderHealthStatus> = new Map()
  private healthHistory: Map<string, HealthCheckResult[]> = new Map()
  private checkTimers: Map<string, NodeJS.Timeout> = new Map()
  private config: AutoSwitchConfig

  constructor(
    db: DatabaseManager,
    adapterRegistry: AdapterRegistry,
    config?: Partial<AutoSwitchConfig>
  ) {
    super()
    this.db = db
    this.adapterRegistry = adapterRegistry
    this.config = {
      enabled: config?.enabled ?? false,
      maxConsecutiveFailures: config?.maxConsecutiveFailures ?? 3,
      minSuccessRate: config?.minSuccessRate ?? 0.7,
      checkIntervalMs: config?.checkIntervalMs ?? 60000, // 默认1分钟
      fallbackProviderIds: config?.fallbackProviderIds ?? [],
    }
  }

  /**
   * 启动健康检查
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('[ProviderHealth] Health check is disabled')
      return
    }

    const providers = this.db.getAllProviders()
    providers.forEach(provider => {
      this.startHealthCheck(provider)
    })

    console.log(`[ProviderHealth] Started health checks for ${providers.length} providers`)
  }

  /**
   * 停止健康检查
   */
  stop(): void {
    this.checkTimers.forEach((timer) => clearTimeout(timer))
    this.checkTimers.clear()
    console.log('[ProviderHealth] Stopped all health checks')
  }

  /**
   * 为单个 Provider 启动定期检查
   */
  private startHealthCheck(provider: AIProvider): void {
    const providerId = provider.id

    // 立即执行一次检查
    this.checkProviderHealth(provider).catch(err => {
      console.error(`[ProviderHealth] Initial check failed for ${providerId}:`, err)
    })

    // 设置定期检查
    const timer = setInterval(() => {
      this.checkProviderHealth(provider).catch(err => {
        console.error(`[ProviderHealth] Periodic check failed for ${providerId}:`, err)
      })
    }, this.config.checkIntervalMs)

    this.checkTimers.set(providerId, timer)
  }

  /**
   * 检查单个 Provider 的健康状态
   */
  async checkProviderHealth(provider: AIProvider): Promise<HealthCheckResult> {
    const providerId = provider.id
    const startTime = Date.now()

    try {
      // 尝试获取 Adapter
      const adapter = this.adapterRegistry.get(providerId)
      
      // 简单的健康检查：检查 Adapter 是否可用
      // 对于 CLI-based providers，可以尝试运行 --version 命令
      let isHealthy = false
      let responseTimeMs = 0

      if (adapter && typeof adapter.isReady === 'function') {
        isHealthy = await adapter.isReady()
      } else {
        // Fallback: 检查是否有基本的配置
        isHealthy = !!provider.command || !!provider.apiKey
      }

      responseTimeMs = Date.now() - startTime

      const result: HealthCheckResult = {
        providerId,
        isHealthy,
        responseTimeMs,
      }

      // 更新健康状态
      this.updateHealthStatus(provider, result)

      // 发射事件
      this.emit('health-check', result)

      return result
    } catch (error: any) {
      const responseTimeMs = Date.now() - startTime
      const result: HealthCheckResult = {
        providerId,
        isHealthy: false,
        responseTimeMs,
        error: error.message,
      }

      this.updateHealthStatus(provider, result)
      this.emit('health-check', result)

      return result
    }
  }

  /**
   * 更新健康状态记录
   */
  private updateHealthStatus(provider: AIProvider, result: HealthCheckResult): void {
    const providerId = provider.id
    const previousStatus = this.healthStatuses.get(providerId)

    // 更新历史记录
    const history = this.healthHistory.get(providerId) || []
    history.push(result)
    // 保留最近100次记录
    if (history.length > 100) {
      history.shift()
    }
    this.healthHistory.set(providerId, history)

    // 计算成功率（最近10次）
    const recentHistory = history.slice(-10)
    const successCount = recentHistory.filter(h => h.isHealthy).length
    const successRate = recentHistory.length > 0 ? successCount / recentHistory.length : 1

    // 确定连续失败次数
    let consecutiveFailures = 0
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].isHealthy) break
      consecutiveFailures++
    }

    // 确定整体状态
    let status: ProviderHealthStatus['status'] = 'unknown'
    if (consecutiveFailures >= this.config.maxConsecutiveFailures) {
      status = 'unhealthy'
    } else if (successRate < this.config.minSuccessRate) {
      status = 'degraded'
    } else if (result.isHealthy) {
      status = 'healthy'
    } else {
      status = 'degraded'
    }

    const healthStatus: ProviderHealthStatus = {
      providerId,
      providerName: provider.name,
      status,
      lastCheckedAt: new Date().toISOString(),
      responseTimeMs: result.responseTimeMs,
      errorMessage: result.error,
      consecutiveFailures,
      successRate,
    }

    this.healthStatuses.set(providerId, healthStatus)

    // 如果状态变为 unhealthy，触发自动切换
    if (status === 'unhealthy' && previousStatus?.status !== 'unhealthy') {
      this.handleProviderFailure(providerId)
    }

    // 发射状态变更事件
    this.emit('status-change', healthStatus)
  }

  /**
   * 处理 Provider 失败，尝试自动切换
   */
  private handleProviderFailure(failedProviderId: string): void {
    console.warn(`[ProviderHealth] Provider ${failedProviderId} is unhealthy, attempting auto-switch`)

    if (this.config.fallbackProviderIds.length === 0) {
      console.log('[ProviderHealth] No fallback providers configured')
      return
    }

    // 查找第一个健康的备用 Provider
    for (const fallbackId of this.config.fallbackProviderIds) {
      const fallbackStatus = this.healthStatuses.get(fallbackId)
      if (fallbackStatus && fallbackStatus.status === 'healthy') {
        console.log(`[ProviderHealth] Switching to fallback provider: ${fallbackId}`)
        this.emit('auto-switch', {
          from: failedProviderId,
          to: fallbackId,
          reason: `Provider ${failedProviderId} became unhealthy`,
        })
        return
      }
    }

    console.warn('[ProviderHealth] No healthy fallback providers available')
  }

  /**
   * 获取所有 Provider 的健康状态
   */
  getAllHealthStatuses(): ProviderHealthStatus[] {
    return [...this.healthStatuses.values()]
  }

  /**
   * 获取单个 Provider 的健康状态
   */
  getHealthStatus(providerId: string): ProviderHealthStatus | undefined {
    return this.healthStatuses.get(providerId)
  }

  /**
   * 获取健康的 Provider 列表
   */
  getHealthyProviders(): AIProvider[] {
    const healthyProviderIds = new Set(
      [...this.healthStatuses.entries()]
        .filter(([_, status]) => status.status === 'healthy')
        .map(([id]) => id)
    )

    return this.db.getAllProviders().filter(p => healthyProviderIds.has(p.id))
  }

  /**
   * 获取推荐的最佳 Provider
   * 基于健康状态和响应时间
   */
  getRecommendedProvider(preferredProviderId?: string): AIProvider | null {
    // 如果首选 Provider 健康，优先使用
    if (preferredProviderId) {
      const status = this.healthStatuses.get(preferredProviderId)
      if (status && status.status === 'healthy') {
        return this.db.getProvider(preferredProviderId) || null
      }
    }

    // 否则返回最快的健康 Provider
    const healthyProviders = this.getHealthyProviders()
    if (healthyProviders.length === 0) {
      return null
    }

    // 按响应时间排序
    return healthyProviders.sort((a, b) => {
      const statusA = this.healthStatuses.get(a.id)
      const statusB = this.healthStatuses.get(b.id)
      return (statusA?.responseTimeMs || Infinity) - (statusB?.responseTimeMs || Infinity)
    })[0]
  }

  /**
   * 手动触发一次健康检查
   */
  async triggerManualCheck(providerId: string): Promise<HealthCheckResult> {
    const provider = this.db.getProvider(providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    return this.checkProviderHealth(provider)
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<AutoSwitchConfig>): void {
    this.config = { ...this.config, ...newConfig }
    
    // 如果启用了健康检查，重新启动
    if (this.config.enabled && this.checkTimers.size === 0) {
      this.start()
    } else if (!this.config.enabled) {
      this.stop()
    }
  }

  /**
   * 获取配置
   */
  getConfig(): AutoSwitchConfig {
    return { ...this.config }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.stop()
    this.healthStatuses.clear()
    this.healthHistory.clear()
  }
}
