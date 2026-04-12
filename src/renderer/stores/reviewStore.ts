/**
 * Code Review Store - AI 代码审查前端状态管理
 * @author spectrai
 */
import { create } from 'zustand'

export interface ReviewComment {
  id: string; reviewId: string; filePath: string; lineStart: number; lineEnd: number
  severity: string; category: string; message: string; suggestion: string; resolved: boolean; createdAt: string
}

export interface CodeReview {
  id: string; sessionId: string; sessionName: string; repoPath: string
  status: string; targetFiles: string[]; summary: string; score: number
  totalComments: number; criticalCount: number; createdAt: string; completedAt: string | null
}

interface ReviewSettings {
  autoReviewEnabled: boolean
  autoReviewInterval: number
}

interface ReviewState {
  reviews: CodeReview[]
  comments: ReviewComment[]
  loading: boolean
  settings: ReviewSettings | null
  fetchList: (sessionId?: string) => Promise<void>
  fetchComments: (reviewId: string) => Promise<void>
  startReview: (params: any) => Promise<CodeReview | null>
  resolveComment: (commentId: string) => Promise<void>
  applyFix: (commentId: string) => Promise<{ success: boolean; message: string }>
  fetchSettings: () => Promise<void>
  updateSettings: (updates: Partial<ReviewSettings>) => Promise<void>
}

const api = () => (window as any).spectrAI?.codeReview

export const useReviewStore = create<ReviewState>((set, get) => ({
  reviews: [], comments: [], loading: false, settings: null,

  fetchList: async (sessionId) => {
    set({ loading: true })
    try {
      const r = await api()?.list(sessionId)
      set({ reviews: r?.success ? r.reviews || [] : [], loading: false })
    } catch { set({ loading: false }) }
  },

  fetchComments: async (reviewId) => {
    try {
      const r = await api()?.getComments(reviewId)
      set({ comments: r?.success ? r.comments || [] : [] })
    } catch { /* ignore */ }
  },

  startReview: async (params) => {
    try {
      const r = await api()?.start(params)
      if (r?.success) {
        const review = r.review
        if (get().reviews.length > 0) {
          set(s => ({ reviews: [review, ...s.reviews] }))
        }
        return review
      }
      return null
    } catch { return null }
  },

  resolveComment: async (commentId) => {
    try {
      await api()?.resolveComment(commentId)
      set(s => ({ comments: s.comments.map(c => c.id === commentId ? { ...c, resolved: true } : c) }))
    } catch { /* ignore */ }
  },

  applyFix: async (commentId) => {
    try {
      const r = await api()?.applyFix(commentId)
      return r || { success: false, message: '应用失败' }
    } catch { return { success: false, message: '应用异常' } }
  },

  fetchSettings: async () => {
    try {
      const r = await api()?.settings()
      if (r?.success) set({ settings: r.settings })
    } catch { /* ignore */ }
  },

  updateSettings: async (updates) => {
    try {
      const r = await api()?.settings(updates)
      if (r?.success) set({ settings: r.settings })
    } catch { /* ignore */ }
  },
}))
