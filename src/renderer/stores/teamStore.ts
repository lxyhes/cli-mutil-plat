/**
 * Agent Teams - 状态管理 Store
 * 
 * @author weibin
 */

import { create } from 'zustand'
import type { TeamInstance, TeamTask, TeamMessage, TeamTemplate } from '../../main/team/types'

interface TeamState {
  // 团队列表
  teams: TeamInstance[]
  activeTeamId: string | null
  templates: TeamTemplate[]
  loading: boolean

  // 数据获取
  fetchTeams: (status?: string) => Promise<void>
  fetchTemplates: () => Promise<void>
  fetchTeamTasks: (teamId: string, status?: string) => Promise<TeamTask[]>
  fetchTeamMessages: (teamId: string, limit?: number) => Promise<TeamMessage[]>

  // 操作
  createTeam: (request: any) => Promise<TeamInstance | null>
  setActiveTeam: (teamId: string | null) => void

  // 任务
  createTask: (teamId: string, task: any) => Promise<TeamTask | null>
  completeTask: (teamId: string, taskId: string, result: string) => Promise<boolean>
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  activeTeamId: null,
  templates: [],
  loading: false,

  fetchTeams: async (status?: string) => {
    set({ loading: true })
    try {
      const result = await (window as any).spectrAI.team.getAll(status)
      if (result.success) {
        set({ teams: result.teams || [], loading: false })
      } else {
        set({ loading: false })
      }
    } catch (err) {
      console.error('[TeamStore] fetchTeams error:', err)
      set({ loading: false })
    }
  },

  fetchTemplates: async () => {
    try {
      const result = await (window as any).spectrAI.team.getTemplates()
      if (result.success) {
        set({ templates: result.templates || [] })
      }
    } catch (err) {
      console.error('[TeamStore] fetchTemplates error:', err)
    }
  },

  fetchTeamTasks: async (teamId: string, status?: string) => {
    try {
      const result = await (window as any).spectrAI.team.getTasks(teamId, status)
      return result.success ? result.tasks || [] : []
    } catch (err) {
      console.error('[TeamStore] fetchTeamTasks error:', err)
      return []
    }
  },

  fetchTeamMessages: async (teamId: string, limit?: number) => {
    try {
      const result = await (window as any).spectrAI.team.getMessages(teamId, limit)
      return result.success ? result.messages || [] : []
    } catch (err) {
      console.error('[TeamStore] fetchTeamMessages error:', err)
      return []
    }
  },

  createTeam: async (request) => {
    try {
      const result = await (window as any).spectrAI.team.create(request)
      if (result.success) {
        set((state) => ({ teams: [result.team, ...state.teams] }))
        return result.team
      }
      return null
    } catch (err) {
      console.error('[TeamStore] createTeam error:', err)
      return null
    }
  },

  setActiveTeam: (teamId) => set({ activeTeamId: teamId }),

  createTask: async (teamId, task) => {
    try {
      const result = await (window as any).spectrAI.team.createTask(teamId, task)
      return result.success ? result.task : null
    } catch (err) {
      console.error('[TeamStore] createTask error:', err)
      return null
    }
  },

  completeTask: async (teamId, taskId, result) => {
    try {
      const res = await (window as any).spectrAI.team.completeTask(teamId, taskId, result)
      return res.success
    } catch (err) {
      console.error('[TeamStore] completeTask error:', err)
      return false
    }
  },
}))
