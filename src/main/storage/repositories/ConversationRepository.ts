/**
 * ConversationRepository - SDK V2 Conversation Messages 相关数据库操作
 */

export class ConversationRepository {
  constructor(private db: any, private usingSqlite: boolean) {}

  private parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  insertConversationMessage(msg: {
    id: string
    sessionId: string
    role: string
    content: string
    timestamp?: string
    attachments?: Array<{ type: 'image'; path: string; name?: string }>
    toolName?: string
    toolInput?: Record<string, unknown>
    toolResult?: string
    isError?: boolean
    thinkingText?: string
    usageInputTokens?: number
    usageOutputTokens?: number
    toolUseId?: string
    fileChange?: {
      filePath: string
      changeType: 'edit' | 'create' | 'write' | 'delete'
      operationDiff: string
      cumulativeDiff?: string
      additions: number
      deletions: number
    }
  }): void {
    if (!this.db) return
    try {
      // 确保 id 是字符串类型（数据库表 id 字段为 TEXT PRIMARY KEY）
      const messageId = typeof msg.id === 'string' ? msg.id : `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

      this.db.prepare(`
        INSERT OR IGNORE INTO conversation_messages
        (id, session_id, role, content, timestamp, attachments, tool_name, tool_input, tool_result,
         is_error, thinking_text, usage_input_tokens, usage_output_tokens, tool_use_id, file_change)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        msg.sessionId,
        msg.role,
        msg.content,
        msg.timestamp || new Date().toISOString(),
        msg.attachments ? JSON.stringify(msg.attachments) : null,
        msg.toolName || null,
        msg.toolInput ? JSON.stringify(msg.toolInput) : null,
        msg.toolResult || null,
        msg.isError ? 1 : 0,
        msg.thinkingText || null,
        msg.usageInputTokens || null,
        msg.usageOutputTokens || null,
        msg.toolUseId || null,
        msg.fileChange ? JSON.stringify(msg.fileChange) : null,
      )
    } catch (err: any) {
      // 如果错误是 datatype mismatch，可能是旧表结构（INTEGER id）导致的
      if (err?.message?.includes('datatype mismatch')) {
        try {
          // 尝试使用整数 hash 作为 id（兼容旧表结构）
          const numericId = this.hashCode(msg.id)
          this.db.prepare(`
            INSERT OR IGNORE INTO conversation_messages
            (id, session_id, role, content, timestamp, attachments, tool_name, tool_input, tool_result,
             is_error, thinking_text, usage_input_tokens, usage_output_tokens, tool_use_id, file_change)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            numericId,
            msg.sessionId,
            msg.role,
            msg.content,
            msg.timestamp || new Date().toISOString(),
            msg.attachments ? JSON.stringify(msg.attachments) : null,
            msg.toolName || null,
            msg.toolInput ? JSON.stringify(msg.toolInput) : null,
            msg.toolResult || null,
            msg.isError ? 1 : 0,
            msg.thinkingText || null,
            msg.usageInputTokens || null,
            msg.usageOutputTokens || null,
            msg.toolUseId || null,
            msg.fileChange ? JSON.stringify(msg.fileChange) : null,
          )
          return
        } catch (retryErr) {
          console.warn('[Database] insertConversationMessage retry error:', retryErr)
        }
      }
      console.warn('[Database] insertConversationMessage error:', err)
    }
  }

  /**
   * 生成字符串的数值哈希（用于兼容旧表结构的 INTEGER id）
   */
  private hashCode(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 转换为 32bit 整数
    }
    return Math.abs(hash) || 1 // 确保返回正整数
  }

  /**
   * 获取会话的对话消息历史
   */
  getConversationMessages(sessionId: string, limit?: number): any[] {
    if (!this.db) return []
    try {
      const sql = limit
        ? `SELECT * FROM (
             SELECT * FROM conversation_messages
             WHERE session_id = ?
             ORDER BY timestamp DESC, id DESC
             LIMIT ?
           )
           ORDER BY timestamp ASC, id ASC`
        : 'SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY timestamp ASC'
      const rows = limit
        ? this.db.prepare(sql).all(sessionId, limit)
        : this.db.prepare(sql).all(sessionId)
      return rows.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        attachments: this.parseJsonSafe<any[] | undefined>(row.attachments, undefined),
        toolName: row.tool_name,
        toolInput: this.parseJsonSafe<Record<string, unknown> | undefined>(row.tool_input, undefined),
        toolResult: row.tool_result,
        isError: !!row.is_error,
        thinkingText: row.thinking_text,
        usage: (row.usage_input_tokens || row.usage_output_tokens) ? {
          inputTokens: row.usage_input_tokens || 0,
          outputTokens: row.usage_output_tokens || 0,
        } : undefined,
        toolUseId: row.tool_use_id,
        fileChange: this.parseJsonSafe<any>(row.file_change, undefined),
      }))
    } catch (err) {
      console.warn('[Database] getConversationMessages error:', err)
      return []
    }
  }

  /**
   * 删除会话的所有对话消息
   */
  deleteConversationMessages(sessionId: string): void {
    if (!this.db) return
    try {
      this.db.prepare('DELETE FROM conversation_messages WHERE session_id = ?').run(sessionId)
    } catch (err) {
      console.warn('[Database] deleteConversationMessages error:', err)
    }
  }
}
