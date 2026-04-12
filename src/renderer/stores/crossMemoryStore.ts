/**
 * Cross Session Memory Store - 跨会话语义记忆前端状态管理
 * @author weibin
 */

import { create } from 'zustand'

export interface MemoryEntry {
  id: string; sessionId: string; sessionName: string
  summary: string; keyPoints: string; keywords: string; createdAt: string; relevanceScore?: number
}

export interface MemorySearchResult { query: string; entries: MemoryEntry[]; searchedAt: string }

const api = () => (window as any).spectrAI?.crossMemory

interface CrossMemoryState {
  searchResult: MemorySearchResult | null; entries: MemoryEntry[]
  stats: { totalEntries: number; uniqueSessions: number } | null; searchQuery: string; loading: boolean
  search: (query: string, limit?: number) => Promise<void>
  listAll: (limit?: number) => Promise<void>
  index: (sessionId: string, sessionName: string, summary: string, keyPoints: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  getInjectionPrompt: (sessionGoal: string) => Promise<string>
  getStats: () => Promise<void>
  setSearchQuery: (query: string) => void
}

export const useCrossMemoryStore = create<CrossMemoryState>((set) => ({
  searchResult: null, entries: [], stats: null, searchQuery: '', loading: false,
  search: async (query, limit) => {
    set({ loading: true }); try { const r = await api()?.search(query, limit); if (r?.success) set({ searchResult: r.result, loading: false }) } catch { set({ loading: false }) }
  },
  listAll: async (limit) => {
    set({ loading: true }); try { const r = await api()?.list(limit); if (r?.success) set({ entries: r.entries || [], loading: false }) } catch { set({ loading: false }) }
  },
  index: async (sessionId, sessionName, summary, keyPoints) => {
    try { await api()?.index(sessionId, sessionName, summary, keyPoints) } catch { /* ignore */ }
  },
  deleteEntry: async (id) => {
    try { await api()?.delete(id); set(s => ({ entries: s.entries.filter(e => e.id !== id) })) } catch { /* ignore */ }
  },
  getInjectionPrompt: async (sessionGoal) => {
    try { const r = await api()?.getPrompt(sessionGoal); return r?.success ? r.prompt || '' : '' } catch { return '' }
  },
  getStats: async () => {
    try { const r = await api()?.getStats(); if (r?.success) set({ stats: r.stats }) } catch { /* ignore */ }
  },
  setSearchQuery: (query) => set({ searchQuery: query }),
}))
