/**
 * Agent Teams - 状态管理 Store
 *
 * 支持实时事件更新的团队状态管理
 *
 * @author weibin
 */

import { create } from 'zustand'
import type { TeamInstance, TeamTask, TeamMessage, TeamTemplate } from '../../main/team/types'

// 事件监听器引用（用于清理）
let teamEventCleanup: (() => void)[] = []

export interface TeamLogEntry {
  id: string
  time: string
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  data?: any
}

interface TeamHealthIssue {
  type: string
  severity: string
  message: string
  affectedEntity: string
  timestamp: string
  autoFixed?: boolean
}

interface TeamState {
  // 团队列表
  teams: TeamInstance[]
  activeTeamId: string | null
  templates: TeamTemplate[]
  loading: boolean

  // 团队任务（按团队ID索引）
  teamTasks: Record<string, TeamTask[]>
  // 团队消息（按团队ID索引）
  teamMessages: Record<string, TeamMessage[]>
  // 团队健康状态
  teamHealth: Record<string, {
    healthy: boolean
    issues: TeamHealthIssue[]
    stats: {
      totalMembers: number
      activeMembers: number
      failedMembers: number
      totalTasks: number
      completedTasks: number
    }
  }>
  // 团队日志（全局，所有团队共享）
  teamLogs: TeamLogEntry[]
  addTeamLog: (entry: TeamLogEntry) => void
  clearTeamLogs: () => void

  // 数据获取
  fetchTeams: (status?: string) => Promise<void>
  fetchTemplates: () => Promise<void>
  fetchTeamTasks: (teamId: string, status?: string) => Promise<TeamTask[]>
  fetchTeamMessages: (teamId: string, limit?: number) => Promise<TeamMessage[]>
  fetchTeamHealth: (teamId: string) => Promise<void>

  // 操作
  createTeam: (request: any) => Promise<TeamInstance | null>
  setActiveTeam: (teamId: string | null) => void

  // 任务
  createTask: (teamId: string, task: any) => Promise<TeamTask | null>
  completeTask: (teamId: string, taskId: string, result: string) => Promise<boolean>
  claimTask: (teamId: string, taskId: string, memberId: string) => Promise<boolean>

  // 清理
  cleanup: () => void
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  activeTeamId: null,
  templates: [],
  loading: false,
  teamTasks: {},
  teamMessages: {},
  teamHealth: {},
  teamLogs: [],

  addTeamLog: (entry) => set((state) => {
    const logs = [...state.teamLogs, entry]
    // 最多保留 500 条
    return { teamLogs: logs.slice(-500) }
  }),

  clearTeamLogs: () => set({ teamLogs: [] }),

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
      if (result.success) {
        set((state) => ({
          teamTasks: { ...state.teamTasks, [teamId]: result.tasks || [] }
        }))
        return result.tasks || []
      }
      return []
    } catch (err) {
      console.error('[TeamStore] fetchTeamTasks error:', err)
      return []
    }
  },

  fetchTeamMessages: async (teamId: string, limit?: number) => {
    try {
      const result = await (window as any).spectrAI.team.getMessages(teamId, limit)
      if (result.success) {
        set((state) => ({
          teamMessages: { ...state.teamMessages, [teamId]: result.messages || [] }
        }))
        return result.messages || []
      }
      return []
    } catch (err) {
      console.error('[TeamStore] fetchTeamMessages error:', err)
      return []
    }
  },

  fetchTeamHealth: async (teamId: string) => {
    try {
      const result = await (window as any).spectrAI.team.getHealth(teamId)
      if (result.success && result.health) {
        set((state) => ({
          teamHealth: { ...state.teamHealth, [teamId]: result.health }
        }))
      }
    } catch (err) {
      console.error('[TeamStore] fetchTeamHealth error:', err)
    }
  },

  createTeam: async (request) => {
    try {
      const result = await (window as any).spectrAI.team.create(request)
      if (result.success) {
        set((state) => ({ teams: [result.team, ...state.teams] }))
        // 初始化空的任务和消息列表
        set((state) => ({
          teamTasks: { ...state.teamTasks, [result.team.id]: [] },
          teamMessages: { ...state.teamMessages, [result.team.id]: [] }
        }))
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
      if (result.success && result.task) {
        set((state) => {
          const tasks = [...(state.teamTasks[teamId] || []), result.task]
          return { teamTasks: { ...state.teamTasks, [teamId]: tasks } }
        })
        return result.task
      }
      return null
    } catch (err) {
      console.error('[TeamStore] createTask error:', err)
      return null
    }
  },

  completeTask: async (teamId, taskId, result) => {
    try {
      const res = await (window as any).spectrAI.team.completeTask(teamId, taskId, result)
      if (res.success) {
        // 更新本地任务状态
        set((state) => {
          const tasks = state.teamTasks[teamId] || []
          return {
            teamTasks: {
              ...state.teamTasks,
              [teamId]: tasks.map(t =>
                t.id === taskId ? { ...t, status: 'completed', result } : t
              )
            }
          }
        })
        return true
      }
      return false
    } catch (err) {
      console.error('[TeamStore] completeTask error:', err)
      return false
    }
  },

  claimTask: async (teamId, taskId, memberId) => {
    // 这个操作是通过 agents 内部完成的，这里只是更新本地状态
    set((state) => {
      const tasks = state.teamTasks[teamId] || []
      return {
        teamTasks: {
          ...state.teamTasks,
          [teamId]: tasks.map(t =>
            t.id === taskId ? { ...t, status: 'in_progress', claimedBy: memberId } : t
          )
        }
      }
    })
    return true
  },

  cleanup: () => {
    teamEventCleanup.forEach(fn => fn())
    teamEventCleanup = []
  },
}))

// ★ 初始化团队事件监听（只需调用一次）
export function initTeamEventListeners(): void {
  const api = (window as any).spectrAI?.team
  if (!api) {
    console.warn('[TeamStore] team API not available yet')
    return
  }

  // 成员加入
  const unsubMemberJoined = api.onMemberJoined((teamId: string, member: any) => {
    console.log('[TeamStore] Member joined:', teamId, member.roleId)
    useTeamStore.setState((state) => {
      const team = state.teams.find(t => t.id === teamId)
      if (team && !team.members.find(m => m.id === member.id)) {
        return { teams: state.teams.map(t => t.id === teamId ? { ...t, members: [...t.members, member] } : t) }
      }
      return state
    })
  })
  teamEventCleanup.push(unsubMemberJoined)

  // 成员状态变更
  const unsubMemberStatus = api.onMemberStatusChange((teamId: string, memberId: string, status: string) => {
    console.log('[TeamStore] Member status changed:', teamId, memberId, status)
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? {
        ...t,
        members: t.members.map(m => m.id === memberId ? { ...m, status } : m)
      } : t)
    }))
  })
  teamEventCleanup.push(unsubMemberStatus)

  // 任务被认领
  const unsubTaskClaimed = api.onTaskClaimed((teamId: string, taskId: string, memberId: string) => {
    console.log('[TeamStore] Task claimed:', teamId, taskId, memberId)
    useTeamStore.setState((state) => {
      const tasks = state.teamTasks[teamId] || []
      return {
        teamTasks: {
          ...state.teamTasks,
          [teamId]: tasks.map(t =>
            t.id === taskId ? { ...t, status: 'in_progress', claimedBy: memberId } : t
          )
        }
      }
    })
  })
  teamEventCleanup.push(unsubTaskClaimed)

  // 任务完成
  const unsubTaskCompleted = api.onTaskCompleted((teamId: string, taskId: string) => {
    console.log('[TeamStore] Task completed:', teamId, taskId)
    useTeamStore.setState((state) => {
      const tasks = state.teamTasks[teamId] || []
      return {
        teamTasks: {
          ...state.teamTasks,
          [teamId]: tasks.map(t => t.id === taskId ? { ...t, status: 'completed' } : t)
        }
      }
    })
  })
  teamEventCleanup.push(unsubTaskCompleted)

  // 新消息
  const unsubMessage = api.onMessage((teamId: string, message: any) => {
    console.log('[TeamStore] New team message:', teamId, message.type)
    useTeamStore.setState((state) => {
      const messages = [...(state.teamMessages[teamId] || []), message]
      return { teamMessages: { ...state.teamMessages, [teamId]: messages } }
    })
  })
  teamEventCleanup.push(unsubMessage)

  // 团队完成
  const unsubCompleted = api.onCompleted((teamId: string) => {
    console.log('[TeamStore] Team completed:', teamId)
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? { ...t, status: 'completed' } : t)
    }))
  })
  teamEventCleanup.push(unsubCompleted)

  // 团队失败
  const unsubFailed = api.onFailed((teamId: string, reason: string) => {
    console.log('[TeamStore] Team failed:', teamId, reason)
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? { ...t, status: 'failed' } : t)
    }))
  })
  teamEventCleanup.push(unsubFailed)

  // 健康问题
  const unsubHealthIssue = api.onHealthIssue((teamId: string, issue: TeamHealthIssue) => {
    console.warn('[TeamStore] Health issue:', teamId, issue.type, issue.message)
    useTeamStore.getState().addTeamLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: new Date().toISOString(),
      level: 'warn',
      msg: `健康问题 [${issue.type}]: ${issue.message}`,
      data: { teamId, ...issue },
    })
    useTeamStore.setState((state) => {
      const health = state.teamHealth[teamId] || { healthy: true, issues: [], stats: {} as any }
      return {
        teamHealth: {
          ...state.teamHealth,
          [teamId]: {
            ...health,
            healthy: false,
            issues: [...health.issues, issue]
          }
        }
      }
    })
  })
  teamEventCleanup.push(unsubHealthIssue)

  // 调试日志（主进程 IPC 转发）
  const unsubLog = api.onLog((entry: TeamLogEntry) => {
    useTeamStore.getState().addTeamLog(entry)
  })
  teamEventCleanup.push(unsubLog)

  console.log('[TeamStore] Team event listeners initialized')
}
