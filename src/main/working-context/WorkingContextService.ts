/**
 * WorkingContextService - 会话级工作记忆
 *
 * 每个会话关联一个轻量工作上下文（当前任务、遇到的问题、已做决策、待办、关键代码片段）
 * 切换会话时自动快照，切回来时一键恢复
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'

// ─── 类型定义 ─────────────────────────────────────────────

export interface WorkingContext {
  /** 关联的会话 ID */
  sessionId: string
  /** 当前任务描述 */
  currentTask: string
  /** 遇到的问题 */
  problems: ContextItem[]
  /** 已做决策 */
  decisions: ContextItem[]
  /** 待办事项 */
  todos: ContextItem[]
  /** 关键代码片段 */
  codeSnippets: CodeSnippet[]
  /** AI 自动提取的关键点 */
  autoExtractedPoints: string[]
  /** 最后更新时间 */
  updatedAt: string
  /** 快照列表 */
  snapshots: ContextSnapshot[]
}

export interface ContextItem {
  id: string
  content: string
  createdAt: string
  resolved?: boolean
  resolvedAt?: string
}

export interface CodeSnippet {
  id: string
  filePath: string
  lineRange?: string
  content: string
  note?: string
  createdAt: string
}

export interface ContextSnapshot {
  id: string
  timestamp: string
  trigger: 'manual' | 'session-switch' | 'auto-interval'
  summary: string
  items: {
    task: string
    problemCount: number
    decisionCount: number
    todoCount: number
    unresolvedProblems: number
  }
}

// ─── 服务 ─────────────────────────────────────────────────

export class WorkingContextService extends EventEmitter {
  private contexts: Map<string, WorkingContext> = new Map()
  private autoExtractInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    super()
  }

  // ── CRUD ────────────────────────────────────────────────

  /** 获取或创建会话的工作上下文 */
  getOrCreateContext(sessionId: string): WorkingContext {
    if (!this.contexts.has(sessionId)) {
      this.contexts.set(sessionId, {
        sessionId,
        currentTask: '',
        problems: [],
        decisions: [],
        todos: [],
        codeSnippets: [],
        autoExtractedPoints: [],
        updatedAt: new Date().toISOString(),
        snapshots: [],
      })
    }
    return this.contexts.get(sessionId)!
  }

  /** 获取上下文（不创建） */
  getContext(sessionId: string): WorkingContext | null {
    return this.contexts.get(sessionId) || null
  }

  /** 更新当前任务 */
  updateTask(sessionId: string, task: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.currentTask = task
    ctx.updatedAt = new Date().toISOString()
    this.emitChange(sessionId, 'task-updated', ctx)
    return ctx
  }

  /** 添加问题 */
  addProblem(sessionId: string, content: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.problems.push({
      id: `prob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      createdAt: new Date().toISOString(),
    })
    ctx.updatedAt = new Date().toISOString()
    this.emitChange(sessionId, 'problem-added', ctx)
    return ctx
  }

  /** 标记问题已解决 */
  resolveProblem(sessionId: string, problemId: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const prob = ctx.problems.find(p => p.id === problemId)
    if (prob) {
      prob.resolved = true
      prob.resolvedAt = new Date().toISOString()
      ctx.updatedAt = new Date().toISOString()
      this.emitChange(sessionId, 'problem-resolved', ctx)
    }
    return ctx
  }

  /** 添加决策 */
  addDecision(sessionId: string, content: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.decisions.push({
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      createdAt: new Date().toISOString(),
    })
    ctx.updatedAt = new Date().toISOString()
    this.emitChange(sessionId, 'decision-added', ctx)
    return ctx
  }

  /** 添加待办 */
  addTodo(sessionId: string, content: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.todos.push({
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      content,
      createdAt: new Date().toISOString(),
    })
    ctx.updatedAt = new Date().toISOString()
    this.emitChange(sessionId, 'todo-added', ctx)
    return ctx
  }

  /** 标记待办完成 */
  resolveTodo(sessionId: string, todoId: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const todo = ctx.todos.find(t => t.id === todoId)
    if (todo) {
      todo.resolved = true
      todo.resolvedAt = new Date().toISOString()
      ctx.updatedAt = new Date().toISOString()
      this.emitChange(sessionId, 'todo-resolved', ctx)
    }
    return ctx
  }

  /** 添加代码片段 */
  addCodeSnippet(sessionId: string, snippet: Omit<CodeSnippet, 'id' | 'createdAt'>): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.codeSnippets.push({
      id: `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...snippet,
      createdAt: new Date().toISOString(),
    })
    ctx.updatedAt = new Date().toISOString()
    this.emitChange(sessionId, 'snippet-added', ctx)
    return ctx
  }

  /** 删除条目 */
  removeItem(sessionId: string, category: 'problems' | 'decisions' | 'todos' | 'codeSnippets', itemId: string): WorkingContext {
    const ctx = this.getOrCreateContext(sessionId)
    const list = ctx[category] as ContextItem[] | CodeSnippet[]
    const idx = list.findIndex(item => item.id === itemId)
    if (idx >= 0) {
      list.splice(idx, 1)
      ctx.updatedAt = new Date().toISOString()
      this.emitChange(sessionId, 'item-removed', ctx)
    }
    return ctx
  }

  // ── 快照 ────────────────────────────────────────────────

  /** 创建快照 */
  createSnapshot(sessionId: string, trigger: ContextSnapshot['trigger'] = 'manual'): ContextSnapshot | null {
    const ctx = this.contexts.get(sessionId)
    if (!ctx) return null

    const snapshot: ContextSnapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      trigger,
      summary: ctx.currentTask || '未命名任务',
      items: {
        task: ctx.currentTask,
        problemCount: ctx.problems.length,
        decisionCount: ctx.decisions.length,
        todoCount: ctx.todos.length,
        unresolvedProblems: ctx.problems.filter(p => !p.resolved).length,
      },
    }

    ctx.snapshots.push(snapshot)
    ctx.updatedAt = new Date().toISOString()
    this.emitChange(sessionId, 'snapshot-created', ctx)
    return snapshot
  }

  /** 会话切换时自动快照（从旧会话切出） */
  onSessionSwitchOut(fromSessionId: string): ContextSnapshot | null {
    const ctx = this.contexts.get(fromSessionId)
    if (!ctx || !ctx.currentTask) return null
    return this.createSnapshot(fromSessionId, 'session-switch')
  }

  /** 生成上下文摘要文本（注入给 AI 作为隐藏上下文） */
  generateContextPrompt(sessionId: string): string {
    const ctx = this.contexts.get(sessionId)
    if (!ctx) return ''

    const parts: string[] = []

    if (ctx.currentTask) {
      parts.push(`当前任务: ${ctx.currentTask}`)
    }

    const unresolvedProblems = ctx.problems.filter(p => !p.resolved)
    if (unresolvedProblems.length > 0) {
      parts.push(`未解决的问题:\n${unresolvedProblems.map(p => `- ${p.content}`).join('\n')}`)
    }

    if (ctx.decisions.length > 0) {
      parts.push(`已做决策:\n${ctx.decisions.map(d => `- ${d.content}`).join('\n')}`)
    }

    const unresolvedTodos = ctx.todos.filter(t => !t.resolved)
    if (unresolvedTodos.length > 0) {
      parts.push(`待办事项:\n${unresolvedTodos.map(t => `- ${t.content}`).join('\n')}`)
    }

    if (ctx.autoExtractedPoints.length > 0) {
      parts.push(`自动提取的关键点:\n${ctx.autoExtractedPoints.map(p => `- ${p}`).join('\n')}`)
    }

    return parts.length > 0
      ? `[工作上下文记忆]\n${parts.join('\n\n')}\n[/工作上下文记忆]`
      : ''
  }

  /** AI 自动从对话中提取关键点（由外部调用） */
  setAutoExtractedPoints(sessionId: string, points: string[]): void {
    const ctx = this.getOrCreateContext(sessionId)
    ctx.autoExtractedPoints = points
    ctx.updatedAt = new Date().toISOString()
    this.emitChange(sessionId, 'auto-extracted', ctx)
  }

  // ── 清理 ────────────────────────────────────────────────

  /** 清理会话的工作上下文 */
  removeContext(sessionId: string): boolean {
    const deleted = this.contexts.delete(sessionId)
    if (deleted) {
      this.emitChange(sessionId, 'context-removed', null)
    }
    return deleted
  }

  /** 获取所有活跃上下文的会话 ID */
  getActiveSessionIds(): string[] {
    return [...this.contexts.keys()]
  }

  // ── 生命周期 ────────────────────────────────────────────

  /** 启动自动提取定时器 */
  startAutoExtract(intervalMs = 300000): void {
    if (this.autoExtractInterval) return
    this.autoExtractInterval = setInterval(() => {
      this.emit('auto-extract-tick', [...this.contexts.keys()])
    }, intervalMs)
  }

  /** 停止自动提取 */
  stopAutoExtract(): void {
    if (this.autoExtractInterval) {
      clearInterval(this.autoExtractInterval)
      this.autoExtractInterval = null
    }
  }

  /** 清理所有上下文 */
  cleanup(): void {
    this.stopAutoExtract()
    this.contexts.clear()
    this.removeAllListeners()
  }

  // ── Private ─────────────────────────────────────────────

  private emitChange(sessionId: string, eventType: string, context: WorkingContext | null): void {
    this.emit('context-changed', { sessionId, eventType, context })
    try {
      sendToRenderer(IPC.WORKING_CONTEXT_STATUS, { type: eventType, sessionId, context })
    } catch { /* ignore */ }
  }
}
