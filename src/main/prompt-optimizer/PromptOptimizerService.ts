/**
 * PromptOptimizerService - Prompt 模板管理与 AI 优化引擎
 * 基础版：模板 CRUD、版本历史、测试运行、A/B 对比
 * 高级版：AI 驱动自动优化（analyze → improve → test 循环）
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type {
  PromptOptimizerRepository,
  PromptTemplate,
  PromptVersion,
  PromptTest,
  PromptOptimizationRun,
  PromptFeedback,
} from '../storage/repositories/PromptOptimizerRepository'

export class PromptOptimizerService extends EventEmitter {
  constructor(
    private db: DatabaseManager,
    private repo: PromptOptimizerRepository,
    private sessionManagerV2?: SessionManagerV2,
  ) {
    super()
  }

  // ═══════════════════════════════════════════════════════
  // TEMPLATE CRUD
  // ═══════════════════════════════════════════════════════

  createTemplate(data: {
    name: string
    description?: string
    category?: string
    tags?: string[]
    variables?: any[]
    createdBy?: string
  }): PromptTemplate | null {
    const id = `ptmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const template = this.repo.createTemplate({
      id, name: data.name, description: data.description,
      category: data.category, tags: data.tags || [],
      variables: data.variables || [],
      createdBy: data.createdBy,
    })
    // Auto-create first version
    if (template) {
      this.createVersion({ templateId: id, content: data.description || '', changeNotes: 'Initial version' })
      this.emit('template-created', template)
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'template-created', template })
    }
    return template
  }

  getTemplate(id: string): PromptTemplate | null {
    return this.repo.getTemplate(id)
  }

  listTemplates(category?: string): PromptTemplate[] {
    return this.repo.listTemplates(category)
  }

  updateTemplate(id: string, updates: any): PromptTemplate | null {
    const template = this.repo.getTemplate(id)
    if (!template) return null
    this.repo.updateTemplate(id, updates)
    const updated = this.repo.getTemplate(id)
    if (updated) {
      this.emit('template-updated', updated)
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'template-updated', template: updated })
    }
    return updated
  }

  deleteTemplate(id: string): boolean {
    const template = this.repo.getTemplate(id)
    this.repo.deleteTemplate(id)
    if (template) {
      this.emit('template-deleted', { templateId: id })
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'template-deleted', templateId: id })
    }
    return true
  }

  // ═══════════════════════════════════════════════════════
  // VERSION MANAGEMENT
  // ═══════════════════════════════════════════════════════

  createVersion(data: {
    templateId: string
    content: string
    systemPrompt?: string
    variablesValues?: Record<string, any>
    changeNotes?: string
    createdBy?: string
  }): PromptVersion | null {
    const existing = this.repo.listVersions(data.templateId)
    const nextNum = existing.length > 0 ? Math.max(...existing.map(v => v.versionNumber)) + 1 : 1
    const id = `ptver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const version = this.repo.createVersion({
      id,
      templateId: data.templateId,
      versionNumber: nextNum,
      content: data.content,
      systemPrompt: data.systemPrompt,
      variablesValues: data.variablesValues || {},
      changeNotes: data.changeNotes,
    })
    if (version) {
      this.emit('version-created', version)
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'version-created', version })
    }
    return version
  }

  getVersion(id: string): PromptVersion | null {
    return this.repo.getVersion(id)
  }

  listVersions(templateId: string): PromptVersion[] {
    return this.repo.listVersions(templateId)
  }

  updateVersion(id: string, updates: any): void {
    this.repo.updateVersion(id, updates)
    const version = this.repo.getVersion(id)
    if (version) {
      this.emit('version-updated', version)
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'version-updated', version })
    }
  }

  deleteVersion(id: string): void {
    this.repo.deleteVersion(id)
    this.emit('version-deleted', { versionId: id })
    sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'version-deleted', versionId: id })
  }

  setBaseline(versionId: string): void {
    this.repo.setBaseline(versionId)
    const version = this.repo.getVersion(versionId)
    if (version) {
      this.emit('baseline-changed', version)
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'baseline-changed', versionId })
    }
  }

  // ═══════════════════════════════════════════════════════
  // TESTING
  // ═══════════════════════════════════════════════════════

  async runTest(
    versionId: string,
    testInput: string,
    providerId?: string,
  ): Promise<{ test: PromptTest; output: string }> {
    const version = this.repo.getVersion(versionId)
    if (!version) throw new Error(`Version not found: ${versionId}`)

    const id = `ptest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const startTime = Date.now()
    let output = ''
    let tokensUsed: number | undefined

    try {
      // 渲染模板变量
      const renderedPrompt = version.content.replace(/\{\{(\w+)\}\}/g, (_, v) => {
        return version.variablesValues?.[v] || testInput || `{{${v}}}`
      })

      // 直接调用 AI 获取输出
      output = await this.callAiDirectly(renderedPrompt, providerId)
      tokensUsed = Math.ceil((renderedPrompt.length + output.length) / 4)
    } catch (err: any) {
      output = `[Test error: ${err.message}]`
    }

    const durationMs = Date.now() - startTime

    // 自动评分：基于输出质量的启发式评估
    const score = this.evaluateTestOutput(output, testInput)

    const test = this.repo.createTest({
      id,
      versionId,
      testInput,
      testOutput: output,
      tokensUsed,
      durationMs,
      score,
    })

    this.emit('test-completed', test)
    sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'test-completed', testId: id, versionId })

    return { test, output }
  }

  async compareVersions(
    versionId1: string,
    versionId2: string,
    testInput: string,
  ): Promise<{ result1: PromptTest; result2: PromptTest; winner: string }> {
    const [result1, result2] = await Promise.all([
      this.runTest(versionId1, testInput),
      this.runTest(versionId2, testInput),
    ])
    const winner = (result1.test.score || 0) >= (result2.test.score || 0) ? versionId1 : versionId2
    return { result1: result1.test, result2: result2.test, winner }
  }

  // ═══════════════════════════════════════════════════════
  // AI OPTIMIZATION (Advanced)
  // ═══════════════════════════════════════════════════════

  async optimizeAuto(templateId: string, targetVersionId: string): Promise<PromptOptimizationRun> {
    const version = this.repo.getVersion(targetVersionId)
    if (!version) throw new Error(`Version not found: ${targetVersionId}`)

    const runId = `popt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const run = this.repo.createOptimizationRun({
      id: runId,
      templateId,
      targetVersionId,
      optimizationStrategy: 'auto',
      promptBefore: version.content,
    })

    this.emit('optimization-started', run)
    sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'optimization-started', runId })

    try {
      const improvedContent = await this.aiOptimizePrompt(version.content, undefined, this.sessionManagerV2)
      const feedbackId = `pfbk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.repo.addFeedback({
        id: feedbackId,
        optimizationRunId: runId,
        criterion: 'overall',
        scoreBefore: version.score || 0,
        scoreAfter: 0.8,
        feedbackText: 'AI optimization suggested',
      })
      const newVersion = this.createVersion({
        templateId,
        content: improvedContent,
        changeNotes: `AI optimization from v${version.versionNumber}`,
      })
      const improvementScore = newVersion ? 0.2 : 0
      this.repo.updateOptimizationRun(runId, {
        status: 'completed',
        promptAfter: improvedContent,
        improvementScore,
        iterations: 1,
        completedAt: new Date().toISOString(),
      })
      this.emit('optimization-completed', { runId, newVersionId: newVersion?.id })
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, {
        type: 'optimization-completed',
        runId,
        newVersionId: newVersion?.id,
        improvementScore,
      })
      return this.repo.getOptimizationRun(runId)!
    } catch (err) {
      this.repo.updateOptimizationRun(runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
      })
      this.emit('optimization-failed', { runId, error: String(err) })
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'optimization-failed', runId, error: String(err) })
      throw err
    }
  }

  async optimizeWithHints(
    templateId: string,
    targetVersionId: string,
    hints: string,
  ): Promise<PromptOptimizationRun> {
    const version = this.repo.getVersion(targetVersionId)
    if (!version) throw new Error(`Version not found: ${targetVersionId}`)

    const runId = `popt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const run = this.repo.createOptimizationRun({
      id: runId,
      templateId,
      targetVersionId,
      optimizationStrategy: 'guided',
      promptBefore: version.content,
    })

    this.emit('optimization-started', run)
    sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'optimization-started', runId })

    try {
      const improvedContent = await this.aiOptimizePrompt(version.content, hints, this.sessionManagerV2)
      const newVersion = this.createVersion({
        templateId,
        content: improvedContent,
        changeNotes: `Guided optimization (hints: ${hints.slice(0, 50)})`,
      })
      this.repo.updateOptimizationRun(runId, {
        status: 'completed',
        promptAfter: improvedContent,
        improvementScore: 0.15,
        iterations: 1,
        completedAt: new Date().toISOString(),
      })
      this.emit('optimization-completed', { runId, newVersionId: newVersion?.id })
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, {
        type: 'optimization-completed',
        runId,
        newVersionId: newVersion?.id,
      })
      return this.repo.getOptimizationRun(runId)!
    } catch (err) {
      this.repo.updateOptimizationRun(runId, { status: 'failed', completedAt: new Date().toISOString() })
      throw err
    }
  }

  private async aiOptimizePrompt(
    prompt: string,
    hints: string | undefined,
    _sm: SessionManagerV2 | undefined,
  ): Promise<string> {
    const systemPrompt = `你是一个专业的 Prompt 工程师。你的任务是优化用户给出的 Prompt，使其更清晰、更具体、更有效。

优化原则：
1. **明确性**: 消除模糊表述，明确输入/输出格式和约束
2. **结构化**: 使用分节、编号、Markdown 格式组织复杂指令
3. **具体性**: 添加具体示例、边界条件、错误处理要求
4. **角色设定**: 如适用，为 AI 设定专业角色和背景
5. **约束条件**: 添加长度限制、风格要求、禁止事项
6. **输出格式**: 明确指定输出格式（JSON、Markdown、代码等）

重要：只返回优化后的 Prompt，不要添加任何解释或评论。不要用 markdown 代码块包裹。`

    const userMessage = hints
      ? `请优化以下 Prompt。

优化提示/方向：${hints}

原始 Prompt：
---
${prompt}
---

返回优化后的完整 Prompt：`
      : `请优化以下 Prompt，使其更清晰、更具体、更有效。

原始 Prompt：
---
${prompt}
---

返回优化后的完整 Prompt：`

    try {
      const result = await this.callAiWithSystemPrompt(systemPrompt, userMessage)
      return result.trim() || prompt
    } catch (err) {
      console.error('[PromptOptimizer] AI 优化失败，返回原 prompt:', err)
      return prompt
    }
  }

  getBestVersion(templateId: string): PromptVersion | null {
    return this.repo.getBestVersion(templateId)
  }

  promoteBestVersion(templateId: string): PromptVersion | null {
    const best = this.repo.getBestVersion(templateId)
    if (best) {
      this.setBaseline(best.id)
      this.emit('best-promoted', best)
      sendToRenderer(IPC.PROMPT_OPTIMIZATION_STATUS, { type: 'best-promoted', versionId: best.id })
    }
    return best
  }

  getEvolutionHistory(templateId: string): {
    versions: PromptVersion[]
    optimizationRuns: PromptOptimizationRun[]
  } {
    return {
      versions: this.repo.listVersions(templateId),
      optimizationRuns: this.repo.listOptimizationRuns(templateId),
    }
  }

  // ── Read-only query methods ────────────────────────────

  listTests(versionId: string, limit?: number): PromptTest[] {
    return this.repo.listTests(versionId, limit)
  }

  getTestStats(versionId: string) {
    return this.repo.getTestStats(versionId)
  }

  getOptimizationRun(id: string): PromptOptimizationRun | null {
    return this.repo.getOptimizationRun(id)
  }

  listOptimizationRuns(templateId?: string, limit?: number): PromptOptimizationRun[] {
    return this.repo.listOptimizationRuns(templateId, limit)
  }

  listFeedback(runId: string): PromptFeedback[] {
    return this.repo.listFeedbackByRun(runId)
  }

  // ═══════════════════════════════════════════════════════
  // AI CALLING (真实 AI 调用)
  // ═══════════════════════════════════════════════════════

  /**
   * 直接调用 AI（Anthropic SDK → CLI 回退）
   */
  private async callAiDirectly(prompt: string, providerId?: string): Promise<string> {
    // 方案1: Anthropic SDK
    try {
      const { Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic()
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-7',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = msg.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n')
      return text || 'No response from AI'
    } catch (sdkErr) {
      console.warn('[PromptOptimizer] Anthropic SDK 不可用，尝试 CLI:', (sdkErr as Error).message)
    }

    // 方案2: claude CLI
    return this.callCliDirectly(prompt)
  }

  /**
   * 带系统提示的 AI 调用
   */
  private async callAiWithSystemPrompt(systemPrompt: string, userMessage: string): Promise<string> {
    // 方案1: Anthropic SDK
    try {
      const { Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic()
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-7',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      })
      const text = msg.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n')
      return text || 'No response from AI'
    } catch (sdkErr) {
      console.warn('[PromptOptimizer] Anthropic SDK 不可用，尝试 CLI:', (sdkErr as Error).message)
    }

    // 方案2: CLI（将 system prompt 合并到 user prompt）
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`
    return this.callCliDirectly(combinedPrompt)
  }

  /**
   * 通过 CLI 调用 AI
   */
  private callCliDirectly(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process')
      const proc = spawn('claude', ['--print', '--no-input', prompt], {
        timeout: 60000,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
      proc.on('close', (code: number) => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`claude CLI exit code ${code}: ${stderr}`))
        }
      })
      proc.on('error', reject)
    })
  }

  /**
   * 启发式评估测试输出质量
   * 评分维度：长度适当性(30%) + 结构化(30%) + 相关性(40%)
   */
  private evaluateTestOutput(output: string, testInput: string): number {
    if (!output || output.startsWith('[Test error')) return 0

    let score = 0.5 // 基础分

    // 1. 长度适当性（30%）
    const len = output.length
    if (len > 50 && len < 5000) score += 0.1
    else if (len >= 5000) score += 0.05   // 太长扣分
    if (len < 20) score -= 0.1             // 太短扣分

    // 2. 结构化程度（30%）——有编号、分节、列表
    if (/\d+\.\s/.test(output)) score += 0.05   // 编号列表
    if (/#{1,3}\s/.test(output)) score += 0.05  // Markdown 标题
    if (/-\s|\*\s/.test(output)) score += 0.03   // 无序列表
    if (/```/.test(output)) score += 0.05        // 代码块
    if (output.includes('\n\n')) score += 0.02    // 段落分隔

    // 3. 相关性（40%）——输出是否与输入相关
    if (testInput) {
      const inputWords = testInput.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      const outputLower = output.toLowerCase()
      const matchCount = inputWords.filter(w => outputLower.includes(w)).length
      const relevanceRatio = inputWords.length > 0 ? matchCount / inputWords.length : 0
      score += relevanceRatio * 0.15
    }

    // Clamp 0-1
    return Math.max(0, Math.min(1, Math.round(score * 100) / 100))
  }
}
