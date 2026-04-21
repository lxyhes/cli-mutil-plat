/**
 * ServiceContainer 使用指南
 * 
 * 如何在 SpectrAI 中使用依赖注入容器
 * @author weibin
 */

// ==================== 基本用法 ====================

/**
 * 1. 注册服务（在应用启动时）
 */
import { registerService } from './ServiceContainer'

registerService({
  name: 'myService',
  factory: async () => {
    // 创建服务实例
    const dependency = await getService('dependency')
    return new MyService(dependency)
  },
  singleton: true,        // 是否单例（默认 true）
  dependencies: ['dependency'], // 依赖的其他服务
  eager: false            // 是否在启动时立即初始化（默认 false）
})

/**
 * 2. 获取服务（懒加载）
 */
import { getService } from './ServiceContainer'

// 异步获取（推荐）
const myService = await getService<MyService>('myService')

// 同步获取（仅用于已初始化的单例服务）
const myServiceSync = getServiceSync<MyService>('myService')

/**
 * 3. 检查服务状态
 */
import { container } from './ServiceContainer'

container.has('myService')           // 是否已注册
container.isInitialized('myService') // 是否已初始化
container.getServiceNames()          // 所有已注册的服务
container.getInitializedServices()   // 所有已初始化的服务
container.getStats()                 // 详细统计信息

/**
 * 4. 清理服务（应用退出时）
 */
await container.cleanup() // 自动调用所有服务的 cleanup/destroy/close 方法


// ==================== 在 SpectrAI 中的实际应用 ====================

/**
 * 场景 1: 替换 index.ts 中的全局变量
 * 
 * BEFORE (当前):
 */
let database: DatabaseManager
let sessionManagerV2: SessionManagerV2
let agentManagerV2: AgentManagerV2

async function initializeManagers() {
  database = new DatabaseManager(dbPath)
  sessionManagerV2 = new SessionManagerV2(adapterRegistry)
  agentManagerV2 = new AgentManagerV2(...)
  // ... 50+ 个服务
}

/**
 * AFTER (优化后):
 */
import { registerCoreServices, getService } from './utils/ServiceRegistry'

// 1. 注册所有服务定义
registerCoreServices()

// 2. 初始化标记为 eager 的核心服务
await container.initializeEagerServices()

// 3. 在需要的地方懒加载服务
ipcMain.handle(IPC.SESSION_CREATE, async (event, config) => {
  const sessionManager = await getService<SessionManagerV2>('sessionManagerV2')
  return sessionManager.createSession(config)
})

ipcMain.handle(IPC.TEAM_CREATE, async (event, request) => {
  const teamManager = await getService<TeamManager>('teamManager')
  return teamManager.createTeam(request)
})

/**
 * 场景 2: IPC Handler 中使用服务
 * 
 * BEFORE:
 */
ipcMain.handle(IPC.SESSION_CREATE, async (event, config) => {
  // 直接使用全局变量
  return sessionManagerV2.createSession(config)
})

/**
 * AFTER:
 */
import { wrapIpcHandler } from './ipc/errorMiddleware'

ipcMain.handle(IPC.SESSION_CREATE, wrapIpcHandler(async (event, config) => {
  const sessionManager = await getService<SessionManagerV2>('sessionManagerV2')
  return sessionManager.createSession(config)
}))

/**
 * 场景 3: 测试中使用 Mock 服务
 */
import { container } from './ServiceContainer'

beforeEach(() => {
  // 清除所有实例
  container.instances.clear()
  
  // 注册 Mock 服务
  registerService({
    name: 'database',
    factory: () => createMockDatabase(),
    singleton: true
  })
})


// ==================== 最佳实践 ====================

/**
 * ✅ DO: 使用懒加载
 */
// 服务仅在首次使用时初始化，减少启动时间
const service = await getService('myService')

/**
 * ❌ DON'T: 在模块顶层同步获取服务
 */
// 这会导致循环依赖和初始化顺序问题
const service = getServiceSync('myService') // 可能抛出错误

/**
 * ✅ DO: 声明依赖关系
 */
registerService({
  name: 'serviceA',
  factory: async () => {
    const serviceB = await getService('serviceB') // 自动初始化依赖
    return new ServiceA(serviceB)
  },
  dependencies: ['serviceB'] // 显式声明依赖
})

/**
 * ✅ DO: 使用 eager 标记核心服务
 */
registerService({
  name: 'database',
  factory: ...,
  eager: true // 启动时立即初始化
})

/**
 * ✅ DO: 实现 cleanup 方法
 */
class MyService {
  async cleanup() {
    // 释放资源、关闭连接等
  }
}

/**
 * ❌ DON'T: 创建循环依赖
 */
// A 依赖 B，B 依赖 A - 这会抛出错误
registerService({
  name: 'serviceA',
  factory: async () => new ServiceA(await getService('serviceB')),
  dependencies: ['serviceB']
})
registerService({
  name: 'serviceB',
  factory: async () => new ServiceB(await getService('serviceA')),
  dependencies: ['serviceA'] // ❌ 循环依赖！
})


// ==================== 迁移步骤 ====================

/**
 * 将现有代码迁移到 ServiceContainer 的步骤：
 * 
 * 1. 注册服务定义（在 ServiceRegistry.ts 中）
 * 2. 移除全局变量声明
 * 3. 在 initializeManagers() 中调用 registerCoreServices()
 * 4. 在所有使用服务的地方改用 getService()
 * 5. 在 app.on('will-quit') 中调用 container.cleanup()
 * 6. 运行测试验证
 * 
 * 注意：可以渐进式迁移，不需要一次性全部改造
 */
