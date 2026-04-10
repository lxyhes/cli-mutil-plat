/**
 * Prompt Optimizer Store - 提示词模板管理与优化状态
 */
import { create } from 'zustand'

export interface PromptVariable {
  name: string
  description?: string
  defaultValue?: string
  type?: 'string' | 'number' | 'boolean'
}

export interface PromptTemplate {
  id: string
  name: string
  description?: string
  category?: string
  tags: string[]
  variables: PromptVariable[]
  currentVersionId?: string
  isActive: boolean
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface PromptVersion {
  id: string
  templateId: string
  versionNumber: number
  content: string
  systemPrompt?: string
  variablesValues: Record<string, any>
  changeNotes?: string
  score?: number
  testCount: number
  isBaseline: boolean
  createdBy?: string
  createdAt: string
}

export interface PromptTest {
  id: string
  versionId: string
  testInput: string
  testOutput?: string
  tokensUsed?: number
  durationMs?: number
  score?: number
  metadata?: Record<string, any>
  createdAt: string
}

export interface PromptOptimizationRun {
  id: string
  templateId: string
  targetVersionId: string
  status: 'running' | 'completed' | 'failed'
  optimizationStrategy: 'auto' | 'guided' | 'template'
  promptBefore?: string
  promptAfter?: string
  improvementScore?: number
  iterations: number
  startedAt: string
  completedAt?: string
}

export interface PromptFeedback {
  id: string
  optimizationRunId: string
  criterion: string
  scoreBefore?: number
  scoreAfter?: number
  feedbackText?: string
  createdAt: string
}

export interface TestStats {
  avgScore: number
  avgTokens: number
  avgDuration: number
  count: number
}

interface PromptOptimizerState {
  templates: PromptTemplate[]
  activeTemplate: PromptTemplate | null
  versions: Record<string, PromptVersion[]>
  activeVersion: PromptVersion | null
  tests: Record<string, PromptTest[]>
  testStats: Record<string, TestStats>
  optimizationRuns: PromptOptimizationRun[]
  activeRun: PromptOptimizationRun | null
  loading: boolean

  // Template actions
  fetchTemplates: (category?: string) => Promise<void>
  fetchTemplate: (id: string) => Promise<PromptTemplate | null>
  createTemplate: (data: Partial<PromptTemplate>) => Promise<any>
  updateTemplate: (id: string, updates: Partial<PromptTemplate>) => Promise<any>
  deleteTemplate: (id: string) => Promise<any>
  setActiveTemplate: (template: PromptTemplate | null) => void

  // Version actions
  fetchVersions: (templateId: string) => Promise<void>
  createVersion: (templateId: string, data: Partial<PromptVersion>) => Promise<any>
  updateVersion: (id: string, updates: Partial<PromptVersion>) => Promise<any>
  setBaseline: (versionId: string) => Promise<any>
  setActiveVersion: (version: PromptVersion | null) => void

  // Test actions
  runTest: (versionId: string, testInput: string, providerId?: string) => Promise<any>
  compareVersions: (versionId1: string, versionId2: string, testInput: string) => Promise<any>
  fetchTests: (versionId: string, limit?: number) => Promise<void>
  fetchTestStats: (versionId: string) => Promise<void>

  // Optimization actions
  optimizeAuto: (templateId: string, targetVersionId: string) => Promise<any>
  optimizeWithHints: (templateId: string, targetVersionId: string, hints: string) => Promise<any>
  fetchOptimizationRun: (runId: string) => Promise<any>
  fetchOptimizationRuns: (templateId?: string, limit?: number) => Promise<void>
  promoteBest: (templateId: string) => Promise<any>
  fetchEvolution: (templateId: string) => Promise<{ versions: PromptVersion[]; optimizationRuns: PromptOptimizationRun[] } | null>

  initListeners: () => void
  cleanup: () => void
}

let _statusCleanup: (() => void) | null = null

export const usePromptOptimizerStore = create<PromptOptimizerState>((set, get) => ({
  templates: [],
  activeTemplate: null,
  versions: {},
  activeVersion: null,
  tests: {},
  testStats: {},
  optimizationRuns: [],
  activeRun: null,
  loading: false,

  // ── Templates ──────────────────────────────────────────────

  fetchTemplates: async (category?: string) => {
    set({ loading: true })
    try {
      const templates = await (window as any).spectrAI.promptOptimizer.listTemplates(category)
      set({ templates: (templates || []) as PromptTemplate[], loading: false })
    } catch (err) {
      console.error('[PromptOptimizerStore] fetchTemplates error:', err)
      set({ loading: false })
    }
  },

  fetchTemplate: async (id) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.getTemplate(id) as PromptTemplate | null
    } catch (err) {
      console.error('[PromptOptimizerStore] fetchTemplate error:', err)
      return null
    }
  },

  createTemplate: async (data) => {
    try {
      const result = await (window as any).spectrAI.promptOptimizer.createTemplate(data)
      if (result.success) {
        await get().fetchTemplates()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updateTemplate: async (id, updates) => {
    try {
      const result = await (window as any).spectrAI.promptOptimizer.updateTemplate(id, updates)
      if (result.success) {
        await get().fetchTemplates()
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deleteTemplate: async (id) => {
    try {
      const result = await (window as any).spectrAI.promptOptimizer.deleteTemplate(id)
      if (result.success) {
        set((s) => ({
          templates: s.templates.filter(t => t.id !== id),
          activeTemplate: s.activeTemplate?.id === id ? null : s.activeTemplate,
        }))
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  deleteVersion: async (id) => {
    try {
      const result = await (window as any).spectrAI.promptOptimizer.deleteVersion(id)
      if (result.success && result.data?.templateId) {
        const templateId = result.data.templateId
        set((s) => ({
          versions: {
            ...s.versions,
            [templateId]: (s.versions[templateId] || []).filter(v => v.id !== id),
          },
        }))
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  setActiveTemplate: (template) => set({ activeTemplate: template }),

  // ── Versions ───────────────────────────────────────────────

  fetchVersions: async (templateId) => {
    try {
      const versions = await (window as any).spectrAI.promptOptimizer.listVersions(templateId) as PromptVersion[]
      set((s) => ({ versions: { ...s.versions, [templateId]: versions || [] } }))
    } catch (err) {
      console.error('[PromptOptimizerStore] fetchVersions error:', err)
    }
  },

  createVersion: async (templateId, data) => {
    try {
      const result = await (window as any).spectrAI.promptOptimizer.createVersion({ templateId, ...data })
      if (result.success) {
        await get().fetchVersions(templateId)
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  updateVersion: async (id, updates) => {
    try {
      const result = await (window as any).spectrAI.promptOptimizer.updateVersion(id, updates)
      if (result.success) {
        const { activeTemplate } = get()
        if (activeTemplate) await get().fetchVersions(activeTemplate.id)
      }
      return result
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  setBaseline: async (versionId) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.setBaseline(versionId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  setActiveVersion: (version) => set({ activeVersion: version }),

  // ── Testing ───────────────────────────────────────────────

  runTest: async (versionId, testInput, providerId) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.runTest(versionId, testInput, providerId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  compareVersions: async (versionId1, versionId2, testInput) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.compare(versionId1, versionId2, testInput)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchTests: async (versionId, limit = 20) => {
    try {
      const tests = await (window as any).spectrAI.promptOptimizer.listTests(versionId, limit) as PromptTest[]
      set((s) => ({ tests: { ...s.tests, [versionId]: tests || [] } }))
    } catch (err) {
      console.error('[PromptOptimizerStore] fetchTests error:', err)
    }
  },

  fetchTestStats: async (versionId) => {
    try {
      const stats = await (window as any).spectrAI.promptOptimizer.getTestStats(versionId) as TestStats
      if (stats) set((s) => ({ testStats: { ...s.testStats, [versionId]: stats } }))
    } catch (err) {
      console.error('[PromptOptimizerStore] fetchTestStats error:', err)
    }
  },

  // ── Optimization ───────────────────────────────────────────

  optimizeAuto: async (templateId, targetVersionId) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.optimizeAuto(templateId, targetVersionId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  optimizeWithHints: async (templateId, targetVersionId, hints) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.optimizeWithHints(templateId, targetVersionId, hints)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchOptimizationRun: async (runId) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.getOptimizationRun(runId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchOptimizationRuns: async (templateId?: string, limit = 20) => {
    try {
      const runs = await (window as any).spectrAI.promptOptimizer.listOptimizationRuns(templateId, limit) as PromptOptimizationRun[]
      set({ optimizationRuns: runs || [] })
    } catch (err) {
      console.error('[PromptOptimizerStore] fetchOptimizationRuns error:', err)
    }
  },

  promoteBest: async (templateId) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.promoteBest(templateId)
    } catch (err: any) {
      return { success: false, error: { message: err.message } }
    }
  },

  fetchEvolution: async (templateId) => {
    try {
      return await (window as any).spectrAI.promptOptimizer.getEvolution(templateId)
    } catch (err) {
      console.error('[PromptOptimizerStore] fetchEvolution error:', err)
      return null
    }
  },

  // ── Listeners ─────────────────────────────────────────────

  initListeners: () => {
    _statusCleanup?.()

    _statusCleanup = (window as any).spectrAI.promptOptimizer.onStatus((status: any) => {
      if (!status || !status.type) return
      const { type } = status

      if (type === 'template-created') {
        set((s) => ({ templates: [status.template, ...s.templates] }))
      } else if (type === 'template-updated') {
        set((s) => ({
          templates: s.templates.map(t => t.id === status.template.id ? status.template : t),
          activeTemplate: s.activeTemplate?.id === status.template.id ? status.template : s.activeTemplate,
        }))
      } else if (type === 'template-deleted') {
        set((s) => ({
          templates: s.templates.filter(t => t.id !== status.templateId),
          activeTemplate: s.activeTemplate?.id === status.templateId ? null : s.activeTemplate,
        }))
      } else if (type === 'version-created' || type === 'version-updated') {
        const { activeTemplate } = get()
        if (activeTemplate) get().fetchVersions(activeTemplate.id)
      } else if (type === 'baseline-changed') {
        const { activeTemplate } = get()
        if (activeTemplate) get().fetchVersions(activeTemplate.id)
      } else if (type === 'test-completed') {
        get().fetchTests(status.versionId)
        get().fetchTestStats(status.versionId)
      } else if (type === 'optimization-started') {
        get().fetchOptimizationRuns()
      } else if (type === 'optimization-completed') {
        get().fetchOptimizationRuns()
        const { activeTemplate } = get()
        if (activeTemplate) get().fetchVersions(activeTemplate.id)
      } else if (type === 'optimization-failed') {
        get().fetchOptimizationRuns()
      } else if (type === 'best-promoted') {
        const { activeTemplate } = get()
        if (activeTemplate) get().fetchVersions(activeTemplate.id)
      }
    })
  },

  cleanup: () => {
    _statusCleanup?.()
    _statusCleanup = null
  },
}))
