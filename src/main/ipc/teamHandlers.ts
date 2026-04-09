/**
 * Agent Teams - IPC Handlers
 * 
 * 团队相关的 IPC 接口
 * 
 * @author weibin
 */

import { ipcMain } from 'electron'
import type { TeamManager } from '../team/TeamManager'
import type { CreateTeamRequest } from '../team/types'
import { IPC } from '../../shared/constants'

export interface IpcDependencies {
  teamManager: TeamManager
}

export function registerTeamHandlers(deps: IpcDependencies): void {
  const { teamManager } = deps

  /**
   * 创建团队
   */
  ipcMain.handle(IPC.TEAM_CREATE, async (_event, request: CreateTeamRequest) => {
    try {
      const team = await teamManager.createTeam(request)
      return { success: true, team }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 获取所有团队
   */
  ipcMain.handle(IPC.TEAM_GET_ALL, async (_event, status?: string) => {
    try {
      const teams = teamManager.getAllTeams(status)
      return { success: true, teams }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 获取团队详情
   */
  ipcMain.handle(IPC.TEAM_GET, async (_event, teamId: string) => {
    try {
      const team = teamManager.getTeam(teamId)
      return { success: true, team }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 获取团队任务
   */
  ipcMain.handle(IPC.TEAM_GET_TASKS, async (_event, teamId: string, status?: string) => {
    try {
      const tasks = teamManager.getTeamTasks(teamId, status)
      return { success: true, tasks }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 获取团队消息
   */
  ipcMain.handle(IPC.TEAM_GET_MESSAGES, async (_event, teamId: string, limit?: number) => {
    try {
      const messages = teamManager.getTeamMessages(teamId, limit)
      return { success: true, messages }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 创建任务
   */
  ipcMain.handle(IPC.TEAM_CREATE_TASK, async (_event, teamId: string, task: any) => {
    try {
      const newTask = teamManager.createTask(teamId, task)
      return { success: true, task: newTask }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 完成任务
   */
  ipcMain.handle(IPC.TEAM_COMPLETE_TASK, async (_event, teamId: string, taskId: string, result: string) => {
    try {
      teamManager.completeTask(teamId, taskId, result)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /**
   * 获取团队模板列表
   */
  ipcMain.handle(IPC.TEAM_GET_TEMPLATES, async () => {
    try {
      const templates = teamManager.getBuiltinTemplates()
      return { success: true, templates }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
