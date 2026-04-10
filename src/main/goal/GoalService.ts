/**
 * GoalService - 目标锚点核心服务
 * 管理目标生命周期、活动记录、会话关联
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { Goal, GoalActivity, GoalSession, GoalStats } from '../storage/repositories/GoalRepository'
import type { GoalStatus, GoalPriority, GoalActivityType } from '../storage/repositories/GoalRepository'

export class GoalService extends EventEmitter {
  constructor(private db: DatabaseManager) {
    super()
  }

  // ── CRUD ────────────────────────────────────────────────

  createGoal(data: {
    title: string
    description?: string
    targetDate?: string
    priority?: GoalPriority
    tags?: string[]
    createdBy?: string
  }): Goal | null {
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const goal = this.db.createGoal({
      id,
      title: data.title,
      description: data.description,
      targetDate: data.targetDate,
      priority: data.priority || 'medium',
      tags: data.tags || [],
      createdBy: data.createdBy,
    })
    if (goal) {
      this.emit('goal-created', goal)
      sendToRenderer(IPC.GOAL_STATUS, { type: 'goal-created', goal })
    }
    return goal
  }

  getGoal(id: string): Goal | null {
    return this.db.getGoal(id)
  }

  listGoals(status?: GoalStatus): Goal[] {
    return this.db.listGoals(status)
  }

  updateGoal(id: string, updates: {
    title?: string
    description?: string
    targetDate?: string
    status?: GoalStatus
    priority?: GoalPriority
    tags?: string[]
    progress?: number
  }): Goal | null {
    const oldGoal = this.db.getGoal(id)
    const updated = this.db.updateGoal(id, updates)
    if (!updated) return null
    const goal = this.db.getGoal(id)
    if (goal && oldGoal?.status !== goal.status && goal.status === 'achieved') {
      this.emit('goal-achieved', goal)
      sendToRenderer(IPC.GOAL_STATUS, { type: 'goal-achieved', goal })
    } else if (goal) {
      this.emit('goal-updated', goal)
      sendToRenderer(IPC.GOAL_STATUS, { type: 'goal-updated', goal })
    }
    return goal
  }

  deleteGoal(id: string): boolean {
    const goal = this.db.getGoal(id)
    const deleted = this.db.deleteGoal(id)
    if (deleted) {
      this.emit('goal-deleted', { goalId: id })
      sendToRenderer(IPC.GOAL_STATUS, { type: 'goal-deleted', goalId: id })
    }
    return deleted
  }

  // ── Activities ───────────────────────────────────────────

  addActivity(data: {
    goalId: string
    type: GoalActivityType
    content: string
    progressBefore?: number
    progressAfter?: number
    sessionId?: string
  }): GoalActivity | null {
    const id = `ga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const activity = this.db.addGoalActivity({
      id,
      ...data,
    })
    if (activity) {
      // 如果有进度变化，自动更新目标进度
      if (data.progressAfter !== undefined && data.progressAfter !== data.progressBefore) {
        this.db.updateGoal(data.goalId, { progress: data.progressAfter })
      }
      this.emit('activity-added', activity)
      sendToRenderer(IPC.GOAL_STATUS, { type: 'activity-added', activity })
    }
    return activity
  }

  listActivities(goalId: string, limit?: number): GoalActivity[] {
    return this.db.listGoalActivities(goalId, limit)
  }

  // ── Sessions ────────────────────────────────────────────

  linkSession(goalId: string, sessionId: string, isPrimary = false): GoalSession | null {
    const id = `gs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return this.db.linkGoalSession({ id, goalId, sessionId, isPrimary })
  }

  unlinkSession(goalId: string, sessionId: string): boolean {
    return this.db.unlinkGoalSession(goalId, sessionId)
  }

  getSessionsByGoal(goalId: string): GoalSession[] {
    return this.db.getGoalSessions(goalId)
  }

  // ── Remind ──────────────────────────────────────────────

  remindGoal(goalId: string, sessionId: string): string {
    const goal = this.db.getGoal(goalId)
    if (!goal) return ''
    const reminder = `🎯 目标提醒：【${goal.title}】${goal.description ? `- ${goal.description}` : ''} 当前进度: ${goal.progress}%`
    // 关联会话
    this.linkSession(goalId, sessionId, false)
    // 记录提醒活动
    this.addActivity({
      goalId,
      type: 'reminder',
      content: `向会话 ${sessionId} 发送提醒`,
      sessionId,
    })
    this.emit('reminder-sent', { goalId, sessionId, reminder })
    sendToRenderer(IPC.GOAL_STATUS, { type: 'reminder-sent', goalId, sessionId })
    return reminder
  }

  // ── Query helpers ───────────────────────────────────────

  getGoalsDueSoon(days = 7): Goal[] {
    return this.db.getGoalsDueSoon(days)
  }

  getActiveGoals(): Goal[] {
    return this.db.getActiveGoals()
  }

  getStats(): GoalStats {
    return this.db.getGoalStats()
  }

  // ── Auto-progress suggestion ────────────────────────────

  suggestProgress(goalId: string): number | null {
    const activities = this.db.listGoalActivities(goalId, 5)
    const checkpoints = activities.filter(a => a.type === 'checkpoint')
    if (checkpoints.length > 0) {
      // 基于 checkpoint 数量估算进度
      const estimated = Math.min(100, checkpoints.length * 20)
      return estimated
    }
    return null
  }
}
