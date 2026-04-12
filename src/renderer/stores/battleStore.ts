/**
 * Battle Store - AI 对决模式前端状态管理
 */
import { create } from 'zustand'

export interface Battle {
  id: string; prompt: string; providerAId: string; providerBId: string
  status: string; result: any; winner: string | null; votes: any[]; createdAt: string
}

interface BattleStats {
  totalBattles: number
  providerWins: Record<string, number>
  averageDuration: number
  tieRate: number
}

interface BattleState {
  battles: Battle[]
  stats: BattleStats | null
  loading: boolean

  fetchList: () => Promise<void>
  create: (prompt: string, providerAId: string, providerBId: string) => Promise<Battle | null>
  vote: (battleId: string, choice: 'A' | 'B' | 'tie', comment?: string) => Promise<void>
  deleteBattle: (id: string) => Promise<void>
  fetchStats: () => Promise<void>
}

const api = () => (window as any).spectrAI?.battle

export const useBattleStore = create<BattleState>((set, get) => ({
  battles: [], stats: null, loading: false,

  fetchList: async () => {
    set({ loading: true })
    try {
      const r = await api()?.list()
      if (r?.success) {
        set({ battles: r.battles || [] })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  create: async (prompt, providerAId, providerBId) => {
    try {
      const r = await api()?.create({ prompt, providerAId, providerBId })
      if (r?.success) {
        await get().fetchList()
        return r.battle
      }
      return null
    } catch { return null }
  },

  vote: async (battleId, choice, comment) => {
    try {
      await api()?.vote(battleId, 'user', choice, comment)
      await get().fetchList()
      await get().fetchStats()
    } catch { /* ignore */ }
  },

  deleteBattle: async (id) => {
    try {
      await api()?.delete(id)
      set(prev => ({ battles: prev.battles.filter(b => b.id !== id) }))
    } catch { /* ignore */ }
  },

  fetchStats: async () => {
    try {
      const r = await api()?.getStats()
      if (r?.success) {
        set({ stats: r.stats })
      }
    } catch { /* ignore */ }
  },
}))
