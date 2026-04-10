/**
 * Evaluation Store - 任务评估状态管理
 */
import { create } from 'zustand'

export type EvaluationRunStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface EvaluationCriterion {
  name: string
  description: string
  max_score: number
  weight: number
}

export interface EvaluationTemplate {
  id: string
  name: string
  description?: string
  criteria: EvaluationCriterion[]
  promptTemplate: string
  createdBy?: string
  createdAt?: Date
  updatedAt?: Date
}

export interface EvaluationRun {
  id: string
  templateId: string
  sessionId: string
  status: EvaluationRunStatus
  triggerType: 'manual' | 'scheduled'
  evaluatorProvider?: string
  evaluatorModel?: string
  context?: Record<string, any>
  createdAt?: Date
  completedAt?: Date
}

export interface EvaluationResult {
  id: string
  evaluationRunId: string
  criterionName: string
  score: number
  reasoning?: string
  suggestions?: string
}

interface EvaluationState {
  templates: EvaluationTemplate[]
  runs: EvaluationRun[]
  results: Record<string, EvaluationResult[]>  // runId -> results
  loading: boolean

  fetchTemplates: () => Promise<void>
  fetchTemplate: (templateId: string) => Promise<EvaluationTemplate | null>
  createTemplate: (data: Partial<EvaluationTemplate>) => Promise<any>
  updateTemplate: (templateId: string, updates: Partial<EvaluationTemplate>) => Promise<any>
  deleteTemplate: (templateId: string) => Promise<any>
  startRun: (sessionId: string, templateId: string) => Promise<any>
  fetchRuns: (limit?: number) => Promise<void>
  fetchRun: (runId: string) => Promise<EvaluationRun | null>
  fetchResults: (runId: string) => Promise<EvaluationResult[]>
  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null

export const useEvaluationStore = create<EvaluationState>((set, get) => ({
  templates: [],
  runs: [],
  results: {},
  loading: false,

  fetchTemplates: async () => {
    set({ loading: true })
    try {
      const result = await (window as any).spectrAI.evaluation.listTemplates()
      if (result.success) {
        set({ templates: (result.data?.templates || []) as EvaluationTemplate[], loading: false })
      } else {
        set({ loading: false })
      }
    } catch (err) {
      console.error('[EvaluationStore] fetchTemplates error:', err)
      set({ loading: false })
    }
  },

  fetchTemplate: async (templateId) => {
    try {
      const result = await (window as any).spectrAI.evaluation.getTemplate(templateId)
      return result.success ? (result.data?.template as EvaluationTemplate | null) : null
    } catch (err) {
      console.error('[EvaluationStore] fetchTemplate error:', err)
      return null
    }
  },

  createTemplate: async (data) => {
    try {
      const result = await (window as any).spectrAI.evaluation.createTemplate(data)
      if (result.success) {
        await get().fetchTemplates()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updateTemplate: async (templateId, updates) => {
    try {
      const result = await (window as any).spectrAI.evaluation.updateTemplate(templateId, updates)
      if (result.success) {
        await get().fetchTemplates()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deleteTemplate: async (templateId) => {
    try {
      const result = await (window as any).spectrAI.evaluation.deleteTemplate(templateId)
      if (result.success) {
        set((s) => ({ templates: s.templates.filter(t => t.id !== templateId) }))
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  startRun: async (sessionId, templateId) => {
    try {
      return await (window as any).spectrAI.evaluation.startRun(sessionId, templateId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchRuns: async (limit = 50) => {
    try {
      const result = await (window as any).spectrAI.evaluation.listRuns(limit)
      if (result.success) {
        set({ runs: (result.data?.runs || []) as EvaluationRun[] })
      }
    } catch (err) {
      console.error('[EvaluationStore] fetchRuns error:', err)
    }
  },

  fetchRun: async (runId) => {
    try {
      const result = await (window as any).spectrAI.evaluation.getRun(runId)
      return result.success ? (result.data?.run as EvaluationRun | null) : null
    } catch (err) {
      console.error('[EvaluationStore] fetchRun error:', err)
      return null
    }
  },

  fetchResults: async (runId) => {
    try {
      const result = await (window as any).spectrAI.evaluation.getResults(runId)
      if (result.success) {
        const results = (result.data?.results || []) as EvaluationResult[]
        set((s) => ({ results: { ...s.results, [runId]: results } }))
        return results
      }
      return []
    } catch (err) {
      console.error('[EvaluationStore] fetchResults error:', err)
      return []
    }
  },

  initListeners: () => {
    _statusCleanup?.()

    _statusCleanup = (window as any).spectrAI.evaluation.onRunStatus((status: any) => {
      if (status.type === 'template-created' || status.type === 'template-updated' || status.type === 'template-deleted') {
        get().fetchTemplates()
      } else if (status.type === 'run-started' || status.type === 'run-completed' || status.type === 'run-failed') {
        get().fetchRuns()
        // Fetch results if completed
        if (status.type === 'run-completed' && status.runId) {
          get().fetchResults(status.runId)
        }
      }
    })
  },

  cleanup: () => {
    _statusCleanup?.()
    _statusCleanup = null
  },
}))
