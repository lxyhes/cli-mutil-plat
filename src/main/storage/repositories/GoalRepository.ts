/**
 * GoalRepository - 目标锚点相关数据库操作
 */
export type GoalStatus = 'active' | 'achieved' | 'abandoned'
export type GoalPriority = 'high' | 'medium' | 'low'
export type GoalActivityType = 'note' | 'reminder' | 'checkpoint' | 'review'

export interface Goal {
  id: string
  title: string
  description?: string
  targetDate?: string
  status: GoalStatus
  priority: GoalPriority
  tags: string[]
  progress: number
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface GoalActivity {
  id: string
  goalId: string
  type: GoalActivityType
  content: string
  progressBefore?: number
  progressAfter?: number
  sessionId?: string
  createdAt: string
}

export interface GoalSession {
  id: string
  goalId: string
  sessionId: string
  firstMentionedAt: string
  lastMentionedAt: string
  mentionCount: number
  isPrimary: boolean
}

export interface GoalStats {
  activeCount: number
  achievedCount: number
  achievedThisMonth: number
  avgProgress: number
  totalCount: number
}

export class GoalRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  // ── Goal CRUD ─────────────────────────────────────────────

  createGoal(data: {
    id: string
    title: string
    description?: string
    targetDate?: string
    priority?: GoalPriority
    tags?: string[]
    createdBy?: string
  }): Goal | null {
    if (!this.usingSqlite) return null
    try {
      const stmt = this.db.prepare(`
        INSERT INTO goals (id, title, description, target_date, priority, tags, created_by)
        VALUES (@id, @title, @description, @target_date, @priority, @tags, @created_by)
      `)
      stmt.run({
        id: data.id,
        title: data.title,
        description: data.description || null,
        target_date: data.targetDate || null,
        priority: data.priority || 'medium',
        tags: JSON.stringify(data.tags || []),
        created_by: data.createdBy || null,
      })
      return this.getGoal(data.id)
    } catch (err) {
      console.error('[GoalRepository] createGoal error:', err)
      return null
    }
  }

  getGoal(id: string): Goal | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as any
      return row ? this.mapGoal(row) : null
    } catch { return null }
  }

  listGoals(status?: GoalStatus): Goal[] {
    if (!this.usingSqlite) return []
    try {
      let query = 'SELECT * FROM goals'
      const params: any[] = []
      if (status) {
        query += ' WHERE status = ?'
        params.push(status)
      }
      query += ' ORDER BY created_at DESC'
      const rows = this.db.prepare(query).all(...params) as any[]
      return rows.map(this.mapGoal)
    } catch { return [] }
  }

  updateGoal(id: string, updates: {
    title?: string
    description?: string
    targetDate?: string
    status?: GoalStatus
    priority?: GoalPriority
    tags?: string[]
    progress?: number
  }): boolean {
    if (!this.usingSqlite) return false
    try {
      const fields: string[] = []
      const params: any[] = []
      if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title) }
      if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description) }
      if (updates.targetDate !== undefined) { fields.push('target_date = ?'); params.push(updates.targetDate) }
      if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status) }
      if (updates.priority !== undefined) { fields.push('priority = ?'); params.push(updates.priority) }
      if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)) }
      if (updates.progress !== undefined) { fields.push('progress = ?'); params.push(updates.progress) }
      if (fields.length === 0) return false
      fields.push('updated_at = CURRENT_TIMESTAMP')
      params.push(id)
      const stmt = this.db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`)
      const result = stmt.run(...params)
      return result.changes > 0
    } catch (err) {
      console.error('[GoalRepository] updateGoal error:', err)
      return false
    }
  }

  deleteGoal(id: string): boolean {
    if (!this.usingSqlite) return false
    try {
      const stmt = this.db.prepare('DELETE FROM goals WHERE id = ?')
      const result = stmt.run(id)
      return result.changes > 0
    } catch { return false }
  }

  // ── Goal Activities ────────────────────────────────────────

  addActivity(data: {
    id: string
    goalId: string
    type: GoalActivityType
    content: string
    progressBefore?: number
    progressAfter?: number
    sessionId?: string
  }): GoalActivity | null {
    if (!this.usingSqlite) return null
    try {
      const stmt = this.db.prepare(`
        INSERT INTO goal_activities (id, goal_id, type, content, progress_before, progress_after, session_id)
        VALUES (@id, @goal_id, @type, @content, @progress_before, @progress_after, @session_id)
      `)
      stmt.run({
        id: data.id,
        goal_id: data.goalId,
        type: data.type,
        content: data.content,
        progress_before: data.progressBefore ?? null,
        progress_after: data.progressAfter ?? null,
        session_id: data.sessionId ?? null,
      })
      return this.getActivity(data.id)
    } catch (err) {
      console.error('[GoalRepository] addActivity error:', err)
      return null
    }
  }

  private getActivity(id: string): GoalActivity | null {
    try {
      const row = this.db.prepare('SELECT * FROM goal_activities WHERE id = ?').get(id) as any
      return row ? this.mapActivity(row) : null
    } catch { return null }
  }

  listActivities(goalId: string, limit?: number): GoalActivity[] {
    if (!this.usingSqlite) return []
    try {
      const sql = `SELECT * FROM goal_activities WHERE goal_id = ? ORDER BY created_at DESC${limit ? ' LIMIT ?' : ''}`
      const rows = limit
        ? this.db.prepare(sql).all(goalId, limit) as any[]
        : this.db.prepare(sql).all(goalId) as any[]
      return rows.map(this.mapActivity)
    } catch { return [] }
  }

  getGoalProgress(goalId: string): number {
    if (!this.usingSqlite) return 0
    try {
      const row = this.db.prepare('SELECT progress FROM goals WHERE id = ?').get(goalId) as any
      return row?.progress ?? 0
    } catch { return 0 }
  }

  // ── Goal Sessions ─────────────────────────────────────────

  linkSession(data: {
    id: string
    goalId: string
    sessionId: string
    isPrimary?: boolean
  }): GoalSession | null {
    if (!this.usingSqlite) return null
    try {
      // 先检查是否已有关联
      const existing = this.db.prepare(
        'SELECT * FROM goal_sessions WHERE goal_id = ? AND session_id = ?'
      ).get(data.goalId, data.sessionId) as any
      if (existing) {
        // 更新 mention_count 和 last_mentioned_at
        this.db.prepare(`
          UPDATE goal_sessions
          SET mention_count = mention_count + 1, last_mentioned_at = CURRENT_TIMESTAMP
          WHERE goal_id = ? AND session_id = ?
        `).run(data.goalId, data.sessionId)
        const updated = this.db.prepare(
          'SELECT * FROM goal_sessions WHERE goal_id = ? AND session_id = ?'
        ).get(data.goalId, data.sessionId) as any
        return updated ? this.mapGoalSession(updated) : null
      }
      const stmt = this.db.prepare(`
        INSERT INTO goal_sessions (id, goal_id, session_id, is_primary)
        VALUES (@id, @goal_id, @session_id, @is_primary)
      `)
      stmt.run({
        id: data.id,
        goal_id: data.goalId,
        session_id: data.sessionId,
        is_primary: data.isPrimary ? 1 : 0,
      })
      const row = this.db.prepare('SELECT * FROM goal_sessions WHERE id = ?').get(data.id) as any
      return row ? this.mapGoalSession(row) : null
    } catch (err) {
      console.error('[GoalRepository] linkSession error:', err)
      return null
    }
  }

  unlinkSession(goalId: string, sessionId: string): boolean {
    if (!this.usingSqlite) return false
    try {
      const stmt = this.db.prepare('DELETE FROM goal_sessions WHERE goal_id = ? AND session_id = ?')
      const result = stmt.run(goalId, sessionId)
      return result.changes > 0
    } catch { return false }
  }

  getSessionsByGoal(goalId: string): GoalSession[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM goal_sessions WHERE goal_id = ? ORDER BY last_mentioned_at DESC'
      ).all(goalId) as any[]
      return rows.map(this.mapGoalSession)
    } catch { return [] }
  }

  getGoalsBySession(sessionId: string): GoalSession[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM goal_sessions WHERE session_id = ? ORDER BY last_mentioned_at DESC'
      ).all(sessionId) as any[]
      return rows.map(this.mapGoalSession)
    } catch { return [] }
  }

  // ── Query helpers ─────────────────────────────────────────

  getGoalsDueSoon(days: number = 7): Goal[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(`
        SELECT * FROM goals
        WHERE status = 'active'
          AND target_date IS NOT NULL
          AND date(target_date) <= date('now', '+' || ? || ' days')
        ORDER BY target_date ASC
      `).all(days) as any[]
      return rows.map(this.mapGoal)
    } catch { return [] }
  }

  getActiveGoals(): Goal[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        "SELECT * FROM goals WHERE status = 'active' ORDER BY priority ASC, created_at DESC"
      ).all() as any[]
      return rows.map(this.mapGoal)
    } catch { return [] }
  }

  getGoalStats(): GoalStats {
    if (!this.usingSqlite) return { activeCount: 0, achievedCount: 0, achievedThisMonth: 0, avgProgress: 0, totalCount: 0 }
    try {
      const totalRow = this.db.prepare('SELECT COUNT(*) as cnt FROM goals').get() as any
      const activeRow = this.db.prepare("SELECT COUNT(*) as cnt FROM goals WHERE status = 'active'").get() as any
      const achievedRow = this.db.prepare("SELECT COUNT(*) as cnt FROM goals WHERE status = 'achieved'").get() as any
      const monthRow = this.db.prepare(`
        SELECT COUNT(*) as cnt FROM goals
        WHERE status = 'achieved'
          AND strftime('%Y-%m', updated_at) = strftime('%Y-%m', 'now')
      `).get() as any
      const avgRow = this.db.prepare('SELECT AVG(progress) as avg FROM goals WHERE status = \'active\'').get() as any
      return {
        activeCount: activeRow?.cnt ?? 0,
        achievedCount: achievedRow?.cnt ?? 0,
        achievedThisMonth: monthRow?.cnt ?? 0,
        avgProgress: Math.round(avgRow?.avg ?? 0),
        totalCount: totalRow?.cnt ?? 0,
      }
    } catch {
      return { activeCount: 0, achievedCount: 0, achievedThisMonth: 0, avgProgress: 0, totalCount: 0 }
    }
  }

  // ── Mappers ───────────────────────────────────────────────

  private mapGoal(row: any): Goal {
    let tags: string[] = []
    try {
      tags = JSON.parse(row.tags || '[]')
    } catch { tags = [] }
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      targetDate: row.target_date,
      status: row.status as GoalStatus,
      priority: row.priority as GoalPriority,
      tags,
      progress: row.progress ?? 0,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapActivity(row: any): GoalActivity {
    return {
      id: row.id,
      goalId: row.goal_id,
      type: row.type as GoalActivityType,
      content: row.content,
      progressBefore: row.progress_before,
      progressAfter: row.progress_after,
      sessionId: row.session_id,
      createdAt: row.created_at,
    }
  }

  private mapGoalSession(row: any): GoalSession {
    return {
      id: row.id,
      goalId: row.goal_id,
      sessionId: row.session_id,
      firstMentionedAt: row.first_mentioned_at,
      lastMentionedAt: row.last_mentioned_at,
      mentionCount: row.mention_count ?? 1,
      isPrimary: !!row.is_primary,
    }
  }
}
