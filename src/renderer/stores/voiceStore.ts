/**
 * 语音交互 Store
 */
import { makeAutoObservable } from 'mobx'
import { ipcRenderer } from 'electron'

export interface VoiceConfig {
  enabled: boolean
  language: string
  autoSpeak: boolean
  speechRate: number
  wakeWord: string
  transcriptionProvider: 'local' | 'whisper-api'
  whisperApiKey?: string
  whisperApiUrl?: string
}

export interface VoiceStatus {
  isListening: boolean
  isSpeaking: boolean
  lastTranscript: string | null
  error: string | null
}

export interface VoiceHistoryEntry {
  id: string
  timestamp: string
  type: 'input' | 'output'
  text: string
}

class VoiceStore {
  config: VoiceConfig | null = null
  status: VoiceStatus = { isListening: false, isSpeaking: false, lastTranscript: null, error: null }
  history: VoiceHistoryEntry[] = []
  loading = false
  error: string | null = null

  constructor() {
    makeAutoObservable(this)
  }

  private api() {
    return (window as any).api?.voice
  }

  /** 加载配置和状态 */
  async loadConfig() {
    try {
      const res = await this.api()?.getConfig?.()
      if (res?.success) this.config = res.config
    } catch (e: any) {
      this.error = e.message
    }
  }

  /** 加载状态 */
  async loadStatus() {
    try {
      const res = await this.api()?.getStatus?.()
      if (res?.success) this.status = res.status
    } catch (e: any) {
      this.error = e.message
    }
  }

  /** 开始监听 */
  async startListening() {
    this.loading = true
    try {
      const res = await this.api()?.startListening?.()
      if (res?.success) {
        this.status.isListening = true
        this.status.error = null
      } else {
        this.error = res?.message || '启动监听失败'
      }
    } catch (e: any) {
      this.error = e.message
    } finally {
      this.loading = false
    }
  }

  /** 停止监听 */
  async stopListening() {
    try {
      const res = await this.api()?.stopListening?.()
      if (res?.success) {
        this.status.isListening = false
        if (res.transcript) this.status.lastTranscript = res.transcript
      }
    } catch (e: any) {
      this.error = e.message
    }
  }

  /** 语音播报 */
  async speak(text: string) {
    if (!text.trim()) return
    this.status.isSpeaking = true
    try {
      const res = await this.api()?.speak?.(text)
      if (!res?.success) this.error = res?.message || '播报失败'
    } catch (e: any) {
      this.error = e.message
    } finally {
      this.status.isSpeaking = false
    }
  }

  /** 模拟语音输入（用于测试） */
  async simulateInput(text: string) {
    try {
      await this.api()?.simulateInput?.(text)
      this.status.lastTranscript = text
      await this.loadHistory()
    } catch (e: any) {
      this.error = e.message
    }
  }

  /** 更新配置 */
  async updateConfig(updates: Partial<VoiceConfig>) {
    try {
      const res = await this.api()?.updateConfig?.(updates)
      if (res?.success) this.config = res.config
    } catch (e: any) {
      this.error = e.message
    }
  }

  /** 加载历史 */
  async loadHistory() {
    try {
      const res = await this.api()?.getHistory?.(50)
      if (res?.success) this.history = res.history
    } catch (e: any) {
      this.error = e.message
    }
  }

  /** 清除历史 */
  async clearHistory() {
    try {
      const res = await this.api()?.clearHistory?.()
      if (res?.success) this.history = []
    } catch (e: any) {
      this.error = e.message
    }
  }
}

export const voiceStore = new VoiceStore()
