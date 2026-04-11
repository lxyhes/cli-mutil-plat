/**
 * Agent Teams - 团队管理器
 *
 * 团队实例生命周期协调器
 * 负责创建团队、启动成员 Agent、监控进度、宣告完成
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { teamLog } from './debug'
import type {
  CreateTeamRequest,
  TeamInstance,
  TeamMember,
  TeamTask,
  TeamMessage,
  TeamRole,
  TeamTemplate,
  TaskDAGNode,
  DAGValidation,
  TeamSnapshot,
  TeamWorktreeMergeResult,
} from './types'
import type { TeamRepository } from './TeamRepository'
import type { AgentManagerV2 } from '../agent/AgentManagerV2'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { DatabaseManager } from '../storage/Database'
import { TeamHealthChecker } from './TeamHealthChecker'
import { TeamMessageDelivery } from './TeamMessageDelivery'
import { TeamBridge } from './TeamBridge'
import { GitWorktreeService } from '../git/GitWorktreeService'

/** 内置团队模板 */
const BUILTIN_TEMPLATES: TeamTemplate[] = [
  {
    id: 'dev-team',
    name: '开发团队',
    description: '标准的软件开发团队，包含 Leader、架构师、后端、前端、测试工程师',
    createdAt: new Date().toISOString(),
    roles: [
      {
        id: 'leader',
        name: '团队负责人',
        identifier: 'leader',
        icon: '👑',
        color: 'text-orange-500',
        description: '团队的整体协调者和任务分配者',
        isLeader: true,
        systemPrompt: `你的角色：团队负责人 👑（团队负责人）
你是团队的负责人（Leader），负责整体协调和任务分配。你需要：

1. 接收并理解整体目标
2. 将任务拆解后分配给各成员
3. 监控各成员进展，协调配合
4. 汇总成果，确保目标达成

你作为 Leader 的核心职责：
- 你是整个团队的总指挥，你是唯一有权宣告团队完成的角色。
- 使用 team_broadcast 广播全局信息，使用 team_message_role 与特定成员沟通。
- 当所有任务完成且目标达成时，宣告团队完成。`,
      },
      {
        id: 'architect',
        name: '架构师',
        identifier: 'architect',
        icon: '🏗️',
        color: 'text-purple-500',
        description: '负责系统架构设计和技术选型',
        isLeader: false,
        systemPrompt: `你的角色：架构师 🏗️
你是团队的技术架构师，负责系统架构设计和技术选型。你需要：

1. 分析需求，设计系统架构
2. 确定技术栈和框架选型
3. 设计模块划分和接口定义
4. 指导开发团队遵循架构规范

使用 team_message_role 向 leader 汇报架构方案，向其他成员提供技术指导。`,
      },
      {
        id: 'backend',
        name: '后端工程师',
        identifier: 'backend',
        icon: '🔧',
        color: 'text-blue-500',
        description: '负责后端服务开发和 API 设计',
        isLeader: false,
        systemPrompt: `你的角色：后端工程师 🔧
你是团队的后端开发工程师，负责后端服务和 API 开发。你需要：

1. 根据架构师的设计实现后端服务
2. 开发 RESTful/GraphQL API
3. 实现数据库设计和数据访问层
4. 确保 API 的性能、安全和可维护性

使用 team_message_role 向 leader 汇报进展，与 frontend 协调接口定义。`,
      },
      {
        id: 'frontend',
        name: '前端工程师',
        identifier: 'frontend',
        icon: '🎨',
        color: 'text-green-500',
        description: '负责前端界面开发和用户体验',
        isLeader: false,
        systemPrompt: `你的角色：前端工程师 🎨
你是团队的前端开发工程师，负责用户界面和交互开发。你需要：

1. 实现用户界面和交互设计
2. 对接后端 API
3. 确保响应式设计和浏览器兼容性
4. 优化前端性能和用户体验

使用 team_message_role 向 leader 汇报进展，与 backend 协调接口对接。`,
      },
      {
        id: 'tester',
        name: '测试工程师',
        identifier: 'tester',
        icon: '🧪',
        color: 'text-red-500',
        description: '负责测试用例编写和质量保证',
        isLeader: false,
        systemPrompt: `你的角色：测试工程师 🧪
你是团队的测试工程师，负责质量保证和测试。你需要：

1. 编写单元测试、集成测试和 E2E 测试
2. 执行测试并报告 Bug
3. 验证功能是否符合需求
4. 确保代码质量和覆盖率

使用 team_message_role 向 leader 报告测试结果，向 developer 反馈 Bug。`,
      },
    ],
  },
]

/** 团队事件 */
export interface TeamEvents {
  'team:created': [team: TeamInstance]
  'team:started': [teamId: string]
  'team:status-change': [teamId: string, status: TeamInstance['status']]
  'team:member-joined': [teamId: string, member: TeamMember]
  'team:member-status-change': [teamId: string, memberId: string, status: string]
  'team:task-claimed': [teamId: string, taskId: string, memberId: string]
  'team:task-completed': [teamId: string, taskId: string]
  'team:task-cancelled': [teamId: string, taskId: string]
  'team:message': [teamId: string, message: TeamMessage]
  'team:completed': [teamId: string]
  'team:failed': [teamId: string, reason: string]
  'team:cancelled': [teamId: string, reason: string]
  'team:paused': [teamId: string]
  'team:resumed': [teamId: string]
  'team:updated': [teamId: string, updates: { name?: string; objective?: string }]
  'team:health-issue': [teamId: string, issue: any]
}

/** 团队管理器 */
export class TeamManager extends EventEmitter {
  private activeTeams: Map<string, TeamInstance> = new Map()
  private healthCheckers: Map<string, TeamHealthChecker> = new Map()
  private bridges: Map<string, TeamBridge> = new Map()
  private bridgePort = 63800 // TeamBridge 起始端口

  constructor(
    private teamRepo: TeamRepository,
    private agentManager: AgentManagerV2,
    private sessionManager: SessionManagerV2,
    private database: DatabaseManager,
    private gitService: GitWorktreeService = new GitWorktreeService()
  ) {
    super()
  }

  /**
   * 创建并启动团队
   */
  async createTeam(request: CreateTeamRequest): Promise<TeamInstance> {
    teamLog.debug(`createTeam called: name="${request.name}", templateId="${request.templateId}", workDir="${request.workDir}"`)
    const teamId = uuidv4()
    const sessionId = uuidv4()

    // 获取角色列表（从模板或自定义）
    let roles: TeamRole[]
    if (request.templateId) {
      const template = this.resolveTemplate(request.templateId)
      if (!template) throw new Error(`Template not found: ${request.templateId}`)
      roles = template.roles
    } else if (request.customRoles) {
      roles = request.customRoles
    } else {
      // 默认使用开发团队模板
      roles = BUILTIN_TEMPLATES[0].roles
    }
    teamLog.debug(`Using ${roles.length} roles: ${roles.map(r => r.identifier).join(', ')}`)

    // 分配 Bridge 端口
    const bridgePort = this.bridgePort + (this.bridges.size % 100)

    // 创建团队 Bridge
    const bridge = new TeamBridge(bridgePort, this, this.sessionManager, this.teamRepo)
    bridge.start()
    this.bridges.set(teamId, bridge)

    // 创建团队实例
    const teamInstance: TeamInstance = {
      id: teamId,
      name: request.name,
      templateId: request.templateId,
      status: 'pending',
      workDir: request.workDir,
      sessionId,
      objective: request.objective,
      parentTeamId: request.parentTeamId,
      worktreeIsolation: request.worktreeIsolation || false,
      members: [],
      createdAt: new Date().toISOString(),
    }

    const createdWorktrees: Array<{ repoPath: string; worktreePath: string; branchName?: string }> = []
    try {
      this.teamRepo.createTeamInstance(teamInstance)

      // 为每个角色创建成员
      for (const role of roles) {
        const memberId = uuidv4()
        const memberSessionId = uuidv4()
        const memberWorkspace = await this.prepareMemberWorkspace(teamId, request.workDir, role, request.worktreeIsolation)
        if (memberWorkspace.worktreePath && memberWorkspace.worktreeSourceRepo) {
          createdWorktrees.push({
            repoPath: memberWorkspace.worktreeSourceRepo,
            worktreePath: memberWorkspace.worktreePath,
            branchName: memberWorkspace.worktreeBranch,
          })
        }

        const member: TeamMember = {
          id: memberId,
          instanceId: teamId,
          roleId: role.id,
          role,
          sessionId: memberSessionId,
          status: 'idle',
          providerId: request.providerId,
          workDir: memberWorkspace.workDir,
          worktreePath: memberWorkspace.worktreePath,
          worktreeBranch: memberWorkspace.worktreeBranch,
          worktreeSourceRepo: memberWorkspace.worktreeSourceRepo,
          worktreeBaseCommit: memberWorkspace.worktreeBaseCommit,
          worktreeBaseBranch: memberWorkspace.worktreeBaseBranch,
          joinedAt: new Date().toISOString(),
        }

        this.teamRepo.addTeamMember(member)
        teamInstance.members.push(member)
      }
    } catch (err) {
      for (const worktree of createdWorktrees.reverse()) {
        await this.gitService.removeWorktree(worktree.repoPath, worktree.worktreePath, {
          deleteBranch: true,
          branchName: worktree.branchName,
        }).catch(() => {})
      }
      this.teamRepo.deleteTeamInstance(teamId)
      throw err
    }

    teamLog.debug(`Team ${teamId} created, starting members...`)
    this.activeTeams.set(teamId, teamInstance)
    this.emit('team:created', teamInstance)

    // 启动团队
    await this.startTeam(teamId, request.objective, bridgePort)

    return teamInstance
  }

  /**
   * 启动团队（为每个成员启动 Agent）
   */
  private async startTeam(teamId: string, objective: string, bridgePort: number): Promise<void> {
    const team = this.activeTeams.get(teamId)
    if (!team) throw new Error(`Team not found: ${teamId}`)

    team.status = 'running'
    team.startedAt = new Date().toISOString()
    this.teamRepo.updateTeamStatus(teamId, 'running')
    this.emit('team:status-change', teamId, 'running')

    // 启动健康检查器
    const healthChecker = new TeamHealthChecker(
      this.database,
      this.sessionManager,
      this.agentManager,
      this.teamRepo
    )
    healthChecker.on('health-issue', (instanceId: string, issue: any) => {
      this.emit('team:health-issue', instanceId, issue)
    })
    healthChecker.on('member-failed', (instanceId: string, memberId: string) => {
      this.emit('team:member-status-change', instanceId, memberId, 'failed')
    })
    healthChecker.startMonitoring(teamId)
    this.healthCheckers.set(teamId, healthChecker)

    // 为每个成员启动 Agent 会话
    for (const member of team.members) {
      await this.startMember(member, objective, bridgePort)
    }

    this.emit('team:started', teamId)
  }

  /**
   * 启动单个成员 Agent
   */
  private async startMember(member: TeamMember, objective: string, bridgePort: number): Promise<void> {
    const { role } = member
    teamLog.debug(`Starting member ${member.id} (${role.identifier}), workDir: ${member.workDir}`)

    // 构建系统 Prompt（注入团队上下文）
    const systemPrompt = this.buildMemberSystemPrompt(role, objective, member, bridgePort)

    // 初始 Prompt：告知成员其角色和目标
    const initialPrompt = `团队目标：${objective}

你的角色是「${role.name}」${role.icon}。请等待团队负责人分配任务，或主动认领任务队列中的待办任务。

使用以下工具与团队沟通：
- team_message_role：向特定角色发送消息
- team_broadcast：向所有成员广播消息
- team_claim_task：认领待办任务
- team_complete_task：完成任务并汇报结果

连接信息已注入系统环境变量，详情请查看你的 MCP 工具文档。`

    try {
      teamLog.debug(`Creating session for member ${member.id} (${role.identifier})...`)
      // 通过 SessionManagerV2 创建成员会话
      const memberSessionId = this.sessionManager.createSession({
        id: member.sessionId,
        name: `TeamMember:${member.role.identifier}`,
        providerId: member.providerId,
        workingDirectory: member.workDir || this.activeTeams.get(member.instanceId)?.workDir || '',
        autoAccept: true,
        worktreePath: member.worktreePath,
        worktreeBranch: member.worktreeBranch,
        worktreeSourceRepo: member.worktreeSourceRepo,
        worktreeBaseCommit: member.worktreeBaseCommit,
        worktreeBaseBranch: member.worktreeBaseBranch,
        initialPrompt: `你是团队「${this.activeTeams.get(member.instanceId)?.name}」的成员，角色是「${role.name}」${role.icon}。\n\n你的系统提示词：\n${systemPrompt}`,
      })
      teamLog.debug(`Session created for member ${member.id} (${role.identifier}), sessionId: ${memberSessionId}`)

      member.status = 'running'
      this.teamRepo.updateMemberStatus(member.id, 'running')
      this.emit('team:member-joined', member.instanceId, member)
      teamLog.debug(`Member ${member.id} (${role.identifier}) status updated to running`)
    } catch (err) {
      console.error(`[TeamManager] Failed to start member ${member.id} (${role.identifier}):`, err)
      member.status = 'failed'
      this.teamRepo.updateMemberStatus(member.id, 'failed')
      throw err // 重新抛出，让 createTeam 的 catch 处理
    }
  }

  /**
   * 构建成员系统 Prompt
   */
  private buildMemberSystemPrompt(role: TeamRole, objective: string, member: TeamMember, bridgePort: number): string {
    const team = this.activeTeams.get(member.instanceId)
    if (!team) return role.systemPrompt

    const parentTeam = team.parentTeamId ? this.teamRepo.getTeamInstance(team.parentTeamId) : undefined
    const parentMessages = parentTeam
      ? this.teamRepo.getTeamMessages(parentTeam.id, 5)
      : []

    // 注入团队成员信息
    const memberList = team.members
      .map(m => `- ${m.role.icon} ${m.role.name}（${m.role.identifier}）${m.role.isLeader ? '👑 Leader' : ''}`)
      .join('\n')

    return `${role.systemPrompt}

## 团队信息
目标：${objective}

团队成员：
${memberList}

## 父团队上下文
${parentTeam ? `当前团队是父团队「${parentTeam.name}」(${parentTeam.id}) 的子团队。
父团队目标：${parentTeam.objective || '未设置'}
最近上下文：
${parentMessages.length > 0 ? parentMessages.map(msg => `- [${msg.type}] ${msg.content}`).join('\n') : '- 暂无父团队消息摘要'}
请在汇报时同步关键决策与进展，并保持与父团队目标一致。` : '当前团队为顶层团队。'}

## 团队通信工具
你可以使用以下 MCP 工具与团队沟通：
- team_message_role(role, message) - 向特定角色发送消息
- team_broadcast(message) - 向所有成员广播
- team_claim_task() - 认领任务
- team_complete_task(taskId, result) - 完成任务

## 连接信息
TeamBridge WebSocket 端口：${bridgePort}
实例 ID：${member.instanceId}
成员 ID：${member.id}
当前工作目录：${member.workDir || team.workDir}
请在连接到 TeamBridge 后发送 register 消息注册你的成员身份。`
  }

  private async prepareMemberWorkspace(
    teamId: string,
    baseWorkDir: string,
    role: TeamRole,
    worktreeIsolation?: boolean
  ): Promise<{
    workDir: string
    worktreePath?: string
    worktreeBranch?: string
    worktreeSourceRepo?: string
    worktreeBaseCommit?: string
    worktreeBaseBranch?: string
  }> {
    if (!worktreeIsolation || role.isLeader) {
      return { workDir: baseWorkDir }
    }

    const isGitRepo = await this.gitService.isGitRepo(baseWorkDir)
    if (!isGitRepo) {
      throw new Error('启用 Worktree 隔离时，团队工作目录必须位于 Git 仓库内')
    }

    const repoRoot = await this.gitService.getRepoRoot(baseWorkDir)
    const baseBranch = await this.gitService.getCurrentBranch(repoRoot)
    const baseCommit = await this.gitService.getHeadCommit(repoRoot)
    const relativeDir = path.relative(repoRoot, baseWorkDir)
    const taskId = `${teamId}-${role.identifier}`
    const branch = `team/${teamId}/${role.identifier}`
    const { worktreePath } = await this.gitService.createWorktree(repoRoot, branch, taskId)
    const resolvedWorkDir = relativeDir && relativeDir !== '.'
      ? path.join(worktreePath, relativeDir)
      : worktreePath

    return {
      workDir: resolvedWorkDir,
      worktreePath,
      worktreeBranch: branch,
      worktreeSourceRepo: repoRoot,
      worktreeBaseCommit: baseCommit,
      worktreeBaseBranch: baseBranch,
    }
  }

  /**
   * 向特定成员发送消息
   */
  async sendMessageToMember(instanceId: string, fromMemberId: string, toRole: string, content: string): Promise<boolean> {
    const bridge = this.bridges.get(instanceId)
    if (bridge) {
      const targetMember = this.teamRepo.getMemberByRole(instanceId, toRole)
      if (targetMember) {
        bridge.sendToMember(targetMember.id, `[来自成员 ${fromMemberId}] ${content}`)
        return true
      }
    }
    return false
  }

  /**
   * 广播消息
   */
  async broadcastMessage(instanceId: string, fromMemberId: string, content: string): Promise<void> {
    const bridge = this.bridges.get(instanceId)
    if (bridge) {
      bridge.broadcastToAll(content, fromMemberId)
    }
  }

  /**
   * 获取团队实例
   */
  getTeam(teamId: string): TeamInstance | undefined {
    return this.teamRepo.getTeamInstance(teamId)
  }

  /**
   * 获取所有团队
   */
  getAllTeams(status?: string): TeamInstance[] {
    return this.teamRepo.getAllTeamInstances(status)
  }

  /**
   * 获取团队任务
   */
  getTeamTasks(teamId: string, status?: string): TeamTask[] {
    return this.teamRepo.getTeamTasks(teamId, status)
  }

  /**
   * 获取团队消息
   */
  getTeamMessages(teamId: string, limit?: number): TeamMessage[] {
    return this.teamRepo.getTeamMessages(teamId, limit)
  }

  /**
   * 创建任务
   */
  createTask(teamId: string, task: Omit<TeamTask, 'id' | 'createdAt' | 'instanceId'>): TeamTask {
    const taskId = uuidv4()
    const newTask: TeamTask = {
      id: taskId,
      instanceId: teamId,
      ...task,
      createdAt: new Date().toISOString(),
    }
    const validation = this.teamRepo.validateTaskDependenciesForTasks([
      ...this.teamRepo.getTeamTasks(teamId),
      newTask,
    ])
    if (!validation.valid || validation.missingDependencies.length > 0) {
      throw new Error(
        validation.missingDependencies.length > 0
          ? `存在缺失依赖: ${validation.missingDependencies.join(', ')}`
          : `存在循环依赖: ${validation.cycles.map(c => c.join(' → ')).join('; ')}`
      )
    }
    this.teamRepo.createTask(newTask)
    return newTask
  }

  /**
   * 完成任务
   */
  completeTask(teamId: string, taskId: string, result: string): void {
    const task = this.teamRepo.getTask(taskId)
    this.teamRepo.completeTask(taskId, result)
    if (task?.claimedBy) {
      this.teamRepo.updateMemberTask(task.claimedBy, null)
      this.teamRepo.updateMemberStatus(task.claimedBy, 'idle')
      this.emit('team:member-status-change', teamId, task.claimedBy, 'idle')
    }
    this.emit('team:task-completed', teamId, taskId)

    // 检查团队是否完成
    this.checkTeamCompletion(teamId)
  }

  /**
   * 认领任务（带依赖验证）
   */
  claimTask(teamId: string, taskId: string, memberId: string): { success: boolean; task?: TeamTask; error?: string } {
    // 依赖检查
    const validation = this.validateTaskClaim(teamId, taskId)
    if (!validation.success) return { success: false, error: validation.error }

    const result = this.teamRepo.claimTask(taskId, memberId)
    if (result.success) {
      this.teamRepo.updateMemberTask(memberId, taskId)
      this.teamRepo.updateMemberStatus(memberId, 'running')
      this.emit('team:member-status-change', teamId, memberId, 'running')
      this.emit('team:task-claimed', teamId, taskId, memberId)
    }
    return result
  }

  /**
   * 验证任务是否可以认领（依赖是否满足）
   */
  validateTaskClaim(teamId: string, taskId: string): { success: boolean; error?: string } {
    const team = this.activeTeams.get(teamId) ?? this.teamRepo.getTeamInstance(teamId)
    if (!team) return { success: false, error: '团队不存在' }
    if (team.status !== 'running') {
      return { success: false, error: `团队当前状态为 ${team.status}，无法认领任务` }
    }

    const task = this.teamRepo.getTask(taskId)
    if (!task) return { success: false, error: '任务不存在' }
    if (task.status !== 'pending') return { success: false, error: `任务状态为 ${task.status}，无法认领` }

    // 检查所有依赖是否已完成
    for (const depId of task.dependencies) {
      const dep = this.teamRepo.getTask(depId)
      if (!dep) return { success: false, error: `依赖任务 "${depId}" 不存在` }
      if (dep.status !== 'completed' && dep.status !== 'cancelled' && dep.status !== 'failed') {
        return { success: false, error: `依赖任务 "${dep.title}" 尚未完成` }
      }
    }
    return { success: true }
  }

  /**
   * 记录团队消息并通知 UI。
   */
  recordMessage(teamId: string, message: TeamMessage): void {
    this.teamRepo.addMessage(message)
    this.emit('team:message', teamId, message)
  }

  // ---- DAG 查询 ----

  /**
   * 获取任务 DAG（拓扑排序 + 执行波次）
   */
  getTaskDAG(teamId: string): TaskDAGNode[] {
    return this.teamRepo.getTaskDAG(teamId)
  }

  /**
   * 验证任务依赖
   */
  validateTaskDependencies(teamId: string): DAGValidation {
    return this.teamRepo.validateTaskDependencies(teamId)
  }

  // ---- 任务编辑（阶段 3）----

  /**
   * 更新任务（仅 pending 状态可编辑）
   */
  updateTask(teamId: string, taskId: string, updates: Partial<Pick<TeamTask, 'title' | 'description' | 'priority' | 'dependencies'>>): TeamTask | null {
    const task = this.teamRepo.getTask(taskId)
    if (!task) return null
    if (task.status !== 'pending') {
      throw new Error('只能编辑 pending 状态的任务')
    }
    if (updates.dependencies !== undefined) {
      const nextTask: TeamTask = { ...task, ...updates }
      const validation = this.teamRepo.validateTaskDependenciesForTasks(
        this.teamRepo.getTeamTasks(teamId).map(item => item.id === taskId ? nextTask : item)
      )
      if (!validation.valid || validation.missingDependencies.length > 0) {
        if (validation.missingDependencies.length > 0) {
          throw new Error(`存在缺失依赖: ${validation.missingDependencies.join(', ')}`)
        }
        throw new Error(`存在循环依赖: ${validation.cycles.map(c => c.join(' → ')).join('; ')}`)
      }
    }

    this.teamRepo.updateTaskFull(taskId, updates)
    return this.teamRepo.getTask(taskId) ?? null
  }

  /**
   * 取消任务
   */
  cancelTask(teamId: string, taskId: string, reason?: string): void {
    const task = this.teamRepo.getTask(taskId)
    if (!task) return
    if (!['pending', 'in_progress'].includes(task.status)) {
      throw new Error('当前状态无法取消任务')
    }
    this.teamRepo.updateTaskFull(taskId, { status: 'cancelled', result: reason || '用户取消' })
    if (task.claimedBy) {
      this.teamRepo.updateMemberTask(task.claimedBy, null)
      this.teamRepo.updateMemberStatus(task.claimedBy, 'idle')
      this.emit('team:member-status-change', teamId, task.claimedBy, 'idle')
    }
    this.emit('team:task-cancelled', teamId, taskId)
  }

  /**
   * 转派任务
   */
  reassignTask(teamId: string, taskId: string, newMemberId: string): void {
    const task = this.teamRepo.getTask(taskId)
    if (!task) return
    const newMember = this.teamRepo.getMemberById(newMemberId)
    if (!newMember || newMember.instanceId !== teamId) {
      throw new Error('目标成员不存在')
    }
    if (task.claimedBy) {
      this.teamRepo.updateMemberTask(task.claimedBy, null)
      this.teamRepo.updateMemberStatus(task.claimedBy, 'idle')
      this.emit('team:member-status-change', teamId, task.claimedBy, 'idle')
    }
    this.teamRepo.updateTaskFull(taskId, { claimedBy: newMemberId, assignedTo: newMemberId })
    this.teamRepo.updateMemberTask(newMemberId, taskId)
    this.teamRepo.updateMemberStatus(newMemberId, 'running')
    this.emit('team:member-status-change', teamId, newMemberId, 'running')
  }

  // ---- 团队生命周期控制（阶段 2）----

  /**
   * 取消团队
   */
  cancelTeam(teamId: string, reason?: string): void {
    const team = this.activeTeams.get(teamId)
    if (!team) return

    // 取消所有进行中/待办任务
    const tasks = this.teamRepo.getTeamTasks(teamId)
    for (const task of tasks) {
      if (task.status === 'in_progress' || task.status === 'pending') {
        this.teamRepo.updateTaskFull(task.id, { status: 'cancelled', result: '团队被取消' })
        if (task.claimedBy) {
          this.teamRepo.updateMemberTask(task.claimedBy, null)
        }
      }
    }

    // 标记团队为已取消
    team.status = 'cancelled'
    this.teamRepo.updateTeamStatus(teamId, 'cancelled')
    this.emit('team:status-change', teamId, 'cancelled')

    // 终止所有成员会话
    for (const member of team.members) {
      try {
        this.sessionManager.terminateSession(member.sessionId).catch(() => {})
        this.teamRepo.updateMemberStatus(member.id, 'failed')
      } catch { /* ignore */ }
    }

    this.cleanupTeam(teamId)
    this.emit('team:cancelled', teamId, reason || '用户取消')
  }

  /**
   * 暂停团队
   */
  pauseTeam(teamId: string): void {
    const team = this.activeTeams.get(teamId)
    if (!team) return
    if (team.status !== 'running') return
    team.status = 'paused'
    this.teamRepo.updateTeamStatus(teamId, 'paused')
    this.emit('team:status-change', teamId, 'paused')
    const bridge = this.bridges.get(teamId)
    if (bridge) {
      bridge.broadcastToAll('[系统] 团队已被暂停，等待用户恢复。', 'system')
    }
    this.emit('team:paused', teamId)
  }

  /**
   * 恢复团队
   */
  resumeTeam(teamId: string): void {
    const team = this.activeTeams.get(teamId)
    if (!team || team.status !== 'paused') return
    team.status = 'running'
    this.teamRepo.updateTeamStatus(teamId, 'running')
    this.emit('team:status-change', teamId, 'running')
    const bridge = this.bridges.get(teamId)
    if (bridge) {
      bridge.broadcastToAll('[系统] 团队已恢复，请继续执行待办任务。', 'system')
    }
    this.emit('team:resumed', teamId)
  }

  /**
   * 更新团队信息
   */
  updateTeam(teamId: string, updates: { name?: string; objective?: string }): void {
    if (updates.name) {
      this.teamRepo.updateTeamName(teamId, updates.name)
      const team = this.activeTeams.get(teamId)
      if (team) team.name = updates.name
    }
    if (updates.objective) {
      this.teamRepo.updateTeamObjective(teamId, updates.objective)
      const team = this.activeTeams.get(teamId)
      if (team) team.objective = updates.objective
    }
    this.emit('team:updated', teamId, updates)
  }

  // ---- 模板 CRUD（阶段 4）----

  /**
   * 创建自定义模板
   */
  createTemplate(request: Omit<TeamTemplate, 'id' | 'createdAt'> & { id: string }): TeamTemplate {
    const template: TeamTemplate = {
      ...request,
      createdAt: new Date().toISOString(),
    }
    this.teamRepo.createTemplate(template)
    return template
  }

  /**
   * 更新模板
   */
  updateTemplate(templateId: string, updates: Partial<Pick<TeamTemplate, 'name' | 'description' | 'roles'>>): TeamTemplate | null {
    if (templateId.startsWith('dev-') || templateId === 'dev-team') {
      throw new Error('内置模板不可修改')
    }
    this.teamRepo.updateTemplate(templateId, updates)
    return this.teamRepo.getTemplate(templateId) ?? null
  }

  /**
   * 删除模板
   */
  deleteTemplate(templateId: string): boolean {
    if (templateId.startsWith('dev-') || templateId === 'dev-team') {
      throw new Error('内置模板不可删除')
    }
    this.teamRepo.deleteTemplate(templateId)
    return true
  }

  /**
   * 获取完整模板列表（内置 + 自定义）
   */
  getFullTemplates(): TeamTemplate[] {
    return [...this.getBuiltinTemplates(), ...this.teamRepo.getTemplates()]
  }

  // ---- UI 直接发消息（阶段 5）----

  /**
   * 从 UI 向特定成员发送消息
   */
  sendUIMessage(teamId: string, toMemberId: string, content: string): TeamMessage {
    const message: TeamMessage = {
      id: uuidv4(),
      instanceId: teamId,
      from: 'ui-user',
      to: toMemberId,
      type: 'role_message',
      content,
      timestamp: new Date().toISOString(),
    }
    this.recordMessage(teamId, message)

    // 通过 Bridge 转发给成员
    const bridge = this.bridges.get(teamId)
    if (bridge) {
      bridge.sendToMember(toMemberId, `[团队协调员]: ${content}`)
    }

    // 直接注入到会话上下文（兜底）
    const member = this.teamRepo.getMemberById(toMemberId)
    if (member) {
      this.sessionManager.sendMessage(member.sessionId, `[团队协调员]: ${content}`).catch(() => {})
    }

    return message
  }

  /**
   * 从 UI 向所有成员广播
   */
  broadcastFromUI(teamId: string, content: string): TeamMessage {
    const message: TeamMessage = {
      id: uuidv4(),
      instanceId: teamId,
      from: 'ui-user',
      type: 'broadcast',
      content,
      timestamp: new Date().toISOString(),
    }
    this.recordMessage(teamId, message)

    const bridge = this.bridges.get(teamId)
    if (bridge) {
      bridge.broadcastToAll(`[团队协调员广播]: ${content}`, 'ui-user')
    }

    return message
  }

  // ---- 导出（阶段 7）----

  /**
   * 导出团队快照
   */
  exportTeam(teamId: string): TeamSnapshot {
    const team = this.teamRepo.getTeamInstance(teamId)
    if (!team) throw new Error('团队不存在')
    const tasks = this.teamRepo.getTeamTasks(teamId)
    const messages = this.teamRepo.getTeamMessages(teamId, 500)
    const memberById = new Map(team.members.map(m => [m.id, m]))
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      team: {
        id: team.id,
        name: team.name,
        objective: team.objective,
        status: team.status,
        workDir: team.workDir,
        parentTeamId: team.parentTeamId,
        worktreeIsolation: team.worktreeIsolation,
      },
      members: team.members.map(m => ({ id: m.id, roleId: m.roleId, role: m.role, status: m.status })),
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dependencies: t.dependencies,
        assignedRoleId: t.assignedTo ? memberById.get(t.assignedTo)?.roleId : undefined,
        claimedRoleId: t.claimedBy ? memberById.get(t.claimedBy)?.roleId : undefined,
        result: t.result,
      })),
      messages: messages.map(m => ({
        from: m.from,
        fromRoleId: memberById.get(m.from)?.roleId,
        to: m.to,
        toRoleId: m.to ? memberById.get(m.to)?.roleId : undefined,
        type: m.type,
        content: m.content,
        timestamp: m.timestamp,
      })),
    }
  }

  async importTeam(snapshot: TeamSnapshot): Promise<TeamInstance> {
    const customRoles = snapshot.members.map(member => member.role)
    const parentTeam = snapshot.team.parentTeamId ? this.teamRepo.getTeamInstance(snapshot.team.parentTeamId) : undefined
    const providerId = parentTeam?.members?.[0]?.providerId || 'claude-code'
    const team = await this.createTeam({
      name: `${snapshot.team.name} (Imported)`,
      objective: snapshot.team.objective,
      workDir: snapshot.team.workDir || parentTeam?.workDir || process.cwd(),
      customRoles,
      providerId,
      worktreeIsolation: snapshot.team.worktreeIsolation,
      parentTeamId: snapshot.team.parentTeamId,
    })

    const imported = this.teamRepo.getTeamInstance(team.id)
    if (!imported) return team

    const roleToMemberId = new Map(imported.members.map(member => [member.roleId, member.id]))
    const taskIdMap = new Map<string, string>()

    for (const task of snapshot.tasks) {
      const created = this.createTask(team.id, {
        title: task.title,
        description: task.description,
        status: 'pending',
        priority: task.priority,
        dependencies: [],
        assignedTo: task.assignedRoleId ? roleToMemberId.get(task.assignedRoleId) : undefined,
      })
      taskIdMap.set(task.id, created.id)
    }

    for (const task of snapshot.tasks) {
      const newTaskId = taskIdMap.get(task.id)
      if (!newTaskId) continue
      const mappedDependencies = task.dependencies.map(depId => taskIdMap.get(depId)).filter(Boolean) as string[]
      const claimedBy = task.claimedRoleId ? roleToMemberId.get(task.claimedRoleId) : undefined
      this.teamRepo.updateTaskFull(newTaskId, {
        dependencies: mappedDependencies,
        status: task.status,
        assignedTo: task.assignedRoleId ? roleToMemberId.get(task.assignedRoleId) : undefined,
        claimedBy,
        result: task.result,
      })
      if (claimedBy) {
        this.teamRepo.updateMemberTask(claimedBy, newTaskId)
      }
    }

    for (const message of snapshot.messages) {
      const from = message.fromRoleId ? roleToMemberId.get(message.fromRoleId) || message.from : message.from
      const to = message.toRoleId ? roleToMemberId.get(message.toRoleId) || message.to : message.to
      this.teamRepo.addMessage({
        id: uuidv4(),
        instanceId: team.id,
        from,
        to,
        type: message.type,
        content: message.content,
        timestamp: message.timestamp,
      })
    }

    if (snapshot.team.status === 'paused') {
      this.pauseTeam(team.id)
    } else if (['completed', 'failed', 'cancelled'].includes(snapshot.team.status)) {
      imported.status = snapshot.team.status
      this.teamRepo.updateTeamStatus(team.id, snapshot.team.status)
      this.emit('team:status-change', team.id, snapshot.team.status)
      this.activeTeams.delete(team.id)
    }

    return this.teamRepo.getTeamInstance(team.id) || team
  }

  getChildTeams(parentTeamId: string): TeamInstance[] {
    return this.getAllTeams().filter(team => team.parentTeamId === parentTeamId)
  }

  async mergeTeamWorktrees(
    teamId: string,
    options?: { cleanup?: boolean; targetBranch?: string; squash?: boolean }
  ): Promise<TeamWorktreeMergeResult[]> {
    const team = this.teamRepo.getTeamInstance(teamId)
    if (!team) throw new Error('团队不存在')

    const results: TeamWorktreeMergeResult[] = []
    for (const member of team.members) {
      if (!member.worktreeSourceRepo || !member.worktreeBranch) {
        results.push({
          memberId: member.id,
          roleId: member.roleId,
          branch: member.worktreeBranch || '',
          repoPath: member.worktreeSourceRepo || '',
          merged: false,
          skipped: true,
          reason: '成员未启用 worktree',
        })
        continue
      }

      try {
        if (!member.worktreePath) {
          results.push({
            memberId: member.id,
            roleId: member.roleId,
            branch: member.worktreeBranch,
            repoPath: member.worktreeSourceRepo,
            merged: false,
            skipped: true,
            reason: '缺少 worktree 路径',
          })
          continue
        }

        const mergeCheck = await this.gitService.checkMerge(
          member.worktreeSourceRepo,
          member.worktreePath,
          options?.targetBranch || member.worktreeBaseBranch
        )
        if (!mergeCheck.canMerge) {
          results.push({
            memberId: member.id,
            roleId: member.roleId,
            branch: member.worktreeBranch,
            repoPath: member.worktreeSourceRepo,
            merged: false,
            skipped: true,
            reason: `存在冲突文件: ${mergeCheck.conflictingFiles.join(', ')}`,
          })
          continue
        }

        const mergeResult = await this.gitService.mergeToMain(member.worktreeSourceRepo, member.worktreeBranch, {
          cleanup: false,
          squash: options?.squash ?? true,
          targetBranch: options?.targetBranch || member.worktreeBaseBranch,
          message: `Merge team ${team.name} member ${member.role.name}`,
        })

        if (options?.cleanup && member.worktreePath) {
          await this.gitService.removeWorktree(member.worktreeSourceRepo, member.worktreePath, {
            deleteBranch: true,
            branchName: member.worktreeBranch,
          })
        }

        results.push({
          memberId: member.id,
          roleId: member.roleId,
          branch: member.worktreeBranch,
          repoPath: member.worktreeSourceRepo,
          merged: true,
          cleanup: options?.cleanup,
          mainBranch: mergeResult.mainBranch,
          linesAdded: mergeResult.linesAdded,
          linesRemoved: mergeResult.linesRemoved,
        })
      } catch (err) {
        results.push({
          memberId: member.id,
          roleId: member.roleId,
          branch: member.worktreeBranch,
          repoPath: member.worktreeSourceRepo,
          merged: false,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return results
  }

  /**
   * 检查团队是否完成
   */
  private checkTeamCompletion(teamId: string): void {
    const tasks = this.teamRepo.getTeamTasks(teamId)
    const allCompleted = tasks.length > 0 && tasks.every(t => t.status === 'completed')

    if (allCompleted) {
      this.teamRepo.updateTeamStatus(teamId, 'completed')
      this.emit('team:status-change', teamId, 'completed')
      this.emit('team:completed', teamId)

      // 停止健康检查
      const healthChecker = this.healthCheckers.get(teamId)
      if (healthChecker) {
        healthChecker.stopMonitoring(teamId)
        this.healthCheckers.delete(teamId)
      }

      // 关闭 Bridge
      const bridge = this.bridges.get(teamId)
      if (bridge) {
        bridge.stop()
        this.bridges.delete(teamId)
      }
    }
  }

  /**
   * 获取团队健康状态
   */
  async getHealthStatus(teamId: string) {
    const healthChecker = this.healthCheckers.get(teamId)
    if (healthChecker) {
      return healthChecker.getHealthStatus(teamId)
    }
    return null
  }

  /**
   * 获取团队模板列表
   */
  getTemplates() {
    return this.teamRepo.getTemplates()
  }

  /**
   * 获取内置模板
   */
  getBuiltinTemplates(): TeamTemplate[] {
    return BUILTIN_TEMPLATES
  }

  private resolveTemplate(templateId: string): TeamTemplate | undefined {
    return BUILTIN_TEMPLATES.find(template => template.id === templateId)
      ?? this.teamRepo.getTemplate(templateId)
  }

  /**
   * 清理团队资源
   */
  cleanupTeam(teamId: string): void {
    // 停止健康检查
    const healthChecker = this.healthCheckers.get(teamId)
    if (healthChecker) {
      healthChecker.stopMonitoring(teamId)
      this.healthCheckers.delete(teamId)
    }

    // 关闭 Bridge
    const bridge = this.bridges.get(teamId)
    if (bridge) {
      bridge.stop()
      this.bridges.delete(teamId)
    }

    // 终止所有成员会话
    const team = this.activeTeams.get(teamId)
    if (!team) return

    for (const member of team.members) {
      void this.sessionManager.terminateSession(member.sessionId).catch(() => {})
      if (member.worktreePath && member.worktreeSourceRepo) {
        void this.gitService.removeWorktree(
          member.worktreeSourceRepo,
          member.worktreePath,
          { deleteBranch: true, branchName: member.worktreeBranch }
        ).catch(err => {
          teamLog.warn('cleanup worktree failed', { teamId, memberId: member.id, error: String(err) })
        })
      }
    }

    this.activeTeams.delete(teamId)
  }

  /**
   * 清理所有团队
   */
  cleanup(): void {
    for (const [instanceId, healthChecker] of this.healthCheckers) {
      healthChecker.stopMonitoring(instanceId)
    }
    this.healthCheckers.clear()

    for (const [instanceId, bridge] of this.bridges) {
      bridge.stop()
    }
    this.bridges.clear()

    for (const teamId of this.activeTeams.keys()) {
      this.cleanupTeam(teamId)
    }
  }
}
