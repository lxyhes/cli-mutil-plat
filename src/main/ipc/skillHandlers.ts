/**
 * Skill 技能管理 IPC 处理器
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { IpcDependencies } from './index'
import { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'

export function registerSkillHandlers(deps: IpcDependencies): void {
  const { database } = deps

  // SKILL_GET_ALL: 获取所有技能
  ipcMain.handle(IPC.SKILL_GET_ALL, async () => {
    try {
      return createSuccessResponse({ data: database.getAllSkills() })
    } catch (err) {
      console.error('[Skill] getAllSkills error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })

  // SKILL_GET: 获取单个技能
  ipcMain.handle(IPC.SKILL_GET, async (_event, id: string) => {
    try {
      const skill = database.getSkill(id)
      if (!skill) throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'Skill not found',
        userMessage: '技能不存在',
        context: { skillId: id }
      })
      return createSuccessResponse({ data: skill })
    } catch (err) {
      console.error('[Skill] getSkill error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })

  // SKILL_CREATE: 创建技能
  ipcMain.handle(IPC.SKILL_CREATE, async (_event, skill: any) => {
    try {
      const created = database.createSkill(skill)
      return createSuccessResponse({ data: created })
    } catch (err) {
      console.error('[Skill] createSkill error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })

  // SKILL_UPDATE: 更新技能
  ipcMain.handle(IPC.SKILL_UPDATE, async (_event, id: string, updates: any) => {
    try {
      database.updateSkill(id, updates)
      return createSuccessResponse({})
    } catch (err) {
      console.error('[Skill] updateSkill error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })

  // SKILL_DELETE: 删除技能
  ipcMain.handle(IPC.SKILL_DELETE, async (_event, id: string) => {
    try {
      const deleted = database.deleteSkill(id)
      if (!deleted) throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'Skill not found or delete failed',
        userMessage: '技能不存在或删除失败',
        context: { skillId: id }
      })
      return createSuccessResponse({})
    } catch (err) {
      console.error('[Skill] deleteSkill error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })

  // SKILL_TOGGLE: 切换技能启用状态
  ipcMain.handle(IPC.SKILL_TOGGLE, async (_event, id: string, enabled: boolean) => {
    try {
      database.toggleSkill(id, enabled)
      return createSuccessResponse({})
    } catch (err) {
      console.error('[Skill] toggleSkill error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })

  // SKILL_GET_BY_COMMAND: 根据 slash 命令查找技能（供前端预览）
  ipcMain.handle(IPC.SKILL_GET_BY_COMMAND, async (_event, command: string) => {
    try {
      return createSuccessResponse({ data: database.getSkillByCommand(command) })
    } catch (err) {
      console.error('[Skill] getSkillByCommand error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })

  // SKILL_EXECUTE: 由 SessionManagerV2 的 /slash 拦截器处理实际执行
  // 此处仅返回 Skill 定义供调用方使用
  ipcMain.handle(IPC.SKILL_EXECUTE, async (_event, command: string) => {
    try {
      const skill = database.getSkillByCommand(command)
      if (!skill) throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'Skill not found',
        userMessage: `技能 '/${command}' 不存在`,
        context: { command }
      })
      return createSuccessResponse({ data: skill })
    } catch (err) {
      console.error('[Skill] executeSkill error:', err)
      return createErrorResponse(err, { operation: 'skill' })
    }
  })
}
