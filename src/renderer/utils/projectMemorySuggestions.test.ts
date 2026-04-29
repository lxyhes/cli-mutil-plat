import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildProjectMemorySuggestionKnowledgeParams,
  buildProjectMemorySuggestionPrompt,
  buildProjectMemorySuggestions,
  filterProjectMemoryForPlaybook,
  findStaleProjectMemoryCandidates,
  formatProjectMemorySuggestionsForMarkdown,
  loadProjectMemoryTelemetryEvents,
  recordProjectMemoryTelemetryEvent,
  summarizeProjectMemoryTelemetryHistory,
  summarizeProjectMemoryTelemetry,
  type ProjectMemorySuggestionInput,
} from './projectMemorySuggestions'

function input(overrides: Partial<ProjectMemorySuggestionInput> = {}): ProjectMemorySuggestionInput {
  return {
    projectName: 'spectrai-community',
    projectPath: 'E:/repo',
    goal: '继续完成核心竞争力增强计划',
    phaseLabel: '验证',
    deliveryReadiness: '已有改动和验证，可生成交付包',
    lastCommand: 'npm run typecheck',
    risks: ['验证已过期，需要重新运行最小必要验证'],
    evidence: ['验证命令：npm run typecheck'],
    evidenceTimeline: [
      {
        type: 'change',
        label: '文件改动',
        detail: '更新 Dashboard 和指标工具',
        timestamp: '2026-04-28T10:00:00.000Z',
      },
      {
        type: 'validation',
        label: '验证命令',
        detail: 'npm run typecheck',
        timestamp: '2026-04-28T10:05:00.000Z',
      },
    ],
    lastFiles: ['deliveryMetrics.ts', 'DashboardView.tsx'],
    validationCount: 2,
    changedFileCount: 2,
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
  vi.unstubAllGlobals()
})

describe('project memory suggestions', () => {
  it('builds categorized suggestions with source references and confidence', () => {
    const suggestions = buildProjectMemorySuggestions(input())

    expect(suggestions.map(item => item.type)).toEqual([
      'command',
      'validation',
      'risk',
      'decision',
      'architecture',
    ])
    expect(suggestions[0]).toMatchObject({
      knowledgeCategory: 'convention',
      priority: 'high',
      sourceReference: '证据时间线 2026-04-28T10:05:00.000Z',
    })
    expect(suggestions.every(item => item.confidence > 0 && item.confidence <= 1)).toBe(true)
  })

  it('formats suggestions for Markdown delivery packs', () => {
    const markdown = formatProjectMemorySuggestionsForMarkdown(buildProjectMemorySuggestions(input(), 2))

    expect(markdown).toContain('知识分类')
    expect(markdown).toContain('置信度')
    expect(markdown).toContain('来源')
  })

  it('builds a review prompt instead of silently accepting suggested memories', () => {
    const prompt = buildProjectMemorySuggestionPrompt(input())

    expect(prompt).toContain('请审核')
    expect(prompt).toContain('拒绝')
    expect(prompt).toContain('需要人工确认')
  })

  it('promotes a reviewed suggestion into project knowledge params with audit metadata', () => {
    const [suggestion] = buildProjectMemorySuggestions(input())

    const params = buildProjectMemorySuggestionKnowledgeParams(suggestion, {
      projectPath: 'E:/repo',
      sessionId: 'session-1',
      title: 'Edited validation command',
      content: 'Run npm run typecheck before handoff.',
      status: 'edited',
      reviewedAt: '2026-04-28T10:30:00.000Z',
    })

    expect(params).toMatchObject({
      type: 'project-knowledge',
      scope: 'project',
      lifecycle: 'persistent',
      projectPath: 'E:/repo',
      sessionId: 'session-1',
      category: suggestion.knowledgeCategory,
      title: 'Edited validation command',
      content: 'Run npm run typecheck before handoff.',
      source: 'ai-generated',
      metadata: {
        source: 'project-memory-suggestion',
        suggestionId: suggestion.id,
        reviewStatus: 'edited',
        reviewedAt: '2026-04-28T10:30:00.000Z',
      },
    })
    expect(params.tags).toContain('reviewed-memory')
    expect(params.tags).toContain('edited')
  })

  it('flags stale project knowledge when fresh evidence changes the validation path', () => {
    const [suggestion] = buildProjectMemorySuggestions(input({
      lastCommand: 'npm run typecheck',
      validationCount: 1,
    }))

    const candidates = findStaleProjectMemoryCandidates([suggestion], [{
      id: 'knowledge-1',
      type: 'project-knowledge',
      category: suggestion.knowledgeCategory,
      title: 'Validation path: npm test',
      content: 'Before handoff, always run npm test.',
      tags: ['validation', 'quality-gate'],
      updatedAt: '2026-04-27T10:00:00.000Z',
    }])

    expect(candidates[0]).toMatchObject({
      entryId: 'knowledge-1',
      suggestionId: suggestion.id,
      reason: '新验证或命令路径与已有知识不同',
    })
  })

  it('records and summarizes memory telemetry events', () => {
    const { events } = installWindowStorageMock()

    recordProjectMemoryTelemetryEvent({
      sessionId: 'session-1',
      projectPath: 'E:/repo',
      kind: 'suggestion-accepted',
      suggestionId: 'memory-a',
      confidence: 0.8,
      timestamp: '2026-04-28T10:00:00.000Z',
    })
    recordProjectMemoryTelemetryEvent({
      sessionId: 'session-1',
      kind: 'suggestion-rejected',
      suggestionId: 'memory-b',
      confidence: 0.6,
      timestamp: '2026-04-28T10:01:00.000Z',
    })
    recordProjectMemoryTelemetryEvent({
      sessionId: 'session-1',
      projectPath: 'E:/repo',
      kind: 'playbook-memory-injected',
      playbookId: 'ui-polish',
      filteredLength: 900,
      suggestionCount: 2,
      timestamp: '2026-04-28T10:02:00.000Z',
    })

    const stored = loadProjectMemoryTelemetryEvents()
    const summary = summarizeProjectMemoryTelemetry(stored)

    expect(stored.map(event => event.kind)).toEqual([
      'playbook-memory-injected',
      'suggestion-rejected',
      'suggestion-accepted',
    ])
    expect(summary).toMatchObject({
      eventCount: 3,
      reviewedCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
      promotionRate: 50,
      playbookInjectionCount: 1,
      averageFilteredLength: 900,
      averageConfidence: 70,
    })
    expect(events).toContain('prismops-memory-telemetry-updated')
  })

  it('builds project history reports from memory telemetry', () => {
    const report = summarizeProjectMemoryTelemetryHistory([
      {
        id: 'event-1',
        sessionId: 'session-1',
        projectPath: 'E:/repo/alpha',
        kind: 'suggestion-accepted',
        suggestionId: 'memory-a',
        confidence: 0.9,
        timestamp: '2026-04-27T10:00:00.000Z',
      },
      {
        id: 'event-2',
        sessionId: 'session-2',
        projectPath: 'E:/repo/alpha',
        kind: 'stale-memory-updated',
        suggestionId: 'memory-b',
        timestamp: '2026-04-28T10:00:00.000Z',
      },
      {
        id: 'event-3',
        sessionId: 'session-3',
        projectPath: 'E:/repo/beta',
        kind: 'playbook-memory-injected',
        playbookId: 'bug-fix',
        filteredLength: 600,
        timestamp: '2026-04-28T11:00:00.000Z',
      },
      {
        id: 'event-old',
        sessionId: 'session-4',
        projectPath: 'E:/repo/alpha',
        kind: 'suggestion-rejected',
        timestamp: '2026-04-20T10:00:00.000Z',
      },
    ], {
      now: '2026-04-28T12:00:00.000Z',
      dayCount: 2,
      projectLimit: 2,
    })

    expect(report.total).toMatchObject({
      eventCount: 3,
      reviewedCount: 1,
      staleResolutionCount: 1,
      playbookInjectionCount: 1,
    })
    expect(report.trend.map(point => point.date)).toEqual(['2026-04-27', '2026-04-28'])
    expect(report.trend.map(point => point.eventCount)).toEqual([1, 2])
    expect(report.projects.map(project => project.projectLabel)).toEqual(['alpha', 'beta'])
    expect(report.projects[0]).toMatchObject({
      eventCount: 2,
      promotionRate: 100,
      staleResolutionCount: 1,
    })
  })

  it('filters long memory prompts toward the selected playbook', () => {
    const memoryPrompt = [
      '### UI 视觉规范\n主题、层级、交互噪音需要统一。',
      '### 发布验证路径\n发布前运行 npm run build 并检查风险。',
      '### 数据库迁移策略\n迁移要保留回滚路径。',
    ].join('\n\n')

    const filtered = filterProjectMemoryForPlaybook(memoryPrompt, {
      id: 'ui-polish',
      label: 'UI 打磨',
      description: '层级、效率、噪音、主题适配',
      evidence: ['当前体验问题'],
      validation: ['确认主题适配'],
      finalOutput: ['体验改动'],
    }, 42)

    expect(filtered).toContain('UI 视觉规范')
    expect(filtered).not.toContain('数据库迁移策略')
  })
})
