/**
 * 知识卡片通用组件
 * 用于所有知识类型的统一展示
 */
import { useState } from 'react'
import {
  ChevronDown, ChevronRight, Edit3, Trash2, Zap,
  BookMarked, Brain, Cpu, Clock, FileText, Bot, User
} from 'lucide-react'
import type { UnifiedKnowledgeEntry, UnifiedKnowledgeType } from '../../../shared/knowledgeCenterTypes'

// 分类配置
export const CATEGORY_CONFIG = [
  { value: 'architecture', label: '架构', color: 'text-accent-blue', bg: 'bg-accent-blue/10' },
  { value: 'tech-stack', label: '技术栈', color: 'text-accent-green', bg: 'bg-accent-green/10' },
  { value: 'convention', label: '规范', color: 'text-accent-yellow', bg: 'bg-accent-yellow/10' },
  { value: 'api', label: 'API', color: 'text-accent-purple', bg: 'bg-accent-purple/10' },
  { value: 'decision', label: '决策', color: 'text-accent-red', bg: 'bg-accent-red/10' },
  { value: 'summary', label: '摘要', color: 'text-accent-cyan', bg: 'bg-accent-cyan/10' },
  { value: 'context', label: '上下文', color: 'text-accent-orange', bg: 'bg-accent-orange/10' },
  { value: 'task', label: '任务', color: 'text-accent-pink', bg: 'bg-accent-pink/10' },
  { value: 'custom', label: '自定义', color: 'text-text-secondary', bg: 'bg-bg-tertiary' },
]

// 优先级配置
export const PRIORITY_CONFIG = [
  { value: 'high', label: '高', color: 'text-accent-red', bg: 'bg-accent-red/10' },
  { value: 'medium', label: '中', color: 'text-accent-yellow', bg: 'bg-accent-yellow/10' },
  { value: 'low', label: '低', color: 'text-text-muted', bg: 'bg-bg-tertiary' },
]

// 来源图标映射
export const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'manual': User,
  'auto-extract': FileText,
  'ai-generated': Bot,
  'session-summary': Brain,
}

// 类型图标映射
export const TYPE_ICONS: Record<UnifiedKnowledgeType, React.ComponentType<{ className?: string }>> = {
  'project-knowledge': BookMarked,
  'cross-session-memory': Brain,
  'working-memory': Cpu,
  'session-context': Clock,
}

// 类型标签映射
export const TYPE_LABELS: Record<UnifiedKnowledgeType, string> = {
  'project-knowledge': '项目知识',
  'cross-session-memory': '跨会话记忆',
  'working-memory': '工作记忆',
  'session-context': '会话上下文',
}

/**
 * 来源图标组件
 */
export function SourceIcon({ source, className = '' }: { source: string; className?: string }) {
  const Icon = SOURCE_ICONS[source] || FileText
  const labels: Record<string, string> = {
    'manual': '手动创建',
    'auto-extract': '自动提取',
    'ai-generated': 'AI 生成',
    'session-summary': '会话摘要'
  }
  return (
    <span className={`flex items-center gap-0.5 text-[9px] text-text-muted ${className}`} title={labels[source] || source}>
      <Icon className="w-2.5 h-2.5" />
    </span>
  )
}

/**
 * 类型图标组件
 */
export function TypeIcon({ type, className = '' }: { type: UnifiedKnowledgeType; className?: string }) {
  const Icon = TYPE_ICONS[type] || BookMarked
  const labels = TYPE_LABELS
  const colors: Record<UnifiedKnowledgeType, string> = {
    'project-knowledge': 'text-accent-purple',
    'cross-session-memory': 'text-accent-blue',
    'working-memory': 'text-accent-green',
    'session-context': 'text-accent-yellow',
  }
  return (
    <span className={`flex items-center gap-0.5 ${colors[type]} ${className}`} title={labels[type]}>
      <Icon className="w-3 h-3" />
    </span>
  )
}

/**
 * 分类标签组件
 */
export function CategoryBadge({ category }: { category: string }) {
  const config = CATEGORY_CONFIG.find(c => c.value === category)
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded ${config?.color || 'text-text-muted'} ${config?.bg || 'bg-bg-tertiary'}`}>
      {config?.label || category}
    </span>
  )
}

/**
 * 优先级标签组件
 */
export function PriorityBadge({ priority }: { priority: string }) {
  const config = PRIORITY_CONFIG.find(p => p.value === priority)
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded ${config?.color || 'text-text-muted'}`}>
      {config?.label || priority}
    </span>
  )
}

interface KnowledgeCardProps {
  entry: UnifiedKnowledgeEntry
  onEdit?: () => void
  onDelete?: () => void
  onToggleInject?: (autoInject: boolean) => void
  selected?: boolean
  onToggleSelect?: () => void
  batchMode?: boolean
  showType?: boolean      // 是否显示知识类型
  compact?: boolean       // 紧凑模式
}

/**
 * 知识卡片组件
 * 统一展示所有知识类型的条目
 */
export default function KnowledgeCard({
  entry,
  onEdit,
  onDelete,
  onToggleInject,
  selected,
  onToggleSelect,
  batchMode = false,
  showType = false,
  compact = false
}: KnowledgeCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cat = CATEGORY_CONFIG.find(c => c.value === entry.category)
  const pri = PRIORITY_CONFIG.find(p => p.value === entry.priority)

  return (
    <div className={`px-3 py-2.5 hover:bg-bg-hover transition-colors group ${compact ? 'py-1.5' : ''}`}>
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-1.5 min-w-0">
          {/* 批量选择框 */}
          {batchMode && onToggleSelect && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggleSelect}
              onClick={e => e.stopPropagation()}
              className="w-3 h-3 accent-accent-blue shrink-0"
            />
          )}

          {/* 展开箭头 */}
          {expanded
            ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
            : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
          }

          {/* 类型图标（可选） */}
          {showType && <TypeIcon type={entry.type} />}

          {/* 分类标签 */}
          <CategoryBadge category={entry.category} />

          {/* 标题 */}
          <span className={`text-text-primary truncate ${compact ? 'text-[11px]' : 'text-xs'}`}>
            {entry.title}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* 自动注入标记 */}
          {entry.autoInject && <Zap className="w-3 h-3 text-accent-blue" aria-label="自动注入" />}

          {/* 来源图标 */}
          <SourceIcon source={entry.source} />

          {/* 操作按钮 */}
          {!batchMode && onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit() }}
              className="p-0.5 text-text-muted hover:text-accent-blue opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
            >
              <Edit3 className="w-3 h-3" />
            </button>
          )}
          {!batchMode && onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-0.5 text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className="mt-2 ml-5 space-y-2">
          {/* 内容 */}
          <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
            {entry.content}
          </div>

          {/* 标签 */}
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((tag, i) => (
                <span key={i} className="text-[9px] px-1 py-0.5 bg-bg-tertiary rounded text-text-muted">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 元数据 */}
          <div className="flex items-center justify-between text-[9px] text-text-muted">
            <div className="flex items-center gap-2">
              <SourceIcon source={entry.source} />
              <span>优先级: <span className={pri?.color}>{pri?.label}</span></span>
              {entry.useCount !== undefined && entry.useCount > 0 && (
                <span>使用: {entry.useCount} 次</span>
              )}
              {entry.metadata?.sessionName && (
                <span>会话: {entry.metadata.sessionName}</span>
              )}
            </div>

            {/* 自动注入开关 */}
            {onToggleInject && (
              <label className="flex items-center gap-1 cursor-pointer" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={entry.autoInject}
                  onChange={e => onToggleInject(e.target.checked)}
                  className="w-2.5 h-2.5 accent-accent-blue"
                />
                自动注入
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
