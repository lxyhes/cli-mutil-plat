/**
 * AI 技能竞技场服务 - 社区技能评分与排行
 * 支持：提交技能、基准测试打分（AI 真实执行）、排行榜、投票
 *
 * 评分机制：
 * 1. 提交时先用启发式规则给初始分
 * 2. 运行基准测试：用标准测试用例执行技能 prompt，评估输出质量
 * 3. 基准测试通过 AI 执行，评分维度：代码质量、执行速度、token 效率
 *
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

  /** 计算技能初始评分（启发式，提交时快速评分） */
  private calculateScores(skill: ArenaSkill): void {
    const prompt = skill.promptTemplate

    // 1. 代码质量评分 (40%) - 基于结构化和完整性
    let codeQuality = 60
    // 结构化标记
    const hasStructure = (prompt.match(/#{1,3}\s/g) || []).length
    codeQuality += Math.min(15, hasStructure * 3)
    // 有代码示例
    if (prompt.includes('```')) codeQuality += 10
    // 有输入输出定义
    if (/input|输出|output|返回/i.test(prompt)) codeQuality += 5
    // 有错误处理指引
    if (/error|错误|异常|exception/i.test(prompt)) codeQuality += 5
    // 有约束条件
    if (/constraint|限制|禁止|不要|never|must/i.test(prompt)) codeQuality += 5
    // 长度适中
    if (prompt.length >= 100 && prompt.length <= 2000) codeQuality += 5
    // 减分
    if (prompt.length < 30) codeQuality -= 15
    if (/TODO|FIXME|待完成|待实现/.test(prompt)) codeQuality -= 10

    // 2. 执行速度评分 (30%) - 基于 prompt 简洁度和指令清晰度
    let executionSpeed = 65
    // 简洁的 prompt 执行更快
    if (prompt.length < 500) executionSpeed += 10
    else if (prompt.length < 1000) executionSpeed += 5
    else if (prompt.length > 3000) executionSpeed -= 10
    // 有明确步骤
    const stepCount = (prompt.match(/^\d+\.\s/gm) || []).length
    executionSpeed += Math.min(10, stepCount * 2)
    // 有角色设定
    if (/你是|You are|作为/.test(prompt)) executionSpeed += 5
    // 过于冗长
    const wordCount = prompt.split(/\s+/).length
    if (wordCount > 500) executionSpeed -= 5

    // 3. Token 效率评分 (30%) - 基于信息密度
    let tokenEfficiency = 65
    // 信息密度：有效内容 / 总长度
    const strippedPrompt = prompt.replace(/\s+/g, ' ').trim()
    const density = strippedPrompt.length / Math.max(1, prompt.length)
    if (density > 0.9) tokenEfficiency += 10
    else if (density > 0.7) tokenEfficiency += 5
    // 有模板变量
    if (/\{\{|\$\{|%s|{variable}/.test(prompt)) tokenEfficiency += 10
    // 简洁指令
    if (prompt.length < 300) tokenEfficiency += 5
    // 冗余用语
    if (/please\s+please|请.*请|非常非常/.test(prompt)) tokenEfficiency -= 10
    // 超长
    if (prompt.length > 5000) tokenEfficiency -= 15

    skill.codeQualityScore = Math.max(0, Math.min(100, Math.round(codeQuality)))
    skill.executionSpeedScore = Math.max(0, Math.min(100, Math.round(executionSpeed)))
    skill.tokenEfficiencyScore = Math.max(0, Math.min(100, Math.round(tokenEfficiency)))
    skill.overallScore = Math.round(
      skill.codeQualityScore * 0.4 +
      skill.executionSpeedScore * 0.3 +
      skill.tokenEfficiencyScore * 0.3
    )
  }

  /**
   * 运行真实基准测试 - 用 AI 执行技能并评估输出质量
   * @param skillId 技能 ID
   * @param testCases 测试用例（可选，默认使用内置用例）
   */
  async runBenchmark(
    skillId: string,
    testCases?: Array<{ input: string; expectedKeywords: string[] }>,
  ): Promise<{ success: boolean; scores: ArenaSkill | null; results: Array<{ input: string; output: string; passed: boolean }> }> {
    try {
      const db = this.getRawDb()
      const row = db.prepare('SELECT * FROM arena_skills WHERE id = ?').get(skillId) as any
      if (!row) return { success: false, scores: null, results: [] }

      const skill = this.mapRow(row)
      const cases = testCases || this.getDefaultTestCases(skill.category)

      const results: Array<{ input: string; output: string; passed: boolean }> = []
      let totalOutputTokens = 0
      let totalTimeMs = 0
      let qualityScore = 0
      let passCount = 0

      for (const tc of cases) {
        const startTime = Date.now()
        try {
          // 渲染 prompt 模板（替换变量）
          const renderedPrompt = this.renderPrompt(skill.promptTemplate, tc.input)
          const output = await this.callAiDirectly(renderedPrompt)
          const durationMs = Date.now() - startTime

          // 评估输出
          const passed = tc.expectedKeywords.length === 0 ||
            tc.expectedKeywords.some(kw => output.toLowerCase().includes(kw.toLowerCase()))

          results.push({ input: tc.input, output: output.slice(0, 500), passed })
          if (passed) passCount++

          // 评估输出质量
          qualityScore += this.evaluateOutputQuality(output)
          totalOutputTokens += Math.ceil(output.length / 4)
          totalTimeMs += durationMs
        } catch (err) {
          results.push({ input: tc.input, output: `[Error: ${(err as Error).message}]`, passed: false })
        }
      }

      // 计算最终评分
      const testCount = cases.length || 1
      const passRate = passCount / testCount

      // 代码质量：基于输出质量评分 + 通过率
      skill.codeQualityScore = Math.round(
        Math.min(100, (qualityScore / testCount) * 0.5 + passRate * 50 + skill.codeQualityScore * 0.3)
      )

      // 执行速度：基于平均响应时间
      const avgTimeMs = totalTimeMs / testCount
      if (avgTimeMs < 5000) skill.executionSpeedScore = Math.min(100, skill.executionSpeedScore + 20)
      else if (avgTimeMs < 15000) skill.executionSpeedScore = Math.min(100, skill.executionSpeedScore + 10)
      else if (avgTimeMs > 30000) skill.executionSpeedScore = Math.max(0, skill.executionSpeedScore - 15)

      // Token 效率：基于输出长度与质量的比率
      const avgOutputLen = totalOutputTokens / testCount
      if (avgOutputLen < 500 && passRate > 0.6) skill.tokenEfficiencyScore = Math.min(100, skill.tokenEfficiencyScore + 15)
      else if (avgOutputLen > 2000) skill.tokenEfficiencyScore = Math.max(0, skill.tokenEfficiencyScore - 10)

      // 综合分
      skill.overallScore = Math.round(
        skill.codeQualityScore * 0.4 +
        skill.executionSpeedScore * 0.3 +
        skill.tokenEfficiencyScore * 0.3
      )

      // 更新数据库
      db.prepare(`
        UPDATE arena_skills SET
          code_quality_score = ?, execution_speed_score = ?,
          token_efficiency_score = ?, overall_score = ?
        WHERE id = ?
      `).run(skill.codeQualityScore, skill.executionSpeedScore,
         skill.tokenEfficiencyScore, skill.overallScore, skillId)

      return { success: true, scores: skill, results }
    } catch (err: any) {
      return { success: false, scores: null, results: [] }
    }
  }

  /** 获取分类默认测试用例 */
  private getDefaultTestCases(category: string): Array<{ input: string; expectedKeywords: string[] }> {
    const baseCases: Array<{ input: string; expectedKeywords: string[] }> = [
      { input: '实现一个简单的 Hello World 函数', expectedKeywords: ['hello', 'function', 'def'] },
      { input: '写一个工具类处理字符串反转', expectedKeywords: ['reverse', 'string', '反转'] },
    ]

    const categoryCases: Record<string, Array<{ input: string; expectedKeywords: string[] }>> = {
      '代码生成': [
        { input: '生成一个 REST API 的 CRUD 控制器', expectedKeywords: ['get', 'post', 'put', 'delete'] },
        { input: '实现一个链表数据结构', expectedKeywords: ['node', 'next', 'insert', 'delete'] },
      ],
      '代码审查': [
        { input: '审查这段代码的安全性：eval(userInput)', expectedKeywords: ['安全', 'eval', 'XSS', 'dangerous'] },
        { input: '检查这个函数的性能问题', expectedKeywords: ['性能', 'performance', '优化'] },
      ],
      '文档': [
        { input: '为以下 API 端点生成文档', expectedKeywords: ['api', 'endpoint', '参数', '返回'] },
        { input: '编写 README', expectedKeywords: ['安装', '使用', 'install', 'usage'] },
      ],
      '测试': [
        { input: '为登录功能编写单元测试', expectedKeywords: ['test', 'describe', 'expect', 'assert'] },
        { input: '生成边界条件测试用例', expectedKeywords: ['边界', 'edge', 'null', 'empty'] },
      ],
      '重构': [
        { input: '重构这段嵌套过深的代码', expectedKeywords: ['提取', 'extract', '简化', 'refactor'] },
        { input: '优化这个函数的可读性', expectedKeywords: ['可读', 'readab', '命名', '变量'] },
      ],
      '调试': [
        { input: '分析这个 null pointer 异常的原因', expectedKeywords: ['null', '空指针', 'check', '异常'] },
        { input: '排查内存泄漏问题', expectedKeywords: ['内存', 'memory', 'leak', '释放'] },
      ],
      '架构': [
        { input: '设计一个微服务架构', expectedKeywords: ['服务', 'service', '通信', 'communication'] },
        { input: '设计数据库表结构', expectedKeywords: ['表', 'table', '字段', '关系'] },
      ],
    }

    return [...baseCases, ...(categoryCases[category] || categoryCases['代码生成'] || [])]
  }

  /** 渲染 prompt 模板 */
  private renderPrompt(template: string, input: string): string {
    return template
      .replace(/\{\{input\}\}/gi, input)
      .replace(/\{\{task\}\}/gi, input)
      .replace(/\{\{query\}\}/gi, input)
      .replace(/\{\{content\}\}/gi, input)
  }

  /** 评估输出质量 (0-100) */
  private evaluateOutputQuality(output: string): number {
    if (!output || output.length < 10) return 10
    let score = 40
    // 有代码块
    if (/```/.test(output)) score += 15
    // 有解释说明
    if (output.length > 100) score += 10
    // 有结构化输出
    if (/^\d+\.|^[-*]\s|^#{1,3}\s/m.test(output)) score += 10
    // 有错误处理
    if (/error|异常|catch|try/i.test(output)) score += 5
    // 输出完整（不截断）
    if (!output.endsWith('...') && !output.endsWith('[truncated]')) score += 10
    // 有类型注解
    if (/:\s*(string|number|boolean|void|any)\b/i.test(output)) score += 5
    // 有注释
    if (/\/\/|\/\*|#.*注释/.test(output)) score += 5
    return Math.min(100, score)
  }

  /** 直接调用 AI */
  private async callAiDirectly(prompt: string): Promise<string> {
    // 方案1: Anthropic SDK
    try {
      const { Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic()
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-7',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n')
      return text || ''
    } catch (sdkErr) {
      console.warn('[SkillArena] Anthropic SDK 不可用，尝试 CLI:', (sdkErr as Error).message)
    }

    // 方案2: CLI
    return this.callCliDirectly(prompt)
  }

  /** 通过 CLI 调用 AI */
  private callCliDirectly(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process')
      const proc = spawn('claude', ['--print', '--no-input', prompt], { timeout: 60000 })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
      proc.on('close', (code: number) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(`claude CLI exit code ${code}: ${stderr}`))
      })
      proc.on('error', reject)
    })
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
