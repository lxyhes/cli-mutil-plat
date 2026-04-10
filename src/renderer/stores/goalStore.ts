/**
 * Goal Store - 目标锚点状态管理
 */
import { create } from 'zustand'

export type GoalStatus = 'active' | 'achieved' | 'abandoned'
export type GoalPriority = 'high' | 'medium' | 'low'
export type GoalActivityType = 'note' | 'reminder' | 'checkpoint' | 'review'

export interface Goal {
  id: string
  title: string
  description?: string
  targetDate?: string
  status: GoalStatus
  priority: GoalPriority
  tags: string[]
  progress: number
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface GoalActivity {
  id: string
  goalId: string
  type: GoalActivityType
  content: string
  progressBefore?: number
  progressAfter?: number
  sessionId?: string
  createdAt: string
}

export interface GoalSession {
  id: string
  goalId: string
  sessionId: string
  firstMentionedAt: string
  lastMentionedAt: string
  mentionCount: number
  isPrimary: boolean
}

export interface GoalStats {
  activeCount: number
  achievedCount: number
  achievedThisMonth: number
  avgProgress: number
  totalCount: number
}

interface GoalState {
  goals: Goal[]
  activeGoal: Goal | null
  activities: Record<string, GoalActivity[]>
  sessions: Record<string, GoalSession[]>
  stats: GoalStats
  loading: boolean

  fetchGoals: (status?: GoalStatus) => Promise<void>
  fetchGoal: (goalId: string) => Promise<Goal | null>
  createGoal: (data: Partial<Goal>) => Promise<any>
  updateGoal: (goalId: string, updates: Partial<Goal>) => Promise<any>
  deleteGoal: (goalId: string) => Promise<any>
  setActiveGoal: (goal: Goal | null) => void
  addActivity: (data: { goalId: string; type: GoalActivityType; content: string; progressBefore?: number; progressAfter?: number; sessionId?: string }) => Promise<any>
  fetchActivities: (goalId: string, limit?: number) => Promise<void>
  linkSession: (goalId: string, sessionId: string, isPrimary?: boolean) => Promise<any>
  fetchSessions: (goalId: string) => Promise<void>
  fetchStats: () => Promise<void>
  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null

export const useGoalStore = create<GoalState>((set, get) => ({
  goals: [],
  activeGoal: null,
  activities: {},
  sessions: {},
  stats: { activeCount: 0, achievedCount: 0, achievedThisMonth: 0, avgProgress: 0, totalCount: 0 },
  loading: false,

  fetchGoals: async (status?: GoalStatus) => {
    set({ loading: true })
    try {
      const goals = await (window as any).spectrAI.goal.list(status)
      set({ goals: (goals || []) as Goal[], loading: false })
    } catch (err) {
      console.error('[GoalStore] fetchGoals error:', err)
      set({ loading: false })
    }
  },

  fetchGoal: async (goalId) => {
    try {
      return await (window as any).spectrAI.goal.get(goalId) as Goal | null
    } catch (err) {
      console.error('[GoalStore] fetchGoal error:', err)
      return null
    }
  },

  createGoal: async (data) => {
    try {
      const result = await (window as any).spectrAI.goal.create(data)
      if (result.success) {
        await get().fetchGoals()
        await get().fetchStats()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updateGoal: async (goalId, updates) => {
    try {
      const result = await (window as any).spectrAI.goal.update(goalId, updates)
      if (result.success) {
        await get().fetchGoals()
        await get().fetchStats()
        // Update activeGoal if it matches
        const { activeGoal } = get()
        if (activeGoal?.id === goalId && result.data?.goal) {
          set({ activeGoal: result.data.goal })
        }
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deleteGoal: async (goalId) => {
    try {
      const result = await (window as any).spectrAI.goal.delete(goalId)
      if (result.success) {
        set((s) => ({
          goals: s.goals.filter(g => g.id !== goalId),
          activeGoal: s.activeGoal?.id === goalId ? null : s.activeGoal,
        }))
        await get().fetchStats()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  setActiveGoal: (goal) => set({ activeGoal: goal }),

  addActivity: async (data) => {
    try {
      const result = await (window as any).spectrAI.goal.addActivity(data)
      if (result.success) {
        // Refresh activities for this goal
        await get().fetchActivities(data.goalId)
        // Refresh goals (progress may have changed)
        await get().fetchGoals()
        await get().fetchStats()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchActivities: async (goalId, limit = 50) => {
    try {
      const activities = await (window as any).spectrAI.goal.getActivities(goalId, limit) as GoalActivity[]
      set((s) => ({ activities: { ...s.activities, [goalId]: activities || [] } }))
    } catch (err) {
      console.error('[GoalStore] fetchActivities error:', err)
    }
  },

  linkSession: async (goalId, sessionId, isPrimary) => {
    try {
      return await (window as any).spectrAI.goal.linkSession(goalId, sessionId, isPrimary)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchSessions: async (goalId) => {
    try {
      const sessions = await (window as any).spectrAI.goal.getSessions(goalId) as GoalSession[]
      set((s) => ({ sessions: { ...s.sessions, [goalId]: sessions || [] } }))
    } catch (err) {
      console.error('[GoalStore] fetchSessions error:', err)
    }
  },

  fetchStats: async () => {
    try {
      const stats = await (window as any).spectrAI.goal.getStats() as GoalStats
      if (stats) set({ stats })
    } catch (err) {
      console.error('[GoalStore] fetchStats error:', err)
    }
  },

  initListeners: () => {
    _statusCleanup?.()

    _statusCleanup = (window as any).spectrAI.goal.onStatus((status: any) => {
      if (!status || !status.type) return
      const { type, goal, goalId, activity } = status
      if (type === 'goal-created') {
        set((s) => ({ goals: [goal, ...s.goals] }))
        get().fetchStats()
      } else if (type === 'goal-updated' || type === 'goal-achieved') {
        set((s) => ({
          goals: s.goals.map(g => g.id === goal.id ? goal : g),
          activeGoal: s.activeGoal?.id === goal.id ? goal : s.activeGoal,
        }))
        get().fetchStats()
      } else if (type === 'goal-deleted') {
        set((s) => ({
          goals: s.goals.filter(g => g.id !== goalId),
          activeGoal: s.activeGoal?.id === goalId ? null : s.activeGoal,
        }))
        get().fetchStats()
      } else if (type === 'activity-added') {
        const { goalId: aGoalId } = activity
        if (aGoalId) get().fetchActivities(aGoalId)
        get().fetchGoals()
      }
    })
  },

  cleanup: () => {
    _statusCleanup?.()
    _statusCleanup = null
  },
}))
