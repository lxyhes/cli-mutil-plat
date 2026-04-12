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
  TeamStatus,
  MemberStatus,
  TaskClaimResult,
  TaskDAGNode,
  DAGValidation,
} from './types'

/** 团队数据仓库 */
export class TeamRepository {
  private templatesTableEnsured = false
  private allTablesEnsured = false
  private tableColumnsCache = new Map<string, Set<string>>()

  constructor(private db: any, private usingSqlite: boolean) {}

  /** 确保所有团队表都存在（首次使用前调用） */
  ensureAllTables(): void {
    if (!this.db || this.allTablesEnsured) return
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS team_instances (
          id TEXT PRIMARY KEY,
          team_id TEXT,
          name TEXT NOT NULL,
          template_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          work_dir TEXT,
          working_directory TEXT,
          session_id TEXT,
          parent_session_id TEXT,
          objective TEXT,
          task TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          ended_at DATETIME,
          parent_team_id TEXT,
          worktree_isolation INTEGER NOT NULL DEFAULT 0,
          reviewer_agent_id TEXT,
          goal_round INTEGER DEFAULT 0
        )
      `)

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS team_members (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL,
          role_id TEXT,
          role_name TEXT,
          display_name TEXT,
          role_identifier TEXT,
          role_icon TEXT,
          role_color TEXT,
          color TEXT,
          agent_id TEXT,
          child_session_id TEXT,
          session_id TEXT,
          status TEXT NOT NULL DEFAULT 'idle',
          provider_id TEXT,
          goal_round INTEGER DEFAULT 1,
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 2,
          failure_reason TEXT,
          current_task_id TEXT,
          work_dir TEXT,
          worktree_path TEXT,
          worktree_branch TEXT,
          worktree_source_repo TEXT,
          worktree_base_commit TEXT,
          worktree_base_branch TEXT,
          joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_active_at DATETIME,
          FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
        )
      `)
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_instance ON team_members(instance_id)`)

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS team_tasks (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          assigned_to TEXT,
          claimed_by TEXT,
          claimed_at DATETIME,
          priority TEXT NOT NULL DEFAULT 'medium',
          dependencies TEXT,
          result TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
        )
      `)
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_team_tasks_instance_status ON team_tasks(instance_id, status)`)

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS team_messages (
          id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL,
          from_member_id TEXT,
          from_role TEXT,
          to_member_id TEXT,
          to_role TEXT,
          type TEXT,
          message_type TEXT,
          content TEXT,
          timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          task_id TEXT,
          FOREIGN KEY (instance_id) REFERENCES team_instances(id) ON DELETE CASCADE
        )
      `)
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_team_messages_instance_timestamp ON team_messages(instance_id, timestamp DESC)`)

      this.ensureTemplatesTable()
      this.allTablesEnsured = true
      this.tableColumnsCache.clear()
    } catch (err) {
      console.error('[TeamRepository] ensureAllTables error:', err)
    }
  }

  private getTableColumns(tableName: string): Set<string> {
    if (!this.db) return new Set()
    const cached = this.tableColumnsCache.get(tableName)
    if (cached) return cached

    try {
      const cols = this.db.prepare(`PRAGMA table_info(${tableName})`).all().map((row: any) => row.name)
      const set = new Set<string>(cols)
      this.tableColumnsCache.set(tableName, set)
      return set
    } catch (err) {
      console.error(`[TeamRepository] getTableColumns(${tableName}) error:`, err)
      return new Set()
    }
  }

  private getRowValue<T = any>(row: any, ...keys: string[]): T | undefined {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null) return row[key] as T
    }
    return undefined
  }

  private updateByExistingColumns(
    tableName: string,
    whereClause: string,
    whereValues: any[],
    valuesByColumn: Record<string, any>,
  ): void {
    if (!this.db) return
    const cols = this.getTableColumns(tableName)
    const updateColumns = Object.keys(valuesByColumn).filter(column => cols.has(column))
    if (updateColumns.length === 0) return

    const setClause = updateColumns.map(column => `${column} = ?`).join(', ')
    const values = updateColumns.map(column => valuesByColumn[column])
    this.db.prepare(
      `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`,
    ).run(...values, ...whereValues)
  }

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
    this.ensureAllTables()
    try {
      const cols = this.getTableColumns('team_instances')
      const valuesByColumn: Record<string, any> = {
        id: instance.id,
        team_id: instance.id,
        name: instance.name,
        template_id: instance.templateId || null,
        status: instance.status,
        work_dir: instance.workDir,
        working_directory: instance.workDir,
        session_id: instance.sessionId,
        parent_session_id: instance.sessionId,
        objective: instance.objective,
        task: instance.objective,
        created_at: instance.createdAt,
        started_at: instance.startedAt || instance.createdAt,
        completed_at: instance.completedAt || null,
        ended_at: instance.completedAt || null,
        parent_team_id: instance.parentTeamId || null,
        worktree_isolation: instance.worktreeIsolation ? 1 : 0,
        reviewer_agent_id: null,
        goal_round: 0,
      }
      const insertColumns = Object.keys(valuesByColumn).filter(column => cols.has(column))
      const placeholders = insertColumns.map(() => '?').join(', ')
      this.db.prepare(`
        INSERT INTO team_instances (${insertColumns.join(', ')})
        VALUES (${placeholders})
      `).run(...insertColumns.map(column => valuesByColumn[column]))
    } catch (err) {
      console.error('[TeamRepository] createTeamInstance error:', err)
      throw err
    }
  }

  getTeamInstance(instanceId: string): TeamInstance | undefined {
    if (!this.db) return undefined
    this.ensureAllTables()
    try {
      const row = this.db.prepare('SELECT * FROM team_instances WHERE id = ?').get(instanceId)
      if (!row) return undefined

      const members = this.getTeamMembers(instanceId)
      return {
        id: row.id,
        name: row.name,
        templateId: this.getRowValue<string>(row, 'template_id'),
        status: (this.getRowValue<string>(row, 'status') || 'pending') as TeamStatus,
        workDir: this.getRowValue<string>(row, 'work_dir', 'working_directory') || '',
        sessionId: this.getRowValue<string>(row, 'session_id', 'parent_session_id') || '',
        objective: this.getRowValue<string>(row, 'objective', 'task') || '',
        createdAt: this.getRowValue<string>(row, 'created_at') || new Date().toISOString(),
        startedAt: this.getRowValue<string>(row, 'started_at') || undefined,
        completedAt: this.getRowValue<string>(row, 'completed_at', 'ended_at') || undefined,
        parentTeamId: this.getRowValue<string>(row, 'parent_team_id') || undefined,
        worktreeIsolation: this.getRowValue<number>(row, 'worktree_isolation') === 1,
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
    this.ensureAllTables()
    try {
      const sql = status 
        ? 'SELECT * FROM team_instances WHERE status = ? ORDER BY created_at DESC'
        : 'SELECT * FROM team_instances ORDER BY created_at DESC'
      const rows = status ? this.db.prepare(sql).all(status) : this.db.prepare(sql).all()
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        templateId: this.getRowValue<string>(row, 'template_id'),
        status: (this.getRowValue<string>(row, 'status') || 'pending') as TeamStatus,
        workDir: this.getRowValue<string>(row, 'work_dir', 'working_directory') || '',
        sessionId: this.getRowValue<string>(row, 'session_id', 'parent_session_id') || '',
        objective: this.getRowValue<string>(row, 'objective', 'task') || '',
        createdAt: this.getRowValue<string>(row, 'created_at') || new Date().toISOString(),
        startedAt: this.getRowValue<string>(row, 'started_at') || undefined,
        completedAt: this.getRowValue<string>(row, 'completed_at', 'ended_at') || undefined,
        parentTeamId: this.getRowValue<string>(row, 'parent_team_id') || undefined,
        worktreeIsolation: this.getRowValue<number>(row, 'worktree_isolation') === 1,
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
      this.updateByExistingColumns('team_instances', 'id = ?', [instanceId], {
        status,
        completed_at: completedAt,
        ended_at: completedAt,
      })
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
    this.ensureAllTables()
    try {
      const cols = this.getTableColumns('team_members')
      const valuesByColumn: Record<string, any> = {
        id: member.id,
        instance_id: member.instanceId,
        role_id: member.roleId,
        role_name: member.role.name,
        display_name: member.role.name,
        role_identifier: member.role.identifier,
        role_icon: member.role.icon,
        role_color: member.role.color,
        color: member.role.color,
        agent_id: member.id,
        child_session_id: member.sessionId,
        session_id: member.sessionId,
        status: member.status,
        provider_id: member.providerId,
        goal_round: 1,
        retry_count: 0,
        max_retries: 2,
        failure_reason: null,
        current_task_id: member.currentTaskId || null,
        work_dir: member.workDir || null,
        worktree_path: member.worktreePath || null,
        worktree_branch: member.worktreeBranch || null,
        worktree_source_repo: member.worktreeSourceRepo || null,
        worktree_base_commit: member.worktreeBaseCommit || null,
        worktree_base_branch: member.worktreeBaseBranch || null,
        joined_at: member.joinedAt,
        last_active_at: member.lastActiveAt || null,
      }
      const insertColumns = Object.keys(valuesByColumn).filter(column => cols.has(column))
      const placeholders = insertColumns.map(() => '?').join(', ')
      this.db.prepare(`
        INSERT INTO team_members (${insertColumns.join(', ')})
        VALUES (${placeholders})
      `).run(...insertColumns.map(column => valuesByColumn[column]))
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
        roleId: this.getRowValue<string>(row, 'role_id') || '',
        role: {
          id: this.getRowValue<string>(row, 'role_id') || '',
          name: this.getRowValue<string>(row, 'role_name') || '',
          identifier: this.getRowValue<string>(row, 'role_identifier') || '',
          icon: this.getRowValue<string>(row, 'role_icon') || '',
          color: this.getRowValue<string>(row, 'role_color') || '',
          description: '',
          systemPrompt: '',
          isLeader: this.getRowValue<string>(row, 'role_identifier') === 'leader',
        },
        sessionId: this.getRowValue<string>(row, 'session_id') || '',
        status: this.getRowValue<string>(row, 'status') || 'idle',
        providerId: this.getRowValue<string>(row, 'provider_id') || '',
        currentTaskId: this.getRowValue<string>(row, 'current_task_id'),
        workDir: this.getRowValue<string>(row, 'work_dir') || undefined,
        worktreePath: this.getRowValue<string>(row, 'worktree_path') || undefined,
        worktreeBranch: this.getRowValue<string>(row, 'worktree_branch') || undefined,
        worktreeSourceRepo: this.getRowValue<string>(row, 'worktree_source_repo') || undefined,
        worktreeBaseCommit: this.getRowValue<string>(row, 'worktree_base_commit') || undefined,
        worktreeBaseBranch: this.getRowValue<string>(row, 'worktree_base_branch') || undefined,
        joinedAt: this.getRowValue<string>(row, 'joined_at') || new Date().toISOString(),
        lastActiveAt: this.getRowValue<string>(row, 'last_active_at'),
      }))
    } catch (err) {
      console.error('[TeamRepository] getTeamMembers error:', err)
      return []
    }
  }

  updateMemberStatus(memberId: string, status: string): void {
    if (!this.db) return
    try {
      this.updateByExistingColumns('team_members', 'id = ?', [memberId], {
        status,
        last_active_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[TeamRepository] updateMemberStatus error:', err)
    }
  }

  updateMember(memberId: string, updates: Partial<Pick<TeamMember, 'status' | 'currentTaskId' | 'lastActiveAt'>>): void {
    if (!this.db) return
    try {
      this.updateByExistingColumns('team_members', 'id = ?', [memberId], {
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.currentTaskId !== undefined ? { current_task_id: updates.currentTaskId } : {}),
        last_active_at: updates.lastActiveAt ?? new Date().toISOString(),
      })
    } catch (err) {
      console.error('[TeamRepository] updateMember error:', err)
    }
  }

  updateMemberTask(memberId: string, taskId: string | null): void {
    if (!this.db) return
    try {
      this.updateByExistingColumns('team_members', 'id = ?', [memberId], {
        current_task_id: taskId,
        last_active_at: new Date().toISOString(),
      })
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
        roleId: this.getRowValue<string>(r, 'role_id') || '',
        role: {
          id: this.getRowValue<string>(r, 'role_id') || '',
          name: this.getRowValue<string>(r, 'role_name') || '',
          identifier: this.getRowValue<string>(r, 'role_identifier') || '',
          icon: this.getRowValue<string>(r, 'role_icon') || '',
          color: this.getRowValue<string>(r, 'role_color') || '',
          description: '',
          systemPrompt: '',
          isLeader: this.getRowValue<string>(r, 'role_identifier') === 'leader',
        },
        sessionId: this.getRowValue<string>(r, 'session_id') || '',
        status: (this.getRowValue<string>(r, 'status') || 'idle') as MemberStatus,
        providerId: this.getRowValue<string>(r, 'provider_id') || '',
        currentTaskId: this.getRowValue<string>(r, 'current_task_id'),
        workDir: this.getRowValue<string>(r, 'work_dir') || undefined,
        worktreePath: this.getRowValue<string>(r, 'worktree_path') || undefined,
        worktreeBranch: this.getRowValue<string>(r, 'worktree_branch') || undefined,
        worktreeSourceRepo: this.getRowValue<string>(r, 'worktree_source_repo') || undefined,
        worktreeBaseCommit: this.getRowValue<string>(r, 'worktree_base_commit') || undefined,
        worktreeBaseBranch: this.getRowValue<string>(r, 'worktree_base_branch') || undefined,
        joinedAt: this.getRowValue<string>(r, 'joined_at') || new Date().toISOString(),
        lastActiveAt: this.getRowValue<string>(r, 'last_active_at'),
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
        roleId: this.getRowValue<string>(r, 'role_id') || '',
        role: {
          id: this.getRowValue<string>(r, 'role_id') || '',
          name: this.getRowValue<string>(r, 'role_name') || '',
          identifier: this.getRowValue<string>(r, 'role_identifier') || '',
          icon: this.getRowValue<string>(r, 'role_icon') || '',
          color: this.getRowValue<string>(r, 'role_color') || '',
          description: '',
          systemPrompt: '',
          isLeader: this.getRowValue<string>(r, 'role_identifier') === 'leader',
        },
        sessionId: this.getRowValue<string>(r, 'session_id') || '',
        status: (this.getRowValue<string>(r, 'status') || 'idle') as MemberStatus,
        providerId: this.getRowValue<string>(r, 'provider_id') || '',
        currentTaskId: this.getRowValue<string>(r, 'current_task_id'),
        workDir: this.getRowValue<string>(r, 'work_dir') || undefined,
        worktreePath: this.getRowValue<string>(r, 'worktree_path') || undefined,
        worktreeBranch: this.getRowValue<string>(r, 'worktree_branch') || undefined,
        worktreeSourceRepo: this.getRowValue<string>(r, 'worktree_source_repo') || undefined,
        worktreeBaseCommit: this.getRowValue<string>(r, 'worktree_base_commit') || undefined,
        worktreeBaseBranch: this.getRowValue<string>(r, 'worktree_base_branch') || undefined,
        joinedAt: this.getRowValue<string>(r, 'joined_at') || new Date().toISOString(),
        lastActiveAt: this.getRowValue<string>(r, 'last_active_at'),
      }
    } catch (err) {
      console.error('[TeamRepository] getMemberById error:', err)
      return undefined
    }
  }

  // ---- Team Tasks ----

  createTask(task: TeamTask): void {
    if (!this.db) return
    this.ensureAllTables()
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
    this.ensureAllTables()
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
    this.ensureAllTables()
    try {
      const cols = this.getTableColumns('team_messages')
      const valuesByColumn: Record<string, any> = {
        id: message.id,
        instance_id: message.instanceId,
        from_member_id: message.from,
        from_role: message.from,
        to_member_id: message.to || null,
        to_role: message.to || null,
        type: message.type,
        message_type: message.type,
        content: message.content,
        timestamp: message.timestamp,
        task_id: null,
      }
      const insertColumns = Object.keys(valuesByColumn).filter(column => cols.has(column))
      if (insertColumns.length === 0) return
      const placeholders = insertColumns.map(() => '?').join(', ')
      this.db.prepare(`
        INSERT INTO team_messages (${insertColumns.join(', ')})
        VALUES (${placeholders})
      `).run(...insertColumns.map(column => valuesByColumn[column]))
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
        from: this.getRowValue<string>(row, 'from_member_id', 'from_role') || '',
        to: this.getRowValue<string>(row, 'to_member_id', 'to_role') || undefined,
        type: this.getRowValue<any>(row, 'type', 'message_type') || 'role_message',
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
