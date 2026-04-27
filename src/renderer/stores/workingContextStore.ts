/**
 * Working Context Store - 会话级工作记忆前端状态管理
 * @author weibin
 */

import { create } from 'zustand'

// ─── 类型定义 ─────────────────────────────────────────────

export interface ContextItem {
  id: string
  content: string
  createdAt: string
  isPinned?: boolean
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
  isPinned?: boolean
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

export interface WorkingContext {
  sessionId: string
  currentTask: string
  problems: ContextItem[]
  decisions: ContextItem[]
  todos: ContextItem[]
  codeSnippets: CodeSnippet[]
  autoExtractedPoints: string[]
  updatedAt: string
  snapshots: ContextSnapshot[]
}

const api = () => (window as any).spectrAI?.workingContext

interface WorkingContextState {
  currentContext: WorkingContext | null
  loading: boolean
  error: string | null
  get: (sessionId: string) => Promise<void>
  updateTask: (sessionId: string, task: string) => Promise<void>
  addProblem: (sessionId: string, content: string) => Promise<void>
  resolveProblem: (sessionId: string, problemId: string) => Promise<void>
  addDecision: (sessionId: string, content: string) => Promise<void>
  addTodo: (sessionId: string, content: string) => Promise<void>
  resolveTodo: (sessionId: string, todoId: string) => Promise<void>
  addSnippet: (sessionId: string, snippet: Omit<CodeSnippet, 'id' | 'createdAt'>) => Promise<void>
  removeItem: (sessionId: string, category: 'problems' | 'decisions' | 'todos' | 'codeSnippets', itemId: string) => Promise<void>
  setItemPinned: (sessionId: string, category: 'problems' | 'decisions' | 'todos' | 'codeSnippets', itemId: string, pinned: boolean) => Promise<void>
  createSnapshot: (sessionId: string, trigger?: 'manual' | 'session-switch' | 'auto-interval') => Promise<void>
  getContextPrompt: (sessionId: string) => Promise<string>
}

export const useWorkingContextStore = create<WorkingContextState>((set) => ({
  currentContext: null,
  loading: false,
  error: null,

  get: async (sessionId) => {
    set({ loading: true, error: null })
    try {
      const result = await api()?.get(sessionId)
      if (result?.success) set({ currentContext: result.context, loading: false })
    } catch (err) { set({ error: String(err), loading: false }) }
  },
  updateTask: async (sessionId, task) => {
    try { const r = await api()?.updateTask(sessionId, task); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  addProblem: async (sessionId, content) => {
    try { const r = await api()?.addProblem(sessionId, content); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  resolveProblem: async (sessionId, problemId) => {
    try { const r = await api()?.resolveProblem(sessionId, problemId); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  addDecision: async (sessionId, content) => {
    try { const r = await api()?.addDecision(sessionId, content); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  addTodo: async (sessionId, content) => {
    try { const r = await api()?.addTodo(sessionId, content); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  resolveTodo: async (sessionId, todoId) => {
    try { const r = await api()?.resolveTodo(sessionId, todoId); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  addSnippet: async (sessionId, snippet) => {
    try { const r = await api()?.addSnippet(sessionId, snippet); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  removeItem: async (sessionId, category, itemId) => {
    try { const r = await api()?.removeItem(sessionId, category, itemId); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  setItemPinned: async (sessionId, category, itemId, pinned) => {
    try { const r = await api()?.setPinned(sessionId, category, itemId, pinned); if (r?.success) set({ currentContext: r.context }) } catch (e) { set({ error: String(e) }) }
  },
  createSnapshot: async (sessionId, trigger) => {
    try { await api()?.createSnapshot(sessionId, trigger) } catch (e) { set({ error: String(e) }) }
  },
  getContextPrompt: async (sessionId) => {
    try { const r = await api()?.getPrompt(sessionId); return r?.success ? r.prompt : '' } catch { return '' }
  },
}))
