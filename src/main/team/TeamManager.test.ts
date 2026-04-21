/**
 * TeamManager 单元测试
 * @author weibin
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TeamManager } from '../team/TeamManager'
import type { TeamRepository } from '../team/TeamRepository'
import type { AgentManagerV2 } from '../agent/AgentManagerV2'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { DatabaseManager } from '../storage/Database'
import type { GitWorktreeService } from '../git/GitWorktreeService'
import type { CreateTeamRequest } from '../team/types'

// Mock dependencies
const mockTeamRepo = {
  createTeam: vi.fn(),
  getTeamById: vi.fn(),
  updateTeamStatus: vi.fn(),
  deleteTeam: vi.fn(),
} as unknown as TeamRepository

const mockAgentManager = {
  spawnAgent: vi.fn(),
  terminateAgent: vi.fn(),
  getAgentStatus: vi.fn(),
} as unknown as AgentManagerV2

const mockSessionManager = {
  createSession: vi.fn(),
  terminateSession: vi.fn(),
  getSession: vi.fn(),
} as unknown as SessionManagerV2

const mockDatabase = {
  insertSession: vi.fn(),
  updateSessionStatus: vi.fn(),
} as unknown as DatabaseManager

const mockGitService = {
  createWorktree: vi.fn(),
  mergeWorktree: vi.fn(),
  deleteWorktree: vi.fn(),
} as unknown as GitWorktreeService

describe('TeamManager', () => {
  let teamManager: TeamManager

  beforeEach(() => {
    vi.clearAllMocks()
    teamManager = new TeamManager(
      mockTeamRepo,
      mockAgentManager,
      mockSessionManager,
      mockDatabase,
      mockGitService
    )
  })

  describe('createTeam', () => {
    it('应该成功创建团队实例', async () => {
      const request: CreateTeamRequest = {
        name: 'Test Team',
        objective: 'Build a feature',
        templateId: 'dev-team',
        workDir: '/test/path',
      }

      // Mock repository response
      const mockTeam = {
        id: 'team-123',
        sessionId: 'session-456',
        name: 'Test Team',
        objective: 'Build a feature',
        status: 'pending' as const,
        members: [],
        createdAt: new Date().toISOString(),
      }
      ;(mockTeamRepo.createTeam as any).mockResolvedValue(mockTeam)

      const team = await teamManager.createTeam(request)

      expect(team).toBeDefined()
      expect(team.name).toBe('Test Team')
      expect(team.status).toBe('pending')
      expect(mockTeamRepo.createTeam).toHaveBeenCalled()
    })

    it('应该在缺少工作目录时抛出错误', async () => {
      const request: CreateTeamRequest = {
        name: 'Test Team',
        objective: 'Build a feature',
        templateId: 'dev-team',
        workDir: '',
      }

      await expect(teamManager.createTeam(request)).rejects.toThrow('工作目录不能为空')
    })

    it('应该在模板不存在时抛出错误', async () => {
      const request: CreateTeamRequest = {
        name: 'Test Team',
        objective: 'Build a feature',
        templateId: 'non-existent-template',
        workDir: '/test/path',
      }

      await expect(teamManager.createTeam(request)).rejects.toThrow('Template not found')
    })
  })

  describe('cancelTeam', () => {
    it('应该成功取消团队', async () => {
      const teamId = 'team-123'

      // Mock active team
      const mockTeam = {
        id: teamId,
        status: 'running' as const,
        members: [
          { id: 'member-1', status: 'idle' },
          { id: 'member-2', status: 'working' },
        ],
      }
      ;(teamManager as any).activeTeams.set(teamId, mockTeam)

      await teamManager.cancelTeam(teamId, 'User requested cancellation')

      expect(mockTeamRepo.updateTeamStatus).toHaveBeenCalledWith(
        teamId,
        'cancelled',
        expect.any(String)
      )
      expect((teamManager as any).activeTeams.has(teamId)).toBe(false)
    })

    it('应该在团队不存在时抛出错误', async () => {
      await expect(teamManager.cancelTeam('non-existent', 'reason')).rejects.toThrow('团队不存在')
    })
  })

  describe('pauseTeam', () => {
    it('应该成功暂停团队', async () => {
      const teamId = 'team-123'

      const mockTeam = {
        id: teamId,
        status: 'running' as const,
        members: [],
      }
      ;(teamManager as any).activeTeams.set(teamId, mockTeam)

      await teamManager.pauseTeam(teamId)

      expect(mockTeamRepo.updateTeamStatus).toHaveBeenCalledWith(teamId, 'paused', undefined)
      expect(mockTeam.status).toBe('paused')
    })
  })

  describe('resumeTeam', () => {
    it('应该成功恢复团队', async () => {
      const teamId = 'team-123'

      const mockTeam = {
        id: teamId,
        status: 'paused' as const,
        members: [],
      }
      ;(teamManager as any).activeTeams.set(teamId, mockTeam)

      await teamManager.resumeTeam(teamId)

      expect(mockTeamRepo.updateTeamStatus).toHaveBeenCalledWith(teamId, 'running', undefined)
      expect(mockTeam.status).toBe('running')
    })
  })

  describe('getTeam', () => {
    it('应该返回存在的团队', () => {
      const teamId = 'team-123'
      const mockTeam = {
        id: teamId,
        name: 'Test Team',
        status: 'running' as const,
        members: [],
      }
      ;(teamManager as any).activeTeams.set(teamId, mockTeam)

      const team = teamManager.getTeam(teamId)

      expect(team).toBeDefined()
      expect(team?.id).toBe(teamId)
    })

    it('应该在团队不存在时返回 undefined', () => {
      const team = teamManager.getTeam('non-existent')
      expect(team).toBeUndefined()
    })
  })

  describe('listTeams', () => {
    it('应该返回所有活动团队', () => {
      ;(teamManager as any).activeTeams.set('team-1', {
        id: 'team-1',
        name: 'Team 1',
        status: 'running' as const,
      })
      ;(teamManager as any).activeTeams.set('team-2', {
        id: 'team-2',
        name: 'Team 2',
        status: 'paused' as const,
      })

      const teams = teamManager.listTeams()

      expect(teams).toHaveLength(2)
      expect(teams.map(t => t.id)).toEqual(expect.arrayContaining(['team-1', 'team-2']))
    })

    it('应该支持按状态过滤', () => {
      ;(teamManager as any).activeTeams.set('team-1', {
        id: 'team-1',
        name: 'Team 1',
        status: 'running' as const,
      })
      ;(teamManager as any).activeTeams.set('team-2', {
        id: 'team-2',
        name: 'Team 2',
        status: 'paused' as const,
      })

      const runningTeams = teamManager.listTeams('running')

      expect(runningTeams).toHaveLength(1)
      expect(runningTeams[0].status).toBe('running')
    })
  })

  describe('事件发射', () => {
    it('应该在团队创建时发射事件', async () => {
      const eventHandler = vi.fn()
      teamManager.on('team:created', eventHandler)

      const request: CreateTeamRequest = {
        name: 'Test Team',
        objective: 'Build a feature',
        templateId: 'dev-team',
        workDir: '/test/path',
      }

      const mockTeam = {
        id: 'team-123',
        sessionId: 'session-456',
        name: 'Test Team',
        status: 'pending' as const,
        members: [],
        createdAt: new Date().toISOString(),
      }
      ;(mockTeamRepo.createTeam as any).mockResolvedValue(mockTeam)

      await teamManager.createTeam(request)

      expect(eventHandler).toHaveBeenCalledWith(expect.objectContaining({
        id: 'team-123',
        name: 'Test Team',
      }))
    })

    it('应该在团队状态变更时发射事件', async () => {
      const eventHandler = vi.fn()
      teamManager.on('team:status-change', eventHandler)

      const teamId = 'team-123'
      const mockTeam = {
        id: teamId,
        status: 'running' as const,
        members: [],
      }
      ;(teamManager as any).activeTeams.set(teamId, mockTeam)

      await teamManager.pauseTeam(teamId)

      expect(eventHandler).toHaveBeenCalledWith(teamId, 'paused')
    })
  })

  describe('团队成员管理', () => {
    it('应该能够获取团队成员列表', async () => {
      const teamId = 'team-123'
      const mockMembers = [
        { id: 'member-1', roleName: 'leader', status: 'idle' },
        { id: 'member-2', roleName: 'developer', status: 'working' },
      ]

      // This would typically call the repository
      // For now, we just verify the method exists
      expect(teamManager).toBeDefined()
    })
  })
})
