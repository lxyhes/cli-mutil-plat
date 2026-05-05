/**
 * Provider 健康检查 IPC Handlers
 */

import { ipcMain } from 'electron'
import type { DatabaseManager } from '../storage/Database'
import type { AdapterRegistry } from '../adapter/AdapterRegistry'
import { ProviderHealthService } from '../provider/ProviderHealthService'
import { IPC } from '../../shared/constants'

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
      return { success: true, started: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 停止健康检查
  ipcMain.handle(IPC.PROVIDER_HEALTH_STOP, async () => {
    try {
      healthService?.stop()
      return { success: true, stopped: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有健康状态
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_ALL, async () => {
    try {
      const statuses = healthService?.getAllHealthStatuses() || []
      return { success: true, statuses }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取单个 Provider 健康状态
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_STATUS, async (_event, providerId: string) => {
    try {
      const status = healthService?.getHealthStatus(providerId)
      return { success: true, status }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取健康 Provider 列表
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_HEALTHY, async () => {
    try {
      const providers = healthService?.getHealthyProviders() || []
      return { success: true, providers }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取推荐的最佳 Provider
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_RECOMMENDED, async (_event, preferredProviderId?: string) => {
    try {
      const provider = healthService?.getRecommendedProvider(preferredProviderId)
      return { success: true, provider }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 手动触发健康检查
  ipcMain.handle(IPC.PROVIDER_HEALTH_CHECK_MANUAL, async (_event, providerId: string) => {
    try {
      const result = await healthService?.triggerManualCheck(providerId)
      return { success: true, result }
    } catch (error: any) {
      return { success: false, error: error.message }
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
      return { success: true, config: healthService?.getConfig() }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取配置
  ipcMain.handle(IPC.PROVIDER_HEALTH_GET_CONFIG, async () => {
    try {
      const config = healthService?.getConfig()
      return { success: true, config }
    } catch (error: any) {
      return { success: false, error: error.message }
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
