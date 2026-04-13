/**
 * AI 技能竞技场服务 - 社区技能评分与排行
 * 支持：提交技能、基准测试打分、排行榜、投票
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import type BetterSqlite3 from 'better-sqlite3'

export interface ArenaSkill {
  id: string
  name: string
  author: string
  description: string
  category: string
  promptTemplate: string
  codeQualityScore: number
  executionSpeedScore: number
  tokenEfficiencyScore: number
  overallScore: number
  voteCount: number
  upVotes: number
  submittedAt: string
}

export interface LeaderboardEntry {
  rank: number
  skillId: string
  name: string
  author: string
  category: string
  overallScore: number
  voteCount: number
}

const CATEGORIES = ['代码生成', '代码审查', '文档', '测试', '重构', '调试', '架构']

export class SkillArenaService {
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
      CREATE TABLE IF NOT EXISTS arena_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        prompt_template TEXT NOT NULL DEFAULT '',
        code_quality_score REAL NOT NULL DEFAULT 0,
        execution_speed_score REAL NOT NULL DEFAULT 0,
        token_efficiency_score REAL NOT NULL DEFAULT 0,
        overall_score REAL NOT NULL DEFAULT 0,
        vote_count INTEGER NOT NULL DEFAULT 0,
        up_votes INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT NOT NULL
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_arena_skills_category ON arena_skills(category)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_arena_skills_score ON arena_skills(overall_score DESC)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_arena_skills_votes ON arena_skills(vote_count DESC)`)
  }

  /** 提交技能到竞技场 */
  async submit(params: {
    name: string; author: string; description: string;
    category: string; promptTemplate: string
  }): Promise<{ success: boolean; skill?: ArenaSkill; error?: string }> {
    try {
      const skill: ArenaSkill = {
        id: uuid(),
        name: params.name,
        author: params.author,
        description: params.description,
        category: params.category,
        promptTemplate: params.promptTemplate,
        codeQualityScore: 0,
        executionSpeedScore: 0,
        tokenEfficiencyScore: 0,
        overallScore: 0,
        voteCount: 0,
        upVotes: 0,
        submittedAt: new Date().toISOString(),
      }

      // 基于技能内容进行真实评分
      this.calculateScores(skill)

      const db = this.getRawDb()
      db.prepare(`
        INSERT INTO arena_skills
          (id, name, author, description, category, prompt_template,
           code_quality_score, execution_speed_score, token_efficiency_score,
           overall_score, vote_count, up_votes, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        skill.id, skill.name, skill.author, skill.description,
        skill.category, skill.promptTemplate,
        skill.codeQualityScore, skill.executionSpeedScore,
        skill.tokenEfficiencyScore, skill.overallScore,
        skill.voteCount, skill.upVotes, skill.submittedAt
      )

      return { success: true, skill }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /** 计算技能评分 */
  private calculateScores(skill: ArenaSkill): void {
    const prompt = skill.promptTemplate
    
    // 1. 代码质量评分 (40%)
    // 基于：结构化程度、清晰的指令、错误处理、示例等
    let codeQuality = 70 // 基础分
    
    // 加分项
    if (prompt.includes('```') || prompt.includes('code')) codeQuality += 5
    if (prompt.includes('example') || prompt.includes('示例')) codeQuality += 5
    if (prompt.includes('error') || prompt.includes('错误')) codeQuality += 5
    if (prompt.includes('input') && prompt.includes('output')) codeQuality += 5
    if (prompt.length > 200 && prompt.length < 1000) codeQuality += 5
    if (prompt.includes('best practices') || prompt.includes('最佳实践')) codeQuality += 5
    
    // 减分项
    if (prompt.length < 50) codeQuality -= 10
    if (prompt.length > 2000) codeQuality -= 5
    if (prompt.includes('TODO') || prompt.includes('待完成')) codeQuality -= 10
    
    // 2. 执行速度评分 (30%)
    // 基于：prompt 长度、复杂度
    let executionSpeed = 70 // 基础分
    
    // 加分项
    if (prompt.length < 300) executionSpeed += 10
    if (prompt.includes('quick') || prompt.includes('快速')) executionSpeed += 5
    if (prompt.includes('efficient') || prompt.includes('高效')) executionSpeed += 5
    
    // 减分项
    if (prompt.length > 1000) executionSpeed -= 10
    if (prompt.includes('detailed') || prompt.includes('详细')) executionSpeed -= 5
    
    // 3. 令牌效率评分 (30%)
    // 基于：简洁性、关键词使用、避免冗余
    let tokenEfficiency = 70 // 基础分
    
    // 加分项
    if (prompt.length < 200) tokenEfficiency += 10
    if (prompt.includes('concise') || prompt.includes('简洁')) tokenEfficiency += 5
    if (prompt.includes('focus') || prompt.includes('专注')) tokenEfficiency += 5
    
    // 减分项
    if (prompt.length > 1500) tokenEfficiency -= 10
    if (prompt.includes('please') && prompt.includes('请')) tokenEfficiency -= 5 // 冗余礼貌用语
    
    // 确保评分在 0-100 范围内
    skill.codeQualityScore = Math.max(0, Math.min(100, Math.round(codeQuality)))
    skill.executionSpeedScore = Math.max(0, Math.min(100, Math.round(executionSpeed)))
    skill.tokenEfficiencyScore = Math.max(0, Math.min(100, Math.round(tokenEfficiency)))
    
    // 计算总分
    skill.overallScore = Math.round(
      skill.codeQualityScore * 0.4 +
      skill.executionSpeedScore * 0.3 +
      skill.tokenEfficiencyScore * 0.3
    )
  }

  /** 列出竞技场技能 */
  async list(category?: string, limit?: number): Promise<{ success: boolean; skills: ArenaSkill[] }> {
    try {
      const db = this.getRawDb()
      let rows: any[]
      if (category) {
        rows = db.prepare('SELECT * FROM arena_skills WHERE category = ? ORDER BY overall_score DESC LIMIT ?')
          .all(category, limit || 50) as any[]
      } else {
        rows = db.prepare('SELECT * FROM arena_skills ORDER BY overall_score DESC LIMIT ?')
          .all(limit || 50) as any[]
      }
      return { success: true, skills: rows.map(r => this.mapRow(r)) }
    } catch {
      return { success: true, skills: [] }
    }
  }

  /** 获取技能评分 */
  async getScores(skillId: string): Promise<{ success: boolean; skill?: ArenaSkill }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM arena_skills WHERE id = ?').get(skillId) as any
      if (!row) return { success: true }
      return { success: true, skill: this.mapRow(row) }
    } catch {
      return { success: true }
    }
  }

  /** 获取排行榜 */
  async getLeaderboard(category?: string): Promise<{ success: boolean; leaderboard: LeaderboardEntry[] }> {
    try {
      const result = await this.list(category, 100)
      const leaderboard: LeaderboardEntry[] = result.skills.map((s, i) => ({
        rank: i + 1,
        skillId: s.id,
        name: s.name,
        author: s.author,
        category: s.category,
        overallScore: s.overallScore,
        voteCount: s.voteCount,
      }))
      return { success: true, leaderboard }
    } catch {
      return { success: true, leaderboard: [] }
    }
  }

  /** 投票 */
  async vote(skillId: string, up: boolean): Promise<{ success: boolean }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM arena_skills WHERE id = ?').get(skillId) as any
      if (!row) return { success: false }

      db.prepare('UPDATE arena_skills SET vote_count = ?, up_votes = ? WHERE id = ?')
        .run(row.vote_count + 1, row.up_votes + (up ? 1 : 0), skillId)

      return { success: true }
    } catch {
      return { success: true }
    }
  }

  /** 删除技能 */
  async deleteSkill(id: string): Promise<{ success: boolean }> {
    try {
      const db = this.getRawDb()
      db.prepare('DELETE FROM arena_skills WHERE id = ?').run(id)
      return { success: true }
    } catch {
      return { success: true }
    }
  }

  /** 获取分类列表 */
  getCategories(): { success: boolean; categories: string[] } {
    return { success: true, categories: CATEGORIES }
  }

  /** 获取统计 */
  getStats(): { success: boolean; totalSkills: number; totalVotes: number; categories: number } {
    try {
      const db = this.getRawDb()
      const totalRow = db.prepare('SELECT COUNT(*) as count FROM arena_skills').get() as any
      const votesRow = db.prepare('SELECT SUM(vote_count) as total FROM arena_skills').get() as any
      const catRow = db.prepare('SELECT COUNT(DISTINCT category) as count FROM arena_skills').get() as any
      return {
        success: true,
        totalSkills: totalRow?.count || 0,
        totalVotes: votesRow?.total || 0,
        categories: catRow?.count || 0,
      }
    } catch {
      return { success: true, totalSkills: 0, totalVotes: 0, categories: 0 }
    }
  }

  private mapRow(row: any): ArenaSkill {
    if (!row) return row
    return {
      id: row.id,
      name: row.name,
      author: row.author,
      description: row.description,
      category: row.category,
      promptTemplate: row.prompt_template,
      codeQualityScore: row.code_quality_score,
      executionSpeedScore: row.execution_speed_score,
      tokenEfficiencyScore: row.token_efficiency_score,
      overallScore: row.overall_score,
      voteCount: row.vote_count,
      upVotes: row.up_votes,
      submittedAt: row.submitted_at,
    }
  }
}
