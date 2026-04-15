/**
 * 智能上下文管理器 - 实时显示会话上下文使用量
 * 支持：容量监控、压缩建议、上下文迁移、配置持久化、自动告警
 * @author spectrai
 */
import { DatabaseManager } from '../storage/Database'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type BetterSqlite3 from 'better-sqlite3'
import type { SessionManagerV2 } from '../session/SessionManagerV2'

export interface ContextBudget {
  sessionId: string
  usedTokens: number
  maxTokens: number
  usagePercent: number
  messageCount: number
  messages: { role: string; tokens: number; summary: string }[]
  canCompress: boolean
  compressionSavings: number
  level: 'normal' | 'warning' | 'critical'
}

export interface ContextBudgetConfig {
  warningThreshold: number   // 0.7 = 70% 时警告
  criticalThreshold: number  // 0.9 = 90% 时强提醒
  autoCompressAt: number     // 0.85 = 85% 时自动压缩
  maxContextTokens: number   // 默认 200000
}

const DEFAULT_CONFIG: ContextBudgetConfig = {
  warningThreshold: 0.7,
  criticalThreshold: 0.9,
  autoCompressAt: 0.85,
  maxContextTokens: 200_000,
}

export class ContextBudgetService {
  private db: DatabaseManager
  private rawDb: BetterSqlite3.Database | null = null
  private config: ContextBudgetConfig = { ...DEFAULT_CONFIG }
  /** 追踪每个会话的累计 token 使用量（用于告警判断） */
  private sessionUsage = new Map<string, number>()
  private sessionManagerV2: SessionManagerV2 | null = null

  constructor(db: DatabaseManager) {
    this.db = db
    this.initDatabase()
    this.loadConfig()
  }

  /** 注入 SessionManagerV2（由 index.ts 调用） */
  setSessionManager(sm: SessionManagerV2): void {
    this.sessionManagerV2 = sm
  }

  /**
   * ★ 会话 token 使用量更新回调
   * 由 SessionManagerV2 的 usage-update 事件调用（见 index.ts）
   * 会自动检查阈值并向渲染进程推送告警
   */
  onUsageUpdate(sessionId: string, inputTokens: number, outputTokens: number): void {
    if (inputTokens === 0 && outputTokens === 0) return
    const delta = inputTokens + outputTokens
    const current = this.sessionUsage.get(sessionId) || 0
    const total = current + delta
    this.sessionUsage.set(sessionId, total)

    const maxTokens = this.config.maxContextTokens
    const usagePercent = total / maxTokens

    // 检查阈值并推送告警
    if (usagePercent >= this.config.criticalThreshold) {
      this.sendAlert(sessionId, 'critical', total, maxTokens)
    } else if (usagePercent >= this.config.warningThreshold) {
      this.sendAlert(sessionId, 'warning', total, maxTokens)
    }

    // 检查是否需要自动压缩
    if (usagePercent >= this.config.autoCompressAt) {
      this.sendAlert(sessionId, 'compress', total, maxTokens)
    }
  }

  /** 清除会话追踪数据（会话结束时调用） */
  onSessionEnd(sessionId: string): void {
    this.sessionUsage.delete(sessionId)
  }

  /** 向渲染进程推送上下文告警 */
  private sendAlert(sessionId: string, level: 'warning' | 'critical' | 'compress', used: number, max: number): void {
    try {
      sendToRenderer(IPC.CONTEXT_BUDGET_ALERT, {
        sessionId,
        level,
        used,
        max,
        percent: Math.round((used / max) * 100),
      })
    } catch { /* ignore */ }
  }

  private getRawDb(): BetterSqlite3.Database {
    if (!this.rawDb) {
      this.rawDb = (this.db as any).db as BetterSqlite3.Database
    }
    return this.rawDb!
  }

  private initDatabase(): void {
    const db = this.getRawDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS context_budget_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  }

  private loadConfig(): void {
    try {
      const db = this.getRawDb()
      const row = db.prepare("SELECT value FROM context_budget_settings WHERE key = 'config'").get() as any
      if (row?.value) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(row.value) }
      }
    } catch { /* use defaults */ }
  }

  private saveConfig(): void {
    try {
      const db = this.getRawDb()
      db.prepare("INSERT OR REPLACE INTO context_budget_settings (key, value) VALUES ('config', ?)")
        .run(JSON.stringify(this.config))
    } catch { /* ignore */ }
  }

  /** 获取会话上下文预算 */
  async get(sessionId: string): Promise<{ success: boolean; budget?: ContextBudget }> {
    try {
      const db = this.getRawDb()

      // 从 conversation_messages 表获取真实的 token 使用量
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(COALESCE(usage_input_tokens, 0) + COALESCE(usage_output_tokens, 0)), 0) as total_tokens,
          COUNT(*) as message_count
        FROM conversation_messages WHERE session_id = ?
      `).get(sessionId) as any

      const usedTokens = row?.total_tokens || 0
      const messageCount = row?.message_count || 0
      const maxTokens = this.config.maxContextTokens
      const usagePercent = Math.min(usedTokens / maxTokens, 1)

      // 获取最近的消息摘要（按角色分组，取最近的）
      const recentMessages = db.prepare(`
        SELECT role, content,
          COALESCE(usage_input_tokens, 0) + COALESCE(usage_output_tokens, 0) as tokens
        FROM conversation_messages
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT 10
      `).all(sessionId) as any[]

      const messages = recentMessages.map(m => ({
        role: m.role,
        tokens: m.tokens || 0,
        summary: (m.content || '').slice(0, 100)
      })).reverse()

      const canCompress = usagePercent > this.config.warningThreshold
      const compressionSavings = Math.round(usedTokens * 0.4)

      let level: 'normal' | 'warning' | 'critical' = 'normal'
      if (usagePercent >= this.config.criticalThreshold) level = 'critical'
      else if (usagePercent >= this.config.warningThreshold) level = 'warning'

      return {
        success: true,
        budget: {
          sessionId,
          usedTokens,
          maxTokens,
          usagePercent,
          messageCount,
          messages,
          canCompress,
          compressionSavings,
          level,
        }
      }
    } catch (err: any) {
      return { success: true, budget: {
        sessionId, usedTokens: 0, maxTokens: this.config.maxContextTokens,
        usagePercent: 0, messageCount: 0, messages: [], canCompress: false,
        compressionSavings: 0, level: 'normal'
      }}
    }
  }

  /** 更新配置 */
  async updateConfig(updates: Partial<ContextBudgetConfig>): Promise<{ success: boolean; config: ContextBudgetConfig }> {
    this.config = { ...this.config, ...updates }
    this.saveConfig()
    return { success: true, config: { ...this.config } }
  }

  /** 获取配置 */
  async getStatus(): Promise<{ success: boolean; config: ContextBudgetConfig }> {
    return { success: true, config: { ...this.config } }
  }

  /** 压缩上下文（发送 /compact 指令到会话） */
  async compress(sessionId: string): Promise<{ success: boolean; message: string; savings?: number }> {
    try {
      if (!this.sessionManagerV2) {
        return { success: false, message: 'SessionManagerV2 未初始化' }
      }

      const session = this.sessionManagerV2.getSession(sessionId)
      if (!session) {
        return { success: false, message: `会话 ${sessionId} 不存在` }
      }

      // 获取当前使用量（用于估算压缩效果）
      const budgetResult = await this.get(sessionId)
      const currentTokens = budgetResult.budget?.usedTokens || 0

      // 发送 /compact 命令到会话
      await this.sessionManagerV2.sendMessage(sessionId, '/compact')

      // 重置该会话的追踪计数
      this.sessionUsage.delete(sessionId)

      const estimatedSavings = Math.round(currentTokens * 0.4)

      sendToRenderer(IPC.CONTEXT_BUDGET_ALERT, {
        sessionId,
        level: 'compressed',
        savings: estimatedSavings,
        message: `上下文已压缩，预计节省 ${estimatedSavings} tokens`,
      })

      return {
        success: true,
        message: `已发送压缩指令，预计节省约 ${estimatedSavings} tokens`,
        savings: estimatedSavings,
      }
    } catch (err: any) {
      return { success: false, message: `压缩失败: ${err.message}` }
    }
  }

  /** 迁移到新会话（保留关键上下文，重置 token 计数） */
  async migrate(sessionId: string): Promise<{ success: boolean; newSessionId?: string; message: string }> {
    try {
      if (!this.sessionManagerV2) {
        return { success: false, message: 'SessionManagerV2 未初始化' }
      }

      const session = this.sessionManagerV2.getSession(sessionId)
      if (!session) {
        return { success: false, message: `会话 ${sessionId} 不存在` }
      }

      // 1. 从旧会话提取关键上下文（最近的消息摘要）
      const db = this.getRawDb()
      const recentMessages = db.prepare(`
        SELECT role, content
        FROM conversation_messages
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT 10
      `).all(sessionId) as any[]

      // 2. 构建续接 prompt：包含旧会话摘要 + 最后的上下文
      const contextLines: string[] = ['[上下文续接 - 从上一个会话迁移]\n']
      contextLines.push('以下是上一个会话的关键上下文摘要：\n')

      for (const msg of recentMessages.reverse()) {
        const content = (msg.content || '').slice(0, 500) // 截断避免过长
        if (msg.role === 'user') {
          contextLines.push(`用户: ${content}`)
        } else if (msg.role === 'assistant') {
          contextLines.push(`助手: ${content}`)
        }
      }

      contextLines.push('\n请基于以上上下文继续工作。')

      const migrationPrompt = contextLines.join('\n')

      // 3. 创建新会话
      const newSessionId = this.sessionManagerV2.createSession({
        id: `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: `${session.name || 'Session'} (续接)`,
        workingDirectory: session.workingDirectory || process.cwd(),
        providerId: session.provider?.id,
        initialPrompt: migrationPrompt,
      })

      // 4. 清理旧会话追踪
      this.sessionUsage.delete(sessionId)

      sendToRenderer(IPC.CONTEXT_BUDGET_ALERT, {
        sessionId,
        level: 'migrated',
        newSessionId,
        message: `上下文已迁移到新会话 ${newSessionId.slice(0, 8)}`,
      })

      return {
        success: true,
        newSessionId,
        message: `已创建续接会话 ${newSessionId.slice(0, 8)}，关键上下文已迁移`,
      }
    } catch (err: any) {
      return { success: false, message: `迁移失败: ${err.message}` }
    }
  }

  /** 检查是否需要自动压缩 */
  shouldAutoCompress(usagePercent: number): boolean {
    return usagePercent >= this.config.autoCompressAt
  }

  /** 获取所有活跃会话的上下文使用情况 */
  async getActiveSessionsBudget(sessionIds: string[]): Promise<{ success: boolean; budgets: ContextBudget[] }> {
    const budgets: ContextBudget[] = []
    for (const sid of sessionIds) {
      const r = await this.get(sid)
      if (r.budget) budgets.push(r.budget)
    }
    return { success: true, budgets }
  }
}
