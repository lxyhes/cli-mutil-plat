/**
 * Workflow IPC Handlers - 工作流编排的 IPC 接口
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { WorkflowService } from '../workflow/WorkflowService'

export function registerWorkflowHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const workflowService: WorkflowService | undefined = (deps as any).workflowService

  // GET 所有工作流
  ipcMain.handle(IPC.WORKFLOW_LIST, async () => {
    return database.getAllWorkflows()
  })

  // GET 单个工作流
  ipcMain.handle(IPC.WORKFLOW_GET, async (_event, workflowId: string) => {
    return database.getWorkflow(workflowId)
  })

  // CREATE 工作流
  ipcMain.handle(IPC.WORKFLOW_CREATE, async (_event, data: {
    name: string
    description?: string
    steps?: any[]
    variables?: Record<string, any>
    createdBy?: string
  }) => {
    try {
      if (!workflowService) {
        return createErrorResponse(new Error('WorkflowService not initialized'), { operation: 'workflow.create' })
      }
      const workflow = workflowService.createWorkflow(data as any)
      return createSuccessResponse({ workflow })
    } catch (err) {
      return createErrorResponse(err, { operation: 'workflow.create' })
    }
  })

  // UPDATE 工作流
  ipcMain.handle(IPC.WORKFLOW_UPDATE, async (_event, workflowId: string, updates: {
    name?: string
    description?: string
    steps?: any[]
    variables?: Record<string, any>
    status?: string
  }) => {
    try {
      if (!workflowService) {
        return createErrorResponse(new Error('WorkflowService not initialized'), { operation: 'workflow.update' })
      }
      workflowService.updateWorkflow(workflowId, updates as any)
      return createSuccessResponse({ workflowId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'workflow.update' })
    }
  })

  // DELETE 工作流
  ipcMain.handle(IPC.WORKFLOW_DELETE, async (_event, workflowId: string) => {
    try {
      if (!workflowService) {
        return createErrorResponse(new Error('WorkflowService not initialized'), { operation: 'workflow.delete' })
      }
      workflowService.deleteWorkflow(workflowId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'workflow.delete' })
    }
  })

  // EXECUTE 工作流
  ipcMain.handle(IPC.WORKFLOW_EXECUTE, async (_event, workflowId: string, triggerBy?: 'manual' | 'scheduled' | 'event', context?: Record<string, any>) => {
    try {
      if (!workflowService) {
        return createErrorResponse(new Error('WorkflowService not initialized'), { operation: 'workflow.execute' })
      }
      const result = await workflowService.executeWorkflow(workflowId, triggerBy || 'manual', context)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'workflow.execute' })
    }
  })

  // PAUSE 执行
  ipcMain.handle(IPC.WORKFLOW_PAUSE, async (_event, executionId: string) => {
    try {
      if (!workflowService) {
        return createErrorResponse(new Error('WorkflowService not initialized'), { operation: 'workflow.pause' })
      }
      workflowService.pauseExecution(executionId)
      return createSuccessResponse({ executionId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'workflow.pause' })
    }
  })

  // RESUME 执行
  ipcMain.handle(IPC.WORKFLOW_RESUME, async (_event, executionId: string) => {
    try {
      if (!workflowService) {
        return createErrorResponse(new Error('WorkflowService not initialized'), { operation: 'workflow.resume' })
      }
      workflowService.resumeExecution(executionId)
      return createSuccessResponse({ executionId })
    } catch (err) {
      return createErrorResponse(err, { operation: 'workflow.resume' })
    }
  })

  // GET 执行记录
  ipcMain.handle(IPC.WORKFLOW_GET_RUNS, async (_event, executionId: string) => {
    return database.getWorkflowRuns(executionId)
  })

  // GET 单个执行记录
  ipcMain.handle(IPC.WORKFLOW_GET_EXECUTION, async (_event, executionId: string) => {
    return database.getWorkflowExecution(executionId)
  })

  // GET 某工作流的所有执行记录
  ipcMain.handle(IPC.WORKFLOW_GET_EXECUTIONS, async (_event, workflowId: string, limit?: number) => {
    return database.getWorkflowExecutions(workflowId, limit)
  })
}
