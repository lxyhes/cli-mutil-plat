/**
 * Session Template Store - 会话模板前端状态管理
 * @author weibin
 */

import { create } from 'zustand'

export type TemplateCategory = 'coding' | 'review' | 'docs' | 'testing' | 'debug' | 'architecture' | 'custom'

export interface SessionTemplate {
  id: string; name: string; description: string; icon: string; category: TemplateCategory
  defaultProviderId: string; defaultWorkingDir: string; systemPrompt: string; initialPrompt: string
  mcpServers: string[]; enableAgent: boolean; supervisorMode: boolean
  envOverrides: Record<string, string>; sortOrder: number; isBuiltin: boolean
  createdAt: string; updatedAt: string
}

const api = () => (window as any).spectrAI?.sessionTemplate

interface SessionTemplateState {
  templates: SessionTemplate[]
  categories: Array<{ id: TemplateCategory; name: string; icon: string }>
  selectedCategory: TemplateCategory | null; loading: boolean
  listTemplates: (category?: TemplateCategory) => Promise<void>
  getTemplate: (id: string) => Promise<SessionTemplate | null>
  createTemplate: (data: Omit<SessionTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltin'>) => Promise<SessionTemplate | null>
  updateTemplate: (id: string, updates: Partial<SessionTemplate>) => Promise<SessionTemplate | null>
  deleteTemplate: (id: string) => Promise<boolean>
  loadCategories: () => Promise<void>
  setSelectedCategory: (category: TemplateCategory | null) => void
}

export const useSessionTemplateStore = create<SessionTemplateState>((set, get) => ({
  templates: [], categories: [], selectedCategory: null, loading: false,
  listTemplates: async (category) => {
    set({ loading: true }); try { const r = await api()?.list(category); if (r?.success) set({ templates: r.templates || [], loading: false }) } catch { set({ loading: false }) }
  },
  getTemplate: async (id) => {
    try { const r = await api()?.get(id); return r?.success ? r.template : null } catch { return null }
  },
  createTemplate: async (data) => {
    try { const r = await api()?.create(data); if (r?.success) { await get().listTemplates(get().selectedCategory || undefined); return r.template } return null } catch { return null }
  },
  updateTemplate: async (id, updates) => {
    try { const r = await api()?.update(id, updates); if (r?.success) { await get().listTemplates(get().selectedCategory || undefined); return r.template } return null } catch { return null }
  },
  deleteTemplate: async (id) => {
    try { const r = await api()?.delete(id); if (r?.success) await get().listTemplates(get().selectedCategory || undefined); return r?.success || false } catch { return false }
  },
  loadCategories: async () => {
    try { const r = await api()?.getCategories(); if (r?.success) set({ categories: r.categories || [] }) } catch { /* ignore */ }
  },
  setSelectedCategory: (category) => { set({ selectedCategory: category }); get().listTemplates(category || undefined) },
}))
