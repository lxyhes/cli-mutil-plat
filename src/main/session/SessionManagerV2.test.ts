/**
 * SessionManagerV2 单元测试
 * @author weibin
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionManagerV2 } from '../session/SessionManagerV2'
import { AdapterRegistry } from '../adapter/AdapterRegistry'
import type { DatabaseManager } from '../storage/Database'

// Mock DatabaseManager
const mockDatabase = {
  insertSession: vi.fn(),
  updateSessionStatus: vi.fn(),
  getSessionById: vi.fn(),
  cleanupOrphanedSessions: vi.fn(),
} as unknown as DatabaseManager

// Mock AdapterRegistry
const mockAdapterRegistry = {
  getAdapter: vi.fn(),
  register: vi.fn(),
} as unknown as AdapterRegistry

describe('SessionManagerV2', () => {
  let sessionManager: SessionManagerV2

  beforeEach(() => {
    vi.clearAllMocks()
    sessionManager = new SessionManagerV2(mockAdapterRegistry)
    sessionManager.setDatabase(mockDatabase)
  })

  describe('createSession', () => {
    it('应该成功创建新会话', async () => {
      const config = {
        name: 'Test Session',
        workingDirectory: '/test/path',
        providerType: 'claude-code' as const,
        autoAccept: true,
      }

      // Mock adapter
      const mockAdapter = {
        providerId: 'claude-code',
        displayName: 'Claude Code',
        startSession: vi.fn().mockResolvedValue(undefined),
        hasSession: vi.fn().mockReturnValue(true),
      }
      ;(mockAdapterRegistry.getAdapter as any).mockReturnValue(mockAdapter)

      const session = await sessionManager.createSession(config)

      expect(session).toBeDefined()
      expect(session.name).toBe('Test Session')
      expect(session.status).toBe('starting')
      expect(mockAdapter.startSession).toHaveBeenCalled()
      expect(mockDatabase.insertSession).toHaveBeenCalled()
    })

    it('应该在缺少工作目录时抛出错误', async () => {
      const config = {
        name: 'Test Session',
        workingDirectory: '',
        providerType: 'claude-code' as const,
        autoAccept: true,
      }

      await expect(sessionManager.createSession(config)).rejects.toThrow('工作目录不能为空')
    })

    it('应该在 Provider 不存在时抛出错误', async () => {
      const config = {
        name: 'Test Session',
        workingDirectory: '/test/path',
        providerType: 'invalid-provider' as const,
        autoAccept: true,
      }

      ;(mockAdapterRegistry.getAdapter as any).mockReturnValue(null)

      await expect(sessionManager.createSession(config)).rejects.toThrow('Provider 未找到')
    })
  })

  describe('terminateSession', () => {
    it('应该成功终止会话', async () => {
      const sessionId = 'test-session-id'
      
      // Mock existing session
      const mockSession = {
        id: sessionId,
        status: 'running',
      }
      sessionManager['sessions'].set(sessionId, mockSession as any)

      // Mock adapter
      const mockAdapter = {
        terminateSession: vi.fn().mockResolvedValue(undefined),
      }
      ;(mockAdapterRegistry.getAdapter as any).mockReturnValue(mockAdapter)

      await sessionManager.terminateSession(sessionId)

      expect(mockAdapter.terminateSession).toHaveBeenCalledWith(sessionId)
      expect(mockDatabase.updateSessionStatus).toHaveBeenCalledWith(
        sessionId,
        'completed',
        expect.any(String)
      )
    })

    it('应该在会话不存在时抛出错误', async () => {
      await expect(sessionManager.terminateSession('non-existent')).rejects.toThrow('会话不存在')
    })
  })

  describe('sendMessage', () => {
    it('应该成功发送消息到会话', async () => {
      const sessionId = 'test-session-id'
      const message = 'Hello, AI!'

      // Mock existing session
      const mockSession = {
        id: sessionId,
        status: 'idle',
      }
      sessionManager['sessions'].set(sessionId, mockSession as any)

      // Mock adapter
      const mockAdapter = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        hasSession: vi.fn().mockReturnValue(true),
      }
      ;(mockAdapterRegistry.getAdapter as any).mockReturnValue(mockAdapter)

      await sessionManager.sendMessage(sessionId, message)

      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(sessionId, message)
    })

    it('应该在会话不处于空闲状态时拒绝发送消息', async () => {
      const sessionId = 'test-session-id'
      const message = 'Hello, AI!'

      // Mock running session
      const mockSession = {
        id: sessionId,
        status: 'running',
      }
      sessionManager['sessions'].set(sessionId, mockSession as any)

      await expect(sessionManager.sendMessage(sessionId, message)).rejects.toThrow('会话正在运行中')
    })
  })

  describe('getSession', () => {
    it('应该返回存在的会话', () => {
      const sessionId = 'test-session-id'
      const mockSession = {
        id: sessionId,
        name: 'Test Session',
        status: 'idle',
      }
      sessionManager['sessions'].set(sessionId, mockSession as any)

      const session = sessionManager.getSession(sessionId)

      expect(session).toBeDefined()
      expect(session?.id).toBe(sessionId)
    })

    it('应该在会话不存在时返回 undefined', () => {
      const session = sessionManager.getSession('non-existent')
      expect(session).toBeUndefined()
    })
  })

  describe('listSessions', () => {
    it('应该返回所有会话列表', () => {
      // Add mock sessions
      sessionManager['sessions'].set('session-1', {
        id: 'session-1',
        name: 'Session 1',
        status: 'running',
      } as any)
      sessionManager['sessions'].set('session-2', {
        id: 'session-2',
        name: 'Session 2',
        status: 'idle',
      } as any)

      const sessions = sessionManager.listSessions()

      expect(sessions).toHaveLength(2)
      expect(sessions.map(s => s.id)).toEqual(expect.arrayContaining(['session-1', 'session-2']))
    })

    it('应该支持按状态过滤', () => {
      sessionManager['sessions'].set('session-1', {
        id: 'session-1',
        name: 'Session 1',
        status: 'running',
      } as any)
      sessionManager['sessions'].set('session-2', {
        id: 'session-2',
        name: 'Session 2',
        status: 'idle',
      } as any)

      const runningSessions = sessionManager.listSessions('running')

      expect(runningSessions).toHaveLength(1)
      expect(runningSessions[0].status).toBe('running')
    })
  })

  describe('事件发射', () => {
    it('应该在会话状态变更时发射事件', async () => {
      const sessionId = 'test-session-id'
      const eventHandler = vi.fn()

      sessionManager.on('session:status-change', eventHandler)

      // Mock existing session
      const mockSession = {
        id: sessionId,
        status: 'starting',
      }
      sessionManager['sessions'].set(sessionId, mockSession as any)

      // Trigger status change
      sessionManager['updateSessionStatus'](sessionId, 'running')

      expect(eventHandler).toHaveBeenCalledWith(sessionId, 'running', 'starting')
    })
  })
})
