import { describe, expect, it } from 'vitest'
import {
  buildProjectMemorySuggestionPrompt,
  buildProjectMemorySuggestions,
  filterProjectMemoryForPlaybook,
  formatProjectMemorySuggestionsForMarkdown,
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
