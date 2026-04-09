/**
 * 多维度专家分析 - IPC Handlers
 * 
 * 提供分析相关的 IPC 接口
 * 
 * @author weibin
 */

import { ipcMain } from 'electron'
import { analyzerOrchestrator } from '../analyzer/AnalyzerOrchestrator'
import type { AnalysisRequestConfig, MultiDimensionalAnalysisReport } from '../analyzer/types'
import { IPC } from '../../shared/constants'

export interface IpcDependencies {
  // 后续可扩展
}

export function registerAnalyzerHandlers(_deps: IpcDependencies): void {
  /**
   * 启动多维度分析
   * POST → { workDir, sessionId, experts? }
   * RES → { reportId }
   */
  ipcMain.handle(IPC.ANALYZER_START, async (_event, config: AnalysisRequestConfig) => {
    try {
      const reportId = await analyzerOrchestrator.startAnalysis(config)
      return { success: true, reportId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 获取分析报告
   * POST → { reportId }
   * RES → { report }
   */
  ipcMain.handle(IPC.ANALYZER_GET_REPORT, async (_event, reportId: string) => {
    const report = analyzerOrchestrator.getReport(reportId)
    return { success: true, report }
  })

  /**
   * 获取所有分析报告
   * RES → { reports }
   */
  ipcMain.handle(IPC.ANALYZER_GET_ALL_REPORTS, async () => {
    const reports = analyzerOrchestrator.getAllReports()
    return { success: true, reports }
  })

  /**
   * 订阅分析事件（进度推送）
   */
  // 注意：事件推送通过 WebSocket 或 IPC send 实现，此处暂不实现
}
