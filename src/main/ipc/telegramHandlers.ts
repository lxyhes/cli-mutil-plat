/**
 * Telegram IPC Handlers
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'
import type { IpcDependencies } from './index'

export function registerTelegramHandlers(deps: IpcDependencies): void {
  const telegramBotService = (deps as any).telegramBotService
  const { database, sessionManagerV2 } = deps

  // GET 配置
  ipcMain.handle(IPC.TELEGRAM_GET_CONFIG, async () => {
    const token = database.getTelegramBotToken()
    const config = database.getTelegramIntegrationConfig()
    return {
      hasToken: !!token,
      enabled: config?.enabled ?? false,
      commandPrefix: config?.commandPrefix ?? '/',
      notifyOnStart: config?.notifyOnStart ?? true,
      notifyOnEnd: config?.notifyOnEnd ?? true,
      notifyOnError: config?.notifyOnError ?? true,
    }
  })

  // SET 配置
  ipcMain.handle(IPC.TELEGRAM_SET_CONFIG, async (_event, config: {
    botToken?: string
    enabled?: boolean
    commandPrefix?: string
    notifyOnStart?: boolean
    notifyOnEnd?: boolean
    notifyOnError?: boolean
  }) => {
    try {
      const currentConfig = database.getTelegramIntegrationConfig()
      const currentToken = database.getTelegramBotToken()

      // 保存开关配置
      database.saveTelegramIntegrationConfig({
        enabled: config.enabled ?? currentConfig?.enabled ?? false,
        commandPrefix: config.commandPrefix ?? currentConfig?.commandPrefix ?? '/',
        notifyOnStart: config.notifyOnStart ?? currentConfig?.notifyOnStart ?? true,
        notifyOnEnd: config.notifyOnEnd ?? currentConfig?.notifyOnEnd ?? true,
        notifyOnError: config.notifyOnError ?? currentConfig?.notifyOnError ?? true,
      })

      // Token 变化则重启 Bot
      if (config.botToken && config.botToken !== currentToken) {
        if (telegramBotService) {
          telegramBotService.stop()
          await telegramBotService.start(config.botToken)
        } else {
          database.setTelegramBotToken(config.botToken)
        }
      } else if (config.enabled !== undefined) {
        // 仅切换开关
        if (config.enabled && !currentToken) {
          throw new SpectrAIError({
            code: ErrorCode.INVALID_INPUT,
            message: 'No bot token configured',
            userMessage: '请先配置 Bot Token',
          })
        }
        if (telegramBotService) {
          if (config.enabled) {
            const token = database.getTelegramBotToken()
            if (token) await telegramBotService.start(token)
          } else {
            telegramBotService.stop()
          }
        }
      }

      return createSuccessResponse({
        status: telegramBotService?.getStatus() ?? (currentToken ? 'running' : 'stopped'),
      })
    } catch (err) {
      return createErrorResponse(err, { operation: 'telegram.set-config' })
    }
  })

  // DELETE 配置
  ipcMain.handle(IPC.TELEGRAM_DELETE_CONFIG, async () => {
    try {
      if (telegramBotService) telegramBotService.stop()
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'telegram.delete-config' })
    }
  })

  // GET 状态
  ipcMain.handle(IPC.TELEGRAM_GET_STATUS, async () => {
    return { status: telegramBotService?.getStatus() ?? 'stopped' }
  })

  // 测试连接
  ipcMain.handle(IPC.TELEGRAM_TEST_CONNECTION, async (_event, token: string) => {
    try {
      if (!telegramBotService) {
        throw new Error('TelegramBotService not initialized')
      }
      const result = await telegramBotService.testConnection(token)
      return createSuccessResponse(result)
    } catch (err) {
      return createErrorResponse(err, { operation: 'telegram.test-connection' })
    }
  })

  // GET 映射列表
  ipcMain.handle(IPC.TELEGRAM_GET_MAPPINGS, async () => {
    return database.getTelegramMappings()
  })

  // ADD 映射
  ipcMain.handle(IPC.TELEGRAM_ADD_MAPPING, async (_event, mapping: {
    chatId: string
    sessionId: string
    sessionName?: string
  }) => {
    try {
      if (!sessionManagerV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SessionManagerV2 not available',
          userMessage: '会话管理器未初始化',
        })
      }
      const session = sessionManagerV2.getSession(mapping.sessionId)
      if (!session) {
        throw new SpectrAIError({
          code: ErrorCode.SESSION_NOT_FOUND,
          message: 'Session not found',
          userMessage: '会话不存在',
        })
      }
      const created = database.createTelegramMapping({
        integrationId: 'default',
        chatId: mapping.chatId,
        sessionId: mapping.sessionId,
        sessionName: mapping.sessionName || session.name,
      })
      return createSuccessResponse({ mapping: created })
    } catch (err) {
      return createErrorResponse(err, { operation: 'telegram.add-mapping' })
    }
  })

  // REMOVE 映射
  ipcMain.handle(IPC.TELEGRAM_REMOVE_MAPPING, async (_event, mappingId: string) => {
    try {
      database.deleteTelegramMapping(mappingId)
      return createSuccessResponse({})
    } catch (err) {
      return createErrorResponse(err, { operation: 'telegram.remove-mapping' })
    }
  })
}
