/**
 * Memory Deduplication - IPC Handlers
 * 
 * 提供记忆去重和版本历史管理的 IPC 接口
 */

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { DatabaseManager } from '../storage/Database'
import { MemoryDeduplicationService } from '../memory/MemoryDeduplicationService'

let memoryDedupService: MemoryDeduplicationService | null = null

export function setupMemoryDedupHandlers(db: DatabaseManager): void {
  // 初始化服务
  memoryDedupService = new MemoryDeduplicationService(db, {
    enabled: true,
    similarityThreshold: 0.85,
    jaccardWeight: 0.4,
    tfidfWeight: 0.6,
    maxVersionsPerMemory: 10,
    autoMergeEnabled: false,
    checkIntervalMs: 3600000, // 1小时
  })

  // ==================== 相似度计算 ====================

  /**
   * 计算两个文本的相似度
   */
  ipcMain.handle(IPC.MEMORY_DEDUP_CALCULATE_SIMILARITY,
    async (_event, text1: string, text2: string) => {
      try {
        const result = memoryDedupService?.calculateSimilarity(text1, text2)
        return { success: true, result }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // ==================== 去重检测 ====================

  /**
   * 检测重复记忆
   */
  ipcMain.handle(IPC.MEMORY_DEDUP_DETECT_DUPLICATES,
    async (_event, newMemory: any, existingMemories: any[]) => {
      try {
        const candidates = memoryDedupService?.detectDuplicates(newMemory, existingMemories) || []
        return { success: true, candidates }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  /**
   * 执行全量去重检查
   */
  ipcMain.handle(IPC.MEMORY_DEDUP_PERFORM_CHECK, async () => {
    try {
      const candidates = await memoryDedupService?.performDeduplicationCheck() || []
      return { success: true, candidates }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ==================== 版本历史 ====================

  /**
   * 创建记忆版本
   */
  ipcMain.handle(IPC.MEMORY_VERSION_CREATE,
    async (_event, params: {
      memoryId: string
      content: string
      keyPoints: string
      keywords: string
      summary: string
      createdBy: string
      changeType?: string
      changeReason?: string
      metadata?: Record<string, any>
    }) => {
      try {
        const version = memoryDedupService?.createMemoryVersion(
          params.memoryId,
          params.content,
          params.keyPoints,
          params.keywords,
          params.summary,
          params.createdBy,
          params.changeType as any,
          params.changeReason,
          params.metadata
        )
        return { success: true, version }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  /**
   * 获取记忆的版本历史
   */
  ipcMain.handle(IPC.MEMORY_VERSION_GET_HISTORY,
    async (_event, memoryId: string, limit?: number) => {
      try {
        const versions = memoryDedupService?.getMemoryVersions(memoryId, limit) || []
        return { success: true, versions }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  /**
   * 获取记忆的演化分析
   */
  ipcMain.handle(IPC.MEMORY_VERSION_ANALYZE_EVOLUTION,
    async (_event, memoryId: string) => {
      try {
        const analysis = memoryDedupService?.analyzeMemoryEvolution(memoryId)
        return { success: true, analysis }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // ==================== 合并建议 ====================

  /**
   * 生成合并建议
   */
  ipcMain.handle(IPC.MEMORY_MERGE_GENERATE_SUGGESTION,
    async (_event, memoryIds: string[]) => {
      try {
        const suggestion = memoryDedupService?.generateMergeSuggestion(memoryIds)
        return { success: true, suggestion }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  /**
   * 获取待处理的合并建议
   */
  ipcMain.handle(IPC.MEMORY_MERGE_GET_PENDING,
    async (_event, limit?: number) => {
      try {
        const suggestions = memoryDedupService?.getPendingMergeSuggestions(limit) || []
        return { success: true, suggestions }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  /**
   * 接受合并建议
   */
  ipcMain.handle(IPC.MEMORY_MERGE_ACCEPT,
    async (_event, suggestionId: string) => {
      try {
        const success = memoryDedupService?.acceptMergeSuggestion(suggestionId) || false
        return { success }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  /**
   * 拒绝合并建议
   */
  ipcMain.handle(IPC.MEMORY_MERGE_REJECT,
    async (_event, suggestionId: string) => {
      try {
        const success = memoryDedupService?.rejectMergeSuggestion(suggestionId) || false
        return { success }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // ==================== 配置管理 ====================

  /**
   * 更新配置
   */
  ipcMain.handle(IPC.MEMORY_DEDUP_UPDATE_CONFIG,
    async (_event, updates: any) => {
      try {
        memoryDedupService?.updateConfig(updates)
        const config = memoryDedupService?.getConfig()
        return { success: true, config }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  /**
   * 获取配置
   */
  ipcMain.handle(IPC.MEMORY_DEDUP_GET_CONFIG, async () => {
    try {
      const config = memoryDedupService?.getConfig()
      return { success: true, config }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ==================== 统计信息 ====================

  /**
   * 获取统计信息
   */
  ipcMain.handle(IPC.MEMORY_DEDUP_GET_STATS, async () => {
    try {
      const stats = memoryDedupService?.getStats()
      return { success: true, stats }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}

/**
 * 获取服务实例（用于事件监听）
 */
export function getMemoryDedupService(): MemoryDeduplicationService | null {
  return memoryDedupService
}
