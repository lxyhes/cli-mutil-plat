/**
 * EventEmitter 清理工具
 * 防止内存泄漏的工具函数集合
 * @author weibin
 */

import type { EventEmitter } from 'events'

/**
 * 安全地移除事件监听器
 * 
 * @param emitter EventEmitter 实例
 * @param eventName 事件名称
 * @param listener 监听器函数（可选，不提供则移除所有监听器）
 */
export function safeRemoveListener(
  emitter: EventEmitter,
  eventName: string | symbol,
  listener?: (...args: any[]) => void
): void {
  try {
    if (listener) {
      emitter.removeListener(eventName, listener)
    } else {
      emitter.removeAllListeners(eventName)
    }
  } catch (error) {
    console.warn(`[EventEmitter] Failed to remove listener for ${String(eventName)}:`, error)
  }
}

/**
 * 清理多个事件监听器
 * 
 * @param emitter EventEmitter 实例
 * @param eventNames 要清理的事件名称列表
 */
export function cleanupEventListeners(
  emitter: EventEmitter,
  eventNames: (string | symbol)[]
): void {
  for (const eventName of eventNames) {
    safeRemoveListener(emitter, eventName)
  }
}

/**
 * 获取 EventEmitter 的监听器统计信息
 * 
 * @param emitter EventEmitter 实例
 * @returns 每个事件的监听器数量
 */
export function getListenerStats(emitter: EventEmitter): Record<string, number> {
  const stats: Record<string, number> = {}
  
  try {
    const eventNames = emitter.eventNames()
    for (const eventName of eventNames) {
      const count = emitter.listenerCount(eventName)
      stats[String(eventName)] = count
    }
  } catch (error) {
    console.warn('[EventEmitter] Failed to get listener stats:', error)
  }
  
  return stats
}

/**
 * 检查 EventEmitter 是否存在潜在的内存泄漏
 * 
 * @param emitter EventEmitter 实例
 * @param maxListenersPerEvent 每个事件的最大监听器数量阈值
 * @returns 可能存在泄漏的事件列表
 */
export function detectPotentialLeaks(
  emitter: EventEmitter,
  maxListenersPerEvent: number = 10
): Array<{ event: string; count: number }> {
  const leaks: Array<{ event: string; count: number }> = []
  const stats = getListenerStats(emitter)
  
  for (const [event, count] of Object.entries(stats)) {
    if (count > maxListenersPerEvent) {
      leaks.push({ event, count })
    }
  }
  
  return leaks
}

/**
 * 带自动清理的事件监听器包装器
 * 
 * @example
 * ```typescript
 * const cleanup = createAutoCleanup(teamManager, 'team:completed', handler)
 * // ... 使用团队
 * cleanup() // 手动清理
 * ```
 */
export function createAutoCleanup(
  emitter: EventEmitter,
  eventName: string | symbol,
  listener: (...args: any[]) => void
): () => void {
  emitter.on(eventName, listener)
  
  return () => {
    safeRemoveListener(emitter, eventName, listener)
  }
}

/**
 * TeamManager 专用清理函数
 * 在团队取消/完成时清理相关资源
 */
export function cleanupTeamResources(
  teamManager: any,
  teamId: string
): void {
  try {
    // 清理健康检查器
    if (teamManager.healthCheckers?.has(teamId)) {
      const checker = teamManager.healthCheckers.get(teamId)
      if (checker.stop) {
        checker.stop()
      }
      teamManager.healthCheckers.delete(teamId)
    }
    
    // 清理 Bridge
    if (teamManager.bridges?.has(teamId)) {
      const bridge = teamManager.bridges.get(teamId)
      if (bridge.destroy) {
        bridge.destroy()
      }
      teamManager.bridges.delete(teamId)
    }
    
    // 清理活动团队记录
    if (teamManager.activeTeams?.has(teamId)) {
      teamManager.activeTeams.delete(teamId)
    }
    
    console.log(`[Team Cleanup] Resources cleaned up for team ${teamId}`)
  } catch (error) {
    console.error(`[Team Cleanup] Failed to cleanup team ${teamId}:`, error)
  }
}

/**
 * AgentBridge 专用清理函数
 */
export function cleanupAgentBridge(bridge: any): void {
  try {
    if (bridge.wsServer) {
      bridge.wsServer.close()
    }
    if (bridge.clients) {
      for (const client of bridge.clients) {
        if (client.terminate) {
          client.terminate()
        }
      }
      bridge.clients.clear()
    }
    bridge.removeAllListeners()
    console.log('[AgentBridge Cleanup] Bridge resources cleaned up')
  } catch (error) {
    console.error('[AgentBridge Cleanup] Failed to cleanup bridge:', error)
  }
}
