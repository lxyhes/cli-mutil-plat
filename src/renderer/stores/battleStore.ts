/**
 * Battle Store - AI 对决模式前端状态管理
 * @author spectrai
 */
import { create } from 'zustand'

export interface Battle {
  id: string; prompt: string; providerAId: string; providerBId: string
  status: string; result: any; winner: string | null; votes: any[]; createdAt: string
}

interface BattleState {
  battles: Battle[]
  stats: { totalBattles: number; providerWins: Record<string, number> } | null
  loading: boolean
  fetchList: () => Promise<void>
  create: (prompt: string, providerAId: string, providerBId: string) => Promise<Battle | null>
  vote: (battleId: string, choice: 'A' | 'B' | 'tie', comment?: string) => Promise<void>
  fetchStats: () => Promise<void>
}

const api = () => (window as any).spectrAI?.battle

export const useBattleStore = create<BattleState>((set, get) => ({
  battles: [], stats: null, loading: false,

  fetchList: async () => {
    set({ loading: true })
    try {
      const r = await api()?.list()
      set({ battles: r?.success ? r.battles || [] : [], loading: false })
    } catch { set({ loading: false }) }
  },

  create: async (prompt, providerAId, providerBId) => {
    try {
      const r = await api()?.create({ prompt, providerAId, providerBId })
      if (r?.success) { await get().fetchList(); return r.battle }
      return null
    } catch { return null }
  },

  vote: async (battleId, choice, comment) => {
    try {
      await api()?.vote(battleId, 'user', choice, comment)
      await get().fetchList()
    } catch { /* ignore */ }
  },

  fetchStats: async () => {
    try {
      const r = await api()?.getStats()
      set({ stats: r?.success ? r.stats : null })
    } catch { /* ignore */ }
  },
}))
