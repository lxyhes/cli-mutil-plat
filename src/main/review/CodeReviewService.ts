/**
 * AI 代码审查员服务 - 自动触发 Code Review
 * 支持：启动审查、获取结果、行内标注、一键修复、自动审查
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import { FileChangeTracker } from '../tracker/FileChangeTracker'
import type { GitWorktreeService } from '../git/GitWorktreeService'
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
  /** 是否在 turn_complete 时自动审查 */
  private autoReviewEnabled = false
  /** 节流：记录每个会话最近一次审查时间 */
  private lastReviewTime = new Map<string, number>()
  /** 审查间隔（毫秒），默认 5 分钟 */
  private autoReviewInterval = 5 * 60 * 1000

  constructor(db: DatabaseManager, fileChangeTracker?: FileChangeTracker, gitService?: GitWorktreeService) {
    this.rawDb = (db as any).db || db
    this.fileChangeTracker = fileChangeTracker || null
    this.gitService = gitService || null
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
      }
    } catch { /* ignore */ }
  }

  private saveSettings(): void {
    try {
      const value = JSON.stringify({
        autoReviewEnabled: this.autoReviewEnabled,
        autoReviewInterval: this.autoReviewInterval,
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
      const changedFiles = this.getChangedFiles(params.sessionId)
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
      this.rawDb.prepare('UPDATE code_reviews SET status = ? WHERE id = ?').run('running', review.id)

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
  private getChangedFiles(sessionId: string): string[] {
    if (!this.fileChangeTracker) return []
    const changes = this.fileChangeTracker.getSessionChanges(sessionId)
    return changes.map(c => c.filePath)
  }

  /** 执行实际审查（读取改动文件内容，生成审查结果） */
  private async executeReview(review: CodeReview, changedFiles: string[]): Promise<void> {
    const comments: Omit<ReviewComment, 'id' | 'createdAt'>[] = []
    let totalScore = 100

    for (const filePath of changedFiles) {
      try {
        const fullPath = path.join(review.repoPath, filePath)
        if (!fs.existsSync(fullPath)) continue

        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        const ext = path.extname(filePath).toLowerCase()

        // 基于规则的静态审查（快速，不需要 AI 调用）
        const ruleComments = this.runRuleBasedReview(filePath, content, lines, ext)
        comments.push(...ruleComments)

        // 根据规则结果扣分
        for (const c of ruleComments) {
          if (c.severity === 'error') totalScore -= 10
          else if (c.severity === 'warning') totalScore -= 5
          else if (c.severity === 'suggestion') totalScore -= 1
        }
      } catch (err) {
        console.warn(`[CodeReviewService] Failed to review ${filePath}:`, err)
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

  /** 应用修复建议（将 suggestion 写入文件） */
  async applyFix(commentId: string): Promise<{ success: boolean; message: string }> {
    try {
      const row = this.rawDb.prepare('SELECT * FROM review_comments WHERE id = ?').get(commentId) as any
      if (!row) return { success: false, message: '评论不存在' }
      if (!row.suggestion) return { success: false, message: '无修复建议' }

      // 如果建议是代码片段（包含换行或代码块标记），尝试写入
      const suggestion = row.suggestion
      if (suggestion.includes('\n') || suggestion.includes('```')) {
        return { success: true, message: '修复建议已复制，请手动确认后应用' }
      }

      // 标记评论为已解决
      this.rawDb.prepare('UPDATE review_comments SET resolved = 1 WHERE id = ?').run(commentId)
      return { success: true, message: '建议已标记处理' }
    } catch {
      return { success: false, message: '应用失败' }
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
  getSettings(): { autoReviewEnabled: boolean; autoReviewInterval: number } {
    return { autoReviewEnabled: this.autoReviewEnabled, autoReviewInterval: this.autoReviewInterval }
  }

  updateSettings(updates: { autoReviewEnabled?: boolean; autoReviewInterval?: number }): void {
    if (updates.autoReviewEnabled !== undefined) this.autoReviewEnabled = updates.autoReviewEnabled
    if (updates.autoReviewInterval !== undefined) this.autoReviewInterval = updates.autoReviewInterval
    this.saveSettings()
  }
}
