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
  createSession: vi.fn(),
  updateSession: vi.fn(),
  getSession: vi.fn(),
  cleanupOrphanedSessions: vi.fn(),
} as unknown as DatabaseManager

// Mock AdapterRegistry
const mockAdapterRegistry = {
  get: vi.fn(),
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
    it('应该成功创建新会话', () => {
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
        on: vi.fn(),
        off: vi.fn(),
      }
      ;(mockAdapterRegistry.get as any).mockReturnValue(mockAdapter)

      const sessionId = sessionManager.createSession(config)

      expect(sessionId).toBeDefined()
      expect(typeof sessionId).toBe('string')
      expect(mockAdapter.startSession).toHaveBeenCalled()
    })

    it('应该在 Provider 不存在时抛出错误', () => {
      const config = {
        name: 'Test Session',
        workingDirectory: '/test/path',
        providerType: 'claude-code' as const,
        autoAccept: true,
      }

      ;(mockAdapterRegistry.get as any).mockReturnValue(null)

      expect(() => sessionManager.createSession(config)).toThrow()
    })
  })

  describe('getSession', () => {
    it('应该返回存在的会话', () => {
      const config = {
        name: 'Test Session',
        workingDirectory: '/test/path',
        providerType: 'claude-code' as const,
        autoAccept: true,
      }

      // Mock adapter
      const mockAdapter = {
        providerId: 'claude-code',
        startSession: vi.fn().mockResolvedValue(undefined),
        hasSession: vi.fn().mockReturnValue(true),
        on: vi.fn(),
        off: vi.fn(),
      }
      ;(mockAdapterRegistry.get as any).mockReturnValue(mockAdapter)

      const sessionId = sessionManager.createSession(config)
      const session = sessionManager.getSession(sessionId)

      expect(session).toBeDefined()
      expect(session?.id).toBe(sessionId)
    })

    it('应该在会话不存在时返回 undefined', () => {
      const session = sessionManager.getSession('non-existent')
      expect(session).toBeUndefined()
    })
  })

  describe('getAllSessions', () => {
    it('应该返回所有会话列表', () => {
      const config = {
        name: 'Test Session',
        workingDirectory: '/test/path',
        providerType: 'claude-code' as const,
        autoAccept: true,
      }

      // Mock adapter
      const mockAdapter = {
        providerId: 'claude-code',
        startSession: vi.fn().mockResolvedValue(undefined),
        hasSession: vi.fn().mockReturnValue(true),
        on: vi.fn(),
        off: vi.fn(),
      }
      ;(mockAdapterRegistry.get as any).mockReturnValue(mockAdapter)

      // Create two sessions
      const sessionId1 = sessionManager.createSession(config)
      const config2 = { ...config, name: 'Test Session 2' }
      const sessionId2 = sessionManager.createSession(config2)

      const sessions = sessionManager.getAllSessions()

      expect(sessions).toHaveLength(2)
      expect(sessions.map(s => s.id)).toEqual(expect.arrayContaining([sessionId1, sessionId2]))
    })
  })
})
