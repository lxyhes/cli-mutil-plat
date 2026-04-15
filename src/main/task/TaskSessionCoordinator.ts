/**
 * TaskSessionCoordinator - 任务与会话状态自动联动协调器
 * 监听会话状态变化和 OutputParser 活动事件，自动更新关联任务状态
 * @author weibin
 */

import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionStatus, ActivityEventType, TaskStatus } from '../../shared/types'

/** 会话状态 → 任务状态映射规则 */
const SESSION_TO_TASK: Partial<Record<SessionStatus, { target: TaskStatus; validFrom: TaskStatus[] }>> = {
  running:       { target: 'in_progress', validFrom: ['todo', 'waiting'] },
  idle:          { target: 'in_progress', validFrom: ['todo', 'waiting'] },
  waiting_input: { target: 'waiting',     validFrom: ['in_progress'] },
  error:         { target: 'waiting',     validFrom: ['in_progress'] },
}

/** 活动事件 → 任务状态映射规则 */
const ACTIVITY_TO_TASK: Partial<Record<ActivityEventType, TaskStatus>> = {
  task_complete:        'done',
  error:               'waiting',
  waiting_confirmation: 'waiting',
}

export class TaskSessionCoordinator extends EventEmitter {
  private database: DatabaseManager
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private evaluationService: any = null  // ★ EvaluationService 引用

  constructor(database: DatabaseManager) {
    super()
    this.database = database
  }

  /**
   * ★ 设置 EvaluationService 引用
   */
  setEvaluationService(evaluationService: any): void {
    this.evaluationService = evaluationService
    console.log('[TaskSessionCoordinator] EvaluationService 已连接')
  }

  /**
   * 会话状态变化时调用
   */
  onSessionStatusChange(sessionId: string, status: SessionStatus): void {
    const taskId = this.getTaskIdForSession(sessionId)
    if (!taskId) return

    const rule = SESSION_TO_TASK[status]
    if (!rule) {
      // completed/terminated 需要特殊处理：检查是否有其他活跃会话
      if (status === 'completed' || status === 'terminated') {
        this.handleSessionCompleted(taskId, sessionId)
      }
      return
    }

    this.debouncedUpdate(taskId, rule.target, rule.validFrom)
  }

  /**
   * 活动事件（OutputParser）时调用
   */
  onActivityEvent(sessionId: string, activityType: ActivityEventType): void {
    const taskId = this.getTaskIdForSession(sessionId)
    if (!taskId) return

    const targetStatus = ACTIVITY_TO_TASK[activityType]
    if (!targetStatus) return

    if (targetStatus === 'done') {
      // task_complete 仍代表明确任务完成信号（非 turn_complete）
      this.debouncedUpdate(taskId, 'done', ['todo', 'in_progress', 'waiting'])
    } else {
      this.debouncedUpdate(taskId, targetStatus, ['in_progress'])
    }
  }

  /**
   * 会话完成/终止时的多会话边界处理
   */
  private handleSessionCompleted(taskId: string, completedSessionId: string): void {
    const allSessions = this.database.getAllSessions()
    const hasOtherActive = allSessions.some(s =>
      s.id !== completedSessionId &&
      s.taskId === taskId &&
      (s.status === 'running' || s.status === 'idle' || s.status === 'waiting_input' || s.status === 'starting')
    )

    if (!hasOtherActive) {
      this.debouncedUpdate(taskId, 'done', ['in_progress', 'waiting'])
    }
  }

  /**
   * 1 秒防抖更新任务状态
   */
  private debouncedUpdate(taskId: string, targetStatus: TaskStatus, validFromStatuses: TaskStatus[]): void {
    const existing = this.debounceTimers.get(taskId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.debounceTimers.delete(taskId)
      this.applyTaskUpdate(taskId, targetStatus, validFromStatuses)
    }, 1000)

    this.debounceTimers.set(taskId, timer)
  }

  /**
   * 实际执行任务状态更新
   */
  private applyTaskUpdate(taskId: string, targetStatus: TaskStatus, validFromStatuses: TaskStatus[]): void {
    try {
      const task = this.database.getTask(taskId)
      if (!task) return

      const currentStatus = task.status as TaskStatus
      if (!validFromStatuses.includes(currentStatus)) return
      if (currentStatus === targetStatus) return

      this.database.updateTask(taskId, { status: targetStatus })
      this.emit('task-updated', taskId, { status: targetStatus })

      // ★ 新增: 任务完成时自动触发评估
      if (targetStatus === 'done' && this.evaluationService) {
        this.autoEvaluateTask(taskId, task)
      }
    } catch (err) {
      console.error('[TaskSessionCoordinator] Failed to update task:', err)
    }
  }

  /**
   * ★ 自动评估已完成的任务
   */
  private async autoEvaluateTask(taskId: string, task: any): Promise<void> {
    try {
      // 检查是否有关联的会话
      const sessionId = task.sessionId
      if (!sessionId) {
        console.log(`[TaskSessionCoordinator] 任务 ${taskId} 无关联会话,跳过评估`)
        return
      }

      // 使用默认评估模板(如果配置了)
      const templates = this.database.listEvaluationTemplates()
      if (templates.length === 0) {
        console.log(`[TaskSessionCoordinator] 无评估模板,跳过评估`)
        return
      }

      // 使用第一个模板进行评估
      const defaultTemplate = templates[0]
      console.log(`[TaskSessionCoordinator] 自动评估任务 ${taskId},使用模板 ${defaultTemplate.name}`)

      await this.evaluationService.evaluate(sessionId, defaultTemplate.id, 'scheduled')

      this.emit('task-auto-evaluated', taskId)
    } catch (err) {
      console.warn(`[TaskSessionCoordinator] 自动评估任务 ${taskId} 失败:`, err)
      // 不阻断任务完成流程
    }
  }

  /**
   * 根据 sessionId 查找关联的 taskId
   */
  private getTaskIdForSession(sessionId: string): string | undefined {
    try {
      const allSessions = this.database.getAllSessions()
      const session = allSessions.find(s => s.id === sessionId)
      return session?.taskId
    } catch {
      return undefined
    }
  }

  /**
   * 清理所有防抖定时器
   */
  cleanup(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
  }

  // ── ★ 链条打通: 创建看板任务 ────────────────────────────

  /**
   * 创建看板任务
   * 供 PlannerService 调用以同步规划任务到看板
   * 
   * @param taskData 任务数据
   * @returns 创建的看板任务
   */
  createTask(taskData: {
    id: string
    title: string
    description?: string
    status?: string
    priority?: string
    tags?: string[]
    sessionId?: string
    metadata?: Record<string, any>
  }): any {
    try {
      const task = this.database.createTask({
        id: taskData.id,
        title: taskData.title,
        description: taskData.description,
        status: taskData.status || 'todo',
        priority: taskData.priority || 'medium',
        tags: taskData.tags || [],
      })

      if (task && taskData.sessionId) {
        // 关联会话
        this.database.updateTask(taskData.id, {
          sessionId: taskData.sessionId,
          metadata: taskData.metadata || {}
        } as any)
      }

      // 触发事件
      if (task) {
        this.emit('task-created', task)
      }

      return task
    } catch (err) {
      console.error('[TaskSessionCoordinator] Failed to create task:', err)
      throw err
    }
  }
}
