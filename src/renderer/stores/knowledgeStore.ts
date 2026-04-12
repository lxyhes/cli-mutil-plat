/**
 * Project Knowledge Store - 项目知识库前端状态管理
 * @author spectrai
 */
import { create } from 'zustand'

export interface KnowledgeEntry {
  id: string; projectPath: string; category: string; title: string; content: string
  tags: string[]; priority: string; autoInject: boolean; source: string; createdAt: string; updatedAt: string
}

interface KnowledgeState {
  entries: KnowledgeEntry[]
  loading: boolean
  projectPath: string | null
  searchResults: KnowledgeEntry[]
  fetchList: (projectPath: string) => Promise<void>
  createEntry: (params: any) => Promise<KnowledgeEntry | null>
  updateEntry: (id: string, updates: any) => Promise<KnowledgeEntry | null>
  deleteEntry: (id: string) => Promise<void>
  search: (projectPath: string, query: string) => Promise<KnowledgeEntry[]>
  getPrompt: (projectPath: string) => Promise<string>
  autoExtract: (projectPath: string) => Promise<{ count: number; extracted: string[] }>
}

const api = () => (window as any).spectrAI?.projectKnowledge

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  entries: [], loading: false, projectPath: null, searchResults: [],

  fetchList: async (projectPath) => {
    set({ loading: true, projectPath })
    try {
      const r = await api()?.list(projectPath)
      set({ entries: r?.success ? r.entries || [] : [], loading: false })
    } catch { set({ loading: false }) }
  },

  createEntry: async (params) => {
    try {
      const r = await api()?.create(params)
      if (r?.success) {
        const entry = r.entry
        if (get().projectPath) await get().fetchList(get().projectPath!)
        return entry
      }
      return null
    } catch { return null }
  },

  updateEntry: async (id, updates) => {
    try {
      const r = await api()?.update(id, updates)
      if (r?.success) {
        if (get().projectPath) await get().fetchList(get().projectPath!)
        return r.entry
      }
      return null
    } catch { return null }
  },

  deleteEntry: async (id) => {
    try {
      const r = await api()?.delete(id)
      if (r?.success) {
        set(s => ({ entries: s.entries.filter(e => e.id !== id) }))
      }
    } catch { /* ignore */ }
  },

  search: async (projectPath, query) => {
    try {
      const r = await api()?.search(projectPath, query)
      const results = r?.success ? r.entries || [] : []
      set({ searchResults: results })
      return results
    } catch { return [] }
  },

  getPrompt: async (projectPath) => {
    try {
      const r = await api()?.getPrompt(projectPath)
      return r?.success ? r.prompt || '' : ''
    } catch { return '' }
  },

  autoExtract: async (projectPath) => {
    try {
      const r = await api()?.autoExtract(projectPath)
      if (r?.success && get().projectPath) await get().fetchList(get().projectPath!)
      return { count: r?.count || 0, extracted: r?.extracted || [] }
    } catch { return { count: 0, extracted: [] } }
  },
}))
