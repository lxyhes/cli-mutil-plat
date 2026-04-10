/**
 * Agent Teams - 数据库仓库
 * 
 * 团队数据的 CRUD 操作
 * 
 * @author weibin
 */

import type {
  TeamInstance,
  TeamMember,
  TeamTask,
  TeamMessage,
  TeamTemplate,
  TeamRole,
  TaskClaimResult,
} from './types'

/** 团队数据仓库 */
export class TeamRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  // ---- Team Instances ----

  createTeamInstance(instance: Omit<TeamInstance, 'members'>): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO team_instances (id, name, template_id, status, work_dir, session_id, objective, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        instance.id,
        instance.name,
        instance.templateId || null,
        instance.status,
        instance.workDir,
        instance.sessionId,
        instance.objective,
        instance.createdAt
      )
    } catch (err) {
      console.error('[TeamRepository] createTeamInstance error:', err)
    }
  }

  getTeamInstance(instanceId: string): TeamInstance | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare('SELECT * FROM team_instances WHERE id = ?').get(instanceId)
      if (!row) return undefined

      const members = this.getTeamMembers(instanceId)
      return { ...row, members }
    } catch (err) {
      console.error('[TeamRepository] getTeamInstance error:', err)
      return undefined
    }
  }

  /** Alias for getTeamInstance for compatibility with TeamHealthChecker */
  getInstance(instanceId: string): TeamInstance | undefined {
    return this.getTeamInstance(instanceId)
  }

  getAllTeamInstances(status?: string): TeamInstance[] {
    if (!this.db) return []
    try {
      const sql = status 
        ? 'SELECT * FROM team_instances WHERE status = ? ORDER BY created_at DESC'
        : 'SELECT * FROM team_instances ORDER BY created_at DESC'
      const rows = status ? this.db.prepare(sql).all(status) : this.db.prepare(sql).all()
      return rows.map((row: any) => ({
        ...row,
        members: this.getTeamMembers(row.id)
      }))
    } catch (err) {
      console.error('[TeamRepository] getAllTeamInstances error:', err)
      return []
    }
  }

  updateTeamStatus(instanceId: string, status: string): void {
    if (!this.db) return
    try {
      const completedAt = (status === 'completed' || status === 'failed') ? new Date().toISOString() : null
      this.db.prepare(
        'UPDATE team_instances SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?'
      ).run(status, completedAt, instanceId)
    } catch (err) {
      console.error('[TeamRepository] updateTeamStatus error:', err)
    }
  }

  // ---- Team Members ----

  addTeamMember(member: Omit<TeamMember, 'role'> & { role: TeamRole }): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO team_members (id, instance_id, role_id, role_name, role_identifier, role_icon, role_color, session_id, status, provider_id, joined_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        member.id,
        member.instanceId,
        member.roleId,
        member.role.name,
        member.role.identifier,
        member.role.icon,
        member.role.color,
        member.sessionId,
        member.status,
        member.providerId,
        member.joinedAt
      )
    } catch (err) {
      console.error('[TeamRepository] addTeamMember error:', err)
    }
  }

  getTeamMembers(instanceId: string): TeamMember[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM team_members WHERE instance_id = ? ORDER BY joined_at ASC'
      ).all(instanceId)
      return rows.map((row: any) => ({
        id: row.id,
        instanceId: row.instance_id,
        roleId: row.role_id,
        role: {
          id: row.role_id,
          name: row.role_name,
          identifier: row.role_identifier,
          icon: row.role_icon,
          color: row.role_color,
          description: '',
          systemPrompt: '',
          isLeader: row.role_identifier === 'leader',
        },
        sessionId: row.session_id,
        status: row.status,
        providerId: row.provider_id,
        currentTaskId: row.current_task_id,
        joinedAt: row.joined_at,
        lastActiveAt: row.last_active_at,
      }))
    } catch (err) {
      console.error('[TeamRepository] getTeamMembers error:', err)
      return []
    }
  }

  updateMemberStatus(memberId: string, status: string): void {
    if (!this.db) return
    try {
      this.db.prepare(
        'UPDATE team_members SET status = ?, last_active_at = ? WHERE id = ?'
      ).run(status, new Date().toISOString(), memberId)
    } catch (err) {
      console.error('[TeamRepository] updateMemberStatus error:', err)
    }
  }

  updateMember(memberId: string, updates: Partial<Pick<TeamMember, 'status' | 'currentTaskId' | 'lastActiveAt'>>): void {
    if (!this.db) return
    try {
      const setParts: string[] = []
      const values: any[] = []
      if (updates.status !== undefined) {
        setParts.push('status = ?')
        values.push(updates.status)
      }
      if (updates.currentTaskId !== undefined) {
        setParts.push('current_task_id = ?')
        values.push(updates.currentTaskId)
      }
      if (updates.lastActiveAt !== undefined) {
        setParts.push('last_active_at = ?')
        values.push(updates.lastActiveAt)
      }
      if (setParts.length === 0) return
      values.push(memberId)
      this.db.prepare(
        `UPDATE team_members SET ${setParts.join(', ')}, last_active_at = ? WHERE id = ?`
      ).run(...values.slice(0, -1), new Date().toISOString(), memberId)
    } catch (err) {
      console.error('[TeamRepository] updateMember error:', err)
    }
  }

  updateMemberTask(memberId: string, taskId: string | null): void {
    if (!this.db) return
    try {
      this.db.prepare(
        'UPDATE team_members SET current_task_id = ?, last_active_at = ? WHERE id = ?'
      ).run(taskId, new Date().toISOString(), memberId)
    } catch (err) {
      console.error('[TeamRepository] updateMemberTask error:', err)
    }
  }

  getMemberByRole(instanceId: string, roleIdentifier: string): TeamMember | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare(
        'SELECT * FROM team_members WHERE instance_id = ? AND role_identifier = ?'
      ).get(instanceId, roleIdentifier)
      if (!row) return undefined
      const r: any = row
      return {
        id: r.id,
        instanceId: r.instance_id,
        roleId: r.role_id,
        role: {
          id: r.role_id,
          name: r.role_name,
          identifier: r.role_identifier,
          icon: r.role_icon,
          color: r.role_color,
          description: '',
          systemPrompt: '',
          isLeader: r.role_identifier === 'leader',
        },
        sessionId: r.session_id,
        status: r.status,
        providerId: r.provider_id,
        currentTaskId: r.current_task_id,
        joinedAt: r.joined_at,
        lastActiveAt: r.last_active_at,
      }
    } catch (err) {
      console.error('[TeamRepository] getMemberByRole error:', err)
      return undefined
    }
  }

  getMemberById(memberId: string): TeamMember | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare('SELECT * FROM team_members WHERE id = ?').get(memberId)
      if (!row) return undefined
      const r: any = row
      return {
        id: r.id,
        instanceId: r.instance_id,
        roleId: r.role_id,
        role: {
          id: r.role_id,
          name: r.role_name,
          identifier: r.role_identifier,
          icon: r.role_icon,
          color: r.role_color,
          description: '',
          systemPrompt: '',
          isLeader: r.role_identifier === 'leader',
        },
        sessionId: r.session_id,
        status: r.status,
        providerId: r.provider_id,
        currentTaskId: r.current_task_id,
        joinedAt: r.joined_at,
        lastActiveAt: r.last_active_at,
      }
    } catch (err) {
      console.error('[TeamRepository] getMemberById error:', err)
      return undefined
    }
  }

  // ---- Team Tasks ----

  createTask(task: TeamTask): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO team_tasks (id, instance_id, title, description, status, assigned_to, priority, dependencies, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id,
        task.instanceId,
        task.title,
        task.description,
        task.status,
        task.assignedTo || null,
        task.priority,
        JSON.stringify(task.dependencies),
        task.createdAt
      )
    } catch (err) {
      console.error('[TeamRepository] createTask error:', err)
    }
  }

  /** 原子认领任务（核心方法：WHERE status='pending' 确保只有一个成员成功） */
  claimTask(taskId: string, memberId: string): TaskClaimResult {
    if (!this.db) return { success: false, error: 'Database not available' }
    try {
      const result = this.db.prepare(`
        UPDATE team_tasks 
        SET status = 'in_progress', claimed_by = ?, claimed_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(memberId, new Date().toISOString(), taskId)

      if (result.changes === 0) {
        return { success: false, error: 'Task already claimed or not found' }
      }

      // 获取更新后的任务
      const task = this.getTask(taskId)
      return { success: true, task }
    } catch (err) {
      console.error('[TeamRepository] claimTask error:', err)
      return { success: false, error: String(err) }
    }
  }

  getTask(taskId: string): TeamTask | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare('SELECT * FROM team_tasks WHERE id = ?').get(taskId)
      if (!row) return undefined
      return this.mapTaskRow(row)
    } catch (err) {
      console.error('[TeamRepository] getTask error:', err)
      return undefined
    }
  }

  getTeamTasks(instanceId: string, status?: string): TeamTask[] {
    if (!this.db) return []
    try {
      const sql = status
        ? 'SELECT * FROM team_tasks WHERE instance_id = ? AND status = ? ORDER BY created_at ASC'
        : 'SELECT * FROM team_tasks WHERE instance_id = ? ORDER BY created_at ASC'
      const rows = status ? this.db.prepare(sql).all(instanceId, status) : this.db.prepare(sql).all(instanceId)
      return rows.map(this.mapTaskRow)
    } catch (err) {
      console.error('[TeamRepository] getTeamTasks error:', err)
      return []
    }
  }

  completeTask(taskId: string, result: string): void {
    if (!this.db) return
    try {
      this.db.prepare(
        'UPDATE team_tasks SET status = ?, result = ?, completed_at = ? WHERE id = ?'
      ).run('completed', result, new Date().toISOString(), taskId)
    } catch (err) {
      console.error('[TeamRepository] completeTask error:', err)
    }
  }

  updateTask(taskId: string, updates: Partial<Pick<TeamTask, 'status' | 'claimedBy' | 'claimedAt' | 'result'>>): void {
    if (!this.db) return
    try {
      const setParts: string[] = []
      const values: any[] = []
      if (updates.status !== undefined) {
        setParts.push('status = ?')
        values.push(updates.status)
      }
      if (updates.claimedBy !== undefined) {
        setParts.push('claimed_by = ?')
        values.push(updates.claimedBy)
      }
      if (updates.claimedAt !== undefined) {
        setParts.push('claimed_at = ?')
        values.push(updates.claimedAt)
      }
      if (updates.result !== undefined) {
        setParts.push('result = ?')
        values.push(updates.result)
      }
      if (setParts.length === 0) return
      values.push(taskId)
      this.db.prepare(
        `UPDATE team_tasks SET ${setParts.join(', ')} WHERE id = ?`
      ).run(...values)
    } catch (err) {
      console.error('[TeamRepository] updateTask error:', err)
    }
  }

  private mapTaskRow(row: any): TeamTask {
    return {
      id: row.id,
      instanceId: row.instance_id,
      title: row.title,
      description: row.description,
      status: row.status,
      assignedTo: row.assigned_to,
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      priority: row.priority,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      createdAt: row.created_at,
      completedAt: row.completed_at,
      result: row.result,
    }
  }

  // ---- Team Messages ----

  addMessage(message: TeamMessage): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO team_messages (id, instance_id, from_member_id, to_member_id, type, content, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id,
        message.instanceId,
        message.from,
        message.to || null,
        message.type,
        message.content,
        message.timestamp
      )
    } catch (err) {
      console.error('[TeamRepository] addMessage error:', err)
    }
  }

  getTeamMessages(instanceId: string, limit: number = 100): TeamMessage[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM team_messages WHERE instance_id = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(instanceId, limit)
      return rows.map((row: any) => ({
        id: row.id,
        instanceId: row.instance_id,
        from: row.from_member_id,
        to: row.to_member_id || undefined,
        type: row.type,
        content: row.content,
        timestamp: row.timestamp,
      })).reverse()
    } catch (err) {
      console.error('[TeamRepository] getTeamMessages error:', err)
      return []
    }
  }

  // ---- Templates ----

  getTemplates(): TeamTemplate[] {
    if (!this.db) return []
    try {
      const rows = this.db.prepare('SELECT * FROM team_templates ORDER BY created_at DESC').all()
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        roles: row.roles ? JSON.parse(row.roles) : [],
        createdAt: row.created_at,
      }))
    } catch (err) {
      console.error('[TeamRepository] getTemplates error:', err)
      return []
    }
  }

  getTemplate(templateId: string): TeamTemplate | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare('SELECT * FROM team_templates WHERE id = ?').get(templateId)
      if (!row) return undefined
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        roles: row.roles ? JSON.parse(row.roles) : [],
        createdAt: row.created_at,
      }
    } catch (err) {
      console.error('[TeamRepository] getTemplate error:', err)
      return undefined
    }
  }
}

// 重新导出类型
export type { TaskClaimResult } from './types'
export type { TeamInstance, TeamMember, TeamTask, TeamMessage, TeamTemplate, TeamRole } from './types'
