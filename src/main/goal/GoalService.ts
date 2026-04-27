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

  // ── ★ 链条打通: Goal → Planner ─────────────────────────

  private plannerService: any = null  // PlannerService 引用

  /**
   * 设置 PlannerService 引用
   */
  setPlannerService(plannerService: any): void {
    this.plannerService = plannerService
    console.log('[GoalService] PlannerService 已连接')
  }

  /**
   * 从 Goal 一键生成 Planner 规划
   * 将目标自动分解为规划任务列表
   * 
   * @param goalId 目标ID
   * @param sessionId 执行分解的会话ID
   * @returns 创建的规划对象,如果失败返回null
   */
  async generatePlanFromGoal(goalId: string, sessionId: string): Promise<any> {
    if (!this.plannerService) {
      throw new Error('PlannerService 未配置,无法生成规划')
    }

    // 获取目标详情
    const goal = this.db.getGoal(goalId)
    if (!goal) {
      throw new Error(`目标 ${goalId} 不存在`)
    }

    // 构建目标描述用于 AI 分解
    const goalDescription = `${goal.title}\n\n${goal.description || ''}`

    console.log(`[GoalService] 从目标生成规划: ${goal.title}`)

    // 调用 PlannerService 创建规划
    const result = await this.plannerService.createPlan({
      sessionId,
      goalId,
      goal: goalDescription,
    })

    if (!result?.planSession) {
      throw new Error('创建规划失败')
    }

    const planId = result.planSession.id
    this.linkSession(goalId, sessionId, true)

    // 将规划与目标关联(通过活动记录)
    this.addActivity({
      goalId,
      type: 'note',
      content: JSON.stringify({ planId, type: 'plan-generated' }),
      progressAfter: goal.progress
    })

    // 触发事件
    this.emit('plan-generated', { goalId, planId })
    sendToRenderer(IPC.GOAL_STATUS, { type: 'plan-generated', goalId, planId })

    return result
  }

  /**
   * ★ 链条打通: Evaluation → Goal
   * 根据评估结果更新目标进度
   * 
   * @param goalId 目标ID
   * @param evaluationScore 评估分数 (0-100)
   * @param evaluationSummary 评估摘要
   */
  updateProgressFromEvaluation(goalId: string, evaluationScore: number, evaluationSummary?: string, sessionId?: string): void {
    const goal = this.db.getGoal(goalId)
    if (!goal) {
      throw new Error(`目标 ${goalId} 不存在`)
    }

    // 计算新进度 (评估分数占70%权重,当前进度占30%)
    const currentProgress = goal.progress || 0
    const newProgress = Math.round(currentProgress * 0.3 + evaluationScore * 0.7)
    const clampedProgress = Math.min(100, Math.max(0, newProgress))

    // 更新目标进度
    this.db.updateGoal(goalId, { progress: clampedProgress })

    // 记录评估活动
    this.addActivity({
      goalId,
      type: 'review',
      content: `评估得分: ${evaluationScore}/100${evaluationSummary ? `\n${evaluationSummary}` : ''}`,
      progressBefore: currentProgress,
      progressAfter: clampedProgress,
      sessionId,
    })

    // 如果进度达到100%,自动标记为已达成
    if (clampedProgress >= 100 && goal.status !== 'achieved') {
      this.db.updateGoal(goalId, { status: 'achieved' })
    }

    console.log(`[GoalService] 目标进度更新: ${goal.title} ${currentProgress}% → ${clampedProgress}% (评估: ${evaluationScore})`)

    const updatedGoal = this.db.getGoal(goalId)
    this.emit('evaluation-updated', { goalId, score: evaluationScore, newProgress: clampedProgress, goal: updatedGoal })
    sendToRenderer(IPC.GOAL_STATUS, {
      type: clampedProgress >= 100 ? 'goal-achieved' : 'goal-updated',
      goal: updatedGoal,
    })
    sendToRenderer(IPC.GOAL_STATUS, { type: 'evaluation-updated', goalId, score: evaluationScore, newProgress: clampedProgress })
  }

  /**
   * ★ 链条打通: DriftGuard → Goal
   * 检测到漂移时回退目标进度
   * 
   * @param goalId 目标ID
   * @param driftSeverity 漂移严重程度
   * @param driftSummary 漂移摘要
   */
  regressProgressFromDrift(goalId: string, driftSeverity: string, driftSummary?: string): void {
    const goal = this.db.getGoal(goalId)
    if (!goal) {
      throw new Error(`目标 ${goalId} 不存在`)
    }

    // 根据漂移严重程度决定回退幅度
    const regressAmount = {
      'minor': 5,
      'moderate': 10,
      'severe': 20
    }[driftSeverity] || 0

    if (regressAmount === 0) return  // 无漂移,不回退

    const currentProgress = goal.progress || 0
    const newProgress = Math.max(0, currentProgress - regressAmount)

    // 更新目标进度
    this.db.updateGoal(goalId, { progress: newProgress })

    // 记录漂移活动
    this.addActivity({
      goalId,
      type: 'note',
      content: `⚠️ 检测到${driftSeverity}漂移,进度回退 ${regressAmount}%${driftSummary ? `\n${driftSummary}` : ''}`,
      progressBefore: currentProgress,
      progressAfter: newProgress
    })

    console.log(`[GoalService] 漂移检测回退: ${goal.title} ${currentProgress}% → ${newProgress}% (漂移: ${driftSeverity})`)

    this.emit('drift-regressed', { goalId, severity: driftSeverity, newProgress })
  }
}
