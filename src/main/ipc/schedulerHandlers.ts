/**
 * Scheduler IPC Handlers - 定时任务调度的 IPC 接口
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { SchedulerService } from '../scheduler/SchedulerService'

export function registerSchedulerHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const schedulerService: SchedulerService | undefined = (deps as any).schedulerService

  // GET 所有任务
  ipcMain.handle(IPC.SCHEDULER_GET_TASKS, async () => {
    return database.getAllScheduledTasks()
  })

  // GET 单个任务
  ipcMain.handle(IPC.SCHEDULER_GET_TASK, async (_event, taskId: string) => {
    return database.getScheduledTask(taskId)
  })

  // CREATE 任务
  ipcMain.handle(IPC.SCHEDULER_CREATE_TASK, async (_event, data: {
    name: string
    description?: string
    taskType?: string
    scheduleType?: string
    cronExpression?: string
    intervalSeconds?: number
    config?: Record<string, any>
    targetSessionId?: string
    targetWorkspaceId?: string
    maxFailures?: number
    timeoutSeconds?: number
    createdBy?: string
  }) => {
    try {
      if (!schedulerService) {
        return createErrorResponse(new Error('SchedulerService not initialized'), { operation: 'scheduler.create' })
      }
      const task = schedulerService.createTask(data as any)
      return createSuccessResponse({ task })
    } catch (err) {
      return createErrorResponse(err, { operation: 'scheduler.create' })
    }
  })

  // UPDATE 任务
  ipcMain.handle(IPC.SCHEDULER_UPDATE_TASK, async (_event, taskId: string, updates: {
    name?: string
    description?: string
    scheduleType?: string
    cronExpression?: string
    intervalSeconds?: number
    config?: Record<string, any>
    isEnabled?: boolean
    isPaused?: boolean
    maxFailures?: number
    timeoutSeconds?: number
  }) => {
    try {
      if (!schedulerService) {
        return createErrorResponse(new Error('SchedulerService not initialized'), { operation: 'scheduler.update' })
      }
      schedulerService.updateTask(taskId, updates)
      return createSuccessResponse({ taskId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'scheduler.update' })
    }
  })

  // DELETE 任务
  ipcMain.handle(IPC.SCHEDULER_DELETE_TASK, async (_event, taskId: string) => {
    try {
      if (!schedulerService) {
        return createErrorResponse(new Error('SchedulerService not initialized'), { operation: 'scheduler.delete' })
      }
      schedulerService.deleteTask(taskId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'scheduler.delete' })
    }
  })

  // 手动触发运行
  ipcMain.handle(IPC.SCHEDULER_TRIGGER_RUN, async (_event, taskId: string) => {
    try {
      if (!schedulerService) {
        return createErrorResponse(new Error('SchedulerService not initialized'), { operation: 'scheduler.trigger' })
      }
      const result = await schedulerService.triggerManualRun(taskId)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'scheduler.trigger' })
    }
  })

  // GET 执行记录
  ipcMain.handle(IPC.SCHEDULER_GET_RUNS, async (_event, scheduledTaskId: string, limit?: number) => {
    return database.getTaskRuns(scheduledTaskId, limit)
  })

  // GET 最近执行记录
  ipcMain.handle(IPC.SCHEDULER_GET_RECENT_RUNS, async (_event, limit?: number) => {
    return database.getRecentTaskRuns(limit)
  })

  // 验证 Cron 表达式（工具端）
  ipcMain.handle('scheduler:validate-cron', async (_event, expression: string) => {
    try {
      if (!schedulerService) {
        return createErrorResponse(new Error('SchedulerService not initialized'), { operation: 'scheduler.validate-cron' })
      }
      const result = schedulerService.validateCron(expression)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'scheduler.validate-cron' })
    }
  })
}
