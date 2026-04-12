/**
 * Session Template - IPC Handlers
 * @author weibin
 */

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { SessionTemplateService } from '../session-template/SessionTemplateService'

export function registerSessionTemplateHandlers(sessionTemplateService: SessionTemplateService): void {
  ipcMain.handle(IPC.SESSION_TEMPLATE_LIST, (_event, category?: string) => {
    return { success: true, templates: sessionTemplateService.listTemplates(category as any) }
  })

  ipcMain.handle(IPC.SESSION_TEMPLATE_GET, (_event, id: string) => {
    return { success: true, template: sessionTemplateService.getTemplate(id) }
  })

  ipcMain.handle(IPC.SESSION_TEMPLATE_CREATE, (_event, data: any) => {
    const template = sessionTemplateService.createTemplate(data)
    return { success: true, template }
  })

  ipcMain.handle(IPC.SESSION_TEMPLATE_UPDATE, (_event, id: string, updates: any) => {
    const template = sessionTemplateService.updateTemplate(id, updates)
    return { success: template !== null, template }
  })

  ipcMain.handle(IPC.SESSION_TEMPLATE_DELETE, (_event, id: string) => {
    return { success: sessionTemplateService.deleteTemplate(id) }
  })

  ipcMain.handle(IPC.SESSION_TEMPLATE_GET_CATEGORIES, () => {
    return { success: true, categories: sessionTemplateService.getCategories() }
  })
}
