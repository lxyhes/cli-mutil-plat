/**
 * 成本优化路由 IPC Handlers
 */

import { ipcMain } from 'electron'
import type { DatabaseManager } from '../storage/Database'
import type { CostService } from '../cost/CostService'
import type { ProviderHealthService } from '../provider/ProviderHealthService'
import { CostOptimizationService } from '../cost/CostOptimizationService'
import { IPC } from '../../shared/constants'

let costOptimizationService: CostOptimizationService | undefined = undefined

export function setupCostOptimizationHandlers(
  db: DatabaseManager,
  costService: CostService,
  healthService: ProviderHealthService
): void {
  // 初始化服务
  costOptimizationService = new CostOptimizationService(db, costService, healthService, {
    enabled: true,
    autoRoutingEnabled: false,
    budgetAlertThresholds: {
      warning: 0.7,
      danger: 0.85,
      critical: 0.95,
    },
    minCostSavingThreshold: 0.01,
    qualityWeight: 0.4,
    costWeight: 0.4,
    speedWeight: 0.2,
    fallbackStrategy: 'balanced',
  })

  // 智能选择 Provider
  ipcMain.handle(IPC.COST_OPT_SELECT_PROVIDER,
    async (_event, taskProfile: any, preferredProviderId?: string) => {
      try {
        const decision = await costOptimizationService?.selectOptimalProvider(taskProfile, preferredProviderId)
        
        return {
          success: true,
          decision: decision ? {
            ...decision,
            selectedProvider: {
              id: decision.selectedProvider.id,
              name: decision.selectedProvider.name,
              adapterType: decision.selectedProvider.adapterType,
              defaultModel: decision.selectedProvider.defaultModel,
            },
            alternatives: decision.alternatives.map(alt => ({
              provider: {
                id: alt.provider.id,
                name: alt.provider.name,
                adapterType: alt.provider.adapterType,
                defaultModel: alt.provider.defaultModel,
              },
              estimatedCost: alt.estimatedCost,
              pros: alt.pros,
              cons: alt.cons,
            })),
          } : null,
        }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // 检查预算状态
  ipcMain.handle(IPC.COST_OPT_CHECK_BUDGET, async () => {
    try {
      const alert = costOptimizationService?.checkBudgetStatus()
      return { success: true, alert }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 记录成本使用
  ipcMain.handle(IPC.COST_OPT_RECORD_USAGE,
    async (_event, cost: number) => {
      try {
        costOptimizationService?.recordCostUsage(cost)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // 获取成本效益报告
  ipcMain.handle(IPC.COST_OPT_GET_REPORT,
    async (_event, days?: number) => {
      try {
        const report = await costOptimizationService?.getCostEfficiencyReport(days || 7)
        return { success: true, report }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // 获取所有 Provider 效率
  ipcMain.handle(IPC.COST_OPT_GET_EFFICIENCIES, async () => {
    try {
      const efficiencies = await costOptimizationService?.getAllEfficiencies()
      return { success: true, efficiencies }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 更新配置
  ipcMain.handle(IPC.COST_OPT_UPDATE_CONFIG,
    async (_event, updates: any) => {
      try {
        costOptimizationService?.updateConfig(updates)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // 获取配置
  ipcMain.handle(IPC.COST_OPT_GET_CONFIG, async () => {
    try {
      const config = costOptimizationService?.getConfig()
      return { success: true, config }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}

export function getCostOptimizationService(): CostOptimizationService | undefined {
  return costOptimizationService
}
