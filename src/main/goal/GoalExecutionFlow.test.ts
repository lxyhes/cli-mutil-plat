import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { EvaluationService } from '../evaluation/EvaluationService'
import { PlannerService } from '../planner/PlannerService'
import { TaskSessionCoordinator } from '../task/TaskSessionCoordinator'
import { GoalService } from './GoalService'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class FakeSessionManager extends EventEmitter {
  sendMessage(sessionId: string): void {
    queueMicrotask(() => {
      this.emit('conversation-message', sessionId, {
        role: 'assistant',
        isDelta: false,
        content: JSON.stringify({
          tasks: [
            {
              title: 'Implement goal flow',
              description: 'Wire goal to planner, kanban and evaluation',
              priority: 'high',
              dependencies: [],
              steps: ['Build the flow', 'Verify progress update'],
            },
          ],
        }),
      })
    })
  }

  createSession(config: { id: string }): any {
    if (config.id.startsWith('eval-ai-')) {
      queueMicrotask(() => {
        this.emit('conversation-message', config.id, {
          role: 'assistant',
          isDelta: false,
          content: JSON.stringify({
            scores: [
              {
                name: 'quality',
                score: 0.9,
                reasoning: 'The task reached the requested outcome.',
                suggestions: '',
              },
            ],
          }),
        })
      })
    }
    return { id: config.id }
  }

  getConversation(): any[] {
    return [
      { role: 'user', content: 'Please complete the implementation.' },
      { role: 'assistant', content: 'Implementation completed and verified.' },
    ]
  }
}

class FakeDb {
  goals: any[] = []
  goalActivities: any[] = []
  goalSessions: any[] = []
  planSessions: any[] = []
  planTasks: any[] = []
  planSteps: any[] = []
  tasks: any[] = []
  sessions: any[] = []
  evaluationTemplates: any[] = [
    {
      id: 'template-1',
      name: 'Default evaluation',
      criteria: [{ name: 'quality', description: 'Outcome quality', max_score: 100, weight: 1 }],
      promptTemplate: 'Evaluate the work.',
    },
  ]
  evaluationRuns: any[] = []
  evaluationResults: any[] = []

  createGoal(goal: any): any {
    const created = {
      status: 'active',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...goal,
    }
    this.goals.push(created)
    return created
  }

  getGoal(id: string): any {
    return this.goals.find(goal => goal.id === id) || null
  }

  updateGoal(id: string, updates: any): boolean {
    const goal = this.getGoal(id)
    if (!goal) return false
    Object.assign(goal, updates, { updatedAt: new Date() })
    return true
  }

  listGoals(): any[] {
    return this.goals
  }

  addGoalActivity(activity: any): any {
    const created = { ...activity, createdAt: new Date() }
    this.goalActivities.push(created)
    if (activity.progressAfter !== undefined) {
      this.updateGoal(activity.goalId, { progress: activity.progressAfter })
    }
    return created
  }

  listGoalActivities(goalId: string): any[] {
    return this.goalActivities.filter(activity => activity.goalId === goalId)
  }

  linkGoalSession(link: any): any {
    const existing = this.goalSessions.find(item => item.goalId === link.goalId && item.sessionId === link.sessionId)
    if (existing) return existing
    const created = { ...link, createdAt: new Date() }
    this.goalSessions.push(created)
    return created
  }

  getGoalSessions(goalId: string): any[] {
    return this.goalSessions.filter(link => link.goalId === goalId)
  }

  getGoalsBySession(sessionId: string): any[] {
    return this.goalSessions.filter(link => link.sessionId === sessionId)
  }

  createPlanSession(session: any): any {
    const created = { ...session, createdAt: new Date(), updatedAt: new Date() }
    this.planSessions.push(created)
    return created
  }

  getPlanSession(planId: string): any {
    return this.planSessions.find(plan => plan.id === planId) || null
  }

  updatePlanSession(planId: string, updates: any): void {
    Object.assign(this.getPlanSession(planId), updates, { updatedAt: new Date() })
  }

  getAllPlanSessions(): any[] {
    return this.planSessions
  }

  deletePlanSession(planId: string): void {
    this.planSessions = this.planSessions.filter(plan => plan.id !== planId)
  }

  createPlanTask(task: any): any {
    const created = { ...task, createdAt: new Date(), updatedAt: new Date() }
    this.planTasks.push(created)
    return created
  }

  getPlanTask(taskId: string): any {
    return this.planTasks.find(task => task.id === taskId) || null
  }

  getPlanTasks(planId: string): any[] {
    return this.planTasks.filter(task => task.planSessionId === planId)
  }

  updatePlanTask(taskId: string, updates: any): void {
    Object.assign(this.getPlanTask(taskId), updates, { updatedAt: new Date() })
  }

  createPlanStep(step: any): any {
    const created = { ...step, createdAt: new Date() }
    this.planSteps.push(created)
    return created
  }

  getPlanStep(stepId: string): any {
    return this.planSteps.find(step => step.id === stepId) || null
  }

  getPlanSteps(taskId: string): any[] {
    return this.planSteps.filter(step => step.planTaskId === taskId)
  }

  updateStep(stepId: string, updates: any): void {
    Object.assign(this.getPlanStep(stepId), updates)
  }

  createTask(task: any): any {
    const created = {
      status: 'todo',
      priority: 'medium',
      tags: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...task,
    }
    this.tasks.push(created)
    if (created.sessionId) {
      this.sessions.push({ id: created.sessionId, taskId: created.id, status: 'idle' })
    }
    return created
  }

  getTask(taskId: string): any {
    return this.tasks.find(task => task.id === taskId) || null
  }

  updateTask(taskId: string, updates: any): boolean {
    Object.assign(this.getTask(taskId), updates, { updatedAt: new Date() })
    return true
  }

  getAllTasks(): any[] {
    return this.tasks
  }

  getAllSessions(): any[] {
    return this.sessions
  }

  listEvaluationTemplates(): any[] {
    return this.evaluationTemplates
  }

  getEvaluationTemplate(templateId: string): any {
    return this.evaluationTemplates.find(template => template.id === templateId) || null
  }

  createEvaluationRun(run: any): any {
    const created = { ...run, createdAt: new Date() }
    this.evaluationRuns.push(created)
    return created
  }

  updateEvaluationRun(runId: string, updates: any): void {
    Object.assign(this.evaluationRuns.find(run => run.id === runId), updates)
  }

  createEvaluationResult(result: any): any {
    this.evaluationResults.push(result)
    return result
  }
}

describe('Goal execution flow', () => {
  it('links goal, planner, kanban completion, evaluation, and goal progress', async () => {
    const db = new FakeDb()
    const sessionManager = new FakeSessionManager()

    const goalService = new GoalService(db as any)
    const plannerService = new PlannerService(db as any, sessionManager as any)
    const taskCoordinator = new TaskSessionCoordinator(db as any)
    const evaluationService = new EvaluationService(db as any, sessionManager as any)

    goalService.setPlannerService(plannerService)
    plannerService.setTaskCoordinator(taskCoordinator)
    evaluationService.setGoalService(goalService)
    taskCoordinator.setEvaluationService(evaluationService)

    const goal = goalService.createGoal({
      title: 'Ship a verified goal loop',
      description: 'The goal should become a plan, kanban task, evaluation and progress update.',
    })
    expect(goal).toBeTruthy()

    const planResult = await goalService.generatePlanFromGoal(goal.id, 'goal-session-1')
    expect(planResult.planSession.goalId).toBe(goal.id)
    expect(db.getGoalSessions(goal.id)).toHaveLength(1)

    const kanbanTasks = await plannerService.syncPlanToKanban(planResult.planSession.id, 'goal-session-1')
    expect(kanbanTasks).toHaveLength(1)
    expect(kanbanTasks[0].tags).toEqual(expect.arrayContaining([
      'from-planner',
      `plan:${planResult.planSession.id}`,
      `goal:${goal.id}`,
    ]))
    expect(kanbanTasks[0].metadata).toMatchObject({
      source: 'planner',
      planId: planResult.planSession.id,
      goalId: goal.id,
    })

    db.updateTask(kanbanTasks[0].id, { status: 'done' })
    taskCoordinator.onTaskUpdated(
      kanbanTasks[0].id,
      { status: 'done' },
      { ...kanbanTasks[0], status: 'in_progress' },
    )

    await wait(700)

    const updatedGoal = db.getGoal(goal.id)
    expect(db.evaluationRuns[0]).toMatchObject({
      sessionId: 'goal-session-1',
      templateId: 'template-1',
      status: 'completed',
      triggerType: 'scheduled',
    })
    expect(updatedGoal.progress).toBeGreaterThan(0)
    expect(db.listGoalActivities(goal.id).some(activity => activity.type === 'review')).toBe(true)
  })
})
