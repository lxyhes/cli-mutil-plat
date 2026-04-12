/**
 * Daily Report Store - 每日 AI 日报前端状态管理
 */
import { create } from 'zustand'

export interface DailyReport {
  id: string
  date: string
  sessionsCompleted: number
  filesChanged: number
  tokensUsed: number
  estimatedCost: number
  duration: number
  highlights: string[]
  providers: { name: string; sessions: number; tokens: number }[]
  summary: string
  generatedAt: string
}

export interface DailyReportConfig {
  autoGenerate: boolean
  generateTime: string
  pushToTelegram: boolean
  pushToFeishu: boolean
  includeCost: boolean
}

interface DailyReportState {
  reports: DailyReport[]
  currentReport: DailyReport | null
  config: DailyReportConfig | null
  exportedMarkdown: string | null
  loading: boolean

  fetchList: () => Promise<void>
  generate: (date?: string) => Promise<DailyReport | null>
  getReport: (date: string) => Promise<void>
  exportReport: (date: string) => Promise<string | null>
  fetchConfig: () => Promise<void>
  updateConfig: (updates: Partial<DailyReportConfig>) => Promise<void>
  deleteReport: (date: string) => Promise<void>
}

const api = () => (window as any).spectrAI?.dailyReport

export const useDailyReportStore = create<DailyReportState>((set, get) => ({
  reports: [], currentReport: null, config: null, exportedMarkdown: null, loading: false,

  fetchList: async () => {
    set({ loading: true })
    try {
      const r = await api()?.list()
      if (r?.success) {
        set({ reports: r.reports || [] })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  generate: async (date?) => {
    try {
      const r = await api()?.generate(date)
      if (r?.success) {
        await get().fetchList()
        set({ currentReport: r.report })
        return r.report
      }
      return null
    } catch { return null }
  },

  getReport: async (date) => {
    try {
      const r = await api()?.get(date)
      if (r?.success) {
        set({ currentReport: r.report || null })
      }
    } catch { /* ignore */ }
  },

  exportReport: async (date) => {
    try {
      const r = await api()?.export(date)
      if (r?.success) {
        set({ exportedMarkdown: r.markdown || null })
        return r.markdown || null
      }
      return null
    } catch { return null }
  },

  fetchConfig: async () => {
    try {
      const r = await api()?.config()
      if (r?.success) {
        set({ config: r.config })
      }
    } catch { /* ignore */ }
  },

  updateConfig: async (updates) => {
    try {
      const r = await api()?.config(updates)
      if (r?.success) {
        set({ config: r.config })
      }
    } catch { /* ignore */ }
  },

  deleteReport: async (date) => {
    try {
      await api()?.delete?.(date)
      set(prev => ({
        reports: prev.reports.filter(r => r.date !== date),
        currentReport: prev.currentReport?.date === date ? null : prev.currentReport,
      }))
    } catch { /* ignore */ }
  },
}))
