/**
 * 知识中心统一类型定义
 * 整合项目知识库、跨会话记忆、工作记忆
 * 按 范围×生命周期 矩阵组织
 *
 * 维度定义:
 * - Scope: 'project' | 'global' - 范围（项目级 vs 全局级）
 * - Lifecycle: 'persistent' | 'temporary' - 生命周期（持久 vs 临时）
 *
 * 矩阵映射:
 * |                | 持久 (persistent)     | 临时 (temporary)      |
 * |----------------|----------------------|----------------------|
 * | 项目 (project) | 项目知识库            | 工作记忆              |
 * | 全局 (global)  | 跨会话记忆            | 当前上下文            |
 */

// ==================== 基础枚举 ====================

export type KnowledgeScope = 'project' | 'global'
export type KnowledgeLifecycle = 'persistent' | 'temporary'

/**
 * 知识类型 - 基于范围×生命周期的四象限
 */
export type UnifiedKnowledgeType =
  | 'project-knowledge'      // 项目级 + 持久 = 原项目知识库
  | 'cross-session-memory'   // 全局级 + 持久 = 原跨会话记忆
  | 'working-memory'         // 项目级 + 临时 = 原工作记忆
  | 'session-context'        // 全局级 + 临时 = 当前会话上下文

/**
 * 知识分类（通用）
 */
export type UnifiedKnowledgeCategory =
  | 'architecture'   // 架构设计
  | 'tech-stack'     // 技术栈
  | 'convention'     // 规范约定
  | 'api'            // API 接口
  | 'decision'       // 决策记录
  | 'summary'        // 会话摘要
  | 'context'        // 上下文信息
  | 'task'           // 任务相关
  | 'custom'         // 自定义

/**
 * 优先级
 */
export type UnifiedPriority = 'high' | 'medium' | 'low'

/**
 * 来源
 */
export type UnifiedSource = 'manual' | 'auto-extract' | 'ai-generated' | 'session-summary'

// ==================== 统一知识条目 ====================

/**
 * 统一知识条目接口
 * 所有知识类型的通用基础结构
 */
export interface UnifiedKnowledgeEntry {
  id: string
  type: UnifiedKnowledgeType

  // 范围与生命周期
  scope: KnowledgeScope
  lifecycle: KnowledgeLifecycle

  // 关联信息
  projectPath?: string      // 项目级知识关联的项目路径
  sessionId?: string        // 关联的会话ID（临时知识必须）

  // 内容
  category: UnifiedKnowledgeCategory
  title: string
  content: string
  tags: string[]

  // 元数据
  priority: UnifiedPriority
  autoInject: boolean       // 是否自动注入
  source: UnifiedSource

  // 统计
  viewCount?: number        // 查看次数
  useCount?: number         // 使用次数（注入次数）
  lastUsedAt?: string       // 最后使用时间

  // 时间戳
  createdAt: string
  updatedAt: string

  // 扩展字段（各类型特有数据序列化存储）
  metadata?: Record<string, any>
}

/**
 * 创建知识条目参数
 */
export interface CreateUnifiedKnowledgeParams {
  type: UnifiedKnowledgeType
  scope: KnowledgeScope
  lifecycle: KnowledgeLifecycle
  projectPath?: string
  sessionId?: string
  category: UnifiedKnowledgeCategory
  title: string
  content: string
  tags?: string[]
  priority?: UnifiedPriority
  autoInject?: boolean
  source?: UnifiedSource
  metadata?: Record<string, any>
}

/**
 * 更新知识条目参数
 */
export interface UpdateUnifiedKnowledgeParams {
  category?: UnifiedKnowledgeCategory
  title?: string
  content?: string
  tags?: string[]
  priority?: UnifiedPriority
  autoInject?: boolean
  metadata?: Record<string, any>
}

// ==================== 查询与过滤 ====================

/**
 * 统一查询选项
 */
export interface UnifiedKnowledgeQuery {
  // 基础过滤
  type?: UnifiedKnowledgeType | UnifiedKnowledgeType[]
  scope?: KnowledgeScope
  lifecycle?: KnowledgeLifecycle
  projectPath?: string
  sessionId?: string

  // 内容过滤
  category?: UnifiedKnowledgeCategory | UnifiedKnowledgeCategory[]
  tags?: string[]
  searchQuery?: string          // 全文搜索关键词

  // 状态过滤
  autoInject?: boolean
  priority?: UnifiedPriority | UnifiedPriority[]

  // 时间范围
  createdAfter?: string
  createdBefore?: string

  // 分页
  page?: number
  pageSize?: number

  // 排序
  sortBy?: 'createdAt' | 'updatedAt' | 'priority' | 'useCount' | 'relevance'
  sortOrder?: 'asc' | 'desc'
}

/**
 * 查询结果
 */
export interface UnifiedKnowledgeResult {
  entries: UnifiedKnowledgeEntry[]
  total: number
  hasMore: boolean
  page: number
  pageSize: number
}

// ==================== 视图与展示 ====================

/**
 * 知识中心 Tab 定义
 */
export interface KnowledgeCenterTab {
  id: UnifiedKnowledgeType | 'all'
  label: string
  icon: string               // Lucide icon name
  description: string
  scope: KnowledgeScope
  lifecycle: KnowledgeLifecycle
  color: string              // Tailwind color class
}

/**
 * 预定义的 Tabs
 */
export const KNOWLEDGE_CENTER_TABS: KnowledgeCenterTab[] = [
  {
    id: 'project-knowledge',
    label: '项目知识库',
    icon: 'BookMarked',
    description: '持久化的项目级知识，自动注入新会话',
    scope: 'project',
    lifecycle: 'persistent',
    color: 'text-accent-purple'
  },
  {
    id: 'cross-session-memory',
    label: '跨会话记忆',
    icon: 'Brain',
    description: '全局历史会话摘要，智能检索复用',
    scope: 'global',
    lifecycle: 'persistent',
    color: 'text-accent-blue'
  },
  {
    id: 'working-memory',
    label: '工作记忆',
    icon: 'Cpu',
    description: '当前项目的临时工作上下文',
    scope: 'project',
    lifecycle: 'temporary',
    color: 'text-accent-green'
  }
]

// ==================== 注入与使用 ====================

/**
 * 知识注入配置
 */
export interface KnowledgeInjectionConfig {
  // 各类型最大注入长度（字符数）
  maxProjectKnowledgeLength: number
  maxCrossSessionMemoryLength: number
  maxWorkingContextLength: number

  // 优先级阈值
  minPriorityToInject: UnifiedPriority

  // 智能去重
  enableDeduplication: boolean
  deduplicationThreshold: number  // 相似度阈值 0-1

  // 动态调整
  adaptiveLength: boolean         // 根据上下文窗口动态调整
}

/**
 * 知识注入结果
 */
export interface KnowledgeInjectionResult {
  prompt: string
  injectedEntries: {
    type: UnifiedKnowledgeType
    id: string
    title: string
    priority: UnifiedPriority
  }[]
  totalLength: number
  truncated: boolean
}

/**
 * 知识使用统计
 */
export interface KnowledgeUsageStats {
  type: UnifiedKnowledgeType
  totalEntries: number
  autoInjectCount: number
  avgUsageCount: number
  lastAccessedAt: string
}

// ==================== 导入/导出 ====================

/**
 * 统一导入导出格式
 */
export interface UnifiedKnowledgeExport {
  version: string
  exportedAt: string
  projectPath?: string
  entries: UnifiedKnowledgeEntry[]
  stats: {
    total: number
    byType: Record<UnifiedKnowledgeType, number>
    byCategory: Record<UnifiedKnowledgeCategory, number>
  }
}

// ==================== 兼容类型（用于迁移） ====================

/**
 * 原 KnowledgeEntry 兼容映射
 */
export interface LegacyKnowledgeEntry {
  id: string
  projectPath: string
  category: 'architecture' | 'tech-stack' | 'convention' | 'api' | 'decision' | 'custom'
  title: string
  content: string
  tags: string[]
  priority: 'high' | 'medium' | 'low'
  autoInject: boolean
  source: 'manual' | 'auto-extract' | 'ai-generated'
  createdAt: string
  updatedAt: string
}

/**
 * 原 MemoryEntry 兼容映射
 */
export interface LegacyMemoryEntry {
  id: string
  sessionId: string
  sessionName: string
  summary: string
  keyPoints: string
  keywords: string
  createdAt: string
  relevanceScore?: number
}

/**
 * 原 WorkingContext 兼容映射
 */
export interface LegacyWorkingContext {
  sessionId: string
  currentTask: string
  problems: Array<{
    id: string
    content: string
    createdAt: string
    resolved?: boolean
    resolvedAt?: string
  }>
  decisions: Array<{
    id: string
    content: string
    createdAt: string
  }>
  todos: Array<{
    id: string
    content: string
    createdAt: string
    resolved?: boolean
    resolvedAt?: string
  }>
  codeSnippets: Array<{
    id: string
    description: string
    code: string
    language?: string
    createdAt: string
  }>
  autoExtractedPoints: string[]
  updatedAt: string
}
