/**
 * Planner IPC Handlers - 自主规划引擎的 IPC 接口
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { PlannerService } from '../planner/PlannerService'
import type { PlanStatus, StepStatus } from '../storage/repositories/PlannerRepository'

export function registerPlannerHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const plannerService: PlannerService | undefined = (deps as any).plannerService

  // LIST 所有规划
  ipcMain.handle(IPC.PLAN_LIST, async () => {
    return database.getAllPlanSessions()
  })

  // GET 单个规划
  ipcMain.handle(IPC.PLAN_GET, async (_event, planId: string) => {
    const plan = database.getPlanSession(planId)
    if (!plan) return null
    const tasks = database.getPlanTasks(planId)
    return { ...plan, tasks }
  })

  // CREATE 规划（AI 分解目标）
  ipcMain.handle(IPC.PLAN_CREATE, async (_event, data: {
    sessionId: string
    goal: string
    workingDirectory?: string
    providerId?: string
  }) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.create' })
      }
      const result = await plannerService.createPlan(data as any)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.create' })
    }
  })

  // UPDATE 规划
  ipcMain.handle(IPC.PLAN_UPDATE, async (_event, planId: string, updates: {
    goal?: string
    status?: PlanStatus
  }) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.update' })
      }
      plannerService.updatePlan(planId, updates)
      return createSuccessResponse({ planId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.update' })
    }
  })

  // DELETE 规划
  ipcMain.handle(IPC.PLAN_DELETE, async (_event, planId: string) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.delete' })
      }
      plannerService.deletePlan(planId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.delete' })
    }
  })

  // START 执行规划
  ipcMain.handle(IPC.PLAN_START, async (_event, planId: string, sessionId: string) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.start' })
      }
      await plannerService.startPlan(planId, sessionId)
      return createSuccessResponse({ planId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.start' })
    }
  })

  // GET 任务列表
  ipcMain.handle('plan:get-tasks', async (_event, planId: string) => {
    return database.getPlanTasks(planId)
  })

  // GET 步骤列表
  ipcMain.handle(IPC.PLAN_GET_STEPS, async (_event, taskId: string) => {
    return database.getPlanSteps(taskId)
  })

  // EXECUTE STEP
  ipcMain.handle(IPC.PLAN_STEP_EXECUTE, async (_event, stepId: string, sessionId: string, providerId?: string) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.execute-step' })
      }
      const result = await plannerService.executeStep(stepId, sessionId, providerId)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.execute-step' })
    }
  })

  // UPDATE 步骤
  ipcMain.handle(IPC.PLAN_STEP_UPDATE, async (_event, stepId: string, updates: {
    status?: StepStatus
    result?: string
  }) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.update-step' })
      }
      plannerService.updateStep(stepId, updates)
      return createSuccessResponse({ stepId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.update-step' })
    }
  })

  // SKIP TASK
  ipcMain.handle('plan:skip-task', async (_event, taskId: string) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.skip-task' })
      }
      plannerService.skipTask(taskId)
      return createSuccessResponse({ taskId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.skip-task' })
    }
  })

  // SKIP STEP
  ipcMain.handle('plan:skip-step', async (_event, stepId: string) => {
    try {
      if (!plannerService) {
        return createErrorResponse(new Error('PlannerService not initialized'), { operation: 'planner.skip-step' })
      }
      plannerService.skipStep(stepId)
      return createSuccessResponse({ stepId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'planner.skip-step' })
    }
  })

  // GET STATUS
  ipcMain.handle(IPC.PLAN_STATUS, async () => {
    if (!plannerService) return { status: 'idle' }
    return { status: plannerService.getStatus() }
  })
}
