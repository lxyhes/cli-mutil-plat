/**
 * Checkpoint Store - 智能回溯前端状态管理
 * @author spectrai
 */
import { create } from 'zustand'

export interface Checkpoint {
  id: string; sessionId: string; sessionName: string; repoPath: string
  commitHash: string; branchName: string; label: string
  trigger: 'manual' | 'auto-file-change' | 'auto-tool-use' | 'auto-interval'
  description: string; fileCount: number; createdAt: string
}

interface CheckpointState {
  checkpoints: Checkpoint[]
  loading: boolean
  selectedId: string | null
  diffResult: { files: string[]; summary: string } | null
  fetchList: (sessionId: string) => Promise<void>
  create: (params: { sessionId: string; sessionName: string; repoPath: string; label: string; trigger?: Checkpoint['trigger']; description?: string }) => Promise<void>
  restore: (id: string) => Promise<{ success: boolean; message: string }>
  delete: (id: string) => Promise<void>
  diff: (fromId: string, toId: string) => Promise<void>
  setSelected: (id: string | null) => void
}

const api = () => (window as any).spectrAI?.checkpoint

export const useCheckpointStore = create<CheckpointState>((set, get) => ({
  checkpoints: [], loading: false, selectedId: null, diffResult: null,

  fetchList: async (sessionId) => {
    set({ loading: true })
    try {
      const r = await api()?.list(sessionId)
      set({ checkpoints: r?.success ? r.checkpoints || [] : [], loading: false })
    } catch { set({ loading: false }) }
  },

  create: async (params) => {
    try {
      const r = await api()?.create(params)
      if (r?.success) await get().fetchList(params.sessionId)
    } catch { /* ignore */ }
  },

  restore: async (id) => {
    try {
      const r = await api()?.restore(id)
      return r || { success: false, message: '恢复失败' }
    } catch { return { success: false, message: '恢复异常' } }
  },

  delete: async (id) => {
    try {
      await api()?.delete(id)
      set(s => ({ checkpoints: s.checkpoints.filter(c => c.id !== id) }))
    } catch { /* ignore */ }
  },

  diff: async (fromId, toId) => {
    try {
      const r = await api()?.diff(fromId, toId)
      set({ diffResult: r?.success ? r.result : null })
    } catch { /* ignore */ }
  },

  setSelected: (id) => set({ selectedId: id }),
}))
