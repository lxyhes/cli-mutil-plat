import { describe, expect, it } from 'vitest'
import { calculateEnhancedDeliveryScore } from './deliveryMetrics'

describe('calculateEnhancedDeliveryScore', () => {
  it('应该给完美交付的会话满分', () => {
    const score = calculateEnhancedDeliveryScore({
      validationCount: 3,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 2,
      messageCount: 10,
      toolCount: 8,
      validationStale: false,
    })
    expect(score).toBe(100)
  })

  it('应该给缺少验证的会话低分', () => {
    const score = calculateEnhancedDeliveryScore({
      validationCount: 0,
      changedFileCount: 5,
      deliveryPackGenerated: false,
      safetyStatus: 'warning',
      projectMemoryCount: 0,
      messageCount: 10,
      toolCount: 8,
      validationStale: false,
    })
    // 验证0分(30%) + 交付包0分(25%) + 安全60分(20%*0.6=12) + 记忆0分(15%) + 追踪100分(10%*1=10) = 22
    expect(score).toBeLessThan(30)
  })

  it('应该正确处理无改动的会话', () => {
    const score = calculateEnhancedDeliveryScore({
      validationCount: 0,
      changedFileCount: 0,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 0,
      messageCount: 3,
      toolCount: 1,
      validationStale: false,
    })
    // 无改动不需要验证，所以验证得分100
    expect(score).toBeGreaterThan(80)
  })

  it('应该惩罚过期的验证', () => {
    const score = calculateEnhancedDeliveryScore({
      validationCount: 2,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 1,
      messageCount: 10,
      toolCount: 8,
      validationStale: true,
    })
    // 验证过期只能得40分，总分约75分
    expect(score).toBeLessThan(80)
    expect(score).toBeGreaterThan(70)
  })

  it('应该惩罚阻塞的安全状态', () => {
    const score = calculateEnhancedDeliveryScore({
      validationCount: 3,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'blocked',
      projectMemoryCount: 2,
      messageCount: 10,
      toolCount: 8,
      validationStale: false,
    })
    // 安全状态0分，其他都满分: 30 + 25 + 0 + 15 + 10 = 80
    expect(score).toBe(80)
  })

  it('应该奖励项目记忆沉淀', () => {
    const scoreWithMemory = calculateEnhancedDeliveryScore({
      validationCount: 3,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 2,
      messageCount: 10,
      toolCount: 8,
      validationStale: false,
    })

    const scoreWithoutMemory = calculateEnhancedDeliveryScore({
      validationCount: 3,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 0,
      messageCount: 10,
      toolCount: 8,
      validationStale: false,
    })

    // 有记忆应该比没记忆分数高
    expect(scoreWithMemory).toBeGreaterThan(scoreWithoutMemory)
    // 差异应该是15分（记忆权重15%）
    expect(scoreWithMemory - scoreWithoutMemory).toBe(15)
  })

  it('不应该对无意义活动惩罚缺少记忆', () => {
    const score = calculateEnhancedDeliveryScore({
      validationCount: 3,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 0,
      messageCount: 2, // 少于5条消息
      toolCount: 1,    // 少于3个工具
      validationStale: false,
    })
    // 无意义活动，即使没有记忆也应该得满分
    expect(score).toBe(100)
  })

  it('应该惩罚有工具活动但无文件改动的情况', () => {
    const score = calculateEnhancedDeliveryScore({
      validationCount: 0,
      changedFileCount: 0,
      deliveryPackGenerated: false,
      safetyStatus: 'passed',
      projectMemoryCount: 0,
      messageCount: 10,
      toolCount: 5, // 有工具活动
      validationStale: false,
    })
    // 改动追踪只有40分（10%权重），其他维度也较低，总分应该在50-60之间
    expect(score).toBeLessThan(65)
    expect(score).toBeGreaterThan(45)
  })

  it('应该根据验证数量给予不同分数', () => {
    const score1 = calculateEnhancedDeliveryScore({
      validationCount: 1,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 1,
      messageCount: 10,
      toolCount: 8,
      validationStale: false,
    })

    const score3 = calculateEnhancedDeliveryScore({
      validationCount: 3,
      changedFileCount: 5,
      deliveryPackGenerated: true,
      safetyStatus: 'passed',
      projectMemoryCount: 1,
      messageCount: 10,
      toolCount: 8,
      validationStale: false,
    })

    // 3条验证应该比1条验证分数高
    expect(score3).toBeGreaterThan(score1)
  })

  it('分数应该在0-100范围内', () => {
    const testCases = [
      {
        validationCount: 0,
        changedFileCount: 0,
        deliveryPackGenerated: false,
        safetyStatus: 'blocked' as const,
        projectMemoryCount: 0,
        messageCount: 0,
        toolCount: 0,
        validationStale: false,
      },
      {
        validationCount: 10,
        changedFileCount: 20,
        deliveryPackGenerated: true,
        safetyStatus: 'passed' as const,
        projectMemoryCount: 5,
        messageCount: 50,
        toolCount: 30,
        validationStale: false,
      },
    ]

    testCases.forEach(testCase => {
      const score = calculateEnhancedDeliveryScore(testCase)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    })
  })
})
