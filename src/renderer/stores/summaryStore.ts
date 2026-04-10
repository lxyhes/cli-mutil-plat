/**
 * Summary Store - 会话摘要状态管理
 */
import { create } from 'zustand'

export type SummaryType = 'auto' | 'manual' | 'key_points'

export interface SessionSummary {
  id?: number
  sessionId: string
  summary: string
  keyPoints?: string
  aiProvider?: string
  aiModel?: string
  inputTokens?: number
  outputTokens?: number
  tokensUsed?: number
  costUsd?: number
  qualityScore?: number
  summaryType: SummaryType
  updatedAt?: string
  createdAt?: string
  /** 来自 listAllLatestSummaries 的额外字段 */
  sessionName?: string
  sessionStatus?: string
}

interface SummaryState {
  /** 当前选中会话的摘要列表 */
  summaries: SessionSummary[]
  /** 所有会话的最新摘要 */
  allSummaries: SessionSummary[]
  /** 是否正在生成摘要 */
  generating: boolean
  /** 自动摘要是否启用 */
  autoEnabled: boolean
  /** 当前加载状态 */
  loading: boolean

  /** 获取会话的所有摘要 */
  fetchSummaries: (sessionId: string, limit?: number) => Promise<void>
  /** 获取所有会话的最新摘要 */
  fetchAllSummaries: (limit?: number) => Promise<void>
  /** 生成摘要 */
  generateSummary: (sessionId: string, options?: {
    type?: SummaryType
    includeKeyPoints?: boolean
    providerId?: string
    model?: string
  }) => Promise<any>
  /** 获取单个摘要 */
  fetchSummary: (id: number) => Promise<SessionSummary | null>
  /** 更新摘要 */
  updateSummary: (id: number, updates: {
    summary?: string
    keyPoints?: string
    qualityScore?: number
    summaryType?: SummaryType
  }) => Promise<any>
  /** 删除摘要 */
  deleteSummary: (id: number) => Promise<any>
  /** 设置自动摘要开关 */
  setAutoEnabled: (enabled: boolean) => void
  /** 获取会话最新摘要 */
  getLatest: (sessionId: string) => Promise<SessionSummary | null>
}

export const useSummaryStore = create<SummaryState>((set, get) => ({
  summaries: [],
  allSummaries: [],
  generating: false,
  autoEnabled: false,
  loading: false,

  fetchSummaries: async (sessionId, limit = 20) => {
    set({ loading: true })
    try {
      const result = await (window as any).spectrAI.summary.listSummaries(sessionId, limit)
      set({ summaries: (result?.success ? result.data : result) || [], loading: false })
    } catch (err) {
      console.error('[SummaryStore] fetchSummaries error:', err)
      set({ loading: false })
    }
  },

  fetchAllSummaries: async (limit = 50) => {
    set({ loading: true })
    try {
      const result = await (window as any).spectrAI.summary.listAllSummaries(limit)
      set({ allSummaries: (result?.success ? result.data : result) || [], loading: false })
    } catch (err) {
      console.error('[SummaryStore] fetchAllSummaries error:', err)
      set({ loading: false })
    }
  },

  generateSummary: async (sessionId, options) => {
    set({ generating: true })
    try {
      const result = await (window as any).spectrAI.summary.generate(sessionId, options)
      if (result?.success) {
        // 刷新会话摘要列表
        await get().fetchSummaries(sessionId)
        // 同时刷新全局列表
        await get().fetchAllSummaries()
      }
      set({ generating: false })
      return result
    } catch (err: any) {
      set({ generating: false })
      return { success: false, error: { message: err.message } }
    }
  },

  fetchSummary: async (id) => {
    try {
      const result = await (window as any).spectrAI.summary.getSummary(id)
      return result?.success ? result.data : null
    } catch (err) {
      console.error('[SummaryStore] fetchSummary error:', err)
      return null
    }
  },

  updateSummary: async (id, updates) => {
    try {
      const result = await (window as any).spectrAI.summary.updateSummary(id, updates)
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deleteSummary: async (id) => {
    try {
      const result = await (window as any).spectrAI.summary.deleteSummary(id)
      if (result?.success) {
        set((s) => ({
          summaries: s.summaries.filter((sm) => sm.id !== id),
          allSummaries: s.allSummaries.filter((sm) => sm.id !== id),
        }))
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  setAutoEnabled: (enabled) => {
    set({ autoEnabled: enabled })
  },

  getLatest: async (sessionId) => {
    try {
      const result = await (window as any).spectrAI.summary.getLatest(sessionId)
      return result?.success ? result.data : null
    } catch (err) {
      console.error('[SummaryStore] getLatest error:', err)
      return null
    }
  },
}))
