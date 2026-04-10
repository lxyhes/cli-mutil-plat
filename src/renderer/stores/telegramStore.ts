/**
 * Telegram Store - Telegram 远程控制状态管理
 */
import { create } from 'zustand'

export type TelegramBotStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface TelegramMapping {
  id: string
  integrationId: string
  chatId: string
  sessionId: string
  sessionName?: string
  createdAt?: string
}

export interface TelegramConfig {
  hasToken: boolean
  botToken?: string
  enabled: boolean
  commandPrefix: string
  notifyOnStart: boolean
  notifyOnEnd: boolean
  notifyOnError: boolean
}

interface TelegramState {
  config: TelegramConfig | null
  status: TelegramBotStatus
  mappings: TelegramMapping[]
  loading: boolean

  fetchConfig: () => Promise<void>
  setConfig: (config: Partial<TelegramConfig & { botToken: string }>) => Promise<any>
  deleteConfig: () => Promise<any>
  testConnection: (token: string) => Promise<any>
  fetchMappings: () => Promise<void>
  addMapping: (mapping: { chatId: string; sessionId: string; sessionName?: string }) => Promise<any>
  removeMapping: (id: string) => Promise<any>
  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null
let _messageCleanup: (() => void) | null = null

export const useTelegramStore = create<TelegramState>((set, get) => ({
  config: null,
  status: 'stopped',
  mappings: [],
  loading: false,

  fetchConfig: async () => {
    set({ loading: true })
    try {
      const result = await (window as any).spectrAI.telegram.getConfig()
      set({ config: result as TelegramConfig, status: 'stopped', loading: false })
    } catch (err) {
      console.error('[TelegramStore] fetchConfig error:', err)
      set({ loading: false })
    }
  },

  setConfig: async (config) => {
    const prev = get().config
    set((s) => ({
      config: s.config ? { ...s.config, ...config, hasToken: config.botToken ? true : s.config.hasToken } : {
        hasToken: !!config.botToken,
        enabled: false,
        commandPrefix: '/',
        notifyOnStart: true,
        notifyOnEnd: true,
        notifyOnError: true,
        ...config,
      },
    }))
    try {
      return await (window as any).spectrAI.telegram.setConfig(config)
    } catch (err: any) {
      set({ config: prev })
      return { success: false, error: { message: err.message } }
    }
  },

  deleteConfig: async () => {
    const prev = get().config
    set({ config: null, status: 'stopped', mappings: [] })
    try {
      return await (window as any).spectrAI.telegram.deleteConfig()
    } catch (err: any) {
      set({ config: prev })
      return { success: false, error: { message: err.message } }
    }
  },

  testConnection: async (token) => {
    try {
      return await (window as any).spectrAI.telegram.testConnection(token)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchMappings: async () => {
    try {
      const result = await (window as any).spectrAI.telegram.getMappings()
      set({ mappings: (result || []) as TelegramMapping[] })
    } catch (err) {
      console.error('[TelegramStore] fetchMappings error:', err)
    }
  },

  addMapping: async (mapping) => {
    try {
      const result = await (window as any).spectrAI.telegram.addMapping(mapping)
      if (result.success) {
        await get().fetchMappings()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  removeMapping: async (id) => {
    try {
      const result = await (window as any).spectrAI.telegram.removeMapping(id)
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
    _messageCleanup?.()

    _statusCleanup = (window as any).spectrAI.telegram.onStatusChanged((status: string) => {
      set({ status: status as TelegramBotStatus })
    })

    _messageCleanup = (window as any).spectrAI.telegram.onMessageSent((chatId: string, msg: string) => {
      console.log(`[Telegram] Message sent to ${chatId}: ${msg.slice(0, 50)}...`)
    })
  },

  cleanup: () => {
    _statusCleanup?.()
    _messageCleanup?.()
    _statusCleanup = null
    _messageCleanup = null
  },
}))
