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
  fetchList: (projectPath: string) => Promise<void>
  createEntry: (params: any) => Promise<void>
  updateEntry: (id: string, updates: any) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  search: (projectPath: string, query: string) => Promise<KnowledgeEntry[]>
  autoExtract: (projectPath: string) => Promise<number>
}

const api = () => (window as any).spectrAI?.projectKnowledge

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  entries: [], loading: false, projectPath: null,

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
      if (r?.success && get().projectPath) await get().fetchList(get().projectPath!)
    } catch { /* ignore */ }
  },

  updateEntry: async (id, updates) => {
    try {
      await api()?.update(id, updates)
      if (get().projectPath) await get().fetchList(get().projectPath!)
    } catch { /* ignore */ }
  },

  deleteEntry: async (id) => {
    try {
      await api()?.delete(id)
      set(s => ({ entries: s.entries.filter(e => e.id !== id) }))
    } catch { /* ignore */ }
  },

  search: async (projectPath, query) => {
    try {
      const r = await api()?.search(projectPath, query)
      return r?.success ? r.entries || [] : []
    } catch { return [] }
  },

  autoExtract: async (projectPath) => {
    try {
      const r = await api()?.autoExtract(projectPath)
      if (get().projectPath) await get().fetchList(get().projectPath!)
      return r?.count || 0
    } catch { return 0 }
  },
}))
