/**
 * 服务容器 - 依赖注入和懒加载管理
 * 
 * 解决主进程 index.ts 中 50+ 全局服务实例的问题
 * 提供：
 * 1. 懒加载：服务仅在首次使用时初始化
 * 2. 单例管理：确保每个服务只有一个实例
 * 3. 依赖注入：自动解析服务依赖
 * 4. 生命周期管理：统一的初始化和清理
 * 
 * @author weibin
 */

import { logger } from '../logger'

/**
 * 服务工厂函数类型
 */
export type ServiceFactory<T = any> = () => T | Promise<T>

/**
 * 服务定义
 */
export interface ServiceDefinition<T = any> {
  /** 服务名称（唯一标识） */
  name: string
  /** 工厂函数 */
  factory: ServiceFactory<T>
  /** 是否单例（默认 true） */
  singleton?: boolean
  /** 依赖的其他服务名称 */
  dependencies?: string[]
  /** 是否在应用启动时立即初始化 */
  eager?: boolean
}

/**
 * 服务注册表
 */
class ServiceContainer {
  private services: Map<string, ServiceDefinition> = new Map()
  private instances: Map<string, any> = new Map()
  private initializing: Set<string> = new Set() // 防止循环依赖
  
  /**
   * 注册服务
   */
  register<T>(definition: ServiceDefinition<T>): void {
    if (this.services.has(definition.name)) {
      logger.warn(`[ServiceContainer] Service "${definition.name}" already registered, overwriting`)
    }
    
    this.services.set(definition.name, definition)
    logger.debug(`[ServiceContainer] Registered service: ${definition.name}`)
  }
  
  /**
   * 获取服务实例（懒加载）
   */
  async get<T>(name: string): Promise<T> {
    // 检查是否已有实例
    if (this.instances.has(name)) {
      return this.instances.get(name) as T
    }
    
    // 检查服务定义
    const definition = this.services.get(name)
    if (!definition) {
      throw new Error(`Service "${name}" not registered`)
    }
    
    // 防止循环依赖
    if (this.initializing.has(name)) {
      throw new Error(`Circular dependency detected for service "${name}"`)
    }
    
    // 初始化依赖
    if (definition.dependencies && definition.dependencies.length > 0) {
      for (const depName of definition.dependencies) {
        await this.get(depName)
      }
    }
    
    // 创建实例
    this.initializing.add(name)
    try {
      logger.debug(`[ServiceContainer] Initializing service: ${name}`)
      const instance = await definition.factory()
      
      // 如果是单例，缓存实例
      if (definition.singleton !== false) {
        this.instances.set(name, instance)
      }
      
      logger.debug(`[ServiceContainer] Service initialized: ${name}`)
      return instance as T
    } catch (error) {
      logger.error(`[ServiceContainer] Failed to initialize service "${name}":`, error)
      throw error
    } finally {
      this.initializing.delete(name)
    }
  }
  
  /**
   * 同步获取服务（仅用于已初始化的单例服务）
   */
  getSync<T>(name: string): T {
    if (!this.instances.has(name)) {
      throw new Error(`Service "${name}" not initialized. Use await get() instead.`)
    }
    return this.instances.get(name) as T
  }
  
  /**
   * 检查服务是否已注册
   */
  has(name: string): boolean {
    return this.services.has(name)
  }
  
  /**
   * 检查服务是否已初始化
   */
  isInitialized(name: string): boolean {
    return this.instances.has(name)
  }
  
  /**
   * 获取所有已注册的服务名称
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys())
  }
  
  /**
   * 获取所有已初始化的服务名称
   */
  getInitializedServices(): string[] {
    return Array.from(this.instances.keys())
  }
  
  /**
   *  eagerly 初始化标记为 eager 的服务
   */
  async initializeEagerServices(): Promise<void> {
    const eagerServices = Array.from(this.services.values())
      .filter(def => def.eager === true)
    
    logger.info(`[ServiceContainer] Initializing ${eagerServices.length} eager services`)
    
    for (const service of eagerServices) {
      try {
        await this.get(service.name)
      } catch (error) {
        logger.error(`[ServiceContainer] Failed to initialize eager service "${service.name}":`, error)
        // 继续初始化其他服务
      }
    }
  }
  
  /**
   * 清理所有服务
   */
  async cleanup(): Promise<void> {
    logger.info('[ServiceContainer] Cleaning up all services')
    
    const cleanupPromises: Promise<void>[] = []
    
    for (const [name, instance] of this.instances) {
      try {
        // 如果实例有 cleanup/destroy/close 方法，调用它
        if (typeof instance.cleanup === 'function') {
          cleanupPromises.push(
            Promise.resolve(instance.cleanup()).then(() => {
              logger.debug(`[ServiceContainer] Cleaned up service: ${name}`)
            })
          )
        } else if (typeof instance.destroy === 'function') {
          cleanupPromises.push(
            Promise.resolve(instance.destroy()).then(() => {
              logger.debug(`[ServiceContainer] Destroyed service: ${name}`)
            })
          )
        } else if (typeof instance.close === 'function') {
          cleanupPromises.push(
            Promise.resolve(instance.close()).then(() => {
              logger.debug(`[ServiceContainer] Closed service: ${name}`)
            })
          )
        }
      } catch (error) {
        logger.error(`[ServiceContainer] Failed to cleanup service "${name}":`, error)
      }
    }
    
    await Promise.all(cleanupPromises)
    
    // 清空实例缓存
    this.instances.clear()
    logger.info('[ServiceContainer] All services cleaned up')
  }
  
  /**
   * 获取服务统计信息
   */
  getStats(): {
    total: number
    initialized: number
    uninitialized: number
    services: Array<{
      name: string
      initialized: boolean
      eager: boolean
      dependencies: string[]
    }>
  } {
    const services = Array.from(this.services.entries()).map(([name, def]) => ({
      name,
      initialized: this.instances.has(name),
      eager: def.eager === true,
      dependencies: def.dependencies || []
    }))
    
    return {
      total: this.services.size,
      initialized: this.instances.size,
      uninitialized: this.services.size - this.instances.size,
      services
    }
  }
}

// 导出单例容器
export const container = new ServiceContainer()

/**
 * 便捷函数：注册服务
 */
export function registerService<T>(definition: ServiceDefinition<T>): void {
  container.register(definition)
}

/**
 * 便捷函数：获取服务
 */
export async function getService<T>(name: string): Promise<T> {
  return container.get<T>(name)
}

/**
 * 便捷函数：同步获取服务
 */
export function getServiceSync<T>(name: string): T {
  return container.getSync<T>(name)
}
