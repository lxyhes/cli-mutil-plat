/**
 * Agent Teams - 状态管理 Store
 *
 * 支持实时事件更新的团队状态管理
 *
 * @author weibin
 */

import { create } from 'zustand'
import type {
  DAGValidation,
  MemberStatus,
  TaskDAGNode,
  TeamInstance,
  TeamMember,
  TeamMessage,
  TeamStatus,
  TeamTask,
  TeamTemplate,
} from '../../shared/types'

// 事件监听器引用（用于清理）
let teamEventCleanup: (() => void)[] = []
let teamEventsInitialized = false

const EMPTY_DAG_VALIDATION: DAGValidation = {
  valid: true,
  cycles: [],
  missingDependencies: [],
  readyTasks: [],
  blockedTasks: [],
}

function appendUniqueMessage(messages: TeamMessage[], message: TeamMessage): TeamMessage[] {
  return messages.some(item => item.id === message.id) ? messages : [...messages, message]
}

export interface TeamLogEntry {
  id: string
  time: string
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  data?: any
}

export interface TeamHealthIssue {
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
  updateTask: (teamId: string, taskId: string, updates: any) => Promise<TeamTask | null>
  cancelTask: (teamId: string, taskId: string, reason?: string) => Promise<boolean>
  retryTask: (teamId: string, taskId: string, options?: { memberId?: string; note?: string }) => Promise<TeamTask | null>
  reassignTask: (teamId: string, taskId: string, newMemberId: string) => Promise<boolean>

  // 团队生命周期
  cancelTeam: (teamId: string, reason?: string) => Promise<boolean>
  pauseTeam: (teamId: string) => Promise<boolean>
  resumeTeam: (teamId: string) => Promise<boolean>
  updateTeam: (teamId: string, updates: { name?: string; objective?: string }) => Promise<boolean>
  updateMember: (
    teamId: string,
    memberId: string,
    updates: { providerId?: string; modelOverride?: string | null; promptOverride?: string | null }
  ) => Promise<TeamMember | null>

  // 模板管理
  createTemplate: (template: any) => Promise<any>
  updateTemplate: (templateId: string, updates: any) => Promise<any>
  deleteTemplate: (templateId: string) => Promise<boolean>

  // UI 消息
  sendMessage: (teamId: string, toMemberId: string, content: string) => Promise<TeamMessage | null>
  broadcastMessage: (teamId: string, content: string) => Promise<TeamMessage | null>

  // DAG
  fetchTaskDAG: (teamId: string) => Promise<{ dag: TaskDAGNode[]; validation: DAGValidation }>

  // 导出
  exportTeam: (teamId: string) => Promise<any>
  importTeam: (snapshot: any) => Promise<TeamInstance | null>
  mergeWorktrees: (teamId: string, options?: { cleanup?: boolean; squash?: boolean }) => Promise<any[]>

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
      throw new Error(result.error || '创建团队失败')
    } catch (err) {
      console.error('[TeamStore] createTeam error:', err)
      throw err instanceof Error ? err : new Error(String(err))
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
          const completedTask = tasks.find(t => t.id === taskId)
          const completedAt = new Date().toISOString()
          return {
            teams: state.teams.map(team => team.id === teamId ? {
              ...team,
              members: team.members.map(member =>
                member.id === completedTask?.claimedBy || member.currentTaskId === taskId
                  ? { ...member, currentTaskId: undefined, lastActiveAt: completedAt }
                  : member
              )
            } : team),
            teamTasks: {
              ...state.teamTasks,
              [teamId]: tasks.map(t =>
                t.id === taskId ? { ...t, status: 'completed', result, completedAt } : t
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
      const claimedAt = new Date().toISOString()
      return {
        teams: state.teams.map(team => team.id === teamId ? {
          ...team,
          members: team.members.map(member =>
            member.id === memberId
              ? { ...member, currentTaskId: taskId, lastActiveAt: claimedAt }
              : member
          )
        } : team),
        teamTasks: {
          ...state.teamTasks,
          [teamId]: tasks.map(t =>
            t.id === taskId ? { ...t, status: 'in_progress', claimedBy: memberId, claimedAt } : t
          )
        }
      }
    })
    return true
  },

  updateTask: async (teamId, taskId, updates) => {
    try {
      const result = await (window as any).spectrAI.team.updateTask(teamId, taskId, updates)
      if (result.success && result.task) {
        set((state) => ({
          teamTasks: {
            ...state.teamTasks,
            [teamId]: (state.teamTasks[teamId] || []).map(t =>
              t.id === taskId ? { ...t, ...result.task } : t
            )
          }
        }))
        return result.task
      }
      return null
    } catch (err) {
      console.error('[TeamStore] updateTask error:', err)
      return null
    }
  },

  cancelTask: async (teamId, taskId, reason) => {
    try {
      const result = await (window as any).spectrAI.team.cancelTask(teamId, taskId, reason)
      if (result.success) {
        set((state) => {
          const tasks = state.teamTasks[teamId] || []
          const cancelledTask = tasks.find(task => task.id === taskId)
          const updatedAt = new Date().toISOString()

          return {
            teams: state.teams.map(team => team.id === teamId ? {
              ...team,
              members: team.members.map(member =>
                member.id === cancelledTask?.claimedBy || member.currentTaskId === taskId
                  ? { ...member, currentTaskId: undefined, lastActiveAt: updatedAt }
                  : member
              )
            } : team),
            teamTasks: {
              ...state.teamTasks,
              [teamId]: tasks.map(t =>
                t.id === taskId ? { ...t, status: 'cancelled' } : t
              )
            }
          }
        })
        return true
      }
      return false
    } catch (err) {
      console.error('[TeamStore] cancelTask error:', err)
      return false
    }
  },

  retryTask: async (teamId, taskId, options) => {
    try {
      const result = await (window as any).spectrAI.team.retryTask(teamId, taskId, options)
      if (result.success && result.task) {
        set((state) => {
          const tasks = state.teamTasks[teamId] || []
          const oldTask = tasks.find(task => task.id === taskId)
          const updatedAt = new Date().toISOString()

          return {
            teams: state.teams.map(team => team.id === teamId ? {
              ...team,
              members: team.members.map(member =>
                member.id === oldTask?.claimedBy || member.currentTaskId === taskId
                  ? { ...member, currentTaskId: undefined, lastActiveAt: updatedAt }
                  : member
              )
            } : team),
            teamTasks: {
              ...state.teamTasks,
              [teamId]: tasks.map(t =>
                t.id === taskId ? { ...t, ...result.task } : t
              )
            }
          }
        })
        return result.task
      }
      return null
    } catch (err) {
      console.error('[TeamStore] retryTask error:', err)
      return null
    }
  },

  reassignTask: async (teamId, taskId, newMemberId) => {
    try {
      const result = await (window as any).spectrAI.team.reassignTask(teamId, taskId, newMemberId)
      return result.success
    } catch (err) {
      console.error('[TeamStore] reassignTask error:', err)
      return false
    }
  },

  cancelTeam: async (teamId, reason) => {
    try {
      const result = await (window as any).spectrAI.team.cancel(teamId, reason)
      if (result.success) {
        set((state) => ({
          teams: state.teams.map(t =>
            t.id === teamId ? { ...t, status: 'cancelled' } : t
          )
        }))
        return true
      }
      return false
    } catch (err) {
      console.error('[TeamStore] cancelTeam error:', err)
      return false
    }
  },

  pauseTeam: async (teamId) => {
    try {
      const result = await (window as any).spectrAI.team.pause(teamId)
      if (result.success) {
        set((state) => ({
          teams: state.teams.map(t =>
            t.id === teamId ? { ...t, status: 'paused' } : t
          )
        }))
        return true
      }
      return false
    } catch (err) {
      console.error('[TeamStore] pauseTeam error:', err)
      return false
    }
  },

  resumeTeam: async (teamId) => {
    try {
      const result = await (window as any).spectrAI.team.resume(teamId)
      if (result.success) {
        set((state) => ({
          teams: state.teams.map(t =>
            t.id === teamId ? { ...t, status: 'running' } : t
          )
        }))
        return true
      }
      return false
    } catch (err) {
      console.error('[TeamStore] resumeTeam error:', err)
      return false
    }
  },

  updateTeam: async (teamId, updates) => {
    try {
      const result = await (window as any).spectrAI.team.update(teamId, updates)
      if (result.success) {
        set((state) => ({
          teams: state.teams.map(t =>
            t.id === teamId ? { ...t, ...updates } : t
          )
        }))
        return true
      }
      return false
    } catch (err) {
      console.error('[TeamStore] updateTeam error:', err)
      return false
    }
  },

  updateMember: async (teamId, memberId, updates) => {
    try {
      const result = await (window as any).spectrAI.team.updateMember(teamId, memberId, updates)
      if (result.success && result.member) {
        set((state) => ({
          teams: state.teams.map(team => team.id === teamId ? {
            ...team,
            members: team.members.map(member =>
              member.id === memberId ? { ...member, ...result.member } : member
            )
          } : team)
        }))
        return result.member
      }
      return null
    } catch (err) {
      console.error('[TeamStore] updateMember error:', err)
      return null
    }
  },

  createTemplate: async (template) => {
    try {
      const result = await (window as any).spectrAI.team.createTemplate(template)
      if (result.success && result.template) {
        set((state) => ({ templates: [...state.templates, result.template] }))
        return result.template
      }
      return null
    } catch (err) {
      console.error('[TeamStore] createTemplate error:', err)
      return null
    }
  },

  updateTemplate: async (templateId, updates) => {
    try {
      const result = await (window as any).spectrAI.team.updateTemplate(templateId, updates)
      if (result.success && result.template) {
        set((state) => ({
          templates: state.templates.map(t =>
            t.id === templateId ? { ...t, ...result.template } : t
          )
        }))
        return result.template
      }
      return null
    } catch (err) {
      console.error('[TeamStore] updateTemplate error:', err)
      return null
    }
  },

  deleteTemplate: async (templateId) => {
    try {
      const result = await (window as any).spectrAI.team.deleteTemplate(templateId)
      if (result.success) {
        set((state) => ({
          templates: state.templates.filter(t => t.id !== templateId)
        }))
        return true
      }
      return false
    } catch (err) {
      console.error('[TeamStore] deleteTemplate error:', err)
      return false
    }
  },

  sendMessage: async (teamId, toMemberId, content) => {
    try {
      const result = await (window as any).spectrAI.team.sendMessage(teamId, toMemberId, content)
      if (result.success && result.message) {
        set((state) => ({
          teamMessages: {
            ...state.teamMessages,
            [teamId]: appendUniqueMessage(state.teamMessages[teamId] || [], result.message)
          }
        }))
        return result.message
      }
      return null
    } catch (err) {
      console.error('[TeamStore] sendMessage error:', err)
      return null
    }
  },

  broadcastMessage: async (teamId, content) => {
    try {
      const result = await (window as any).spectrAI.team.broadcast(teamId, content)
      if (result.success && result.message) {
        set((state) => ({
          teamMessages: {
            ...state.teamMessages,
            [teamId]: appendUniqueMessage(state.teamMessages[teamId] || [], result.message)
          }
        }))
        return result.message
      }
      return null
    } catch (err) {
      console.error('[TeamStore] broadcastMessage error:', err)
      return null
    }
  },

  fetchTaskDAG: async (teamId) => {
    try {
      const result = await (window as any).spectrAI.team.getTaskDAG(teamId)
      if (result.success) {
        return { dag: result.dag || [], validation: result.validation || EMPTY_DAG_VALIDATION }
      }
      return { dag: [], validation: EMPTY_DAG_VALIDATION }
    } catch (err) {
      console.error('[TeamStore] fetchTaskDAG error:', err)
      return { dag: [], validation: EMPTY_DAG_VALIDATION }
    }
  },

  exportTeam: async (teamId) => {
    try {
      const result = await (window as any).spectrAI.team.exportTeam(teamId)
      if (result.success) return result.snapshot
      return null
    } catch (err) {
      console.error('[TeamStore] exportTeam error:', err)
      return null
    }
  },

  importTeam: async (snapshot) => {
    try {
      const result = await (window as any).spectrAI.team.importTeam(snapshot)
      if (result.success && result.team) {
        set((state) => ({
          teams: [result.team, ...state.teams],
          teamTasks: { ...state.teamTasks, [result.team.id]: [] },
          teamMessages: { ...state.teamMessages, [result.team.id]: [] }
        }))
        return result.team
      }
      return null
    } catch (err) {
      console.error('[TeamStore] importTeam error:', err)
      return null
    }
  },

  mergeWorktrees: async (teamId, options) => {
    try {
      const result = await (window as any).spectrAI.team.mergeWorktrees(teamId, options)
      return result.success ? (result.results || []) : []
    } catch (err) {
      console.error('[TeamStore] mergeWorktrees error:', err)
      return []
    }
  },

  cleanup: () => {
    teamEventCleanup.forEach(fn => fn())
    teamEventCleanup = []
    teamEventsInitialized = false
  },
}))

// ★ 初始化团队事件监听（只需调用一次）
export function initTeamEventListeners(): void {
  if (teamEventsInitialized) return

  const api = (window as any).spectrAI?.team
  if (!api) {
    console.warn('[TeamStore] team API not available yet')
    return
  }
  teamEventsInitialized = true

  const unsubStatusChange = api.onStatusChange((teamId: string, status: TeamStatus) => {
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? { ...t, status } : t)
    }))
  })
  teamEventCleanup.push(unsubStatusChange)

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
  const unsubMemberStatus = api.onMemberStatusChange((teamId: string, memberId: string, status: MemberStatus) => {
    console.log('[TeamStore] Member status changed:', teamId, memberId, status)
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? {
        ...t,
        members: t.members.map(m => m.id === memberId ? {
          ...m,
          status,
          lastActiveAt: new Date().toISOString(),
        } : m)
      } : t)
    }))
  })
  teamEventCleanup.push(unsubMemberStatus)

  // 任务被认领
  const unsubTaskClaimed = api.onTaskClaimed((teamId: string, taskId: string, memberId: string) => {
    console.log('[TeamStore] Task claimed:', teamId, taskId, memberId)
    useTeamStore.setState((state) => {
      const tasks = state.teamTasks[teamId] || []
      const claimedAt = new Date().toISOString()
      return {
        teams: state.teams.map(team => team.id === teamId ? {
          ...team,
          members: team.members.map(member =>
            member.id === memberId
              ? { ...member, currentTaskId: taskId, lastActiveAt: claimedAt }
              : member
          )
        } : team),
        teamTasks: {
          ...state.teamTasks,
          [teamId]: tasks.map(t =>
            t.id === taskId ? { ...t, status: 'in_progress', claimedBy: memberId, claimedAt } : t
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
      const completedTask = tasks.find(t => t.id === taskId)
      const completedAt = new Date().toISOString()
      return {
        teams: state.teams.map(team => team.id === teamId ? {
          ...team,
          members: team.members.map(member =>
            member.id === completedTask?.claimedBy || member.currentTaskId === taskId
              ? { ...member, currentTaskId: undefined, lastActiveAt: completedAt }
              : member
          )
        } : team),
        teamTasks: {
          ...state.teamTasks,
          [teamId]: tasks.map(t => t.id === taskId ? { ...t, status: 'completed', completedAt } : t)
        }
      }
    })
  })
  teamEventCleanup.push(unsubTaskCompleted)

  // 新消息
  const unsubMessage = api.onMessage((teamId: string, message: any) => {
    console.log('[TeamStore] New team message:', teamId, message.type)
    useTeamStore.setState((state) => {
      const messages = appendUniqueMessage(state.teamMessages[teamId] || [], message)
      const activeAt = new Date().toISOString()
      return {
        teams: state.teams.map(team => team.id === teamId ? {
          ...team,
          members: team.members.map(member =>
            member.id === message.from || member.id === message.to
              ? { ...member, lastActiveAt: activeAt }
              : member
          )
        } : team),
        teamMessages: { ...state.teamMessages, [teamId]: messages }
      }
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

  // 任务取消
  const unsubTaskCancelled = api.onTaskCancelled((teamId: string, taskId: string) => {
    useTeamStore.setState((state) => ({
      teams: state.teams.map(team => team.id === teamId ? {
        ...team,
        members: team.members.map(member =>
          member.currentTaskId === taskId
            ? { ...member, currentTaskId: undefined, lastActiveAt: new Date().toISOString() }
            : member
        )
      } : team),
      teamTasks: {
        ...state.teamTasks,
        [teamId]: (state.teamTasks[teamId] || []).map(t =>
          t.id === taskId ? { ...t, status: 'cancelled' } : t
        )
      }
    }))
  })
  teamEventCleanup.push(unsubTaskCancelled)

  // 团队取消
  const unsubCancelled = api.onCancelled((teamId: string, _reason: string) => {
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? { ...t, status: 'cancelled' } : t)
    }))
  })
  teamEventCleanup.push(unsubCancelled)

  // 团队暂停
  const unsubPaused = api.onPaused((teamId: string) => {
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? { ...t, status: 'paused' } : t)
    }))
  })
  teamEventCleanup.push(unsubPaused)

  // 团队恢复
  const unsubResumed = api.onResumed((teamId: string) => {
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? { ...t, status: 'running' } : t)
    }))
  })
  teamEventCleanup.push(unsubResumed)

  // 团队信息更新
  const unsubUpdated = api.onUpdated((teamId: string, updates: any) => {
    useTeamStore.setState((state) => ({
      teams: state.teams.map(t => t.id === teamId ? { ...t, ...updates } : t)
    }))
  })
  teamEventCleanup.push(unsubUpdated)

  console.log('[TeamStore] Team event listeners initialized')
}
