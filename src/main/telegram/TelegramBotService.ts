/**
 * TelegramBotService - Telegram Bot 服务
 * 负责：Bot 连接管理 / 命令路由 / 消息转发 / 通知推送
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'

export type TelegramBotStatus = 'stopped' | 'starting' | 'running' | 'error'

interface TelegramUpdate {
  update_id: number
  message?: {
    chat: { id: number }
    text?: string
  }
}

export class TelegramBotService extends EventEmitter {
  private status: TelegramBotStatus = 'stopped'
  private pollingTimer: ReturnType<typeof setTimeout> | null = null
  private lastUpdateId: number = 0
  private baseUrl: string = ''
  private integrationId: string = 'default'

  constructor(
    private db: DatabaseManager,
    private sessionManagerV2: SessionManagerV2,
  ) {
    super()
  }

  // ── 连接生命周期 ────────────────────────────────────────────

  async start(token: string): Promise<void> {
    if (this.status === 'running') return
    this.setStatus('starting')
    this.baseUrl = `https://api.telegram.org/bot${token}`

    // 验证 token
    try {
      const me = await this.apiCall('/getMe', {})
      if (!me.ok) throw new Error(me.description || 'Invalid token')
    } catch (err) {
      this.setStatus('error')
      throw err
    }

    // 保存 token 到内存
    this.db.setTelegramBotToken(token)

    // 保存配置到 SQLite
    const config = this.db.getTelegramIntegrationConfig()
    this.db.saveTelegramIntegrationConfig({
      enabled: true,
      commandPrefix: config?.commandPrefix || '/',
      notifyOnStart: config?.notifyOnStart ?? true,
      notifyOnEnd: config?.notifyOnEnd ?? true,
      notifyOnError: config?.notifyOnError ?? true,
    })

    this.poll()
    this.setStatus('running')
  }

  stop(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = null
    }
    this.db.clearTelegramBotToken()
    this.setStatus('stopped')
  }

  getStatus(): TelegramBotStatus {
    return this.status
  }

  // ── 消息轮询（Long Polling） ─────────────────────────────────

  private async poll(): Promise<void> {
    if (this.status !== 'running' && this.status !== 'starting') return

    try {
      const updates = await this.apiCall('/getUpdates', {
        offset: this.lastUpdateId + 1,
        timeout: 30,
      })

      if (updates.ok && updates.result?.length > 0) {
        for (const update of updates.result as TelegramUpdate[]) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id)
          this.handleUpdate(update)
        }
      }
    } catch (err) {
      console.error('[TelegramBot] Poll error:', err)
    }

    this.pollingTimer = setTimeout(() => this.poll(), 1000)
  }

  // ── Update 处理 ──────────────────────────────────────────────

  private handleUpdate(update: TelegramUpdate): void {
    const msg = update.message
    if (!msg || !msg.text) return

    const chatId = String(msg.chat.id)
    const text = msg.text.trim()

    const config = this.db.getTelegramIntegrationConfig()
    const prefix = config?.commandPrefix || '/'

    if (text.startsWith(prefix)) {
      this.handleCommand(chatId, text.slice(prefix.length), msg)
      return
    }

    this.handleChatMessage(chatId, text)
  }

  // ── 命令处理 ────────────────────────────────────────────────

  private async handleCommand(chatId: string, cmd: string, msg: NonNullable<TelegramUpdate['message']>): Promise<void> {
    const parts = cmd.match(/(\S+)(.*)/)
    if (!parts) return
    const command = parts[1].toLowerCase()
    const args = parts[2].trim().split(/\s+/).filter(Boolean)
    const mappings = this.db.getTelegramMappingsByChatId(this.integrationId, chatId)
    const config = this.db.getTelegramIntegrationConfig()
    const prefix = config?.commandPrefix || '/'

    switch (command) {
      case 'sessions':
      case 'list': {
        if (mappings.length === 0) {
          await this.sendMessage(chatId, '当前未关联任何会话。\n使用 /add <session_id> 添加。')
        } else {
          const lines = mappings.map(m =>
            `• ${m.sessionName || m.sessionId} (\`${m.sessionId.slice(0, 8)}...\`)`
          )
          await this.sendMessage(chatId, `已关联会话：\n${lines.join('\n')}`)
        }
        break
      }

      case 'add': {
        const sessionId = args[0]
        if (!sessionId) {
          await this.sendMessage(chatId, `用法：${prefix}add <session_id>\n使用 ${prefix}sessions 查看可用 session_id`)
          break
        }
        const session = this.sessionManagerV2.getSession(sessionId)
        if (!session) {
          await this.sendMessage(chatId, `未找到会话：${sessionId}`)
          break
        }
        this.db.createTelegramMapping({
          integrationId: this.integrationId,
          chatId,
          sessionId,
          sessionName: session.name,
        })
        await this.sendMessage(chatId, `已关联会话：${session.name}`)
        this.emit('mapping-added', { chatId, sessionId })
        sendToRenderer(IPC.TELEGRAM_MESSAGE_SENT, chatId, `关联会话 ${session.name}`)
        break
      }

      case 'remove':
      case 'rm': {
        const sessionId = args[0]
        if (!sessionId) {
          await this.sendMessage(chatId, `用法：${prefix}remove <session_id>`)
          break
        }
        const toDelete = mappings.find(m => m.sessionId === sessionId)
        if (toDelete) {
          this.db.deleteTelegramMapping(toDelete.id)
          await this.sendMessage(chatId, `已取消关联：${sessionId}`)
          this.emit('mapping-removed', { chatId, sessionId })
        } else {
          await this.sendMessage(chatId, '未找到此映射')
        }
        break
      }

      case 'help': {
        const helpText = [
          'SpectrAI Telegram 控制命令：',
          `${prefix}sessions — 列出已关联的会话`,
          `${prefix}add <session_id> — 关联一个会话`,
          `${prefix}remove <session_id> — 取消关联`,
          `${prefix}status — 查看 Bot 连接状态`,
          `${prefix}help — 显示此帮助`,
          '',
          '直接发送消息即可远程操控对应会话。',
        ].join('\n')
        await this.sendMessage(chatId, helpText)
        break
      }

      case 'status': {
        const sessionCount = mappings.length
        await this.sendMessage(chatId, `Bot 状态：${this.status}\n已关联 ${sessionCount} 个会话`)
        break
      }

      default: {
        // 未知命令 → 当普通消息处理
        this.handleChatMessage(chatId, `${prefix}${cmd}`)
        break
      }
    }
  }

  // ── 普通消息 → 路由到 Session ─────────────────────────────────

  private async handleChatMessage(chatId: string, text: string): Promise<void> {
    const config = this.db.getTelegramIntegrationConfig()
    if (!config?.enabled) return

    const mappings = this.db.getTelegramMappingsByChatId(this.integrationId, chatId)
    if (mappings.length === 0) {
      await this.sendMessage(chatId, `请先使用 /add <session_id> 关联一个会话（使用 /help 查看帮助）`)
      return
    }

    // 取最新关联的 session
    const primary = mappings[0]
    const session = this.sessionManagerV2.getSession(primary.sessionId)

    if (!session) {
      await this.sendMessage(chatId, `会话 ${primary.sessionName || primary.sessionId} 已不存在或已结束`)
      return
    }

    try {
      await this.sessionManagerV2.sendMessage(primary.sessionId, text)
      console.log(`[TelegramBot] → Session ${primary.sessionId}: ${text.slice(0, 60)}`)
      this.emit('user-message', { chatId, sessionId: primary.sessionId, text })
    } catch (err) {
      await this.sendMessage(chatId, `发送失败：${(err as Error).message}`)
    }
  }

  // ── 主动推送 AI 回复 ────────────────────────────────────────

  pushAiMessageToChat(sessionId: string, text: string): void {
    const mappings = this.db.getTelegramMappingsBySessionId(sessionId)
    if (!mappings.length) return

    const config = this.db.getTelegramIntegrationConfig()
    if (!config?.enabled) return

    const displayText = text.length > 3000 ? text.slice(0, 2997) + '...' : text

    for (const mapping of mappings) {
      this.sendMessage(mapping.chatId, `[${mapping.sessionName || sessionId}]\n${displayText}`)
        .catch(err => console.error('[TelegramBot] Push failed:', err))
    }
  }

  pushSessionEventToChat(sessionId: string, event: 'started' | 'completed' | 'error', detail?: string): void {
    const config = this.db.getTelegramIntegrationConfig()
    if (!config?.enabled) return

    const mappings = this.db.getTelegramMappingsBySessionId(sessionId)
    if (!mappings.length) return

    const session = this.sessionManagerV2.getSession(sessionId)
    const name = session?.name || sessionId.slice(0, 8)

    const shouldNotify =
      (event === 'started' && config.notifyOnStart) ||
      (event === 'completed' && config.notifyOnEnd) ||
      (event === 'error' && config.notifyOnError)

    if (!shouldNotify) return

    const messages: Record<string, string> = {
      started:  `▶ 会话已开始：${name}`,
      completed: `✓ 会话完成：${name}`,
      error:    `✗ 会话错误：${name}${detail ? '\n' + detail : ''}`,
    }

    for (const mapping of mappings) {
      this.sendMessage(mapping.chatId, messages[event])
        .catch(err => console.error('[TelegramBot] Event push failed:', err))
    }
  }

  // ── 低层 Telegram API ───────────────────────────────────────

  async sendMessage(chatId: string, text: string, parseMode: string = 'Markdown'): Promise<void> {
    await this.apiCall('/sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    })
  }

  async testConnection(token: string): Promise<{ username: string; firstName: string }> {
    const url = `https://api.telegram.org/bot${token}/getMe`
    const res = await fetch(url)
    const data = await res.json() as { ok: boolean; result?: { username: string; first_name: string }; description?: string }
    if (!data.ok) {
      throw new Error(data.description || 'Invalid token')
    }
    return {
      username: data.result!.username,
      firstName: data.result!.first_name,
    }
  }

  private async apiCall(method: string, body: Record<string, unknown>): Promise<any> {
    const url = `${this.baseUrl}${method}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await res.json()
    } catch (err) {
      console.error(`[TelegramBot] API call ${method} failed:`, err)
      return { ok: false, error: String(err) }
    }
  }

  private setStatus(status: TelegramBotStatus): void {
    this.status = status
    sendToRenderer(IPC.TELEGRAM_STATUS_CHANGED, status)
  }
}
