/**
 * Feishu Store - 飞书集成状态管理
 */
import { create } from 'zustand'

export type FeishuStatus = 'stopped' | 'connected' | 'error'

export interface FeishuMapping {
  id: string
  integrationId: string
  chatId: string
  chatName?: string
  sessionId: string
  sessionName?: string
  createdAt?: string
}

export interface FeishuConfig {
  hasAppId: boolean
  hasWebhookUrl: boolean
  appId: string
  appSecret?: string
  webhookUrl: string
  enabled: boolean
  notifyOnStart: boolean
  notifyOnEnd: boolean
  notifyOnError: boolean
  botName: string
}

interface FeishuState {
  config: FeishuConfig | null
  status: FeishuStatus
  mappings: FeishuMapping[]
  loading: boolean

  fetchConfig: () => Promise<void>
  setConfig: (config: Partial<FeishuConfig>) => Promise<any>
  deleteConfig: () => Promise<any>
  testConnection: (config: { appId?: string; appSecret?: string; webhookUrl?: string }) => Promise<any>
  fetchMappings: () => Promise<void>
  addMapping: (mapping: { chatId: string; chatName?: string; sessionId: string; sessionName?: string }) => Promise<any>
  removeMapping: (id: string) => Promise<any>
  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null

export const useFeishuStore = create<FeishuState>((set, get) => ({
  config: null,
  status: 'stopped',
  mappings: [],
  loading: false,

  fetchConfig: async () => {
    set({ loading: true })
    try {
      const result = await (window as any).spectrAI.feishu.getConfig()
      set({ config: result as FeishuConfig, status: 'stopped', loading: false })
    } catch (err) {
      console.error('[FeishuStore] fetchConfig error:', err)
      set({ loading: false })
    }
  },

  setConfig: async (config) => {
    const prev = get().config
    set((s) => ({
      config: s.config ? { ...s.config, ...config } : {
        hasAppId: false, hasWebhookUrl: false,
        appId: '', webhookUrl: '', enabled: false,
        notifyOnStart: true, notifyOnEnd: true, notifyOnError: true,
        botName: '', ...config,
      },
    }))
    try {
      return await (window as any).spectrAI.feishu.setConfig(config)
    } catch (err: any) {
      set({ config: prev })
      return { success: false, error: { message: err.message } }
    }
  },

  deleteConfig: async () => {
    const prev = get().config
    set({ config: null, status: 'stopped', mappings: [] })
    try {
      return await (window as any).spectrAI.feishu.deleteConfig()
    } catch (err: any) {
      set({ config: prev })
      return { success: false, error: { message: err.message } }
    }
  },

  testConnection: async (config) => {
    try {
      return await (window as any).spectrAI.feishu.testConnection(config)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchMappings: async () => {
    try {
      const result = await (window as any).spectrAI.feishu.getMappings()
      set({ mappings: (result || []) as FeishuMapping[] })
    } catch (err) {
      console.error('[FeishuStore] fetchMappings error:', err)
    }
  },

  addMapping: async (mapping) => {
    try {
      const result = await (window as any).spectrAI.feishu.addMapping(mapping)
      if (result.success) await get().fetchMappings()
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  removeMapping: async (id) => {
    try {
      const result = await (window as any).spectrAI.feishu.removeMapping(id)
      if (result.success) {
        set((s) => ({ mappings: s.mappings.filter(m => m.id !== id) }))
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  initListeners: () => {
    _statusCleanup?.()
    _statusCleanup = (window as any).spectrAI.feishu.onStatusChanged((status: string) => {
      set({ status: status as FeishuStatus })
    })
  },

  cleanup: () => {
    _statusCleanup?.()
    _statusCleanup = null
  },
}))
