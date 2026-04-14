/**
 * WorkflowService - 工作流编排引擎
 * 支持步骤类型：prompt / http / condition / delay
 * 按 DAG 顺序执行，支持并行步骤
 */
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { WorkflowStatus, WorkflowStep } from '../storage/repositories/WorkflowRepository'
import { ErrorCode, SpectrAIError } from '../../shared/errors'

export type WorkflowServiceStatus = 'stopped' | 'running'

interface RunningExecution {
  executionId: string
  workflowId: string
  startedAt: number
  paused: boolean
}

type ConditionTokenType =
  | 'identifier'
  | 'number'
  | 'string'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'paren'
  | 'comma'
  | 'dot'
  | 'eof'

interface ConditionToken {
  type: ConditionTokenType
  value: string
}

type ConditionNode =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'path'; segments: string[] }
  | { type: 'call'; name: string; args: ConditionNode[] }
  | { type: 'unary'; operator: '!'; argument: ConditionNode }
  | {
      type: 'binary'
      operator: '||' | '&&' | '===' | '!==' | '>' | '>=' | '<' | '<='
      left: ConditionNode
      right: ConditionNode
    }

type ConditionComparisonOperator = '===' | '!==' | '>' | '>=' | '<' | '<='

const DISALLOWED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char)
}

function tokenizeConditionExpression(expression: string): ConditionToken[] {
  const tokens: ConditionToken[] = []
  let index = 0

  while (index < expression.length) {
    const char = expression[index]

    if (/\s/.test(char)) {
      index++
      continue
    }

    const twoCharOp = expression.slice(index, index + 2)
    const threeCharOp = expression.slice(index, index + 3)
    if (threeCharOp === '===') {
      tokens.push({ type: 'operator', value: '===' })
      index += 3
      continue
    }
    if (threeCharOp === '!==') {
      tokens.push({ type: 'operator', value: '!==' })
      index += 3
      continue
    }
    if (twoCharOp === '&&' || twoCharOp === '||' || twoCharOp === '>=' || twoCharOp === '<=') {
      tokens.push({ type: 'operator', value: twoCharOp })
      index += 2
      continue
    }
    if (char === '!' || char === '>' || char === '<') {
      tokens.push({ type: 'operator', value: char })
      index++
      continue
    }
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char })
      index++
      continue
    }
    if (char === ',') {
      tokens.push({ type: 'comma', value: char })
      index++
      continue
    }
    if (char === '.') {
      tokens.push({ type: 'dot', value: char })
      index++
      continue
    }
    if (char === '"' || char === '\'') {
      const quote = char
      let value = ''
      let terminated = false
      index++
      while (index < expression.length) {
        const current = expression[index]
        if (current === '\\') {
          const next = expression[index + 1]
          if (next === undefined) break
          value += next
          index += 2
          continue
        }
        if (current === quote) {
          index++
          tokens.push({ type: 'string', value })
          terminated = true
          break
        }
        value += current
        index++
      }
      if (!terminated) {
        throw new Error('Unterminated string literal')
      }
      continue
    }
    if (/[0-9]/.test(char)) {
      let value = char
      index++
      while (index < expression.length && /[0-9.]/.test(expression[index])) {
        value += expression[index]
        index++
      }
      if (!/^\d+(?:\.\d+)?$/.test(value)) {
        throw new Error(`Invalid number literal: ${value}`)
      }
      tokens.push({ type: 'number', value })
      continue
    }
    if (isIdentifierStart(char)) {
      let value = char
      index++
      while (index < expression.length && isIdentifierPart(expression[index])) {
        value += expression[index]
        index++
      }
      if (value === 'true' || value === 'false') {
        tokens.push({ type: 'boolean', value })
      } else if (value === 'null') {
        tokens.push({ type: 'null', value })
      } else {
        tokens.push({ type: 'identifier', value })
      }
      continue
    }

    throw new Error(`Unsupported token: ${char}`)
  }

  tokens.push({ type: 'eof', value: '' })
  return tokens
}

class ConditionParser {
  private index = 0

  constructor(private readonly tokens: ConditionToken[]) {}

  parse(): ConditionNode {
    const expression = this.parseOr()
    this.expect('eof')
    return expression
  }

  private parseOr(): ConditionNode {
    let node = this.parseAnd()
    while (this.match('operator', '||')) {
      node = { type: 'binary', operator: '||', left: node, right: this.parseAnd() }
    }
    return node
  }

  private parseAnd(): ConditionNode {
    let node = this.parseComparison()
    while (this.match('operator', '&&')) {
      node = { type: 'binary', operator: '&&', left: node, right: this.parseComparison() }
    }
    return node
  }

  private parseComparison(): ConditionNode {
    let node = this.parseUnary()
    while (true) {
      const token = this.peek()
      if (token.type !== 'operator') break
      if (!['===', '!==', '>', '>=', '<', '<='].includes(token.value)) break
      this.index++
      const right = this.parseUnary()
      node = {
        type: 'binary',
        operator: token.value as ConditionComparisonOperator,
        left: node,
        right,
      }
    }
    return node
  }

  private parseUnary(): ConditionNode {
    if (this.match('operator', '!')) {
      return { type: 'unary', operator: '!', argument: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ConditionNode {
    const token = this.peek()

    if (this.match('paren', '(')) {
      const expr = this.parseOr()
      this.expect('paren', ')')
      return expr
    }
    if (token.type === 'number') {
      this.index++
      return { type: 'literal', value: Number(token.value) }
    }
    if (token.type === 'string') {
      this.index++
      return { type: 'literal', value: token.value }
    }
    if (token.type === 'boolean') {
      this.index++
      return { type: 'literal', value: token.value === 'true' }
    }
    if (token.type === 'null') {
      this.index++
      return { type: 'literal', value: null }
    }
    if (token.type === 'identifier') {
      return this.parseIdentifierOrCall()
    }

    throw new Error(`Unexpected token: ${token.value || token.type}`)
  }

  private parseIdentifierOrCall(): ConditionNode {
    const segments = [this.expect('identifier').value]
    while (this.match('dot')) {
      const next = this.expect('identifier').value
      segments.push(next)
    }

    if (segments.some(segment => DISALLOWED_PATH_SEGMENTS.has(segment))) {
      throw new Error('Unsafe property access is not allowed')
    }

    if (segments.length === 1 && this.match('paren', '(')) {
      const args: ConditionNode[] = []
      if (!this.match('paren', ')')) {
        do {
          args.push(this.parseOr())
        } while (this.match('comma'))
        this.expect('paren', ')')
      }
      return { type: 'call', name: segments[0], args }
    }

    return { type: 'path', segments }
  }

  private peek(): ConditionToken {
    return this.tokens[this.index]
  }

  private match(type: ConditionTokenType, value?: string): boolean {
    const token = this.tokens[this.index]
    if (!token || token.type !== type) return false
    if (value !== undefined && token.value !== value) return false
    this.index++
    return true
  }

  private expect(type: ConditionTokenType, value?: string): ConditionToken {
    const token = this.tokens[this.index]
    if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${value ?? type}`)
    }
    this.index++
    return token
  }
}

function parseConditionExpression(expression: string): ConditionNode {
  const trimmed = expression.trim()
  if (!trimmed) {
    throw new Error('Condition expression cannot be empty')
  }
  return new ConditionParser(tokenizeConditionExpression(trimmed)).parse()
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function resolveConditionPath(scope: Record<string, any>, segments: string[]): any {
  let current: any = scope
  for (const segment of segments) {
    if (DISALLOWED_PATH_SEGMENTS.has(segment)) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (!isPlainObject(current) && typeof current !== 'function') {
      return undefined
    }
    current = current[segment]
  }
  return current
}

function evaluateConditionNode(node: ConditionNode, scope: Record<string, any>): any {
  switch (node.type) {
    case 'literal':
      return node.value
    case 'path':
      return resolveConditionPath(scope, node.segments)
    case 'unary':
      return !Boolean(evaluateConditionNode(node.argument, scope))
    case 'binary': {
      if (node.operator === '||') {
        return Boolean(evaluateConditionNode(node.left, scope)) || Boolean(evaluateConditionNode(node.right, scope))
      }
      if (node.operator === '&&') {
        return Boolean(evaluateConditionNode(node.left, scope)) && Boolean(evaluateConditionNode(node.right, scope))
      }

      const left = evaluateConditionNode(node.left, scope)
      const right = evaluateConditionNode(node.right, scope)
      switch (node.operator) {
        case '===':
          return left === right
        case '!==':
          return left !== right
        case '>':
          return left > right
        case '>=':
          return left >= right
        case '<':
          return left < right
        case '<=':
          return left <= right
      }
      return false
    }
    case 'call': {
      const helpers: Record<string, (...args: any[]) => any> = {
        and: (a: any, b: any) => Boolean(a) && Boolean(b),
        or: (a: any, b: any) => Boolean(a) || Boolean(b),
        not: (a: any) => !Boolean(a),
        eq: (a: any, b: any) => a === b,
        ne: (a: any, b: any) => a !== b,
        gt: (a: any, b: any) => a > b,
        gte: (a: any, b: any) => a >= b,
        lt: (a: any, b: any) => a < b,
        lte: (a: any, b: any) => a <= b,
        contains: (a: any, b: any) => String(a ?? '').includes(String(b ?? '')),
        startsWith: (a: any, b: any) => String(a ?? '').startsWith(String(b ?? '')),
        endsWith: (a: any, b: any) => String(a ?? '').endsWith(String(b ?? '')),
      }
      const fn = helpers[node.name]
      if (!fn) {
        throw new Error(`Unsupported function: ${node.name}`)
      }
      return fn(...node.args.map(arg => evaluateConditionNode(arg, scope)))
    }
  }
}

export class WorkflowService extends EventEmitter {
  private status: WorkflowServiceStatus = 'stopped'
  private runningExecutions: Map<string, RunningExecution> = new Map()

  constructor(
    private db: DatabaseManager,
    private sessionManagerV2?: SessionManagerV2,
  ) {
    super()
  }

  // ── 生命周期 ────────────────────────────────────────────

  start(): void {
    if (this.status === 'running') return
    this.status = 'running'
    sendToRenderer(IPC.WORKFLOW_STATUS, 'running')
    console.log('[Workflow] Started')
  }

  stop(): void {
    // 暂停所有运行中的执行
    for (const [executionId, exec] of this.runningExecutions) {
      this.db.updateWorkflowExecution(executionId, {
        status: 'paused',
        completedAt: new Date(),
      })
    }
    this.runningExecutions.clear()
    this.status = 'stopped'
    sendToRenderer(IPC.WORKFLOW_STATUS, 'stopped')
    console.log('[Workflow] Stopped')
  }

  getStatus(): WorkflowServiceStatus {
    return this.status
  }

  // ── 步骤执行 ────────────────────────────────────────────

  private async executeStep(
    step: WorkflowStep,
    stepOrder: number,
    executionId: string,
    context: Record<string, any>,
    variables: Record<string, any>,
  ): Promise<{ output: string; newContext: Record<string, any>; newVariables: Record<string, any> }> {
    const runId = `wrun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 创建步骤运行记录
    this.db.createWorkflowRun({
      id: runId,
      executionId,
      stepId: step.id,
      stepOrder,
      status: 'running',
      input: { ...context, ...variables },
      retries: step.retries || 0,
    })

    sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'step-started', executionId, stepId: step.id, runId })

    let output = ''
    let newContext = { ...context }
    let newVariables = { ...variables }
    const stepStart = Date.now()

    try {
      switch (step.type) {
        case 'prompt': {
          if (!this.sessionManagerV2) throw new Error('SessionManagerV2 not available')
          const result = await this.createWorkflowSession(step, {
            ...context,
            ...variables,
          })
          output = result.output
          newContext = { ...newContext, lastSessionId: result.sessionId, lastPromptOutput: output }
          break
        }

        case 'http': {
          if (!step.httpMethod || !step.httpUrl) throw new Error('http: method and url are required')
          const response = await fetch(step.httpUrl, {
            method: step.httpMethod,
            headers: step.httpHeaders || {},
            body: step.httpBody ? JSON.stringify(this.resolveVariables(step.httpBody, { ...newContext, ...newVariables })) : undefined,
          })
          const text = await response.text()
          output = `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`
          newContext = { ...newContext, lastHttpStatus: response.status, lastHttpBody: text }
          break
        }

        case 'delay': {
          const delayMs = this.resolveValue(step.delayMs || 1000, { ...newContext, ...newVariables }) as number
          await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 300000))) // 最多 5 分钟
          output = `Delayed ${delayMs}ms`
          break
        }

        case 'condition': {
          const expression = step.conditionExpression || 'false'
          const result = this.evaluateCondition(expression, { ...newContext, ...newVariables })
          output = result ? 'Condition: true' : 'Condition: false'
          newContext = { ...newContext, lastCondition: result }
          break
        }

        default:
          output = `Unknown step type: ${(step as any).type}`
      }

      const durationMs = Date.now() - stepStart
      this.db.updateWorkflowRun(runId, {
        status: 'completed',
        completedAt: new Date(),
        durationMs,
        output,
      })

      sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'step-completed', executionId, stepId: step.id, runId, output })

      return { output, newContext, newVariables }
    } catch (err: any) {
      const durationMs = Date.now() - stepStart
      this.db.updateWorkflowRun(runId, {
        status: 'failed',
        completedAt: new Date(),
        durationMs,
        error: String(err),
      })

      sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'step-failed', executionId, stepId: step.id, runId, error: String(err) })

      throw err
    }
  }

  private async createWorkflowSession(step: WorkflowStep, context: Record<string, any>): Promise<{ sessionId: string; output: string }> {
    const sessionId = `workflow-${randomUUID()}`
    if (!this.sessionManagerV2) throw new Error('SessionManagerV2 not available')

    const prompt = this.resolveVariables(step.prompt || '', context)
    let output = ''
    let resolved = false

    // 监听 AI 完成回复
    const handler = (sid: string, msg: any) => {
      if (sid !== sessionId) return
      if (msg.isDelta && msg.content) {
        output += msg.content
      }
      if (!msg.isDelta && msg.role === 'assistant' && msg.content) {
        output = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        resolved = true
        this.sessionManagerV2?.removeListener('conversation-message', handler)
      }
    }

    this.sessionManagerV2?.on('conversation-message', handler)

    try {
      this.sessionManagerV2?.createSession({
        id: sessionId,
        name: `[工作流] ${step.name || step.id}`,
        workingDirectory: step.workspaceId || context.workDir || process.cwd(),
        providerId: step.providerId || context.providerId || 'claude-code',
        initialPrompt: prompt,
      })
    } catch (err) {
      this.sessionManagerV2?.removeListener('conversation-message', handler)
      throw err
    }

    // 等待 AI 完成回复（事件驱动 + 超时兜底）
    const timeoutMs = (step.timeoutSeconds || 120) * 1000
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (resolved) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 500)

      setTimeout(() => {
        clearInterval(checkInterval)
        this.sessionManagerV2?.removeListener('conversation-message', handler)
        resolve()
      }, timeoutMs)
    })

    return { sessionId, output: output || `Session completed: ${sessionId}` }
  }

  private resolveVariables(text: string, variables: Record<string, any>): string {
    return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path) => {
      const parts = path.split('.')
      let val: any = variables
      for (const p of parts) { val = val?.[p] }
      return val !== undefined ? String(val) : _match
    })
  }

  private resolveValue(value: any, variables: Record<string, any>): any {
    if (typeof value === 'string') return this.resolveVariables(value, variables)
    if (Array.isArray(value)) return value.map(v => this.resolveValue(v, variables))
    if (value && typeof value === 'object') {
      const result: Record<string, any> = {}
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.resolveValue(v, variables)
      }
      return result
    }
    return value
  }

  private evaluateCondition(expression: string, context: Record<string, any>): boolean {
    const ast = parseConditionExpression(expression)
    const variables = isPlainObject(context.variables) ? context.variables : {}
    const scope = { context, variables, ...context, ...variables }
    return Boolean(evaluateConditionNode(ast, scope))
  }

  private validateWorkflowSteps(steps: WorkflowStep[]): void {
    for (const step of steps) {
      if (step.type === 'condition') {
        try {
          parseConditionExpression(step.conditionExpression || 'false')
        } catch (error: any) {
          throw new SpectrAIError({
            code: ErrorCode.INVALID_INPUT,
            message: `Invalid condition expression for step ${step.id}: ${error?.message || error}`,
            userMessage: `条件步骤 "${step.name || step.id}" 的表达式无效`,
            context: { stepId: step.id, expression: step.conditionExpression },
          })
        }
      }
    }
  }

  // ── 执行编排 ────────────────────────────────────────────

  async executeWorkflow(workflowId: string, triggerBy: 'manual' | 'scheduled' | 'event' = 'manual', initialContext?: Record<string, any>): Promise<{ executionId: string }> {
    const workflow = this.db.getWorkflow(workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)

    const executionId = `wexe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const context = { ...(initialContext || {}), workflowId }

    // 创建执行记录
    this.db.createWorkflowExecution({
      id: executionId,
      workflowId,
      status: 'running',
      triggeredBy: triggerBy,
      context,
    })

    // 标记工作流状态
    this.db.updateWorkflow(workflowId, { status: 'running' })

    this.runningExecutions.set(executionId, {
      executionId,
      workflowId,
      startedAt: Date.now(),
      paused: false,
    })

    sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'workflow-started', executionId, workflowId })

    // 异步执行，不阻塞
    this.runExecution(executionId, workflow.steps, workflow.variables || {}, context).catch(err => {
      console.error(`[Workflow] Execution ${executionId} failed:`, err)
    })

    return { executionId }
  }

  private async runExecution(
    executionId: string,
    steps: WorkflowStep[],
    variables: Record<string, any>,
    context: Record<string, any>,
  ): Promise<void> {
    const exec = this.runningExecutions.get(executionId)
    if (!exec) return

    try {
      // ── DAG 波次并行执行 ──
      // 1. 计算执行波次（拓扑排序分层）
      const waves = this.computeExecutionWaves(steps)

      const executed = new Set<string>()
      let currentContext = { ...context }
      let currentVariables = { ...variables }
      const results: Record<string, string> = {}

      // 2. 逐波执行，同一波次内的步骤并行执行
      for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
        if (exec.paused) {
          this.db.updateWorkflowExecution(executionId, { status: 'paused' })
          return
        }

        const wave = waves[waveIdx]
        sendToRenderer(IPC.WORKFLOW_STATUS, {
          type: 'wave-started',
          executionId,
          waveIndex: waveIdx,
          stepIds: wave.map(s => s.id),
        })

        // 并行执行同一波次的所有步骤
        const stepPromises = wave.map(async (step) => {
          // 条件分支特殊处理
          if (step.type === 'condition') {
            const conditionResult = this.evaluateCondition(
              step.conditionExpression || 'false',
              { ...currentContext, ...currentVariables }
            )
            if (!conditionResult && step.falseSteps && step.falseSteps.length > 0) {
              const runId = `wrun-${Date.now()}-skip`
              this.db.createWorkflowRun({
                id: runId, executionId, stepId: step.id,
                stepOrder: waveIdx,
                status: 'skipped',
                input: { ...currentContext, ...currentVariables },
                retries: 0,
              })
              return { stepId: step.id, output: 'skipped', newContext: {}, newVariables: {} }
            }
            if (conditionResult && step.trueSteps && step.trueSteps.length > 0) {
              return { stepId: step.id, output: 'condition-true', newContext: {}, newVariables: {} }
            }
          }

          const result = await this.executeStep(
            step, waveIdx, executionId, currentContext, currentVariables
          )
          return { stepId: step.id, ...result }
        })

        // 等待本波次所有步骤完成
        const waveResults = await Promise.allSettled(stepPromises)

        // 收集结果
        for (const result of waveResults) {
          if (result.status === 'fulfilled') {
            const { stepId, output, newContext, newVariables } = result.value
            executed.add(stepId)
            results[stepId] = output
            if (newContext) currentContext = { ...currentContext, ...newContext }
            if (newVariables) currentVariables = { ...currentVariables, ...newVariables }
          } else {
            // 某步骤失败，整个执行标记为失败
            throw result.reason
          }
        }

        sendToRenderer(IPC.WORKFLOW_STATUS, {
          type: 'wave-completed',
          executionId,
          waveIndex: waveIdx,
        })
      }

      // 全部完成
      this.db.updateWorkflowExecution(executionId, {
        status: 'completed',
        completedAt: new Date(),
        result: JSON.stringify({ results, context: currentContext }),
      })
      this.db.updateWorkflow(exec.workflowId, { status: 'draft' })
      this.runningExecutions.delete(executionId)

      sendToRenderer(IPC.WORKFLOW_STATUS, {
        type: 'workflow-completed',
        executionId,
        workflowId: exec.workflowId,
        result: results,
      })
    } catch (err: any) {
      this.db.updateWorkflowExecution(executionId, {
        status: 'failed',
        completedAt: new Date(),
        error: String(err),
      })
      this.db.updateWorkflow(exec.workflowId, { status: 'draft' })
      this.runningExecutions.delete(executionId)

      sendToRenderer(IPC.WORKFLOW_STATUS, {
        type: 'workflow-failed',
        executionId,
        workflowId: exec.workflowId,
        error: String(err),
      })
    }
  }

  /** 计算执行波次（Kahn 拓扑排序分层，同一波次内的步骤无依赖可并行执行） */
  private computeExecutionWaves(steps: WorkflowStep[]): WorkflowStep[][] {
    const stepMap = new Map(steps.map(s => [s.id, s]))
    const inDegree = new Map<string, number>()
    const dependents = new Map<string, string[]>() // stepId → 被依赖的 stepIds

    // 初始化
    for (const step of steps) {
      inDegree.set(step.id, 0)
      dependents.set(step.id, [])
    }

    // 计算入度
    for (const step of steps) {
      for (const dep of (step.dependsOn || [])) {
        if (stepMap.has(dep)) {
          inDegree.set(step.id, (inDegree.get(step.id) || 0) + 1)
          dependents.get(dep)?.push(step.id)
        }
      }
    }

    // BFS 分层
    const waves: WorkflowStep[][] = []
    let queue = steps.filter(s => (inDegree.get(s.id) || 0) === 0)

    while (queue.length > 0) {
      waves.push(queue)
      const nextQueue: WorkflowStep[] = []
      for (const step of queue) {
        const deps = dependents.get(step.id) || []
        for (const depId of deps) {
          const newDeg = (inDegree.get(depId) || 1) - 1
          inDegree.set(depId, newDeg)
          if (newDeg === 0) {
            nextQueue.push(stepMap.get(depId)!)
          }
        }
      }
      queue = nextQueue
    }

    // 如果有节点未被处理（存在环），将剩余节点放入最后一波
    const processedIds = new Set(waves.flat().map(s => s.id))
    const remaining = steps.filter(s => !processedIds.has(s.id))
    if (remaining.length > 0) {
      waves.push(remaining)
    }

    return waves
  }

  // ── CRUD ────────────────────────────────────────────────

  createWorkflow(data: {
    name: string
    description?: string
    steps: WorkflowStep[]
    variables?: Record<string, any>
    createdBy?: string
  }): any {
    this.validateWorkflowSteps(data.steps || [])
    const id = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const workflow = this.db.createWorkflow({
      id,
      name: data.name,
      description: data.description,
      steps: data.steps || [],
      variables: data.variables || {},
      status: 'draft',
      createdBy: data.createdBy,
    })
    sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'workflow-created', workflowId: id })
    return workflow
  }

  updateWorkflow(workflowId: string, updates: {
    name?: string
    description?: string
    steps?: WorkflowStep[]
    variables?: Record<string, any>
    status?: WorkflowStatus
  }): void {
    if (updates.steps) {
      this.validateWorkflowSteps(updates.steps)
    }
    this.db.updateWorkflow(workflowId, updates)
    sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'workflow-updated', workflowId })
  }

  deleteWorkflow(workflowId: string): void {
    // 取消运行中的执行
    for (const [executionId, exec] of this.runningExecutions) {
      if (exec.workflowId === workflowId) {
        this.db.updateWorkflowExecution(executionId, { status: 'failed', completedAt: new Date(), error: 'Workflow deleted' })
        this.runningExecutions.delete(executionId)
      }
    }
    this.db.deleteWorkflow(workflowId)
    sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'workflow-deleted', workflowId })
  }

  pauseExecution(executionId: string): void {
    const exec = this.runningExecutions.get(executionId)
    if (exec) {
      exec.paused = true
      this.db.updateWorkflowExecution(executionId, { status: 'paused' })
      sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'workflow-paused', executionId })
    }
  }

  resumeExecution(executionId: string): void {
    const exec = this.runningExecutions.get(executionId)
    if (exec && exec.paused) {
      exec.paused = false
      this.db.updateWorkflowExecution(executionId, { status: 'running' })
      sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'workflow-resumed', executionId })
    }
  }
}
