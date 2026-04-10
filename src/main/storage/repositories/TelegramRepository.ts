/**
 * TelegramRepository - Telegram 集成相关数据库操作
 * Token 存运行时内存（不落库），其余配置走 SQLite
 */
export interface TelegramIntegration {
  id: string
  botToken: string
  enabled: boolean
  commandPrefix: string
  notifyOnStart: boolean
  notifyOnEnd: boolean
  notifyOnError: boolean
  createdAt?: Date
  updatedAt?: Date
}

export interface TelegramChatMapping {
  id: string
  integrationId: string
  chatId: string
  sessionId: string
  sessionName?: string
  createdAt?: Date
}

export class TelegramRepository {
  // Token 不落库，仅存运行时内存
  private botToken: string | null = null

  constructor(private db: any, private usingSqlite: boolean) {}

  // ── Token（内存） ──────────────────────────────────────────

  setBotToken(token: string): void {
    this.botToken = token
  }

  getBotToken(): string | null {
    return this.botToken
  }

  clearBotToken(): void {
    this.botToken = null
  }

  // ── Integration 配置（SQLite） ────────────────────────────

  getIntegrationConfig(): Pick<TelegramIntegration, 'enabled' | 'commandPrefix' | 'notifyOnStart' | 'notifyOnEnd' | 'notifyOnError'> | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.db.prepare('SELECT * FROM telegram_integrations WHERE id = ?').get('default') as any
      if (!row) return null
      return {
        enabled: !!row.enabled,
        commandPrefix: row.command_prefix,
        notifyOnStart: !!row.notify_on_start,
        notifyOnEnd: !!row.notify_on_end,
        notifyOnError: !!row.notify_on_error,
      }
    } catch { return null }
  }

  saveIntegrationConfig(config: Omit<TelegramIntegration, 'id' | 'botToken' | 'createdAt' | 'updatedAt'>): void {
    if (!this.usingSqlite) return
    this.db.prepare(`
      INSERT OR REPLACE INTO telegram_integrations (id, enabled, command_prefix, notify_on_start, notify_on_end, notify_on_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'default',
      config.enabled ? 1 : 0,
      config.commandPrefix,
      config.notifyOnStart ? 1 : 0,
      config.notifyOnEnd ? 1 : 0,
      config.notifyOnError ? 1 : 0,
      new Date().toISOString()
    )
  }

  // ── Chat Mappings（SQLite） ────────────────────────────────

  getAllMappings(): TelegramChatMapping[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM telegram_chat_mappings ORDER BY created_at DESC'
      ).all() as any[]
      return rows.map(this.mapRow)
    } catch { return [] }
  }

  getMappingsByChatId(integrationId: string, chatId: string): TelegramChatMapping[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM telegram_chat_mappings WHERE integration_id = ? AND chat_id = ? ORDER BY created_at DESC'
      ).all(integrationId, chatId) as any[]
      return rows.map(this.mapRow)
    } catch { return [] }
  }

  getMappingsBySessionId(sessionId: string): TelegramChatMapping[] {
    if (!this.usingSqlite) return []
    try {
      const rows = this.db.prepare(
        'SELECT * FROM telegram_chat_mappings WHERE session_id = ? ORDER BY created_at DESC'
      ).all(sessionId) as any[]
      return rows.map(this.mapRow)
    } catch { return [] }
  }

  createMapping(mapping: Omit<TelegramChatMapping, 'id' | 'createdAt'>): TelegramChatMapping {
    const id = `tgm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT OR IGNORE INTO telegram_chat_mappings (id, integration_id, chat_id, session_id, session_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, mapping.integrationId, mapping.chatId, mapping.sessionId, mapping.sessionName || null)
    }
    return { id, ...mapping, createdAt: new Date() }
  }

  deleteMapping(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM telegram_chat_mappings WHERE id = ?').run(id)
  }

  deleteMappingsBySessionId(sessionId: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM telegram_chat_mappings WHERE session_id = ?').run(sessionId)
  }

  private mapRow(row: any): TelegramChatMapping {
    return {
      id: row.id,
      integrationId: row.integration_id,
      chatId: row.chat_id,
      sessionId: row.session_id,
      sessionName: row.session_name || undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
    }
  }
}
