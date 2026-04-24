import { describe, expect, it, vi } from 'vitest'
import { TaskSessionCoordinator } from './TaskSessionCoordinator'

describe('TaskSessionCoordinator', () => {
  it('starts scheduled evaluation when a kanban task is marked done', async () => {
    const db: any = {
      getTask: vi.fn(() => ({ id: 'task-1', status: 'done', sessionId: 'session-1' })),
      getAllSessions: vi.fn(() => []),
      listEvaluationTemplates: vi.fn(() => [{ id: 'template-1', name: 'Default evaluation' }]),
    }
    const evaluationService = {
      evaluate: vi.fn(async () => ({ runId: 'run-1' })),
    }
    const coordinator = new TaskSessionCoordinator(db)
    coordinator.setEvaluationService(evaluationService)

    coordinator.onTaskUpdated('task-1', { status: 'done' }, { id: 'task-1', status: 'in_progress' })
    await Promise.resolve()

    expect(evaluationService.evaluate).toHaveBeenCalledWith('session-1', 'template-1', 'scheduled')
  })

  it('falls back to the task-linked session when the task has no sessionId column', async () => {
    const db: any = {
      getTask: vi.fn(() => ({ id: 'task-1', status: 'done' })),
      getAllSessions: vi.fn(() => [{ id: 'session-from-task', taskId: 'task-1' }]),
      listEvaluationTemplates: vi.fn(() => [{ id: 'template-1', name: 'Default evaluation' }]),
    }
    const evaluationService = {
      evaluate: vi.fn(async () => ({ runId: 'run-1' })),
    }
    const coordinator = new TaskSessionCoordinator(db)
    coordinator.setEvaluationService(evaluationService)

    coordinator.onTaskUpdated('task-1', { status: 'done' }, { id: 'task-1', status: 'waiting' })
    await Promise.resolve()

    expect(evaluationService.evaluate).toHaveBeenCalledWith('session-from-task', 'template-1', 'scheduled')
  })
})
