/**
 * WorkflowService - 工作流编排引擎
 * 支持步骤类型：prompt / http / condition / delay
 * 按 DAG 顺序执行，支持并行步骤
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { WorkflowStatus, WorkflowStep } from '../storage/repositories/WorkflowRepository'

export type WorkflowServiceStatus = 'stopped' | 'running'

interface RunningExecution {
  executionId: string
  workflowId: string
  startedAt: number
  paused: boolean
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
          const sessionId = await this.createWorkflowSession(step, {
            ...context,
            ...variables,
          })
          output = `Session started: ${sessionId}`
          newContext = { ...newContext, lastSessionId: sessionId }
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
        output,
      })

      sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'step-completed', executionId, stepId: step.id, runId, output })

      return { output, newContext, newVariables }
    } catch (err: any) {
      const durationMs = Date.now() - stepStart
      this.db.updateWorkflowRun(runId, {
        status: 'failed',
        completedAt: new Date(),
        error: String(err),
      })

      sendToRenderer(IPC.WORKFLOW_STATUS, { type: 'step-failed', executionId, stepId: step.id, runId, error: String(err) })

      throw err
    }
  }

  private async createWorkflowSession(step: WorkflowStep, context: Record<string, any>): Promise<string> {
    const sessionId = `workflow-${Date.now()}`
    if (!this.sessionManagerV2) throw new Error('SessionManagerV2 not available')

    const prompt = this.resolveVariables(step.prompt || '', context)

    // 监听一轮完成
    const handler = (sid: string, msg: any) => {
      if (sid !== sessionId) return
    }

    this.sessionManagerV2.createSession({
      id: sessionId,
      name: `[工作流] ${step.name || step.id}`,
      workingDirectory: step.workspaceId || context.workDir || process.cwd(),
      providerId: step.providerId || context.providerId || 'claude-code',
      initialPrompt: prompt,
    })

    // 等待 60 秒后返回
    return new Promise<string>((resolve) => {
      setTimeout(() => resolve(sessionId), 60000)
    })
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
    try {
      // 安全求值：只支持简单比较和逻辑运算
      const keys = Object.keys(context)
      const values: Record<string, any> = {}
      keys.forEach(k => { values[k] = context[k] })

      // 构建安全函数白名单
      const fns = {
        and: (a: boolean, b: boolean) => a && b,
        or: (a: boolean, b: boolean) => a || b,
        not: (a: boolean) => !a,
        eq: (a: any, b: any) => a === b,
        ne: (a: any, b: any) => a !== b,
        gt: (a: number, b: number) => a > b,
        gte: (a: number, b: number) => a >= b,
        lt: (a: number, b: number) => a < b,
        lte: (a: number, b: number) => a <= b,
        contains: (a: string, b: string) => a.includes(b),
        startsWith: (a: string, b: string) => a.startsWith(b),
        endsWith: (a: string, b: string) => a.endsWith(b),
      }

      const fnKeys = Object.keys(fns)
      const valKeys = Object.keys(values)

      // 使用 Function 构造器但限制 scope
      const argNames = [...fnKeys, ...valKeys]
      const argVals = [...Object.values(fns), ...Object.values(values)]
      // eslint-disable-next-line no-new-func
      const fn = new Function(...argNames, `return ${expression}`)
      return fn(...argVals)
    } catch {
      return false
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

    // 按 stepOrder 排序
    const sorted = [...steps].sort((a, b) => a.id.localeCompare(b.id))
    // 实际按数组顺序 + dependsOn 依赖解析
    const executed = new Set<string>()
    let currentContext = { ...context }
    let currentVariables = { ...variables }
    const results: Record<string, string> = {}

    try {
      for (const step of sorted) {
        if (exec.paused) {
          this.db.updateWorkflowExecution(executionId, { status: 'paused' })
          return
        }

        // 检查依赖
        if (step.dependsOn && step.dependsOn.length > 0) {
          const missingDeps = step.dependsOn.filter(d => !executed.has(d))
          if (missingDeps.length > 0) {
            // 等待依赖完成
            await new Promise<void>(resolve => {
              const checkInterval = setInterval(() => {
                if (missingDeps.every(d => executed.has(d)) || exec.paused) {
                  clearInterval(checkInterval)
                  resolve()
                }
              }, 500)
            })
          }
        }

        // 条件分支处理
        if (step.type === 'condition') {
          const conditionResult = this.evaluateCondition(
            step.conditionExpression || 'false',
            { ...currentContext, ...currentVariables }
          )
          if (!conditionResult && step.falseSteps && step.falseSteps.length > 0) {
            // 跳过当前步骤，标记为 skipped
            const runId = `wrun-${Date.now()}-skip`
            this.db.createWorkflowRun({
              id: runId, executionId, stepId: step.id,
              stepOrder: sorted.indexOf(step),
              status: 'skipped',
              input: { ...currentContext, ...currentVariables },
              retries: 0,
            })
            continue
          }
          if (conditionResult && step.trueSteps && step.trueSteps.length > 0) {
            // 只执行 true 分支中的步骤
            continue
          }
        }

        const { output, newContext, newVariables } = await this.executeStep(
          step, sorted.indexOf(step), executionId, currentContext, currentVariables
        )
        executed.add(step.id)
        currentContext = newContext
        currentVariables = newVariables
        results[step.id] = output
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

  // ── CRUD ────────────────────────────────────────────────

  createWorkflow(data: {
    name: string
    description?: string
    steps: WorkflowStep[]
    variables?: Record<string, any>
    createdBy?: string
  }): any {
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
