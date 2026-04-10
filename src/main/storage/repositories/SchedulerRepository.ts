/**
 * SchedulerRepository - 定时任务相关数据库操作
 */
export type ScheduleType = 'interval' | 'cron' | 'once' | 'daily' | 'weekly'
export type TaskType = 'prompt' | 'workflow' | 'agent_task' | 'cleanup' | 'notification'
export type TaskRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
export type TriggerType = 'scheduled' | 'manual' | 'api' | 'retry'

export interface ScheduledTask {
  id: string
  name: string
  description?: string
  taskType: TaskType
  scheduleType: ScheduleType
  cronExpression?: string
  intervalSeconds?: number
  config: string  // JSON: { prompt, providerId, workspaceId }
  targetSessionId?: string
  targetWorkspaceId?: string
  isEnabled: boolean
  isPaused: boolean
  maxFailures: number
  timeoutSeconds?: number
  createdBy?: string
  createdAt?: Date
  updatedAt?: Date
  lastRunAt?: Date
  nextRunAt?: Date
}

export interface TaskRun {
  id: string
  scheduledTaskId: string
  status: TaskRunStatus
  startedAt?: Date
  completedAt?: Date
  durationMs?: number
  sessionId?: string
  output?: string
  error?: string
  triggerType: TriggerType
  triggeredBy?: string
  attemptNumber: number
  previousRunId?: string
  estimatedTokens?: number
}

export class SchedulerRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  // ── ScheduledTask CRUD ─────────────────────────────────────

  getAllTasks(): ScheduledTask[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM scheduled_tasks ORDER BY created_at DESC'
      ).all() as any[]
      return rows.map(this.mapTask)
    } catch { return [] }
  }

  getTask(id: string): ScheduledTask | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as any
      return row ? this.mapTask(row) : null
    } catch { return null }
  }

  getEnabledTasks(): ScheduledTask[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM scheduled_tasks WHERE is_enabled = 1 AND is_paused = 0'
      ).all() as any[]
      return rows.map(this.mapTask)
    } catch { return [] }
  }

  getTasksDueNext(): ScheduledTask[] {
    if (!this.usingSqlite) return []
    try {
      const now = new Date().toISOString()
      const rows = this.db.prepare(
        'SELECT * FROM scheduled_tasks WHERE is_enabled = 1 AND is_paused = 0 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT 10'
      ).all(now) as any[]
      return rows.map(this.mapTask)
    } catch { return [] }
  }

  createTask(task: Omit<ScheduledTask, 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'>): ScheduledTask {
    const now = new Date().toISOString()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO scheduled_tasks
          (id, name, description, task_type, schedule_type, cron_expression, interval_seconds,
           config, target_session_id, target_workspace_id, is_enabled, is_paused,
           max_failures, timeout_seconds, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id, task.name, task.description || null, task.taskType, task.scheduleType,
        task.cronExpression || null, task.intervalSeconds || null,
        task.config, task.targetSessionId || null, task.targetWorkspaceId || null,
        task.isEnabled ? 1 : 0, task.isPaused ? 1 : 0,
        task.maxFailures ?? 3, task.timeoutSeconds || null,
        task.createdBy || null, now, now
      )
    }
    return { ...task, createdAt: new Date(now), updatedAt: new Date(now) }
  }

  updateTask(id: string, updates: Partial<ScheduledTask>): void {
    if (!this.usingSqlite) return
    const fields: string[] = ['updated_at = ?']
    const values: any[] = [new Date().toISOString()]

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.scheduleType !== undefined) { fields.push('schedule_type = ?'); values.push(updates.scheduleType) }
    if (updates.cronExpression !== undefined) { fields.push('cron_expression = ?'); values.push(updates.cronExpression) }
    if (updates.intervalSeconds !== undefined) { fields.push('interval_seconds = ?'); values.push(updates.intervalSeconds) }
    if (updates.config !== undefined) { fields.push('config = ?'); values.push(updates.config) }
    if (updates.isEnabled !== undefined) { fields.push('is_enabled = ?'); values.push(updates.isEnabled ? 1 : 0) }
    if (updates.isPaused !== undefined) { fields.push('is_paused = ?'); values.push(updates.isPaused ? 1 : 0) }
    if (updates.lastRunAt !== undefined) { fields.push('last_run_at = ?'); values.push(updates.lastRunAt ? new Date(updates.lastRunAt).toISOString() : null) }
    if (updates.nextRunAt !== undefined) { fields.push('next_run_at = ?'); values.push(updates.nextRunAt ? new Date(updates.nextRunAt).toISOString() : null) }

    values.push(id)
    this.db.prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteTask(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  }

  // ── TaskRun CRUD ──────────────────────────────────────────

  createTaskRun(run: Omit<TaskRun, 'startedAt'>): TaskRun {
    const now = new Date()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO task_runs
          (id, scheduled_task_id, status, started_at, trigger_type, triggered_by, attempt_number, previous_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id, run.scheduledTaskId, run.status, now.toISOString(),
        run.triggerType, run.triggeredBy || null, run.attemptNumber, run.previousRunId || null
      )
    }
    return { ...run, startedAt: now }
  }

  updateTaskRun(id: string, updates: Partial<TaskRun>): void {
    if (!this.usingSqlite) return
    const fields: string[] = []
    const values: any[] = []

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt ? new Date(updates.completedAt).toISOString() : null) }
    if (updates.durationMs !== undefined) { fields.push('duration_ms = ?'); values.push(updates.durationMs) }
    if (updates.sessionId !== undefined) { fields.push('session_id = ?'); values.push(updates.sessionId) }
    if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output) }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error) }
    if (updates.estimatedTokens !== undefined) { fields.push('estimated_tokens = ?'); values.push(updates.estimatedTokens) }

    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE task_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  getTaskRuns(scheduledTaskId: string, limit = 50): TaskRun[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM task_runs WHERE scheduled_task_id = ? ORDER BY started_at DESC LIMIT ?'
      ).all(scheduledTaskId, limit) as any[]
      return rows.map(this.mapRun)
    } catch { return [] }
  }

  getRunningTasks(): TaskRun[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        "SELECT * FROM task_runs WHERE status = 'running'"
      ).all() as any[]
      return rows.map(this.mapRun)
    } catch { return [] }
  }

  getRecentRuns(limit = 20): TaskRun[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM task_runs ORDER BY started_at DESC LIMIT ?'
      ).all(limit) as any[]
      return rows.map(this.mapRun)
    } catch { return [] }
  }

  getConsecutiveFailures(taskId: string): number {
    if (!this.usingSqlite) return 0
    try {
      const rows = this.db.prepare(
        "SELECT status FROM task_runs WHERE scheduled_task_id = ? ORDER BY started_at DESC LIMIT ?"
      ).all(taskId, 10) as any[]
      let failures = 0
      for (const row of rows) {
        if (row.status === 'failed') failures++
        else if (row.status === 'completed') break
        else break
      }
      return failures
    } catch { return 0 }
  }

  // ── 映射器 ────────────────────────────────────────────────

  private mapTask(row: any): ScheduledTask {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      taskType: row.task_type as TaskType,
      scheduleType: row.schedule_type as ScheduleType,
      cronExpression: row.cron_expression || undefined,
      intervalSeconds: row.interval_seconds || undefined,
      config: row.config,
      targetSessionId: row.target_session_id || undefined,
      targetWorkspaceId: row.target_workspace_id || undefined,
      isEnabled: !!row.is_enabled,
      isPaused: !!row.is_paused,
      maxFailures: row.max_failures ?? 3,
      timeoutSeconds: row.timeout_seconds || undefined,
      createdBy: row.created_by || undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined,
      nextRunAt: row.next_run_at ? new Date(row.next_run_at) : undefined,
    }
  }

  private mapRun(row: any): TaskRun {
    return {
      id: row.id,
      scheduledTaskId: row.scheduled_task_id,
      status: row.status as TaskRunStatus,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      durationMs: row.duration_ms || undefined,
      sessionId: row.session_id || undefined,
      output: row.output || undefined,
      error: row.error || undefined,
      triggerType: row.trigger_type as TriggerType,
      triggeredBy: row.triggered_by || undefined,
      attemptNumber: row.attempt_number ?? 1,
      previousRunId: row.previous_run_id || undefined,
      estimatedTokens: row.estimated_tokens || undefined,
    }
  }
}
