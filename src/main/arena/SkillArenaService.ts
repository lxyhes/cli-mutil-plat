/**
 * AI 技能竞技场服务 - 社区技能评分与排行
 * 支持：提交技能、基准测试打分、排行榜
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'

export interface ArenaSkill {
  id: string
  name: string
  author: string
  description: string
  category: string
  promptTemplate: string
  codeQualityScore: number    // 0-100
  executionSpeedScore: number // 0-100
  tokenEfficiencyScore: number // 0-100
  overallScore: number        // 加权平均
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

export class SkillArenaService {
  private db: DatabaseManager

  constructor(db: DatabaseManager) { this.db = db }

  /** 提交技能到竞技场 */
  async submit(params: { name: string; author: string; description: string; category: string; promptTemplate: string }): Promise<ArenaSkill> {
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

    this.db.run(`
      INSERT INTO arena_skills (id, name, author, description, category, prompt_template, code_quality_score, execution_speed_score, token_efficiency_score, overall_score, vote_count, up_votes, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [skill.id, skill.name, skill.author, skill.description, skill.category, skill.promptTemplate,
        skill.codeQualityScore, skill.executionSpeedScore, skill.tokenEfficiencyScore, skill.overallScore,
        skill.voteCount, skill.upVotes, skill.submittedAt])

    return skill
  }

  /** 列出竞技场技能 */
  async list(category?: string, limit?: number): Promise<ArenaSkill[]> {
    if (category) {
      return this.db.all<ArenaSkill>('SELECT * FROM arena_skills WHERE category = ? ORDER BY overall_score DESC LIMIT ?', [category, limit || 50])
    }
    return this.db.all<ArenaSkill>('SELECT * FROM arena_skills ORDER BY overall_score DESC LIMIT ?', [limit || 50])
  }

  /** 获取技能评分 */
  async getScores(skillId: string): Promise<ArenaSkill | null> {
    return this.db.get<ArenaSkill>('SELECT * FROM arena_skills WHERE id = ?', [skillId])
  }

  /** 获取排行榜 */
  async getLeaderboard(category?: string): Promise<LeaderboardEntry[]> {
    const skills = await this.list(category, 100)
    return skills.map((s, i) => ({
      rank: i + 1,
      skillId: s.id,
      name: s.name,
      author: s.author,
      category: s.category,
      overallScore: s.overallScore,
      voteCount: s.voteCount,
    }))
  }

  /** 投票 */
  async vote(skillId: string, up: boolean): Promise<void> {
    const skill = await this.getScores(skillId)
    if (!skill) return
    this.db.run('UPDATE arena_skills SET vote_count = ?, up_votes = ? WHERE id = ?',
      [skill.voteCount + 1, skill.upVotes + (up ? 1 : 0), skillId])
  }
}
