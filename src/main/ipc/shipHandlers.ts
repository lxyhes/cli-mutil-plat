/**
 * QA/SHIP IPC handlers.
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import { ShipCheckService } from '../ship/ShipCheckService'

const shipCheckService = new ShipCheckService()

export function registerShipHandlers(): void {
  ipcMain.handle(IPC.SHIP_CREATE_PLAN, async (_event, projectPath: string) => {
    try {
      return createSuccessResponse(shipCheckService.createPlan(projectPath))
    } catch (err) {
      return createErrorResponse(err, { operation: 'ship.create-plan', projectPath })
    }
  })

  ipcMain.handle(IPC.SHIP_RUN_PLAN, async (_event, projectPath: string, options?: any) => {
    try {
      return createSuccessResponse(await shipCheckService.runPlan(projectPath, options))
    } catch (err) {
      return createErrorResponse(err, { operation: 'ship.run-plan', projectPath })
    }
  })
}
