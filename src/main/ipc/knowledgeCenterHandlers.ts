/**
 * IPC Handlers - 知识中心
 * 统一处理项目知识库、跨会话记忆、工作记忆的 IPC 调用
 * @author spectrai
 */
import { ipcMain } from 'electron'
import type { KnowledgeCenterService } from '../knowledge/KnowledgeCenterService'
import type {
  UnifiedKnowledgeQuery,
  CreateUnifiedKnowledgeParams,
  UpdateUnifiedKnowledgeParams,
  UnifiedKnowledgeExport
} from '../../shared/knowledgeCenterTypes'

export const KNOWLEDGE_CENTER_IPC = {
  // 查询
  QUERY: 'knowledge-center:query',
  SEARCH_MEMORY: 'knowledge-center:search-memory',

  // CRUD
  CREATE: 'knowledge-center:create',
  UPDATE: 'knowledge-center:update',
  DELETE: 'knowledge-center:delete',
  UPDATE_BATCH: 'knowledge-center:update-batch',
  DELETE_BATCH: 'knowledge-center:delete-batch',

  // 导入导出
  EXPORT: 'knowledge-center:export',
  IMPORT: 'knowledge-center:import',

  // 自动提取
  AUTO_EXTRACT: 'knowledge-center:auto-extract',
  EXTRACT_FROM_SESSION: 'knowledge-center:extract-from-session',

  // 注入
  GENERATE_INJECTION: 'knowledge-center:generate-injection'
} as const

export function registerKnowledgeCenterHandlers(service: KnowledgeCenterService): void {
  // 查询知识条目
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.QUERY, async (_, query: UnifiedKnowledgeQuery) => {
    try {
      return await service.queryEntries(query)
    } catch (err) {
      console.error('[KnowledgeCenter] Query failed:', err)
      throw err
    }
  })

  // 搜索记忆
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.SEARCH_MEMORY, async (_, query: string, limit?: number) => {
    try {
      return await service.searchMemory(query, limit)
    } catch (err) {
      console.error('[KnowledgeCenter] Search memory failed:', err)
      throw err
    }
  })

  // 创建知识条目
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.CREATE, async (_, params: CreateUnifiedKnowledgeParams) => {
    try {
      return await service.createEntry(params)
    } catch (err) {
      console.error('[KnowledgeCenter] Create failed:', err)
      throw err
    }
  })

  // 更新知识条目
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.UPDATE, async (_, id: string, updates: UpdateUnifiedKnowledgeParams) => {
    try {
      return await service.updateEntry(id, updates)
    } catch (err) {
      console.error('[KnowledgeCenter] Update failed:', err)
      throw err
    }
  })

  // 删除知识条目
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.DELETE, async (_, id: string) => {
    try {
      await service.deleteEntry(id)
      return { success: true }
    } catch (err) {
      console.error('[KnowledgeCenter] Delete failed:', err)
      throw err
    }
  })

  // 批量更新
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.UPDATE_BATCH, async (_, ids: string[], updates: UpdateUnifiedKnowledgeParams) => {
    try {
      return await service.updateBatch(ids, updates)
    } catch (err) {
      console.error('[KnowledgeCenter] Batch update failed:', err)
      throw err
    }
  })

  // 批量删除
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.DELETE_BATCH, async (_, ids: string[]) => {
    try {
      await service.deleteBatch(ids)
      return { success: true }
    } catch (err) {
      console.error('[KnowledgeCenter] Batch delete failed:', err)
      throw err
    }
  })

  // 导出数据
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.EXPORT, async (_, projectPath?: string) => {
    try {
      return await service.exportData(projectPath)
    } catch (err) {
      console.error('[KnowledgeCenter] Export failed:', err)
      throw err
    }
  })

  // 导入数据
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.IMPORT, async (_, data: UnifiedKnowledgeExport) => {
    try {
      return await service.importData(data)
    } catch (err) {
      console.error('[KnowledgeCenter] Import failed:', err)
      throw err
    }
  })

  // 自动提取项目知识
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.AUTO_EXTRACT, async (_, projectPath: string) => {
    try {
      return await service.autoExtract(projectPath)
    } catch (err) {
      console.error('[KnowledgeCenter] Auto extract failed:', err)
      throw err
    }
  })

  // 从会话提取知识
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.EXTRACT_FROM_SESSION, async (_, sessionId: string, projectPath: string) => {
    try {
      return await service.extractFromSession(sessionId, projectPath)
    } catch (err) {
      console.error('[KnowledgeCenter] Extract from session failed:', err)
      throw err
    }
  })

  // 生成注入 Prompt
  ipcMain.handle(KNOWLEDGE_CENTER_IPC.GENERATE_INJECTION, async (_, projectPath: string, sessionGoal?: string, sessionId?: string) => {
    try {
      return await service.generateInjectionPrompt(projectPath, sessionGoal, sessionId)
    } catch (err) {
      console.error('[KnowledgeCenter] Generate injection failed:', err)
      throw err
    }
  })

  console.log('[IPC] KnowledgeCenter handlers registered')
}
