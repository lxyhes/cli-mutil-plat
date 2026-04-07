/**
 * 会话错误处理器
 * 统一处理会话生命周期中的各类错误
 * @author weibin
 */

import type { SessionStatus } from '../../shared/types'

export interface SessionError {
  sessionId: string
  type: 'adapter' | 'timeout' | 'state' | 'resource' | 'unknown'
  message: string
  originalError?: Error
  timestamp: string
  context?: Record<string, any>
}

export class SessionErrorHandler {
  private errorHistory: SessionError[] = []
  private maxErrors = 500

  /**
   * 处理适配器错误
   */
  handleAdapterError(
    sessionId: string,
    error: Error,
    context?: Record<string, any>
  ): SessionError {
    const sessionError: SessionError = {
      sessionId,
      type: 'adapter',
      message: `Adapter error: ${error.message}`,
      originalError: error,
      timestamp: new Date().toISOString(),
      context
    }

    this.recordError(sessionError)
    console.error(
      `[SessionErrorHandler] Adapter error for session ${sessionId}:`,
      error,
      context
    )

    return sessionError
  }

  /**
   * 处理超时错误
   */
  handleTimeout(
    sessionId: string,
    timeoutType: 'startup' | 'idle' | 'operation',
    timeoutMs: number,
    context?: Record<string, any>
  ): SessionError {
    const sessionError: SessionError = {
      sessionId,
      type: 'timeout',
      message: `${timeoutType} timeout after ${timeoutMs}ms`,
      timestamp: new Date().toISOString(),
      context: { ...context, timeoutType, timeoutMs }
    }

    this.recordError(sessionError)
    console.error(
      `[SessionErrorHandler] Timeout for session ${sessionId}:`,
      timeoutType,
      timeoutMs
    )

    return sessionError
  }

  /**
   * 处理状态转换错误
   */
  handleStateError(
    sessionId: string,
    from: SessionStatus,
    to: SessionStatus,
    reason: string
  ): SessionError {
    const sessionError: SessionError = {
      sessionId,
      type: 'state',
      message: `Invalid state transition: ${from} -> ${to}. ${reason}`,
      timestamp: new Date().toISOString(),
      context: { from, to, reason }
    }

    this.recordError(sessionError)
    console.error(
      `[SessionErrorHandler] State error for session ${sessionId}:`,
      from,
      '->',
      to,
      reason
    )

    return sessionError
  }

  /**
   * 处理资源错误（内存、文件句柄等）
   */
  handleResourceError(
    sessionId: string,
    resourceType: string,
    error: Error,
    context?: Record<string, any>
  ): SessionError {
    const sessionError: SessionError = {
      sessionId,
      type: 'resource',
      message: `Resource error (${resourceType}): ${error.message}`,
      originalError: error,
      timestamp: new Date().toISOString(),
      context: { ...context, resourceType }
    }

    this.recordError(sessionError)
    console.error(
      `[SessionErrorHandler] Resource error for session ${sessionId}:`,
      resourceType,
      error
    )

    return sessionError
  }

  /**
   * 处理未知错误
   */
  handleUnknownError(
    sessionId: string,
    error: Error | unknown,
    context?: Record<string, any>
  ): SessionError {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const sessionError: SessionError = {
      sessionId,
      type: 'unknown',
      message: `Unknown error: ${errorMessage}`,
      originalError: error instanceof Error ? error : undefined,
      timestamp: new Date().toISOString(),
      context
    }

    this.recordError(sessionError)
    console.error(
      `[SessionErrorHandler] Unknown error for session ${sessionId}:`,
      error,
      context
    )

    return sessionError
  }

  /**
   * 记录错误到历史
   */
  private recordError(error: SessionError): void {
    this.errorHistory.push(error)

    // 保持历史记录在限制内
    if (this.errorHistory.length > this.maxErrors) {
      this.errorHistory.shift()
    }
  }

  /**
   * 获取会话的错误历史
   */
  getErrors(sessionId?: string): SessionError[] {
    if (sessionId) {
      return this.errorHistory.filter(e => e.sessionId === sessionId)
    }
    return [...this.errorHistory]
  }

  /**
   * 获取最近的错误
   */
  getRecentErrors(limit = 10): SessionError[] {
    return this.errorHistory.slice(-limit)
  }

  /**
   * 清除错误历史
   */
  clear(sessionId?: string): void {
    if (sessionId) {
      this.errorHistory = this.errorHistory.filter(e => e.sessionId !== sessionId)
    } else {
      this.errorHistory = []
    }
  }

  /**
   * 获取错误统计
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {
      total: this.errorHistory.length,
      adapter: 0,
      timeout: 0,
      state: 0,
      resource: 0,
      unknown: 0
    }

    for (const error of this.errorHistory) {
      stats[error.type]++
    }

    return stats
  }
}
