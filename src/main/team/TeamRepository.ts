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
  TaskDAGNode,
  DAGValidation,
} from './types'

/** 团队数据仓库 */
export class TeamRepository {
  private templatesTableEnsured = false

  constructor(private db: any, private usingSqlite: boolean) {}

  private ensureTemplatesTable(): void {
    if (!this.db || this.templatesTableEnsured) return

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS team_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          roles TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
      this.templatesTableEnsured = true
    } catch (err) {
      console.error('[TeamRepository] ensureTemplatesTable error:', err)
    }
  }

  // ---- Team Instances ----

  createTeamInstance(instance: Omit<TeamInstance, 'members'>): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO team_instances (id, name, template_id, status, work_dir, session_id, objective, created_at, parent_team_id, worktree_isolation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        instance.id,
        instance.name,
        instance.templateId || null,
        instance.status,
        instance.workDir,
        instance.sessionId,
        instance.objective,
        instance.createdAt,
        instance.parentTeamId || null,
        instance.worktreeIsolation ? 1 : 0
      )
    } catch (err) {
      console.error('[TeamRepository] createTeamInstance error:', err)
      throw err
    }
  }

  getTeamInstance(instanceId: string): TeamInstance | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare('SELECT * FROM team_instances WHERE id = ?').get(instanceId)
      if (!row) return undefined

      const members = this.getTeamMembers(instanceId)
      return {
        id: row.id,
        name: row.name,
        templateId: row.template_id || undefined,
        status: row.status,
        workDir: row.work_dir,
        sessionId: row.session_id,
        objective: row.objective,
        createdAt: row.created_at,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined,
        parentTeamId: row.parent_team_id || undefined,
        worktreeIsolation: row.worktree_isolation === 1,
        members,
      }
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
        id: row.id,
        name: row.name,
        templateId: row.template_id || undefined,
        status: row.status,
        workDir: row.work_dir,
        sessionId: row.session_id,
        objective: row.objective,
        createdAt: row.created_at,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined,
        parentTeamId: row.parent_team_id || undefined,
        worktreeIsolation: row.worktree_isolation === 1,
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
      const completedAt = (status === 'completed' || status === 'failed' || status === 'cancelled')
        ? new Date().toISOString()
        : null
      this.db.prepare(
        'UPDATE team_instances SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?'
      ).run(status, completedAt, instanceId)
    } catch (err) {
      console.error('[TeamRepository] updateTeamStatus error:', err)
    }
  }

  deleteTeamInstance(instanceId: string): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM team_instances WHERE id = ?').run(instanceId)
    } catch (err) {
      console.error('[TeamRepository] deleteTeamInstance error:', err)
    }
  }

  // ---- Team Members ----

  addTeamMember(member: Omit<TeamMember, 'role'> & { role: TeamRole }): void {
    if (!this.db) return
    try {
      this.db.prepare(`
        INSERT INTO team_members (
          id, instance_id, role_id, role_name, role_identifier, role_icon, role_color,
          session_id, status, provider_id, work_dir, worktree_path, worktree_branch,
          worktree_source_repo, worktree_base_commit, worktree_base_branch, joined_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        member.workDir || null,
        member.worktreePath || null,
        member.worktreeBranch || null,
        member.worktreeSourceRepo || null,
        member.worktreeBaseCommit || null,
        member.worktreeBaseBranch || null,
        member.joinedAt
      )
    } catch (err) {
      console.error('[TeamRepository] addTeamMember error:', err)
      throw err
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
        workDir: row.work_dir || undefined,
        worktreePath: row.worktree_path || undefined,
        worktreeBranch: row.worktree_branch || undefined,
        worktreeSourceRepo: row.worktree_source_repo || undefined,
        worktreeBaseCommit: row.worktree_base_commit || undefined,
        worktreeBaseBranch: row.worktree_base_branch || undefined,
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
        workDir: r.work_dir || undefined,
        worktreePath: r.worktree_path || undefined,
        worktreeBranch: r.worktree_branch || undefined,
        worktreeSourceRepo: r.worktree_source_repo || undefined,
        worktreeBaseCommit: r.worktree_base_commit || undefined,
        worktreeBaseBranch: r.worktree_base_branch || undefined,
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
        workDir: r.work_dir || undefined,
        worktreePath: r.worktree_path || undefined,
        worktreeBranch: r.worktree_branch || undefined,
        worktreeSourceRepo: r.worktree_source_repo || undefined,
        worktreeBaseCommit: r.worktree_base_commit || undefined,
        worktreeBaseBranch: r.worktree_base_branch || undefined,
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
      throw err
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

  // ---- Task DAG ----

  /**
   * 计算任务依赖 DAG（Kahn 算法拓扑排序）
   * @returns 按执行顺序排列的 DAG 节点列表
   */
  getTaskDAG(instanceId: string): TaskDAGNode[] {
    const tasks = this.getTeamTasks(instanceId)
    const taskMap = new Map<string, TeamTask>(tasks.map(t => [t.id, t]))
    const inDegree = new Map<string, number>()
    const adjList = new Map<string, string[]>() // taskId -> 依赖它的任务列表

    // 初始化
    for (const task of tasks) {
      inDegree.set(task.id, 0)
      adjList.set(task.id, [])
    }

    // 构建图：A 依赖 B → B 是 A 的前驱，A 的入度 +1
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskMap.has(depId)) continue // 忽略不存在的依赖
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1)
        adjList.get(depId)?.push(task.id)
      }
    }

    // Kahn 算法
    const queue: string[] = []
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      sorted.push(id)
      for (const next of adjList.get(id) || []) {
        const newDegree = (inDegree.get(next) || 1) - 1
        inDegree.set(next, newDegree)
        if (newDegree === 0) queue.push(next)
      }
    }

    // 计算执行波次（同一波次可以并行）
    const wave = new Map<string, number>()
    // 重新按拓扑序计算波次
    const taskWave = new Map<string, number>()
    for (const id of sorted) {
      const deps = taskMap.get(id)?.dependencies || []
      if (deps.length === 0) {
        taskWave.set(id, 0)
      } else {
        const maxDepWave = Math.max(...deps.map(d => taskWave.get(d) ?? 0))
        taskWave.set(id, maxDepWave + 1)
      }
    }

    return sorted.map((taskId, order) => {
      const task = taskMap.get(taskId)!
      // 计算阻塞项：依赖中还未完成的任务
      const blockedBy = task.dependencies.filter(depId => {
        const dep = taskMap.get(depId)
        return dep && dep.status !== 'completed' && dep.status !== 'cancelled' && dep.status !== 'failed'
      })
      return {
        taskId,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dependsOn: task.dependencies,
        dependents: adjList.get(taskId) || [],
        executionOrder: order,
        executionWave: taskWave.get(taskId) ?? 0,
        isBlocked: blockedBy.length > 0,
        blockedBy,
      }
    })
  }

  /**
   * 验证任务依赖是否有循环或缺失
   */
  validateTaskDependencies(instanceId: string): DAGValidation {
    return this.validateTaskDependenciesForTasks(this.getTeamTasks(instanceId))
  }

  validateTaskDependenciesForTasks(tasks: TeamTask[]): DAGValidation {
    const taskMap = new Map<string, TeamTask>(tasks.map(t => [t.id, t]))
    const taskIds = new Set(tasks.map(t => t.id))

    // 检测缺失依赖
    const missingDependencies = new Set<string>()
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId)) missingDependencies.add(depId)
      }
    }

    // 检测循环依赖（Kahn 算法）
    const inDegree = new Map<string, number>()
    for (const task of tasks) {
      let count = 0
      for (const depId of task.dependencies) {
        if (taskMap.has(depId)) count++
      }
      inDegree.set(task.id, count)
    }

    const queue: string[] = []
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }
    const sorted: string[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      sorted.push(id)
      for (const task of tasks) {
        if (task.dependencies.includes(id)) {
          const newDeg = (inDegree.get(task.id) || 1) - 1
          inDegree.set(task.id, newDeg)
          if (newDeg === 0) queue.push(task.id)
        }
      }
    }

    const cycles: string[][] = []
    if (sorted.length < tasks.length) {
      // 有剩余节点 → 存在环
      const remaining = tasks.filter(t => !sorted.includes(t.id)).map(t => t.id)
      cycles.push(remaining)
    }

    // 计算就绪和被阻塞任务
    const readyTasks: string[] = []
    const blockedTasks: string[] = []
    for (const task of tasks) {
      const hasIncompleteDeps = task.dependencies.some(depId => {
        const dep = taskMap.get(depId)
        return !dep || (dep.status !== 'completed' && dep.status !== 'cancelled' && dep.status !== 'failed')
      })
      if (task.status === 'pending') {
        if (hasIncompleteDeps) blockedTasks.push(task.id)
        else readyTasks.push(task.id)
      }
    }

    return {
      valid: cycles.length === 0,
      cycles,
      missingDependencies: Array.from(missingDependencies),
      readyTasks,
      blockedTasks,
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
    this.ensureTemplatesTable()
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
    this.ensureTemplatesTable()
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

  createTemplate(template: TeamTemplate): void {
    if (!this.db) return
    this.ensureTemplatesTable()
    try {
      this.db.prepare(`
        INSERT INTO team_templates (id, name, description, roles, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(template.id, template.name, template.description, JSON.stringify(template.roles), template.createdAt)
    } catch (err) {
      console.error('[TeamRepository] createTemplate error:', err)
    }
  }

  updateTemplate(templateId: string, updates: Partial<Pick<TeamTemplate, 'name' | 'description' | 'roles'>>): void {
    if (!this.db) return
    this.ensureTemplatesTable()
    try {
      const setParts: string[] = []
      const values: any[] = []
      if (updates.name !== undefined) {
        setParts.push('name = ?')
        values.push(updates.name)
      }
      if (updates.description !== undefined) {
        setParts.push('description = ?')
        values.push(updates.description)
      }
      if (updates.roles !== undefined) {
        setParts.push('roles = ?')
        values.push(JSON.stringify(updates.roles))
      }
      if (setParts.length === 0) return
      values.push(templateId)
      this.db.prepare(`UPDATE team_templates SET ${setParts.join(', ')} WHERE id = ?`).run(...values)
    } catch (err) {
      console.error('[TeamRepository] updateTemplate error:', err)
    }
  }

  deleteTemplate(templateId: string): void {
    if (!this.db) return
    this.ensureTemplatesTable()
    try {
      // 防止删除内置模板
      if (templateId.startsWith('dev-') || templateId === 'dev-team') return
      this.db.prepare('DELETE FROM team_templates WHERE id = ?').run(templateId)
    } catch (err) {
      console.error('[TeamRepository] deleteTemplate error:', err)
    }
  }

  updateTeamName(instanceId: string, name: string): void {
    if (!this.db) return
    try {
      this.db.prepare('UPDATE team_instances SET name = ? WHERE id = ?').run(name, instanceId)
    } catch (err) {
      console.error('[TeamRepository] updateTeamName error:', err)
    }
  }

  updateTeamObjective(instanceId: string, objective: string): void {
    if (!this.db) return
    try {
      this.db.prepare('UPDATE team_instances SET objective = ? WHERE id = ?').run(objective, instanceId)
    } catch (err) {
      console.error('[TeamRepository] updateTeamObjective error:', err)
    }
  }

  updateTaskFull(taskId: string, updates: Partial<Pick<TeamTask, 'title' | 'description' | 'priority' | 'dependencies' | 'status' | 'claimedBy' | 'claimedAt' | 'result' | 'assignedTo'>>): void {
    if (!this.db) return
    try {
      const setParts: string[] = []
      const values: any[] = []
      if (updates.title !== undefined) { setParts.push('title = ?'); values.push(updates.title) }
      if (updates.description !== undefined) { setParts.push('description = ?'); values.push(updates.description) }
      if (updates.priority !== undefined) { setParts.push('priority = ?'); values.push(updates.priority) }
      if (updates.dependencies !== undefined) { setParts.push('dependencies = ?'); values.push(JSON.stringify(updates.dependencies)) }
      if (updates.status !== undefined) { setParts.push('status = ?'); values.push(updates.status) }
      if (updates.claimedBy !== undefined) { setParts.push('claimed_by = ?'); values.push(updates.claimedBy) }
      if (updates.claimedAt !== undefined) { setParts.push('claimed_at = ?'); values.push(updates.claimedAt) }
      if (updates.result !== undefined) { setParts.push('result = ?'); values.push(updates.result) }
      if (updates.assignedTo !== undefined) { setParts.push('assigned_to = ?'); values.push(updates.assignedTo) }
      if (setParts.length === 0) return
      values.push(taskId)
      this.db.prepare(`UPDATE team_tasks SET ${setParts.join(', ')} WHERE id = ?`).run(...values)
    } catch (err) {
      console.error('[TeamRepository] updateTaskFull error:', err)
    }
  }
}

// 重新导出类型
export type { TaskClaimResult } from './types'
export type { TeamInstance, TeamMember, TeamTask, TeamMessage, TeamTemplate, TeamRole, TaskDAGNode, DAGValidation } from './types'
