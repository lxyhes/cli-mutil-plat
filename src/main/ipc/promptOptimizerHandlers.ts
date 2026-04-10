/**
 * Prompt Optimizer IPC Handlers
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { PromptOptimizerService } from '../prompt-optimizer/PromptOptimizerService'

export function registerPromptOptimizerHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const service: PromptOptimizerService | undefined = (deps as any).promptOptimizerService

  // Template CRUD
  ipcMain.handle(IPC.PROMPT_TEMPLATE_CREATE, async (_event, data: any) => {
    try {
      const template = service
        ? service.createTemplate(data)
        : null
      if (!template) return createErrorResponse(new Error('Failed to create template'), { operation: 'prompt-template.create' })
      return createSuccessResponse({ template })
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-template.create' })
    }
  })

  ipcMain.handle(IPC.PROMPT_TEMPLATE_LIST, async (_event, category?: string) => {
    try {
      const templates = service ? service.listTemplates(category) : []
      return templates
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-template.list' })
    }
  })

  ipcMain.handle(IPC.PROMPT_TEMPLATE_GET, async (_event, id: string) => {
    try {
      return service?.getTemplate(id) || null
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-template.get' })
    }
  })

  ipcMain.handle(IPC.PROMPT_TEMPLATE_UPDATE, async (_event, id: string, updates: any) => {
    try {
      const template = service?.updateTemplate(id, updates)
      return createSuccessResponse({ template })
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-template.update' })
    }
  })

  ipcMain.handle(IPC.PROMPT_TEMPLATE_DELETE, async (_event, id: string) => {
    try {
      service?.deleteTemplate(id)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-template.delete' })
    }
  })

  // Version management
  ipcMain.handle(IPC.PROMPT_VERSION_CREATE, async (_event, data: any) => {
    try {
      const version = service?.createVersion(data)
      return createSuccessResponse({ version })
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-version.create' })
    }
  })

  ipcMain.handle(IPC.PROMPT_VERSION_LIST, async (_event, templateId: string) => {
    try {
      return service?.listVersions(templateId) || []
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-version.list' })
    }
  })

  ipcMain.handle(IPC.PROMPT_VERSION_UPDATE, async (_event, id: string, updates: any) => {
    try {
      service?.updateVersion(id, updates)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-version.update' })
    }
  })

  ipcMain.handle(IPC.PROMPT_VERSION_SET_BASELINE, async (_event, versionId: string) => {
    try {
      service?.setBaseline(versionId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-version.set-baseline' })
    }
  })

  // Testing
  ipcMain.handle(IPC.PROMPT_RUN_TEST, async (_event, versionId: string, testInput: string, providerId?: string) => {
    try {
      if (!service) return createErrorResponse(new Error('Service not initialized'), { operation: 'prompt.run-test' })
      const result = await service.runTest(versionId, testInput, providerId)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt.run-test' })
    }
  })

  ipcMain.handle(IPC.PROMPT_COMPARE, async (_event, versionId1: string, versionId2: string, testInput: string) => {
    try {
      if (!service) return createErrorResponse(new Error('Service not initialized'), { operation: 'prompt.compare' })
      const result = await service.compareVersions(versionId1, versionId2, testInput)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt.compare' })
    }
  })

  ipcMain.handle(IPC.PROMPT_TEST_LIST, async (_event, versionId: string, limit?: number) => {
    try {
      return service?.listTests(versionId, limit) || []
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-test.list' })
    }
  })

  ipcMain.handle(IPC.PROMPT_TEST_GET_STATS, async (_event, versionId: string) => {
    try {
      return service?.getTestStats(versionId) || { avgScore: 0, avgTokens: 0, avgDuration: 0, count: 0 }
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt-test.get-stats' })
    }
  })

  // Optimization (Advanced)
  ipcMain.handle(IPC.PROMPT_OPTIMIZE_AUTO, async (_event, templateId: string, targetVersionId: string) => {
    try {
      if (!service) return createErrorResponse(new Error('Service not initialized'), { operation: 'prompt.optimize-auto' })
      const run = await service.optimizeAuto(templateId, targetVersionId)
      return createSuccessResponse({ run })
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt.optimize-auto' })
    }
  })

  ipcMain.handle(IPC.PROMPT_OPTIMIZE_HINTS, async (_event, templateId: string, targetVersionId: string, hints: string) => {
    try {
      if (!service) return createErrorResponse(new Error('Service not initialized'), { operation: 'prompt.optimize-hints' })
      const run = await service.optimizeWithHints(templateId, targetVersionId, hints)
      return createSuccessResponse({ run })
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt.optimize-hints' })
    }
  })

  ipcMain.handle(IPC.PROMPT_OPTIMIZATION_GET_RUN, async (_event, runId: string) => {
    try {
      return service?.getOptimizationRun(runId) || null
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt:optimization:get-run' })
    }
  })

  ipcMain.handle(IPC.PROMPT_OPTIMIZATION_LIST_RUNS, async (_event, templateId?: string, limit?: number) => {
    try {
      return service?.listOptimizationRuns(templateId, limit) || []
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt:optimization:list-runs' })
    }
  })

  ipcMain.handle(IPC.PROMPT_OPTIMIZATION_GET_FEEDBACK, async (_event, runId: string) => {
    try {
      return service?.listFeedback(runId) || []
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt:optimization:get-feedback' })
    }
  })

  ipcMain.handle(IPC.PROMPT_GET_BEST_VERSION, async (_event, templateId: string) => {
    try {
      return service?.getBestVersion(templateId) || null
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt.get-best-version' })
    }
  })

  ipcMain.handle(IPC.PROMPT_PROMOTE_BEST, async (_event, templateId: string) => {
    try {
      const version = service?.promoteBestVersion(templateId)
      return createSuccessResponse({ version })
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt.promote-best' })
    }
  })

  ipcMain.handle(IPC.PROMPT_GET_EVOLUTION, async (_event, templateId: string) => {
    try {
      return service?.getEvolutionHistory(templateId) || { versions: [], optimizationRuns: [] }
    } catch (err) {
      return createErrorResponse(err, { operation: 'prompt.get-evolution' })
    }
  })
}
