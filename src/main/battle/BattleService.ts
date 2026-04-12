/**
 * AI 对决模式服务 - 同一任务发给两个 AI 对比结果
 * 支持：创建对决、并行执行、投票、统计
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import type BetterSqlite3 from 'better-sqlite3'

export interface BattleResult {
  providerA: { providerId: string; providerName: string; response: string; tokenCount: number; duration: number }
  providerB: { providerId: string; providerName: string; response: string; tokenCount: number; duration: number }
}

export interface Battle {
  id: string
  prompt: string
  providerAId: string
  providerBId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result: BattleResult | null
  winner: 'A' | 'B' | 'tie' | null
  votes: { voterId: string; choice: 'A' | 'B' | 'tie'; comment: string }[]
  createdAt: string
  completedAt: string | null
}

export interface BattleStats {
  totalBattles: number
  providerWins: Record<string, number>
  averageDuration: number
  tieRate: number
}

const PROVIDER_NAMES: Record<string, string> = {
  'claude': 'Claude Code',
  'codex': 'Codex CLI',
  'gemini': 'Gemini CLI',
  'qwen': 'Qwen Coder',
  'opencode': 'OpenCode',
  'iflow': 'iFlow',
}

export class BattleService {
  private db: DatabaseManager
  private rawDb: BetterSqlite3.Database | null = null

  constructor(db: DatabaseManager) {
    this.db = db
    this.initDatabase()
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
      CREATE TABLE IF NOT EXISTS battles (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        provider_a_id TEXT NOT NULL,
        provider_b_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        winner TEXT,
        votes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        completed_at TEXT
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_battles_status ON battles(status)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_battles_created ON battles(created_at)`)
  }

  /** 创建对决 */
  async create(params: { prompt: string; providerAId: string; providerBId: string }): Promise<{ success: boolean; battle?: Battle; error?: string }> {
    const battle: Battle = {
      id: uuid(),
      prompt: params.prompt,
      providerAId: params.providerAId,
      providerBId: params.providerBId,
      status: 'pending',
      result: null,
      winner: null,
      votes: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    }

    try {
      const db = this.getRawDb()
      db.prepare(`
        INSERT INTO battles (id, prompt, provider_a_id, provider_b_id, status, result, winner, votes, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(battle.id, battle.prompt, battle.providerAId, battle.providerBId,
          battle.status, null, null, '[]', battle.createdAt, null)

      // 标记为 running
      battle.status = 'running'
      db.prepare('UPDATE battles SET status = ? WHERE id = ?').run('running', battle.id)

      return { success: true, battle }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 完成对决（由外部调用，当两个 AI 都返回后） */
  async complete(battleId: string, result: BattleResult): Promise<{ success: boolean; battle?: Battle }> {
    try {
      const db = this.getRawDb()
      db.prepare(`
        UPDATE battles SET status = 'completed', result = ?, completed_at = ?
        WHERE id = ?
      `).run(JSON.stringify(result), new Date().toISOString(), battleId)

      const battle = this.mapRow(db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as any)
      return { success: true, battle }
    } catch {
      return { success: true }
    }
  }

  /** 标记对决失败 */
  async fail(battleId: string): Promise<{ success: boolean }> {
    try {
      const db = this.getRawDb()
      db.prepare("UPDATE battles SET status = 'failed', completed_at = ? WHERE id = ?")
        .run(new Date().toISOString(), battleId)
      return { success: true }
    } catch {
      return { success: true }
    }
  }

  /** 获取对决 */
  async get(id: string): Promise<{ success: boolean; battle?: Battle }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM battles WHERE id = ?').get(id) as any
      if (!row) return { success: true }
      return { success: true, battle: this.mapRow(row) }
    } catch {
      return { success: true }
    }
  }

  /** 列出对决 */
  async list(limit?: number): Promise<{ success: boolean; battles: Battle[] }> {
    try {
      const db = this.getRawDb()
      const rows = db.prepare('SELECT * FROM battles ORDER BY created_at DESC LIMIT ?').all(limit || 50) as any[]
      return { success: true, battles: rows.map(r => this.mapRow(r)) }
    } catch {
      return { success: true, battles: [] }
    }
  }

  /** 投票 */
  async vote(battleId: string, voterId: string, choice: 'A' | 'B' | 'tie', comment?: string): Promise<{ success: boolean; battle?: Battle }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as any
      if (!row) return { success: false }

      const votes = JSON.parse(row.votes || '[]')
      // 同一投票者只能投一次
      const existingIdx = votes.findIndex((v: any) => v.voterId === voterId)
      if (existingIdx >= 0) {
        votes[existingIdx] = { voterId, choice, comment: comment || '' }
      } else {
        votes.push({ voterId, choice, comment: comment || '' })
      }

      // 统计胜者
      const aWins = votes.filter((v: any) => v.choice === 'A').length
      const bWins = votes.filter((v: any) => v.choice === 'B').length
      const winner = aWins > bWins ? 'A' : bWins > aWins ? 'B' : 'tie'

      db.prepare('UPDATE battles SET votes = ?, winner = ? WHERE id = ?')
        .run(JSON.stringify(votes), winner, battleId)

      const updated = this.mapRow(db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as any)
      return { success: true, battle: updated }
    } catch {
      return { success: true }
    }
  }

  /** 删除对决 */
  async delete(id: string): Promise<{ success: boolean }> {
    try {
      const db = this.getRawDb()
      db.prepare('DELETE FROM battles WHERE id = ?').run(id)
      return { success: true }
    } catch {
      return { success: true }
    }
  }

  /** 获取统计 */
  async getStats(): Promise<{ success: boolean; stats: BattleStats }> {
    try {
      const db = this.getRawDb()
      const rows = db.prepare('SELECT * FROM battles').all() as any[]
      const completed = rows.filter(r => r.status === 'completed')
      const providerWins: Record<string, number> = {}
      let totalDuration = 0
      let tieCount = 0

      for (const b of completed) {
        const winner = b.winner
        if (winner === 'A') {
          providerWins[b.provider_a_id] = (providerWins[b.provider_a_id] || 0) + 1
        } else if (winner === 'B') {
          providerWins[b.provider_b_id] = (providerWins[b.provider_b_id] || 0) + 1
        } else if (winner === 'tie') {
          tieCount++
        }

        // 从 result 中提取时长
        try {
          const result = JSON.parse(b.result || 'null')
          if (result) {
            totalDuration += (result.providerA?.duration || 0) + (result.providerB?.duration || 0)
          }
        } catch { /* ignore */ }
      }

      return {
        success: true,
        stats: {
          totalBattles: completed.length,
          providerWins,
          averageDuration: completed.length > 0 ? totalDuration / completed.length : 0,
          tieRate: completed.length > 0 ? tieCount / completed.length : 0,
        }
      }
    } catch {
      return { success: true, stats: { totalBattles: 0, providerWins: {}, averageDuration: 0, tieRate: 0 } }
    }
  }

  private mapRow(row: any): Battle {
    if (!row) return row
    return {
      id: row.id,
      prompt: row.prompt,
      providerAId: row.provider_a_id,
      providerBId: row.provider_b_id,
      status: row.status,
      result: typeof row.result === 'string' ? JSON.parse(row.result || 'null') : row.result,
      winner: row.winner,
      votes: typeof row.votes === 'string' ? JSON.parse(row.votes || '[]') : row.votes,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }
  }
}
