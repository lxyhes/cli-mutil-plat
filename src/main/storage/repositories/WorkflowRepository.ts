/**
 * WorkflowRepository - 工作流相关数据库操作
 */
export type WorkflowStatus = 'draft' | 'running' | 'paused'
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused'
export type TriggeredBy = 'manual' | 'scheduled' | 'event'
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** 工作流步骤定义 */
export interface WorkflowStep {
  id: string
  type: 'prompt' | 'http' | 'condition' | 'delay'
  name?: string
  prompt?: string
  sessionId?: string
  providerId?: string
  workspaceId?: string
  httpMethod?: string
  httpUrl?: string
  httpHeaders?: Record<string, string>
  httpBody?: string
  conditionExpression?: string
  trueSteps?: string[]   // step ids
  falseSteps?: string[]  // step ids
  delayMs?: number
  timeoutSeconds?: number
  retries?: number
  dependsOn?: string[]
}

/** 工作流定义 */
export interface Workflow {
  id: string
  name: string
  description?: string
  steps: WorkflowStep[]
  variables: Record<string, any>
  status: WorkflowStatus
  createdBy?: string
  createdAt?: Date
  updatedAt?: Date
}

/** 工作流执行记录 */
export interface WorkflowExecution {
  id: string
  workflowId: string
  status: ExecutionStatus
  startedAt?: Date
  completedAt?: Date
  triggeredBy: TriggeredBy
  context: Record<string, any>
  result?: string
  error?: string
}

/** 工作流步骤运行记录 */
export interface WorkflowRun {
  id: string
  executionId: string
  stepId: string
  stepOrder: number
  status: RunStatus
  startedAt?: Date
  completedAt?: Date
  durationMs?: number
  input: Record<string, any>
  output?: string
  error?: string
  retries: number
}

export class WorkflowRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  // ── Workflow CRUD ─────────────────────────────────────────

  getAllWorkflows(): Workflow[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all() as any[]
      return rows.map(this.mapWorkflow)
    } catch { return [] }
  }

  getWorkflow(id: string): Workflow | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any
      return row ? this.mapWorkflow(row) : null
    } catch { return null }
  }

  createWorkflow(workflow: Omit<Workflow, 'createdAt' | 'updatedAt'>): Workflow {
    const now = new Date().toISOString()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO workflows (id, name, description, steps, variables, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workflow.id,
        workflow.name,
        workflow.description || null,
        JSON.stringify(workflow.steps),
        JSON.stringify(workflow.variables || {}),
        workflow.status,
        workflow.createdBy || null,
        now, now
      )
    }
    return { ...workflow, createdAt: new Date(now), updatedAt: new Date(now) }
  }

  updateWorkflow(id: string, updates: Partial<Workflow>): void {
    if (!this.usingSqlite) return
    const fields: string[] = ['updated_at = ?']
    const values: any[] = [new Date().toISOString()]

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.steps !== undefined) { fields.push('steps = ?'); values.push(JSON.stringify(updates.steps)) }
    if (updates.variables !== undefined) { fields.push('variables = ?'); values.push(JSON.stringify(updates.variables)) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }

    values.push(id)
    this.db.prepare(`UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteWorkflow(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id)
  }

  // ── WorkflowExecution CRUD ────────────────────────────────

  getExecutionsByWorkflow(workflowId: string, limit = 50): WorkflowExecution[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?'
      ).all(workflowId, limit) as any[]
      return rows.map(this.mapExecution)
    } catch { return [] }
  }

  getExecution(id: string): WorkflowExecution | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM workflow_executions WHERE id = ?').get(id) as any
      return row ? this.mapExecution(row) : null
    } catch { return null }
  }

  createExecution(execution: Omit<WorkflowExecution, 'startedAt'>): WorkflowExecution {
    const now = new Date()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO workflow_executions (id, workflow_id, status, started_at, triggered_by, context, result, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        execution.id,
        execution.workflowId,
        execution.status,
        now.toISOString(),
        execution.triggeredBy,
        JSON.stringify(execution.context || {}),
        execution.result || null,
        execution.error || null
      )
    }
    return { ...execution, startedAt: now }
  }

  updateExecution(id: string, updates: Partial<WorkflowExecution>): void {
    if (!this.usingSqlite) return
    const fields: string[] = []
    const values: any[] = []

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt ? new Date(updates.completedAt).toISOString() : null) }
    if (updates.result !== undefined) { fields.push('result = ?'); values.push(updates.result) }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error) }

    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE workflow_executions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  // ── WorkflowRun CRUD ─────────────────────────────────────

  createRun(run: Omit<WorkflowRun, 'startedAt'>): WorkflowRun {
    const now = new Date()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO workflow_runs (id, execution_id, step_id, step_order, status, started_at, input, output, error, retries)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id,
        run.executionId,
        run.stepId,
        run.stepOrder,
        run.status,
        now.toISOString(),
        JSON.stringify(run.input || {}),
        run.output || null,
        run.error || null,
        run.retries || 0
      )
    }
    return { ...run, startedAt: now }
  }

  updateRun(id: string, updates: Partial<WorkflowRun>): void {
    if (!this.usingSqlite) return
    const fields: string[] = []
    const values: any[] = []

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt ? new Date(updates.completedAt).toISOString() : null) }
    if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output) }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error) }
    if (updates.retries !== undefined) { fields.push('retries = ?'); values.push(updates.retries) }

    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE workflow_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  getRunsByExecution(executionId: string): WorkflowRun[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM workflow_runs WHERE execution_id = ? ORDER BY step_order ASC'
      ).all(executionId) as any[]
      return rows.map(this.mapRun)
    } catch { return [] }
  }

  // ── 映射器 ────────────────────────────────────────────────

  private mapWorkflow(row: any): Workflow {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      steps: JSON.parse(row.steps || '[]'),
      variables: JSON.parse(row.variables || '{}'),
      status: row.status as WorkflowStatus,
      createdBy: row.created_by || undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    }
  }

  private mapExecution(row: any): WorkflowExecution {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status as ExecutionStatus,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      triggeredBy: row.triggered_by as TriggeredBy,
      context: JSON.parse(row.context || '{}'),
      result: row.result || undefined,
      error: row.error || undefined,
    }
  }

  private mapRun(row: any): WorkflowRun {
    return {
      id: row.id,
      executionId: row.execution_id,
      stepId: row.step_id,
      stepOrder: row.step_order,
      status: row.status as RunStatus,
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      input: JSON.parse(row.input || '{}'),
      output: row.output || undefined,
      error: row.error || undefined,
      retries: row.retries ?? 0,
    }
  }
}
