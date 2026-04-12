/**
 * Drift Guard - IPC Handlers
 * @author weibin
 */

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { DriftGuardService } from '../drift-guard/DriftGuardService'

export function registerDriftGuardHandlers(driftGuardService: DriftGuardService): void {
  ipcMain.handle(IPC.DRIFT_GUARD_START, (_event, sessionId: string, goalId: string) => {
    const state = driftGuardService.startMonitoring(sessionId, goalId)
    return { success: true, state }
  })

  ipcMain.handle(IPC.DRIFT_GUARD_STOP, (_event, sessionId: string) => {
    driftGuardService.stopMonitoring(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC.DRIFT_GUARD_GET_STATE, (_event, sessionId: string) => {
    return { success: true, state: driftGuardService.getMonitoringState(sessionId) }
  })

  ipcMain.handle(IPC.DRIFT_GUARD_RESUME, (_event, sessionId: string) => {
    driftGuardService.resumeMonitoring(sessionId)
    return { success: true }
  })

  ipcMain.handle(IPC.DRIFT_GUARD_GET_PROMPT, (_event, sessionId: string) => {
    return { success: true, prompt: driftGuardService.generateCorrectionPrompt(sessionId) }
  })

  ipcMain.handle(IPC.DRIFT_GUARD_UPDATE_CONFIG, (_event, updates: any) => {
    driftGuardService.updateConfig(updates)
    return { success: true, config: driftGuardService.getConfig() }
  })

  ipcMain.handle(IPC.DRIFT_GUARD_GET_CONFIG, () => {
    return { success: true, config: driftGuardService.getConfig() }
  })
}
