/**
 * PromptOptimizerRepository - Prompt 模板版本管理与测试的数据库访问层
 */
import type { DatabaseManager } from '../Database'

export interface PromptVariable {
  name: string
  description?: string
  defaultValue?: string
  type?: 'string' | 'number' | 'boolean'
}

export interface PromptTemplate {
  id: string
  name: string
  description?: string
  category?: string
  tags: string[]
  variables: PromptVariable[]
  currentVersionId?: string
  isActive: boolean
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface PromptVersion {
  id: string
  templateId: string
  versionNumber: number
  content: string
  systemPrompt?: string
  variablesValues: Record<string, any>
  changeNotes?: string
  score?: number
  testCount: number
  isBaseline: boolean
  createdBy?: string
  createdAt: string
}

export interface PromptTest {
  id: string
  versionId: string
  testInput: string
  testOutput?: string
  tokensUsed?: number
  durationMs?: number
  score?: number
  metadata?: Record<string, any>
  createdAt: string
}

export interface PromptOptimizationRun {
  id: string
  templateId: string
  targetVersionId: string
  status: 'running' | 'completed' | 'failed'
  optimizationStrategy: 'auto' | 'guided' | 'template'
  promptBefore?: string
  promptAfter?: string
  improvementScore?: number
  iterations: number
  startedAt: string
  completedAt?: string
}

export interface PromptFeedback {
  id: string
  optimizationRunId: string
  criterion: string
  scoreBefore?: number
  scoreAfter?: number
  feedbackText?: string
  createdAt: string
}

export class PromptOptimizerRepository {
  private usingSqlite = false

  constructor(private db: DatabaseManager) {
    try {
      this.usingSqlite = db.isUsingSqlite?.() ?? false
    } catch {
      this.usingSqlite = false
    }
  }

  // ── Templates ────────────────────────────────────────────

  createTemplate(data: {
    id: string
    name: string
    description?: string
    category?: string
    tags?: string[]
    variables?: PromptVariable[]
    isActive?: boolean
    createdBy?: string
  }): PromptTemplate {
    if (this.usingSqlite) {
      this.db.getDb?.()?.prepare(`
        INSERT INTO prompt_templates (id, name, description, category, tags, variables, is_active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        data.id, data.name, data.description || null, data.category || null,
        JSON.stringify(data.tags || []),
        JSON.stringify(data.variables || []),
        data.isActive !== false ? 1 : 0,
        data.createdBy || null
      )
    }
    return this.getTemplate(data.id)!
  }

  getTemplate(id: string): PromptTemplate | null {
    if (!this.usingSqlite) return null
    const row = this.db.getDb?.()?.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapTemplate(row)
  }

  listTemplates(category?: string): PromptTemplate[] {
    if (!this.usingSqlite) return []
    const query = category
      ? 'SELECT * FROM prompt_templates WHERE category = ? ORDER BY updated_at DESC'
      : 'SELECT * FROM prompt_templates ORDER BY updated_at DESC'
    const rows = (category
      ? this.db.getDb?.()?.prepare(query).all(category)
      : this.db.getDb?.()?.prepare(query).all()) as any[]
    return (rows || []).map(this.mapTemplate)
  }

  updateTemplate(id: string, updates: {
    name?: string
    description?: string
    category?: string
    tags?: string[]
    variables?: PromptVariable[]
    currentVersionId?: string
    isActive?: boolean
  }): void {
    if (!this.usingSqlite) return
    const fields: string[] = ["updated_at = datetime('now')"]
    const values: any[] = []
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category) }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)) }
    if (updates.variables !== undefined) { fields.push('variables = ?'); values.push(JSON.stringify(updates.variables)) }
    if (updates.currentVersionId !== undefined) { fields.push('current_version_id = ?'); values.push(updates.currentVersionId) }
    if (updates.isActive !== undefined) { fields.push('is_active = ?'); values.push(updates.isActive ? 1 : 0) }
    values.push(id)
    this.db.getDb?.()?.prepare(`UPDATE prompt_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  deleteTemplate(id: string): void {
    if (!this.usingSqlite) return
    this.db.getDb?.()?.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id)
  }

  deleteVersion(id: string): void {
    if (!this.usingSqlite) return
    this.db.getDb?.()?.prepare('DELETE FROM prompt_versions WHERE id = ?').run(id)
  }

  // ── Versions ────────────────────────────────────────────

  createVersion(data: {
    id: string
    templateId: string
    versionNumber: number
    content: string
    systemPrompt?: string
    variablesValues?: Record<string, any>
    changeNotes?: string
    score?: number
    isBaseline?: boolean
    createdBy?: string
  }): PromptVersion {
    if (this.usingSqlite) {
      this.db.getDb?.()?.prepare(`
        INSERT INTO prompt_versions (id, template_id, version_number, content, system_prompt, variables_values, change_notes, score, is_baseline, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        data.id, data.templateId, data.versionNumber, data.content,
        data.systemPrompt || null,
        JSON.stringify(data.variablesValues || {}),
        data.changeNotes || null,
        data.score ?? null,
        data.isBaseline ? 1 : 0,
        data.createdBy || null
      )
      // Update template's current version
      this.updateTemplate(data.templateId, { currentVersionId: data.id })
    }
    return this.getVersion(data.id)!
  }

  getVersion(id: string): PromptVersion | null {
    if (!this.usingSqlite) return null
    const row = this.db.getDb?.()?.prepare('SELECT * FROM prompt_versions WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapVersion(row)
  }

  listVersions(templateId: string): PromptVersion[] {
    if (!this.usingSqlite) return []
    const rows = this.db.getDb?.()?.prepare(
      'SELECT * FROM prompt_versions WHERE template_id = ? ORDER BY version_number DESC'
    ).all(templateId) as any[]
    return (rows || []).map(this.mapVersion)
  }

  updateVersion(id: string, updates: {
    content?: string
    systemPrompt?: string
    variablesValues?: Record<string, any>
    changeNotes?: string
    score?: number
  }): void {
    if (!this.usingSqlite) return
    const fields: string[] = []
    const values: any[] = []
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content) }
    if (updates.systemPrompt !== undefined) { fields.push('system_prompt = ?'); values.push(updates.systemPrompt) }
    if (updates.variablesValues !== undefined) { fields.push('variables_values = ?'); values.push(JSON.stringify(updates.variablesValues)) }
    if (updates.changeNotes !== undefined) { fields.push('change_notes = ?'); values.push(updates.changeNotes) }
    if (updates.score !== undefined) { fields.push('score = ?'); values.push(updates.score) }
    if (!fields.length) return
    values.push(id)
    this.db.getDb?.()?.prepare(`UPDATE prompt_versions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  setBaseline(versionId: string): void {
    if (!this.usingSqlite) return
    const version = this.getVersion(versionId)
    if (!version) return
    this.db.getDb?.()?.prepare('UPDATE prompt_versions SET is_baseline = 0 WHERE template_id = ?').run(version.templateId)
    this.db.getDb?.()?.prepare('UPDATE prompt_versions SET is_baseline = 1 WHERE id = ?').run(versionId)
  }

  incrementTestCount(versionId: string): void {
    if (!this.usingSqlite) return
    this.db.getDb?.()?.prepare('UPDATE prompt_versions SET test_count = test_count + 1 WHERE id = ?').run(versionId)
  }

  getBestVersion(templateId: string): PromptVersion | null {
    if (!this.usingSqlite) return null
    const row = this.db.getDb?.()?.prepare(
      'SELECT * FROM prompt_versions WHERE template_id = ? AND score IS NOT NULL ORDER BY score DESC LIMIT 1'
    ).get(templateId) as any
    return row ? this.mapVersion(row) : null
  }

  // ── Tests ────────────────────────────────────────────

  createTest(data: {
    id: string
    versionId: string
    testInput: string
    testOutput?: string
    tokensUsed?: number
    durationMs?: number
    score?: number
    metadata?: Record<string, any>
  }): PromptTest {
    if (this.usingSqlite) {
      this.db.getDb?.()?.prepare(`
        INSERT INTO prompt_tests (id, version_id, test_input, test_output, tokens_used, duration_ms, score, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        data.id, data.versionId, data.testInput,
        data.testOutput || null,
        data.tokensUsed ?? null,
        data.durationMs ?? null,
        data.score ?? null,
        JSON.stringify(data.metadata || {})
      )
      this.incrementTestCount(data.versionId)
      // Update version score
      if (data.score !== undefined) {
        const tests = this.listTests(data.versionId)
        const avgScore = tests.reduce((sum, t) => sum + (t.score || 0), 0) / tests.length
        this.updateVersion(data.versionId, { score: avgScore })
      }
    }
    return this.getTest(data.id)!
  }

  getTest(id: string): PromptTest | null {
    if (!this.usingSqlite) return null
    const row = this.db.getDb?.()?.prepare('SELECT * FROM prompt_tests WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapTest(row)
  }

  listTests(versionId: string, limit = 20): PromptTest[] {
    if (!this.usingSqlite) return []
    const rows = this.db.getDb?.()?.prepare(
      'SELECT * FROM prompt_tests WHERE version_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(versionId, limit) as any[]
    return (rows || []).map(this.mapTest)
  }

  getTestStats(versionId: string): { avgScore: number; avgTokens: number; avgDuration: number; count: number } {
    if (!this.usingSqlite) return { avgScore: 0, avgTokens: 0, avgDuration: 0, count: 0 }
    const row = this.db.getDb?.()?.prepare(`
      SELECT AVG(score) as avg_score, AVG(tokens_used) as avg_tokens, AVG(duration_ms) as avg_duration, COUNT(*) as cnt
      FROM prompt_tests WHERE version_id = ?
    `).get(versionId) as any
    return {
      avgScore: row?.avg_score || 0,
      avgTokens: Math.round(row?.avg_tokens || 0),
      avgDuration: Math.round(row?.avg_duration || 0),
      count: row?.cnt || 0,
    }
  }

  // ── Optimization Runs ────────────────────────────────────────────

  createOptimizationRun(data: {
    id: string
    templateId: string
    targetVersionId: string
    optimizationStrategy?: string
    promptBefore?: string
  }): PromptOptimizationRun {
    if (this.usingSqlite) {
      this.db.getDb?.()?.prepare(`
        INSERT INTO prompt_optimization_runs (id, template_id, target_version_id, status, optimization_strategy, prompt_before, started_at)
        VALUES (?, ?, ?, 'running', ?, ?, datetime('now'))
      `).run(data.id, data.templateId, data.targetVersionId, data.optimizationStrategy || 'auto', data.promptBefore || null)
    }
    return this.getOptimizationRun(data.id)!
  }

  getOptimizationRun(id: string): PromptOptimizationRun | null {
    if (!this.usingSqlite) return null
    const row = this.db.getDb?.()?.prepare('SELECT * FROM prompt_optimization_runs WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapOptimizationRun(row)
  }

  listOptimizationRuns(templateId?: string, limit = 20): PromptOptimizationRun[] {
    if (!this.usingSqlite) return []
    const query = templateId
      ? 'SELECT * FROM prompt_optimization_runs WHERE template_id = ? ORDER BY started_at DESC LIMIT ?'
      : 'SELECT * FROM prompt_optimization_runs ORDER BY started_at DESC LIMIT ?'
    const rows = (templateId
      ? this.db.getDb?.()?.prepare(query).all(templateId, limit)
      : this.db.getDb?.()?.prepare(query).all(limit)) as any[]
    return (rows || []).map(this.mapOptimizationRun)
  }

  updateOptimizationRun(id: string, updates: {
    status?: string
    promptAfter?: string
    improvementScore?: number
    iterations?: number
    completedAt?: string
  }): void {
    if (!this.usingSqlite) return
    const fields: string[] = []
    const values: any[] = []
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.promptAfter !== undefined) { fields.push('prompt_after = ?'); values.push(updates.promptAfter) }
    if (updates.improvementScore !== undefined) { fields.push('improvement_score = ?'); values.push(updates.improvementScore) }
    if (updates.iterations !== undefined) { fields.push('iterations = ?'); values.push(updates.iterations) }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt) }
    if (!fields.length) return
    values.push(id)
    this.db.getDb?.()?.prepare(`UPDATE prompt_optimization_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  addFeedback(data: {
    id: string
    optimizationRunId: string
    criterion: string
    scoreBefore?: number
    scoreAfter?: number
    feedbackText?: string
  }): PromptFeedback {
    if (this.usingSqlite) {
      this.db.getDb?.()?.prepare(`
        INSERT INTO prompt_feedback (id, optimization_run_id, criterion, score_before, score_after, feedback_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(data.id, data.optimizationRunId, data.criterion, data.scoreBefore ?? null, data.scoreAfter ?? null, data.feedbackText || null)
    }
    const row = this.db.getDb?.()?.prepare('SELECT * FROM prompt_feedback WHERE id = ?').get(data.id) as any
    return row ? this.mapFeedback(row) : {} as PromptFeedback
  }

  listFeedbackByRun(runId: string): PromptFeedback[] {
    if (!this.usingSqlite) return []
    const rows = this.db.getDb?.()?.prepare('SELECT * FROM prompt_feedback WHERE optimization_run_id = ? ORDER BY created_at ASC').all(runId) as any[]
    return (rows || []).map(this.mapFeedback)
  }

  // ── Mappers ────────────────────────────────────────────

  private mapTemplate(row: any): PromptTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      tags: row.tags ? JSON.parse(row.tags) : [],
      variables: row.variables ? JSON.parse(row.variables) : [],
      currentVersionId: row.current_version_id,
      isActive: !!row.is_active,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapVersion(row: any): PromptVersion {
    return {
      id: row.id,
      templateId: row.template_id,
      versionNumber: row.version_number,
      content: row.content,
      systemPrompt: row.system_prompt,
      variablesValues: row.variables_values ? JSON.parse(row.variables_values) : {},
      changeNotes: row.change_notes,
      score: row.score,
      testCount: row.test_count || 0,
      isBaseline: !!row.is_baseline,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }
  }

  private mapTest(row: any): PromptTest {
    return {
      id: row.id,
      versionId: row.version_id,
      testInput: row.test_input,
      testOutput: row.test_output,
      tokensUsed: row.tokens_used,
      durationMs: row.duration_ms,
      score: row.score,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
    }
  }

  private mapOptimizationRun(row: any): PromptOptimizationRun {
    return {
      id: row.id,
      templateId: row.template_id,
      targetVersionId: row.target_version_id,
      status: row.status,
      optimizationStrategy: row.optimization_strategy,
      promptBefore: row.prompt_before,
      promptAfter: row.prompt_after,
      improvementScore: row.improvement_score,
      iterations: row.iterations || 0,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }
  }

  private mapFeedback(row: any): PromptFeedback {
    return {
      id: row.id,
      optimizationRunId: row.optimization_run_id,
      criterion: row.criterion,
      scoreBefore: row.score_before,
      scoreAfter: row.score_after,
      feedbackText: row.feedback_text,
      createdAt: row.created_at,
    }
  }
}
