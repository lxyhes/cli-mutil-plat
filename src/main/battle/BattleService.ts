/**
 * AI 对决模式服务 - 同一任务发给两个 AI 对比结果
 * 支持：创建对决、投票、统计
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'

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

export class BattleService {
  private db: DatabaseManager

  constructor(db: DatabaseManager) { this.db = db }

  /** 创建对决 */
  async create(params: { prompt: string; providerAId: string; providerBId: string }): Promise<Battle> {
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

    this.db.run(`
      INSERT INTO battles (id, prompt, provider_a_id, provider_b_id, status, result, winner, votes, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [battle.id, battle.prompt, battle.providerAId, battle.providerBId,
        battle.status, null, null, '[]', battle.createdAt, null])

    // TODO: 通过 SessionManagerV2 并行创建两个会话执行 prompt
    battle.status = 'running'
    this.db.run('UPDATE battles SET status = ? WHERE id = ?', ['running', battle.id])

    return battle
  }

  /** 获取对决 */
  async get(id: string): Promise<Battle | null> {
    return this.db.get<Battle>('SELECT * FROM battles WHERE id = ?', [id])
  }

  /** 列出对决 */
  async list(limit?: number): Promise<Battle[]> {
    return this.db.all<Battle>('SELECT * FROM battles ORDER BY created_at DESC LIMIT ?', [limit || 20])
  }

  /** 投票 */
  async vote(battleId: string, voterId: string, choice: 'A' | 'B' | 'tie', comment?: string): Promise<void> {
    const battle = await this.get(battleId)
    if (!battle) return

    const votes = [...battle.votes, { voterId, choice, comment: comment || '' }]
    // 统计胜者
    const aWins = votes.filter(v => v.choice === 'A').length
    const bWins = votes.filter(v => v.choice === 'B').length
    const winner = aWins > bWins ? 'A' : bWins > aWins ? 'B' : 'tie'

    this.db.run('UPDATE battles SET votes = ?, winner = ? WHERE id = ?',
      [JSON.stringify(votes), winner, battleId])
  }

  /** 删除对决 */
  async delete(id: string): Promise<void> {
    this.db.run('DELETE FROM battles WHERE id = ?', [id])
  }

  /** 获取统计 */
  async getStats(): Promise<BattleStats> {
    const battles = await this.list(1000)
    const providerWins: Record<string, number> = {}
    let totalDuration = 0

    for (const b of battles) {
      if (b.status !== 'completed') continue
      if (b.winner === 'A') { providerWins[b.providerAId] = (providerWins[b.providerAId] || 0) + 1 }
      if (b.winner === 'B') { providerWins[b.providerBId] = (providerWins[b.providerBId] || 0) + 1 }
    }

    return {
      totalBattles: battles.filter(b => b.status === 'completed').length,
      providerWins,
      averageDuration: totalDuration / (battles.length || 1),
      tieRate: battles.filter(b => b.winner === 'tie').length / (battles.length || 1),
    }
  }
}
