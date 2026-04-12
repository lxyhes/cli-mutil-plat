/**
 * Code Context Injection - IPC Handlers
 * @author weibin
 */

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { CodeContextInjectionService } from '../code-context/CodeContextInjectionService'

export function registerCodeContextHandlers(codeContextService: CodeContextInjectionService): void {
  ipcMain.handle(IPC.CODE_CONTEXT_INJECT, (_event, request: {
    sessionId: string
    mode: 'review' | 'optimize' | 'explain' | 'refactor' | 'test' | 'fix' | 'custom'
    filePath: string
    selectedCode: string
    lineRange?: { start: number; end: number }
    surroundingContext?: string
    customPrompt?: string
    language?: string
  }) => {
    try {
      const response = codeContextService.generatePrompt(request)
      return { success: true, response }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.CODE_CONTEXT_GET_MODES, () => {
    return { success: true, modes: codeContextService.getModes() }
  })
}
