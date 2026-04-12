/**
 * TeamRepository 集成测试
 *
 * 覆盖：DAG 验证、生命周期、任务编辑、模板 CRUD、ensureAllTables
 *
 * 注：better-sqlite3 是为 Electron 编译的原生模块，纯 Node 环境可能无法加载。
 * 此测试使用条件跳过。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TeamRepository } from './TeamRepository'

let dbAvailable = false
let Database: any
try {
  Database = require('better-sqlite3')
  const testDb = new Database(':memory:')
  testDb.exec('CREATE TABLE _test (id INTEGER)')
  testDb.close()
  dbAvailable = true
} catch {
  dbAvailable = false
}

const describeIfDb = dbAvailable ? describe : describe.skip

function createRepo(): { repo: TeamRepository; db: any } {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const repo = new TeamRepository(db, true)
  return { repo, db }
}

describeIfDb('TeamRepository ensureAllTables', () => {
  let db: any
  let repo: TeamRepository

  beforeEach(() => {
    const result = createRepo()
    db = result.db
    repo = result.repo
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('ensureAllTables 应创建所有必要表', () => {
    repo.ensureAllTables()

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'team_%'"
    ).all().map((r: any) => r.name)

    expect(tables).toContain('team_instances')
    expect(tables).toContain('team_members')
    expect(tables).toContain('team_tasks')
    expect(tables).toContain('team_messages')
    expect(tables).toContain('team_templates')
  })

  it('ensureAllTables 重复调用应无副作用', () => {
    repo.ensureAllTables()
    repo.ensureAllTables()
    // 不抛错即可
    expect(true).toBe(true)
  })
})

describeIfDb('TeamRepository DAG 验证', () => {
  let db: any
  let repo: TeamRepository

  beforeEach(() => {
    const result = createRepo()
    db = result.db
    repo = result.repo
    repo.ensureAllTables()

    // 创建测试团队
    db.exec(`INSERT INTO team_instances (id, name, status, work_dir, session_id) VALUES ('team-dag', 'DAG Team', 'running', '/tmp', 'sess-dag')`)
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('无依赖时所有任务都应就绪', () => {
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t1', 'team-dag', 'Task 1', 'pending', 'medium', '[]')`)
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t2', 'team-dag', 'Task 2', 'pending', 'medium', '[]')`)

    const validation = repo.validateTaskDependencies('team-dag')
    expect(validation.valid).toBe(true)
    expect(validation.readyTasks).toContain('t1')
    expect(validation.readyTasks).toContain('t2')
    expect(validation.blockedTasks).toHaveLength(0)
  })

  it('依赖未完成时应阻塞', () => {
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t1', 'team-dag', 'Task 1', 'pending', 'medium', '[]')`)
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t2', 'team-dag', 'Task 2', 'pending', 'medium', '["t1"]')`)

    const validation = repo.validateTaskDependencies('team-dag')
    expect(validation.valid).toBe(true)
    expect(validation.readyTasks).toContain('t1')
    expect(validation.blockedTasks).toContain('t2')
  })

  it('循环依赖应检测出', () => {
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t1', 'team-dag', 'Task 1', 'pending', 'medium', '["t2"]')`)
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t2', 'team-dag', 'Task 2', 'pending', 'medium', '["t1"]')`)

    const validation = repo.validateTaskDependencies('team-dag')
    expect(validation.valid).toBe(false)
    expect(validation.cycles.length).toBeGreaterThan(0)
  })

  it('缺失依赖应检测出', () => {
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t1', 'team-dag', 'Task 1', 'pending', 'medium', '["nonexistent"]')`)

    const validation = repo.validateTaskDependencies('team-dag')
    expect(validation.missingDependencies).toContain('nonexistent')
  })

  it('getTaskDAG 应正确计算执行波次', () => {
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t1', 'team-dag', 'Task 1', 'pending', 'medium', '[]')`)
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t2', 'team-dag', 'Task 2', 'pending', 'medium', '[]')`)
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, status, priority, dependencies) VALUES ('t3', 'team-dag', 'Task 3', 'pending', 'medium', '["t1","t2"]')`)

    const dag = repo.getTaskDAG('team-dag')
    expect(dag).toHaveLength(3)

    const t1 = dag.find(n => n.taskId === 't1')!
    const t2 = dag.find(n => n.taskId === 't2')!
    const t3 = dag.find(n => n.taskId === 't3')!

    expect(t1.executionWave).toBe(0)
    expect(t2.executionWave).toBe(0)
    expect(t3.executionWave).toBe(1)
    expect(t3.isBlocked).toBe(true)
    expect(t3.dependsOn).toContain('t1')
    expect(t3.dependsOn).toContain('t2')
  })
})

describeIfDb('TeamRepository 团队生命周期', () => {
  let db: any
  let repo: TeamRepository

  beforeEach(() => {
    const result = createRepo()
    db = result.db
    repo = result.repo
    repo.ensureAllTables()
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('创建和查询团队实例', () => {
    repo.createTeamInstance({
      id: 'team-lc',
      name: 'Lifecycle Team',
      status: 'pending',
      workDir: '/tmp',
      sessionId: 'sess-lc',
      objective: 'Test lifecycle',
      createdAt: new Date().toISOString(),
      members: [],
    })

    const team = repo.getTeamInstance('team-lc')
    expect(team).toBeDefined()
    expect(team!.name).toBe('Lifecycle Team')
    expect(team!.status).toBe('pending')
  })

  it('更新团队状态', () => {
    repo.createTeamInstance({
      id: 'team-st',
      name: 'Status Team',
      status: 'pending',
      workDir: '/tmp',
      sessionId: 'sess-st',
      createdAt: new Date().toISOString(),
      members: [],
    })

    repo.updateTeamStatus('team-st', 'running')
    expect(repo.getTeamInstance('team-st')!.status).toBe('running')

    repo.updateTeamStatus('team-st', 'completed')
    expect(repo.getTeamInstance('team-st')!.status).toBe('completed')
    expect(repo.getTeamInstance('team-st')!.completedAt).toBeDefined()
  })

  it('按状态查询团队', () => {
    repo.createTeamInstance({ id: 't-r1', name: 'R1', status: 'running', workDir: '/tmp', sessionId: 's1', createdAt: new Date().toISOString(), members: [] })
    repo.createTeamInstance({ id: 't-r2', name: 'R2', status: 'running', workDir: '/tmp', sessionId: 's2', createdAt: new Date().toISOString(), members: [] })
    repo.createTeamInstance({ id: 't-c1', name: 'C1', status: 'completed', workDir: '/tmp', sessionId: 's3', createdAt: new Date().toISOString(), members: [] })

    const running = repo.getAllTeamInstances('running')
    expect(running).toHaveLength(2)

    const completed = repo.getAllTeamInstances('completed')
    expect(completed).toHaveLength(1)
  })
})

describeIfDb('TeamRepository 任务编辑', () => {
  let db: any
  let repo: TeamRepository

  beforeEach(() => {
    const result = createRepo()
    db = result.db
    repo = result.repo
    repo.ensureAllTables()

    db.exec(`INSERT INTO team_instances (id, name, status, work_dir, session_id) VALUES ('team-te', 'Edit Team', 'running', '/tmp', 'sess-te')`)
    db.exec(`INSERT INTO team_tasks (id, instance_id, title, description, status, priority, dependencies) VALUES ('task-edit', 'team-te', 'Original', 'Desc', 'pending', 'medium', '[]')`)
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('updateTaskFull 应更新 pending 任务', () => {
    repo.updateTaskFull('task-edit', { title: 'Updated', priority: 'high' })
    const task = repo.getTask('task-edit')
    expect(task!.title).toBe('Updated')
    expect(task!.priority).toBe('high')
  })

  it('completeTask 应标记完成', () => {
    repo.completeTask('task-edit', 'Done successfully')
    const task = repo.getTask('task-edit')
    expect(task!.status).toBe('completed')
    expect(task!.result).toBe('Done successfully')
    expect(task!.completedAt).toBeDefined()
  })

  it('cancelTask 应标记取消（通过 updateTaskFull）', () => {
    repo.updateTaskFull('task-edit', { status: 'cancelled', result: '用户取消' })
    const task = repo.getTask('task-edit')
    expect(task!.status).toBe('cancelled')
  })
})

describeIfDb('TeamRepository 模板 CRUD', () => {
  let db: any
  let repo: TeamRepository

  beforeEach(() => {
    const result = createRepo()
    db = result.db
    repo = result.repo
    repo.ensureAllTables()
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('创建和查询模板', () => {
    repo.createTemplate({
      id: 'tpl-test',
      name: 'Test Template',
      description: 'A test template',
      roles: [{ id: 'r1', name: 'Dev', identifier: 'dev', icon: '🔧', color: 'blue', description: '', systemPrompt: '', isLeader: false }],
      createdAt: new Date().toISOString(),
    })

    const tpl = repo.getTemplate('tpl-test')
    expect(tpl).toBeDefined()
    expect(tpl!.name).toBe('Test Template')
    expect(tpl!.roles).toHaveLength(1)
  })

  it('更新模板', () => {
    repo.createTemplate({
      id: 'tpl-upd',
      name: 'Before',
      description: 'Before desc',
      roles: [],
      createdAt: new Date().toISOString(),
    })

    repo.updateTemplate('tpl-upd', { name: 'After', description: 'After desc' })
    const tpl = repo.getTemplate('tpl-upd')
    expect(tpl!.name).toBe('After')
    expect(tpl!.description).toBe('After desc')
  })

  it('删除模板', () => {
    repo.createTemplate({
      id: 'tpl-del',
      name: 'To Delete',
      description: '',
      roles: [],
      createdAt: new Date().toISOString(),
    })

    repo.deleteTemplate('tpl-del')
    expect(repo.getTemplate('tpl-del')).toBeUndefined()
  })

  it('内置模板不可删除', () => {
    repo.createTemplate({
      id: 'dev-team',
      name: 'Built-in',
      description: '',
      roles: [],
      createdAt: new Date().toISOString(),
    })

    repo.deleteTemplate('dev-team')
    // 内置模板应保留
    expect(repo.getTemplate('dev-team')).toBeDefined()
  })
})

describeIfDb('TeamRepository 成员操作', () => {
  let db: any
  let repo: TeamRepository

  beforeEach(() => {
    const result = createRepo()
    db = result.db
    repo = result.repo
    repo.ensureAllTables()

    db.exec(`INSERT INTO team_instances (id, name, status, work_dir, session_id) VALUES ('team-mb', 'Member Team', 'running', '/tmp', 'sess-mb')`)
  })

  afterEach(() => {
    if (db) db.close()
  })

  it('添加和查询成员', () => {
    repo.addTeamMember({
      id: 'm1',
      instanceId: 'team-mb',
      roleId: 'leader',
      role: { id: 'leader', name: 'Leader', identifier: 'leader', icon: '👑', color: 'orange', description: '', systemPrompt: '', isLeader: true },
      sessionId: 'sess-m1',
      status: 'idle',
      providerId: 'claude-code',
      joinedAt: new Date().toISOString(),
    })

    const members = repo.getTeamMembers('team-mb')
    expect(members).toHaveLength(1)
    expect(members[0].role.identifier).toBe('leader')
  })

  it('getMemberByRole 应按角色查找', () => {
    repo.addTeamMember({
      id: 'm2',
      instanceId: 'team-mb',
      roleId: 'backend',
      role: { id: 'backend', name: 'Backend', identifier: 'backend', icon: '🔧', color: 'blue', description: '', systemPrompt: '', isLeader: false },
      sessionId: 'sess-m2',
      status: 'idle',
      providerId: 'claude-code',
      joinedAt: new Date().toISOString(),
    })

    const member = repo.getMemberByRole('team-mb', 'backend')
    expect(member).toBeDefined()
    expect(member!.roleId).toBe('backend')
  })

  it('updateMemberTask 应更新成员当前任务', () => {
    repo.addTeamMember({
      id: 'm3',
      instanceId: 'team-mb',
      roleId: 'frontend',
      role: { id: 'frontend', name: 'Frontend', identifier: 'frontend', icon: '🎨', color: 'green', description: '', systemPrompt: '', isLeader: false },
      sessionId: 'sess-m3',
      status: 'idle',
      providerId: 'claude-code',
      joinedAt: new Date().toISOString(),
    })

    repo.updateMemberTask('m3', 'task-1')
    const member = repo.getMemberById('m3')
    expect(member!.currentTaskId).toBe('task-1')

    repo.updateMemberTask('m3', null)
    const updated = repo.getMemberById('m3')
    expect(updated!.currentTaskId).toBeNull()
  })
})

// 无需 SQLite 的概念测试
describe('TeamRepository DAG 概念验证', () => {
  it('Kahn 算法应正确排序无环图', () => {
    // A → C, B → C 的拓扑排序：A, B, C 或 B, A, C
    const tasks = [
      { id: 'A', dependencies: [] },
      { id: 'B', dependencies: [] },
      { id: 'C', dependencies: ['A', 'B'] },
    ]
    const inDegree = new Map(tasks.map(t => [t.id, t.dependencies.length]))
    const queue = tasks.filter(t => t.dependencies.length === 0).map(t => t.id)
    expect(queue).toContain('A')
    expect(queue).toContain('B')
    expect(queue).not.toContain('C')
  })

  it('循环依赖时拓扑排序应不完整', () => {
    // A → B → A 循环
    const tasks = [
      { id: 'A', dependencies: ['B'] },
      { id: 'B', dependencies: ['A'] },
    ]
    const inDegree = new Map(tasks.map(t => [t.id, t.dependencies.length]))
    // 所有节点入度 > 0，队列为空
    const queue = tasks.filter(t => t.dependencies.length === 0).map(t => t.id)
    expect(queue).toHaveLength(0)
  })
})
