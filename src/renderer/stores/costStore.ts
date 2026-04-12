/**
 * Cost Dashboard Store - 成本仪表盘前端状态管理
 * @author spectrai
 */
import { create } from 'zustand'

export interface CostSummary {
  todayCost: number; todayTokens: number
  monthCost: number; monthTokens: number
  totalCost: number; totalTokens: number
  byProvider: { providerId: string; providerName: string; cost: number; tokens: number }[]
  bySession: { sessionId: string; sessionName: string; cost: number; tokens: number }[]
}

export interface CostHistoryPoint {
  date: string
  cost: number
  tokens: number
  sessions: number
}

export interface BudgetConfig {
  dailyLimit: number | null
  monthlyLimit: number | null
  alertThreshold: number
  currency: 'USD' | 'CNY'
  cnyRate: number
}

export interface PricingTier {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  inputPricePer1M: number
  outputPricePer1M: number
}

interface CostState {
  summary: CostSummary | null
  history: CostHistoryPoint[]
  budget: BudgetConfig | null
  pricing: PricingTier[]
  loading: boolean
  activeTab: 'overview' | 'history' | 'settings'
  fetchSummary: () => Promise<void>
  fetchHistory: (days?: number) => Promise<void>
  fetchBudget: () => Promise<void>
  setBudget: (config: Partial<BudgetConfig>) => Promise<void>
  fetchPricing: () => Promise<void>
  updatePricing: (tiers: PricingTier[]) => Promise<void>
  setActiveTab: (tab: 'overview' | 'history' | 'settings') => void
}

const api = () => (window as any).spectrAI?.cost

export const useCostStore = create<CostState>((set, get) => ({
  summary: null,
  history: [],
  budget: null,
  pricing: [],
  loading: false,
  activeTab: 'overview',

  fetchSummary: async () => {
    set({ loading: true })
    try {
      const r = await api()?.getSummary()
      set({ summary: r?.success ? r.result : null, loading: false })
    } catch { set({ loading: false }) }
  },

  fetchHistory: async (days = 30) => {
    try {
      const r = await api()?.getHistory(days)
      if (r?.success) set({ history: r.result || [] })
    } catch { /* ignore */ }
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

  updatePricing: async (tiers) => {
    try {
      const r = await api()?.updatePricing(tiers)
      if (r?.success) set({ pricing: r.result || [] })
    } catch { /* ignore */ }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
}))
