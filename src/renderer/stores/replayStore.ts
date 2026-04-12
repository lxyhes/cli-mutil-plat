/**
 * 会话录像 Store - 管理录制状态和录像列表
 */
import { create } from 'zustand'

interface ReplayEvent {
  type: string
  timestamp: number
  sessionId: string
  data: any
}

interface SessionReplay {
  id: string
  sessionId: string
  sessionName: string
  duration: number
  eventCount: number
  keyMoments: { timestamp: number; label: string }[]
  status: 'recording' | 'completed' | 'exported'
  createdAt: string
  completedAt: string | null
}

interface ReplaySettings {
  autoRecordEnabled: boolean
  maxDuration: number
  captureEvents: string[]
}

interface ReplayState {
  replays: SessionReplay[]
  currentReplay: SessionReplay | null
  currentEvents: ReplayEvent[]
  settings: ReplaySettings | null
  recordingSessionIds: Set<string>
  loading: boolean
  activeTab: 'list' | 'player' | 'settings'

  fetchList: (limit?: number) => Promise<void>
  startRecording: (sessionId: string, sessionName: string) => Promise<boolean>
  stopRecording: (sessionId: string) => Promise<void>
  deleteReplay: (id: string) => Promise<void>
  fetchEvents: (replayId: string) => Promise<void>
  exportReplay: (id: string) => Promise<string | null>
  fetchSettings: () => Promise<void>
  updateSettings: (updates: Partial<ReplaySettings>) => Promise<void>
  isRecording: (sessionId: string) => Promise<boolean>
  setActiveTab: (tab: 'list' | 'player' | 'settings') => void
  setCurrentReplay: (replay: SessionReplay | null) => void
}

const api = () => (window as any).spectrAI?.replay

export const useReplayStore = create<ReplayState>((set, get) => ({
  replays: [],
  currentReplay: null,
  currentEvents: [],
  settings: null,
  recordingSessionIds: new Set(),
  loading: false,
  activeTab: 'list',

  fetchList: async (limit?: number) => {
    set({ loading: true })
    try {
      const r = await api()?.list(limit)
      if (r?.success) {
        set({ replays: r.replays || [] })
        // 更新录制中的 sessionId 列表
        const recordingIds = new Set<string>((r.replays || []).filter((rp: any) => rp.status === 'recording').map((rp: any) => rp.sessionId as string))
        set({ recordingSessionIds: recordingIds })
      }
    } catch { /* ignore */ }
    set({ loading: false })
  },

  startRecording: async (sessionId: string, sessionName: string) => {
    try {
      const r = await api()?.startRecording(sessionId, sessionName)
      if (r?.success) {
        set(prev => ({
          recordingSessionIds: new Set([...prev.recordingSessionIds, sessionId])
        }))
        return true
      }
    } catch { /* ignore */ }
    return false
  },

  stopRecording: async (sessionId: string) => {
    try {
      await api()?.stopRecording(sessionId)
      set(prev => {
        const next = new Set(prev.recordingSessionIds)
        next.delete(sessionId)
        return { recordingSessionIds: next }
      })
      get().fetchList()
    } catch { /* ignore */ }
  },

  deleteReplay: async (id: string) => {
    try {
      await api()?.delete(id)
      set(prev => ({ replays: prev.replays.filter(r => r.id !== id) }))
    } catch { /* ignore */ }
  },

  fetchEvents: async (replayId: string) => {
    try {
      const r = await api()?.getEvents(replayId)
      if (r?.success) {
        set({ currentEvents: r.events || [] })
      }
    } catch { /* ignore */ }
  },

  exportReplay: async (id: string) => {
    try {
      const r = await api()?.export(id)
      if (r?.success && r.data) {
        return JSON.stringify(r.data, null, 2)
      }
    } catch { /* ignore */ }
    return null
  },

  fetchSettings: async () => {
    try {
      const r = await api()?.settings()
      if (r?.success) {
        set({ settings: r.settings })
      }
    } catch { /* ignore */ }
  },

  updateSettings: async (updates) => {
    try {
      const r = await api()?.settings(updates)
      if (r?.success) {
        set({ settings: r.settings })
      }
    } catch { /* ignore */ }
  },

  isRecording: async (sessionId: string) => {
    try {
      const r = await api()?.isRecording(sessionId)
      return r?.recording ?? false
    } catch { return false }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setCurrentReplay: (replay) => set({ currentReplay: replay, currentEvents: [] }),
}))
