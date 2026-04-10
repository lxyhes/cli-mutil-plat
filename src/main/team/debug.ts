/**
 * Agent Teams - Debug 日志工具
 *
 * 主进程调用日志函数，日志会同时：
 * 1. 输出到主进程终端（console）
 * 2. 通过 IPC 发送到渲染进程（UI 日志面板）
 *
 * 调用方式：
 *   import { teamLog } from './debug'
 *   teamLog.info('Team created', { teamId: 'xxx' })
 *   teamLog.warn('Member failed', { memberId: 'yyy' })
 *   teamLog.error('Bridge connection failed', err)
 *
 * 渲染进程在 DevTools 控制台过滤关键词："[Team"
 *
 * @author weibin
 */

// 统一日志接口
export interface TeamLogger {
  debug(msg: string, ...args: any[]): void
  info(msg: string, ...args: any[]): void
  warn(msg: string, ...args: any[]): void
  error(msg: string, ...args: any[]): void
}

// 延迟导入避免循环依赖
let _sendToRenderer: ((channel: string, ...args: any[]) => void) | null = null
export function setRendererLogger(fn: typeof _sendToRenderer): void {
  _sendToRenderer = fn
}

let _logCounter = 0

function sendToDevTools(level: string, msg: string, args: any[]): void {
  if (!_sendToRenderer) return
  try {
    _sendToRenderer('team:log', {
      id: `tlog-${Date.now()}-${String(++_logCounter).padStart(4, '0')}`,
      time: new Date().toISOString(),
      level,
      msg,
      data: args.length > 0 ? args : undefined,
    })
  } catch {
    // IPC not ready yet
  }
}

function formatMsg(prefix: string, msg: string, args: any[]): string {
  const rest = args.length > 0 ? ' ' + args.map(a => {
    if (a instanceof Error) return `[Error: ${a.message}]`
    if (typeof a === 'object') {
      try { return JSON.stringify(a) } catch { return String(a) }
    }
    return String(a)
  }).join(' ') : ''
  return `${prefix} ${msg}${rest}`
}

export const teamLog: TeamLogger = {
  debug(msg: string, ...args: any[]): void {
    console.debug(`[Team DBG]`, msg, ...args)
    sendToDevTools('debug', msg, args)
  },
  info(msg: string, ...args: any[]): void {
    console.log(`[Team INF]`, msg, ...args)
    sendToDevTools('info', msg, args)
  },
  warn(msg: string, ...args: any[]): void {
    console.warn(`[Team WRN]`, msg, ...args)
    sendToDevTools('warn', msg, args)
  },
  error(msg: string, ...args: any[]): void {
    console.error(`[Team ERR]`, msg, ...args)
    sendToDevTools('error', msg, args)
  },
}
