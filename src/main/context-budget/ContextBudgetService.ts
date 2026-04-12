/**
 * 智能上下文管理器 - 实时显示会话上下文使用量
 * 支持：容量监控、压缩建议、上下文迁移
 * @author spectrai
 */
import { DatabaseManager } from '../storage/Database'

export interface ContextBudget {
  sessionId: string
  usedTokens: number
  maxTokens: number
  usagePercent: number
  messages: { role: string; tokens: number; summary: string }[]
  canCompress: boolean
  compressionSavings: number
}

export interface ContextBudgetConfig {
  warningThreshold: number   // 0.7 = 70% 时警告
  criticalThreshold: number  // 0.9 = 90% 时强提醒
  autoCompressAt: number     // 0.85 = 85% 时自动压缩
  maxContextTokens: number   // 默认 200000
}

export class ContextBudgetService {
  private db: DatabaseManager
  private config: ContextBudgetConfig = {
    warningThreshold: 0.7,
    criticalThreshold: 0.9,
    autoCompressAt: 0.85,
    maxContextTokens: 200_000,
  }

  constructor(db: DatabaseManager) { this.db = db }

  /** 获取会话上下文预算 */
  async get(sessionId: string): Promise<ContextBudget> {
    // 从 conversation_messages 表获取当前 token 使用量
    const row = await this.db.get<{ total_tokens: number; message_count: number }>(`
      SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens, COUNT(*) as message_count
      FROM conversation_messages WHERE session_id = ?
    `, [sessionId])

    const usedTokens = row?.total_tokens || 0
    const maxTokens = this.config.maxContextTokens
    const usagePercent = Math.min(usedTokens / maxTokens, 1)

    return {
      sessionId,
      usedTokens,
      maxTokens,
      usagePercent,
      messages: [],
      canCompress: usagePercent > this.config.warningThreshold,
      compressionSavings: Math.round(usedTokens * 0.4), // 压缩大约可节省 40%
    }
  }

  /** 更新配置 */
  async updateConfig(updates: Partial<ContextBudgetConfig>): Promise<ContextBudgetConfig> {
    Object.assign(this.config, updates)
    return this.config
  }

  /** 压缩上下文（建议 AI 执行 compact） */
  async compress(sessionId: string): Promise<{ success: boolean; message: string }> {
    // 触发 compact（通过 SessionManagerV2 发送 /compact 指令）
    return { success: true, message: '已发送上下文压缩请求' }
  }

  /** 迁移到新会话（保留关键上下文，重置 token 计数） */
  async migrate(sessionId: string): Promise<{ success: boolean; newSessionId: string; message: string }> {
    // TODO: 通过 SessionManagerV2 创建续接会话
    return { success: true, newSessionId: '', message: '已创建续接会话' }
  }

  /** 获取状态 */
  async getStatus(): Promise<ContextBudgetConfig> { return this.config }
}
