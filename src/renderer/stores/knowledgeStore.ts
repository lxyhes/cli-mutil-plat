/**
 * Project Knowledge Store - 项目知识库前端状态管理
 * @author spectrai
 */
import { create } from 'zustand'
import type { KnowledgeEntry } from '../../shared/types'

export type { KnowledgeEntry } from '../../shared/types'

interface KnowledgeState {
  entries: KnowledgeEntry[]
  loading: boolean
  projectPath: string | null
  searchResults: KnowledgeEntry[]
  // 分页状态
  pagination: {
    page: number
    pageSize: number
    total: number
    hasMore: boolean
  }
  // 批量选择状态
  selectedIds: Set<string>
  fetchList: (projectPath: string, options?: { page?: number; pageSize?: number }) => Promise<void>
  loadMore: () => Promise<void>
  createEntry: (params: any) => Promise<KnowledgeEntry | null>
  updateEntry: (id: string, updates: any) => Promise<KnowledgeEntry | null>
  deleteEntry: (id: string) => Promise<void>
  search: (projectPath: string, query: string) => Promise<KnowledgeEntry[]>
  getPrompt: (projectPath: string) => Promise<string>
  autoExtract: (projectPath: string) => Promise<{ count: number; extracted: string[] }>
  extractFromSession: (sessionId: string, projectPath: string) => Promise<{ count: number; extracted: string[] }>
  // 批量操作
  deleteBatch: (ids: string[]) => Promise<number>
  updateBatch: (ids: string[], updates: any) => Promise<number>
  exportData: () => Promise<any | null>
  importData: (data: any) => Promise<number>
  // 选择操作
  toggleSelect: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
}

// 防抖工具函数
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: NodeJS.Timeout | null = null
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T
}

// 创建带防抖的搜索（300ms）
const createDebouncedSearch = () => {
  let currentResolve: ((value: KnowledgeEntry[]) => void) | null = null
  let currentReject: ((reason?: any) => void) | null = null

  const debouncedFn = debounce(async (projectPath: string, query: string, api: any) => {
    if (!query.trim()) {
      currentResolve?.([])
      return
    }
    try {
      const r = await api?.search(projectPath, query)
      currentResolve?.(r?.success ? r.entries || [] : [])
    } catch (e) {
      currentReject?.(e)
    }
  }, 300)

  return (projectPath: string, query: string, api: any): Promise<KnowledgeEntry[]> => {
    return new Promise((resolve, reject) => {
      currentResolve = resolve
      currentReject = reject
      debouncedFn(projectPath, query, api)
    })
  }
}

const debouncedSearch = createDebouncedSearch()

const api = () => (window as any).spectrAI?.projectKnowledge

const DEFAULT_PAGE_SIZE = 50

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  entries: [], loading: false, projectPath: null, searchResults: [],
  pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, hasMore: false },
  selectedIds: new Set(),

  fetchList: async (projectPath, options) => {
    set({ loading: true, projectPath })
    const page = options?.page || 1
    const pageSize = options?.pageSize || DEFAULT_PAGE_SIZE
    try {
      const r = await api()?.list(projectPath, { page, pageSize })
      if (r?.success) {
        set({
          entries: r.entries || [],
          pagination: {
            page,
            pageSize,
            total: r.total || 0,
            hasMore: (r.entries?.length || 0) < (r.total || 0),
          },
          loading: false,
        })
      } else {
        set({ loading: false })
      }
    } catch { set({ loading: false }) }
  },

  loadMore: async () => {
    const { pagination, projectPath, loading } = get()
    if (loading || !pagination.hasMore || !projectPath) return

    set({ loading: true })
    const nextPage = pagination.page + 1
    try {
      const r = await api()?.list(projectPath, { page: nextPage, pageSize: pagination.pageSize })
      if (r?.success) {
        set(s => ({
          entries: [...s.entries, ...(r.entries || [])],
          pagination: {
            ...s.pagination,
            page: nextPage,
            hasMore: (s.entries.length + (r.entries?.length || 0)) < (r.total || 0),
          },
          loading: false,
        }))
      } else {
        set({ loading: false })
      }
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
        set(s => ({
          entries: s.entries.filter(e => e.id !== id),
          searchResults: s.searchResults.filter(e => e.id !== id),
        }))
      }
    } catch { /* ignore */ }
  },

  search: async (projectPath, query) => {
    try {
      const results = await debouncedSearch(projectPath, query, api())
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

  extractFromSession: async (sessionId, projectPath) => {
    try {
      const r = await api()?.extractFromSession(sessionId, projectPath)
      if (r?.success && get().projectPath) await get().fetchList(get().projectPath!)
      return { count: r?.count || 0, extracted: r?.extracted || [] }
    } catch { return { count: 0, extracted: [] } }
  },

  deleteBatch: async (ids) => {
    try {
      const r = await api()?.deleteBatch(ids)
      if (r?.success) {
        set(s => ({
          entries: s.entries.filter(e => !ids.includes(e.id)),
          searchResults: s.searchResults.filter(e => !ids.includes(e.id)),
          selectedIds: new Set(),
        }))
        return r.count
      }
      return 0
    } catch { return 0 }
  },

  updateBatch: async (ids, updates) => {
    try {
      const r = await api()?.updateBatch(ids, updates)
      if (r?.success) {
        set(s => ({
          entries: s.entries.map(e => ids.includes(e.id) ? { ...e, ...updates } : e),
          searchResults: s.searchResults.map(e => ids.includes(e.id) ? { ...e, ...updates } : e),
          selectedIds: new Set(),
        }))
        return r.count
      }
      return 0
    } catch { return 0 }
  },

  exportData: async () => {
    const { projectPath } = get()
    if (!projectPath) return null
    try {
      const r = await api()?.export(projectPath)
      return r?.success ? r.data : null
    } catch { return null }
  },

  importData: async (data) => {
    const { projectPath } = get()
    if (!projectPath) return 0
    try {
      const r = await api()?.import(projectPath, data)
      if (r?.success) {
        if (projectPath) await get().fetchList(projectPath)
        return r.count
      }
      return 0
    } catch { return 0 }
  },

  toggleSelect: (id) => {
    set(s => {
      const newSet = new Set(s.selectedIds)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return { selectedIds: newSet }
    })
  },

  selectAll: () => {
    const { entries } = get()
    set({ selectedIds: new Set(entries.map(e => e.id)) })
  },

  clearSelection: () => {
    set({ selectedIds: new Set() })
  },
}))
