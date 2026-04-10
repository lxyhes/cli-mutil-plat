/**
 * 会话状态转换验证器
 * 确保状态机的完整性和一致性
 * @author weibin
 */

import type { SessionStatus } from '../../shared/types'

/**
 * 有效的状态转换映射表
 * 每个状态只能转换到特定的目标状态
 */
const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  'starting': ['running', 'idle', 'error', 'terminated'],
  'running': ['idle', 'waiting_input', 'paused', 'completed', 'error', 'terminated'],
  'idle': ['running', 'paused', 'completed', 'terminated', 'error'],
  'waiting_input': ['running', 'idle', 'paused', 'completed', 'error', 'terminated'],
  'paused': ['running', 'idle', 'terminated', 'error'],
  'completed': ['terminated'], // 完成后只能被终止（清理资源）
  'error': ['terminated'], // 错误后只能被终止
  'terminated': [], // 终态，不可转换
  'interrupted': ['running', 'terminated'], // 中断后可恢复或终止
}

/**
 * 终态集合（不可再转换的状态）
 */
const FINAL_STATES: Set<SessionStatus> = new Set(['completed', 'error', 'terminated'])

/**
 * 活跃状态集合（会话正在运行或等待输入）
 */
const ACTIVE_STATES: Set<SessionStatus> = new Set(['starting', 'running', 'idle', 'waiting_input', 'paused'])

/**
 * 验证状态转换是否合法
 * @param sessionId 会话 ID（用于日志）
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否允许转换
 */
export function validateStateTransition(
  sessionId: string,
  from: SessionStatus,
  to: SessionStatus
): boolean {
  // 相同状态转换总是允许（幂等）
  if (from === to) {
    return true
  }

  const allowedTargets = VALID_TRANSITIONS[from]
  if (!allowedTargets) {
    console.error(
      `[StateValidator] Unknown source state "${from}" for session ${sessionId}`
    )
    return false
  }

  if (!allowedTargets.includes(to)) {
    console.warn(
      `[StateValidator] Invalid state transition for session ${sessionId}: ${from} -> ${to}. ` +
      `Allowed transitions from ${from}: ${allowedTargets.join(', ')}`
    )
    return false
  }

  return true
}

/**
 * 检查状态是否为终态
 */
export function isFinalState(status: SessionStatus): boolean {
  return FINAL_STATES.has(status)
}

/**
 * 检查状态是否为活跃状态
 */
export function isActiveState(status: SessionStatus): boolean {
  return ACTIVE_STATES.has(status)
}

/**
 * 获取状态的下一个可能状态列表
 */
export function getNextStates(status: SessionStatus): SessionStatus[] {
  return VALID_TRANSITIONS[status] || []
}

/**
 * 状态转换历史记录（用于调试）
 */
export interface StateTransitionRecord {
  sessionId: string
  from: SessionStatus
  to: SessionStatus
  timestamp: string
  valid: boolean
  reason?: string
}

/**
 * 状态转换历史记录器
 */
export class StateTransitionLogger {
  private history: StateTransitionRecord[] = []
  private maxRecords = 1000

  log(record: StateTransitionRecord): void {
    this.history.push(record)

    // 保持历史记录在限制内
    if (this.history.length > this.maxRecords) {
      this.history.shift()
    }

    // 记录无效转换到控制台
    if (!record.valid) {
      console.warn(
        `[StateTransitionLogger] Invalid transition: ${record.sessionId} ` +
        `${record.from} -> ${record.to}` +
        (record.reason ? ` (${record.reason})` : '')
      )
    }
  }

  getHistory(sessionId?: string): StateTransitionRecord[] {
    if (sessionId) {
      return this.history.filter(r => r.sessionId === sessionId)
    }
    return [...this.history]
  }

  getInvalidTransitions(sessionId?: string): StateTransitionRecord[] {
    return this.getHistory(sessionId).filter(r => !r.valid)
  }

  clear(): void {
    this.history = []
  }
}
