/**
 * AI 对决模式服务 - 同一任务发给两个 AI 并行执行对比结果
 * 支持：创建对决、并行执行、投票、统计
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import type { DatabaseManager } from '../storage/Database'
import type BetterSqlite3 from 'better-sqlite3'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { AIProvider } from '../../shared/types'
import { BUILTIN_PROVIDERS } from '../../shared/types'

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

// UI provider ID → actual provider ID
const PROVIDER_ID_MAP: Record<string, string> = {
  'claude':   'claude-code',
  'codex':    'codex',
  'gemini':   'gemini-cli',
  'qwen':     'qwen-coder',
  'opencode': 'opencode',
  'iflow':    'iflow',
}

const PROVIDER_NAMES: Record<string, string> = {
  'claude':   'Claude Code',
  'codex':    'Codex CLI',
  'gemini':   'Gemini CLI',
  'qwen':     'Qwen Coder',
  'opencode': 'OpenCode',
  'iflow':    'iFlow CLI',
}

export class BattleService {
  private db: DatabaseManager
  private rawDb: BetterSqlite3.Database | null = null
  private sessionManagerV2: SessionManagerV2 | null = null

  constructor(db: DatabaseManager) {
    this.db = db
    this.initDatabase()
  }

  /** 注入 SessionManagerV2（由主进程在服务创建后调用） */
  setSessionManager(sm: SessionManagerV2): void {
    this.sessionManagerV2 = sm
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

  /** 解析 provider ID（UI ID → actual provider ID） */
  private resolveProviderId(uiId: string): string {
    return PROVIDER_ID_MAP[uiId] || uiId
  }

  /** 获取 Provider 配置（优先用户自定义，回退内置） */
  private getProvider(providerId: string): AIProvider | undefined {
    const custom = this.db.getProvider(providerId)
    if (custom) return custom
    return BUILTIN_PROVIDERS.find(bp => bp.id === providerId)
  }

  /** 从会话对话历史中提取最后一条 assistant 消息文本 */
  private extractLastAssistantResponse(sessionId: string): string {
    const messages = this.db.getConversationMessages(sessionId)
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && m.content && typeof m.content === 'string') {
        return m.content
      }
    }
    return ''
  }

  /** 等待会话 turn_complete 或超时 */
  private waitForTurnComplete(sessionId: string, timeoutMs = 300000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.sessionManagerV2?.off('event', onEvent)
        reject(new Error('timeout'))
      }, timeoutMs)

      const onEvent = (sid: string, event: any) => {
        if (sid !== sessionId) return
        if (event.type === 'turn_complete') {
          clearTimeout(timer)
          this.sessionManagerV2?.off('event', onEvent)
          resolve()
        }
        if (event.type === 'status_change' && event.data?.status === 'completed') {
          clearTimeout(timer)
          this.sessionManagerV2?.off('event', onEvent)
          resolve()
        }
      }

      const session = this.sessionManagerV2?.getSession(sessionId)
      if (session?.status === 'completed' || session?.status === 'error') {
        clearTimeout(timer)
        this.sessionManagerV2?.off('event', onEvent)
        resolve()
        return
      }

      this.sessionManagerV2?.on('event', onEvent)
    })
  }

  /** 执行一场对决（并行调度两个 AI） */
  async execute(battleId: string, prompt: string, providerAId: string, providerBId: string): Promise<BattleResult | null> {
    const sm = this.sessionManagerV2
    if (!sm) {
      console.error('[BattleService] SessionManagerV2 not injected — battle cannot execute')
      return null
    }

    const actualA = this.resolveProviderId(providerAId)
    const actualB = this.resolveProviderId(providerBId)
    const providerA = this.getProvider(actualA)
    const providerB = this.getProvider(actualB)

    if (!providerA) { console.error('[BattleService] Provider A not found:', actualA); return null }
    if (!providerB) { console.error('[BattleService] Provider B not found:', actualB); return null }

    const sessionAId = `battle-${battleId}-A`
    const sessionBId = `battle-${battleId}-B`
    const workDir = process.cwd()

    const sessionAConfig = {
      id: sessionAId,
      name: `Battle-A [${PROVIDER_NAMES[providerAId] || actualA}]`,
      providerId: actualA,
      workingDirectory: workDir,
    }
    const sessionBConfig = {
      id: sessionBId,
      name: `Battle-B [${PROVIDER_NAMES[providerBId] || actualB}]`,
      providerId: actualB,
      workingDirectory: workDir,
    }

    const startTime = Date.now()

    try {
      console.log(`[BattleService] Creating sessions: ${sessionAId} vs ${sessionBId}`)
      const idA = sm.createSession(sessionAConfig, providerA)
      const idB = sm.createSession(sessionBConfig, providerB)

      // 等待两个会话就绪（等待 startup 完成）
      await Promise.all([
        this.waitForTurnComplete(idA, 60000).catch(() => {}),
        this.waitForTurnComplete(idB, 60000).catch(() => {}),
      ])

      // 发送 prompt（并行）
      console.log(`[BattleService] Sending prompts`)
      await Promise.allSettled([
        sm.sendMessage(idA, prompt),
        sm.sendMessage(idB, prompt),
      ])

      // 等待两个 turn 完成（各 5 分钟超时）
      await Promise.all([
        this.waitForTurnComplete(idA).catch(() => {}),
        this.waitForTurnComplete(idB).catch(() => {}),
      ])

      const duration = Date.now() - startTime

      // 提取结果
      const responseA = this.extractLastAssistantResponse(idA)
      const responseB = this.extractLastAssistantResponse(idB)

      // 清理对决会话
      try { sm.terminateSession(idA) } catch {}
      try { sm.terminateSession(idB) } catch {}

      const tokensA = Math.round(responseA.length / 4)
      const tokensB = Math.round(responseB.length / 4)

      const result: BattleResult = {
        providerA: { providerId: actualA, providerName: PROVIDER_NAMES[providerAId] || providerA.name, response: responseA, tokenCount: tokensA, duration },
        providerB: { providerId: actualB, providerName: PROVIDER_NAMES[providerBId] || providerB.name, response: responseB, tokenCount: tokensB, duration },
      }

      console.log(`[BattleService] Battle ${battleId} completed: A=${tokensA} tokens, B=${tokensB} tokens, ${duration}ms`)
      return result
    } catch (err) {
      console.error('[BattleService] Battle execution error:', err)
      try { sm.terminateSession(sessionAId) } catch {}
      try { sm.terminateSession(sessionBId) } catch {}
      return null
    }
  }

  /** 综合评分算法 */
  private calculateWinner(result: BattleResult): 'A' | 'B' | 'tie' {
    const scoreA = this.calculateScore(result.providerA.response, result.providerA.tokenCount, result.providerA.duration)
    const scoreB = this.calculateScore(result.providerB.response, result.providerB.tokenCount, result.providerB.duration)
    
    const threshold = 5 // 分数差阈值，小于此值视为平局
    if (scoreA > scoreB + threshold) return 'A'
    if (scoreB > scoreA + threshold) return 'B'
    return 'tie'
  }

  /** 计算单个 AI 的综合得分 */
  private calculateScore(response: string, tokenCount: number, duration: number): number {
    let score = 0
    
    // 1. 内容质量（40%）
    // - 代码块数量（每个 +20 分）
    const codeBlocks = (response.match(/```/g) || []).length / 2
    score += codeBlocks * 20
    
    // - 结构化程度（标题、列表等）
    const structureScore = this.calculateStructureScore(response)
    score += structureScore * 0.4
    
    // 2. 响应长度（20%）
    // - 适中长度最佳，过长或过短都有惩罚
    const lengthScore = this.calculateLengthScore(response.length)
    score += lengthScore * 0.2
    
    // 3. 令牌效率（20%）
    // - 单位令牌的内容长度
    if (tokenCount > 0) {
      const efficiency = response.length / tokenCount
      score += Math.min(efficiency * 10, 20) // 上限 20 分
    }
    
    // 4. 响应速度（20%）
    // - 越快越好，但有最低阈值
    const speedScore = this.calculateSpeedScore(duration)
    score += speedScore * 0.2
    
    return Math.round(score)
  }

  /** 计算结构得分 */
  private calculateStructureScore(response: string): number {
    let score = 0
    
    // 标题（#）
    if (response.includes('# ')) score += 5
    
    // 列表（- 或 *）
    if (response.includes('\n- ') || response.includes('\n* ')) score += 5
    
    // 粗体/斜体
    if (response.includes('**') || response.includes('*')) score += 3
    
    // 引用（>）
    if (response.includes('\n> ')) score += 3
    
    // 表格
    if (response.includes('|') && response.includes('-|-')) score += 10
    
    return score
  }

  /** 计算长度得分 */
  private calculateLengthScore(length: number): number {
    if (length < 50) return 0      // 过短
    if (length < 200) return 5     // 较短
    if (length < 1000) return 10   // 适中
    if (length < 3000) return 15   // 较长
    if (length < 5000) return 18   // 很长
    return 20                      // 超长
  }

  /** 计算速度得分 */
  private calculateSpeedScore(duration: number): number {
    const seconds = duration / 1000
    
    if (seconds < 5) return 20     // 非常快
    if (seconds < 15) return 18    // 很快
    if (seconds < 30) return 15    // 适中
    if (seconds < 60) return 10    // 较慢
    if (seconds < 120) return 5    // 很慢
    return 0                       // 极慢
  }

  /** 创建对决（异步触发执行） */catch (err) {
      console.error('[BattleService] Battle execution error:', err)
      try { sm.terminateSession(sessionAId) } catch {}
      try { sm.terminateSession(sessionBId) } catch {}
      return null
    }
  }

  /** 创建对决（异步触发执行） */
  async create(params: { prompt: string; providerAId: string; providerBId: string }): Promise<{ success: boolean; battle?: Battle; error?: string }> {
    const battleId = uuid()
    const battle: Battle = {
      id: battleId,
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

      db.prepare('UPDATE battles SET status = ? WHERE id = ?').run('running', battle.id)
      battle.status = 'running'

      // 异步执行对决（不阻塞 IPC）
      this.execute(battle.id, battle.prompt, battle.providerAId, battle.providerBId)
        .then((result) => {
          if (result) {
            // 综合评分算法
            const winner: 'A' | 'B' | 'tie' = this.calculateWinner(result)
            this.complete(battle.id, result, winner)
          } else {
            this.fail(battle.id)
          }
        })
        .catch(() => this.fail(battle.id))

      return { success: true, battle }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 完成对决 */
  async complete(battleId: string, result: BattleResult, winner: 'A' | 'B' | 'tie'): Promise<{ success: boolean; battle?: Battle }> {
    try {
      const db = this.getRawDb()
      db.prepare(`UPDATE battles SET status = 'completed', result = ?, winner = ?, completed_at = ? WHERE id = ?`)
        .run(JSON.stringify(result), winner, new Date().toISOString(), battleId)
      const row = db.prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as any
      return { success: true, battle: this.mapRow(row) }
    } catch {
      return { success: true }
    }
  }

  /** 标记对决失败 */
  async fail(battleId: string): Promise<{ success: boolean }> {
    try {
      this.getRawDb().prepare("UPDATE battles SET status = 'failed', completed_at = ? WHERE id = ?")
        .run(new Date().toISOString(), battleId)
      return { success: true }
    } catch {
      return { success: true }
    }
  }

  /** 获取对决 */
  async get(id: string): Promise<{ success: boolean; battle?: Battle }> {
    try {
      const row = this.getRawDb().prepare('SELECT * FROM battles WHERE id = ?').get(id) as any
      if (!row) return { success: true }
      return { success: true, battle: this.mapRow(row) }
    } catch {
      return { success: true }
    }
  }

  /** 列出对决 */
  async list(limit?: number): Promise<{ success: boolean; battles: Battle[] }> {
    try {
      const rows = this.getRawDb().prepare('SELECT * FROM battles ORDER BY created_at DESC LIMIT ?').all(limit || 50) as any[]
      return { success: true, battles: rows.map(r => this.mapRow(r)) }
    } catch {
      return { success: true, battles: [] }
    }
  }

  /** 投票 */
  async vote(battleId: string, voterId: string, choice: 'A' | 'B' | 'tie', comment?: string): Promise<{ success: boolean; battle?: Battle }> {
    try {
      const row = this.getRawDb().prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as any
      if (!row) return { success: false }

      const votes = JSON.parse(row.votes || '[]')
      const existingIdx = votes.findIndex((v: any) => v.voterId === voterId)
      if (existingIdx >= 0) {
        votes[existingIdx] = { voterId, choice, comment: comment || '' }
      } else {
        votes.push({ voterId, choice, comment: comment || '' })
      }

      const aWins = votes.filter((v: any) => v.choice === 'A').length
      const bWins = votes.filter((v: any) => v.choice === 'B').length
      const winner = aWins > bWins ? 'A' : bWins > aWins ? 'B' : 'tie'

      this.getRawDb().prepare('UPDATE battles SET votes = ?, winner = ? WHERE id = ?')
        .run(JSON.stringify(votes), winner, battleId)

      const updated = this.getRawDb().prepare('SELECT * FROM battles WHERE id = ?').get(battleId) as any
      return { success: true, battle: this.mapRow(updated) }
    } catch {
      return { success: true }
    }
  }

  /** 删除对决 */
  async delete(id: string): Promise<{ success: boolean }> {
    try {
      this.getRawDb().prepare('DELETE FROM battles WHERE id = ?').run(id)
      return { success: true }
    } catch {
      return { success: true }
    }
  }

  /** 获取统计 */
  async getStats(): Promise<{ success: boolean; stats: BattleStats }> {
    try {
      const rows = this.getRawDb().prepare('SELECT * FROM battles').all() as any[]
      const completed = rows.filter(r => r.status === 'completed')
      const providerWins: Record<string, number> = {}
      let totalDuration = 0
      let tieCount = 0

      for (const b of completed) {
        if (b.winner === 'A') providerWins[b.provider_a_id] = (providerWins[b.provider_a_id] || 0) + 1
        else if (b.winner === 'B') providerWins[b.provider_b_id] = (providerWins[b.provider_b_id] || 0) + 1
        else if (b.winner === 'tie') tieCount++

        try {
          const result = JSON.parse(b.result || 'null')
          if (result) totalDuration += (result.providerA?.duration || 0) + (result.providerB?.duration || 0)
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
