/**
 * Feishu IPC Handlers - 飞书集成的 IPC 接口
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'
import type { IpcDependencies } from './index'
import type { FeishuService } from '../feishu/FeishuService'

export function registerFeishuHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const feishuService: FeishuService | undefined = (deps as any).feishuService

  // GET 配置
  ipcMain.handle(IPC.FEISHU_GET_CONFIG, async () => {
    const integration = database.getFeishuIntegration()
    return {
      hasAppId: !!integration?.appId,
      hasWebhookUrl: !!integration?.webhookUrl,
      appId: integration?.appId ?? '',
      webhookUrl: integration?.webhookUrl ?? '',
      enabled: integration?.enabled ?? false,
      notifyOnStart: integration?.notifyOnStart ?? true,
      notifyOnEnd: integration?.notifyOnEnd ?? true,
      notifyOnError: integration?.notifyOnError ?? true,
      botName: integration?.botName ?? '',
    }
  })

  // SET 配置
  ipcMain.handle(IPC.FEISHU_SET_CONFIG, async (_event, config: {
    appId?: string
    appSecret?: string
    webhookUrl?: string
    enabled?: boolean
    notifyOnStart?: boolean
    notifyOnEnd?: boolean
    notifyOnError?: boolean
  }) => {
    try {
      const current = database.getFeishuIntegration()
      database.saveFeishuIntegration({
        appId: config.appId ?? current?.appId ?? null,
        appSecret: config.appSecret ?? current?.appSecret ?? null,
        webhookUrl: config.webhookUrl ?? current?.webhookUrl ?? null,
        enabled: config.enabled ?? current?.enabled ?? false,
        notifyOnStart: config.notifyOnStart ?? current?.notifyOnStart ?? true,
        notifyOnEnd: config.notifyOnEnd ?? current?.notifyOnEnd ?? true,
        notifyOnError: config.notifyOnError ?? current?.notifyOnError ?? true,
      })

      if (config.enabled) {
        await feishuService?.connect({
          appId: config.appId ?? current?.appId ?? undefined,
          appSecret: config.appSecret ?? current?.appSecret ?? undefined,
          webhookUrl: config.webhookUrl ?? current?.webhookUrl ?? undefined,
        })
      } else {
        feishuService?.stop()
      }

      return createSuccessResponse({ status: feishuService?.getStatus() ?? 'stopped' })
    } catch (err) {
      return createErrorResponse(err, { operation: 'feishu.set-config' })
    }
  })

  // DELETE 配置
  ipcMain.handle(IPC.FEISHU_DELETE_CONFIG, async () => {
    try {
      feishuService?.stop()
      database.saveFeishuIntegration({
        enabled: false,
        appId: null,
        appSecret: null,
        webhookUrl: null,
        notifyOnStart: true,
        notifyOnEnd: true,
        notifyOnError: true,
      })
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'feishu.delete-config' })
    }
  })

  // GET 状态
  ipcMain.handle(IPC.FEISHU_GET_STATUS, async () => {
    return { status: feishuService?.getStatus() ?? 'stopped' }
  })

  // TEST 连接
  ipcMain.handle(IPC.FEISHU_TEST_CONNECTION, async (_event, config: {
    appId?: string
    appSecret?: string
    webhookUrl?: string
  }) => {
    try {
      if (!feishuService) {
        return createErrorResponse(new Error('FeishuService not initialized'), { operation: 'feishu.test' })
      }
      const result = await feishuService.testConnection(config)
      if (result.success) {
        return createSuccessResponse(result)
      } else {
        return createErrorResponse(new Error(result.error), { operation: 'feishu.test' })
      }
    } catch (err) {
      return createErrorResponse(err, { operation: 'feishu.test-connection' })
    }
  })

  // GET 映射列表
  ipcMain.handle(IPC.FEISHU_GET_MAPPINGS, async () => {
    return database.getFeishuMappings()
  })

  // ADD 映射
  ipcMain.handle(IPC.FEISHU_ADD_MAPPING, async (_event, mapping: {
    chatId: string
    chatName?: string
    sessionId: string
    sessionName?: string
  }) => {
    try {
      const created = database.createFeishuMapping({
        integrationId: 'default',
        chatId: mapping.chatId,
        chatName: mapping.chatName,
        sessionId: mapping.sessionId,
        sessionName: mapping.sessionName,
      })
      return createSuccessResponse({ mapping: created })
    } catch (err) {
      return createErrorResponse(err, { operation: 'feishu.add-mapping' })
    }
  })

  // REMOVE 映射
  ipcMain.handle(IPC.FEISHU_REMOVE_MAPPING, async (_event, mappingId: string) => {
    try {
      database.deleteFeishuMapping(mappingId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'feishu.remove-mapping' })
    }
  })
}
