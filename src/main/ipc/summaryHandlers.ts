/**
 * Summary IPC Handlers - 会话摘要的 IPC 接口
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { SummaryService } from '../summary/SummaryService'

export function registerSummaryHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const summaryService: SummaryService | undefined = (deps as any).summaryService

  // GENERATE - 生成摘要
  ipcMain.handle(IPC.SUMMARY_GENERATE, async (_event, sessionId: string, options?: {
    type?: 'auto' | 'manual' | 'key_points'
    includeKeyPoints?: boolean
    providerId?: string
    model?: string
    maxInputTokens?: number
  }) => {
    try {
      if (!summaryService) {
        return createErrorResponse(new Error('SummaryService not initialized'), { operation: 'summary.generate' })
      }
      const result = await summaryService.generateSummary(sessionId, options)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.generate' })
    }
  })

  // GET - 获取单个摘要
  ipcMain.handle(IPC.SUMMARY_GET, async (_event, id: number) => {
    try {
      const summary = database.getSummary(id)
      return createSuccessResponse(summary)
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.get' })
    }
  })

  // LIST - 获取会话的摘要列表
  ipcMain.handle(IPC.SUMMARY_LIST, async (_event, sessionId: string, limit?: number) => {
    try {
      const summaries = database.listSummaries(sessionId, limit)
      return createSuccessResponse(summaries)
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.list' })
    }
  })

  // LIST_ALL - 获取所有会话的最新摘要
  ipcMain.handle(IPC.SUMMARY_LIST_ALL, async (_event, limit?: number) => {
    try {
      const summaries = database.listAllLatestSummaries(limit)
      return createSuccessResponse(summaries)
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.list-all' })
    }
  })

  // UPDATE - 更新摘要
  ipcMain.handle(IPC.SUMMARY_UPDATE, async (_event, id: number, updates: {
    summary?: string
    keyPoints?: string
    qualityScore?: number
    summaryType?: 'auto' | 'manual' | 'key_points'
  }) => {
    try {
      const success = database.updateSummary(id, updates)
      if (!success) {
        return createErrorResponse(new Error('Summary not found or update failed'), { operation: 'summary.update' })
      }
      return createSuccessResponse({ id })
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.update' })
    }
  })

  // DELETE - 删除摘要
  ipcMain.handle(IPC.SUMMARY_DELETE, async (_event, id: number) => {
    try {
      const success = database.deleteSummary(id)
      if (!success) {
        return createErrorResponse(new Error('Summary not found or delete failed'), { operation: 'summary.delete' })
      }
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.delete' })
    }
  })

  // GET_LATEST - 获取会话最新摘要（兼容旧接口）
  ipcMain.handle('summary:get-latest', async (_event, sessionId: string) => {
    try {
      const summary = database.getSessionLatestSummary(sessionId)
      return createSuccessResponse(summary)
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.get-latest' })
    }
  })

  // GET_ALL_SESSIONS - 获取所有会话摘要（兼容旧接口）
  ipcMain.handle('summary:get-all-sessions', async (_event, limit?: number) => {
    try {
      const summaries = database.listAllLatestSummaries(limit)
      return createSuccessResponse(summaries)
    } catch (err) {
      return createErrorResponse(err, { operation: 'summary.get-all-sessions' })
    }
  })
}
