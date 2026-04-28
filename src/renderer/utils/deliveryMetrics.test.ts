import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDeliveryMetricActionPrompt,
  configureDeliveryMetricStorageAdapter,
  consumePendingDeliveryMetricAction,
  formatMetricAge,
  getDeliveryMetricActionItems,
  getDeliveryMetricFreshness,
  loadDeliveryMetricActionLifecycles,
  loadDeliveryMetricSnapshots,
  markDeliveryMetricActionSent,
  queueDeliveryMetricAction,
  recordDeliveryMetricSnapshot,
  summarizeDeliveryMetricActionLifecycles,
  summarizeDeliveryMetrics,
  type DeliveryMetricActionItem,
  type DeliveryMetricSnapshotRecord,
} from './deliveryMetrics'

function metric(overrides: Partial<DeliveryMetricSnapshotRecord> = {}): DeliveryMetricSnapshotRecord {
  return {
    sessionId: 'session-a',
    projectName: 'PrismOps',
    projectPath: 'E:/repo',
    updatedAt: '2026-04-28T10:00:00.000Z',
    score: 80,
    deliveryPackGenerated: false,
    changedFileCount: 1,
    validationCount: 1,
    projectMemoryCount: 0,
    safetyStatus: 'passed',
    statusLabel: '待输入',
    phaseLabel: '待交付',
    deliveryReadiness: '可整理交付包',
    messageCount: 3,
    toolCount: 2,
    ...overrides,
  }
}

function installWindowStorageMock() {
  const storage = new Map<string, string>()
  const events: string[] = []

  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      removeItem: (key: string) => {
        storage.delete(key)
      },
    },
    dispatchEvent: (event: Event) => {
      events.push(event.type)
      return true
    },
  })

  return { storage, events }
}

afterEach(() => {
  configureDeliveryMetricStorageAdapter(null)
  vi.unstubAllGlobals()
})

describe('delivery metrics summary', () => {
  it('summarizes only meaningful sessions and code-changing validation coverage', () => {
    const summary = summarizeDeliveryMetrics([
      metric({
        sessionId: 'ignored-empty',
        messageCount: 0,
        toolCount: 0,
        score: 100,
        deliveryPackGenerated: true,
      }),
      metric({
        sessionId: 'verified',
        score: 90,
        deliveryPackGenerated: true,
        validationCount: 2,
        verifiedHandoffMinutes: 12,
        projectMemoryCount: 1,
      }),
      metric({
        sessionId: 'needs-validation',
        score: 50,
        deliveryPackGenerated: false,
        validationCount: 0,
        verifiedHandoffMinutes: undefined,
        projectMemoryCount: 0,
        safetyStatus: 'blocked',
      }),
      metric({
        sessionId: 'analysis-only',
        score: 70,
        changedFileCount: 0,
        validationCount: 0,
        deliveryPackGenerated: false,
        projectPath: undefined,
        safetyStatus: 'warning',
      }),
    ])

    expect(summary).toEqual({
      sessionCount: 3,
      averageScore: 70,
      deliveryPackRate: 33,
      validationCoverageRate: 50,
      safeSessionRate: 33,
      averageHandoffMinutes: 12,
      projectMemoryCount: 1,
      blockedCount: 1,
    })
  })
})

describe('delivery metric storage adapter', () => {
  it('loads legacy metric arrays and saves a versioned storage envelope', () => {
    const { storage, events } = installWindowStorageMock()
    storage.set('prismops-delivery-metrics-v1', JSON.stringify([
      metric({ sessionId: 'legacy', updatedAt: '2026-04-27T10:00:00.000Z' }),
    ]))

    expect(loadDeliveryMetricSnapshots().map(record => record.sessionId)).toEqual(['legacy'])

    recordDeliveryMetricSnapshot(metric({ sessionId: 'current', updatedAt: '2026-04-28T10:00:00.000Z' }))

    const stored = JSON.parse(storage.get('prismops-delivery-metrics-v1') || '{}')

    expect(stored).toMatchObject({
      schema: 'prismops.delivery-metrics',
      version: 1,
    })
    expect(stored.data.map((record: DeliveryMetricSnapshotRecord) => record.sessionId)).toEqual(['current', 'legacy'])
    expect(events).toContain('prismops-delivery-metrics-updated')
  })

  it('can run through an injected storage adapter without window storage', () => {
    const storage = new Map<string, string>()
    configureDeliveryMetricStorageAdapter({
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value)
      },
    })

    recordDeliveryMetricSnapshot(metric({ sessionId: 'adapter-backed' }))

    expect(loadDeliveryMetricSnapshots().map(record => record.sessionId)).toEqual(['adapter-backed'])
    expect(JSON.parse(storage.get('prismops-delivery-metrics-v1') || '{}').schema).toBe('prismops.delivery-metrics')
  })
})

describe('delivery metric freshness', () => {
  const nowMs = new Date('2026-04-28T12:00:00.000Z').getTime()

  it('returns an empty state when there are no meaningful metric records', () => {
    const freshness = getDeliveryMetricFreshness([
      metric({ messageCount: 0, toolCount: 0, updatedAt: '2026-04-28T11:00:00.000Z' }),
    ], nowMs)

    expect(freshness).toEqual({
      state: 'empty',
      meaningfulCount: 0,
      staleCount: 0,
    })
  })

  it('marks all-old meaningful records as stale', () => {
    const freshness = getDeliveryMetricFreshness([
      metric({ sessionId: 'old-a', updatedAt: '2026-04-27T08:00:00.000Z' }),
      metric({ sessionId: 'old-b', updatedAt: '2026-04-26T12:00:00.000Z' }),
    ], nowMs)

    expect(freshness.state).toBe('stale')
    expect(freshness.meaningfulCount).toBe(2)
    expect(freshness.staleCount).toBe(2)
    expect(freshness.latestUpdatedAt).toBe('2026-04-27T08:00:00.000Z')
    expect(freshness.ageHours).toBe(28)
  })

  it('keeps the state fresh when the latest sample is recent and reports stale samples', () => {
    const freshness = getDeliveryMetricFreshness([
      metric({ sessionId: 'recent', updatedAt: '2026-04-28T10:00:00.000Z' }),
      metric({ sessionId: 'old', updatedAt: '2026-04-26T12:00:00.000Z' }),
    ], nowMs)

    expect(freshness.state).toBe('fresh')
    expect(freshness.meaningfulCount).toBe(2)
    expect(freshness.staleCount).toBe(1)
    expect(freshness.latestUpdatedAt).toBe('2026-04-28T10:00:00.000Z')
    expect(formatMetricAge(freshness.ageHours)).toBe('2h')
  })
})

describe('delivery metric action queue ranking', () => {
  it('ranks blocked and missing-validation sessions before lower-priority improvements', () => {
    const items = getDeliveryMetricActionItems([
      metric({
        sessionId: 'memory',
        projectName: 'Memory candidate',
        score: 86,
        deliveryPackGenerated: true,
        projectMemoryCount: 0,
      }),
      metric({
        sessionId: 'blocked',
        projectName: 'Blocked candidate',
        score: 72,
        safetyStatus: 'blocked',
      }),
      metric({
        sessionId: 'missing-validation',
        projectName: 'Validation candidate',
        score: 64,
        changedFileCount: 2,
        validationCount: 0,
      }),
      metric({
        sessionId: 'stale-validation',
        projectName: 'Stale candidate',
        score: 76,
        validationStale: true,
        deliveryPackGenerated: true,
      }),
    ], 4)

    expect(items.map(item => item.sessionId)).toEqual([
      'missing-validation',
      'blocked',
      'stale-validation',
      'memory',
    ])
    expect(items[0].priority).toBe('high')
    expect(items[0].reason).toContain('缺少验证')
    expect(items[2].reason).toContain('验证已过期')
  })

  it('builds a remediation prompt with the selected gap and action', () => {
    const item: DeliveryMetricActionItem = {
      sessionId: 'session-a',
      projectName: 'PrismOps',
      score: 64,
      reason: '缺少验证',
      detail: '已有改动，建议验证',
      suggestedAction: '运行 typecheck、build 或相关测试',
      priority: 'high',
      updatedAt: '2026-04-28T10:00:00.000Z',
    }

    const prompt = buildDeliveryMetricActionPrompt(item)

    expect(prompt).toContain('缺少验证')
    expect(prompt).toContain('运行 typecheck、build 或相关测试')
    expect(prompt).toContain('完成后给出验证结果')
  })

  it('queues one pending remediation action per session and consumes it once', () => {
    const { events } = installWindowStorageMock()
    const first = getDeliveryMetricActionItems([
      metric({ sessionId: 'session-a', validationCount: 0 }),
    ])[0]
    const second = {
      ...first,
      reason: '缺交付包',
      suggestedAction: '生成 Markdown 交付包',
    }

    queueDeliveryMetricAction(first)
    queueDeliveryMetricAction(second)

    const consumed = consumePendingDeliveryMetricAction('session-a')

    expect(consumed?.reason).toBe('缺交付包')
    expect(consumed?.prompt).toContain('生成 Markdown 交付包')
    expect(consumePendingDeliveryMetricAction('session-a')).toBeNull()
    expect(events).toContain('prismops-delivery-action-queued')
  })

  it('tracks queued and inserted lifecycle without duplicating repeated clicks', () => {
    const { storage } = installWindowStorageMock()
    const item = getDeliveryMetricActionItems([
      metric({ sessionId: 'session-a', validationCount: 0 }),
    ])[0]

    queueDeliveryMetricAction(item)
    queueDeliveryMetricAction(item)

    const queuedRecords = loadDeliveryMetricActionLifecycles()

    expect(queuedRecords).toHaveLength(1)
    expect(queuedRecords[0].status).toBe('queued')
    expect(queuedRecords[0].clickCount).toBe(2)
    expect(JSON.parse(storage.get('prismops-delivery-actions-v1') || '{}')).toMatchObject({
      schema: 'prismops.delivery-metrics',
      version: 1,
    })
    expect(JSON.parse(storage.get('prismops-delivery-action-lifecycle-v1') || '{}')).toMatchObject({
      schema: 'prismops.delivery-metrics',
      version: 1,
    })

    const consumed = consumePendingDeliveryMetricAction('session-a')
    const insertedRecords = loadDeliveryMetricActionLifecycles()

    expect(consumed?.actionId).toBe(queuedRecords[0].id)
    expect(insertedRecords[0].status).toBe('inserted')
    expect(insertedRecords[0].insertedAt).toBeTruthy()
    expect(summarizeDeliveryMetricActionLifecycles(insertedRecords)).toMatchObject({
      inserted: 1,
      active: 1,
    })
  })

  it('marks sent actions as completed after a resolving metric snapshot', () => {
    installWindowStorageMock()
    const item = getDeliveryMetricActionItems([
      metric({
        sessionId: 'session-a',
        score: 62,
        validationCount: 0,
        deliveryPackGenerated: false,
      }),
    ])[0]

    queueDeliveryMetricAction(item)
    const consumed = consumePendingDeliveryMetricAction('session-a')
    markDeliveryMetricActionSent(consumed?.actionId)

    expect(loadDeliveryMetricActionLifecycles()[0].status).toBe('sent')

    recordDeliveryMetricSnapshot(metric({
      sessionId: 'session-a',
      score: 92,
      deliveryPackGenerated: true,
      validationCount: 2,
      projectMemoryCount: 1,
      safetyStatus: 'passed',
    }))

    const summary = summarizeDeliveryMetricActionLifecycles(loadDeliveryMetricActionLifecycles())

    expect(summary.completed).toBe(1)
    expect(summary.active).toBe(0)
    expect(loadDeliveryMetricActionLifecycles()[0].completedAt).toBe('2026-04-28T10:00:00.000Z')
  })
})
