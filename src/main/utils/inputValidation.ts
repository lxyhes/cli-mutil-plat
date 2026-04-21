/**
 * 输入验证和 Sanitization 中间件
 * 
 * 防止注入攻击、XSS、路径遍历等安全问题
 * @author weibin
 */

import { logger } from '../logger'

/**
 * 验证规则类型
 */
export type ValidationRule = 
  | 'required'
  | 'string'
  | 'number'
  | 'boolean'
  | 'email'
  | 'url'
  | 'path'
  | 'sessionId'
  | 'teamId'
  | 'maxLength'
  | 'minLength'
  | 'pattern'
  | 'whitelist'

/**
 * 验证选项
 */
export interface ValidationOptions {
  rule: ValidationRule
  maxLength?: number
  minLength?: number
  pattern?: RegExp
  whitelist?: string[]
  custom?: (value: any) => boolean | string
  message?: string
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  sanitizedValue?: any
}

/**
 * 危险字符模式（用于检测潜在注入）
 */
const DANGEROUS_PATTERNS = [
  /<script[^>]*>[\s\S]*?<\/script>/gi, // script 标签
  /javascript\s*:/gi,                    // javascript: 协议
  /on\w+\s*=/gi,                         // 事件处理器
  /eval\s*\(/gi,                         // eval 调用
  /document\.\w+/gi,                     // document 访问
  /window\.\w+/gi,                       // window 访问
  /\.\.\/|\.\.\\/g,                      // 路径遍历
  /[<>\"'`]/g,                           // HTML 特殊字符
]

/**
 * Sanitize 字符串（移除危险字符）
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return String(input)
  
  let sanitized = input
  
  // 1. 移除 HTML 标签
  sanitized = sanitized.replace(/<[^>]*>/g, '')
  
  // 2. 转义特殊字符
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
  
  // 3. 移除控制字符（保留换行和制表符）
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  
  // 4. 截断过长内容
  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000)
    logger.warn('[Sanitizer] Input truncated to 10000 characters')
  }
  
  return sanitized.trim()
}

/**
 * Sanitize 文件路径（防止路径遍历）
 */
export function sanitizePath(input: string): string {
  if (typeof input !== 'string') return ''
  
  // 1. 移除 .. 序列
  let sanitized = input.replace(/\.\./g, '')
  
  // 2. 规范化路径分隔符
  sanitized = sanitized.replace(/[\\\/]+/g, '/')
  
  // 3. 移除前导斜杠（防止绝对路径）
  sanitized = sanitized.replace(/^\/+/, '')
  
  // 4. 只允许安全字符
  sanitized = sanitized.replace(/[^a-zA-Z0-9._\-\/\s]/g, '')
  
  return sanitized
}

/**
 * 验证会话 ID 格式
 */
export function isValidSessionId(id: string): boolean {
  // UUID v4 格式或自定义格式
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) ||
         /^[a-zA-Z0-9_-]{8,64}$/.test(id)
}

/**
 * 验证团队 ID 格式
 */
export function isValidTeamId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id)
}

/**
 * 验证输入值
 */
export function validateInput(value: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = []
  let sanitizedValue = value
  
  // Required 检查
  if (options.rule === 'required' && (value === null || value === undefined || value === '')) {
    errors.push(options.message || '字段不能为空')
    return { valid: false, errors }
  }
  
  // 如果值为空且非必填，直接返回
  if (value === null || value === undefined) {
    return { valid: true, errors, sanitizedValue: value }
  }
  
  // 类型检查
  switch (options.rule) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(options.message || '必须是字符串')
      } else {
        sanitizedValue = sanitizeString(value)
      }
      break
    
    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(options.message || '必须是有效数字')
      }
      break
    
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(options.message || '必须是布尔值')
      }
      break
    
    case 'email':
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push(options.message || '必须是有效的邮箱地址')
      }
      break
    
    case 'url':
      if (typeof value !== 'string' || !/^https?:\/\/.+$/.test(value)) {
        errors.push(options.message || '必须是有效的 URL')
      }
      break
    
    case 'path':
      if (typeof value !== 'string') {
        errors.push(options.message || '必须是字符串')
      } else {
        sanitizedValue = sanitizePath(value)
        if (!sanitizedValue) {
          errors.push(options.message || '路径包含非法字符')
        }
      }
      break
    
    case 'sessionId':
      if (typeof value !== 'string' || !isValidSessionId(value)) {
        errors.push(options.message || '无效的会话 ID 格式')
      }
      break
    
    case 'teamId':
      if (typeof value !== 'string' || !isValidTeamId(value)) {
        errors.push(options.message || '无效的团队 ID 格式')
      }
      break
    
    case 'maxLength':
      if (typeof value === 'string' && options.maxLength && value.length > options.maxLength) {
        errors.push(options.message || `长度不能超过 ${options.maxLength} 个字符`)
      }
      break
    
    case 'minLength':
      if (typeof value === 'string' && options.minLength && value.length < options.minLength) {
        errors.push(options.message || `长度不能少于 ${options.minLength} 个字符`)
      }
      break
    
    case 'pattern':
      if (typeof value === 'string' && options.pattern && !options.pattern.test(value)) {
        errors.push(options.message || '格式不匹配')
      }
      break
    
    case 'whitelist':
      if (options.whitelist && !options.whitelist.includes(value)) {
        errors.push(options.message || `值不在允许的范围内`)
      }
      break
  }
  
  // 自定义验证
  if (options.custom && typeof options.custom === 'function') {
    const result = options.custom(value)
    if (result !== true) {
      errors.push(typeof result === 'string' ? result : (options.message || '自定义验证失败'))
    }
  }
  
  // 检查危险模式
  if (typeof value === 'string') {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(value)) {
        logger.warn('[Validator] Dangerous pattern detected in input', { pattern: pattern.source })
        errors.push('输入包含不安全的内容')
        break
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    sanitizedValue
  }
}

/**
 * 批量验证多个字段
 */
export function validateFields(
  data: Record<string, any>,
  rules: Record<string, ValidationOptions>
): { valid: boolean; errors: Record<string, string[]>; sanitized: Record<string, any> } {
  const errors: Record<string, string[]> = {}
  const sanitized: Record<string, any> = {}
  
  for (const [field, options] of Object.entries(rules)) {
    const result = validateInput(data[field], options)
    
    if (!result.valid) {
      errors[field] = result.errors
    }
    
    sanitized[field] = result.sanitizedValue
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    sanitized
  }
}

/**
 * IPC Handler 验证包装器
 * 
 * @example
 * ```typescript
 * ipcMain.handle(IPC.SESSION_CREATE, 
 *   withValidation(
 *     {
 *       name: { rule: 'required', maxLength: 100 },
 *       workingDirectory: { rule: 'path' },
 *       providerType: { rule: 'whitelist', whitelist: ['claude-code', 'codex'] }
 *     },
 *     async (event, validatedData) => {
 *       // 使用已验证和清理的数据
 *       return sessionManager.createSession(validatedData)
 *     }
 *   )
 * )
 * ```
 */
export function withValidation(
  rules: Record<string, ValidationOptions>,
  handler: (event: Electron.IpcMainInvokeEvent, validatedData: any) => Promise<any>
) {
  return async (event: Electron.IpcMainInvokeEvent, ...args: any[]) => {
    const data = args[0] || {}
    
    // 验证输入
    const validation = validateFields(data, rules)
    
    if (!validation.valid) {
      logger.warn('[Validation] Input validation failed', { errors: validation.errors })
      throw new Error(`输入验证失败: ${JSON.stringify(validation.errors)}`)
    }
    
    // 调用处理函数（使用清理后的数据）
    return handler(event, validation.sanitized)
  }
}
