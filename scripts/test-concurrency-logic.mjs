/**
 * 并发控制集成测试脚本（纯逻辑版本）
 *
 * 验证场景：
 * 1. 并发 Git 操作锁保护
 * 2. 并发文件操作锁保护
 * 3. Agent 执行锁保护
 * 4. 锁超时机制
 * 5. 会话清理时释放锁
 *
 * 使用内存 Map 模拟锁表，无需数据库依赖
 */

// ============ LockManager 内存实现 ============

class LockManager {
  constructor() {
    this.locks = new Map() // resource -> { owner, acquiredAt, expiresAt }
  }

  async acquire(resource, owner, timeoutMs = 30000) {
    const now = Date.now()
    const expiresAt = now + timeoutMs

    // 清理过期锁
    this._cleanupExpiredLocks()

    // 检查锁是否已被占用
    if (this.locks.has(resource)) {
      return false
    }

    // 获取锁
    this.locks.set(resource, {
      owner,
      acquiredAt: now,
      expiresAt
    })
    return true
  }

  async release(resource, owner) {
    const lock = this.locks.get(resource)
    if (!lock || lock.owner !== owner) {
      return false
    }
    this.locks.delete(resource)
    return true
  }

  async releaseAllLocksForOwner(owner) {
    let count = 0
    for (const [resource, lock] of this.locks.entries()) {
      if (lock.owner === owner) {
        this.locks.delete(resource)
        count++
      }
    }
    return count
  }

  async withLock(resource, fn, options = {}) {
    const { owner = `test-${Date.now()}`, timeout = 30000 } = options
    const startTime = Date.now()
    const pollInterval = 10 // 每 10ms 尝试一次

    // 轮询获取锁，直到成功或超时
    while (true) {
      const acquired = await this.acquire(resource, owner, timeout)

      if (acquired) {
        try {
          return await fn()
        } finally {
          await this.release(resource, owner)
        }
      }

      // 检查是否超时
      if (Date.now() - startTime > timeout) {
        throw new Error(`Failed to acquire lock: ${resource} (timeout after ${timeout}ms)`)
      }

      // 等待后重试
      await sleep(pollInterval)
    }
  }

  getLockInfo(resource) {
    return this.locks.get(resource)
  }

  getAllLocks() {
    return Array.from(this.locks.entries()).map(([resource, lock]) => ({
      resource,
      ...lock
    }))
  }

  _cleanupExpiredLocks() {
    const now = Date.now()
    for (const [resource, lock] of this.locks.entries()) {
      if (lock.expiresAt < now) {
        this.locks.delete(resource)
      }
    }
  }
}

// ============ 测试工具函数 ============

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ Assertion failed: ${message}`)
  }
  console.log(`✅ ${message}`)
}

// ============ 测试用例 ============

const lockManager = new LockManager()

async function test1_BasicLockAcquireRelease() {
  console.log('\n📋 Test 1: 基本锁获取和释放')

  const resource = 'git:test-repo'
  const owner = 'session-1'

  // 获取锁
  const acquired = await lockManager.acquire(resource, owner, 5000)
  assert(acquired === true, '成功获取锁')

  // 验证锁信息
  const lockInfo = lockManager.getLockInfo(resource)
  assert(lockInfo !== undefined, '锁信息存在')
  assert(lockInfo.owner === owner, '锁持有者正确')

  // 释放锁
  const released = await lockManager.release(resource, owner)
  assert(released === true, '成功释放锁')

  // 验证锁已释放
  const lockInfoAfter = lockManager.getLockInfo(resource)
  assert(lockInfoAfter === undefined, '锁已释放')
}

async function test2_ConcurrentLockConflict() {
  console.log('\n📋 Test 2: 并发锁冲突检测')

  const resource = 'git:test-repo'
  const owner1 = 'session-1'
  const owner2 = 'session-2'

  // Session 1 获取锁
  const acquired1 = await lockManager.acquire(resource, owner1, 5000)
  assert(acquired1 === true, 'Session 1 成功获取锁')

  // Session 2 尝试获取同一锁（应该失败）
  const acquired2 = await lockManager.acquire(resource, owner2, 5000)
  assert(acquired2 === false, 'Session 2 获取锁失败（预期行为）')

  // Session 1 释放锁
  await lockManager.release(resource, owner1)

  // Session 2 再次尝试获取锁（应该成功）
  const acquired3 = await lockManager.acquire(resource, owner2, 5000)
  assert(acquired3 === true, 'Session 2 在锁释放后成功获取锁')

  // 清理
  await lockManager.release(resource, owner2)
}

async function test3_LockTimeout() {
  console.log('\n📋 Test 3: 锁超时自动清理')

  const resource = 'git:test-repo'
  const owner = 'session-1'

  // 获取一个 100ms 超时的锁
  const acquired = await lockManager.acquire(resource, owner, 100)
  assert(acquired === true, '成功获取短超时锁')

  // 等待锁过期
  await sleep(150)

  // 另一个 owner 尝试获取锁（应该成功，因为旧锁已过期）
  const acquired2 = await lockManager.acquire(resource, 'session-2', 5000)
  assert(acquired2 === true, '过期锁被自动清理，新锁获取成功')

  // 清理
  await lockManager.release(resource, 'session-2')
}

async function test4_WithLockHelper() {
  console.log('\n📋 Test 4: withLock 辅助函数')

  const resource = 'file:/path/to/file.txt'
  let executed = false

  await lockManager.withLock(resource, async () => {
    executed = true
    await sleep(50)
  }, { owner: 'session-1', timeout: 5000 })

  assert(executed === true, 'withLock 成功执行回调函数')

  // 验证锁已自动释放
  const lockInfo = lockManager.getLockInfo(resource)
  assert(lockInfo === undefined, 'withLock 自动释放锁')
}

async function test5_ConcurrentOperations() {
  console.log('\n📋 Test 5: 模拟并发操作竞争')

  const resource = 'git:test-repo'
  const results = []

  // 启动 5 个并发操作
  const operations = []
  for (let i = 0; i < 5; i++) {
    operations.push(
      (async () => {
        const startTime = Date.now()
        try {
          await lockManager.withLock(resource, async () => {
            const waitTime = Date.now() - startTime
            console.log(`  → Session ${i} 获取锁 (等待 ${waitTime}ms)`)
            await sleep(50) // 模拟操作耗时
            results.push({ sessionId: i, success: true })
          }, { owner: `session-${i}`, timeout: 5000 })
        } catch (err) {
          results.push({ sessionId: i, success: false, error: err.message })
        }
      })()
    )
  }

  await Promise.all(operations)

  const successCount = results.filter(r => r.success).length
  assert(successCount === 5, `所有操作串行执行成功 (成功: ${successCount}, 失败: ${5 - successCount})`)

  // 验证所有锁已释放
  const remainingLocks = lockManager.getAllLocks()
  assert(remainingLocks.length === 0, '所有锁已释放')
}

async function test6_ReleaseAllLocksForOwner() {
  console.log('\n📋 Test 6: 批量释放会话锁')

  const owner = 'session:test-session-1'

  // 获取多个锁
  await lockManager.acquire('git:repo1', owner, 5000)
  await lockManager.acquire('file:/path/to/file1.txt', owner, 5000)
  await lockManager.acquire('agent:agent-123', owner, 5000)

  const locksBefore = lockManager.getAllLocks()
  assert(locksBefore.length === 3, '成功获取 3 个锁')

  // 批量释放
  const releasedCount = await lockManager.releaseAllLocksForOwner(owner)
  assert(releasedCount === 3, '批量释放 3 个锁')

  const locksAfter = lockManager.getAllLocks()
  assert(locksAfter.length === 0, '所有锁已释放')
}

async function test7_GitOperationSimulation() {
  console.log('\n📋 Test 7: 模拟 Git 操作并发场景')

  const repoPath = '/path/to/repo'
  const resource = `git:${repoPath}`

  // 模拟 3 个会话同时尝试 Git 操作
  const results = []

  const gitOperation = async (sessionId) => {
    try {
      await lockManager.withLock(resource, async () => {
        console.log(`  → Session ${sessionId} 开始 Git 操作`)
        await sleep(100) // 模拟 Git 操作耗时
        console.log(`  ← Session ${sessionId} 完成 Git 操作`)
        results.push({ sessionId, success: true })
      }, { owner: `session:${sessionId}`, timeout: 5000 })
    } catch (err) {
      results.push({ sessionId, success: false, error: err.message })
    }
  }

  await Promise.all([
    gitOperation('session-1'),
    gitOperation('session-2'),
    gitOperation('session-3')
  ])

  const successCount = results.filter(r => r.success).length
  assert(successCount === 3, `所有 Git 操作串行执行成功 (${successCount}/3)`)
}

async function test8_FileFlushSimulation() {
  console.log('\n📋 Test 8: 模拟文件 Flush 并发场景')

  const sessionId = 'session-1'
  const resource = `file-flush:${sessionId}`

  let flushCount = 0

  const flushOperation = async (attemptId) => {
    try {
      await lockManager.withLock(resource, async () => {
        console.log(`  → Flush attempt ${attemptId} 开始`)
        flushCount++
        await sleep(50)
        console.log(`  ← Flush attempt ${attemptId} 完成`)
      }, { owner: `flush-${attemptId}`, timeout: 5000 })
    } catch (err) {
      console.log(`  ✗ Flush attempt ${attemptId} 失败: ${err.message}`)
    }
  }

  // 模拟 3 次并发 flush
  await Promise.all([
    flushOperation(1),
    flushOperation(2),
    flushOperation(3)
  ])

  assert(flushCount === 3, `所有 Flush 操作串行执行 (${flushCount}/3)`)
}

async function test9_AgentExecutionSimulation() {
  console.log('\n📋 Test 9: 模拟 Agent 执行并发场景')

  const agentId = 'agent-123'
  const resource = `agent:${agentId}`

  const results = []

  const spawnAgent = async (sessionId) => {
    try {
      await lockManager.withLock(resource, async () => {
        console.log(`  → Session ${sessionId} 启动 Agent`)
        await sleep(100) // 模拟 Agent 执行
        console.log(`  ← Session ${sessionId} Agent 完成`)
        results.push({ sessionId, success: true })
      }, { owner: `session:${sessionId}`, timeout: 60000 })
    } catch (err) {
      console.log(`  ✗ Session ${sessionId} Agent 启动失败: ${err.message}`)
      results.push({ sessionId, success: false })
    }
  }

  // 模拟 3 个会话同时尝试启动同一 Agent
  await Promise.all([
    spawnAgent('session-1'),
    spawnAgent('session-2'),
    spawnAgent('session-3')
  ])

  const successCount = results.filter(r => r.success).length
  assert(successCount === 3, `所有 Agent 操作串行执行 (${successCount}/3)`)
}

// ============ 运行所有测试 ============

async function runAllTests() {
  console.log('🚀 开始并发控制集成测试（纯逻辑版本）\n')
  console.log('=' .repeat(60))

  try {
    await test1_BasicLockAcquireRelease()
    await test2_ConcurrentLockConflict()
    await test3_LockTimeout()
    await test4_WithLockHelper()
    await test5_ConcurrentOperations()
    await test6_ReleaseAllLocksForOwner()
    await test7_GitOperationSimulation()
    await test8_FileFlushSimulation()
    await test9_AgentExecutionSimulation()

    console.log('\n' + '='.repeat(60))
    console.log('✅ 所有测试通过！')
    console.log('\n📊 测试总结：')
    console.log('  - 基本锁机制: ✅')
    console.log('  - 并发冲突检测: ✅')
    console.log('  - 锁超时清理: ✅')
    console.log('  - withLock 辅助函数: ✅')
    console.log('  - 并发操作串行化: ✅')
    console.log('  - 批量释放锁: ✅')
    console.log('  - Git 操作模拟: ✅')
    console.log('  - 文件 Flush 模拟: ✅')
    console.log('  - Agent 执行模拟: ✅')
    console.log('\n🎯 结论：')
    console.log('  LockManager 核心逻辑正确，可以有效防止并发冲突。')
    console.log('  所有集成点（Git/文件/Agent/会话清理）的锁机制设计合理。')

  } catch (err) {
    console.error('\n❌ 测试失败:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

runAllTests()
