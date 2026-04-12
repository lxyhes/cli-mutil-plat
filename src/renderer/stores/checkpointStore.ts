/**
 * Checkpoint Store - 智能回溯前端状态管理
 * 
 * 功能：创建/恢复/删除/对比代码快照，监听实时快照通知
 * @author spectrai
 */
import { create } from 'zustand'

export interface Checkpoint {
  id: string
  sessionId: string
  sessionName: string
  repoPath: string
  commitHash: string
  branchName: string
  label: string
  trigger: 'manual' | 'auto-file-change' | 'auto-tool-use' | 'auto-interval' | 'auto-turn-complete'
  description: string
  fileCount: number
  createdAt: string
}

interface CheckpointState {
  checkpoints: Checkpoint[]
  loading: boolean
  selectedId: string | null
  diffResult: { files: string[]; summary: string } | null
  autoEnabled: boolean
  /** 按会话缓存的 checkpoint 列表 */
  checkpointsBySession: Record<string, Checkpoint[]>
  /** 最近一次创建的 checkpoint（用于通知提示） */
  lastCreated: Checkpoint | null
  fetchList: (sessionId: string) => Promise<void>
  create: (params: {
    sessionId: string
    sessionName: string
    repoPath: string
    label: string
    trigger?: Checkpoint['trigger']
    description?: string
  }) => Promise<{ success: boolean; checkpoint?: Checkpoint; error?: string }>
  restore: (id: string) => Promise<{ success: boolean; message: string }>
  delete: (id: string) => Promise<void>
  diff: (fromId: string, toId: string) => Promise<void>
  setSelected: (id: string | null) => void
  setAutoEnabled: (enabled: boolean) => Promise<void>
  loadSettings: () => Promise<void>
  /** 接收主进程推送的新快照 */
  onCheckpointCreated: (sessionId: string, checkpoint: Checkpoint) => void
}

const api = () => (window as any).spectrAI?.checkpoint

export const useCheckpointStore = create<CheckpointState>((set, get) => ({
  checkpoints: [],
  loading: false,
  selectedId: null,
  diffResult: null,
  autoEnabled: true,
  checkpointsBySession: {},
  lastCreated: null,

  fetchList: async (sessionId) => {
    set({ loading: true })
    try {
      const r = await api()?.list(sessionId)
      const checkpoints = r?.success ? r.checkpoints || [] : []
      set(s => ({
        checkpoints,
        loading: false,
        checkpointsBySession: { ...s.checkpointsBySession, [sessionId]: checkpoints },
      }))
    } catch {
      set({ loading: false })
    }
  },

  create: async (params) => {
    try {
      const r = await api()?.create(params)
      if (r?.success && r?.checkpoint) {
        await get().fetchList(params.sessionId)
      }
      return r || { success: false, error: '创建失败' }
    } catch (err: any) {
      return { success: false, error: err.message || '创建异常' }
    }
  },

  restore: async (id) => {
    try {
      const r = await api()?.restore(id)
      return r || { success: false, message: '恢复失败' }
    } catch (err: any) {
      return { success: false, message: err.message || '恢复异常' }
    }
  },

  delete: async (id) => {
    try {
      await api()?.delete(id)
      set(s => ({
        checkpoints: s.checkpoints.filter(c => c.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }))
    } catch { /* ignore */ }
  },

  diff: async (fromId, toId) => {
    try {
      const r = await api()?.diff(fromId, toId)
      set({ diffResult: r?.success ? { files: r.files || [], summary: r.summary || '' } : null })
    } catch { /* ignore */ }
  },

  setSelected: (id) => set({ selectedId: id }),

  setAutoEnabled: async (enabled) => {
    try {
      await api()?.settings({ autoEnabled: enabled })
      set({ autoEnabled: enabled })
    } catch { /* ignore */ }
  },

  loadSettings: async () => {
    try {
      const r = await api()?.settings()
      if (r?.success) set({ autoEnabled: r.autoEnabled })
    } catch { /* ignore */ }
  },

  onCheckpointCreated: (sessionId, checkpoint) => {
    set(s => {
      const existing = s.checkpointsBySession[sessionId] || []
      // 避免重复
      if (existing.some(c => c.id === checkpoint.id)) return s
      const updated = [checkpoint, ...existing]
      return {
        checkpointsBySession: { ...s.checkpointsBySession, [sessionId]: updated },
        lastCreated: checkpoint,
        // 如果当前查看的正是该会话，也更新 checkpoints
        checkpoints: s.checkpoints.length > 0 && s.checkpoints[0]?.sessionId === sessionId
          ? updated
          : s.checkpoints,
      }
    })
  },
}))
