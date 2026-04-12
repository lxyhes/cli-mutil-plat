/**
 * 会话录像与回放服务 - 录制 AI 会话的完整操作过程
 * 支持：开始/停止录制、回放、导出
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'

export interface ReplayEvent {
  type: 'message' | 'tool_use' | 'file_change' | 'terminal_output' | 'permission' | 'checkpoint'
  timestamp: number
  sessionId: string
  data: any
}

export interface SessionReplay {
  id: string
  sessionId: string
  sessionName: string
  duration: number        // 秒
  eventCount: number
  keyMoments: { timestamp: number; label: string }[]
  status: 'recording' | 'completed' | 'exported'
  createdAt: string
  completedAt: string | null
}

export class SessionReplayService {
  private db: DatabaseManager
  private activeRecordings = new Map<string, { startTime: number; events: ReplayEvent[] }>()

  constructor(db: DatabaseManager) { this.db = db }

  /** 开始录制 */
  async startRecording(sessionId: string, sessionName: string): Promise<string> {
    const id = uuid()
    this.activeRecordings.set(sessionId, { startTime: Date.now(), events: [] })

    this.db.run(`
      INSERT INTO session_replays (id, session_id, session_name, duration, event_count, key_moments, status, created_at)
      VALUES (?, ?, ?, 0, 0, '[]', 'recording', ?)
    `, [id, sessionId, sessionName, new Date().toISOString()])

    return id
  }

  /** 停止录制 */
  async stopRecording(sessionId: string): Promise<SessionReplay | null> {
    const recording = this.activeRecordings.get(sessionId)
    if (!recording) return null

    const duration = Math.round((Date.now() - recording.startTime) / 1000)
    const keyMoments = this.extractKeyMoments(recording.events)

    // 批量存储事件
    const replayId = await this.getReplayIdBySession(sessionId)
    if (replayId) {
      for (const event of recording.events) {
        this.db.run(`
          INSERT INTO replay_events (id, replay_id, event_type, timestamp, session_id, data)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [uuid(), replayId, event.type, event.timestamp, event.sessionId, JSON.stringify(event.data)])
      }

      this.db.run(`
        UPDATE session_replays SET duration=?, event_count=?, key_moments=?, status='completed', completed_at=?
        WHERE id=?
      `, [duration, recording.events.length, JSON.stringify(keyMoments), new Date().toISOString(), replayId])
    }

    this.activeRecordings.delete(sessionId)

    return this.db.get<SessionReplay>('SELECT * FROM session_replays WHERE session_id = ? AND status != ? ORDER BY created_at DESC LIMIT 1', [sessionId, 'recording'])
  }

  /** 追加事件（由 SessionManagerV2 调用） */
  appendEvent(sessionId: string, event: Omit<ReplayEvent, 'timestamp' | 'sessionId'>): void {
    const recording = this.activeRecordings.get(sessionId)
    if (!recording) return
    recording.events.push({ ...event, timestamp: Date.now(), sessionId })
  }

  /** 获取录像 */
  async get(id: string): Promise<SessionReplay | null> {
    return this.db.get<SessionReplay>('SELECT * FROM session_replays WHERE id = ?', [id])
  }

  /** 列出录像 */
  async list(limit?: number): Promise<SessionReplay[]> {
    return this.db.all<SessionReplay>('SELECT * FROM session_replays ORDER BY created_at DESC LIMIT ?', [limit || 20])
  }

  /** 删除录像 */
  async delete(id: string): Promise<void> {
    this.db.run('DELETE FROM replay_events WHERE replay_id = ?', [id])
    this.db.run('DELETE FROM session_replays WHERE id = ?', [id])
  }

  /** 获取录像事件 */
  async getEvents(replayId: string): Promise<ReplayEvent[]> {
    const rows = this.db.all<{ event_type: string; timestamp: number; session_id: string; data: string }>(
      'SELECT * FROM replay_events WHERE replay_id = ? ORDER BY timestamp', [replayId]
    )
    return (rows || []).map(r => ({ type: r.event_type as any, timestamp: r.timestamp, sessionId: r.session_id, data: JSON.parse(r.data || '{}') }))
  }

  /** 导出录像 */
  async export(id: string): Promise<{ json: string } | null> {
    const replay = await this.get(id)
    if (!replay) return null
    const events = await this.getEvents(id)
    return { json: JSON.stringify({ ...replay, events }, null, 2) }
  }

  /** 提取关键时刻 */
  private extractKeyMoments(events: ReplayEvent[]): { timestamp: number; label: string }[] {
    const moments: { timestamp: number; label: string }[] = []
    for (const e of events) {
      if (e.type === 'checkpoint') moments.push({ timestamp: e.timestamp, label: '回溯点' })
      if (e.type === 'tool_use' && e.data?.toolName === 'Write') moments.push({ timestamp: e.timestamp, label: `写入 ${e.data.filePath || '文件'}` })
      if (e.type === 'file_change' && moments.length < 20) moments.push({ timestamp: e.timestamp, label: `文件变更: ${e.data.filePath || ''}` })
    }
    return moments.slice(0, 20)
  }

  private async getReplayIdBySession(sessionId: string): Promise<string | null> {
    const row = await this.db.get<{ id: string }>('SELECT id FROM session_replays WHERE session_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1', [sessionId, 'recording'])
    return row?.id || null
  }
}
