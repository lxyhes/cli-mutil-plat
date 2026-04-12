/**
 * MCP 服务器状态管理
 * @author weibin
 */
import { create } from 'zustand'
import type { IpcResponse } from '../../shared/errors'
import type { McpServer } from '../../shared/types'
import { safeAPI } from '../utils/api'

interface McpState {
  servers: McpServer[]
  loading: boolean
  error: string | null

  fetchAll: () => Promise<void>
  create: (server: Omit<McpServer, 'createdAt' | 'updatedAt'>) => Promise<McpServer | null>
  update: (id: string, updates: Partial<McpServer>) => Promise<void>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  testConnection: (id: string) => Promise<{ success: boolean; message?: string; error?: string }>
  clearError: () => void
}

export const useMcpStore = create<McpState>((set, _get) => ({
  servers: [],
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null })
    try {
      const result = await safeAPI.mcp.getAll()
      if (result.success) {
        // 防御性检查：确保 servers 始终是数组
        const serversData = result.data
        const servers = Array.isArray(serversData) ? serversData : []
        set({ servers, loading: false })
      } else {
        set({ error: result.error, loading: false })
      }
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  create: async (server) => {
    try {
      const result = await safeAPI.mcp.create(server)
      if (result.success) {
        const created = (result.data as any)?.server ?? result.data
        set(state => ({ servers: [...state.servers, created] }))
        return created
      }
      set({ error: result.error })
      return null
    } catch (err) {
      set({ error: (err as Error).message })
      return null
    }
  },

  update: async (id, updates) => {
    try {
      const result = await safeAPI.mcp.update(id, updates)
      if (result.success) {
        set(state => ({
          servers: state.servers.map(s => s.id === id ? { ...s, ...updates } : s)
        }))
      } else {
        set({ error: result.error })
      }
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  remove: async (id) => {
    try {
      const result = await safeAPI.mcp.delete(id)
      if (result.success) {
        set(state => ({ servers: state.servers.filter(s => s.id !== id) }))
      } else {
        set({ error: result.error })
      }
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  toggle: async (id, enabled) => {
    try {
      const result = await safeAPI.mcp.toggle(id, enabled)
      if (result.success) {
        set(state => ({
          servers: state.servers.map(s => s.id === id ? { ...s, isGlobalEnabled: enabled } : s)
        }))
      } else {
        set({ error: result.error })
      }
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  testConnection: async (id) => {
    try {
      return await safeAPI.mcp.testConnection(id)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  },

  clearError: () => set({ error: null }),
}))
