/**
 * Arena Store - 技能竞技场前端状态管理
 */
import { create } from 'zustand'

export interface ArenaSkill {
  id: string
  name: string
  author: string
  description: string
  category: string
  promptTemplate: string
  codeQualityScore: number
  executionSpeedScore: number
  tokenEfficiencyScore: number
  overallScore: number
  voteCount: number
  upVotes: number
  submittedAt: string
}

export interface LeaderboardEntry {
  rank: number
  skillId: string
  name: string
  author: string
  category: string
  overallScore: number
  voteCount: number
}

interface ArenaStats {
  totalSkills: number
  totalVotes: number
  categories: number
}

interface ArenaState {
  skills: ArenaSkill[]
  leaderboard: LeaderboardEntry[]
  selectedSkill: ArenaSkill | null
  stats: ArenaStats | null
  categories: string[]
  loading: boolean

  fetchList: (category?: string) => Promise<void>
  fetchLeaderboard: (category?: string) => Promise<void>
  fetchStats: () => Promise<void>
  fetchCategories: () => Promise<void>
  submit: (params: { name: string; author: string; description: string; category: string; promptTemplate: string }) => Promise<ArenaSkill | null>
  vote: (skillId: string, up: boolean) => Promise<void>
  getScores: (skillId: string) => Promise<void>
  deleteSkill: (id: string) => Promise<void>
}

const api = () => (window as any).spectrAI?.skillArena

export const useArenaStore = create<ArenaState>((set, get) => ({
  skills: [], leaderboard: [], selectedSkill: null, stats: null, categories: [], loading: false,

  fetchList: async (category?) => {
    set({ loading: true })
    try {
      const r = await api()?.list(category)
      if (r?.success) {
        set({ skills: r.skills || [] })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  fetchLeaderboard: async (category?) => {
    try {
      const r = await api()?.getLeaderboard(category)
      if (r?.success) {
        set({ leaderboard: r.leaderboard || [] })
      }
    } catch { /* ignore */ }
  },

  fetchStats: async () => {
    try {
      const r = await api()?.getStats()
      if (r?.success) {
        set({ stats: r })
      }
    } catch { /* ignore */ }
  },

  fetchCategories: async () => {
    try {
      const r = await api()?.getCategories()
      if (r?.success) {
        set({ categories: r.categories || [] })
      }
    } catch { /* ignore */ }
  },

  submit: async (params) => {
    try {
      const r = await api()?.submit(params)
      if (r?.success) {
        await get().fetchList()
        return r.skill
      }
      return null
    } catch { return null }
  },

  vote: async (skillId, up) => {
    try {
      await api()?.vote(skillId, up)
      await get().fetchList()
    } catch { /* ignore */ }
  },

  getScores: async (skillId) => {
    try {
      const r = await api()?.getScores(skillId)
      if (r?.success) {
        set({ selectedSkill: r.skill || null })
      }
    } catch { /* ignore */ }
  },

  deleteSkill: async (id) => {
    try {
      await api()?.delete(id)
      set(prev => ({
        skills: prev.skills.filter(s => s.id !== id),
        selectedSkill: prev.selectedSkill?.id === id ? null : prev.selectedSkill,
      }))
    } catch { /* ignore */ }
  },
}))
