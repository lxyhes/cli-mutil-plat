/**
 * Goal IPC Handlers - 目标锚点的 IPC 接口
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { GoalService } from '../goal/GoalService'

export function registerGoalHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const goalService: GoalService | undefined = (deps as any).goalService

  // CREATE 目标
  ipcMain.handle(IPC.GOAL_CREATE, async (_event, data: {
    title: string
    description?: string
    targetDate?: string
    priority?: string
    tags?: string[]
    createdBy?: string
  }) => {
    try {
      const goal = goalService
        ? goalService.createGoal(data as any)
        : database.createGoal(data as any)
      if (!goal) return createErrorResponse(new Error('Failed to create goal'), { operation: 'goal.create' })
      return createSuccessResponse({ goal })
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.create' })
    }
  })

  // LIST 目标
  ipcMain.handle(IPC.GOAL_LIST, async (_event, status?: string) => {
    try {
      const goals = goalService
        ? goalService.listGoals(status as any)
        : database.listGoals(status as any)
      return goals
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.list' })
    }
  })

  // GET 单个目标
  ipcMain.handle(IPC.GOAL_GET, async (_event, goalId: string) => {
    try {
      const goal = goalService
        ? goalService.getGoal(goalId)
        : database.getGoal(goalId)
      return goal
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.get' })
    }
  })

  // UPDATE 目标
  ipcMain.handle(IPC.GOAL_UPDATE, async (_event, goalId: string, updates: {
    title?: string
    description?: string
    targetDate?: string
    status?: string
    priority?: string
    tags?: string[]
    progress?: number
  }) => {
    try {
      if (!goalService) {
        return createErrorResponse(new Error('GoalService not initialized'), { operation: 'goal.update' })
      }
      const goal = goalService.updateGoal(goalId, updates as any)
      if (!goal) return createErrorResponse(new Error('Goal not found'), { operation: 'goal.update' })
      return createSuccessResponse({ goal })
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.update' })
    }
  })

  // DELETE 目标
  ipcMain.handle(IPC.GOAL_DELETE, async (_event, goalId: string) => {
    try {
      if (!goalService) {
        return createErrorResponse(new Error('GoalService not initialized'), { operation: 'goal.delete' })
      }
      goalService.deleteGoal(goalId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.delete' })
    }
  })

  // ADD_ACTIVITY 目标活动
  ipcMain.handle(IPC.GOAL_ADD_ACTIVITY, async (_event, data: {
    goalId: string
    type: string
    content: string
    progressBefore?: number
    progressAfter?: number
    sessionId?: string
  }) => {
    try {
      if (!goalService) {
        return createErrorResponse(new Error('GoalService not initialized'), { operation: 'goal.add-activity' })
      }
      const activity = goalService.addActivity(data as any)
      if (!activity) return createErrorResponse(new Error('Failed to add activity'), { operation: 'goal.add-activity' })
      return createSuccessResponse({ activity })
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.add-activity' })
    }
  })

  // GET_ACTIVITIES 目标活动列表
  ipcMain.handle(IPC.GOAL_GET_ACTIVITIES, async (_event, goalId: string, limit?: number) => {
    try {
      const activities = goalService
        ? goalService.listActivities(goalId, limit)
        : database.listGoalActivities(goalId, limit)
      return activities
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.get-activities' })
    }
  })

  // LINK_SESSION 目标-会话关联
  ipcMain.handle(IPC.GOAL_LINK_SESSION, async (_event, goalId: string, sessionId: string, isPrimary?: boolean) => {
    try {
      if (!goalService) {
        return createErrorResponse(new Error('GoalService not initialized'), { operation: 'goal.link-session' })
      }
      const link = goalService.linkSession(goalId, sessionId, isPrimary)
      return createSuccessResponse({ link })
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.link-session' })
    }
  })

  // GET_SESSIONS 目标关联的会话
  ipcMain.handle(IPC.GOAL_GET_SESSIONS, async (_event, goalId: string) => {
    try {
      const sessions = goalService
        ? goalService.getSessionsByGoal(goalId)
        : database.getGoalSessions(goalId)
      return sessions
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.get-sessions' })
    }
  })

  // GET_STATS 目标统计
  ipcMain.handle(IPC.GOAL_GET_STATS, async () => {
    try {
      const stats = goalService
        ? goalService.getStats()
        : database.getGoalStats()
      return stats
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.get-stats' })
    }
  })

  // ★ 新增: GENERATE_PLAN 从目标生成规划
  ipcMain.handle(IPC.GOAL_GENERATE_PLAN, async (_event, goalId: string, sessionId: string) => {
    try {
      if (!goalService) {
        return createErrorResponse(new Error('GoalService not initialized'), { operation: 'goal.generate-plan' })
      }
      const plan = await goalService.generatePlanFromGoal(goalId, sessionId)
      if (!plan) return createErrorResponse(new Error('Failed to generate plan'), { operation: 'goal.generate-plan' })
      return createSuccessResponse({ plan })
    } catch (err) {
      return createErrorResponse(err, { operation: 'goal.generate-plan' })
    }
  })
}
