/**
 * 上下文预算 Store - 管理会话上下文使用量监控
 */
import { create } from 'zustand'

interface ContextBudget {
  sessionId: string
  usedTokens: number
  maxTokens: number
  usagePercent: number
  messageCount: number
  messages: { role: string; tokens: number; summary: string }[]
  canCompress: boolean
  compressionSavings: number
  level: 'normal' | 'warning' | 'critical'
}

interface ContextBudgetConfig {
  warningThreshold: number
  criticalThreshold: number
  autoCompressAt: number
  maxContextTokens: number
}

interface ContextBudgetState {
  budget: ContextBudget | null
  config: ContextBudgetConfig | null
  loading: boolean
  activeTab: 'monitor' | 'settings'

  fetchBudget: (sessionId: string) => Promise<void>
  fetchConfig: () => Promise<void>
  updateConfig: (updates: Partial<ContextBudgetConfig>) => Promise<void>
  compress: (sessionId: string) => Promise<string | null>
  migrate: (sessionId: string) => Promise<string | null>
  setActiveTab: (tab: 'monitor' | 'settings') => void
}

const api = () => (window as any).spectrAI?.contextBudget

export const useContextBudgetStore = create<ContextBudgetState>((set, get) => ({
  budget: null,
  config: null,
  loading: false,
  activeTab: 'monitor',

  fetchBudget: async (sessionId: string) => {
    set({ loading: true })
    try {
      const r = await api()?.get(sessionId)
      if (r?.success) {
        set({ budget: r.budget })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  fetchConfig: async () => {
    try {
      const r = await api()?.status()
      if (r?.success) {
        set({ config: r.config })
      }
    } catch { /* ignore */ }
  },

  updateConfig: async (updates) => {
    try {
      const r = await api()?.update(updates)
      if (r?.success) {
        set({ config: r.config })
      }
    } catch { /* ignore */ }
  },

  compress: async (sessionId: string) => {
    try {
      const r = await api()?.compress(sessionId)
      return r?.message || null
    } catch { return null }
  },

  migrate: async (sessionId: string) => {
    try {
      const r = await api()?.migrate(sessionId)
      return r?.message || null
    } catch { return null }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
}))
