/**
 * SummaryService - LLM-driven session summary generation
 */
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { DatabaseManager } from '../storage/Database'
import type { ConversationMessage } from '../../shared/types'
import type { SummaryRepository, SummaryType } from '../storage/repositories/SummaryRepository'

export interface GenerateOptions {
  /** 生成摘要类型: 'auto' | 'manual' | 'key_points' */
  type?: SummaryType
  /** 是否同时生成 key_points */
  includeKeyPoints?: boolean
  /** AI provider id (默认: claude) */
  providerId?: string
  /** AI model */
  model?: string
  /** 最大输入 token 数（截断用） */
  maxInputTokens?: number
}

export interface GenerateResult {
  id: number | null
  summary: string
  keyPoints?: string
  inputTokens?: number
  outputTokens?: number
  tokensUsed?: number
  costUsd?: number
  aiProvider?: string
  aiModel?: string
}

export class SummaryService {
  constructor(
    private db: DatabaseManager,
    private sessionManagerV2: SessionManagerV2,
  ) {}

  /**
   * 生成会话摘要
   * 使用 SessionManagerV2 获取对话历史，然后调用 AI 生成摘要
   */
  async generateSummary(sessionId: string, options: GenerateOptions = {}): Promise<GenerateResult> {
    const {
      type = 'auto',
      includeKeyPoints = true,
      providerId = 'claude',
      model = 'claude-sonnet-4-7',
      maxInputTokens = 32000,
    } = options

    // 1. 获取会话对话历史
    const messages = this.sessionManagerV2.getConversation(sessionId)
    if (messages.length === 0) {
      return { id: null, summary: 'No conversation history found for this session.' }
    }

    // 2. 构造摘要 prompt
    const conversationText = this.buildConversationText(messages, maxInputTokens)

    // 3. 调用 AI 生成摘要
    const summaryResult = await this.callAiForSummary(conversationText, type, providerId, model)

    // 4. 如果需要，生成 key_points
    let keyPoints: string | undefined
    if (includeKeyPoints) {
      keyPoints = await this.callAiForKeyPoints(conversationText, providerId, model)
    }

    // 5. 保存到数据库
    const id = this.db.addSummary({
      sessionId,
      summary: summaryResult.summary,
      keyPoints,
      aiProvider: providerId,
      aiModel: model,
      inputTokens: summaryResult.inputTokens,
      outputTokens: summaryResult.outputTokens,
      tokensUsed: summaryResult.tokensUsed,
      costUsd: summaryResult.costUsd,
      summaryType: type,
    })

    return {
      id,
      summary: summaryResult.summary,
      keyPoints,
      inputTokens: summaryResult.inputTokens,
      outputTokens: summaryResult.outputTokens,
      tokensUsed: summaryResult.tokensUsed,
      costUsd: summaryResult.costUsd,
      aiProvider: providerId,
      aiModel: model,
    }
  }

  /**
   * 生成 key_points（关键点）
   */
  async generateKeyPoints(sessionId: string, providerId = 'claude'): Promise<string | null> {
    const messages = this.sessionManagerV2.getConversation(sessionId)
    if (messages.length === 0) return null
    const text = this.buildConversationText(messages, 32000)
    return this.callAiForKeyPoints(text, providerId, 'claude-sonnet-4-7')
  }

  /**
   * 获取会话最新摘要
   */
  getSummary(sessionId: string) {
    return this.db.getLatestSummary(sessionId)
  }

  /**
   * 获取单个摘要
   */
  getSummaryById(id: number) {
    return this.db.getSummary(id)
  }

  /**
   * 获取会话的摘要列表
   */
  listSummaries(sessionId: string, limit = 20) {
    return this.db.listSummaries(sessionId, limit)
  }

  /**
   * 获取所有会话的最新摘要
   */
  listAllSummaries(limit = 50) {
    return this.db.listAllLatestSummaries(limit)
  }

  /**
   * 更新摘要
   */
  updateSummary(id: number, updates: {
    summary?: string
    keyPoints?: string
    qualityScore?: number
    summaryType?: SummaryType
  }) {
    return this.db.updateSummary(id, updates)
  }

  /**
   * 删除摘要
   */
  deleteSummary(id: number) {
    return this.db.deleteSummary(id)
  }

  /**
   * 删除会话的所有摘要
   */
  deleteSessionSummaries(sessionId: string) {
    return this.db.deleteSessionSummaries(sessionId)
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * 将对话历史转换为文本（用于 AI 输入）
   */
  private buildConversationText(messages: ConversationMessage[], maxTokens: number): string {
    const lines: string[] = []
    const maxChars = maxTokens * 4  // 粗略估算: ~4 chars/token

    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role
      let content = msg.content || ''

      // 如果有 tool 调用，简略显示
      if (msg.toolUses && msg.toolUses.length > 0) {
        const toolNames = msg.toolUses.map((t: any) => t.name).join(', ')
        content = `[Used tools: ${toolNames}] ${content}`.trim()
      }

      // 截断超长消息
      if (content.length > 4000) {
        content = content.slice(0, 4000) + '\n...(truncated)'
      }

      const line = `**${role}:** ${content}`
      lines.push(line)
    }

    // 按字符数截断
    let result = lines.join('\n\n')
    if (result.length > maxChars) {
      result = result.slice(0, maxChars) + '\n\n...(truncated for token limit)'
    }

    return result
  }

  /**
   * 调用 AI 生成摘要
   */
  private async callAiForSummary(
    conversationText: string,
    type: SummaryType,
    providerId: string,
    model: string,
  ): Promise<{
    summary: string
    inputTokens: number
    outputTokens: number
    tokensUsed: number
    costUsd: number
  }> {
    // 构建 prompt
    const summaryTypePrompt = type === 'key_points'
      ? 'extract the most important key points'
      : type === 'manual'
      ? 'create a detailed summary of'
      : 'summarize'

    const prompt = `Please ${summaryTypePrompt} the following conversation. Focus on:
1. What was the main task or goal?
2. What approach or methodology was used?
3. What files were created or modified?
4. What were the key decisions or outcomes?

Provide a concise but comprehensive summary in Chinese if the conversation is in Chinese, otherwise in English. Aim for 3-5 paragraphs.

=== CONVERSATION ===
${conversationText}
=== END ===

Your summary:`

    try {
      // 使用 SessionManagerV2 创建一个临时会话来生成摘要
      // 策略: 直接通过 sessionManagerV2 的 sendMessage 机制，但更简单的方式是
      // 通过 AI SDK 直接调用（不创建会话）

      // 方案1: 通过临时会话调用
      const { text: result, usage } = await this.callAiDirectly(prompt, providerId, model)

      // 使用真实 token 用量（如果 SDK 返回了），否则估算
      const inputTokens = usage?.inputTokens ?? Math.ceil(prompt.length / 4)
      const outputTokens = usage?.outputTokens ?? Math.ceil(result.length / 4)
      const tokensUsed = inputTokens + outputTokens
      const costUsd = this.estimateCost(inputTokens, outputTokens, model)

      return {
        summary: result,
        inputTokens,
        outputTokens,
        tokensUsed,
        costUsd,
      }
    } catch (err) {
      console.error('[SummaryService] callAiForSummary error:', err)
      return {
        summary: `Summary generation failed: ${(err as Error).message}`,
        inputTokens: 0,
        outputTokens: 0,
        tokensUsed: 0,
        costUsd: 0,
      }
    }
  }

  /**
   * 调用 AI 生成关键点
   */
  private async callAiForKeyPoints(
    conversationText: string,
    providerId: string,
    model: string,
  ): Promise<string> {
    const prompt = `Please extract 3-7 key points from the following conversation. Format as a numbered list.

=== CONVERSATION ===
${conversationText}
=== END ===

Key points (in Chinese if conversation is Chinese, otherwise English):`

    try {
      const { text } = await this.callAiDirectly(prompt, providerId, model)
      return text
    } catch (err) {
      console.error('[SummaryService] callAiForKeyPoints error:', err)
      return `Key points extraction failed: ${(err as Error).message}`
    }
  }

  /**
   * 直接调用 AI（不创建会话，用于摘要生成）
   * 支持：Claude SDK / OpenAI SDK / CLI fallback
   * 返回文本和 token 用量（避免实例变量并发问题）
   */
  private async callAiDirectly(
    prompt: string,
    providerId: string,
    model: string,
  ): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
    // 尝试使用 Claude SDK
    if (providerId === 'claude' || providerId === 'claude-code') {
      try {
        const { Anthropic } = await import('@anthropic-ai/sdk')
        const client = new Anthropic()

        const msg = await client.messages.create({
          model: model || 'claude-sonnet-4-7',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        })

        const text = msg.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as any).text)
          .join('\n')

        const usage = msg.usage
          ? { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens }
          : undefined

        return { text: text || 'No response from AI', usage }
      } catch (sdkErr) {
        console.warn('[SummaryService] Claude SDK unavailable, trying other providers:', (sdkErr as Error).message)
      }
    }

    // 尝试使用 OpenAI SDK
    if (providerId === 'openai' || providerId === 'gpt') {
      try {
        const OpenAI = (await import('openai')).default
        const client = new OpenAI()

        const response = await client.chat.completions.create({
          model: model || 'gpt-4o',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        })

        const text = response.choices[0]?.message?.content || 'No response from AI'
        const usage = response.usage
          ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
          : undefined

        return { text, usage }
      } catch (sdkErr) {
        console.warn('[SummaryService] OpenAI SDK unavailable, trying CLI:', (sdkErr as Error).message)
      }
    }

    // 备选: 使用 CLI 直接调用
    const cliResult = await this.callCliDirectly(prompt, providerId)
    return { text: cliResult }
  }

  /**
   * 通过 CLI 直接调用 AI（支持多种 CLI provider）
   */
  private callCliDirectly(prompt: string, providerId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process')
      // 根据 provider 选择对应的 CLI
      const cliMap: Record<string, string> = {
        'claude-code': 'claude',
        'claude': 'claude',
        'gemini-cli': 'gemini',
        'qwen-coder': 'qwen',
        'opencode': 'opencode',
      }
      const cliCmd = cliMap[providerId || ''] || 'claude'
      const proc = spawn(cliCmd, ['--print', prompt], {
        timeout: 30000,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
      proc.on('close', (code: number) => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`${cliCmd} CLI exit code ${code}: ${stderr}`))
        }
      })
      proc.on('error', reject)
    })
  }

  /**
   * 估算 API 调用成本（区分 input/output token 价格）
   */
  private estimateCost(inputTokens: number, outputTokens: number, model: string): number {
    // 价格表 (USD per 1M tokens)，格式: [input, output]
    const pricePerM: Record<string, [number, number]> = {
      'claude-sonnet-4-7': [3, 15],
      'claude-opus-4-7': [15, 75],
      'claude-3-5-sonnet': [3, 15],
      'claude-3-5-haiku': [0.8, 4],
      'claude-3-opus': [15, 75],
      'claude-3-sonnet': [3, 15],
      'claude-3-haiku': [0.8, 4],
      'gpt-4o': [2.5, 10],
      'gpt-4o-mini': [0.15, 0.6],
      'gpt-4-turbo': [10, 30],
      'gpt-3.5-turbo': [0.5, 1.5],
    }
    const [inputPrice, outputPrice] = pricePerM[model] || [3, 15]
    return (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice
  }
}
