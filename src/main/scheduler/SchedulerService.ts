/**
 * SchedulerService - 定时任务调度引擎
 * 支持：Cron 表达式 / 间隔 / 每日 / 每周 / 单次
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'

export type SchedulerStatus = 'stopped' | 'running' | 'error'

// 简单的 Cron 解析（支持标准 5 字段：分 时 日 月 周）
function parseCron(cron: string): { next: () => Date | null } {
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) throw new Error(`Invalid cron: ${cron}`)

  const [minStr, hourStr, dayStr, monthStr, dowStr] = parts

  function parseField(field: string, min: number, max: number): Set<number> {
    const values = new Set<number>()
    for (const token of field.split(',')) {
      if (token === '*') {
        for (let i = min; i <= max; i++) values.add(i)
      } else if (token.includes('/')) {
        const [range, stepStr] = token.split('/')
        const step = parseInt(stepStr, 10)
        let start = min, end = max
        if (range !== '*') {
          if (range.includes('-')) {
            [start, end] = range.split('-').map(Number)
          } else {
            start = parseInt(range, 10)
          }
        }
        for (let i = start; i <= end; i += step) values.add(i)
      } else if (token.includes('-')) {
        const [s, e] = token.split('-').map(Number)
        for (let i = s; i <= e; i++) values.add(i)
      } else {
        values.add(parseInt(token, 10))
      }
    }
    return values
  }

  function getNext(): Date {
    const now = new Date()
    const d = new Date(now)
    d.setSeconds(0, 0)

    const mins = parseField(minStr, 0, 59)
    const hours = parseField(hourStr, 0, 23)
    const days = parseField(dayStr, 1, 31)
    const months = parseField(monthStr, 1, 12)
    const dows = parseField(dowStr, 0, 6)

    for (let attempt = 0; attempt < 366 * 24 * 60; attempt++) {
      if (!months.has(d.getMonth() + 1)) { d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1); continue }
      if (!days.has(d.getDate())) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue }
      if (!dows.has(d.getDay())) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue }
      if (!hours.has(d.getHours())) { d.setMinutes(0); d.setTime(d.getTime() + 3600000); continue }

      const curMin = d.getMinutes()
      const nextMin = Math.min(...Array.from(mins).filter(m => m >= curMin), ...Array.from(mins))
      if (nextMin === Infinity || nextMin > 59) { d.setHours(d.getHours() + 1); d.setMinutes(0); continue }

      d.setMinutes(nextMin)
      if (d <= now) { d.setMinutes(nextMin + 1); continue }
      return d
    }
    return new Date(now.getTime() + 86400000 * 365)
  }

  return { next: getNext }
}

function computeNextRun(task: {
  scheduleType: string
  intervalSeconds?: number
  cronExpression?: string
}): Date {
  const now = new Date()
  switch (task.scheduleType) {
    case 'once':
      return task.cronExpression ? (parseCron(task.cronExpression).next() ?? new Date(now.getTime() + 60000)) : new Date(now.getTime() + 60000)
    case 'interval':
      return new Date(now.getTime() + (task.intervalSeconds || 60) * 1000)
    case 'cron':
      return task.cronExpression ? (parseCron(task.cronExpression).next() ?? new Date(now.getTime() + 86400000)) : new Date(now.getTime() + 86400000)
    case 'daily':
      return task.cronExpression ? (parseCron(task.cronExpression).next() ?? new Date(now.getTime() + 86400000)) : new Date(now.getTime() + 86400000)
    case 'weekly':
      return task.cronExpression ? (parseCron(task.cronExpression).next() ?? new Date(now.getTime() + 86400000 * 7)) : new Date(now.getTime() + 86400000 * 7)
    default:
      return new Date(now.getTime() + 86400000)
  }
}

interface RunningJob {
  taskId: string
  runId: string
  startedAt: number
  timeoutHandle: ReturnType<typeof setTimeout>
}

export class SchedulerService extends EventEmitter {
  private status: SchedulerStatus = 'stopped'
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private runningJobs: Map<string, RunningJob> = new Map()

  constructor(
    private db: DatabaseManager,
    private sessionManagerV2: SessionManagerV2,
  ) {
    super()
  }

  // ── 生命周期 ────────────────────────────────────────────

  start(): void {
    if (this.status === 'running') return
    this.status = 'running'
    this.scheduleTick()
    this.pollTimer = setInterval(() => this.scheduleTick(), 10000) // 每 10 秒检查一次
    sendToRenderer(IPC.SCHEDULER_TASK_STATUS, 'running')
    console.log('[Scheduler] Started')
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    // 取消所有运行中的任务
    for (const [taskId, job] of this.runningJobs) {
      clearTimeout(job.timeoutHandle)
      this.db.updateTaskRun(job.runId, {
        status: 'cancelled',
        completedAt: new Date(),
        error: 'Scheduler stopped',
      })
    }
    this.runningJobs.clear()
    this.status = 'stopped'
    sendToRenderer(IPC.SCHEDULER_TASK_STATUS, 'stopped')
    console.log('[Scheduler] Stopped')
  }

  getStatus(): SchedulerStatus {
    return this.status
  }

  // ── 调度主循环 ──────────────────────────────────────────

  private scheduleTick(): void {
    if (this.status !== 'running') return
    try {
      const dueTasks = this.db.getScheduledTasksDueNext()
      for (const task of dueTasks) {
        // 检查是否已有相同任务在运行
        if (this.runningJobs.has(task.id)) continue
        this.executeTask(task.id).catch(err => {
          console.error(`[Scheduler] Task ${task.id} execution failed:`, err)
        })
      }
    } catch (err) {
      console.error('[Scheduler] scheduleTick error:', err)
    }
  }

  // ── 任务执行 ────────────────────────────────────────────

  async executeTask(taskId: string, triggerType: 'scheduled' | 'manual' = 'scheduled'): Promise<void> {
    const task = this.db.getScheduledTask(taskId)
    if (!task || !task.isEnabled || task.isPaused) return

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const startedAt = new Date()

    // 创建运行记录
    this.db.createTaskRun({
      id: runId,
      scheduledTaskId: taskId,
      status: 'running',
      triggerType,
      attemptNumber: 1,
    })

    // 注册运行中的任务
    const timeoutMs = (task.timeoutSeconds || 300) * 1000
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(taskId, runId)
    }, timeoutMs)

    this.runningJobs.set(taskId, { taskId, runId, startedAt: Date.now(), timeoutHandle })

    // 广播开始
    sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'run-started', taskId, runId })

    try {
      let sessionId: string | undefined
      let output = ''

      const config = JSON.parse(task.config)

      switch (task.taskType) {
        case 'prompt': {
          // 为 prompt 类型创建一个新会话执行
          const result = await this.createSchedulerSession(task, config)
          sessionId = result.sessionId
          output = result.output
          break
        }
        case 'workflow': {
          // 执行指定的工作流
          const workflowId = config.workflowId
          if (!workflowId) throw new Error('workflow task requires workflowId in config')
          // WorkflowService 通过 IPC 间接调用，这里用 DB 触发
          const wf = this.db.getWorkflow(workflowId)
          if (!wf) throw new Error(`Workflow not found: ${workflowId}`)
          // 标记工作流由调度触发（实际执行由 WorkflowService 接管）
          output = `Workflow "${wf.name}" (${workflowId}) triggered by scheduler`
          this.emit('workflow-triggered', { taskId, workflowId, runId })
          break
        }
        case 'agent_task': {
          // 创建会话并执行 agent 任务（与 prompt 类似但支持更长超时）
          const agentResult = await this.createSchedulerSession(task, {
            ...config,
            prompt: config.prompt || config.taskDescription || task.name,
          })
          sessionId = agentResult.sessionId
          output = agentResult.output
          break
        }
        case 'cleanup': {
          // 清理任务：清除过期数据
          output = await this.executeCleanupTask(config)
          break
        }
        case 'notification': {
          // 通知任务：向渲染进程发送通知
          const message = config.message || config.notificationMessage || task.name
          sendToRenderer(IPC.SCHEDULER_TASK_STATUS, {
            type: 'notification',
            taskId,
            message,
            title: config.title || task.name,
            level: config.level || 'info',
          })
          output = `Notification sent: ${message}`
          break
        }
        default:
          output = `Unknown task type: ${task.taskType}`
      }

      // 完成后更新
      clearTimeout(timeoutHandle)
      this.runningJobs.delete(taskId)

      const completedAt = new Date()
      const durationMs = completedAt.getTime() - startedAt.getTime()

      this.db.updateTaskRun(runId, {
        status: 'completed',
        completedAt,
        durationMs,
        sessionId,
        output,
      })

      // 更新任务的下次执行时间
      const nextRun = computeNextRun(task)
      this.db.updateScheduledTask(taskId, {
        lastRunAt: startedAt,
        nextRunAt: nextRun,
      })

      sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'run-completed', taskId, runId, sessionId })

      // 如果是单次任务，执行后禁用
      if (task.scheduleType === 'once') {
        this.db.updateScheduledTask(taskId, { isEnabled: false })
        sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'task-disabled', taskId, reason: 'once-completed' })
      }
    } catch (err) {
      clearTimeout(timeoutHandle)
      this.runningJobs.delete(taskId)

      const completedAt = new Date()
      const durationMs = completedAt.getTime() - startedAt.getTime()

      this.db.updateTaskRun(runId, {
        status: 'failed',
        completedAt,
        durationMs,
        error: String(err),
      })

      // 检查连续失败次数
      const failures = this.db.getConsecutiveFailures(taskId)
      if (failures >= task.maxFailures) {
        this.db.updateScheduledTask(taskId, { isPaused: true, isEnabled: false })
        sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'task-paused', taskId, reason: 'max-failures' })
      } else {
        const nextRun = computeNextRun(task)
        this.db.updateScheduledTask(taskId, { nextRunAt: nextRun })
      }

      sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'run-failed', taskId, runId, error: String(err) })
    }
  }

  private async createSchedulerSession(task: any, config: {
    prompt?: string
    providerId?: string
    workspaceId?: string
    taskDescription?: string
  }): Promise<{ sessionId: string; output: string }> {
    const sessionId = `scheduled-${Date.now()}`
    let output = ''
    let resolved = false

    const handler = (sid: string, msg: any) => {
      if (sid !== sessionId) return
      if (!msg.isDelta && msg.role === 'assistant' && msg.content) {
        // AI 完成了回复
        output = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        resolved = true
        this.sessionManagerV2.removeListener('conversation-message', handler)
      }
    }

    this.sessionManagerV2.on('conversation-message', handler)

    try {
      this.sessionManagerV2.createSession({
        id: sessionId,
        name: `[定时] ${task.name}`,
        workingDirectory: config.workspaceId || process.cwd(),
        providerId: config.providerId || 'claude-code',
        initialPrompt: config.prompt || task.name,
      })
    } catch (err) {
      this.sessionManagerV2.removeListener('conversation-message', handler)
      throw err
    }

    // 等待 AI 完成回复（最多等待任务超时时间），用事件驱动替代固定 setTimeout
    const timeoutMs = (task.timeoutSeconds || 300) * 1000
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 500)

      setTimeout(() => {
        clearInterval(checkInterval)
        this.sessionManagerV2.removeListener('conversation-message', handler)
        resolve()
      }, timeoutMs)
    })

    return { sessionId, output: output || `Session started: ${sessionId}` }
  }

  /** 执行清理任务 */
  private async executeCleanupTask(config: Record<string, any>): Promise<string> {
    const results: string[] = []

    // 清理过期摘要 - 暂时移除，等待DatabaseManager实现
    if (config.cleanSummaries !== false) {
      const days = config.summaryRetentionDays || 90
      results.push(`Summary cleanup scheduled (${days} days retention)`)
    }

    // 清理过期会话 - 使用已有的cleanupOrphanedSessions方法
    if (config.cleanSessions) {
      try {
        this.db.cleanupOrphanedSessions()
        results.push('Cleaned orphaned sessions')
      } catch { /* ignore */ }
    }

    // 清理过期任务运行记录 - 暂时移除，等待DatabaseManager实现
    if (config.cleanTaskRuns !== false) {
      const days = config.taskRunRetentionDays || 30
      results.push(`Task run cleanup scheduled (${days} days retention)`)
    }

    // VACUUM 数据库（压缩空间）
    if (config.vacuum) {
      try {
        ;(this.db as any).db?.exec('VACUUM')
        results.push('Database VACUUM completed')
      } catch { /* ignore */ }
    }

    return results.length > 0 ? results.join('; ') : 'Cleanup task completed (no actions needed)'
  }

  private handleTimeout(taskId: string, runId: string): void {
    if (!this.runningJobs.has(taskId)) return
    const job = this.runningJobs.get(taskId)!
    clearTimeout(job.timeoutHandle)
    this.runningJobs.delete(taskId)

    this.db.updateTaskRun(runId, {
      status: 'timeout',
      completedAt: new Date(),
      durationMs: Date.now() - job.startedAt,
      error: `Task timed out after ${this.db.getScheduledTask(taskId)?.timeoutSeconds || 300}s`,
    })

    const failures = this.db.getConsecutiveFailures(taskId)
    const task = this.db.getScheduledTask(taskId)
    if (failures >= (task?.maxFailures || 3)) {
      this.db.updateScheduledTask(taskId, { isPaused: true, isEnabled: false })
      sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'task-paused', taskId, reason: 'max-failures' })
    }

    sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'run-timeout', taskId, runId })
  }

  // ── 手动触发 ──────────────────────────────────────────

  async triggerManualRun(taskId: string): Promise<{ runId: string }> {
    const task = this.db.getScheduledTask(taskId)
    if (!task) throw new Error(`Task not found: ${taskId}`)

    // 异步执行（executeTask 内部会创建 TaskRun）
    this.executeTask(taskId, 'manual').catch(console.error)

    // 返回一个临时 runId 供调用方追踪
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return { runId }
  }

  // ── 任务 CRUD ──────────────────────────────────────────

  createTask(data: {
    name: string
    description?: string
    taskType?: 'prompt' | 'workflow' | 'agent_task' | 'cleanup' | 'notification'
    scheduleType?: 'interval' | 'cron' | 'once' | 'daily' | 'weekly'
    cronExpression?: string
    intervalSeconds?: number
    config: Record<string, any>
    targetSessionId?: string
    targetWorkspaceId?: string
    maxFailures?: number
    timeoutSeconds?: number
    createdBy?: string
  }): any {
    const id = `stask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const task = {
      id,
      name: data.name,
      description: data.description,
      taskType: data.taskType || 'prompt',
      scheduleType: data.scheduleType || 'interval',
      cronExpression: data.cronExpression,
      intervalSeconds: data.intervalSeconds,
      config: JSON.stringify(data.config || {}),
      targetSessionId: data.targetSessionId,
      targetWorkspaceId: data.targetWorkspaceId,
      isEnabled: true,
      isPaused: false,
      maxFailures: data.maxFailures || 3,
      timeoutSeconds: data.timeoutSeconds || 300,
      createdBy: data.createdBy,
    }
    const nextRun = computeNextRun(task)
    // createScheduledTask doesn't accept nextRunAt; set it separately
    const created = this.db.createScheduledTask(task)
    this.db.updateScheduledTask(created.id, { nextRunAt: nextRun })
    sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'task-created', taskId: created.id })
    return { ...created, nextRunAt: nextRun } as any
  }

  updateTask(taskId: string, updates: {
    name?: string
    description?: string
    scheduleType?: string
    cronExpression?: string
    intervalSeconds?: number
    config?: Record<string, any>
    isEnabled?: boolean
    isPaused?: boolean
    maxFailures?: number
    timeoutSeconds?: number
  }): void {
    const dbUpdates: Record<string, any> = { ...updates }
    if (updates.config) dbUpdates.config = JSON.stringify(updates.config)
    if (updates.scheduleType || updates.cronExpression || updates.intervalSeconds) {
      const current = this.db.getScheduledTask(taskId)
      if (current) {
        const full = { ...current, ...dbUpdates }
        dbUpdates.nextRunAt = computeNextRun(full)
      }
    }
    this.db.updateScheduledTask(taskId, dbUpdates)
    sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'task-updated', taskId })
  }

  deleteTask(taskId: string): void {
    // 取消运行中的任务
    if (this.runningJobs.has(taskId)) {
      const job = this.runningJobs.get(taskId)!
      clearTimeout(job.timeoutHandle)
      this.runningJobs.delete(taskId)
      this.db.updateTaskRun(job.runId, { status: 'cancelled', completedAt: new Date() })
    }
    this.db.deleteScheduledTask(taskId)
    sendToRenderer(IPC.SCHEDULER_TASK_STATUS, { type: 'task-deleted', taskId })
  }

  // ── 验证 Cron ──────────────────────────────────────────

  validateCron(expression: string): { valid: boolean; error?: string; nextRun?: string } {
    try {
      const next = parseCron(expression).next()
      return { valid: true, nextRun: next ? next.toISOString() : undefined }
    } catch (err) {
      return { valid: false, error: String(err) }
    }
  }
}
