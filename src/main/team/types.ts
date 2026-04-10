/**
 * Agent Teams - 类型定义
 * 
 * 团队、角色、成员、任务、消息的完整类型定义
 * 
 * @author weibin
 */

/** 团队状态 */
export type TeamStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/** 成员状态 */
export type MemberStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'failed'

/** 任务状态 */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

/** 消息类型 */
export type MessageType = 'role_message' | 'broadcast' | 'system' | 'task_update'

/** 角色定义 */
export interface TeamRole {
  /** 角色 ID */
  id: string
  /** 角色名称（如 "团队负责人"） */
  name: string
  /** 角色标识符（如 "leader"） */
  identifier: string
  /** 角色图标/emoji */
  icon: string
  /** 角色颜色 */
  color: string
  /** 角色描述 */
  description: string
  /** 系统 Prompt 模板 */
  systemPrompt: string
  /** 是否 Leader 角色（唯一可宣告团队完成） */
  isLeader: boolean
}

/** 团队实例 */
export interface TeamInstance {
  /** 团队 ID */
  id: string
  /** 团队名称 */
  name: string
  /** 团队模板 ID */
  templateId?: string
  /** 团队状态 */
  status: TeamStatus
  /** 工作目录 */
  workDir: string
  /** 关联的主会话 ID */
  sessionId: string
  /** 团队成员列表 */
  members: TeamMember[]
  /** 创建时间 */
  createdAt: string
  /** 开始时间 */
  startedAt?: string
  /** 完成时间 */
  completedAt?: string
  /** 总体目标 */
  objective: string
}

/** 团队成员 */
export interface TeamMember {
  /** 成员 ID */
  id: string
  /** 所属团队实例 ID */
  instanceId: string
  /** 角色 ID */
  roleId: string
  /** 角色信息 */
  role: TeamRole
  /** Agent 会话 ID */
  sessionId: string
  /** 成员状态 */
  status: MemberStatus
  /** 使用的 Provider */
  providerId: string
  /** 当前任务 ID */
  currentTaskId?: string
  /** 加入时间 */
  joinedAt: string
  /** 最后活跃时间 */
  lastActiveAt?: string
}

/** 团队任务 */
export interface TeamTask {
  /** 任务 ID */
  id: string
  /** 所属团队实例 ID */
  instanceId: string
  /** 任务标题 */
  title: string
  /** 任务描述 */
  description: string
  /** 任务状态 */
  status: TeamTaskStatus
  /** 负责成员 ID */
  assignedTo?: string
  /** 认领成员 ID */
  claimedBy?: string
  /** 认领时间 */
  claimedAt?: string
  /** 任务优先级 */
  priority: 'low' | 'medium' | 'high' | 'critical'
  /** 依赖的任务 ID 列表 */
  dependencies: string[]
  /** 创建时间 */
  createdAt: string
  /** 完成时间 */
  completedAt?: string
  /** 任务结果 */
  result?: string
}

/** 团队消息 */
export interface TeamMessage {
  /** 消息 ID */
  id: string
  /** 所属团队实例 ID */
  instanceId: string
  /** 发送者成员 ID */
  from: string
  /** 接收者成员 ID（空表示广播） */
  to?: string
  /** 消息类型 */
  type: MessageType
  /** 消息内容 */
  content: string
  /** 发送时间 */
  timestamp: string
}

/** 团队模板 */
export interface TeamTemplate {
  /** 模板 ID */
  id: string
  /** 模板名称 */
  name: string
  /** 模板描述 */
  description: string
  /** 角色列表 */
  roles: TeamRole[]
  /** 创建时间 */
  createdAt: string
}

/** 创建团队请求 */
export interface CreateTeamRequest {
  /** 团队名称 */
  name: string
  /** 总体目标 */
  objective: string
  /** 工作目录 */
  workDir: string
  /** 使用的模板 ID 或自定义角色 */
  templateId?: string
  customRoles?: TeamRole[]
  /** 默认 Provider */
  providerId: string
}

/** 任务认领结果（原子操作） */
export interface TaskClaimResult {
  /** 是否成功认领 */
  success: boolean
  /** 任务（如果成功） */
  task?: TeamTask
  /** 失败原因 */
  error?: string
}
