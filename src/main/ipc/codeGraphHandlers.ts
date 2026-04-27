/**
 * Code graph IPC handlers.
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { CodeGraphService } from '../code-graph/CodeGraphService'

export function registerCodeGraphHandlers(codeGraphService: CodeGraphService): void {
  ipcMain.handle(IPC.CODE_GRAPH_INDEX_PROJECT, async (_event, projectPath: string) => {
    try {
      return createSuccessResponse(codeGraphService.indexProject(projectPath))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.index-project', projectPath })
    }
  })

  ipcMain.handle(IPC.CODE_GRAPH_GET_STATS, async (_event, projectPath: string) => {
    try {
      return createSuccessResponse(codeGraphService.getStats(projectPath))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.get-stats', projectPath })
    }
  })

  ipcMain.handle(IPC.CODE_GRAPH_GET_DEPENDENCIES, async (_event, projectPath: string, filePath: string) => {
    try {
      return createSuccessResponse(codeGraphService.getDependencies(projectPath, filePath))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.get-dependencies', projectPath, filePath })
    }
  })

  ipcMain.handle(IPC.CODE_GRAPH_GET_DEPENDENTS, async (_event, projectPath: string, filePath: string) => {
    try {
      return createSuccessResponse(codeGraphService.getDependents(projectPath, filePath))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.get-dependents', projectPath, filePath })
    }
  })

  ipcMain.handle(IPC.CODE_GRAPH_GET_BLAST_RADIUS, async (_event, projectPath: string, filePath: string, depth?: number) => {
    try {
      return createSuccessResponse(codeGraphService.getBlastRadius(projectPath, filePath, depth))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.get-blast-radius', projectPath, filePath })
    }
  })

  ipcMain.handle(IPC.CODE_GRAPH_GET_SYMBOLS, async (_event, projectPath: string, filePath: string) => {
    try {
      return createSuccessResponse(codeGraphService.getSymbols(projectPath, filePath))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.get-symbols', projectPath, filePath })
    }
  })

  ipcMain.handle(IPC.CODE_GRAPH_GET_SYMBOL_BLAST_RADIUS, async (_event, projectPath: string, filePath: string, changedSymbols?: string[], depth?: number) => {
    try {
      return createSuccessResponse(codeGraphService.getSymbolBlastRadius(projectPath, filePath, changedSymbols, depth))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.get-symbol-blast-radius', projectPath, filePath })
    }
  })

  ipcMain.handle(IPC.CODE_GRAPH_ASK, async (_event, projectPath: string, question: string, options?: any) => {
    try {
      return createSuccessResponse(codeGraphService.answerQuestion(projectPath, question, options))
    } catch (err) {
      return createErrorResponse(err, { operation: 'code-graph.ask', projectPath, question })
    }
  })
}
