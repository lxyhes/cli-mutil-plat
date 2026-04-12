/**
 * Cross-Session Memory - IPC Handlers
 * @author weibin
 */

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { CrossSessionMemoryService } from '../cross-session-memory/CrossSessionMemoryService'

export function registerCrossMemoryHandlers(crossMemoryService: CrossSessionMemoryService): void {
  ipcMain.handle(IPC.CROSS_MEMORY_SEARCH, (_event, query: string, limit?: number) => {
    return { success: true, result: crossMemoryService.search(query, limit) }
  })

  ipcMain.handle(IPC.CROSS_MEMORY_LIST, (_event, limit?: number) => {
    return { success: true, entries: crossMemoryService.listAll(limit) }
  })

  ipcMain.handle(IPC.CROSS_MEMORY_INDEX, (_event, sessionId: string, sessionName: string, summary: string, keyPoints: string) => {
    const entry = crossMemoryService.indexSummary(sessionId, sessionName, summary, keyPoints)
    return { success: true, entry }
  })

  ipcMain.handle(IPC.CROSS_MEMORY_DELETE, (_event, id: string) => {
    return { success: crossMemoryService.deleteEntry(id) }
  })

  ipcMain.handle(IPC.CROSS_MEMORY_GET_PROMPT, (_event, sessionGoal: string) => {
    return { success: true, prompt: crossMemoryService.generateInjectionPrompt(sessionGoal) }
  })

  ipcMain.handle(IPC.CROSS_MEMORY_GET_STATS, () => {
    return { success: true, stats: crossMemoryService.getStats() }
  })

  ipcMain.handle(IPC.CROSS_MEMORY_UPDATE_CONFIG, (_event, updates: any) => {
    crossMemoryService.updateConfig(updates)
    return { success: true, config: crossMemoryService.getConfig() }
  })
}
