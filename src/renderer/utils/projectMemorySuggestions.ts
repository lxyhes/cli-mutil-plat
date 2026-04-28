import type { KnowledgeCategory, KnowledgePriority } from '../../shared/types'
import type { CreateUnifiedKnowledgeParams } from '../../shared/knowledgeCenterTypes'

export type ProjectMemorySuggestionType =
  | 'decision'
  | 'command'
  | 'risk'
  | 'architecture'
  | 'convention'
  | 'validation'

export interface ProjectMemoryEvidenceItem {
  type?: string
  label: string
  detail: string
  timestamp?: string
}

export interface ProjectMemorySuggestionInput {
  projectName: string
  projectPath?: string
  goal: string
  phaseLabel?: string
  deliveryReadiness: string
  lastCommand?: string
  risks: string[]
  evidence: string[]
  evidenceTimeline: ProjectMemoryEvidenceItem[]
  lastFiles: string[]
  validationCount: number
  changedFileCount: number
}

export interface ProjectMemorySuggestion {
  id: string
  type: ProjectMemorySuggestionType
  knowledgeCategory: KnowledgeCategory
  title: string
  content: string
  sourceReference: string
  confidence: number
  priority: KnowledgePriority
  tags: string[]
}

export type ProjectMemorySuggestionReviewStatus = 'accepted' | 'rejected' | 'edited'

export interface ProjectMemorySuggestionReview {
  suggestionId: string
  status: ProjectMemorySuggestionReviewStatus
  reviewedAt: string
  promotedKnowledgeId?: string
  title?: string
  content?: string
}

export interface ProjectMemorySuggestionPromotionOptions {
  projectPath: string
  sessionId?: string
  title?: string
  content?: string
  status?: Extract<ProjectMemorySuggestionReviewStatus, 'accepted' | 'edited'>
  reviewedAt?: string
}

interface PlaybookLike {
  id: string
  label: string
  description: string
  evidence: string[]
  validation: string[]
  finalOutput: string[]
}

const CATEGORY_MAP: Record<ProjectMemorySuggestionType, KnowledgeCategory> = {
  decision: 'decision',
  command: 'convention',
  risk: 'custom',
  architecture: 'architecture',
  convention: 'convention',
  validation: 'convention',
}

const TYPE_LABEL: Record<ProjectMemorySuggestionType, string> = {
  decision: '决策',
  command: '命令',
  risk: '风险',
  architecture: '架构',
  convention: '规范',
  validation: '验证',
}

const PLAYBOOK_KEYWORDS: Record<string, string[]> = {
  'bug-fix': ['bug', '错误', '失败', '异常', '根因', '回归', '风险', '验证'],
  'feature-delivery': ['功能', '需求', '验收', '交付', '用户', '验证', '决策'],
  'ui-polish': ['ui', '视觉', '交互', '主题', '层级', '体验', '噪音'],
  'code-review': ['审查', 'review', '风险', '回归', '测试', '边界', '验证'],
  migration: ['迁移', '兼容', '回滚', '切换', '策略', '验证'],
  'release-check': ['发布', '交付', '验证', '风险', '摘要', '回滚'],
}

function compact(value: string, max = 72): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function stableId(type: ProjectMemorySuggestionType, title: string): string {
  let hash = 0
  const source = `${type}:${title}`
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0
  }
  return `memory-${type}-${Math.abs(hash)}`
}

function realRisks(risks: string[]): string[] {
  return risks.filter(risk => risk && !risk.includes('暂无明显'))
}

function latestTimelineOf(input: ProjectMemorySuggestionInput, type: string): ProjectMemoryEvidenceItem | undefined {
  return [...input.evidenceTimeline].reverse().find(item => item.type === type)
}

function suggestion(
  type: ProjectMemorySuggestionType,
  title: string,
  content: string,
  sourceReference: string,
  confidence: number,
  priority: KnowledgePriority,
  tags: string[],
): ProjectMemorySuggestion {
  return {
    id: stableId(type, title),
    type,
    knowledgeCategory: CATEGORY_MAP[type],
    title,
    content,
    sourceReference,
    confidence,
    priority,
    tags: [...new Set(['delivery-memory', type, ...tags])],
  }
}

export function buildProjectMemorySuggestions(input: ProjectMemorySuggestionInput, limit = 5): ProjectMemorySuggestion[] {
  const suggestions: ProjectMemorySuggestion[] = []
  const risks = realRisks(input.risks)
  const validationTimeline = latestTimelineOf(input, 'validation')
  const changeTimeline = latestTimelineOf(input, 'change')

  if (input.goal && input.deliveryReadiness && !input.goal.includes('还没有明确目标')) {
    suggestions.push(suggestion(
      'decision',
      `决策：${compact(input.goal, 44)}`,
      [
        `任务目标：${input.goal}`,
        `当前阶段：${input.phaseLabel || '未知'}`,
        `交付判断：${input.deliveryReadiness}`,
      ].join('\n'),
      `会话目标 / ${input.projectName}`,
      0.72,
      'medium',
      ['mission', 'handoff'],
    ))
  }

  if (input.lastCommand) {
    suggestions.push(suggestion(
      'command',
      `命令：${compact(input.lastCommand, 50)}`,
      [
        `命令：${input.lastCommand}`,
        `使用场景：${input.validationCount > 0 ? '当前会话验证或检查路径' : '当前会话最近执行命令'}`,
        validationTimeline ? `相关证据：${validationTimeline.label} - ${validationTimeline.detail}` : '',
      ].filter(Boolean).join('\n'),
      validationTimeline?.timestamp ? `证据时间线 ${validationTimeline.timestamp}` : '最近命令',
      input.validationCount > 0 ? 0.86 : 0.68,
      input.validationCount > 0 ? 'high' : 'medium',
      ['command', input.validationCount > 0 ? 'validation' : 'tool'],
    ))
  }

  if (input.validationCount > 0) {
    suggestions.push(suggestion(
      'validation',
      `验证路径：${compact(input.lastCommand || validationTimeline?.label || '当前会话验证', 48)}`,
      [
        `验证命令数量：${input.validationCount}`,
        input.lastCommand ? `最近验证/检查命令：${input.lastCommand}` : '',
        `适用范围：${input.changedFileCount > 0 ? `${input.changedFileCount} 个改动文件` : '分析或配置检查'}`,
      ].filter(Boolean).join('\n'),
      validationTimeline ? `${validationTimeline.label} / ${validationTimeline.detail}` : '验证证据',
      0.84,
      'high',
      ['validation', 'quality-gate'],
    ))
  }

  if (risks.length > 0) {
    suggestions.push(suggestion(
      'risk',
      `风险：${compact(risks[0], 48)}`,
      [
        `风险描述：${risks[0]}`,
        input.evidence[0] ? `相关证据：${input.evidence[0]}` : '',
        '复用建议：后续相同项目任务中优先检查该风险是否仍存在。',
      ].filter(Boolean).join('\n'),
      '风险雷达',
      0.78,
      'high',
      ['risk', 'review'],
    ))
  }

  if (input.changedFileCount > 0 && input.lastFiles.length > 0) {
    suggestions.push(suggestion(
      'architecture',
      `改动范围：${input.projectName}`,
      [
        `最近改动文件：${input.lastFiles.join('、')}`,
        `改动文件数量：${input.changedFileCount}`,
        changeTimeline ? `来源：${changeTimeline.label} - ${changeTimeline.detail}` : '',
      ].filter(Boolean).join('\n'),
      changeTimeline?.timestamp ? `证据时间线 ${changeTimeline.timestamp}` : '最近文件改动',
      input.changedFileCount >= 3 ? 0.7 : 0.62,
      'medium',
      ['change-scope', 'architecture'],
    ))
  }

  const byId = new Map<string, ProjectMemorySuggestion>()
  for (const item of suggestions) {
    byId.set(item.id, item)
  }

  return [...byId.values()]
    .sort((a, b) => {
      const priorityScore = { high: 0, medium: 1, low: 2 }
      const priorityDelta = priorityScore[a.priority] - priorityScore[b.priority]
      if (priorityDelta !== 0) return priorityDelta
      return b.confidence - a.confidence
    })
    .slice(0, limit)
}

export function formatProjectMemorySuggestionsForMarkdown(suggestions: ProjectMemorySuggestion[], fallback = '暂无项目记忆建议'): string {
  if (suggestions.length === 0) return `- ${fallback}`
  return suggestions.map(item => [
    `- [${TYPE_LABEL[item.type]}] ${item.title}`,
    `  - 知识分类: ${item.knowledgeCategory}`,
    `  - 置信度: ${Math.round(item.confidence * 100)}%`,
    `  - 来源: ${item.sourceReference}`,
    `  - 内容: ${compact(item.content, 180)}`,
  ].join('\n')).join('\n')
}

export function buildProjectMemorySuggestionKnowledgeParams(
  suggestion: ProjectMemorySuggestion,
  options: ProjectMemorySuggestionPromotionOptions,
): CreateUnifiedKnowledgeParams {
  const title = (options.title || suggestion.title).trim()
  const content = (options.content || suggestion.content).trim()
  const reviewedAt = options.reviewedAt || new Date().toISOString()
  const reviewStatus = options.status || 'accepted'

  return {
    type: 'project-knowledge',
    scope: 'project',
    lifecycle: 'persistent',
    projectPath: options.projectPath,
    sessionId: options.sessionId,
    category: suggestion.knowledgeCategory,
    title,
    content,
    tags: [...new Set([...suggestion.tags, 'reviewed-memory', reviewStatus])],
    priority: suggestion.priority,
    autoInject: suggestion.priority === 'high',
    source: 'ai-generated',
    metadata: {
      source: 'project-memory-suggestion',
      suggestionId: suggestion.id,
      suggestionType: suggestion.type,
      sourceReference: suggestion.sourceReference,
      confidence: suggestion.confidence,
      reviewStatus,
      reviewedAt,
    },
  }
}

export function buildProjectMemorySuggestionPrompt(input: ProjectMemorySuggestionInput): string {
  const suggestions = buildProjectMemorySuggestions(input)
  return [
    '请审核下面的项目记忆建议，并把真正可复用的内容沉淀为项目知识。',
    '',
    '## 审核原则',
    '- 只保留能跨会话复用的事实、决策、命令、风险、验证路径或工程约定。',
    '- 对噪音、一次性状态或缺少证据的内容要拒绝或改写。',
    '- 每条保留的知识都要带分类、来源引用、置信度和适用场景。',
    '',
    '## 建议条目',
    formatProjectMemorySuggestionsForMarkdown(suggestions),
    '',
    '## 输出格式',
    '- 保留：标题 / 分类 / 内容 / 来源 / 置信度 / 标签',
    '- 拒绝：原因',
    '- 需要人工确认：问题',
  ].join('\n')
}

function splitMemoryChunks(memoryPrompt: string): string[] {
  return memoryPrompt
    .split(/\n(?=###|\- \[|## )|\n{2,}/)
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 0)
}

function getPlaybookKeywords(template: PlaybookLike): string[] {
  const mapped = PLAYBOOK_KEYWORDS[template.id] || []
  const text = [
    template.label,
    template.description,
    ...template.evidence,
    ...template.validation,
    ...template.finalOutput,
  ].join(' ')
  const extracted = text
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(item => item.trim().toLowerCase())
    .filter(item => item.length >= 2)
  return [...new Set([...mapped, ...extracted])]
}

export function filterProjectMemoryForPlaybook(memoryPrompt: string, template: PlaybookLike, maxLength = 1800): string {
  const text = memoryPrompt.trim()
  if (!text) return ''
  if (text.length <= maxLength) return text

  const keywords = getPlaybookKeywords(template)
  const chunks = splitMemoryChunks(text)
  const ranked = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase()
    const score = keywords.reduce((sum, keyword) => sum + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0)
    return { chunk, index, score }
  })

  const selected = ranked
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.chunk)

  const fallback = selected.length > 0 ? selected : chunks.slice(0, 4)
  const result: string[] = []
  let length = 0
  for (const chunk of fallback) {
    if (length + chunk.length + 2 > maxLength) continue
    result.push(chunk)
    length += chunk.length + 2
  }

  return result.join('\n\n') || text.slice(0, maxLength)
}
