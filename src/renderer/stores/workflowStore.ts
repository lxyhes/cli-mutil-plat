/**
 * Workflow Store - 工作流编排状态管理
 */
import { create } from 'zustand'

export type WorkflowStatus = 'draft' | 'running' | 'paused'
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused'
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface WorkflowStep {
  id: string
  type: 'prompt' | 'http' | 'condition' | 'delay'
  name?: string
  prompt?: string
  sessionId?: string
  providerId?: string
  workspaceId?: string
  httpMethod?: string
  httpUrl?: string
  httpHeaders?: Record<string, string>
  httpBody?: string
  conditionExpression?: string
  trueSteps?: string[]
  falseSteps?: string[]
  delayMs?: number
  retries?: number
  dependsOn?: string[]
}

export interface Workflow {
  id: string
  name: string
  description?: string
  steps: WorkflowStep[]
  variables: Record<string, any>
  status: WorkflowStatus
  createdBy?: string
  createdAt?: string
  updatedAt?: string
}

export interface WorkflowExecution {
  id: string
  workflowId: string
  status: ExecutionStatus
  startedAt?: string
  completedAt?: string
  triggeredBy: string
  context: Record<string, any>
  result?: string
  error?: string
}

export interface WorkflowRun {
  id: string
  executionId: string
  stepId: string
  stepOrder: number
  status: RunStatus
  startedAt?: string
  completedAt?: string
  input: Record<string, any>
  output?: string
  error?: string
  retries: number
}

interface WorkflowState {
  workflows: Workflow[]
  executions: Record<string, WorkflowExecution[]>
  runs: Record<string, WorkflowRun[]>
  status: string
  loading: boolean

  fetchWorkflows: () => Promise<void>
  fetchWorkflow: (workflowId: string) => Promise<Workflow | null>
  createWorkflow: (data: Partial<Workflow>) => Promise<any>
  updateWorkflow: (workflowId: string, updates: Partial<Workflow>) => Promise<any>
  deleteWorkflow: (workflowId: string) => Promise<any>
  executeWorkflow: (workflowId: string, triggerBy?: string, context?: any) => Promise<any>
  pauseExecution: (executionId: string) => Promise<any>
  resumeExecution: (executionId: string) => Promise<any>
  fetchExecutions: (workflowId: string) => Promise<void>
  fetchRuns: (executionId: string) => Promise<void>
  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  executions: {},
  runs: {},
  status: 'stopped',
  loading: false,

  fetchWorkflows: async () => {
    set({ loading: true })
    try {
      const workflows = await (window as any).spectrAI.workflow.list()
      set({ workflows: (workflows || []) as Workflow[], loading: false })
    } catch (err) {
      console.error('[WorkflowStore] fetchWorkflows error:', err)
      set({ loading: false })
    }
  },

  fetchWorkflow: async (workflowId) => {
    try {
      return await (window as any).spectrAI.workflow.get(workflowId) as Workflow | null
    } catch (err) {
      console.error('[WorkflowStore] fetchWorkflow error:', err)
      return null
    }
  },

  createWorkflow: async (data) => {
    try {
      const result = await (window as any).spectrAI.workflow.create(data)
      if (result.success) {
        await get().fetchWorkflows()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updateWorkflow: async (workflowId, updates) => {
    try {
      const result = await (window as any).spectrAI.workflow.update(workflowId, updates)
      if (result.success) {
        await get().fetchWorkflows()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deleteWorkflow: async (workflowId) => {
    try {
      const result = await (window as any).spectrAI.workflow.delete(workflowId)
      if (result.success) {
        set((s) => ({ workflows: s.workflows.filter(w => w.id !== workflowId) }))
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  executeWorkflow: async (workflowId, triggerBy, context) => {
    try {
      return await (window as any).spectrAI.workflow.execute(workflowId, triggerBy, context)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  pauseExecution: async (executionId) => {
    try {
      return await (window as any).spectrAI.workflow.pause(executionId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  resumeExecution: async (executionId) => {
    try {
      return await (window as any).spectrAI.workflow.resume(executionId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchExecutions: async (workflowId: string) => {
    try {
      const executions = await (window as any).spectrAI.workflow.getExecutions(workflowId) as WorkflowExecution[]
      set((s) => ({ executions: { ...s.executions, [workflowId]: executions || [] } }))
    } catch (err) {
      console.error('[WorkflowStore] fetchExecutions error:', err)
    }
  },

  fetchRuns: async (executionId) => {
    try {
      const runs = await (window as any).spectrAI.workflow.getRuns(executionId) as WorkflowRun[]
      set((s) => ({ runs: { ...s.runs, [executionId]: runs || [] } }))
    } catch (err) {
      console.error('[WorkflowStore] fetchRuns error:', err)
    }
  },

  initListeners: () => {
    _statusCleanup?.()

    _statusCleanup = (window as any).spectrAI.workflow.onStatus((status: any) => {
      if (typeof status === 'string') {
        set({ status })
      } else if (status && typeof status === 'object') {
        const { type, workflowId } = status
        if (type === 'workflow-created' || type === 'workflow-updated' || type === 'workflow-deleted') {
          get().fetchWorkflows()
        } else if (type === 'workflow-started' || type === 'workflow-completed' || type === 'workflow-failed') {
          get().fetchWorkflows()
          if (status.executionId) {
            get().fetchRuns(status.executionId)
          }
        }
      }
    })
  },

  cleanup: () => {
    _statusCleanup?.()
    _statusCleanup = null
  },
}))
