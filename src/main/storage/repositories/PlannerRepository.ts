/**
 * PlannerRepository - 自主规划引擎相关数据库操作
 */
export type PlanStatus = 'pending' | 'running' | 'completed' | 'failed'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'
export type StepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed'
export type Priority = 'low' | 'medium' | 'high' | 'critical'

export interface PlanSession {
  id: string
  sessionId: string
  goalId?: string
  goal: string
  status: PlanStatus
  createdAt?: Date
  updatedAt?: Date
  startedAt?: Date
  completedAt?: Date
}

export interface PlanTask {
  id: string
  planSessionId: string
  title: string
  description?: string
  priority: Priority
  status: TaskStatus
  dependencies: string[]
  createdAt?: Date
  updatedAt?: Date
  completedAt?: Date
}

export interface PlanStep {
  id: string
  planTaskId: string
  description: string
  status: StepStatus
  result?: string
  orderIndex: number
  createdAt?: Date
  completedAt?: Date
}

export class PlannerRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  // ── PlanSession CRUD ─────────────────────────────────────

  getAllSessions(): PlanSession[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM plan_sessions ORDER BY created_at DESC'
      ).all() as any[]
      return rows.map(this.mapSession)
    } catch { return [] }
  }

  getSession(id: string): PlanSession | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM plan_sessions WHERE id = ?').get(id) as any
      return row ? this.mapSession(row) : null
    } catch { return null }
  }

  createSession(session: Omit<PlanSession, 'createdAt' | 'updatedAt'>): PlanSession {
    const now = new Date().toISOString()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO plan_sessions (id, session_id, goal_id, goal, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(session.id, session.sessionId, session.goalId || null, session.goal, session.status, now, now)
    }
    return { ...session, createdAt: new Date(now), updatedAt: new Date(now) }
  }

  updateSession(id: string, updates: Partial<PlanSession>): void {
    if (!this.usingSqlite) return
    const fields: string[] = ['updated_at = ?']
    const values: any[] = [new Date().toISOString()]

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.goalId !== undefined) { fields.push('goal_id = ?'); values.push(updates.goalId || null) }
    if (updates.startedAt !== undefined) { fields.push('started_at = ?'); values.push(updates.startedAt ? new Date(updates.startedAt).toISOString() : null) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt ? new Date(updates.completedAt).toISOString() : null) }
    if (updates.goal !== undefined) { fields.push('goal = ?'); values.push(updates.goal) }

    values.push(id)
    this.db.prepare(`UPDATE plan_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteSession(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM plan_sessions WHERE id = ?').run(id)
  }

  // ── PlanTask CRUD ─────────────────────────────────────

  getTasksBySession(planSessionId: string): PlanTask[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM plan_tasks WHERE plan_session_id = ? ORDER BY created_at ASC'
      ).all(planSessionId) as any[]
      return rows.map(this.mapTask)
    } catch { return [] }
  }

  getTask(id: string): PlanTask | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM plan_tasks WHERE id = ?').get(id) as any
      return row ? this.mapTask(row) : null
    } catch { return null }
  }

  createTask(task: Omit<PlanTask, 'createdAt' | 'updatedAt'>): PlanTask {
    const now = new Date().toISOString()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO plan_tasks (id, plan_session_id, title, description, priority, status, dependencies, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id, task.planSessionId, task.title, task.description || null,
        task.priority, task.status, JSON.stringify(task.dependencies || []),
        now, now
      )
    }
    return { ...task, createdAt: new Date(now), updatedAt: new Date(now) }
  }

  updateTask(id: string, updates: Partial<PlanTask>): void {
    if (!this.usingSqlite) return
    const fields: string[] = ['updated_at = ?']
    const values: any[] = [new Date().toISOString()]

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.dependencies !== undefined) { fields.push('dependencies = ?'); values.push(JSON.stringify(updates.dependencies)) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt ? new Date(updates.completedAt).toISOString() : null) }

    values.push(id)
    this.db.prepare(`UPDATE plan_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteTask(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM plan_tasks WHERE id = ?').run(id)
  }

  // ── PlanStep CRUD ─────────────────────────────────────

  getStepsByTask(planTaskId: string): PlanStep[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM plan_steps WHERE plan_task_id = ? ORDER BY order_index ASC'
      ).all(planTaskId) as any[]
      return rows.map(this.mapStep)
    } catch { return [] }
  }

  getStep(id: string): PlanStep | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM plan_steps WHERE id = ?').get(id) as any
      return row ? this.mapStep(row) : null
    } catch { return null }
  }

  createStep(step: Omit<PlanStep, 'createdAt'>): PlanStep {
    const now = new Date().toISOString()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO plan_steps (id, plan_task_id, description, status, result, order_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        step.id, step.planTaskId, step.description, step.status,
        step.result || null, step.orderIndex, now
      )
    }
    return { ...step, createdAt: new Date(now) }
  }

  updateStep(id: string, updates: Partial<PlanStep>): void {
    if (!this.usingSqlite) return
    const fields: string[] = []
    const values: any[] = []

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.result !== undefined) { fields.push('result = ?'); values.push(updates.result) }
    if (updates.orderIndex !== undefined) { fields.push('order_index = ?'); values.push(updates.orderIndex) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt ? new Date(updates.completedAt).toISOString() : null) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }

    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE plan_steps SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteStep(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM plan_steps WHERE id = ?').run(id)
  }

  // ── 映射器 ────────────────────────────────────────────────

  private mapSession(row: any): PlanSession {
    return {
      id: row.id,
      sessionId: row.session_id,
      goalId: row.goal_id || undefined,
      goal: row.goal,
      status: row.status as PlanStatus,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }
  }

  private mapTask(row: any): PlanTask {
    let dependencies: string[] = []
    if (row.dependencies) {
      try { dependencies = JSON.parse(row.dependencies) } catch { dependencies = [] }
    }
    return {
      id: row.id,
      planSessionId: row.plan_session_id,
      title: row.title,
      description: row.description || undefined,
      priority: row.priority as Priority,
      status: row.status as TaskStatus,
      dependencies,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }
  }

  private mapStep(row: any): PlanStep {
    return {
      id: row.id,
      planTaskId: row.plan_task_id,
      description: row.description,
      status: row.status as StepStatus,
      result: row.result || undefined,
      orderIndex: row.order_index ?? 0,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }
  }
}
