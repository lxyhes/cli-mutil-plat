/**
 * Team 消息重试机制
 * 确保团队成员间的消息可靠传递
 * @author weibin
 */

import type { AgentManagerV2 } from '../agent/AgentManagerV2'
import type { DatabaseManager } from '../storage/Database'

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
  private database: DatabaseManager
  private config: RetryConfig

  constructor(
    agentManager: AgentManagerV2,
    database: DatabaseManager,
    config: Partial<RetryConfig> = {}
  ) {
    this.agentManager = agentManager
    this.database = database
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config }
  }

  /**
   * 发送消息（带重试）
   */
  async sendMessage(
    instanceId: string,
    from: string,
    to: string,
    content: string
  ): Promise<MessageDeliveryResult> {
    let lastError: Error | undefined
    let delay = this.config.initialDelayMs

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        // 查找目标成员
        const member = await this.database.team.getMemberByRole(instanceId, to)
        if (!member) {
          throw new Error(`Member with role ${to} not found in instance ${instanceId}`)
        }

        // 检查成员会话是否存活
        const session = this.agentManager.getSession?.(member.sessionId)
        if (!session) {
          throw new Error(`Session ${member.sessionId} for member ${to} not found`)
        }

        if (session.status === 'error' || session.status === 'terminated') {
          throw new Error(`Session ${member.sessionId} for member ${to} is ${session.status}`)
        }

        // 发送消息到 Agent
        await this.agentManager.sendToAgent(member.sessionId, content)

        // 记录消息到数据库
        await this.database.team.addMessage({
          instanceId,
          from,
          to,
          content,
          timestamp: new Date().toISOString()
        })

        console.log(
          `[TeamMessageDelivery] Message delivered from ${from} to ${to} (attempt ${attempt})`
        )

        return {
          success: true,
          attempts: attempt,
          deliveredAt: new Date().toISOString()
        }
      } catch (error) {
        lastError = error as Error
        console.error(
          `[TeamMessageDelivery] Attempt ${attempt}/${this.config.maxRetries} failed:`,
          error
        )

        // 如果还有重试机会，等待后重试
        if (attempt < this.config.maxRetries) {
          await this.sleep(delay)
          delay = Math.min(delay * this.config.backoffMultiplier, this.config.maxDelayMs)
        }
      }
    }

    // 所有重试都失败
    console.error(
      `[TeamMessageDelivery] Failed to deliver message from ${from} to ${to} after ${this.config.maxRetries} attempts`
    )

    return {
      success: false,
      attempts: this.config.maxRetries,
      error: lastError?.message || 'Unknown error'
    }
  }

  /**
   * 广播消息（带重试）
   */
  async broadcastMessage(
    instanceId: string,
    from: string,
    content: string
  ): Promise<Map<string, MessageDeliveryResult>> {
    const members = await this.database.team.getMembers(instanceId)
    const results = new Map<string, MessageDeliveryResult>()

    // 并行发送到所有成员
    const promises = members
      .filter(m => m.roleId !== from) // 不发送给自己
      .map(async member => {
        const result = await this.sendMessage(instanceId, from, member.roleId, content)
        results.set(member.roleId, result)
      })

    await Promise.all(promises)

    const successCount = Array.from(results.values()).filter(r => r.success).length
    console.log(
      `[TeamMessageDelivery] Broadcast from ${from}: ${successCount}/${results.size} delivered`
    )

    return results
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
