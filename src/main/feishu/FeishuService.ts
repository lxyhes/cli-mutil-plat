/**
 * FeishuService - 飞书集成服务
 * 支持：Webhook 通知 + Bot API 消息发送
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'

export type FeishuStatus = 'stopped' | 'connected' | 'error'

interface FeishuMessagePayload {
  msg_type: 'text' | 'interactive'
  content: { text: string } | Record<string, any>
}

interface LarkApiResponse {
  code: number
  msg: string
  data?: any
}

export class FeishuService extends EventEmitter {
  private status: FeishuStatus = 'stopped'
  private integrationId: string = 'default'
  private baseUrl: string = 'https://open.feishu.cn/open-apis'
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private db: DatabaseManager,
  ) {
    super()
  }

  // ── 连接生命周期 ────────────────────────────────────────────

  async connect(config: {
    appId?: string
    appSecret?: string
    webhookUrl?: string
  }): Promise<void> {
    try {
      // 保存配置到数据库
      this.db.saveFeishuIntegration({
        appId: config.appId ?? null,
        appSecret: config.appSecret ?? null,
        webhookUrl: config.webhookUrl ?? null,
        enabled: true,
        notifyOnStart: true,
        notifyOnEnd: true,
        notifyOnError: true,
      })

      // 如果提供了 appId + appSecret，获取 access token
      if (config.appId && config.appSecret) {
        await this.refreshAccessToken(config.appId, config.appSecret)
      }

      this.setStatus('connected')
    } catch (err) {
      this.setStatus('error')
      throw err
    }
  }

  stop(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
    this.db.clearFeishuAccessToken()
    this.setStatus('stopped')
  }

  getStatus(): FeishuStatus {
    return this.status
  }

  // ── Access Token 管理 ─────────────────────────────────────

  private async refreshAccessToken(appId: string, appSecret: string): Promise<void> {
    try {
      const url = `${this.baseUrl}/auth/v3/tenant_access_token/internal`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      })
      const data = await res.json() as LarkApiResponse
      if (data.code !== 0) {
        throw new Error(data.msg || 'Failed to get access token')
      }
      // access_token 通常有效期 2 小时，提前 5 分钟刷新
      const expiresIn = (data.data?.expire ?? 7200) - 300
      this.db.setFeishuAccessToken(data.data?.access_token ?? '', expiresIn)

      // 设置定时刷新
      if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = setTimeout(() => {
        const cfg = this.db.getFeishuIntegration()
        if (cfg?.appId && cfg?.appSecret) {
          this.refreshAccessToken(cfg.appId, cfg.appSecret).catch(console.error)
        }
      }, expiresIn * 1000)
    } catch (err) {
      console.error('[Feishu] Failed to refresh access token:', err)
      throw err
    }
  }

  // ── 消息发送 ───────────────────────────────────────────────

  /**
   * 发送文本消息到指定会话
   */
  async sendMessage(chatId: string, text: string): Promise<void> {
    const integration = this.db.getFeishuIntegration()
    if (!integration?.enabled) return

    const accessToken = this.db.getFeishuAccessToken()

    if (accessToken) {
      // 使用 Bot API 发送消息
      await this.sendBotMessage(chatId, text, accessToken)
    } else if (integration.webhookUrl) {
      // 使用 Webhook 发送
      await this.sendWebhookMessage(integration.webhookUrl, text)
    }
  }

  private async sendBotMessage(chatId: string, text: string, accessToken: string): Promise<void> {
    try {
      const url = `${this.baseUrl}/im/v1/messages?receive_id_type=chat_id`
      const payload = {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as LarkApiResponse
      if (data.code !== 0) {
        console.error('[Feishu] Send message failed:', data.msg)
      } else {
        sendToRenderer(IPC.FEISHU_MESSAGE_SENT, chatId, text)
      }
    } catch (err) {
      console.error('[Feishu] Send bot message error:', err)
    }
  }

  private async sendWebhookMessage(webhookUrl: string, text: string): Promise<void> {
    try {
      const payload: FeishuMessagePayload = {
        msg_type: 'text',
        content: { text },
      }
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        sendToRenderer(IPC.FEISHU_MESSAGE_SENT, 'webhook', text)
      }
    } catch (err) {
      console.error('[Feishu] Webhook send error:', err)
    }
  }

  // ── 主动推送通知 ──────────────────────────────────────────

  pushAiMessageToChat(sessionId: string, text: string): void {
    const mappings = this.db.getFeishuMappingsBySessionId(sessionId)
    if (!mappings.length) return

    const integration = this.db.getFeishuIntegration()
    if (!integration?.enabled) return

    const displayText = text.length > 3000 ? text.slice(0, 2997) + '...' : text
    const sessionName = mappings[0]?.sessionName || sessionId.slice(0, 8)
    const message = `[${sessionName}]\n${displayText}`

    for (const mapping of mappings) {
      this.sendMessage(mapping.chatId, message).catch(console.error)
    }
  }

  pushSessionEventToChat(sessionId: string, event: 'started' | 'completed' | 'error', detail?: string): void {
    const integration = this.db.getFeishuIntegration()
    if (!integration?.enabled) return

    const mappings = this.db.getFeishuMappingsBySessionId(sessionId)
    if (!mappings.length) return

    const sessionName = mappings[0]?.sessionName || sessionId.slice(0, 8)

    const shouldNotify =
      (event === 'started' && integration.notifyOnStart) ||
      (event === 'completed' && integration.notifyOnEnd) ||
      (event === 'error' && integration.notifyOnError)

    if (!shouldNotify) return

    const messages: Record<string, string> = {
      started:  `▶ 会话已开始：${sessionName}`,
      completed: `✓ 会话完成：${sessionName}`,
      error:    `✗ 会话错误：${sessionName}${detail ? '\n' + detail : ''}`,
    }

    for (const mapping of mappings) {
      this.sendMessage(mapping.chatId, messages[event]).catch(console.error)
    }
  }

  // ── 连接测试 ─────────────────────────────────────────────

  async testConnection(config: {
    appId?: string
    appSecret?: string
    webhookUrl?: string
  }): Promise<{ success: boolean; botName?: string; error?: string }> {
    try {
      if (config.webhookUrl) {
        // 测试 Webhook URL
        const res = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msg_type: 'text',
            content: { text: 'PrismOps 连接测试消息' },
          }),
        })
        if (!res.ok) {
          return { success: false, error: `Webhook 请求失败: ${res.status}` }
        }
        return { success: true }
      }

      if (config.appId && config.appSecret) {
        // 测试 Bot API
        const url = `${this.baseUrl}/auth/v3/tenant_access_token/internal`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
        })
        const data = await res.json() as LarkApiResponse
        if (data.code !== 0) {
          return { success: false, error: data.msg || '认证失败' }
        }
        return { success: true }
      }

      return { success: false, error: '请提供 Webhook URL 或 App ID + App Secret' }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  private setStatus(status: FeishuStatus): void {
    this.status = status
    sendToRenderer(IPC.FEISHU_STATUS_CHANGED, status)
  }
}
