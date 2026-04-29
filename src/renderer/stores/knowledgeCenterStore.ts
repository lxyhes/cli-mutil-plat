/**
 * 知识中心统一状态管理
 * 整合项目知识库、跨会话记忆、工作记忆的查询与操作
 */
import { create } from 'zustand'
import type {
  UnifiedKnowledgeEntry,
  UnifiedKnowledgeType,
  UnifiedKnowledgeQuery,
  UnifiedKnowledgeResult,
  CreateUnifiedKnowledgeParams,
  UpdateUnifiedKnowledgeParams,
  UnifiedKnowledgeCategory,
  UnifiedKnowledgeExport,
  KnowledgeScope,
  KnowledgeLifecycle,
  KnowledgeUsageStats
} from '../../shared/knowledgeCenterTypes'

// IPC 调用封装
const ipc = {
  invoke: async (channel: string, ...args: any[]): Promise<any> => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      return (window as any).electronAPI.ipcRenderer.invoke(channel, ...args)
    }
    throw new Error('IPC not available')
  }
}

interface KnowledgeCenterState {
  // ===== 数据状态 =====
  entries: UnifiedKnowledgeEntry[]
  loading: boolean
  error: string | null

  // ===== 分页状态 =====
  pagination: {
    total: number
    hasMore: boolean
    page: number
    pageSize: number
  }

  // ===== 当前上下文 =====
  currentProjectPath: string | null
  currentSessionId: string | null
  currentTab: UnifiedKnowledgeType | 'all'

  // ===== 批量操作 =====
  selectedIds: Set<string>

  // ===== 搜索与过滤 =====
  searchQuery: string
  filterCategory: UnifiedKnowledgeCategory | null
  filterPriority: string | null
  filterScope: KnowledgeScope | 'all'
  filterLifecycle: KnowledgeLifecycle | 'all'

  // ===== 统计 =====
  stats: KnowledgeUsageStats[]
}

interface KnowledgeCenterActions {
  // ===== 数据操作 =====
  fetchEntries: (query?: UnifiedKnowledgeQuery) => Promise<void>
  loadMore: () => Promise<void>
  refresh: () => Promise<void>

  // ===== CRUD =====
  createEntry: (params: CreateUnifiedKnowledgeParams) => Promise<UnifiedKnowledgeEntry | null>
  updateEntry: (id: string, params: UpdateUnifiedKnowledgeParams) => Promise<boolean>
  deleteEntry: (id: string) => Promise<boolean>
  deleteBatch: (ids: string[]) => Promise<boolean>
  updateBatch: (ids: string[], params: UpdateUnifiedKnowledgeParams) => Promise<boolean>

  // ===== 批量选择 =====
  toggleSelect: (id: string) => void
  selectAll: () => void
  clearSelection: () => void

  // ===== 自动注入 =====
  toggleAutoInject: (id: string, autoInject: boolean) => Promise<boolean>

  // ===== 导入导出 =====
  exportData: (projectPath?: string) => Promise<UnifiedKnowledgeExport | null>
  importData: (data: UnifiedKnowledgeExport) => Promise<number>

  // ===== 自动提取 =====
  autoExtract: (projectPath: string) => Promise<{ count: number; extracted: string[] }>
  extractFromSession: (sessionId: string, projectPath: string) => Promise<{ count: number; extracted: string[] }>

  // ===== 跨会话记忆专用 =====
  searchMemory: (query: string, limit?: number) => Promise<UnifiedKnowledgeEntry[]>

  // ===== 上下文设置 =====
  setCurrentProject: (path: string | null) => void
  setCurrentSession: (id: string | null) => void
  setCurrentTab: (tab: UnifiedKnowledgeType | 'all') => void

  // ===== 搜索与过滤 =====
  setSearchQuery: (query: string) => void
  setFilterCategory: (category: UnifiedKnowledgeCategory | null) => void
  setFilterPriority: (priority: string | null) => void
  setFilterScope: (scope: KnowledgeScope | 'all') => void
  setFilterLifecycle: (lifecycle: KnowledgeLifecycle | 'all') => void

  // ===== 工具 =====
  getFilteredEntries: () => UnifiedKnowledgeEntry[]
  getEntryById: (id: string) => UnifiedKnowledgeEntry | undefined
  getEntriesByType: (type: UnifiedKnowledgeType) => UnifiedKnowledgeEntry[]
  getAutoInjectEntries: () => UnifiedKnowledgeEntry[]
}

const PAGE_SIZE = 20

export const useKnowledgeCenterStore = create<KnowledgeCenterState & KnowledgeCenterActions>((set, get) => ({
  // ===== 初始状态 =====
  entries: [],
  loading: false,
  error: null,
  pagination: { total: 0, hasMore: false, page: 1, pageSize: PAGE_SIZE },
  currentProjectPath: null,
  currentSessionId: null,
  currentTab: 'project-knowledge',
  selectedIds: new Set(),
  searchQuery: '',
  filterCategory: null,
  filterPriority: null,
  filterScope: 'all',
  filterLifecycle: 'all',
  stats: [],

  // ===== 数据操作 =====
  fetchEntries: async (query?: UnifiedKnowledgeQuery) => {
    const { currentProjectPath, currentTab, searchQuery, filterCategory, filterPriority, filterScope, filterLifecycle } = get()
    set({ loading: true, error: null })

    try {
      // 构建查询参数
      const baseQuery: UnifiedKnowledgeQuery = {
        page: 1,
        pageSize: PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        ...query
      }

      // 根据当前 Tab 过滤类型
      if (currentTab !== 'all' && !baseQuery.type) {
        baseQuery.type = currentTab
      }

      if (filterScope !== 'all') {
        baseQuery.scope = filterScope
      }

      if (filterLifecycle !== 'all') {
        baseQuery.lifecycle = filterLifecycle
      }

      if (searchQuery) {
        baseQuery.searchQuery = searchQuery
      }

      if (filterCategory) {
        baseQuery.category = filterCategory
      }

      if (filterPriority) {
        baseQuery.priority = filterPriority as any
      }

      // 项目路径过滤（项目级知识）
      if (!baseQuery.projectPath && currentProjectPath && (currentTab === 'project-knowledge' || currentTab === 'working-memory')) {
        baseQuery.projectPath = currentProjectPath
      }

      // 调用 IPC 获取数据
      const result: UnifiedKnowledgeResult = await ipc.invoke('knowledge-center:query', baseQuery)

      set({
        entries: result.entries,
        pagination: {
          total: result.total,
          hasMore: result.hasMore,
          page: result.page,
          pageSize: result.pageSize
        },
        loading: false
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '获取知识条目失败',
        loading: false
      })
    }
  },

  loadMore: async () => {
    const { pagination, currentProjectPath, currentTab, searchQuery, filterCategory, filterPriority, filterScope, filterLifecycle } = get()
    if (!pagination.hasMore || pagination.page >= Math.ceil(pagination.total / pagination.pageSize)) {
      return
    }

    set({ loading: true })

    try {
      const nextPage = pagination.page + 1
      const query: UnifiedKnowledgeQuery = {
        page: nextPage,
        pageSize: PAGE_SIZE,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        type: currentTab === 'all' ? undefined : currentTab,
        projectPath: currentProjectPath && (currentTab === 'project-knowledge' || currentTab === 'working-memory') ? currentProjectPath : undefined,
        scope: filterScope === 'all' ? undefined : filterScope,
        lifecycle: filterLifecycle === 'all' ? undefined : filterLifecycle,
        searchQuery: searchQuery || undefined,
        category: filterCategory || undefined,
        priority: filterPriority ? filterPriority as any : undefined
      }

      const result: UnifiedKnowledgeResult = await ipc.invoke('knowledge-center:query', query)

      set(state => ({
        entries: [...state.entries, ...result.entries],
        pagination: {
          total: result.total,
          hasMore: result.hasMore,
          page: result.page,
          pageSize: result.pageSize
        },
        loading: false
      }))
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '加载更多失败',
        loading: false
      })
    }
  },

  refresh: async () => {
    const { fetchEntries, searchQuery, filterCategory } = get()
    await fetchEntries({
      searchQuery: searchQuery || undefined,
      category: filterCategory || undefined
    })
  },

  // ===== CRUD =====
  createEntry: async (params) => {
    set({ loading: true })
    try {
      const entry: UnifiedKnowledgeEntry = await ipc.invoke('knowledge-center:create', params)
      set(state => ({
        entries: [entry, ...state.entries],
        pagination: { ...state.pagination, total: state.pagination.total + 1 },
        loading: false
      }))
      return entry
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '创建知识条目失败',
        loading: false
      })
      return null
    }
  },

  updateEntry: async (id, params) => {
    set({ loading: true })
    try {
      const updated: UnifiedKnowledgeEntry = await ipc.invoke('knowledge-center:update', id, params)
      set(state => ({
        entries: state.entries.map(e => e.id === id ? updated : e),
        loading: false
      }))
      return true
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '更新知识条目失败',
        loading: false
      })
      return false
    }
  },

  deleteEntry: async (id) => {
    set({ loading: true })
    try {
      await ipc.invoke('knowledge-center:delete', id)
      set(state => ({
        entries: state.entries.filter(e => e.id !== id),
        pagination: { ...state.pagination, total: state.pagination.total - 1 },
        selectedIds: new Set([...state.selectedIds].filter(sid => sid !== id)),
        loading: false
      }))
      return true
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '删除知识条目失败',
        loading: false
      })
      return false
    }
  },

  deleteBatch: async (ids) => {
    if (ids.length === 0) return false
    set({ loading: true })
    try {
      await ipc.invoke('knowledge-center:delete-batch', ids)
      set(state => ({
        entries: state.entries.filter(e => !ids.includes(e.id)),
        pagination: { ...state.pagination, total: state.pagination.total - ids.length },
        selectedIds: new Set(),
        loading: false
      }))
      return true
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '批量删除失败',
        loading: false
      })
      return false
    }
  },

  updateBatch: async (ids, params) => {
    if (ids.length === 0) return false
    set({ loading: true })
    try {
      const updated: UnifiedKnowledgeEntry[] = await ipc.invoke('knowledge-center:update-batch', ids, params)
      const updatedMap = new Map(updated.map(u => [u.id, u]))
      set(state => ({
        entries: state.entries.map(e => updatedMap.has(e.id) ? updatedMap.get(e.id)! : e),
        loading: false
      }))
      return true
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '批量更新失败',
        loading: false
      })
      return false
    }
  },

  // ===== 批量选择 =====
  toggleSelect: (id) => {
    set(state => {
      const newSet = new Set(state.selectedIds)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return { selectedIds: newSet }
    })
  },

  selectAll: () => {
    set(state => ({
      selectedIds: new Set(state.entries.map(e => e.id))
    }))
  },

  clearSelection: () => {
    set({ selectedIds: new Set() })
  },

  // ===== 自动注入 =====
  toggleAutoInject: async (id, autoInject) => {
    const { updateEntry } = get()
    return await updateEntry(id, { autoInject })
  },

  // ===== 导入导出 =====
  exportData: async (projectPath) => {
    try {
      const data: UnifiedKnowledgeExport = await ipc.invoke('knowledge-center:export', projectPath)
      return data
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '导出失败' })
      return null
    }
  },

  importData: async (data) => {
    set({ loading: true })
    try {
      const count: number = await ipc.invoke('knowledge-center:import', data)
      await get().refresh()
      set({ loading: false })
      return count
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '导入失败',
        loading: false
      })
      return 0
    }
  },

  // ===== 自动提取 =====
  autoExtract: async (projectPath) => {
    set({ loading: true })
    try {
      const result = await ipc.invoke('knowledge-center:auto-extract', projectPath)
      await get().refresh()
      set({ loading: false })
      return result
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '自动提取失败',
        loading: false
      })
      return { count: 0, extracted: [] }
    }
  },

  extractFromSession: async (sessionId, projectPath) => {
    set({ loading: true })
    try {
      const result = await ipc.invoke('knowledge-center:extract-from-session', sessionId, projectPath)
      await get().refresh()
      set({ loading: false })
      return result
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '从会话提取失败',
        loading: false
      })
      return { count: 0, extracted: [] }
    }
  },

  // ===== 跨会话记忆专用 =====
  searchMemory: async (query, limit = 10) => {
    try {
      const results: UnifiedKnowledgeEntry[] = await ipc.invoke('knowledge-center:search-memory', query, limit)
      return results
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '搜索记忆失败' })
      return []
    }
  },

  // ===== 上下文设置 =====
  setCurrentProject: (path) => {
    set({ currentProjectPath: path })
    // 自动刷新数据
    get().fetchEntries()
  },

  setCurrentSession: (id) => {
    set({ currentSessionId: id })
  },

  setCurrentTab: (tab) => {
    set({ currentTab: tab })
    // 切换 Tab 时自动刷新
    get().fetchEntries()
  },

  // ===== 搜索与过滤 =====
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  setFilterCategory: (category) => {
    set({ filterCategory: category })
  },

  setFilterPriority: (priority) => {
    set({ filterPriority: priority })
  },

  setFilterScope: (scope) => {
    set({ filterScope: scope })
    get().fetchEntries()
  },

  setFilterLifecycle: (lifecycle) => {
    set({ filterLifecycle: lifecycle })
    get().fetchEntries()
  },

  // ===== 工具 =====
  getFilteredEntries: () => {
    const { entries, searchQuery, filterCategory, filterPriority, filterScope, filterLifecycle } = get()
    return entries.filter(e => {
      if (filterScope !== 'all' && e.scope !== filterScope) return false
      if (filterLifecycle !== 'all' && e.lifecycle !== filterLifecycle) return false
      if (filterCategory && e.category !== filterCategory) return false
      if (filterPriority && e.priority !== filterPriority) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
      }
      return true
    })
  },

  getEntryById: (id) => {
    return get().entries.find(e => e.id === id)
  },

  getEntriesByType: (type) => {
    return get().entries.filter(e => e.type === type)
  },

  getAutoInjectEntries: () => {
    return get().entries.filter(e => e.autoInject)
  }
}))

export default useKnowledgeCenterStore
