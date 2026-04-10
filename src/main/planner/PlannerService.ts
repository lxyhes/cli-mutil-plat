/**
 * PlannerService - 自主规划引擎
 * 使用 AI 自动分解目标为任务列表，支持逐步执行
 */
import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'

export type PlannerStatus = 'idle' | 'planning' | 'running' | 'completed' | 'failed'

const DECOMPOSITION_PROMPT_TEMPLATE = `你是一个任务规划助手。请将以下目标分解为具体的任务列表。

目标：{goal}

请按以下 JSON 格式输出任务列表（每个任务包含 title, description, priority, dependencies）：
- priority: low | medium | high | critical
- dependencies: 依赖的任务标题数组（无依赖则为空数组）
- 请将大任务进一步拆分为步骤（每个步骤 1-3 行描述）

输出格式（纯 JSON，不要有其他内容）：
{
  "tasks": [
    {
      "title": "任务标题",
      "description": "任务详细描述",
      "priority": "medium",
      "dependencies": [],
      "steps": [
        "步骤1描述",
        "步骤2描述"
      ]
    }
  ]
}

请确保：
1. 任务总数控制在 3-10 个之间
2. 每个任务可独立执行
3. 优先级合理分配
4. 步骤简洁明了`

export class PlannerService extends EventEmitter {
  private status: PlannerStatus = 'idle'
  private activePlanId: string | null = null

  constructor(
    private db: DatabaseManager,
    private sessionManagerV2: SessionManagerV2,
  ) {
    super()
  }

  // ── 生命周期 ────────────────────────────────────────────

  start(): void {
    this.status = 'idle'
    console.log('[Planner] Started')
  }

  stop(): void {
    this.status = 'idle'
    this.activePlanId = null
    console.log('[Planner] Stopped')
  }

  getStatus(): PlannerStatus {
    return this.status
  }

  // ── 规划创建 ────────────────────────────────────────────

  /**
   * 创建新规划：调用 AI 分解目标，生成任务和步骤
   */
  async createPlan(data: {
    sessionId: string
    goal: string
    workingDirectory?: string
    providerId?: string
  }): Promise<{
    planSession: any
    tasks: any[]
  }> {
    const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date()

    // 1. 创建规划会话
    const planSession = this.db.createPlanSession({
      id: planId,
      sessionId: data.sessionId,
      goal: data.goal,
      status: 'pending',
    })

    // 2. 调用 AI 分解目标
    let tasks: any[] = []
    try {
      tasks = await this.decomposeGoal(planId, data.goal, data.sessionId)
    } catch (err) {
      console.error('[Planner] AI decomposition failed:', err)
      this.db.updatePlanSession(planId, { status: 'failed' })
      throw err
    }

    this.emit('plan-created', { planId, tasks })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'plan-created', planId, taskCount: tasks.length })

    return { planSession, tasks }
  }

  /**
   * 调用 AI 将目标分解为任务列表
   */
  private async decomposeGoal(planId: string, goal: string, sessionId: string): Promise<any[]> {
    const prompt = DECOMPOSITION_PROMPT_TEMPLATE.replace('{goal}', goal)

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.sessionManagerV2.removeListener('conversation-message', handler)
        reject(new Error('AI decomposition timed out after 120s'))
      }, 120000)

      const handler = (sid: string, msg: any) => {
        if (sid !== sessionId) return
        if (!msg.isDelta && msg.role === 'assistant' && msg.content) {
          clearTimeout(timeoutHandle)
          this.sessionManagerV2.removeListener('conversation-message', handler)

          try {
            const tasks = this.parseDecompositionResponse(msg.content, planId)
            resolve(tasks)
          } catch (err) {
            reject(err)
          }
        }
      }

      this.sessionManagerV2.on('conversation-message', handler)

      try {
        this.sessionManagerV2.sendMessage(sessionId, prompt)
      } catch (err) {
        clearTimeout(timeoutHandle)
        this.sessionManagerV2.removeListener('conversation-message', handler)
        reject(err)
      }
    })
  }

  /**
   * 解析 AI 响应，提取 JSON 任务列表
   */
  private parseDecompositionResponse(content: string, planId: string): any[] {
    // 尝试从响应中提取 JSON
    let jsonStr = content.trim()

    // 尝试找到 JSON 代码块
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1]
    }

    // 去除 markdown 中的反引号
    jsonStr = jsonStr.replace(/^```|```$/g, '').trim()

    // 尝试提取 JSON 对象
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response: no JSON found')
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      throw new Error('Invalid AI response: missing tasks array')
    }

    // 存储任务和步骤到数据库
    const createdTasks: any[] = []
    for (const taskData of parsed.tasks) {
      const taskId = `ptask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const task = this.db.createPlanTask({
        id: taskId,
        planSessionId: planId,
        title: taskData.title || taskData.name || 'Untitled Task',
        description: taskData.description || '',
        priority: this.normalizePriority(taskData.priority),
        status: 'pending',
        dependencies: Array.isArray(taskData.dependencies) ? taskData.dependencies : [],
      })

      // 创建步骤
      if (Array.isArray(taskData.steps)) {
        taskData.steps.forEach((stepDesc: string, index: number) => {
          this.db.createPlanStep({
            id: `pstep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            planTaskId: taskId,
            description: stepDesc,
            status: 'pending',
            orderIndex: index,
          })
        })
      }

      createdTasks.push(task)
    }

    return createdTasks
  }

  private normalizePriority(p: string): 'low' | 'medium' | 'high' | 'critical' {
    const pLower = String(p || '').toLowerCase()
    if (pLower === 'low') return 'low'
    if (pLower === 'high' || pLower === 'critical') return 'high'
    if (pLower === 'critical') return 'critical'
    return 'medium'
  }

  // ── 规划 CRUD ───────────────────────────────────────────

  getAllPlans(): any[] {
    return this.db.getAllPlanSessions()
  }

  getPlan(planId: string): any {
    return this.db.getPlanSession(planId)
  }

  getPlanTasks(planId: string): any[] {
    return this.db.getPlanTasks(planId)
  }

  updatePlan(planId: string, updates: {
    goal?: string
    status?: string
  }): void {
    this.db.updatePlanSession(planId, updates)
    this.emit('plan-updated', { planId, updates })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'plan-updated', planId })
  }

  deletePlan(planId: string): void {
    this.db.deletePlanSession(planId)
    this.emit('plan-deleted', { planId })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'plan-deleted', planId })
  }

  // ── 规划执行 ────────────────────────────────────────────

  /**
   * 开始执行规划
   */
  async startPlan(planId: string, sessionId: string): Promise<void> {
    const plan = this.db.getPlanSession(planId)
    if (!plan) throw new Error(`Plan not found: ${planId}`)

    this.db.updatePlanSession(planId, { status: 'running', startedAt: new Date() })
    this.activePlanId = planId
    this.status = 'running'

    this.emit('plan-started', { planId })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'plan-started', planId })

    // 检查所有任务是否完成
    const tasks = this.db.getPlanTasks(planId)
    const allCompleted = tasks.every(t => t.status === 'completed' || t.status === 'skipped')

    if (allCompleted) {
      this.completePlan(planId)
    }
  }

  /**
   * 执行单个步骤：创建会话运行步骤
   */
  async executeStep(stepId: string, sessionId: string, providerId?: string): Promise<{ result: string }> {
    const step = this.db.getPlanStep(stepId)
    if (!step) throw new Error(`Step not found: ${stepId}`)

    const task = this.db.getPlanTask(step.planTaskId)
    if (!task) throw new Error(`Task not found: ${step.planTaskId}`)

    this.db.updateStep(stepId, { status: 'running' })
    this.emit('step-started', { stepId, planTaskId: step.planTaskId })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'step-started', stepId, planTaskId: step.planTaskId })

    const stepSessionId = `planner-step-${Date.now()}`

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.sessionManagerV2.removeListener('conversation-message', handler)
        this.db.updateStep(stepId, { status: 'failed', completedAt: new Date() })
        reject(new Error(`Step timed out after 300s`))
      }, 300000)

      const handler = (sid: string, msg: any) => {
        if (sid !== stepSessionId) return
        if (!msg.isDelta && msg.role === 'assistant' && msg.content) {
          clearTimeout(timeoutHandle)
          this.sessionManagerV2.removeListener('conversation-message', handler)

          const result = msg.content
          this.db.updateStep(stepId, { status: 'completed', result, completedAt: new Date() })
          this.emit('step-completed', { stepId, planTaskId: step.planTaskId, result })
          sendToRenderer(IPC.PLAN_STATUS, { type: 'step-completed', stepId, planTaskId: step.planTaskId })

          // 检查任务是否所有步骤都完成
          this.checkTaskCompletion(step.planTaskId)
          resolve({ result })
        }
      }

      this.sessionManagerV2.on('conversation-message', handler)

      try {
        this.sessionManagerV2.createSession({
          id: stepSessionId,
          name: `[规划] ${task.title}`,
          workingDirectory: process.cwd(),
          providerId: providerId || 'claude-code',
          initialPrompt: step.description,
        })
      } catch (err) {
        clearTimeout(timeoutHandle)
        this.sessionManagerV2.removeListener('conversation-message', handler)
        this.db.updateStep(stepId, { status: 'failed', completedAt: new Date() })
        reject(err)
      }
    })
  }

  /**
   * 获取步骤列表
   */
  getSteps(taskId: string): any[] {
    return this.db.getPlanSteps(taskId)
  }

  /**
   * 更新步骤
   */
  updateStep(stepId: string, updates: {
    status?: string
    result?: string
  }): void {
    this.db.updateStep(stepId, updates)
    const step = this.db.getPlanStep(stepId)
    if (step) {
      this.checkTaskCompletion(step.planTaskId)
    }
    this.emit('step-updated', { stepId, updates })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'step-updated', stepId })
  }

  /**
   * 检查任务是否所有步骤都完成
   */
  private checkTaskCompletion(taskId: string): void {
    const steps = this.db.getPlanSteps(taskId)
    const allDone = steps.every(s => s.status === 'completed' || s.status === 'skipped' || s.status === 'failed')

    if (allDone && steps.length > 0) {
      const task = this.db.getPlanTask(taskId)
      if (task && task.status !== 'completed' && task.status !== 'skipped') {
        const hasFailed = steps.some(s => s.status === 'failed')
        this.db.updateTask(taskId, {
          status: hasFailed ? 'pending' : 'completed',
          completedAt: hasFailed ? undefined : new Date(),
        })
        this.emit('task-completed', { taskId })
        sendToRenderer(IPC.PLAN_STATUS, { type: 'task-completed', taskId })

        // 检查整个规划是否完成
        const planId = task.planSessionId
        const tasks = this.db.getPlanTasks(planId)
        const allTasksDone = tasks.every(t => t.status === 'completed' || t.status === 'skipped')
        if (allTasksDone && this.activePlanId === planId) {
          this.completePlan(planId)
        }
      }
    }
  }

  /**
   * 完成任务规划
   */
  private completePlan(planId: string): void {
    this.db.updatePlanSession(planId, { status: 'completed', completedAt: new Date() })
    this.activePlanId = null
    this.status = 'completed'
    this.emit('plan-completed', { planId })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'plan-completed', planId })
    console.log(`[Planner] Plan ${planId} completed`)
  }

  /**
   * 跳过任务
   */
  skipTask(taskId: string): void {
    const task = this.db.getPlanTask(taskId)
    if (!task) return

    this.db.updateTask(taskId, { status: 'skipped', completedAt: new Date() })
    this.emit('task-skipped', { taskId })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'task-skipped', taskId })

    // 检查整个规划是否完成
    const planId = task.planSessionId
    const tasks = this.db.getPlanTasks(planId)
    const allDone = tasks.every(t => t.status === 'completed' || t.status === 'skipped')
    if (allDone && this.activePlanId === planId) {
      this.completePlan(planId)
    }
  }

  /**
   * 跳过步骤
   */
  skipStep(stepId: string): void {
    const step = this.db.getPlanStep(stepId)
    if (!step) return

    this.db.updateStep(stepId, { status: 'skipped', completedAt: new Date() })
    this.emit('step-skipped', { stepId })
    sendToRenderer(IPC.PLAN_STATUS, { type: 'step-skipped', stepId })

    // 检查任务完成状态
    if (step.planTaskId) {
      this.checkTaskCompletion(step.planTaskId)
    }
  }
}
