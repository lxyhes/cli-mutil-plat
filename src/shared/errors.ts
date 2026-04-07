/**
 * 统一错误处理架构
 * @author weibin
 */

// ============================================================
// 错误代码定义
// ============================================================

export enum ErrorCode {
  // 通用错误 (1xxx)
  UNKNOWN = 'ERR_UNKNOWN',
  INTERNAL = 'ERR_INTERNAL',
  TIMEOUT = 'ERR_TIMEOUT',
  CANCELLED = 'ERR_CANCELLED',

  // 验证错误 (2xxx)
  VALIDATION = 'ERR_VALIDATION',
  INVALID_INPUT = 'ERR_INVALID_INPUT',
  MISSING_REQUIRED = 'ERR_MISSING_REQUIRED',

  // 资源错误 (3xxx)
  NOT_FOUND = 'ERR_NOT_FOUND',
  ALREADY_EXISTS = 'ERR_ALREADY_EXISTS',
  RESOURCE_BUSY = 'ERR_RESOURCE_BUSY',
  RESOURCE_EXHAUSTED = 'ERR_RESOURCE_EXHAUSTED',

  // 权限错误 (4xxx)
  PERMISSION_DENIED = 'ERR_PERMISSION_DENIED',
  UNAUTHORIZED = 'ERR_UNAUTHORIZED',

  // 网络错误 (5xxx)
  NETWORK = 'ERR_NETWORK',
  CONNECTION_FAILED = 'ERR_CONNECTION_FAILED',
  REQUEST_FAILED = 'ERR_REQUEST_FAILED',

  // 会话错误 (6xxx)
  SESSION_NOT_FOUND = 'ERR_SESSION_NOT_FOUND',
  SESSION_ALREADY_RUNNING = 'ERR_SESSION_ALREADY_RUNNING',
  SESSION_TERMINATED = 'ERR_SESSION_TERMINATED',
  SESSION_STARTUP_FAILED = 'ERR_SESSION_STARTUP_FAILED',

  // Agent 错误 (7xxx)
  AGENT_NOT_FOUND = 'ERR_AGENT_NOT_FOUND',
  AGENT_SPAWN_FAILED = 'ERR_AGENT_SPAWN_FAILED',
  AGENT_TIMEOUT = 'ERR_AGENT_TIMEOUT',
  AGENT_EXECUTION_FAILED = 'ERR_AGENT_EXECUTION_FAILED',

  // Provider 错误 (8xxx)
  PROVIDER_NOT_FOUND = 'ERR_PROVIDER_NOT_FOUND',
  PROVIDER_NOT_AVAILABLE = 'ERR_PROVIDER_NOT_AVAILABLE',
  PROVIDER_COMMAND_FAILED = 'ERR_PROVIDER_COMMAND_FAILED',

  // 文件系统错误 (9xxx)
  FILE_NOT_FOUND = 'ERR_FILE_NOT_FOUND',
  FILE_READ_FAILED = 'ERR_FILE_READ_FAILED',
  FILE_WRITE_FAILED = 'ERR_FILE_WRITE_FAILED',
  FILE_LOCKED = 'ERR_FILE_LOCKED',

  // Git 错误 (10xxx)
  GIT_NOT_FOUND = 'ERR_GIT_NOT_FOUND',
  GIT_OPERATION_FAILED = 'ERR_GIT_OPERATION_FAILED',
  WORKTREE_CREATION_FAILED = 'ERR_WORKTREE_CREATION_FAILED',

  // 数据库错误 (11xxx)
  DATABASE = 'ERR_DATABASE',
  DATABASE_QUERY_FAILED = 'ERR_DATABASE_QUERY_FAILED',
  DATABASE_CONSTRAINT_VIOLATION = 'ERR_DATABASE_CONSTRAINT_VIOLATION',
}

// ============================================================
// 错误严重级别
// ============================================================

export enum ErrorSeverity {
  LOW = 'low',        // 可忽略的错误
  MEDIUM = 'medium',  // 需要注意但不影响核心功能
  HIGH = 'high',      // 影响核心功能
  CRITICAL = 'critical', // 系统级错误
}

// ============================================================
// 统一错误类
// ============================================================

export interface ErrorContext {
  sessionId?: string
  agentId?: string
  taskId?: string
  filePath?: string
  [key: string]: any
}

export class SpectrAIError extends Error {
  public readonly code: ErrorCode
  public readonly userMessage: string
  public readonly technicalMessage: string
  public readonly recoverable: boolean
  public readonly severity: ErrorSeverity
  public readonly context?: ErrorContext
  public readonly cause?: Error
  public readonly timestamp: string

  constructor(options: {
    code: ErrorCode
    message: string
    userMessage?: string
    recoverable?: boolean
    severity?: ErrorSeverity
    context?: ErrorContext
    cause?: Error
  }) {
    super(options.message)
    this.name = 'SpectrAIError'
    this.code = options.code
    this.technicalMessage = options.message
    this.userMessage = options.userMessage || this.getDefaultUserMessage(options.code)
    this.recoverable = options.recoverable ?? this.isRecoverableByDefault(options.code)
    this.severity = options.severity ?? this.getDefaultSeverity(options.code)
    this.context = options.context
    this.cause = options.cause
    this.timestamp = new Date().toISOString()

    // 保持原型链
    Object.setPrototypeOf(this, SpectrAIError.prototype)
  }

  /**
   * 获取默认的用户友好错误信息
   */
  private getDefaultUserMessage(code: ErrorCode): string {
    const messages: Record<ErrorCode, string> = {
      [ErrorCode.UNKNOWN]: '发生了未知错误，请重试',
      [ErrorCode.INTERNAL]: '系统内部错误，请联系技术支持',
      [ErrorCode.TIMEOUT]: '操作超时，请检查网络连接后重试',
      [ErrorCode.CANCELLED]: '操作已取消',

      [ErrorCode.VALIDATION]: '输入验证失败，请检查输入内容',
      [ErrorCode.INVALID_INPUT]: '输入内容无效',
      [ErrorCode.MISSING_REQUIRED]: '缺少必填项',

      [ErrorCode.NOT_FOUND]: '未找到请求的资源',
      [ErrorCode.ALREADY_EXISTS]: '资源已存在',
      [ErrorCode.RESOURCE_BUSY]: '资源正在使用中，请稍后重试',
      [ErrorCode.RESOURCE_EXHAUSTED]: '系统资源不足',

      [ErrorCode.PERMISSION_DENIED]: '权限不足',
      [ErrorCode.UNAUTHORIZED]: '未授权访问',

      [ErrorCode.NETWORK]: '网络错误',
      [ErrorCode.CONNECTION_FAILED]: '连接失败',
      [ErrorCode.REQUEST_FAILED]: '请求失败',

      [ErrorCode.SESSION_NOT_FOUND]: '会话不存在',
      [ErrorCode.SESSION_ALREADY_RUNNING]: '会话已在运行中',
      [ErrorCode.SESSION_TERMINATED]: '会话已终止',
      [ErrorCode.SESSION_STARTUP_FAILED]: '会话启动失败，请检查 AI CLI 是否正确安装',

      [ErrorCode.AGENT_NOT_FOUND]: 'Agent 不存在',
      [ErrorCode.AGENT_SPAWN_FAILED]: 'Agent 创建失败',
      [ErrorCode.AGENT_TIMEOUT]: 'Agent 执行超时',
      [ErrorCode.AGENT_EXECUTION_FAILED]: 'Agent 执行失败',

      [ErrorCode.PROVIDER_NOT_FOUND]: 'AI Provider 不存在',
      [ErrorCode.PROVIDER_NOT_AVAILABLE]: 'AI Provider 不可用，请检查是否已安装',
      [ErrorCode.PROVIDER_COMMAND_FAILED]: 'AI Provider 命令执行失败',

      [ErrorCode.FILE_NOT_FOUND]: '文件不存在',
      [ErrorCode.FILE_READ_FAILED]: '文件读取失败',
      [ErrorCode.FILE_WRITE_FAILED]: '文件写入失败',
      [ErrorCode.FILE_LOCKED]: '文件被锁定，请稍后重试',

      [ErrorCode.GIT_NOT_FOUND]: 'Git 未安装或不在 PATH 中',
      [ErrorCode.GIT_OPERATION_FAILED]: 'Git 操作失败',
      [ErrorCode.WORKTREE_CREATION_FAILED]: 'Worktree 创建失败',

      [ErrorCode.DATABASE]: '数据库错误',
      [ErrorCode.DATABASE_QUERY_FAILED]: '数据库查询失败',
      [ErrorCode.DATABASE_CONSTRAINT_VIOLATION]: '数据约束冲突',
    }
    return messages[code] || '发生了未知错误'
  }

  /**
   * 判断错误是否默认可恢复
   */
  private isRecoverableByDefault(code: ErrorCode): boolean {
    const recoverableCodes = [
      ErrorCode.TIMEOUT,
      ErrorCode.NETWORK,
      ErrorCode.CONNECTION_FAILED,
      ErrorCode.REQUEST_FAILED,
      ErrorCode.RESOURCE_BUSY,
      ErrorCode.FILE_LOCKED,
    ]
    return recoverableCodes.includes(code)
  }

  /**
   * 获取默认严重级别
   */
  private getDefaultSeverity(code: ErrorCode): ErrorSeverity {
    if (code.startsWith('ERR_INTERNAL') || code.startsWith('ERR_DATABASE')) {
      return ErrorSeverity.CRITICAL
    }
    if (code.startsWith('ERR_SESSION') || code.startsWith('ERR_AGENT')) {
      return ErrorSeverity.HIGH
    }
    if (code.startsWith('ERR_VALIDATION') || code.startsWith('ERR_NOT_FOUND')) {
      return ErrorSeverity.LOW
    }
    return ErrorSeverity.MEDIUM
  }

  /**
   * 转换为 JSON（用于 IPC 传输）
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.technicalMessage,
      userMessage: this.userMessage,
      recoverable: this.recoverable,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    }
  }

  /**
   * 从 JSON 恢复错误对象
   */
  static fromJSON(json: any): SpectrAIError {
    const error = new SpectrAIError({
      code: json.code,
      message: json.message,
      userMessage: json.userMessage,
      recoverable: json.recoverable,
      severity: json.severity,
      context: json.context,
    })
    error.stack = json.stack
    return error
  }
}

// ============================================================
// 错误处理器
// ============================================================

export class ErrorHandler {
  /**
   * 处理错误，转换为 SpectrAIError
   */
  static handle(error: unknown, context?: ErrorContext): SpectrAIError {
    // 已经是 SpectrAIError，直接返回
    if (error instanceof SpectrAIError) {
      return error
    }

    // 标准 Error
    if (error instanceof Error) {
      return new SpectrAIError({
        code: ErrorCode.INTERNAL,
        message: error.message,
        context,
        cause: error,
      })
    }

    // 其他类型
    return new SpectrAIError({
      code: ErrorCode.UNKNOWN,
      message: String(error),
      context,
    })
  }

  /**
   * 记录错误日志
   */
  static log(error: SpectrAIError): void {
    const logLevel = this.getLogLevel(error.severity)
    const logMessage = `[${error.code}] ${error.technicalMessage}`
    const logContext = {
      code: error.code,
      severity: error.severity,
      recoverable: error.recoverable,
      context: error.context,
      timestamp: error.timestamp,
      stack: error.stack,
    }

    switch (logLevel) {
      case 'error':
        console.error(logMessage, logContext)
        break
      case 'warn':
        console.warn(logMessage, logContext)
        break
      case 'info':
        console.info(logMessage, logContext)
        break
      default:
        console.log(logMessage, logContext)
    }
  }

  /**
   * 根据严重级别获取日志级别
   */
  private static getLogLevel(severity: ErrorSeverity): 'error' | 'warn' | 'info' | 'log' {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.HIGH:
        return 'error'
      case ErrorSeverity.MEDIUM:
        return 'warn'
      case ErrorSeverity.LOW:
        return 'info'
      default:
        return 'log'
    }
  }

  /**
   * 上报错误（可选，用于错误追踪服务）
   */
  static report(error: SpectrAIError): void {
    // TODO: 集成错误追踪服务（如 Sentry）
    if (error.severity === ErrorSeverity.CRITICAL) {
      console.error('[ErrorHandler] Critical error reported:', error.toJSON())
    }
  }
}

// ============================================================
// IPC 错误响应格式
// ============================================================

export interface IpcErrorResponse {
  success: false
  error: {
    code: string
    message: string
    userMessage: string
    recoverable: boolean
    severity: string
    context?: ErrorContext
  }
}

export interface IpcSuccessResponse<T = any> {
  success: true
  data: T
}

export type IpcResponse<T = any> = IpcSuccessResponse<T> | IpcErrorResponse

/**
 * 创建 IPC 错误响应
 */
export function createErrorResponse(error: unknown, context?: ErrorContext): IpcErrorResponse {
  const spectrError = ErrorHandler.handle(error, context)
  ErrorHandler.log(spectrError)

  return {
    success: false,
    error: {
      code: spectrError.code,
      message: spectrError.technicalMessage,
      userMessage: spectrError.userMessage,
      recoverable: spectrError.recoverable,
      severity: spectrError.severity,
      context: spectrError.context,
    },
  }
}

/**
 * 创建 IPC 成功响应
 */
export function createSuccessResponse<T>(data: T): IpcSuccessResponse<T> {
  return {
    success: true,
    data,
  }
}
