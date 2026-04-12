/**
 * Working Context - IPC Handlers
 * @author weibin
 */

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { WorkingContextService } from '../working-context/WorkingContextService'

export function registerWorkingContextHandlers(workingContextService: WorkingContextService): void {
  ipcMain.handle(IPC.WORKING_CONTEXT_GET, (_event, sessionId: string) => {
    return { success: true, context: workingContextService.getContext(sessionId) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_UPDATE_TASK, (_event, sessionId: string, task: string) => {
    return { success: true, context: workingContextService.updateTask(sessionId, task) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_ADD_PROBLEM, (_event, sessionId: string, content: string) => {
    return { success: true, context: workingContextService.addProblem(sessionId, content) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_RESOLVE_PROBLEM, (_event, sessionId: string, problemId: string) => {
    return { success: true, context: workingContextService.resolveProblem(sessionId, problemId) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_ADD_DECISION, (_event, sessionId: string, content: string) => {
    return { success: true, context: workingContextService.addDecision(sessionId, content) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_ADD_TODO, (_event, sessionId: string, content: string) => {
    return { success: true, context: workingContextService.addTodo(sessionId, content) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_RESOLVE_TODO, (_event, sessionId: string, todoId: string) => {
    return { success: true, context: workingContextService.resolveTodo(sessionId, todoId) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_ADD_SNIPPET, (_event, sessionId: string, snippet: { filePath: string; lineRange?: string; content: string; note?: string }) => {
    return { success: true, context: workingContextService.addCodeSnippet(sessionId, snippet) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_REMOVE_ITEM, (_event, sessionId: string, category: 'problems' | 'decisions' | 'todos' | 'codeSnippets', itemId: string) => {
    return { success: true, context: workingContextService.removeItem(sessionId, category, itemId) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_CREATE_SNAPSHOT, (_event, sessionId: string, trigger?: 'manual' | 'session-switch' | 'auto-interval') => {
    return { success: true, snapshot: workingContextService.createSnapshot(sessionId, trigger) }
  })

  ipcMain.handle(IPC.WORKING_CONTEXT_GET_PROMPT, (_event, sessionId: string) => {
    return { success: true, prompt: workingContextService.generateContextPrompt(sessionId) }
  })
}
