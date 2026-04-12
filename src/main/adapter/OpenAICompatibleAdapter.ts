/**
 * OpenAI Compatible Adapter - 通用 OpenAI API 兼容适配器
 *
 * 支持 OpenAI Chat Completions API 格式的所有模型提供商：
 * Deepseek、Qwen、GLM、Moonshot、Ollama、vLLM、LocalAI 等
 * 只需配置 base URL 和 API Key 即可接入
 *
 * @author weibin
 */

import { BaseProviderAdapter } from './types'
import type { AdapterSessionConfig, AdapterSession, ProviderEvent } from './types'
import type { ConversationMessage, SessionStatus } from '../../shared/types'

// ─── 类型定义 ─────────────────────────────────────────────

interface OpenAICompatibleConfig {
  /** API Base URL（如 https://api.deepseek.com/v1） */
  baseUrl: string
  /** API Key */
  apiKey: string
  /** 默认模型名 */
  defaultModel: string
  /** 请求超时（毫秒，默认 120000） */
  timeout: number
  /** 额外请求头 */
  extraHeaders: Record<string, string>
  /** 最大 tokens */
  maxTokens: number
  /** 温度 */
  temperature: number
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ─── Adapter 实现 ─────────────────────────────────────────

export class OpenAICompatibleAdapter extends BaseProviderAdapter {
  readonly providerId: string
  readonly displayName: string

  private sessions: Map<string, AdapterSession> = new Map()
  private configs: Map<string, OpenAICompatibleConfig> = new Map()
  private abortControllers: Map<string, AbortController> = new Map()

  constructor(providerId: string, displayName: string, config: OpenAICompatibleConfig) {
    super()
    this.providerId = providerId
    this.displayName = displayName
    this.configs.set(providerId, config)
  }

  /** 更新 Provider 配置 */
  updateConfig(config: Partial<OpenAICompatibleConfig>): void {
    const existing = this.configs.get(this.providerId) || this.getDefaultConfig()
    this.configs.set(this.providerId, { ...existing, ...config })
  }

  private getConfig(): OpenAICompatibleConfig {
    return this.configs.get(this.providerId) || this.getDefaultConfig()
  }

  private getDefaultConfig(): OpenAICompatibleConfig {
    return {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      defaultModel: 'gpt-4o',
      timeout: 120000,
      extraHeaders: {},
      maxTokens: 4096,
      temperature: 0.7,
    }
  }

  // ── Adapter 接口实现 ────────────────────────────────────

  async startSession(sessionId: string, config: AdapterSessionConfig): Promise<void> {
    const session: AdapterSession = {
      sessionId,
      status: 'running',
      messages: [],
      createdAt: new Date().toISOString(),
      totalUsage: { inputTokens: 0, outputTokens: 0 },
    }

    // 解析系统提示词
    if (config.systemPrompt) {
      const sysContent = typeof config.systemPrompt === 'string'
        ? config.systemPrompt
        : (config.systemPrompt as any).append || (config.systemPrompt as any).preset || ''
      if (sysContent) {
        session.messages.push({
          id: `msg-${Date.now()}-sys`,
          sessionId,
          role: 'system',
          content: sysContent,
          timestamp: new Date().toISOString(),
        })
      }
    }

    // 存储配置
    ;(session as any).adapterConfig = config
    this.sessions.set(sessionId, session)

    this.emitEvent(sessionId, 'session_complete', { exitCode: 0 })
    // 实际上 OpenAI Compatible 不维护长连接，标记为 idle 等待输入
    this.emitStatusChange(sessionId, 'idle')

    // 如果有初始 prompt，自动发送
    if (config.initialPrompt) {
      await this.sendMessage(sessionId, config.initialPrompt)
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const config = this.getConfig()
    if (!config.apiKey) {
      this.emitEvent(sessionId, 'error', { text: 'API Key 未配置，请在 Provider 设置中填写' })
      return
    }

    // 添加用户消息
    const userMsg: ConversationMessage = {
      id: `msg-${Date.now()}-user`,
      sessionId,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    }
    session.messages.push(userMsg)
    this.emitEvent(sessionId, 'text_delta', { text: '' }) // 清空
    this.emitStatusChange(sessionId, 'running')

    // 构建 OpenAI 格式消息
    const chatMessages: ChatMessage[] = session.messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content || '',
    }))

    // 获取模型名（从配置或默认）
    const adapterConfig = (session as any).adapterConfig as AdapterSessionConfig | undefined
    const model = adapterConfig?.model || config.defaultModel

    const abortController = new AbortController()
    this.abortControllers.set(sessionId, abortController)

    try {
      const baseUrl = config.baseUrl.replace(/\/$/, '')
      const url = `${baseUrl}/chat/completions`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        ...config.extraHeaders,
      }

      const body = JSON.stringify({
        model,
        messages: chatMessages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        stream: true,
      })

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API Error ${response.status}: ${errorText}`)
      }

      // 流式读取 SSE
      let fullContent = ''
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          try {
            const data = JSON.parse(trimmed.slice(6))
            const delta = data.choices?.[0]?.delta?.content
            if (delta) {
              fullContent += delta
              this.emitEvent(sessionId, 'text_delta', { text: delta })
            }
          } catch {
            // 忽略解析错误
          }
        }
      }

      // 添加助手消息
      const assistantMsg: ConversationMessage = {
        id: `msg-${Date.now()}-assistant`,
        sessionId,
        role: 'assistant',
        content: fullContent,
        timestamp: new Date().toISOString(),
      }
      session.messages.push(assistantMsg)

      this.emitEvent(sessionId, 'turn_complete', {
        usage: { inputTokens: 0, outputTokens: 0 },
      })
      this.emitStatusChange(sessionId, 'idle')
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 用户主动中止
        this.emitEvent(sessionId, 'turn_complete', { usage: { inputTokens: 0, outputTokens: 0 } })
        this.emitStatusChange(sessionId, 'idle')
      } else {
        this.emitEvent(sessionId, 'error', { text: err.message })
        this.emitStatusChange(sessionId, 'error')
      }
    } finally {
      this.abortControllers.delete(sessionId)
    }
  }

  async sendConfirmation(sessionId: string, accept: boolean): Promise<void> {
    // OpenAI Compatible 不需要确认
  }

  async abortCurrentTurn(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
    }
  }

  async terminateSession(sessionId: string): Promise<void> {
    this.abortCurrentTurn(sessionId)
    this.sessions.delete(sessionId)
  }

  async resumeSession(sessionId: string, providerSessionId: string, config: AdapterSessionConfig): Promise<void> {
    // OpenAI Compatible 无状态，直接创建新会话
    await this.startSession(sessionId, config)
  }

  getConversation(sessionId: string): ConversationMessage[] {
    return this.sessions.get(sessionId)?.messages || []
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getProviderSessionId(sessionId: string): string | undefined {
    return undefined  // 无状态 API
  }

  cleanup(): void {
    for (const [sid] of this.sessions) {
      this.abortCurrentTurn(sid)
    }
    this.sessions.clear()
    this.configs.clear()
    this.abortControllers.clear()
  }

  // ── Private ─────────────────────────────────────────────

  private emitEvent(sessionId: string, type: ProviderEvent['type'], data: ProviderEvent['data']): void {
    const event: ProviderEvent = {
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      data,
    }
    this.emit('event', event)
  }

  private emitStatusChange(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId)
    if (session) session.status = status
    this.emit('status-change', sessionId, status)
  }
}

// ─── 预定义 OpenAI Compatible Provider 工厂 ────────────────

/** 创建 Deepseek 适配器 */
export function createDeepseekAdapter(apiKey: string): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter('deepseek', 'Deepseek', {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey,
    defaultModel: 'deepseek-chat',
    timeout: 120000,
    extraHeaders: {},
    maxTokens: 8192,
    temperature: 0.7,
  })
}

/** 创建 GLM 适配器 */
export function createGlmAdapter(apiKey: string): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter('glm', 'GLM', {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey,
    defaultModel: 'glm-4',
    timeout: 120000,
    extraHeaders: {},
    maxTokens: 4096,
    temperature: 0.7,
  })
}

/** 创建 Moonshot 适配器 */
export function createMoonshotAdapter(apiKey: string): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter('moonshot', 'Moonshot', {
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey,
    defaultModel: 'moonshot-v1-8k',
    timeout: 120000,
    extraHeaders: {},
    maxTokens: 4096,
    temperature: 0.7,
  })
}

/** 创建 Ollama 本地适配器 */
export function createOllamaAdapter(): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter('ollama', 'Ollama', {
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama',  // Ollama 不需要 key，但 API 格式要求
    defaultModel: 'qwen2.5-coder:7b',
    timeout: 300000,
    extraHeaders: {},
    maxTokens: 8192,
    temperature: 0.7,
  })
}
