/**
 * 服务注册配置
 * 
 * 定义所有核心服务的依赖关系和初始化策略
 * @author weibin
 */

import { registerService, getService } from './ServiceContainer'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { AgentManagerV2 } from '../agent/AgentManagerV2'
import type { AdapterRegistry } from '../adapter/AdapterRegistry'
import type { TeamManager } from '../team/TeamManager'
import type { MemoryCoordinator } from '../memory/MemoryCoordinator'
import type { FileChangeTracker } from '../tracker/FileChangeTracker'

/**
 * 注册所有核心服务
 * 
 * 注意：这里只注册服务定义，实际初始化在首次调用 getService() 时进行
 */
export function registerCoreServices(): void {
  // ==================== 基础服务 ====================
  
  // 数据库管理器（eager: 启动时立即初始化）
  registerService<DatabaseManager>({
    name: 'database',
    factory: async () => {
      const { DatabaseManager } = await import('../storage/Database')
      const { app } = await import('electron')
      const { join } = await import('path')
      
      const dbPath = join(app.getPath('userData'), 'claudeops.db')
      return new DatabaseManager(dbPath)
    },
    singleton: true,
    eager: true // 数据库需要最先初始化
  })
  
  // ==================== 会话管理服务 ====================
  
  // Adapter Registry
  registerService<AdapterRegistry>({
    name: 'adapterRegistry',
    factory: async () => {
      const { AdapterRegistry } = await import('../adapter/AdapterRegistry')
      const registry = new AdapterRegistry()
      
      // 注册所有 Provider Adapter
      try {
        const { ClaudeSdkAdapter } = await import('../adapter/ClaudeSdkAdapter')
        const adapter = new ClaudeSdkAdapter()
        const database = await getService<DatabaseManager>('database')
        adapter.setDatabase(database)
        registry.register(adapter)
      } catch (err) {
        console.warn('[ServiceRegistry] ClaudeSdkAdapter not available:', err)
      }
      
      try {
        const { CodexAppServerAdapter } = await import('../adapter/CodexAppServerAdapter')
        registry.register(new CodexAppServerAdapter())
      } catch (err) {
        console.warn('[ServiceRegistry] CodexAppServerAdapter not available:', err)
      }
      
      try {
        const { GeminiHeadlessAdapter } = await import('../adapter/GeminiHeadlessAdapter')
        registry.register(new GeminiHeadlessAdapter())
      } catch (err) {
        console.warn('[ServiceRegistry] GeminiHeadlessAdapter not available:', err)
      }
      
      try {
        const { IFlowAcpAdapter } = await import('../adapter/IFlowAcpAdapter')
        registry.register(new IFlowAcpAdapter())
      } catch (err) {
        console.warn('[ServiceRegistry] IFlowAcpAdapter not available:', err)
      }
      
      try {
        const { OpenCodeSdkAdapter } = await import('../adapter/OpenCodeSdkAdapter')
        registry.register(new OpenCodeSdkAdapter())
      } catch (err) {
        console.warn('[ServiceRegistry] OpenCodeSdkAdapter not available:', err)
      }
      
      return registry
    },
    singleton: true,
    dependencies: ['database']
  })
  
  // Session Manager V2
  registerService<SessionManagerV2>({
    name: 'sessionManagerV2',
    factory: async () => {
      const { SessionManagerV2 } = await import('../session/SessionManagerV2')
      const adapterRegistry = await getService<AdapterRegistry>('adapterRegistry')
      const sessionManager = new SessionManagerV2(adapterRegistry)
      
      const database = await getService<DatabaseManager>('database')
      sessionManager.setDatabase(database)
      
      return sessionManager
    },
    singleton: true,
    dependencies: ['adapterRegistry', 'database']
  })
  
  // Agent Manager V2
  registerService<AgentManagerV2>({
    name: 'agentManagerV2',
    factory: async () => {
      const { AgentManagerV2 } = await import('../agent/AgentManagerV2')
      const adapterRegistry = await getService<AdapterRegistry>('adapterRegistry')
      const sessionManagerV2 = await getService<SessionManagerV2>('sessionManagerV2')
      const database = await getService<DatabaseManager>('database')
      
      const agentManager = new AgentManagerV2(adapterRegistry, sessionManagerV2, database)
      agentManager.setBridgePort(63721)
      
      return agentManager
    },
    singleton: true,
    dependencies: ['adapterRegistry', 'sessionManagerV2', 'database']
  })
  
  // ==================== 团队协作服务 ====================
  
  // Team Manager
  registerService<TeamManager>({
    name: 'teamManager',
    factory: async () => {
      const { TeamManager } = await import('../team/TeamManager')
      const { TeamRepository } = await import('../team/TeamRepository')
      const { GitWorktreeService } = await import('../git/GitWorktreeService')
      
      const database = await getService<DatabaseManager>('database')
      const teamRepo = new TeamRepository(database.getDb(), database.isUsingSqlite())
      const agentManagerV2 = await getService<AgentManagerV2>('agentManagerV2')
      const sessionManagerV2 = await getService<SessionManagerV2>('sessionManagerV2')
      const gitService = new GitWorktreeService()
      
      return new TeamManager(teamRepo, agentManagerV2, sessionManagerV2, database, gitService)
    },
    singleton: true,
    dependencies: ['database', 'agentManagerV2', 'sessionManagerV2']
  })
  
  // ==================== 监控和管理服务 ====================
  
  // Memory Coordinator（eager: 启动时立即初始化并监控）
  registerService<MemoryCoordinator>({
    name: 'memoryCoordinator',
    factory: async () => {
      const { MemoryCoordinator } = await import('../memory/MemoryCoordinator')
      
      const coordinator = new MemoryCoordinator({
        warning: 1024,   // 1 GB
        critical: 2048,  // 2 GB
        maximum: 3072    // 3 GB
      })
      
      // 注册组件
      const database = await getService<DatabaseManager>('database')
      const sessionManagerV2 = await getService<SessionManagerV2>('sessionManagerV2')
      
      coordinator.registerComponent(database)
      coordinator.registerComponent(sessionManagerV2)
      
      // 启动监控
      coordinator.start(30000) // 每 30 秒检查一次
      
      return coordinator
    },
    singleton: true,
    dependencies: ['database', 'sessionManagerV2'],
    eager: true
  })
  
  // File Change Tracker
  registerService<FileChangeTracker>({
    name: 'fileChangeTracker',
    factory: async () => {
      const { FileChangeTracker } = await import('../tracker/FileChangeTracker')
      const database = await getService<DatabaseManager>('database')
      
      return new FileChangeTracker(database)
    },
    singleton: true,
    dependencies: ['database']
  })
  
  console.log('[ServiceRegistry] Core services registered')
}

/**
 * 获取服务统计信息（用于调试）
 */
export function getServiceStats(): any {
  const { container } = require('./ServiceContainer')
  return container.getStats()
}
