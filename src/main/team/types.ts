/**
 * Agent Teams - 类型定义
 *
 * 主进程直接复用 shared 层的团队类型，避免主/渲染进程类型漂移。
 *
 * @author weibin
 */

export type {
  TeamStatus,
  MemberStatus,
  TeamTaskStatus,
  MessageType,
  TeamRole,
  TeamInstance,
  TeamMember,
  TeamTask,
  TeamMessage,
  TeamTemplate,
  CreateTeamRequest,
  TaskClaimResult,
  TaskDAGNode,
  DAGValidation,
  TeamSnapshot,
  TeamWorktreeMergeResult,
} from '../../shared/types'
