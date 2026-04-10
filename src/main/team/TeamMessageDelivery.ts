/**
 * Team 消息传递器（带重试机制）
 * 确保团队成员间的消息可靠传递
 * @author weibin
 */

import type { AgentManagerV2 } from '../agent/AgentManagerV2'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { TeamRepository } from './TeamRepository'
import type { TeamMessage, TeamMember } from './types'

export interface MessageDeliveryResult {
  success: boolean
  attempts: number
  error?: string
  deliveredAt?: string
}

export interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
}

/**
 * Team 消息传递器（带重试）
 */
export class TeamMessageDelivery {
  private agentManager: AgentManagerV2
  private sessionManager: SessionManagerV2
  private teamRepo: TeamRepository
  private config: RetryConfig

  constructor(
    agentManager: AgentManagerV2,
    sessionManager: SessionManagerV2,
    teamRepo: TeamRepository,
    config: Partial<RetryConfig> = {}
  ) {
    this.agentManager = agentManager
    this.sessionManager = sessionManager
    this.teamRepo = teamRepo
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config }
  }

  /**
   * 发送消息（带重试）
   */
  async sendMessage(
    instanceId: string,
    fromMemberId: string,
    toRole: string,
    content: string
  ): Promise<MessageDeliveryResult> {
    let lastError: Error | undefined
    let delay = this.config.initialDelayMs

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        // 查找目标成员
        const member = this.teamRepo.getMemberByRole(instanceId, toRole)
        if (!member) {
          throw new Error(`Member with role ${toRole} not found in instance ${instanceId}`)
        }

        // 检查成员会话是否存活
        const session = this.sessionManager.getSession(member.sessionId)
        if (!session) {
          throw new Error(`Session ${member.sessionId} for member ${toRole} not found`)
        }

        // 通过 SessionManagerV2 发送消息
        await this.sessionManager.sendMessage(member.sessionId, content)

        return {
          success: true,
          attempts: attempt,
          deliveredAt: new Date().toISOString()
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < this.config.maxRetries) {
          await this.sleep(delay)
          delay = Math.min(delay * this.config.backoffMultiplier, this.config.maxDelayMs)
        }
      }
    }

    return {
      success: false,
      attempts: this.config.maxRetries,
      error: lastError?.message
    }
  }

  /**
   * 广播消息给所有团队成员
   */
  async broadcastMessage(
    instanceId: string,
    fromMemberId: string,
    content: string
  ): Promise<void> {
    const members = this.teamRepo.getTeamMembers(instanceId)
    await Promise.all(
      members
        .filter((m: TeamMember) => m.id !== fromMemberId)
        .map((m: TeamMember) => this.sendMessage(instanceId, fromMemberId, m.role.identifier, content))
    )
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
