/**
 * Evaluation IPC Handlers - 任务评估的 IPC 接口
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { EvaluationService } from '../evaluation/EvaluationService'

export function registerEvaluationHandlers(deps: IpcDependencies): void {
  const evaluationService: EvaluationService | undefined = (deps as any).evaluationService

  // ── 模板 CRUD ──────────────────────────────────────────────

  // CREATE 模板
  ipcMain.handle(IPC.EVAL_CREATE_TEMPLATE, async (_event, data: {
    name: string
    description?: string
    criteria: { name: string; description: string; max_score: number; weight: number }[]
    promptTemplate: string
    createdBy?: string
  }) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.create-template' })
      }
      const template = evaluationService.createTemplate(data as any)
      return createSuccessResponse({ template })
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.create-template' })
    }
  })

  // LIST 模板
  ipcMain.handle(IPC.EVAL_LIST_TEMPLATES, async () => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.list-templates' })
      }
      const templates = evaluationService.listTemplates()
      return createSuccessResponse({ templates })
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.list-templates' })
    }
  })

  // GET 模板
  ipcMain.handle(IPC.EVAL_GET_TEMPLATE, async (_event, templateId: string) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.get-template' })
      }
      const template = evaluationService.getTemplate(templateId)
      if (!template) return createErrorResponse(new Error('Template not found'), { operation: 'eval.get-template' })
      return createSuccessResponse({ template })
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.get-template' })
    }
  })

  // UPDATE 模板
  ipcMain.handle(IPC.EVAL_UPDATE_TEMPLATE, async (_event, templateId: string, updates: {
    name?: string
    description?: string
    criteria?: { name: string; description: string; max_score: number; weight: number }[]
    promptTemplate?: string
  }) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.update-template' })
      }
      evaluationService.updateTemplate(templateId, updates as any)
      return createSuccessResponse({ templateId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.update-template' })
    }
  })

  // DELETE 模板
  ipcMain.handle(IPC.EVAL_DELETE_TEMPLATE, async (_event, templateId: string) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.delete-template' })
      }
      evaluationService.deleteTemplate(templateId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.delete-template' })
    }
  })

  // ── 评估运行 ────────────────────────────────────────────────

  // START 评估
  ipcMain.handle(IPC.EVAL_RUN_START, async (_event, sessionId: string, templateId: string) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.run-start' })
      }
      const result = await evaluationService.evaluate(sessionId, templateId)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.run-start' })
    }
  })

  // LIST 运行
  ipcMain.handle(IPC.EVAL_LIST_RUNS, async (_event, limit?: number) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.list-runs' })
      }
      const runs = evaluationService.listRuns(limit)
      return createSuccessResponse({ runs })
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.list-runs' })
    }
  })

  // GET 运行
  ipcMain.handle(IPC.EVAL_GET_RUN, async (_event, runId: string) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.get-run' })
      }
      const run = evaluationService.getRun(runId)
      if (!run) return createErrorResponse(new Error('Run not found'), { operation: 'eval.get-run' })
      return createSuccessResponse({ run })
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.get-run' })
    }
  })

  // GET 结果
  ipcMain.handle(IPC.EVAL_GET_RESULTS, async (_event, runId: string) => {
    try {
      if (!evaluationService) {
        return createErrorResponse(new Error('EvaluationService not initialized'), { operation: 'eval.get-results' })
      }
      const results = evaluationService.getResults(runId)
      return createSuccessResponse({ results })
    } catch (err) {
      return createErrorResponse(err, { operation: 'eval.get-results' })
    }
  })
}
