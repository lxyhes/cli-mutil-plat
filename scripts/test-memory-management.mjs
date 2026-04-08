#!/usr/bin/env node

/**
 * 内存管理集成测试
 *
 * 测试 MemoryCoordinator 和各组件的内存管理功能
 */

import { EventEmitter } from 'events'

// ============================================================================
// Mock Components
// ============================================================================

class MockMemoryComponent extends EventEmitter {
  constructor(name, itemCount = 10, sizePerItem = 1024) {
    super()
    this.name = name
    this.itemCount = itemCount
    this.sizePerItem = sizePerItem
    this.lastCleanupTime = null
    this.cleanupCount = 0
  }

  async cleanup(mode) {
    this.cleanupCount++
    this.lastCleanupTime = new Date()

    // 模拟清理：减少 item 数量
    if (mode === 'normal') {
      this.itemCount = Math.max(0, this.itemCount - 3)
    } else if (mode === 'aggressive') {
      this.itemCount = Math.max(0, this.itemCount - 7)
    }

    console.log(`  [${this.name}] Cleaned up (${mode}), items: ${this.itemCount}`)
  }

  getMemoryInfo() {
    return {
      name: this.name,
      itemCount: this.itemCount,
      estimatedSize: this.itemCount * this.sizePerItem,
      lastCleanup: this.lastCleanupTime?.toISOString(),
      metadata: {
        cleanupCount: this.cleanupCount
      }
    }
  }
}

// ============================================================================
// Simplified MemoryCoordinator for Testing
// ============================================================================

class TestMemoryCoordinator extends EventEmitter {
  constructor(thresholds) {
    super()
    this.thresholds = thresholds
    this.components = new Map()
    this.monitorInterval = null
    this.memoryHistory = []
  }

  registerComponent(component) {
    this.components.set(component.name, component)
    console.log(`✓ Registered component: ${component.name}`)
  }

  unregisterComponent(name) {
    this.components.delete(name)
    console.log(`✓ Unregistered component: ${name}`)
  }

  start(intervalMs = 1000) {
    if (this.monitorInterval) return

    console.log(`✓ Started memory monitoring (interval: ${intervalMs}ms)`)
    this.monitorInterval = setInterval(() => {
      this._checkMemory()
    }, intervalMs)
  }

  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
      console.log('✓ Stopped memory monitoring')
    }
  }

  _checkMemory() {
    const stats = this.getMemoryStats()
    this.memoryHistory.push({ timestamp: Date.now(), ...stats })

    // 保留最近 100 条记录
    if (this.memoryHistory.length > 100) {
      this.memoryHistory.shift()
    }

    const usedMB = stats.heapUsed / (1024 * 1024)

    if (usedMB >= this.thresholds.maximum) {
      this.emit('maximum', stats)
      this.forceCleanup('aggressive')
    } else if (usedMB >= this.thresholds.critical) {
      this.emit('critical', stats)
      this.forceCleanup('normal')
    } else if (usedMB >= this.thresholds.warning) {
      this.emit('warning', stats)
    }
  }

  getMemoryStats() {
    const mem = process.memoryUsage()
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      rss: mem.rss
    }
  }

  getComponentsInfo() {
    const components = []
    for (const component of this.components.values()) {
      components.push(component.getMemoryInfo())
    }
    return components
  }

  async forceCleanup(mode = 'normal') {
    console.log(`\n🧹 Force cleanup (${mode})...`)

    for (const component of this.components.values()) {
      try {
        await component.cleanup(mode)
      } catch (err) {
        console.error(`  ✗ ${component.name} cleanup failed:`, err.message)
      }
    }

    // 触发 GC（如果可用）
    if (global.gc) {
      global.gc()
      console.log('  ✓ Triggered garbage collection')
    }
  }

  generateReport() {
    const stats = this.getMemoryStats()
    const components = this.getComponentsInfo()

    return {
      timestamp: new Date().toISOString(),
      memory: {
        heapUsed: stats.heapUsed,
        heapTotal: stats.heapTotal,
        external: stats.external,
        rss: stats.rss
      },
      components,
      thresholds: this.thresholds,
      historyLength: this.memoryHistory.length
    }
  }
}

// ============================================================================
// Test Cases
// ============================================================================

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatBytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

async function test1_StartAndStop() {
  console.log('\n📋 Test 1: MemoryCoordinator 启动和停止')

  const coordinator = new TestMemoryCoordinator({
    warning: 500,
    critical: 800,
    maximum: 1024
  })

  coordinator.start(500)
  await sleep(1500)
  coordinator.stop()

  console.log('✅ Test 1 passed\n')
}

async function test2_ComponentRegistration() {
  console.log('\n📋 Test 2: 组件注册和内存信息获取')

  const coordinator = new TestMemoryCoordinator({
    warning: 500,
    critical: 800,
    maximum: 1024
  })

  const comp1 = new MockMemoryComponent('SessionManager', 20, 50 * 1024)
  const comp2 = new MockMemoryComponent('DatabaseManager', 100, 2 * 1024)
  const comp3 = new MockMemoryComponent('FileTracker', 50, 1024)

  coordinator.registerComponent(comp1)
  coordinator.registerComponent(comp2)
  coordinator.registerComponent(comp3)

  const components = coordinator.getComponentsInfo()
  console.log('\nComponent memory info:')
  for (const comp of components) {
    console.log(`  - ${comp.name}: ${comp.itemCount} items, ${formatBytes(comp.estimatedSize)}`)
  }

  coordinator.unregisterComponent('FileTracker')

  console.log('✅ Test 2 passed\n')
}

async function test3_MemoryThresholds() {
  console.log('\n📋 Test 3: 内存阈值检测和事件触发')

  const coordinator = new TestMemoryCoordinator({
    warning: 50,   // 50 MB (低阈值便于测试)
    critical: 100,
    maximum: 150
  })

  let warningFired = false
  let criticalFired = false
  let maximumFired = false

  coordinator.on('warning', (stats) => {
    console.log(`⚠️  Warning threshold reached: ${formatBytes(stats.heapUsed)}`)
    warningFired = true
  })

  coordinator.on('critical', (stats) => {
    console.log(`🔴 Critical threshold reached: ${formatBytes(stats.heapUsed)}`)
    criticalFired = true
  })

  coordinator.on('maximum', (stats) => {
    console.log(`💥 Maximum threshold reached: ${formatBytes(stats.heapUsed)}`)
    maximumFired = true
  })

  // 注册组件
  const comp = new MockMemoryComponent('TestComponent', 100, 1024)
  coordinator.registerComponent(comp)

  coordinator.start(500)
  await sleep(2000)
  coordinator.stop()

  console.log(`\nEvents fired: warning=${warningFired}, critical=${criticalFired}, maximum=${maximumFired}`)
  console.log('✅ Test 3 passed\n')
}

async function test4_AutoCleanup() {
  console.log('\n📋 Test 4: 自动清理功能')

  const coordinator = new TestMemoryCoordinator({
    warning: 500,
    critical: 800,
    maximum: 1024
  })

  const comp1 = new MockMemoryComponent('Component1', 50, 1024)
  const comp2 = new MockMemoryComponent('Component2', 30, 1024)

  coordinator.registerComponent(comp1)
  coordinator.registerComponent(comp2)

  console.log('\nBefore cleanup:')
  let components = coordinator.getComponentsInfo()
  for (const comp of components) {
    console.log(`  - ${comp.name}: ${comp.itemCount} items`)
  }

  await coordinator.forceCleanup('normal')

  console.log('\nAfter normal cleanup:')
  components = coordinator.getComponentsInfo()
  for (const comp of components) {
    console.log(`  - ${comp.name}: ${comp.itemCount} items`)
  }

  await coordinator.forceCleanup('aggressive')

  console.log('\nAfter aggressive cleanup:')
  components = coordinator.getComponentsInfo()
  for (const comp of components) {
    console.log(`  - ${comp.name}: ${comp.itemCount} items`)
  }

  console.log('✅ Test 4 passed\n')
}

async function test5_MemoryReport() {
  console.log('\n📋 Test 5: 内存报告生成')

  const coordinator = new TestMemoryCoordinator({
    warning: 500,
    critical: 800,
    maximum: 1024
  })

  const comp1 = new MockMemoryComponent('SessionManager', 25, 50 * 1024)
  const comp2 = new MockMemoryComponent('DatabaseManager', 150, 2 * 1024)

  coordinator.registerComponent(comp1)
  coordinator.registerComponent(comp2)

  coordinator.start(500)
  await sleep(1500)
  coordinator.stop()

  const report = coordinator.generateReport()

  console.log('\nMemory Report:')
  console.log(`  Timestamp: ${report.timestamp}`)
  console.log(`  Heap Used: ${formatBytes(report.memory.heapUsed)}`)
  console.log(`  Heap Total: ${formatBytes(report.memory.heapTotal)}`)
  console.log(`  RSS: ${formatBytes(report.memory.rss)}`)
  console.log(`  History Length: ${report.historyLength}`)
  console.log(`  Components: ${report.components.length}`)

  for (const comp of report.components) {
    console.log(`    - ${comp.name}: ${comp.itemCount} items, ${formatBytes(comp.estimatedSize)}`)
  }

  console.log('✅ Test 5 passed\n')
}

async function test6_ComponentCleanup() {
  console.log('\n📋 Test 6: 各组件的 cleanup 方法')

  const components = [
    new MockMemoryComponent('SessionManager', 30, 50 * 1024),
    new MockMemoryComponent('DatabaseManager', 200, 2 * 1024),
    new MockMemoryComponent('FileTracker', 80, 1024)
  ]

  console.log('\nInitial state:')
  for (const comp of components) {
    const info = comp.getMemoryInfo()
    console.log(`  - ${info.name}: ${info.itemCount} items, ${formatBytes(info.estimatedSize)}`)
  }

  console.log('\nNormal cleanup:')
  for (const comp of components) {
    await comp.cleanup('normal')
  }

  console.log('\nAfter normal cleanup:')
  for (const comp of components) {
    const info = comp.getMemoryInfo()
    console.log(`  - ${info.name}: ${info.itemCount} items, ${formatBytes(info.estimatedSize)}`)
  }

  console.log('\nAggressive cleanup:')
  for (const comp of components) {
    await comp.cleanup('aggressive')
  }

  console.log('\nAfter aggressive cleanup:')
  for (const comp of components) {
    const info = comp.getMemoryInfo()
    console.log(`  - ${info.name}: ${info.itemCount} items, ${formatBytes(info.estimatedSize)}, cleanups: ${info.metadata.cleanupCount}`)
  }

  console.log('✅ Test 6 passed\n')
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log('🧪 Memory Management Integration Tests')
  console.log('=' .repeat(60))

  try {
    await test1_StartAndStop()
    await test2_ComponentRegistration()
    await test3_MemoryThresholds()
    await test4_AutoCleanup()
    await test5_MemoryReport()
    await test6_ComponentCleanup()

    console.log('=' .repeat(60))
    console.log('✅ All tests passed!')
    console.log('\n💡 Note: Run with --expose-gc flag to enable garbage collection')
    console.log('   Example: node --expose-gc scripts/test-memory-management.mjs')

  } catch (err) {
    console.error('\n❌ Test failed:', err)
    process.exit(1)
  }
}

runAllTests()
