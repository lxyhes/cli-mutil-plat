/**
 * 会话录像与回放服务 - 录制 AI 会话的完整操作过程
 * 支持：开始/停止录制、回放、导出、自动录制
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import type BetterSqlite3 from 'better-sqlite3'

export interface ReplayEvent {
  type: 'message' | 'tool_use' | 'file_change' | 'terminal_output' | 'permission' | 'checkpoint' | 'status_change' | 'usage'
  timestamp: number
  sessionId: string
  data: any
}

export interface SessionReplay {
  id: string
  sessionId: string
  sessionName: string
  duration: number
  eventCount: number
  keyMoments: { timestamp: number; label: string }[]
  status: 'recording' | 'completed' | 'exported'
  createdAt: string
  completedAt: string | null
}

export interface ReplaySettings {
  autoRecordEnabled: boolean
  maxDuration: number  // 最大录制时长（秒），0 表示无限制
  captureEvents: string[]  // 要录制的事件类型
}

const DEFAULT_SETTINGS: ReplaySettings = {
  autoRecordEnabled: true,
  maxDuration: 3600,  // 默认1小时
  captureEvents: ['message', 'tool_use', 'file_change', 'permission', 'status_change', 'usage']
}

export class SessionReplayService {
  private db: DatabaseManager
  private rawDb: BetterSqlite3.Database | null = null
  private activeRecordings = new Map<string, { startTime: number; events: ReplayEvent[]; replayId: string }>()
  private settings: ReplaySettings = { ...DEFAULT_SETTINGS }

  constructor(db: DatabaseManager) {
    this.db = db
    this.initDatabase()
    this.loadSettings()
  }

  private getRawDb(): BetterSqlite3.Database {
    if (!this.rawDb) {
      this.rawDb = (this.db as any).db as BetterSqlite3.Database
    }
    return this.rawDb!
  }

  /** 初始化数据库表 */
  private initDatabase(): void {
    const db = this.getRawDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_replays (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        session_name TEXT NOT NULL DEFAULT '',
        duration INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        key_moments TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'recording',
        created_at TEXT NOT NULL,
        completed_at TEXT
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS replay_events (
        id TEXT PRIMARY KEY,
        replay_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (replay_id) REFERENCES session_replays(id) ON DELETE CASCADE
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_replay_events_replay_id ON replay_events(replay_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_replay_events_timestamp ON replay_events(timestamp)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_session_replays_session_id ON session_replays(session_id)`)

    // 设置表
    db.exec(`
      CREATE TABLE IF NOT EXISTS replay_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  }

  private loadSettings(): void {
    try {
      const db = this.getRawDb()
      const row = db.prepare("SELECT value FROM replay_settings WHERE key = 'settings'").get() as any
      if (row?.value) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) }
      }
    } catch { /* use defaults */ }
  }

  private saveSettings(): void {
    try {
      const db = this.getRawDb()
      db.prepare("INSERT OR REPLACE INTO replay_settings (key, value) VALUES ('settings', ?)")
        .run(JSON.stringify(this.settings))
    } catch { /* ignore */ }
  }

  getSettings(): ReplaySettings {
    return { ...this.settings }
  }

  updateSettings(updates: Partial<ReplaySettings>): void {
    this.settings = { ...this.settings, ...updates }
    this.saveSettings()
  }

  /** 开始录制 */
  async startRecording(sessionId: string, sessionName: string): Promise<{ success: boolean; replayId?: string; error?: string }> {
    if (this.activeRecordings.has(sessionId)) {
      return { success: false, error: '该会话已在录制中' }
    }

    const id = uuid()
    this.activeRecordings.set(sessionId, { startTime: Date.now(), events: [], replayId: id })

    try {
      const db = this.getRawDb()
      db.prepare(`
        INSERT INTO session_replays (id, session_id, session_name, duration, event_count, key_moments, status, created_at)
        VALUES (?, ?, ?, 0, 0, '[]', 'recording', ?)
      `).run(id, sessionId, sessionName, new Date().toISOString())

      return { success: true, replayId: id }
    } catch (err: any) {
      this.activeRecordings.delete(sessionId)
      return { success: false, error: err.message }
    }
  }

  /** 停止录制 */
  async stopRecording(sessionId: string): Promise<{ success: boolean; replay?: SessionReplay; error?: string }> {
    const recording = this.activeRecordings.get(sessionId)
    if (!recording) return { success: false, error: '该会话未在录制中' }

    const duration = Math.round((Date.now() - recording.startTime) / 1000)
    const keyMoments = this.extractKeyMoments(recording.events)
    const replayId = recording.replayId

    try {
      const db = this.getRawDb()
      const insertStmt = db.prepare(`
        INSERT INTO replay_events (id, replay_id, event_type, timestamp, session_id, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      // 批量插入事件（事务）
      const insertMany = db.transaction((events: ReplayEvent[]) => {
        for (const event of events) {
          insertStmt.run(uuid(), replayId, event.type, event.timestamp, event.sessionId, JSON.stringify(event.data))
        }
      })
      insertMany(recording.events)

      db.prepare(`
        UPDATE session_replays SET duration=?, event_count=?, key_moments=?, status='completed', completed_at=?
        WHERE id=?
      `).run(duration, recording.events.length, JSON.stringify(keyMoments), new Date().toISOString(), replayId)

      this.activeRecordings.delete(sessionId)

      const replay = this.mapRow(db.prepare('SELECT * FROM session_replays WHERE id = ?').get(replayId) as any)
      return { success: true, replay }
    } catch (err: any) {
      this.activeRecordings.delete(sessionId)
      return { success: false, error: err.message }
    }
  }

  /** 追加事件（由 index.ts 中的事件监听调用） */
  appendEvent(sessionId: string, event: Omit<ReplayEvent, 'timestamp' | 'sessionId'>): void {
    const recording = this.activeRecordings.get(sessionId)
    if (!recording) return

    // 检查事件类型是否在录制范围内
    if (this.settings.captureEvents.length > 0 && !this.settings.captureEvents.includes(event.type)) {
      return
    }

    // 检查最大录制时长
    if (this.settings.maxDuration > 0) {
      const elapsed = (Date.now() - recording.startTime) / 1000
      if (elapsed > this.settings.maxDuration) {
        this.stopRecording(sessionId)
        return
      }
    }

    recording.events.push({ ...event, timestamp: Date.now(), sessionId })

    // 内存中最多保留 5000 事件，超过则自动停止
    if (recording.events.length >= 5000) {
      this.stopRecording(sessionId)
    }
  }

  /** 检查会话是否在录制中 */
  isRecording(sessionId: string): boolean {
    return this.activeRecordings.has(sessionId)
  }

  /** 获取录像 */
  async get(id: string): Promise<{ success: boolean; replay?: SessionReplay }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM session_replays WHERE id = ?').get(id) as any
      if (!row) return { success: true }
      return { success: true, replay: this.mapRow(row) }
    } catch {
      return { success: true }
    }
  }

  /** 列出录像 */
  async list(limit?: number): Promise<{ success: boolean; replays: SessionReplay[] }> {
    try {
      const db = this.getRawDb()
      const rows = db.prepare('SELECT * FROM session_replays ORDER BY created_at DESC LIMIT ?').all(limit || 50) as any[]
      return { success: true, replays: rows.map(r => this.mapRow(r)) }
    } catch {
      return { success: true, replays: [] }
    }
  }

  /** 删除录像 */
  async delete(id: string): Promise<{ success: boolean }> {
    try {
      const db = this.getRawDb()
      db.prepare('DELETE FROM replay_events WHERE replay_id = ?').run(id)
      db.prepare('DELETE FROM session_replays WHERE id = ?').run(id)
      return { success: true }
    } catch {
      return { success: true }
    }
  }

  /** 获取录像事件 */
  async getEvents(replayId: string): Promise<{ success: boolean; events: ReplayEvent[] }> {
    try {
      const db = this.getRawDb()
      const rows = db.prepare('SELECT * FROM replay_events WHERE replay_id = ? ORDER BY timestamp').all(replayId) as any[]
      const events: ReplayEvent[] = rows.map(r => ({
        type: r.event_type,
        timestamp: r.timestamp,
        sessionId: r.session_id,
        data: JSON.parse(r.data || '{}')
      }))
      return { success: true, events }
    } catch {
      return { success: true, events: [] }
    }
  }

  /** 导出录像 */
  async export(id: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM session_replays WHERE id = ?').get(id) as any
      if (!row) return { success: false, error: '录像不存在' }
      const replay = this.mapRow(row)
      const eventsResult = await this.getEvents(id)
      return { success: true, data: { ...replay, events: eventsResult.events } }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 提取关键时刻 */
  private extractKeyMoments(events: ReplayEvent[]): { timestamp: number; label: string }[] {
    const moments: { timestamp: number; label: string }[] = []
    for (const e of events) {
      if (moments.length >= 30) break
      if (e.type === 'checkpoint') {
        moments.push({ timestamp: e.timestamp, label: '回溯点' })
      }
      if (e.type === 'tool_use') {
        const toolName = e.data?.toolName || e.data?.name || '工具'
        moments.push({ timestamp: e.timestamp, label: `调用 ${toolName}` })
      }
      if (e.type === 'file_change') {
        const filePath = e.data?.filePath || e.data?.path || '文件'
        moments.push({ timestamp: e.timestamp, label: `文件变更: ${filePath.split('/').pop()}` })
      }
      if (e.type === 'permission') {
        moments.push({ timestamp: e.timestamp, label: '权限请求' })
      }
      if (e.type === 'status_change' && e.data?.status === 'completed') {
        moments.push({ timestamp: e.timestamp, label: 'AI 回复完成' })
      }
    }
    return moments
  }

  private mapRow(row: any): SessionReplay {
    if (!row) return row
    return {
      id: row.id,
      sessionId: row.session_id,
      sessionName: row.session_name,
      duration: row.duration,
      eventCount: row.event_count,
      keyMoments: typeof row.key_moments === 'string' ? JSON.parse(row.key_moments) : row.key_moments,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at
    }
  }
}
