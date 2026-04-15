/**
 * EvaluationService - 任务评估引擎
 * 支持：评估模板 CRUD / 运行评估 / 解析评分结果
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { ConversationMessage } from '../../shared/types'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { EvaluationTemplate, EvaluationRun, EvaluationResult } from '../storage/repositories/EvaluationRepository'

export class EvaluationService extends EventEmitter {
  private goalService: any = null  // ★ GoalService 引用,用于评估完成后更新目标进度

  constructor(
    private db: DatabaseManager,
    private sessionManagerV2: SessionManagerV2,
  ) {
    super()
  }

  /**
   * ★ 设置 GoalService 引用
   * 用于 Evaluation → Goal 链条打通
   */
  setGoalService(goalService: any): void {
    this.goalService = goalService
    console.log('[EvaluationService] GoalService 已连接')
  }

  // ── 模板 CRUD ─────────────────────────────────────────────

  createTemplate(data: {
    name: string
    description?: string
    criteria: { name: string; description: string; max_score: number; weight: number }[]
    promptTemplate: string
    createdBy?: string
  }): EvaluationTemplate {
    const id = `eval-tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const template = this.db.createEvaluationTemplate({
      id,
      name: data.name,
      description: data.description,
      criteria: data.criteria,
      promptTemplate: data.promptTemplate,
      createdBy: data.createdBy,
    })
    this.broadcastStatus({ type: 'template-created', templateId: id })
    return template
  }

  getTemplate(id: string): EvaluationTemplate | null {
    return this.db.getEvaluationTemplate(id)
  }

  listTemplates(): EvaluationTemplate[] {
    return this.db.listEvaluationTemplates()
  }

  updateTemplate(id: string, updates: Partial<EvaluationTemplate>): void {
    this.db.updateEvaluationTemplate(id, updates)
    this.broadcastStatus({ type: 'template-updated', templateId: id })
  }

  deleteTemplate(id: string): void {
    this.db.deleteEvaluationTemplate(id)
    this.broadcastStatus({ type: 'template-deleted', templateId: id })
  }

  getTemplateStats(templateId: string) {
    return this.db.getEvaluationTemplateStats(templateId)
  }

  // ── 评估运行 ───────────────────────────────────────────────

  /**
   * 对指定会话运行评估
   * 1. 从 SessionManagerV2 获取对话历史
   * 2. 用 prompt_template 构造评估 Prompt
   * 3. 调用 AI 解析评分
   * 4. 存储结果
   */
  async evaluate(sessionId: string, templateId: string, triggerType: 'manual' | 'scheduled' = 'manual'): Promise<{ runId: string }> {
    const template = this.db.getEvaluationTemplate(templateId)
    if (!template) throw new Error(`Evaluation template not found: ${templateId}`)

    const runId = `eval-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 创建运行记录
    this.db.createEvaluationRun({
      id: runId,
      templateId,
      sessionId,
      status: 'running',
      triggerType,
      evaluatorProvider: 'claude-code',
      evaluatorModel: 'claude-sonnet-4-7',
      context: { criteriaCount: template.criteria.length },
    })

    this.broadcastStatus({ type: 'run-started', runId, templateId, sessionId })

    try {
      // 获取对话历史
      const messages = this.sessionManagerV2.getConversation(sessionId)
      const conversationText = this.formatConversation(messages)

      // 调用 AI 进行评估
      const scores = await this.callEvaluator(template, conversationText)

      // 存储结果
      for (const criterion of scores) {
        const resultId = `eval-res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        this.db.createEvaluationResult({
          id: resultId,
          evaluationRunId: runId,
          criterionName: criterion.name,
          score: criterion.score,
          reasoning: criterion.reasoning,
          suggestions: criterion.suggestions,
        })
      }

      // 更新运行状态为完成
      this.db.updateEvaluationRun(runId, {
        status: 'completed',
        completedAt: new Date(),
      })

      // ★ 新增: 计算平均分数并更新关联目标进度
      if (this.goalService && scores.length > 0) {
        try {
          // 计算加权平均分
          const totalWeight = template.criteria.reduce((sum, c) => sum + (c.weight || 1), 0)
          const weightedScore = scores.reduce((sum, s, i) => {
            const criterion = template.criteria[i]
            const weight = criterion?.weight || 1
            const normalizedScore = (s.score / (criterion?.max_score || 100)) * 100
            return sum + (normalizedScore * weight)
          }, 0)
          const averageScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0

          // 尝试查找与 session 关联的目标
          const goalId = this.findGoalBySessionId(sessionId)
          if (goalId) {
            this.goalService.updateProgressFromEvaluation(
              goalId,
              averageScore,
              `评估: ${template.name}`
            )
          }
        } catch (err) {
          console.warn('[EvaluationService] 更新目标进度失败:', err)
          // 不阻断评估流程
        }
      }

      this.broadcastStatus({ type: 'run-completed', runId, templateId, sessionId })
      return { runId }
    } catch (err) {
      // 更新运行状态为失败
      this.db.updateEvaluationRun(runId, {
        status: 'failed',
        completedAt: new Date(),
      })

      this.broadcastStatus({ type: 'run-failed', runId, templateId, sessionId, error: String(err) })
      throw err
    }
  }

  /**
   * 获取运行记录
   */
  getRun(id: string): EvaluationRun | null {
    return this.db.getEvaluationRun(id)
  }

  /**
   * 列出运行记录
   */
  listRuns(limit = 50): EvaluationRun[] {
    return this.db.listEvaluationRuns(limit)
  }

  /**
   * 按会话获取运行记录
   */
  listRunsBySession(sessionId: string, limit = 20): EvaluationRun[] {
    return this.db.listEvaluationRunsBySession(sessionId, limit)
  }

  /**
   * 按模板获取运行记录
   */
  listRunsByTemplate(templateId: string, limit = 20): EvaluationRun[] {
    return this.db.listEvaluationRunsByTemplate(templateId, limit)
  }

  /**
   * 获取评估结果
   */
  getResults(runId: string): EvaluationResult[] {
    return this.db.getEvaluationResultsByRun(runId)
  }

  // ── 内部方法 ───────────────────────────────────────────────

  /**
   * 格式化对话历史为纯文本
   */
  private formatConversation(messages: ConversationMessage[]): string {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        const role = m.role === 'user' ? 'User' : 'Assistant'
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        const thinkingText = m.thinkingText || m.thinking
        const thinking = thinkingText ? `\n[Thinking]: ${thinkingText}` : ''
        return `[${role}]\n${content}${thinking}`
      })
      .join('\n\n---\n\n')
  }

  /**
   * 调用 AI 进行评估
   * 通过向一个临时 session 发送消息来调用
   */
  private async callEvaluator(
    template: EvaluationTemplate,
    conversationText: string,
  ): Promise<{ name: string; score: number; reasoning: string; suggestions: string }[]> {
    const evalSessionId = `eval-ai-${Date.now()}`

    // 构造评估 Prompt
    const criteriaJson = template.criteria.map(c =>
      `  - "${c.name}": ${c.description} (满分 ${c.max_score}, 权重 ${c.weight})`
    ).join('\n')

    const prompt = `${template.promptTemplate}

请根据以下评估标准对这段 AI 会话进行评分：

评估标准：
${criteriaJson}

会话内容：
${conversationText.slice(0, 30000)}

请以 JSON 格式返回评分结果：
{
  "scores": [
    {
      "name": "标准名称",
      "score": 0.0-1.0（相对于满分的比例）,
      "reasoning": "评分理由（50-200字）",
      "suggestions": "改进建议（可选）"
    }
  ]
}

只返回 JSON，不要有其他文字。`

    let responseText = ''
    let resolved = false

    const handler = (sid: string, msg: any) => {
      if (sid !== evalSessionId) return
      if (msg.isDelta && msg.content) {
        responseText += msg.content
      }
      if (!msg.isDelta && msg.role === 'assistant' && msg.content) {
        responseText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        resolved = true
        this.sessionManagerV2.removeListener('conversation-message', handler)
      }
    }

    this.sessionManagerV2.on('conversation-message', handler)

    try {
      // 创建临时会话
      this.sessionManagerV2.createSession({
        id: evalSessionId,
        name: '[评估] AI 评分',
        workingDirectory: process.cwd(),
        providerId: 'claude-code',
        initialPrompt: prompt,
      })
    } catch (err) {
      this.sessionManagerV2.removeListener('conversation-message', handler)
      throw err
    }

    // 事件驱动等待 AI 完成（+ 120s 超时兜底）
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 500)

      setTimeout(() => {
        clearInterval(checkInterval)
        this.sessionManagerV2.removeListener('conversation-message', handler)
        resolve()
      }, 120000)
    })

    // 解析 JSON 响应
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in evaluator response')
      const parsed = JSON.parse(jsonMatch[0])
      return (parsed.scores || []).map((s: any) => ({
        name: s.name || '',
        score: Math.max(0, Math.min(1, Number(s.score) || 0)),
        reasoning: s.reasoning || '',
        suggestions: s.suggestions || '',
      }))
    } catch (err) {
      console.error('[EvaluationService] Failed to parse evaluator response:', err)
      // 返回基于模板的默认失败结果
      return template.criteria.map(c => ({
        name: c.name,
        score: 0,
        reasoning: `评估失败：${String(err)}`,
        suggestions: '',
      }))
    }
  }

  private broadcastStatus(status: any): void {
    sendToRenderer(IPC.EVAL_RUN_STATUS, status)
  }

  // ── ★ 链条打通辅助方法 ────────────────────────────────────

  /**
   * 查找与 session 关联的目标
   * 通过查询 goal_sessions 表找到关联的 goal_id
   */
  private findGoalBySessionId(sessionId: string): string | null {
    try {
      const result = (this.db as any).getGoalSessions?.(sessionId)
      if (result && result.length > 0) {
        // 返回第一个关联的目标ID
        return result[0].goal_id || result[0].goalId
      }
      return null
    } catch {
      return null
    }
  }
}
