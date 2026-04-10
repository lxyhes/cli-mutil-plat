/**
 * FeishuRepository - 飞书集成相关数据库操作
 */
import { safeStorage } from 'electron'
import { ErrorCode, SpectrAIError } from '../../../shared/errors'

export interface FeishuIntegration {
  id: string
  appId: string | null
  appSecret: string | null
  webhookUrl: string | null
  enabled: boolean
  notifyOnStart: boolean
  notifyOnEnd: boolean
  notifyOnError: boolean
  botName: string | null
  createdAt?: Date
  updatedAt?: Date
}

export interface FeishuChatMapping {
  id: string
  integrationId: string
  chatId: string
  chatName?: string
  sessionId: string
  sessionName?: string
  createdAt?: Date
}

export class FeishuRepository {
  // 运行时凭证存内存（不落库）
  private appAccessToken: string | null = null
  private tokenExpiresAt: number = 0
  private static readonly ENCRYPTED_PREFIX = 'enc:v1:'

  constructor(private db: any, private usingSqlite: boolean) {}

  private getIntegrationRow(): any | null {
    if (!this.usingSqlite) return null
    try {
      return this.db.prepare('SELECT * FROM feishu_integrations WHERE id = ?').get('default') as any
    } catch {
      return null
    }
  }

  private canEncrypt(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private isEncryptedValue(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(FeishuRepository.ENCRYPTED_PREFIX)
  }

  private encryptSensitiveValue(value: string | null | undefined): string | null {
    if (!value) return null
    if (!this.canEncrypt()) return value
    if (this.isEncryptedValue(value)) return value

    const encrypted = safeStorage.encryptString(value).toString('base64')
    return `${FeishuRepository.ENCRYPTED_PREFIX}${encrypted}`
  }

  private decryptSensitiveValue(value: string | null | undefined): string | null {
    if (!value) return null
    if (!this.isEncryptedValue(value)) return value
    if (!this.canEncrypt()) {
      throw new Error('System encryption is not available')
    }

    const payload = value.slice(FeishuRepository.ENCRYPTED_PREFIX.length)
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  }

  private decryptSensitiveValueSafe(value: string | null | undefined, fieldName: string): string | null {
    try {
      return this.decryptSensitiveValue(value)
    } catch (error) {
      console.error(`[FeishuRepository] Failed to decrypt ${fieldName}:`, error)
      return null
    }
  }

  private persistEncryptedSecrets(appSecret: string | null, webhookUrl: string | null): void {
    if (!this.usingSqlite || !this.canEncrypt()) return

    this.db.prepare(`
      UPDATE feishu_integrations
      SET app_secret = ?, webhook_url = ?, updated_at = ?
      WHERE id = 'default'
    `).run(
      this.encryptSensitiveValue(appSecret),
      this.encryptSensitiveValue(webhookUrl),
      new Date().toISOString()
    )
  }

  private assertSensitivePersistenceAllowed(nextSecrets: {
    appSecret?: string | null
    webhookUrl?: string | null
  }): void {
    const needsSensitiveWrite = !!(nextSecrets.appSecret || nextSecrets.webhookUrl)
    if (!needsSensitiveWrite || this.canEncrypt()) return

    throw new SpectrAIError({
      code: ErrorCode.PERMISSION_DENIED,
      message: 'System encryption is not available for storing Feishu credentials securely',
      userMessage: '当前系统未提供可用的安全存储，无法保存飞书敏感凭据',
    })
  }

  // ── Access Token（内存） ─────────────────────────────────

  setAccessToken(token: string, expiresInSecs: number): void {
    this.appAccessToken = token
    this.tokenExpiresAt = Date.now() + expiresInSecs * 1000
  }

  getAccessToken(): string | null {
    if (!this.appAccessToken || Date.now() > this.tokenExpiresAt) {
      this.appAccessToken = null
      return null
    }
    return this.appAccessToken
  }

  clearAccessToken(): void {
    this.appAccessToken = null
    this.tokenExpiresAt = 0
  }

  // ── Integration CRUD ──────────────────────────────────────

  getIntegration(): FeishuIntegration | null {
    if (!this.usingSqlite) return null
    try {
      const row = this.getIntegrationRow()
      if (!row) return null
      const appSecret = this.decryptSensitiveValueSafe(row.app_secret || null, 'app_secret')
      const webhookUrl = this.decryptSensitiveValueSafe(row.webhook_url || null, 'webhook_url')

      if (this.canEncrypt()) {
        const needsMigration =
          (!!appSecret && !this.isEncryptedValue(row.app_secret)) ||
          (!!webhookUrl && !this.isEncryptedValue(row.webhook_url))
        if (needsMigration) {
          this.persistEncryptedSecrets(appSecret, webhookUrl)
        }
      }

      return {
        id: row.id,
        appId: row.app_id || null,
        appSecret,
        webhookUrl,
        enabled: !!row.enabled,
        notifyOnStart: !!row.notify_on_start,
        notifyOnEnd: !!row.notify_on_end,
        notifyOnError: !!row.notify_on_error,
        botName: row.bot_name || null,
        createdAt: row.created_at ? new Date(row.created_at) : undefined,
        updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
      }
    } catch { return null }
  }

  saveIntegration(config: Partial<FeishuIntegration>): void {
    if (!this.usingSqlite) return
    const existing = this.getIntegration()
    const existingRow = this.getIntegrationRow()
    const nextAppSecret = config.appSecret !== undefined
      ? (config.appSecret ?? null)
      : this.decryptSensitiveValueSafe(existingRow?.app_secret || null, 'app_secret')
    const nextWebhookUrl = config.webhookUrl !== undefined
      ? (config.webhookUrl ?? null)
      : this.decryptSensitiveValueSafe(existingRow?.webhook_url || null, 'webhook_url')

    this.assertSensitivePersistenceAllowed({
      appSecret: nextAppSecret,
      webhookUrl: nextWebhookUrl,
    })

    const row = existing ? {
      app_id: config.appId ?? existing.appId,
      app_secret: this.encryptSensitiveValue(nextAppSecret),
      webhook_url: this.encryptSensitiveValue(nextWebhookUrl),
      enabled: config.enabled !== undefined ? (config.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      notify_on_start: config.notifyOnStart !== undefined ? (config.notifyOnStart ? 1 : 0) : (existing.notifyOnStart ? 1 : 0),
      notify_on_end: config.notifyOnEnd !== undefined ? (config.notifyOnEnd ? 1 : 0) : (existing.notifyOnEnd ? 1 : 0),
      notify_on_error: config.notifyOnError !== undefined ? (config.notifyOnError ? 1 : 0) : (existing.notifyOnError ? 1 : 0),
      bot_name: config.botName ?? existing.botName,
    } : {
      app_id: config.appId ?? null,
      app_secret: this.encryptSensitiveValue(nextAppSecret),
      webhook_url: this.encryptSensitiveValue(nextWebhookUrl),
      enabled: config.enabled ? 1 : 0,
      notify_on_start: config.notifyOnStart !== false ? 1 : 0,
      notify_on_end: config.notifyOnEnd !== false ? 1 : 0,
      notify_on_error: config.notifyOnError !== false ? 1 : 0,
      bot_name: config.botName ?? null,
    }

    if (existing) {
      this.db.prepare(`
        UPDATE feishu_integrations SET
          app_id=?, app_secret=?, webhook_url=?, enabled=?,
          notify_on_start=?, notify_on_end=?, notify_on_error=?,
          bot_name=?, updated_at=?
        WHERE id='default'
      `).run(
        row.app_id, row.app_secret, row.webhook_url, row.enabled,
        row.notify_on_start, row.notify_on_end, row.notify_on_error,
        row.bot_name, new Date().toISOString()
      )
    } else {
      this.db.prepare(`
        INSERT INTO feishu_integrations
          (id, app_id, app_secret, webhook_url, enabled,
           notify_on_start, notify_on_end, notify_on_error, bot_name)
        VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.app_id, row.app_secret, row.webhook_url, row.enabled,
        row.notify_on_start, row.notify_on_end, row.notify_on_error, row.bot_name
      )
    }
  }

  // ── Chat Mappings ─────────────────────────────────────────

  getAllMappings(): FeishuChatMapping[] {
    if (!this.usingSqlite) return []
    try {
      return (this.db.prepare(
        'SELECT * FROM feishu_chat_mappings ORDER BY created_at DESC'
      ).all() as any[]).map(this.mapRow)
    } catch { return [] }
  }

  getMappingsByChatId(chatId: string): FeishuChatMapping[] {
    if (!this.usingSqlite) return []
    try {
      return (this.db.prepare(
        'SELECT * FROM feishu_chat_mappings WHERE chat_id = ? ORDER BY created_at DESC'
      ).all(chatId) as any[]).map(this.mapRow)
    } catch { return [] }
  }

  getMappingsBySessionId(sessionId: string): FeishuChatMapping[] {
    if (!this.usingSqlite) return []
    try {
      return (this.db.prepare(
        'SELECT * FROM feishu_chat_mappings WHERE session_id = ? ORDER BY created_at DESC'
      ).all(sessionId) as any[]).map(this.mapRow)
    } catch { return [] }
  }

  createMapping(mapping: Omit<FeishuChatMapping, 'id' | 'createdAt'>): FeishuChatMapping {
    const id = `fcm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (this.usingSqlite) {
      this.db.prepare(`
        INSERT OR IGNORE INTO feishu_chat_mappings
          (id, integration_id, chat_id, chat_name, session_id, session_name)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, mapping.integrationId, mapping.chatId, mapping.chatName || null,
             mapping.sessionId, mapping.sessionName || null)
    }
    return { id, ...mapping, createdAt: new Date() }
  }

  deleteMapping(id: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM feishu_chat_mappings WHERE id = ?').run(id)
  }

  deleteMappingsBySessionId(sessionId: string): void {
    if (!this.usingSqlite) return
    this.db.prepare('DELETE FROM feishu_chat_mappings WHERE session_id = ?').run(sessionId)
  }

  private mapRow(row: any): FeishuChatMapping {
    return {
      id: row.id,
      integrationId: row.integration_id,
      chatId: row.chat_id,
      chatName: row.chat_name || undefined,
      sessionId: row.session_id,
      sessionName: row.session_name || undefined,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
    }
  }
}
