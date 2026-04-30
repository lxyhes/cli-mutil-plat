/**
 * Provider 健康检查 IPC Handlers
 */

import { ipcMain } from 'electron'
import type { DatabaseManager } from '../storage/DatabaseManager'
import type { AdapterRegistry } from '../adapter/AdapterRegistry'
import { ProviderHealthService } from '../provider/ProviderHealthService'
import { createSuccessResponse, createErrorResponse } from './utils'
import * as IPC from '../../shared/constants'

let healthService: ProviderHealthService | null = null

export function setupProviderHealthHandlers(
  db: DatabaseManager,
  adapterRegistry: AdapterRegistry
): void {
  // 初始化健康检查服务
  healthService = new ProviderHealthService(db, adapterRegistry, {
    enabled: false, // 默认禁用，需要用户手动启用
    maxConsecutiveFailures: 3,
    minSuccessRate: 0.7,
    checkIntervalMs: 60000,
    fallbackProviderIds: [],
  })

  // 启动健康检查
  ipcMain.handle(IPC.PROVIDER_HEALTH_START, async () => {
    try {
      healthService?.start()
      return createSuccessResponse({ started: true })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.start' })
    }
  })

  // 停止健康检查
  ipcMain.handle(IPC.PROVIDER_HEALTH_STOP, async () => {
    try {
      healthService?.stop()
      return createSuccessResponse({ stopped: true })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.stop' })
    }
  })

  // 获取所有健康状态
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_ALL, async () => {
    try {
      const statuses = healthService?.getAllHealthStatuses() || []
      return createSuccessResponse({ statuses })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.getAll' })
    }
  })

  // 获取单个 Provider 健康状态
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_STATUS, async (_event, providerId: string) => {
    try {
      const status = healthService?.getHealthStatus(providerId)
      return createSuccessResponse({ status })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.getStatus' })
    }
  })

  // 获取健康 Provider 列表
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_HEALTHY, async () => {
    try {
      const providers = healthService?.getHealthyProviders() || []
      return createSuccessResponse({ providers })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.getHealthy' })
    }
  })

  // 获取推荐的最佳 Provider
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_RECOMMENDED, async (_event, preferredProviderId?: string) => {
    try {
      const provider = healthService?.getRecommendedProvider(preferredProviderId)
      return createSuccessResponse({ provider })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.getRecommended' })
    }
  })

  // 手动触发健康检查
  ipcMain.handle(IPC.PROVIDER_HEALTH_CHECK_MANUAL, async (_event, providerId: string) => {
    try {
      const result = await healthService?.triggerManualCheck(providerId)
      return createSuccessResponse({ result })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.checkManual' })
    }
  })

  // 更新配置
  ipcMain.handle(IPC.PROVIDER_HEALTH_UPDATE_CONFIG, async (_event, config: {
    enabled?: boolean
    maxConsecutiveFailures?: number
    minSuccessRate?: number
    checkIntervalMs?: number
    fallbackProviderIds?: string[]
  }) => {
    try {
      healthService?.updateConfig(config)
      return createSuccessResponse({ config: healthService?.getConfig() })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.updateConfig' })
    }
  })

  // 获取配置
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_CONFIG, async () => {
    try {
      const config = healthService?.getConfig()
      return createSuccessResponse({ config })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'providerHealth.getConfig' })
    }
  })

  console.log('[ProviderHealth] IPC handlers registered')
}

/**
 * 清理资源
 */
export function cleanupProviderHealth(): void {
  healthService?.cleanup()
  healthService = null
}
