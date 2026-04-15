/**
 * DriftGuardService - AI 行为漂移检测与护栏
 *
 * 基于目标锚定，每隔 N 轮对话自动调用 LLM 判断当前行为是否偏离目标
 * 偏离时主动提醒用户并提供"纠正方向"建议
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { GoalService } from '../goal/GoalService'
import type { SummaryService } from '../summary/SummaryService'
import type { SessionManagerV2 } from '../session/SessionManagerV2'

// ─── 类型定义 ─────────────────────────────────────────────

export type DriftSeverity = 'none' | 'minor' | 'moderate' | 'severe'

export interface DriftCheckResult {
  /** 检查 ID */
  id: string
  /** 会话 ID */
  sessionId: string
  /** 关联目标 ID */
  goalId: string
  /** 目标标题 */
  goalTitle: string
  /** 漂移严重程度 */
  severity: DriftSeverity
  /** 漂移描述 */
  description: string
  /** 纠正建议 */
  suggestion: string
  /** 检查时间 */
  checkedAt: string
  /** 对话轮次 */
  turnNumber: number
}

export interface DriftConfig {
  /** 每隔多少轮检查一次（默认 5） */
  checkIntervalTurns: number
  /** 是否自动提醒（默认 true） */
  autoNotify: boolean
  /** 是否自动注入纠正提示（默认 false，需要用户确认） */
  autoInjectCorrection: boolean
  /** 最大连续漂移次数后自动暂停（默认 3） */
  maxConsecutiveDrifts: number
}

export interface SessionDriftState {
  /** 会话 ID */
  sessionId: string
  /** 关联目标 ID */
  goalId: string
  /** 当前对话轮次计数 */
  turnCount: number
  /** 上次检查轮次 */
  lastCheckedTurn: number
  /** 连续漂移次数 */
  consecutiveDrifts: number
  /** 漂移历史 */
  history: DriftCheckResult[]
  /** 是否已暂停 */
  paused: boolean
}

const DEFAULT_CONFIG: DriftConfig = {
  checkIntervalTurns: 5,
  autoNotify: true,
  autoInjectCorrection: false,
  maxConsecutiveDrifts: 3,
}

// ─── 服务 ─────────────────────────────────────────────────

export class DriftGuardService extends EventEmitter {
  private sessionStates: Map<string, SessionDriftState> = new Map()
  private config: DriftConfig
  private goalService: GoalService | null = null
  private summaryService: SummaryService | null = null
  private sessionManagerV2: SessionManagerV2 | null = null

  constructor(config?: Partial<DriftConfig>) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** 注入依赖 */
  setServices(services: {
    goalService?: GoalService
    summaryService?: SummaryService
    sessionManagerV2?: SessionManagerV2
  }): void {
    this.goalService = services.goalService || null
    this.summaryService = services.summaryService || null
    this.sessionManagerV2 = services.sessionManagerV2 || null
  }

  // ── 监控管理 ────────────────────────────────────────────

  /** 为会话开启漂移监控 */
  startMonitoring(sessionId: string, goalId: string): SessionDriftState {
    const state: SessionDriftState = {
      sessionId,
      goalId,
      turnCount: 0,
      lastCheckedTurn: 0,
      consecutiveDrifts: 0,
      history: [],
      paused: false,
    }
    this.sessionStates.set(sessionId, state)
    this.emit('monitoring-started', { sessionId, goalId })
    return state
  }

  /** 停止监控 */
  stopMonitoring(sessionId: string): void {
    this.sessionStates.delete(sessionId)
    this.emit('monitoring-stopped', { sessionId })
  }

  /** 获取监控状态 */
  getMonitoringState(sessionId: string): SessionDriftState | null {
    return this.sessionStates.get(sessionId) || null
  }

  /** 获取所有被监控的会话 */
  getMonitoredSessions(): SessionDriftState[] {
    return [...this.sessionStates.values()]
  }

  // ── 轮次追踪 ────────────────────────────────────────────

  /** 通知新对话轮次完成（由 SessionManagerV2 事件触发） */
  onTurnComplete(sessionId: string): DriftCheckResult | null {
    const state = this.sessionStates.get(sessionId)
    if (!state || state.paused) return null

    state.turnCount++

    // 检查是否到达检查间隔
    if (state.turnCount - state.lastCheckedTurn >= this.config.checkIntervalTurns) {
      state.lastCheckedTurn = state.turnCount
      return this.performCheck(sessionId)
    }

    return null
  }

  // ── 漂移检测 ────────────────────────────────────────────

  /** 执行漂移检查（先启发式快速判断，如果需要则异步 LLM 增强） */
  private performCheck(sessionId: string): DriftCheckResult | null {
    const state = this.sessionStates.get(sessionId)
    if (!state) return null

    // 获取目标信息
    const goal = this.goalService?.getGoal(state.goalId)
    if (!goal) return null

    // 获取最近对话内容（用于判断漂移）
    const recentContext = this.getRecentConversationContext(sessionId)

    // 执行启发式漂移判断
    const result = this.heuristicDriftCheck(sessionId, goal.title, goal.description || '', recentContext, state.turnCount)

    state.history.push(result)

    // 如果启发式检测到轻微/中度漂移，异步触发 LLM 增强检测
    if (result.severity === 'minor' || result.severity === 'moderate') {
      this.runLlmEnhancedCheck(sessionId, goal.title, goal.description || '', recentContext, result)
        .catch(err => console.warn('[DriftGuard] LLM enhanced check failed:', err))
    }

    if (result.severity !== 'none') {
      state.consecutiveDrifts++

      // ★ 新增: 检测到漂移时回退目标进度
      if (this.goalService && result.severity !== 'none') {
        try {
          this.goalService.regressProgressFromDrift(
            state.goalId,
            result.severity,
            result.description
          )
        } catch (err) {
          console.warn('[DriftGuard] 回退目标进度失败:', err)
          // 不阻断漂移检测流程
        }
      }

      // 通知用户
      if (this.config.autoNotify) {
        this.notifyDrift(result)
      }

      // 连续漂移达到阈值 → 暂停监控
      if (state.consecutiveDrifts >= this.config.maxConsecutiveDrifts) {
        state.paused = true
        this.emit('drift-threshold-reached', { sessionId, consecutiveDrifts: state.consecutiveDrifts })
        try {
          sendToRenderer(IPC.DRIFT_GUARD_STATUS, {
            type: 'threshold-reached',
            sessionId,
            consecutiveDrifts: state.consecutiveDrifts,
          })
        } catch { /* ignore */ }
      }
    } else {
      // 无漂移则重置连续计数
      state.consecutiveDrifts = 0
    }

    this.emit('drift-checked', result)
    try {
      sendToRenderer(IPC.DRIFT_GUARD_STATUS, {
        type: 'checked',
        result,
      })
      } catch { /* ignore */ }

    return result
  }

  /** 启发式漂移检查（基于关键词和上下文匹配，不依赖 LLM） */
  private heuristicDriftCheck(
    sessionId: string,
    goalTitle: string,
    goalDescription: string,
    recentContext: string,
    turnNumber: number,
  ): DriftCheckResult {
    const id = `drift-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const goalKeywords = this.extractKeywords(`${goalTitle} ${goalDescription}`)

    // 如果没有最近上下文，无法判断
    if (!recentContext) {
      return {
        id, sessionId, goalId: this.sessionStates.get(sessionId)?.goalId || '',
        goalTitle, severity: 'none', description: '无足够上下文判断',
        suggestion: '', checkedAt: new Date().toISOString(), turnNumber,
      }
    }

    const contextKeywords = this.extractKeywords(recentContext)
    const overlap = this.calculateOverlap(goalKeywords, contextKeywords)

    let severity: DriftSeverity
    let description: string
    let suggestion: string

    if (overlap >= 0.5) {
      severity = 'none'
      description = '当前行为与目标保持一致'
      suggestion = ''
    } else if (overlap >= 0.3) {
      severity = 'minor'
      description = `当前对话话题与目标「${goalTitle}」部分偏离，关键词重合度 ${Math.round(overlap * 100)}%`
      suggestion = `建议将注意力拉回到核心目标：${goalTitle}`
    } else if (overlap >= 0.15) {
      severity = 'moderate'
      description = `当前行为明显偏离目标「${goalTitle}」，关键词重合度仅 ${Math.round(overlap * 100)}%`
      suggestion = `建议立即纠正方向，重新聚焦于：${goalTitle}。${goalDescription ? `目标详情：${goalDescription}` : ''}`
    } else {
      severity = 'severe'
      description = `严重偏离目标「${goalTitle}」！关键词重合度仅 ${Math.round(overlap * 100)}%，当前对话可能已完全偏离原始任务`
      suggestion = `强烈建议暂停当前行为，重新审视目标「${goalTitle}」，并明确下一步行动计划`
    }

    return {
      id, sessionId, goalId: this.sessionStates.get(sessionId)?.goalId || '',
      goalTitle, severity, description, suggestion,
      checkedAt: new Date().toISOString(), turnNumber,
    }
  }

  /** 生成纠正提示（可注入到 AI 会话中） */
  generateCorrectionPrompt(sessionId: string): string | null {
    const state = this.sessionStates.get(sessionId)
    if (!state) return null

    const goal = this.goalService?.getGoal(state.goalId)
    if (!goal) return null

    const lastDrift = [...state.history].reverse().find(d => d.severity !== 'none')
    if (!lastDrift) return null

    return [
      `[漂移护栏提醒]`,
      `目标：${goal.title}`,
      `当前进度：${goal.progress}%`,
      `检测到偏离：${lastDrift.description}`,
      `建议：${lastDrift.suggestion}`,
      `请重新聚焦目标，确认下一步行动是否与目标一致。`,
    ].join('\n')
  }

  /** 恢复暂停的监控 */
  resumeMonitoring(sessionId: string): void {
    const state = this.sessionStates.get(sessionId)
    if (state) {
      state.paused = false
      state.consecutiveDrifts = 0
      this.emit('monitoring-resumed', { sessionId })
    }
  }

  /** 更新配置 */
  updateConfig(updates: Partial<DriftConfig>): void {
    Object.assign(this.config, updates)
  }

  /** 获取配置 */
  getConfig(): DriftConfig {
    return { ...this.config }
  }

  // ── 清理 ────────────────────────────────────────────────

  cleanup(): void {
    this.sessionStates.clear()
    this.removeAllListeners()
  }

  // ── Private ─────────────────────────────────────────────

  private notifyDrift(result: DriftCheckResult): void {
    this.emit('drift-detected', result)
    try {
      sendToRenderer(IPC.DRIFT_GUARD_STATUS, {
        type: 'drift-detected',
        result,
      })
    } catch { /* ignore */ }
  }

  private getRecentConversationContext(sessionId: string): string {
    if (!this.sessionManagerV2) return ''
    try {
      const messages = this.sessionManagerV2.getConversation(sessionId)
      // 取最近 5 条消息的 content
      return messages
        .slice(-5)
        .map(m => m.content || '')
        .filter(Boolean)
        .join(' ')
    } catch {
      return ''
    }
  }

  /** 简单关键词提取（中英文混合，去掉停用词） */
  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set([
      '的', '了', '是', '在', '和', '有', '不', '这', '我', '你', '他',
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of',
      'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below',
      'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me',
      'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
      'her', 'they', 'them', 'their', 'what', 'which', 'who',
      'and', 'or', 'but', 'not', 'no', 'if', 'then', 'so',
    ])

    // 中文分词（简单：按字符切割 2-4 字组合）+ 英文按空格
    const keywords = new Set<string>()

    // 英文
    const englishWords = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || []
    for (const w of englishWords) {
      if (!stopWords.has(w)) keywords.add(w)
    }

    // 中文：2字组合
    const chineseChars = text.match(/[\u4e00-\u9fff]+/g) || []
    for (const segment of chineseChars) {
      for (let i = 0; i < segment.length - 1; i++) {
        keywords.add(segment.slice(i, i + 2))
      }
    }

    return keywords
  }

  /** 计算两个关键词集合的重合度 */
  private calculateOverlap(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0
    let overlap = 0
    for (const keyword of setB) {
      if (setA.has(keyword)) overlap++
    }
    return overlap / Math.min(setA.size, setB.size)
  }

  /** LLM 增强漂移检测（异步，结果会更新已有检测结果） */
  private async runLlmEnhancedCheck(
    sessionId: string,
    goalTitle: string,
    goalDescription: string,
    recentContext: string,
    heuristicResult: DriftCheckResult,
  ): Promise<void> {
    if (!this.sessionManagerV2) return

    const prompt = `你是一个AI行为漂移检测专家。请判断以下对话内容是否偏离了目标。

目标：${goalTitle}
${goalDescription ? `目标描述：${goalDescription}` : ''}

最近的对话内容：
${recentContext.slice(0, 4000)}

启发式初步判断：${heuristicResult.severity}（${heuristicResult.description}）

请用以下JSON格式返回你的判断：
{
  "isDrifted": true/false,
  "severity": "none"/"minor"/"moderate"/"severe",
  "reasoning": "详细理由（50-200字）",
  "suggestion": "纠正建议"
}

只返回JSON，不要其他文字。`

    const evalSessionId = `drift-eval-${Date.now()}`
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
        this.sessionManagerV2?.removeListener('conversation-message', handler)
      }
    }

    this.sessionManagerV2?.on('conversation-message', handler)

    try {
      this.sessionManagerV2?.createSession({
        id: evalSessionId,
        name: '[漂移检测] LLM 增强',
        workingDirectory: process.cwd(),
        providerId: 'claude-code',
        initialPrompt: prompt,
      })
    } catch (err) {
      this.sessionManagerV2?.removeListener('conversation-message', handler)
      return
    }

    // 等待最多 30 秒
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 500)
      setTimeout(() => {
        clearInterval(checkInterval)
        this.sessionManagerV2?.removeListener('conversation-message', handler)
        resolve()
      }, 30000)
    })

    // 解析 LLM 结果，更新现有检测结果
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return
      const parsed = JSON.parse(jsonMatch[0])

      const state = this.sessionStates.get(sessionId)
      if (!state) return

      // 只有 LLM 判断的严重程度更高时才更新
      const severityOrder: Record<string, number> = { none: 0, minor: 1, moderate: 2, severe: 3 }
      const llmSeverity = parsed.severity || 'none'
      if (severityOrder[llmSeverity] > severityOrder[heuristicResult.severity]) {
        // 创建新的更新结果对象，避免修改已返回给调用者的引用
        const updatedResult: DriftCheckResult = {
          ...heuristicResult,
          severity: llmSeverity,
          description: parsed.reasoning || heuristicResult.description,
          suggestion: parsed.suggestion || heuristicResult.suggestion,
        }

        // 替换历史记录中的最新检查结果
        const lastIdx = state.history.length - 1
        if (lastIdx >= 0 && state.history[lastIdx].id === heuristicResult.id) {
          state.history[lastIdx] = updatedResult
        }

        // 重新广播更新后的结果
        this.emit('drift-updated', updatedResult)
        try {
          sendToRenderer(IPC.DRIFT_GUARD_STATUS, {
            type: 'drift-updated',
            result: updatedResult,
          })
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('[DriftGuard] Failed to parse LLM enhanced check result:', err)
    }
  }
}
