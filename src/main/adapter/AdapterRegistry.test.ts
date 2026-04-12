/**
 * AdapterRegistry 单元测试
 * 验证注册、获取、类型匹配、重复注册、清理等核心逻辑
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { AdapterRegistry } from './AdapterRegistry'
import { BaseProviderAdapter } from './types'
import { EventEmitter } from 'events'
import type { AdapterSessionConfig, AdapterSession } from '../types'
import type { ConversationMessage } from '../../../../shared/types'

/** 创建测试用 Mock Adapter */
function createMockAdapter(providerId: string, displayName?: string): BaseProviderAdapter {
  const adapter = Object.create(BaseProviderAdapter.prototype) as BaseProviderAdapter
  Object.assign(adapter, {
    providerId,
    displayName: displayName ?? providerId,
    startSession: async () => {},
    sendMessage: async () => {},
    sendConfirmation: async () => {},
    abortCurrentTurn: async () => {},
    terminateSession: async () => {},
    resumeSession: async () => {},
    getConversation: () => [] as ConversationMessage[],
    hasSession: () => false,
    getProviderSessionId: () => undefined,
    cleanup: () => {},
  })
  // 继承 EventEmitter
  EventEmitter.call(adapter)
  return adapter
}

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry

  beforeEach(() => {
    registry = new AdapterRegistry()
  })

  describe('register + get', () => {
    it('应能注册并获取 Adapter', () => {
      const adapter = createMockAdapter('claude-code')
      registry.register(adapter)
      expect(registry.get('claude-code')).toBe(adapter)
    })

    it('重复注册同一 providerId 应抛出错误', () => {
      const adapter1 = createMockAdapter('claude-code')
      const adapter2 = createMockAdapter('claude-code')
      registry.register(adapter1)
      expect(() => registry.register(adapter2)).toThrow('Adapter already registered')
    })

    it('获取未注册的 providerId 应抛出错误并列出可用 ID', () => {
      expect(() => registry.get('nonexistent')).toThrow('No adapter registered')
      expect(() => registry.get('nonexistent')).toThrow('Available:')
    })
  })

  describe('getByType', () => {
    it('应按 AdapterType 找到 claude-code', () => {
      const adapter = createMockAdapter('claude-code')
      registry.register(adapter)
      expect(registry.getByType('claude-sdk')).toBe(adapter)
    })

    it('应按 AdapterType 找到 codex', () => {
      const adapter = createMockAdapter('codex')
      registry.register(adapter)
      expect(registry.getByType('codex-appserver')).toBe(adapter)
    })

    it('应按 AdapterType 找到 gemini-cli', () => {
      const adapter = createMockAdapter('gemini-cli')
      registry.register(adapter)
      expect(registry.getByType('gemini-headless')).toBe(adapter)
    })

    it('应按 AdapterType 找到 iflow', () => {
      const adapter = createMockAdapter('iflow')
      registry.register(adapter)
      expect(registry.getByType('iflow-acp')).toBe(adapter)
    })

    it('应按 AdapterType 找到 opencode', () => {
      const adapter = createMockAdapter('opencode')
      registry.register(adapter)
      expect(registry.getByType('opencode-sdk')).toBe(adapter)
    })

    it('未注册类型应抛出错误', () => {
      expect(() => registry.getByType('claude-sdk')).toThrow('No adapter registered for type')
    })
  })

  describe('has', () => {
    it('已注册返回 true', () => {
      registry.register(createMockAdapter('claude-code'))
      expect(registry.has('claude-code')).toBe(true)
    })

    it('未注册返回 false', () => {
      expect(registry.has('claude-code')).toBe(false)
    })
  })

  describe('getRegisteredIds', () => {
    it('应返回所有已注册的 providerId', () => {
      registry.register(createMockAdapter('claude-code'))
      registry.register(createMockAdapter('codex'))
      registry.register(createMockAdapter('gemini-cli'))
      expect(registry.getRegisteredIds()).toEqual(['claude-code', 'codex', 'gemini-cli'])
    })

    it('空注册表返回空数组', () => {
      expect(registry.getRegisteredIds()).toEqual([])
    })
  })

  describe('cleanup', () => {
    it('应调用所有 Adapter 的 cleanup 并清空注册表', () => {
      let cleanedUp = false
      const adapter = createMockAdapter('claude-code')
      adapter.cleanup = () => { cleanedUp = true }
      registry.register(adapter)
      registry.cleanup()
      expect(cleanedUp).toBe(true)
      expect(registry.getRegisteredIds()).toEqual([])
    })

    it('某个 Adapter cleanup 出错不应影响其他', () => {
      const adapter1 = createMockAdapter('claude-code')
      const adapter2 = createMockAdapter('codex')
      let cleaned2 = false
      adapter1.cleanup = () => { throw new Error('boom') }
      adapter2.cleanup = () => { cleaned2 = true }
      registry.register(adapter1)
      registry.register(adapter2)
      // 不应抛错
      expect(() => registry.cleanup()).not.toThrow()
      expect(cleaned2).toBe(true)
    })
  })
})
