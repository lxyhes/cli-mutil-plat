/**
 * Drift Guard Store - 漂移检测护栏前端状态管理
 * @author weibin
 */

import { create } from 'zustand'

export type DriftSeverity = 'none' | 'minor' | 'moderate' | 'severe'

export interface DriftCheckResult {
  id: string; sessionId: string; goalId: string; goalTitle: string
  severity: DriftSeverity; description: string; suggestion: string
  checkedAt: string; turnNumber: number
}

export interface SessionDriftState {
  sessionId: string; goalId: string; turnCount: number; lastCheckedTurn: number
  consecutiveDrifts: number; history: DriftCheckResult[]; paused: boolean
}

export interface DriftConfig {
  checkIntervalTurns: number; autoNotify: boolean
  autoInjectCorrection: boolean; maxConsecutiveDrifts: number
}

const api = () => (window as any).spectrAI?.driftGuard

interface DriftGuardState {
  monitoringStates: Map<string, SessionDriftState>
  lastDriftResult: DriftCheckResult | null
  config: DriftConfig | null
  loading: boolean
  startMonitoring: (sessionId: string, goalId: string) => Promise<void>
  stopMonitoring: (sessionId: string) => Promise<void>
  getState: (sessionId: string) => Promise<void>
  resumeMonitoring: (sessionId: string) => Promise<void>
  getCorrectionPrompt: (sessionId: string) => Promise<string>
  updateConfig: (updates: Partial<DriftConfig>) => Promise<void>
  getConfig: () => Promise<void>
  handleDriftEvent: (event: { type: string; result?: DriftCheckResult; sessionId?: string; consecutiveDrifts?: number }) => void
}

export const useDriftGuardStore = create<DriftGuardState>((set, get) => ({
  monitoringStates: new Map(), lastDriftResult: null, config: null, loading: false,
  startMonitoring: async (sessionId, goalId) => {
    try { const r = await api()?.start(sessionId, goalId); if (r?.success) { const s = new Map(get().monitoringStates); s.set(sessionId, r.state); set({ monitoringStates: s }) } } catch (e) { console.error(e) }
  },
  stopMonitoring: async (sessionId) => {
    try { await api()?.stop(sessionId); const s = new Map(get().monitoringStates); s.delete(sessionId); set({ monitoringStates: s }) } catch (e) { console.error(e) }
  },
  getState: async (sessionId) => {
    try { const r = await api()?.getState(sessionId); if (r?.success && r.state) { const s = new Map(get().monitoringStates); s.set(sessionId, r.state); set({ monitoringStates: s }) } } catch (e) { console.error(e) }
  },
  resumeMonitoring: async (sessionId) => {
    try { await api()?.resume(sessionId); const s = new Map(get().monitoringStates); const st = s.get(sessionId); if (st) { s.set(sessionId, { ...st, paused: false, consecutiveDrifts: 0 }); set({ monitoringStates: s }) } } catch (e) { console.error(e) }
  },
  getCorrectionPrompt: async (sessionId) => {
    try { const r = await api()?.getPrompt(sessionId); return r?.success ? r.prompt || '' : '' } catch { return '' }
  },
  updateConfig: async (updates) => {
    try { const r = await api()?.updateConfig(updates); if (r?.success) set({ config: r.config }) } catch (e) { console.error(e) }
  },
  getConfig: async () => {
    try { const r = await api()?.getConfig(); if (r?.success) set({ config: r.config }) } catch (e) { console.error(e) }
  },
  handleDriftEvent: (event) => {
    if (event.type === 'drift-detected' && event.result) {
      set({ lastDriftResult: event.result })
      const s = new Map(get().monitoringStates); const st = s.get(event.result.sessionId)
      if (st) { s.set(event.result.sessionId, { ...st, consecutiveDrifts: (st.consecutiveDrifts || 0) + 1, history: [...st.history, event.result] }); set({ monitoringStates: s }) }
    } else if (event.type === 'threshold-reached' && event.sessionId) {
      const s = new Map(get().monitoringStates); const st = s.get(event.sessionId)
      if (st) { s.set(event.sessionId, { ...st, paused: true, consecutiveDrifts: event.consecutiveDrifts || 0 }); set({ monitoringStates: s }) }
    }
  },
}))
