/**
 * Cost Dashboard Store - 成本仪表盘前端状态管理
 * @author spectrai
 */
import { create } from 'zustand'

export interface CostSummary {
  todayCost: number; todayTokens: number; monthCost: number; monthTokens: number
  totalCost: number; totalTokens: number
  byProvider: { providerId: string; providerName: string; cost: number; tokens: number }[]
  bySession: { sessionId: string; sessionName: string; cost: number; tokens: number }[]
}

interface CostState {
  summary: CostSummary | null
  budget: { dailyLimit: number | null; monthlyLimit: number | null; alertThreshold: number; currency: string } | null
  pricing: any[]
  loading: boolean
  fetchSummary: () => Promise<void>
  fetchBudget: () => Promise<void>
  setBudget: (config: any) => Promise<void>
  fetchPricing: () => Promise<void>
}

const api = () => (window as any).spectrAI?.cost

export const useCostStore = create<CostState>((set) => ({
  summary: null, budget: null, pricing: [], loading: false,

  fetchSummary: async () => {
    set({ loading: true })
    try {
      const r = await api()?.getSummary()
      set({ summary: r?.success ? r.result : null, loading: false })
    } catch { set({ loading: false }) }
  },

  fetchBudget: async () => {
    try {
      const r = await api()?.getBudget()
      set({ budget: r?.success ? r.result : null })
    } catch { /* ignore */ }
  },

  setBudget: async (config) => {
    try {
      const r = await api()?.setBudget(config)
      set({ budget: r?.success ? r.result : null })
    } catch { /* ignore */ }
  },

  fetchPricing: async () => {
    try {
      const r = await api()?.getPricing()
      if (r?.success) set({ pricing: r.result || [] })
    } catch { /* ignore */ }
  },
}))
