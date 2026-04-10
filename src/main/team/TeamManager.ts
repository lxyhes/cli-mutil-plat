/**
 * Agent Teams - 团队管理器
 *
 * 团队实例生命周期协调器
 * 负责创建团队、启动成员 Agent、监控进度、宣告完成
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
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
} from './types'
import type { TeamRepository } from './TeamRepository'
import type { AgentManagerV2 } from '../agent/AgentManagerV2'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { DatabaseManager } from '../storage/Database'
import { TeamHealthChecker } from './TeamHealthChecker'
import { TeamMessageDelivery } from './TeamMessageDelivery'
import { TeamBridge } from './TeamBridge'

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
  'team:member-joined': [teamId: string, member: TeamMember]
  'team:member-status-change': [teamId: string, memberId: string, status: string]
  'team:task-claimed': [teamId: string, taskId: string, memberId: string]
  'team:task-completed': [teamId: string, taskId: string]
  'team:message': [teamId: string, message: TeamMessage]
  'team:completed': [teamId: string]
  'team:failed': [teamId: string, reason: string]
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
    private database: DatabaseManager
  ) {
    super()
  }

  /**
   * 创建并启动团队
   */
  async createTeam(request: CreateTeamRequest): Promise<TeamInstance> {
    teamDebug(`createTeam called: name="${request.name}", templateId="${request.templateId}", workDir="${request.workDir}"`)
    const teamId = uuidv4()
    const sessionId = uuidv4()

    // 获取角色列表（从模板或自定义）
    let roles: TeamRole[]
    if (request.templateId) {
      const template = this.teamRepo.getTemplate(request.templateId)
      if (!template) throw new Error(`Template not found: ${request.templateId}`)
      roles = template.roles
    } else if (request.customRoles) {
      roles = request.customRoles
    } else {
      // 默认使用开发团队模板
      roles = BUILTIN_TEMPLATES[0].roles
    }
    teamDebug(`Using ${roles.length} roles: ${roles.map(r => r.identifier).join(', ')}`)

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
      members: [],
      createdAt: new Date().toISOString(),
    }

    this.teamRepo.createTeamInstance(teamInstance)

    // 为每个角色创建成员
    for (const role of roles) {
      const memberId = uuidv4()
      const memberSessionId = uuidv4()

      const member: TeamMember = {
        id: memberId,
        instanceId: teamId,
        roleId: role.id,
        role,
        sessionId: memberSessionId,
        status: 'idle',
        providerId: request.providerId,
        joinedAt: new Date().toISOString(),
      }

      this.teamRepo.addTeamMember(member)
      teamInstance.members.push(member)
    }

    teamDebug(`Team ${teamId} created, starting members...`)
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
      // 通过 SessionManagerV2 创建成员会话
      const memberSessionId = this.sessionManager.createSession({
        id: member.sessionId,
        name: `TeamMember:${member.role.identifier}`,
        providerId: member.providerId,
        workingDirectory: this.activeTeams.get(member.instanceId)?.workDir || '',
        autoAccept: true,
        initialPrompt: `你是团队「${this.activeTeams.get(member.instanceId)?.name}」的成员，角色是「${role.name}」${role.icon}。\n\n你的系统提示词：\n${systemPrompt}`,
      })

      member.status = 'running'
      this.teamRepo.updateMemberStatus(member.id, 'running')
      this.emit('team:member-joined', member.instanceId, member)
    } catch (err) {
      console.error(`[TeamManager] Failed to start member ${member.id}:`, err)
      member.status = 'failed'
      this.teamRepo.updateMemberStatus(member.id, 'failed')
    }
  }

  /**
   * 构建成员系统 Prompt
   */
  private buildMemberSystemPrompt(role: TeamRole, objective: string, member: TeamMember, bridgePort: number): string {
    const team = this.activeTeams.get(member.instanceId)
    if (!team) return role.systemPrompt

    // 注入团队成员信息
    const memberList = team.members
      .map(m => `- ${m.role.icon} ${m.role.name}（${m.role.identifier}）${m.role.isLeader ? '👑 Leader' : ''}`)
      .join('\n')

    return `${role.systemPrompt}

## 团队信息
目标：${objective}

团队成员：
${memberList}

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
请在连接到 TeamBridge 后发送 register 消息注册你的成员身份。`
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
    this.teamRepo.createTask(newTask)
    return newTask
  }

  /**
   * 完成任务
   */
  completeTask(teamId: string, taskId: string, result: string): void {
    this.teamRepo.completeTask(taskId, result)
    this.emit('team:task-completed', teamId, taskId)

    // 检查团队是否完成
    this.checkTeamCompletion(teamId)
  }

  /**
   * 认领任务
   */
  claimTask(teamId: string, taskId: string, memberId: string): { success: boolean; task?: TeamTask; error?: string } {
    const result = this.teamRepo.claimTask(taskId, memberId)
    if (result.success) {
      this.teamRepo.updateMemberTask(memberId, taskId)
      this.emit('team:task-claimed', teamId, taskId, memberId)
    }
    return result
  }

  /**
   * 检查团队是否完成
   */
  private checkTeamCompletion(teamId: string): void {
    const tasks = this.teamRepo.getTeamTasks(teamId)
    const allCompleted = tasks.length > 0 && tasks.every(t => t.status === 'completed')

    if (allCompleted) {
      this.teamRepo.updateTeamStatus(teamId, 'completed')
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
      try {
        this.sessionManager.terminateSession(member.sessionId)
      } catch {
        // ignore
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
