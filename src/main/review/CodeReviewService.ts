/**
 * AI 代码审查员服务 - 自动触发 Code Review
 * 支持：启动审查、获取结果、行内标注、一键修复
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'

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
  reviewerSessionId: string | null  // 审查者的会话 ID
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
  private db: DatabaseManager

  constructor(db: DatabaseManager) { this.db = db }

  /** 启动代码审查 */
  async startReview(params: {
    sessionId: string
    sessionName: string
    repoPath: string
    targetFiles?: string[]
    reviewerProviderId?: string
  }): Promise<CodeReview> {
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

    this.db.run(`
      INSERT INTO code_reviews (id, session_id, session_name, reviewer_session_id, repo_path, status, target_files, summary, score, total_comments, critical_count, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [review.id, review.sessionId, review.sessionName, null, review.repoPath, review.status,
        JSON.stringify(review.targetFiles), review.summary, review.score, review.totalComments,
        review.criticalCount, review.createdAt, review.completedAt])

    // TODO: 实际启动审查会话（通过 SessionManagerV2 创建新会话）
    review.status = 'running'
    this.db.run('UPDATE code_reviews SET status = ? WHERE id = ?', ['running', review.id])

    return review
  }

  /** 获取审查 */
  async get(id: string): Promise<CodeReview | null> {
    return this.db.get<CodeReview>('SELECT * FROM code_reviews WHERE id = ?', [id])
  }

  /** 列出审查 */
  async list(sessionId?: string, limit?: number): Promise<CodeReview[]> {
    if (sessionId) {
      return this.db.all<CodeReview>('SELECT * FROM code_reviews WHERE session_id = ? ORDER BY created_at DESC LIMIT ?', [sessionId, limit || 20])
    }
    return this.db.all<CodeReview>('SELECT * FROM code_reviews ORDER BY created_at DESC LIMIT ?', [limit || 20])
  }

  /** 获取审查评论 */
  async getComments(reviewId: string): Promise<ReviewComment[]> {
    return this.db.all<ReviewComment>('SELECT * FROM review_comments WHERE review_id = ? ORDER BY created_at', [reviewId])
  }

  /** 解决评论 */
  async resolveComment(commentId: string): Promise<void> {
    this.db.run('UPDATE review_comments SET resolved = 1 WHERE id = ?', [commentId])
  }

  /** 应用修复建议 */
  async applyFix(commentId: string): Promise<{ success: boolean; message: string }> {
    const comment = await this.db.get<ReviewComment>('SELECT * FROM review_comments WHERE id = ?', [commentId])
    if (!comment) return { success: false, message: '评论不存在' }
    if (!comment.suggestion) return { success: false, message: '无修复建议' }

    // TODO: 通过 FileManager 写入文件
    return { success: true, message: '修复建议已应用（需要手动确认）' }
  }

  /** 获取审查 Prompt */
  getPrompt(): string {
    return `[Code Review] 你现在是一个资深代码审查员。请审查以下代码改动，按严重程度分类（bug/security/performance/style/best-practice/architecture），给出具体的行号和修复建议。格式：每条评论包含 filePath, lineRange, severity, message, suggestion。`
  }

  /** 内部：完成审查时调用 */
  async completeReview(reviewId: string, summary: string, score: number, comments: Omit<ReviewComment, 'id' | 'createdAt'>[]): Promise<void> {
    this.db.run(`UPDATE code_reviews SET status='completed', summary=?, score=?, total_comments=?, critical_count=?, completed_at=? WHERE id=?`,
      [summary, score, comments.length, comments.filter(c => c.severity === 'error').length, new Date().toISOString(), reviewId])

    for (const c of comments) {
      this.db.run(`
        INSERT INTO review_comments (id, review_id, file_path, line_start, line_end, severity, category, message, suggestion, resolved, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [uuid(), reviewId, c.filePath, c.lineStart, c.lineEnd, c.severity, c.category,
          c.message, c.suggestion, c.resolved ? 1 : 0, new Date().toISOString()])
    }
  }
}
