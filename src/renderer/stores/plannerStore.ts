/**
 * Planner Store - 自主规划引擎状态管理
 */
import { create } from 'zustand'

export type PlanStatus = 'pending' | 'running' | 'completed' | 'failed'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'
export type StepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed'
export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface PlanSession {
  id: string
  sessionId: string
  goal: string
  status: PlanStatus
  createdAt?: string
  updatedAt?: string
  startedAt?: string
  completedAt?: string
}

export interface PlanTask {
  id: string
  planSessionId: string
  title: string
  description?: string
  priority: Priority
  status: TaskStatus
  dependencies: string[]
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

export interface PlanStep {
  id: string
  planTaskId: string
  description: string
  status: StepStatus
  result?: string
  orderIndex: number
  createdAt?: string
  completedAt?: string
}

interface PlannerState {
  plans: PlanSession[]
  activePlan: PlanSession | null
  activeTasks: PlanTask[]
  activeSteps: PlanStep[]
  status: string
  loading: boolean

  fetchPlans: () => Promise<void>
  fetchPlan: (planId: string) => Promise<PlanSession | null>
  createPlan: (data: { sessionId: string; goal: string; workingDirectory?: string; providerId?: string }) => Promise<any>
  updatePlan: (planId: string, updates: { goal?: string; status?: string }) => Promise<any>
  deletePlan: (planId: string) => Promise<any>
  startPlan: (planId: string, sessionId: string) => Promise<any>
  syncToKanban: (planId: string, sessionId: string) => Promise<any>
  fetchTasks: (planId: string) => Promise<void>
  fetchSteps: (taskId: string) => Promise<void>
  executeStep: (stepId: string, sessionId: string, providerId?: string) => Promise<any>
  updateStep: (stepId: string, updates: { status?: string; result?: string }) => Promise<any>
  skipTask: (taskId: string) => Promise<any>
  skipStep: (stepId: string) => Promise<any>
  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null

export const usePlannerStore = create<PlannerState>((set, get) => ({
  plans: [],
  activePlan: null,
  activeTasks: [],
  activeSteps: [],
  status: 'idle',
  loading: false,

  fetchPlans: async () => {
    set({ loading: true })
    try {
      const plans = await (window as any).spectrAI.planner.list()
      set({ plans: (plans || []) as PlanSession[], loading: false })
    } catch (err) {
      console.error('[PlannerStore] fetchPlans error:', err)
      set({ loading: false })
    }
  },

  fetchPlan: async (planId) => {
    try {
      return await (window as any).spectrAI.planner.get(planId) as PlanSession | null
    } catch (err) {
      console.error('[PlannerStore] fetchPlan error:', err)
      return null
    }
  },

  createPlan: async (data) => {
    try {
      const result = await (window as any).spectrAI.planner.create(data)
      if (result.success) {
        await get().fetchPlans()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updatePlan: async (planId, updates) => {
    try {
      const result = await (window as any).spectrAI.planner.update(planId, updates)
      if (result.success) {
        await get().fetchPlans()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deletePlan: async (planId) => {
    try {
      const result = await (window as any).spectrAI.planner.delete(planId)
      if (result.success) {
        set((s) => ({ plans: s.plans.filter(p => p.id !== planId) }))
        if (get().activePlan?.id === planId) {
          set({ activePlan: null, activeTasks: [], activeSteps: [] })
        }
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  startPlan: async (planId, sessionId) => {
    try {
      const result = await (window as any).spectrAI.planner.start(planId, sessionId)
      if (result.success) {
        await get().fetchPlans()
        await get().fetchTasks(planId)
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  syncToKanban: async (planId, sessionId) => {
    try {
      const result = await (window as any).spectrAI.planner.syncToKanban(planId, sessionId)
      if (result.success) {
        await get().fetchPlans()
        await get().fetchTasks(planId)
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchTasks: async (planId) => {
    try {
      const tasks = await (window as any).spectrAI.planner.getTasks(planId)
      const plan = await get().fetchPlan(planId)
      set({ activePlan: plan as PlanSession | null, activeTasks: (tasks || []) as PlanTask[] })
    } catch (err) {
      console.error('[PlannerStore] fetchTasks error:', err)
    }
  },

  fetchSteps: async (taskId) => {
    try {
      const steps = await (window as any).spectrAI.planner.getSteps(taskId)
      set({ activeSteps: (steps || []) as PlanStep[] })
    } catch (err) {
      console.error('[PlannerStore] fetchSteps error:', err)
    }
  },

  executeStep: async (stepId, sessionId, providerId) => {
    try {
      const result = await (window as any).spectrAI.planner.executeStep(stepId, sessionId, providerId)
      if (result.success) {
        // Refresh steps
        const step = get().activeSteps.find(s => s.id === stepId)
        if (step) {
          await get().fetchSteps(step.planTaskId)
        }
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updateStep: async (stepId, updates) => {
    try {
      const result = await (window as any).spectrAI.planner.updateStep(stepId, updates)
      if (result.success) {
        const step = get().activeSteps.find(s => s.id === stepId)
        if (step) {
          await get().fetchSteps(step.planTaskId)
        }
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  skipTask: async (taskId) => {
    try {
      const result = await (window as any).spectrAI.planner.skipTask(taskId)
      const activePlan = get().activePlan
      if (result.success && activePlan) {
        await get().fetchTasks(activePlan.id)
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  skipStep: async (stepId) => {
    try {
      const result = await (window as any).spectrAI.planner.skipStep(stepId)
      if (result.success) {
        const step = get().activeSteps.find(s => s.id === stepId)
        if (step) {
          await get().fetchSteps(step.planTaskId)
        }
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  initListeners: () => {
    _statusCleanup?.()

    _statusCleanup = (window as any).spectrAI.planner.onStatus((status: any) => {
      if (typeof status === 'string') {
        set({ status })
      } else if (status && typeof status === 'object') {
        const { type, planId, taskId, stepId } = status

        if (type === 'plan-created' || type === 'plan-updated' || type === 'plan-deleted') {
          get().fetchPlans()
        } else if (type === 'plan-started' || type === 'plan-completed' || type === 'plan-synced-to-kanban') {
          get().fetchPlans()
          if (planId) get().fetchTasks(planId)
        } else if (type === 'task-completed' || type === 'task-skipped') {
          if (planId) get().fetchTasks(planId)
        } else if (type === 'step-started' || type === 'step-completed' || type === 'step-skipped') {
          if (taskId) get().fetchSteps(taskId)
        } else if (type === 'step-updated') {
          if (taskId) get().fetchSteps(taskId)
        }
      }
    })
  },

  cleanup: () => {
    _statusCleanup?.()
    _statusCleanup = null
  },
}))
