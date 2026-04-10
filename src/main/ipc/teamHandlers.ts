/**
 * Agent Teams - IPC Handlers
 *
 * 团队相关的 IPC 接口
 *
 * @author weibin
 */

import { ipcMain } from 'electron'
import type { TeamManager } from '../team/TeamManager'
import { IPC } from '../../shared/constants'
import { sendToRenderer } from './shared'

export interface IpcDependencies {
  teamManager: TeamManager
}

/**
 * 连接 TeamManager 事件到渲染进程
 */
export function wireTeamEvents(teamManager: any): void {
  const events = [
    ['team:status-change', (teamId: string, status: string) => sendToRenderer(IPC.TEAM_STATUS_CHANGE, teamId, status)],
    ['team:member-joined', (teamId: string, member: any) => sendToRenderer(IPC.TEAM_MEMBER_JOINED, teamId, member)],
    ['team:member-status-change', (teamId: string, memberId: string, status: string) => sendToRenderer(IPC.TEAM_MEMBER_STATUS_CHANGE, teamId, memberId, status)],
    ['team:task-claimed', (teamId: string, taskId: string, memberId: string) => sendToRenderer(IPC.TEAM_TASK_CLAIMED, teamId, taskId, memberId)],
    ['team:task-completed', (teamId: string, taskId: string) => sendToRenderer(IPC.TEAM_TASK_COMPLETED, teamId, taskId)],
    ['team:task-cancelled', (teamId: string, taskId: string) => sendToRenderer(IPC.TEAM_TASK_CANCELLED, teamId, taskId)],
    ['team:message', (teamId: string, message: any) => sendToRenderer(IPC.TEAM_MESSAGE, teamId, message)],
    ['team:completed', (teamId: string) => sendToRenderer(IPC.TEAM_COMPLETED, teamId)],
    ['team:failed', (teamId: string, reason: string) => sendToRenderer(IPC.TEAM_FAILED, teamId, reason)],
    ['team:cancelled', (teamId: string, reason: string) => sendToRenderer(IPC.TEAM_CANCELLED, teamId, reason)],
    ['team:paused', (teamId: string) => sendToRenderer(IPC.TEAM_PAUSED, teamId)],
    ['team:resumed', (teamId: string) => sendToRenderer(IPC.TEAM_RESUMED, teamId)],
    ['team:updated', (teamId: string, updates: any) => sendToRenderer(IPC.TEAM_UPDATED, teamId, updates)],
    ['team:health-issue', (teamId: string, issue: any) => sendToRenderer('team:health-issue', teamId, issue)],
  ] as const

  for (const [event, handler] of events) {
    teamManager.on(event, handler)
  }
}

export function registerTeamHandlers(deps: IpcDependencies): void {
  const { teamManager } = deps

  // 连接所有团队事件（避免重复注册）
  wireTeamEvents(teamManager)

  // 基础 CRUD
  ipcMain.handle(IPC.TEAM_CREATE, async (_event, request: any) => {
    try {
      const team = await teamManager.createTeam(request)
      return { success: true, team }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_GET_ALL, async (_event, status?: string) => {
    try {
      const teams = teamManager.getAllTeams(status)
      return { success: true, teams }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_GET, async (_event, teamId: string) => {
    try {
      const team = teamManager.getTeam(teamId)
      return { success: true, team }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_GET_TASKS, async (_event, teamId: string, status?: string) => {
    try {
      const tasks = teamManager.getTeamTasks(teamId, status)
      return { success: true, tasks }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_GET_MESSAGES, async (_event, teamId: string, limit?: number) => {
    try {
      const messages = teamManager.getTeamMessages(teamId, limit)
      return { success: true, messages }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_CREATE_TASK, async (_event, teamId: string, task: any) => {
    try {
      const newTask = teamManager.createTask(teamId, task)
      return { success: true, task: newTask }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_COMPLETE_TASK, async (_event, teamId: string, taskId: string, result: string) => {
    try {
      teamManager.completeTask(teamId, taskId, result)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_GET_TEMPLATES, async () => {
    try {
      const templates = teamManager.getFullTemplates()
      return { success: true, templates }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('team:get-health', async (_event, teamId: string) => {
    try {
      const health = await teamManager.getHealthStatus(teamId)
      return { success: true, health }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('team:cleanup', async (_event, teamId: string) => {
    try {
      teamManager.cleanupTeam(teamId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- 阶段 1: DAG ----
  ipcMain.handle(IPC.TEAM_GET_TASK_DAG, async (_event, teamId: string) => {
    try {
      const dag = teamManager.getTaskDAG(teamId)
      const validation = teamManager.validateTaskDependencies(teamId)
      return { success: true, dag, validation }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_VALIDATE_DEPENDENCIES, async (_event, teamId: string) => {
    try {
      const validation = teamManager.validateTaskDependencies(teamId)
      return { success: true, validation }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- 阶段 2: 团队生命周期 ----
  ipcMain.handle(IPC.TEAM_CANCEL, async (_event, teamId: string, reason?: string) => {
    try {
      teamManager.cancelTeam(teamId, reason)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_PAUSE, async (_event, teamId: string) => {
    try {
      teamManager.pauseTeam(teamId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_RESUME, async (_event, teamId: string) => {
    try {
      teamManager.resumeTeam(teamId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_UPDATE, async (_event, teamId: string, updates: any) => {
    try {
      teamManager.updateTeam(teamId, updates)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- 阶段 3: 任务编辑 ----
  ipcMain.handle(IPC.TEAM_UPDATE_TASK, async (_event, teamId: string, taskId: string, updates: any) => {
    try {
      const task = teamManager.updateTask(teamId, taskId, updates)
      return { success: true, task }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_CANCEL_TASK, async (_event, teamId: string, taskId: string, reason?: string) => {
    try {
      teamManager.cancelTask(teamId, taskId, reason)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_REASSIGN_TASK, async (_event, teamId: string, taskId: string, newMemberId: string) => {
    try {
      teamManager.reassignTask(teamId, taskId, newMemberId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- 阶段 4: 模板 CRUD ----
  ipcMain.handle(IPC.TEAM_CREATE_TEMPLATE, async (_event, template: any) => {
    try {
      const created = teamManager.createTemplate(template)
      return { success: true, template: created }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_UPDATE_TEMPLATE, async (_event, templateId: string, updates: any) => {
    try {
      const template = teamManager.updateTemplate(templateId, updates)
      return { success: true, template }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_DELETE_TEMPLATE, async (_event, templateId: string) => {
    try {
      teamManager.deleteTemplate(templateId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- 阶段 5: UI 发消息 ----
  ipcMain.handle(IPC.TEAM_SEND_MESSAGE, async (_event, teamId: string, toMemberId: string, content: string) => {
    try {
      const message = teamManager.sendUIMessage(teamId, toMemberId, content)
      return { success: true, message }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_UI_BROADCAST, async (_event, teamId: string, content: string) => {
    try {
      const message = teamManager.broadcastFromUI(teamId, content)
      return { success: true, message }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- 阶段 7: 导出 ----
  ipcMain.handle(IPC.TEAM_EXPORT, async (_event, teamId: string) => {
    try {
      const snapshot = teamManager.exportTeam(teamId)
      return { success: true, snapshot }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_IMPORT, async (_event, snapshot: any) => {
    try {
      const team = await teamManager.importTeam(snapshot)
      return { success: true, team }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.TEAM_MERGE_WORKTREES, async (_event, teamId: string, options?: any) => {
    try {
      const results = await teamManager.mergeTeamWorktrees(teamId, options)
      return { success: true, results }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
