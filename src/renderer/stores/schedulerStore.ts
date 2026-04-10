/**
 * Scheduler Store - 定时任务状态管理
 */
import { create } from 'zustand'

export type ScheduleType = 'interval' | 'cron' | 'once' | 'daily' | 'weekly'
export type TaskRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
export type TriggerType = 'scheduled' | 'manual'
export type SchedulerStatus = 'stopped' | 'running' | 'error'

export interface ScheduledTask {
  id: string
  name: string
  description?: string
  taskType: string
  scheduleType: ScheduleType
  cronExpression?: string
  intervalSeconds?: number
  config: Record<string, any>
  targetSessionId?: string
  targetWorkspaceId?: string
  isEnabled: boolean
  isPaused: boolean
  maxFailures: number
  timeoutSeconds: number
  nextRunAt?: string
  lastRunAt?: string
  createdBy?: string
  createdAt?: string
}

export interface TaskRun {
  id: string
  scheduledTaskId: string
  status: TaskRunStatus
  triggerType: TriggerType
  attemptNumber: number
  startedAt?: string
  completedAt?: string
  durationMs?: number
  error?: string
  output?: string
  sessionId?: string
}

interface SchedulerState {
  tasks: ScheduledTask[]
  recentRuns: TaskRun[]
  status: SchedulerStatus
  loading: boolean

  fetchTasks: () => Promise<void>
  fetchTask: (taskId: string) => Promise<ScheduledTask | null>
  createTask: (data: Partial<ScheduledTask>) => Promise<any>
  updateTask: (taskId: string, updates: Partial<ScheduledTask>) => Promise<any>
  deleteTask: (taskId: string) => Promise<any>
  triggerRun: (taskId: string) => Promise<any>
  fetchRecentRuns: (limit?: number) => Promise<void>
  fetchRuns: (taskId: string, limit?: number) => Promise<TaskRun[]>
  validateCron: (expression: string) => Promise<{ valid: boolean; error?: string; nextRun?: string }>
  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  tasks: [],
  recentRuns: [],
  status: 'stopped',
  loading: false,

  fetchTasks: async () => {
    set({ loading: true })
    try {
      const tasks = await (window as any).spectrAI.scheduler.getTasks()
      set({ tasks: (tasks || []) as ScheduledTask[], loading: false })
    } catch (err) {
      console.error('[SchedulerStore] fetchTasks error:', err)
      set({ loading: false })
    }
  },

  fetchTask: async (taskId) => {
    try {
      return await (window as any).spectrAI.scheduler.getTask(taskId) as ScheduledTask | null
    } catch (err) {
      console.error('[SchedulerStore] fetchTask error:', err)
      return null
    }
  },

  createTask: async (data) => {
    try {
      const result = await (window as any).spectrAI.scheduler.createTask(data)
      if (result.success) {
        await get().fetchTasks()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updateTask: async (taskId, updates) => {
    try {
      const result = await (window as any).spectrAI.scheduler.updateTask(taskId, updates)
      if (result.success) {
        await get().fetchTasks()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deleteTask: async (taskId) => {
    try {
      const result = await (window as any).spectrAI.scheduler.deleteTask(taskId)
      if (result.success) {
        set((s) => ({ tasks: s.tasks.filter(t => t.id !== taskId) }))
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  triggerRun: async (taskId) => {
    try {
      return await (window as any).spectrAI.scheduler.triggerRun(taskId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchRecentRuns: async (limit = 50) => {
    try {
      const runs = await (window as any).spectrAI.scheduler.getRecentRuns(limit)
      set({ recentRuns: (runs || []) as TaskRun[] })
    } catch (err) {
      console.error('[SchedulerStore] fetchRecentRuns error:', err)
    }
  },

  fetchRuns: async (taskId, limit = 20) => {
    try {
      return await (window as any).spectrAI.scheduler.getRuns(taskId, limit) as TaskRun[]
    } catch (err) {
      console.error('[SchedulerStore] fetchRuns error:', err)
      return []
    }
  },

  validateCron: async (expression) => {
    try {
      return await (window as any).spectrAI.scheduler.validateCron(expression)
    } catch (err: any) {
      return { valid: false, error: err.message }
    }
  },

  initListeners: () => {
    _statusCleanup?.()

    _statusCleanup = (window as any).spectrAI.scheduler.onTaskStatus((status: any) => {
      if (typeof status === 'string') {
        set({ status: status as SchedulerStatus })
      } else if (status && typeof status === 'object') {
        const { type, taskId } = status
        if (type === 'task-created' || type === 'task-updated' || type === 'task-deleted') {
          get().fetchTasks()
        } else if (type === 'run-started' || type === 'run-completed' || type === 'run-failed' || type === 'run-timeout') {
          get().fetchRecentRuns()
          // Update specific task in list
          if (taskId) {
            get().fetchTask(taskId).then(task => {
              if (task) {
                set((s) => ({
                  tasks: s.tasks.map(t => t.id === taskId ? task : t),
                }))
              }
            })
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
