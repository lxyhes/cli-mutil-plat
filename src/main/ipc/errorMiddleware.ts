/**
 * IPC 错误处理中间件
 * 统一捕获和格式化 IPC Handler 中的错误
 * @author weibin
 */

import { logger } from '../logger'

/**
 * 用户友好的错误信息映射
 */
const USER_FRIENDLY_ERRORS: Record<string, string> = {
  'ECONNREFUSED': '无法连接到服务，请检查网络设置',
  'ETIMEDOUT': '连接超时，请检查代理配置',
  'ENOENT': '文件或目录不存在',
  'EACCES': '权限不足，请以管理员身份运行',
  'SESSION_NOT_FOUND': '会话不存在或已结束',
  'AGENT_NOT_READY': 'Agent 尚未就绪，请稍后重试',
  'PROVIDER_NOT_INSTALLED': 'AI Provider 未安装，请先安装对应的 CLI 工具',
  'DATABASE_LOCKED': '数据库被占用，请关闭其他实例',
}

/**
 * 格式化错误为用户友好的消息
 */
export function formatUserFriendlyError(error: any): string {
  if (!error) return '未知错误'
  
  // 如果是字符串，直接返回
  if (typeof error === 'string') return error
  
  // 尝试从错误对象中提取信息
  const code = error.code || error.errno
  const message = error.message || String(error)
  
  // 查找预定义的用户友好消息
  if (code && USER_FRIENDLY_ERRORS[code]) {
    return USER_FRIENDLY_ERRORS[code]
  }
  
  // 如果消息中包含已知错误码
  for (const [code, friendlyMsg] of Object.entries(USER_FRIENDLY_ERRORS)) {
    if (message.includes(code)) {
      return friendlyMsg
    }
  }
  
  // 返回原始消息（截断过长内容）
  return message.length > 200 ? message.substring(0, 200) + '...' : message
}

/**
 * IPC Handler 包装器 - 自动捕获错误并返回统一格式
 * 
 * @example
 * ```typescript
 * ipcMain.handle(IPC.SESSION_CREATE, wrapIpcHandler(async (event, config) => {
 *   return await sessionManagerV2.createSession(config)
 * }))
 * ```
 */
export function wrapIpcHandler<T = any>(
  handler: (...args: any[]) => Promise<T>
): (...args: any[]) => Promise<{ success: boolean; data?: T; error?: string }> {
  return async (...args: any[]) => {
    try {
      const result = await handler(...args)
      return {
        success: true,
        data: result
      }
    } catch (error: any) {
      // 记录详细错误日志（开发环境）
      logger.error('[IPC Error]', {
        handler: handler.name || 'anonymous',
        args: args.slice(0, 2), // 只记录前两个参数，避免敏感信息
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code
        }
      })
      
      // 返回用户友好的错误信息
      return {
        success: false,
        error: formatUserFriendlyError(error)
      }
    }
  }
}

/**
 * 批量包装多个 IPC Handler
 * 
 * @example
 * ```typescript
 * registerWrappedHandlers({
 *   [IPC.SESSION_CREATE]: async (config) => sessionManagerV2.createSession(config),
 *   [IPC.SESSION_TERMINATE]: async (sessionId) => sessionManagerV2.terminateSession(sessionId),
 * })
 * ```
 */
export function registerWrappedHandlers(
  handlers: Record<string, (...args: any[]) => Promise<any>>
): void {
  const { ipcMain } = require('electron')
  
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, wrapIpcHandler(handler))
  }
}
