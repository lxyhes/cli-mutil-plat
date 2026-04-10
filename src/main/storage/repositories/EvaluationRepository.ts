/**
 * EvaluationRepository - 任务评估相关数据库操作
 */
export type EvaluationRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type EvaluationTriggerType = 'manual' | 'scheduled'

export interface EvaluationCriterion {
  name: string
  description: string
  max_score: number
  weight: number
}

export interface EvaluationTemplate {
  id: string
  name: string
  description?: string
  criteria: EvaluationCriterion[]
  promptTemplate: string
  createdBy?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface EvaluationRun {
  id: string
  templateId: string
  sessionId: string
  status: EvaluationRunStatus
  triggerType: EvaluationTriggerType
  evaluatorProvider?: string
  evaluatorModel?: string
  context?: Record<string, any>
  createdAt?: Date
  completedAt?: Date
}

export interface EvaluationResult {
  id: string
  evaluationRunId: string
  criterionName: string
  score: number
  reasoning?: string
  suggestions?: string
}

export class EvaluationRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  // ── EvaluationTemplate CRUD ─────────────────────────────────

  createTemplate(template: Omit<EvaluationTemplate, 'createdAt' | 'updatedAt'>): EvaluationTemplate {
    const now = new Date().toISOString()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO evaluation_templates
          (id, name, description, criteria, prompt_template, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        template.id, template.name, template.description || null,
        JSON.stringify(template.criteria), template.promptTemplate,
        template.createdBy || null, now, now
      )
    }
    return { ...template, createdAt: new Date(now), updatedAt: new Date(now) }
  }

  getTemplate(id: string): EvaluationTemplate | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM evaluation_templates WHERE id = ?').get(id) as any
      return row ? this.mapTemplate(row) : null
    } catch { return null }
  }

  listTemplates(): EvaluationTemplate[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM evaluation_templates ORDER BY created_at DESC'
      ).all() as any[]
      return rows.map(this.mapTemplate)
    } catch { return [] }
  }

  updateTemplate(id: string, updates: Partial<EvaluationTemplate>): void {
    if (!this.usingSqlite) return
    const fields: string[] = ['updated_at = ?']
    const values: any[] = [new Date().toISOString()]

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.criteria !== undefined) { fields.push('criteria = ?'); values.push(JSON.stringify(updates.criteria)) }
    if (updates.promptTemplate !== undefined) { fields.push('prompt_template = ?'); values.push(updates.promptTemplate) }

    values.push(id)
    this.db.prepare(`UPDATE evaluation_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteTemplate(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM evaluation_templates WHERE id = ?').run(id)
  }

  // ── EvaluationRun CRUD ─────────────────────────────────────

  createRun(run: Omit<EvaluationRun, 'createdAt' | 'completedAt'>): EvaluationRun {
    const now = new Date().toISOString()
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO evaluation_runs
          (id, template_id, session_id, status, trigger_type, evaluator_provider, evaluator_model, context, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        run.id, run.templateId, run.sessionId, run.status, run.triggerType,
        run.evaluatorProvider || null, run.evaluatorModel || null,
        run.context ? JSON.stringify(run.context) : null, now
      )
    }
    return { ...run, createdAt: new Date(now) }
  }

  getRun(id: string): EvaluationRun | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM evaluation_runs WHERE id = ?').get(id) as any
      return row ? this.mapRun(row) : null
    } catch { return null }
  }

  listRuns(limit = 50): EvaluationRun[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM evaluation_runs ORDER BY created_at DESC LIMIT ?'
      ).all(limit) as any[]
      return rows.map(this.mapRun)
    } catch { return [] }
  }

  listRunsBySession(sessionId: string, limit = 20): EvaluationRun[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM evaluation_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(sessionId, limit) as any[]
      return rows.map(this.mapRun)
    } catch { return [] }
  }

  listRunsByTemplate(templateId: string, limit = 20): EvaluationRun[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM evaluation_runs WHERE template_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(templateId, limit) as any[]
      return rows.map(this.mapRun)
    } catch { return [] }
  }

  updateRun(id: string, updates: Partial<EvaluationRun>): void {
    if (!this.usingSqlite) return
    const fields: string[] = []
    const values: any[] = []

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt ? new Date(updates.completedAt).toISOString() : null) }

    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE evaluation_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  // ── EvaluationResult CRUD ───────────────────────────────────

  createResult(result: EvaluationResult): EvaluationResult {
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT INTO evaluation_results (id, evaluation_run_id, criterion_name, score, reasoning, suggestions)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        result.id, result.evaluationRunId, result.criterionName, result.score,
        result.reasoning || null, result.suggestions || null
      )
    }
    return result
  }

  getResultsByRun(evaluationRunId: string): EvaluationResult[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM evaluation_results WHERE evaluation_run_id = ?'
      ).all(evaluationRunId) as any[]
      return rows.map(this.mapResult)
    } catch { return [] }
  }

  // ── 统计 ────────────────────────────────────────────────────

  getTemplateStats(templateId: string): { avgScore: number; avgByCriterion: Record<string, number>; runCount: number } {
    if (!this.usingSqlite) return { avgScore: 0, avgByCriterion: {}, runCount: 0 }
    try {
      const runCount = (this.db.prepare(
        "SELECT COUNT(*) as cnt FROM evaluation_runs WHERE template_id = ? AND status = 'completed'"
      ).get(templateId) as any)?.cnt ?? 0

      if (runCount === 0) return { avgScore: 0, avgByCriterion: {}, runCount: 0 }

      const rows = this.db.prepare(`
        SELECT er.id, er.status, eevr.criterion_name, eevr.score
        FROM evaluation_runs er
        JOIN evaluation_results eevr ON eevr.evaluation_run_id = er.id
        WHERE er.template_id = ? AND er.status = 'completed'
      `).all(templateId) as any[]

      if (rows.length === 0) return { avgScore: 0, avgByCriterion: {}, runCount }

      const totalScore = rows.reduce((sum, r) => sum + r.score, 0)
      const avgScore = totalScore / rows.length

      const criterionTotals: Record<string, { sum: number; count: number }> = {}
      for (const r of rows) {
        if (!criterionTotals[r.criterion_name]) criterionTotals[r.criterion_name] = { sum: 0, count: 0 }
        criterionTotals[r.criterion_name].sum += r.score
        criterionTotals[r.criterion_name].count++
      }

      const avgByCriterion: Record<string, number> = {}
      for (const [name, data] of Object.entries(criterionTotals)) {
        avgByCriterion[name] = data.sum / data.count
      }

      return { avgScore, avgByCriterion, runCount }
    } catch { return { avgScore: 0, avgByCriterion: {}, runCount: 0 } }
  }

  // ── 映射器 ─────────────────────────────────────────────────

  private mapTemplate(row: any): EvaluationTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      criteria: JSON.parse(row.criteria || '[]'),
      promptTemplate: row.prompt_template,
      createdBy: row.created_by || undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
    }
  }

  private mapRun(row: any): EvaluationRun {
    return {
      id: row.id,
      templateId: row.template_id,
      sessionId: row.session_id,
      status: row.status as EvaluationRunStatus,
      triggerType: row.trigger_type as EvaluationTriggerType,
      evaluatorProvider: row.evaluator_provider || undefined,
      evaluatorModel: row.evaluator_model || undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    }
  }

  private mapResult(row: any): EvaluationResult {
    return {
      id: row.id,
      evaluationRunId: row.evaluation_run_id,
      criterionName: row.criterion_name,
      score: row.score,
      reasoning: row.reasoning || undefined,
      suggestions: row.suggestions || undefined,
    }
  }
}
