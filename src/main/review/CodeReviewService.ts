/**
 * AI 代码审查员服务 - 自动触发 Code Review
 * 支持：启动审查、获取结果、行内标注、一键修复、自动审查
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import { FileChangeTracker } from '../tracker/FileChangeTracker'
import type { GitWorktreeService } from '../git/GitWorktreeService'
import type { CodeGraphService } from '../code-graph/CodeGraphService'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import * as fs from 'fs'
import * as path from 'path'

export interface ReviewComment {
  id: string
  reviewId: string
  filePath: string
  lineStart: number
  lineEnd: number
  severity: 'info' | 'warning' | 'error' | 'suggestion'
  category: 'bug' | 'security' | 'performance' | 'style' | 'best-practice' | 'architecture'
  message: string
  suggestion: string   // AI 建议的修复代码
  resolved: boolean
  createdAt: string
}

export interface CodeReview {
  id: string
  sessionId: string
  sessionName: string
  reviewerSessionId: string | null  // 审查者的会话 ID（如果用子 Agent 审查）
  repoPath: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  targetFiles: string[]   // 空 = 全部改动文件
  summary: string
  score: number           // 0-100
  totalComments: number
  criticalCount: number
  createdAt: string
  completedAt: string | null
}

export class CodeReviewService {
  private rawDb: any
  private fileChangeTracker: FileChangeTracker | null
  private gitService: GitWorktreeService | null
  private codeGraphService: CodeGraphService | null
  /** 是否在 turn_complete 时自动审查 */
  private autoReviewEnabled = false
  /** 节流：记录每个会话最近一次审查时间 */
  private lastReviewTime = new Map<string, number>()
  /** 审查间隔（毫秒），默认 5 分钟 */
  private autoReviewInterval = 5 * 60 * 1000
  /** AI 审查模式：'rule-only' | 'ai-enhanced' */
  private reviewMode: 'rule-only' | 'ai-enhanced' = 'ai-enhanced'

  constructor(db: DatabaseManager, fileChangeTracker?: FileChangeTracker, gitService?: GitWorktreeService, codeGraphService?: CodeGraphService) {
    this.rawDb = (db as any).db || db
    this.fileChangeTracker = fileChangeTracker || null
    this.gitService = gitService || null
    this.codeGraphService = codeGraphService || null
    this.ensureTable()
    this.loadSettings()
  }

  /** 创建 code_reviews 和 review_comments 表 */
  private ensureTable(): void {
    try {
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS code_reviews (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          session_name TEXT NOT NULL,
          reviewer_session_id TEXT,
          repo_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          target_files TEXT NOT NULL DEFAULT '[]',
          summary TEXT NOT NULL DEFAULT '',
          score INTEGER NOT NULL DEFAULT 0,
          total_comments INTEGER NOT NULL DEFAULT 0,
          critical_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          completed_at TEXT
        )
      `)
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS review_comments (
          id TEXT PRIMARY KEY,
          review_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          line_start INTEGER NOT NULL DEFAULT 0,
          line_end INTEGER NOT NULL DEFAULT 0,
          severity TEXT NOT NULL DEFAULT 'info',
          category TEXT NOT NULL DEFAULT 'style',
          message TEXT NOT NULL DEFAULT '',
          suggestion TEXT NOT NULL DEFAULT '',
          resolved INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
      `)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_session ON code_reviews(session_id, created_at DESC)`)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_comments_review ON review_comments(review_id, created_at)`)
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS code_review_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
    } catch (err) {
      console.error('[CodeReviewService] ensureTable failed:', err)
    }
  }

  private loadSettings(): void {
    try {
      const row = this.rawDb.prepare("SELECT value FROM code_review_settings WHERE key = 'settings'").get() as any
      if (row?.value) {
        const settings = JSON.parse(row.value)
        if (settings.autoReviewEnabled !== undefined) this.autoReviewEnabled = settings.autoReviewEnabled
        if (settings.autoReviewInterval) this.autoReviewInterval = settings.autoReviewInterval
        if (settings.reviewMode) this.reviewMode = settings.reviewMode
      }
    } catch { /* ignore */ }
  }

  private saveSettings(): void {
    try {
      const value = JSON.stringify({
        autoReviewEnabled: this.autoReviewEnabled,
        autoReviewInterval: this.autoReviewInterval,
        reviewMode: this.reviewMode,
      })
      this.rawDb.prepare(`
        INSERT INTO code_review_settings (key, value) VALUES ('settings', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(value)
    } catch (err) {
      console.error('[CodeReviewService] saveSettings failed:', err)
    }
  }

  isAutoReviewEnabled(): boolean { return this.autoReviewEnabled }

  setAutoReviewEnabled(enabled: boolean): void {
    this.autoReviewEnabled = enabled
    this.saveSettings()
  }

  /** 行 → 对象映射 */
  private mapReviewRow(row: any): CodeReview {
    return {
      id: row.id,
      sessionId: row.session_id,
      sessionName: row.session_name,
      reviewerSessionId: row.reviewer_session_id,
      repoPath: row.repo_path,
      status: row.status,
      targetFiles: typeof row.target_files === 'string' ? JSON.parse(row.target_files || '[]') : (row.target_files || []),
      summary: row.summary,
      score: row.score,
      totalComments: row.total_comments,
      criticalCount: row.critical_count,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }
  }

  private mapCommentRow(row: any): ReviewComment {
    return {
      id: row.id,
      reviewId: row.review_id,
      filePath: row.file_path,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      severity: row.severity,
      category: row.category,
      message: row.message,
      suggestion: row.suggestion,
      resolved: !!row.resolved,
      createdAt: row.created_at,
    }
  }

  /** 启动代码审查 */
  async startReview(params: {
    sessionId: string
    sessionName: string
    repoPath: string
    targetFiles?: string[]
    reviewerProviderId?: string
  }): Promise<{ success: boolean; review: CodeReview }> {
    const review: CodeReview = {
      id: uuid(),
      sessionId: params.sessionId,
      sessionName: params.sessionName,
      reviewerSessionId: null,
      repoPath: params.repoPath,
      status: 'pending',
      targetFiles: params.targetFiles || [],
      summary: '',
      score: 0,
      totalComments: 0,
      criticalCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    }

    try {
      this.rawDb.prepare(`
        INSERT INTO code_reviews (id, session_id, session_name, reviewer_session_id, repo_path, status, target_files, summary, score, total_comments, critical_count, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        review.id, review.sessionId, review.sessionName, null, review.repoPath, review.status,
        JSON.stringify(review.targetFiles), review.summary, review.score, review.totalComments,
        review.criticalCount, review.createdAt, review.completedAt
      )

      // 获取文件改动列表
      const baseFiles = params.targetFiles?.length
        ? params.targetFiles
        : this.getChangedFiles(params.sessionId, params.repoPath)
      const changedFiles = this.expandFilesWithBlastRadius(params.repoPath, baseFiles)
      if (changedFiles.length === 0) {
        // 没有改动，直接标记完成
        review.summary = '没有检测到文件改动，无需审查。'
        review.score = 100
        review.status = 'completed'
        review.completedAt = new Date().toISOString()
        this.rawDb.prepare(`
          UPDATE code_reviews SET status=?, summary=?, score=?, completed_at=? WHERE id=?
        `).run(review.status, review.summary, review.score, review.completedAt, review.id)

        return { success: true, review }
      }

      // 标记为运行中
      review.status = 'running'
      review.targetFiles = changedFiles
      this.rawDb.prepare('UPDATE code_reviews SET status = ?, target_files = ? WHERE id = ?')
        .run('running', JSON.stringify(review.targetFiles), review.id)

      // 异步执行审查（不阻塞 IPC 返回）
      this.executeReview(review, changedFiles).catch(err => {
        console.error('[CodeReviewService] executeReview failed:', err)
        try {
          this.rawDb.prepare("UPDATE code_reviews SET status='failed', summary=? WHERE id=?")
            .run(`审查失败: ${err}`, review.id)
        } catch { /* ignore */ }
      })

      return { success: true, review }
    } catch (err) {
      console.error('[CodeReviewService] startReview failed:', err)
      return { success: false, review }
    }
  }

  /** 获取会话改动的文件列表 */
  private getChangedFiles(sessionId: string, repoPath?: string): string[] {
    if (!this.fileChangeTracker) return []
    const changes = this.fileChangeTracker.getSessionChanges(sessionId)
    return this.normalizeReviewFiles(repoPath || '', changes.map(c => c.filePath))
  }

  private normalizeReviewFiles(repoPath: string, files: string[]): string[] {
    const root = repoPath ? path.resolve(repoPath) : ''
    const seen = new Set<string>()
    const result: string[] = []
    for (const file of files) {
      if (!file) continue
      const normalized = root && path.isAbsolute(file)
        ? path.relative(root, path.resolve(file)).replace(/\\/g, '/')
        : file.replace(/\\/g, '/')
      if (!normalized) continue
      if (root && (normalized.startsWith('..') || path.isAbsolute(normalized))) continue
      if (!seen.has(normalized)) {
        seen.add(normalized)
        result.push(normalized)
      }
    }
    return result
  }

  private expandFilesWithBlastRadius(repoPath: string, files: string[]): string[] {
    const normalized = this.normalizeReviewFiles(repoPath, files)
    if (!this.codeGraphService || normalized.length === 0) return normalized

    try {
      const stats = this.codeGraphService.getStats(repoPath)
      if (stats.fileCount === 0) {
        this.codeGraphService.indexProject(repoPath)
      }

      const expanded = new Set<string>(normalized)
      for (const file of normalized) {
        this.codeGraphService.indexFile(repoPath, file)
        const radius = this.codeGraphService.getBlastRadius(repoPath, file, 2)
        for (const affected of radius.affectedFiles) {
          expanded.add(affected.filePath)
        }
      }
      return Array.from(expanded).sort()
    } catch (err) {
      console.warn('[CodeReviewService] blast radius expansion failed, using changed files only:', err)
      return normalized
    }
  }
  /** 执行实际审查（规则审查 + AI 增强） */
  private async executeReview(review: CodeReview, changedFiles: string[]): Promise<void> {
    const comments: Omit<ReviewComment, 'id' | 'createdAt'>[] = []
    let totalScore = 100

    // 收集所有文件内容（供 AI 审查用）
    const fileContents: { path: string; content: string; ext: string }[] = []

    // Phase 1: 基于规则的静态审查（快速，不需要 AI）
    for (const filePath of changedFiles) {
      try {
        const fullPath = path.join(review.repoPath, filePath)
        if (!fs.existsSync(fullPath)) continue

        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        const ext = path.extname(filePath).toLowerCase()

        fileContents.push({ path: filePath, content, ext })

        const ruleComments = this.runRuleBasedReview(filePath, content, lines, ext)
        comments.push(...ruleComments)

        for (const c of ruleComments) {
          if (c.severity === 'error') totalScore -= 10
          else if (c.severity === 'warning') totalScore -= 5
          else if (c.severity === 'suggestion') totalScore -= 1
        }
      } catch (err) {
        console.warn(`[CodeReviewService] Failed to review ${filePath}:`, err)
      }
    }

    // Phase 2: AI 增强审查（深度分析，生成修复建议）
    if (this.reviewMode === 'ai-enhanced' && fileContents.length > 0) {
      try {
        const aiComments = await this.runAiEnhancedReview(fileContents, comments)
        // AI 审查结果不重复扣分，但补充修复建议和深层问题
        for (const ac of aiComments) {
          // 检查是否与规则审查重复（同文件同类别的相似消息）
          const isDuplicate = comments.some(rc =>
            rc.filePath === ac.filePath &&
            rc.category === ac.category &&
            this.isSimilarMessage(rc.message, ac.message)
          )
          if (!isDuplicate) {
            comments.push(ac)
            if (ac.severity === 'error') totalScore -= 8
            else if (ac.severity === 'warning') totalScore -= 3
          }
        }

        // 用 AI 增强规则审查的 suggestion（规则审查的 suggestion 通常是模板文本）
        for (const rc of comments) {
          if (!rc.suggestion || rc.suggestion.length < 20) {
            // 尝试从 AI 审查结果中找到对应建议
            const aiMatch = aiComments.find(ac =>
              ac.filePath === rc.filePath &&
              Math.abs(ac.lineStart - rc.lineStart) <= 3 &&
              ac.category === rc.category
            )
            if (aiMatch?.suggestion && aiMatch.suggestion.length > rc.suggestion.length) {
              rc.suggestion = aiMatch.suggestion
            }
          }
        }
      } catch (err) {
        console.warn('[CodeReviewService] AI 增强审查失败，仅使用规则审查:', err)
      }
    }

    // 生成摘要
    const criticalCount = comments.filter(c => c.severity === 'error').length
    const warningCount = comments.filter(c => c.severity === 'warning').length
    const score = Math.max(0, Math.min(100, totalScore))
    const summary = this.generateSummary(comments, criticalCount, warningCount, score)

    // 保存结果
    await this.completeReview(review.id, summary, score, comments)
  }

  /** AI 增强审查：调用 AI 对代码进行深度分析 */
  private async runAiEnhancedReview(
    fileContents: { path: string; content: string; ext: string }[],
    existingComments: Omit<ReviewComment, 'id' | 'createdAt'>[],
  ): Promise<Omit<ReviewComment, 'id' | 'createdAt'>[]> {
    // 构建审查 prompt
    const codeBlock = fileContents
      .map(f => `### ${f.path}\n\`\`\`${f.ext.slice(1)}\n${f.content.slice(0, 8000)}\n\`\`\``)
      .join('\n\n')

    const existingSummary = existingComments.length > 0
      ? `\n已有的规则审查结果（不需要重复报告）：\n${existingComments.map(c => `- ${c.filePath}:${c.lineStart} [${c.severity}] ${c.message}`).join('\n')}`
      : ''

    const prompt = `你是一个资深代码审查员。请审查以下代码，找出规则检查无法发现的深层问题。

重点关注：
1. **逻辑 Bug**：边界条件、竞态条件、空指针、资源泄漏
2. **安全隐患**：注入攻击、权限绕过、数据泄露
3. **性能问题**：N+1 查询、内存泄漏、不必要的重渲染
4. **架构问题**：耦合过紧、职责不清、可扩展性差
5. **具体修复代码**：每条建议必须包含可执行的修复代码片段

输出 JSON 数组格式，每个元素包含：
{
  "filePath": "文件路径",
  "lineStart": 起始行号,
  "lineEnd": 结束行号,
  "severity": "error|warning|suggestion",
  "category": "bug|security|performance|architecture|best-practice",
  "message": "问题描述",
  "suggestion": "修复建议（包含代码片段）"
}

如果没有发现问题，返回空数组 []。只返回 JSON，不要其他文本。
${existingSummary}

待审查代码：
${codeBlock}`

    try {
      const aiResponse = await this.callAiDirectly(prompt)
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return []

      const parsed = JSON.parse(jsonMatch[0])
      if (!Array.isArray(parsed)) return []

      return parsed.filter((item: any) =>
        item.filePath && item.message && item.severity && item.category
      ).map((item: any) => ({
        reviewId: '',
        filePath: item.filePath,
        lineStart: item.lineStart || 1,
        lineEnd: item.lineEnd || item.lineStart || 1,
        severity: ['error', 'warning', 'suggestion'].includes(item.severity) ? item.severity : 'suggestion',
        category: ['bug', 'security', 'performance', 'style', 'best-practice', 'architecture'].includes(item.category)
          ? item.category : 'best-practice',
        message: item.message,
        suggestion: item.suggestion || '',
        resolved: false,
      }))
    } catch (err) {
      console.warn('[CodeReviewService] AI 审查解析失败:', err)
      return []
    }
  }

  /** 判断两条消息是否相似（避免重复报告） */
  private isSimilarMessage(a: string, b: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    const na = normalize(a)
    const nb = normalize(b)
    if (na === nb) return true
    // 简单的包含关系检查
    if (na.length > 10 && nb.length > 10 && (na.includes(nb) || nb.includes(na))) return true
    return false
  }

  /** 直接调用 AI */
  private async callAiDirectly(prompt: string): Promise<string> {
    // 方案1: Anthropic SDK
    try {
      const { Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic()
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-7',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n')
      return text || ''
    } catch (sdkErr) {
      console.warn('[CodeReviewService] Anthropic SDK 不可用，尝试 CLI:', (sdkErr as Error).message)
    }

    // 方案2: CLI
    return this.callCliDirectly(prompt)
  }

  /** 通过 CLI 调用 AI */
  private callCliDirectly(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process')
      const proc = spawn('claude', ['--print', '--no-input', prompt], { timeout: 120000 })
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

  /** 基于规则的静态审查（不依赖 AI 调用，快速执行） */
  private runRuleBasedReview(
    filePath: string, content: string, lines: string[], ext: string
  ): Omit<ReviewComment, 'id' | 'createdAt'>[] {
    const comments: Omit<ReviewComment, 'id' | 'createdAt'>[] = []

    // 1. 超长文件检测
    if (lines.length > 500) {
      comments.push({
        reviewId: '', filePath, lineStart: 1, lineEnd: 1,
        severity: 'warning', category: 'architecture',
        message: `文件共 ${lines.length} 行，建议拆分为更小的模块`,
        suggestion: '考虑将大文件拆分为职责单一的多个文件，每个文件不超过 300 行', resolved: false,
      })
    }

    // 2. 超长行检测
    lines.forEach((line, i) => {
      if (line.length > 200) {
        comments.push({
          reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 1,
          severity: 'suggestion', category: 'style',
          message: `行长度 ${line.length} 超过 200 字符`,
          suggestion: '将长行拆分为多行，提高可读性', resolved: false,
        })
      }
    })

    // 3. console.log 检测
    lines.forEach((line, i) => {
      if (/\bconsole\.(log|debug|info|warn|error)\s*\(/.test(line) && !/\/\//.test(line.split('console')[0])) {
        // 排除 .test. 文件和合法的 console 使用
        if (!filePath.includes('.test.') && !filePath.includes('.spec.') && !filePath.includes('__tests__')) {
          comments.push({
            reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 1,
            severity: 'suggestion', category: 'best-practice',
            message: `发现 console.log 调用，生产代码应使用专业日志库`,
            suggestion: '使用 winston、pino 等日志库替代 console.log', resolved: false,
          })
        }
      }
    })

    // 4. TODO/FIXME/HACK 检测
    lines.forEach((line, i) => {
      const match = line.match(/\b(TODO|FIXME|HACK|XXX)\b/i)
      if (match) {
        comments.push({
          reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 1,
          severity: 'info', category: 'best-practice',
          message: `发现 ${match[1].toUpperCase()} 标记: ${line.trim().slice(0, 100)}`,
          suggestion: '及时处理 TODO/FIXME 项，避免技术债积累', resolved: false,
        })
      }
    })

    // 5. TypeScript/JavaScript 特有规则
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      // any 类型检测
      lines.forEach((line, i) => {
        if (/\bany\b/.test(line) && !/\/\/.*any/.test(line) && !/\/\*/.test(line) && !filePath.includes('.d.ts')) {
          comments.push({
            reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 1,
            severity: 'warning', category: 'best-practice',
            message: '使用了 any 类型，会丢失类型安全',
            suggestion: '使用具体类型或泛型替代 any', resolved: false,
          })
        }
      })

      // eval() 检测
      lines.forEach((line, i) => {
        if (/\beval\s*\(/.test(line)) {
          comments.push({
            reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 1,
            severity: 'error', category: 'security',
            message: '使用了 eval()，存在安全风险',
            suggestion: '使用 JSON.parse() 或 Function 构造器替代', resolved: false,
          })
        }
      })

      // innerHTML 检测
      lines.forEach((line, i) => {
        if (/\.innerHTML\s*=/.test(line)) {
          comments.push({
            reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 1,
            severity: 'error', category: 'security',
            message: '使用了 innerHTML 赋值，存在 XSS 风险',
            suggestion: '使用 textContent 或 DOMPurify.sanitize() 处理', resolved: false,
          })
        }
      })
    }

    // 6. 硬编码密钥/密码检测
    lines.forEach((line, i) => {
      if (/(password|secret|api_key|apikey|token|private_key)\s*[=:]\s*['"][^'"]{8,}['"]/i.test(line)) {
        comments.push({
          reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 1,
          severity: 'error', category: 'security',
          message: '可能硬编码了密钥/密码，存在泄露风险',
          suggestion: '使用环境变量或密钥管理服务存储敏感信息', resolved: false,
        })
      }
    })

    // 7. 空 catch 块检测
    for (let i = 0; i < lines.length; i++) {
      if (/\bcatch\s*\([^)]*\)\s*\{?\s*$/.test(lines[i]) && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        if (nextLine === '}' || nextLine === '') {
          comments.push({
            reviewId: '', filePath, lineStart: i + 1, lineEnd: i + 2,
            severity: 'warning', category: 'bug',
            message: '空的 catch 块会吞掉错误，难以排查问题',
            suggestion: '至少添加 console.error 或错误上报', resolved: false,
          })
        }
      }
    }

    return comments
  }

  /** 生成审查摘要 */
  private generateSummary(
    comments: Omit<ReviewComment, 'id' | 'createdAt'>[],
    criticalCount: number, warningCount: number, score: number
  ): string {
    const parts: string[] = []

    if (score >= 90) parts.push('代码质量优秀')
    else if (score >= 70) parts.push('代码质量良好')
    else if (score >= 50) parts.push('代码质量一般，需要改进')
    else parts.push('代码质量较差，强烈建议修复')

    if (criticalCount > 0) parts.push(`发现 ${criticalCount} 个严重问题`)
    if (warningCount > 0) parts.push(`${warningCount} 个警告`)
    const suggestionCount = comments.filter(c => c.severity === 'suggestion').length
    if (suggestionCount > 0) parts.push(`${suggestionCount} 个建议`)

    // 分类统计
    const categoryMap = new Map<string, number>()
    for (const c of comments) {
      categoryMap.set(c.category, (categoryMap.get(c.category) || 0) + 1)
    }
    if (categoryMap.size > 0) {
      const catStr = Array.from(categoryMap.entries())
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
      parts.push(`分类: ${catStr}`)
    }

    return parts.join('。') + '。'
  }

  /** 获取审查 */
  async get(id: string): Promise<{ success: boolean; review: CodeReview | null }> {
    try {
      const row = this.rawDb.prepare('SELECT * FROM code_reviews WHERE id = ?').get(id) as any
      return { success: true, review: row ? this.mapReviewRow(row) : null }
    } catch {
      return { success: true, review: null }
    }
  }

  /** 列出审查 */
  async list(sessionId?: string, limit?: number): Promise<{ success: boolean; reviews: CodeReview[] }> {
    try {
      let rows: any[]
      if (sessionId) {
        rows = this.rawDb.prepare('SELECT * FROM code_reviews WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit || 20)
      } else {
        rows = this.rawDb.prepare('SELECT * FROM code_reviews ORDER BY created_at DESC LIMIT ?').all(limit || 20)
      }
      return { success: true, reviews: rows.map(r => this.mapReviewRow(r)) }
    } catch {
      return { success: true, reviews: [] }
    }
  }

  /** 获取审查评论 */
  async getComments(reviewId: string): Promise<{ success: boolean; comments: ReviewComment[] }> {
    try {
      const rows = this.rawDb.prepare('SELECT * FROM review_comments WHERE review_id = ? ORDER BY created_at').all(reviewId) as any[]
      return { success: true, comments: rows.map(r => this.mapCommentRow(r)) }
    } catch {
      return { success: true, comments: [] }
    }
  }

  /** 解决评论 */
  async resolveComment(commentId: string): Promise<{ success: boolean }> {
    try {
      this.rawDb.prepare('UPDATE review_comments SET resolved = 1 WHERE id = ?').run(commentId)
      return { success: true }
    } catch {
      return { success: false }
    }
  }

  /** 应用修复建议（将 suggestion 中的代码写入文件对应行） */
  async applyFix(commentId: string): Promise<{ success: boolean; message: string }> {
    try {
      const row = this.rawDb.prepare('SELECT * FROM review_comments WHERE id = ?').get(commentId) as any
      if (!row) return { success: false, message: '评论不存在' }
      if (!row.suggestion) return { success: false, message: '无修复建议' }

      const suggestion = row.suggestion

      // 尝试从建议中提取代码块
      const codeBlockMatch = suggestion.match(/```[\w]*\n([\s\S]*?)```/)
      const fixCode = codeBlockMatch ? codeBlockMatch[1].trim() : null

      if (!fixCode) {
        // 没有可自动应用的代码块，标记为已处理
        this.rawDb.prepare('UPDATE review_comments SET resolved = 1 WHERE id = ?').run(commentId)
        return { success: true, message: '建议已标记处理（无可自动应用的代码块）' }
      }

      // 获取对应的 review 以确定 repoPath
      const reviewRow = this.rawDb.prepare('SELECT * FROM code_reviews WHERE id = ?').get(row.review_id) as any
      if (!reviewRow) return { success: false, message: '关联审查不存在' }

      const fullPath = path.join(reviewRow.repo_path, row.file_path)
      if (!fs.existsSync(fullPath)) {
        return { success: false, message: `文件不存在: ${row.file_path}` }
      }

      // 读取文件内容
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      const lineStart = row.line_start || 1
      const lineEnd = row.line_end || lineStart

      // 验证行号有效性
      if (lineStart < 1 || lineEnd > lines.length || lineStart > lineEnd) {
        return { success: false, message: `行号无效: ${lineStart}-${lineEnd}` }
      }

      // 替换目标行
      const fixLines = fixCode.split('\n')
      lines.splice(lineStart - 1, lineEnd - lineStart + 1, ...fixLines)

      // 写回文件
      fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8')

      // 标记评论为已解决
      this.rawDb.prepare('UPDATE review_comments SET resolved = 1 WHERE id = ?').run(commentId)

      sendToRenderer(IPC.CODE_REVIEW_STATUS, {
        type: 'fix-applied',
        commentId,
        filePath: row.file_path,
        lineStart,
        lineEnd: lineStart + fixLines.length - 1,
      })

      return {
        success: true,
        message: `已将修复应用到 ${row.file_path}:${lineStart}-${lineStart + fixLines.length - 1}`,
      }
    } catch (err: any) {
      return { success: false, message: `应用失败: ${err.message}` }
    }
  }

  /** 获取审查 Prompt（供外部 AI 调用使用） */
  getPrompt(): string {
    return `[Code Review] 你现在是一个资深代码审查员。请审查以下代码改动，按严重程度分类（bug/security/performance/style/best-practice/architecture），给出具体的行号和修复建议。格式：每条评论包含 filePath, lineRange, severity, message, suggestion。`
  }

  /** 内部：完成审查时调用 */
  private async completeReview(
    reviewId: string, summary: string, score: number,
    comments: Omit<ReviewComment, 'id' | 'createdAt'>[]
  ): Promise<void> {
    this.rawDb.prepare(`
      UPDATE code_reviews SET status='completed', summary=?, score=?, total_comments=?, critical_count=?, completed_at=? WHERE id=?
    `).run(summary, score, comments.length, comments.filter(c => c.severity === 'error').length, new Date().toISOString(), reviewId)

    const insert = this.rawDb.prepare(`
      INSERT INTO review_comments (id, review_id, file_path, line_start, line_end, severity, category, message, suggestion, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const c of comments) {
      insert.run(uuid(), reviewId, c.filePath, c.lineStart, c.lineEnd, c.severity, c.category,
        c.message, c.suggestion, c.resolved ? 1 : 0, new Date().toISOString())
    }

    // 通知前端
    try {
      sendToRenderer(IPC.CODE_REVIEW_STATUS, { reviewId, status: 'completed', summary, score, totalComments: comments.length })
    } catch { /* ignore */ }
  }

  /** 自动审查触发（由 SessionManagerV2 turn_complete 事件调用） */
  async autoReview(sessionId: string, sessionName: string, repoPath: string): Promise<{ triggered: boolean; reason: string }> {
    if (!this.autoReviewEnabled) return { triggered: false, reason: '自动审查未启用' }
    if (!this.fileChangeTracker) return { triggered: false, reason: '文件追踪器不可用' }

    // 节流检查
    const lastTime = this.lastReviewTime.get(sessionId) || 0
    if (Date.now() - lastTime < this.autoReviewInterval) {
      return { triggered: false, reason: '距上次审查间隔过短' }
    }

    // 检查是否有文件改动
    const changedFiles = this.getChangedFiles(sessionId)
    if (changedFiles.length === 0) {
      return { triggered: false, reason: '无文件改动' }
    }

    this.lastReviewTime.set(sessionId, Date.now())
    const result = await this.startReview({ sessionId, sessionName, repoPath })
    return { triggered: result.success, reason: result.success ? '自动审查已启动' : '启动失败' }
  }

  /** 获取/设置配置 */
  getSettings(): { autoReviewEnabled: boolean; autoReviewInterval: number; reviewMode: string } {
    return { autoReviewEnabled: this.autoReviewEnabled, autoReviewInterval: this.autoReviewInterval, reviewMode: this.reviewMode }
  }

  updateSettings(updates: { autoReviewEnabled?: boolean; autoReviewInterval?: number; reviewMode?: string }): void {
    if (updates.autoReviewEnabled !== undefined) this.autoReviewEnabled = updates.autoReviewEnabled
    if (updates.autoReviewInterval !== undefined) this.autoReviewInterval = updates.autoReviewInterval
    if (updates.reviewMode) this.reviewMode = updates.reviewMode as any
    this.saveSettings()
  }
}
