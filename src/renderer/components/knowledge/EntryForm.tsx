/**
 * 知识条目编辑表单组件
 * 用于新增/编辑所有类型的知识条目
 */
import { useState } from 'react'
import type {
  UnifiedKnowledgeType,
  UnifiedKnowledgeCategory,
  UnifiedPriority,
  CreateUnifiedKnowledgeParams
} from '../../../shared/knowledgeCenterTypes'
import { CATEGORY_CONFIG, PRIORITY_CONFIG } from './KnowledgeCard'

// 类型选项
const TYPE_OPTIONS: { value: UnifiedKnowledgeType; label: string; disabled?: boolean }[] = [
  { value: 'project-knowledge', label: '项目知识库' },
  { value: 'cross-session-memory', label: '跨会话记忆', disabled: true }, // 通常由系统自动创建
  { value: 'working-memory', label: '工作记忆', disabled: true },         // 通常由系统自动创建
  { value: 'session-context', label: '会话上下文', disabled: true },      // 通常由系统自动创建
]

interface EntryFormProps {
  initial: Partial<CreateUnifiedKnowledgeParams> | null
  projectPath?: string
  sessionId?: string
  onSave: (params: CreateUnifiedKnowledgeParams) => void
  onCancel: () => void
  compact?: boolean
}

/**
 * 知识条目编辑表单
 */
export default function EntryForm({
  initial,
  projectPath,
  sessionId,
  onSave,
  onCancel,
  compact = false
}: EntryFormProps) {
  // 表单状态
  const [title, setTitle] = useState(initial?.title || '')
  const [content, setContent] = useState(initial?.content || '')
  const [type, setType] = useState<UnifiedKnowledgeType>(initial?.type || 'project-knowledge')
  const [category, setCategory] = useState<UnifiedKnowledgeCategory>(initial?.category || 'custom')
  const [priority, setPriority] = useState<UnifiedPriority>(initial?.priority || 'medium')
  const [autoInject, setAutoInject] = useState(initial?.autoInject !== undefined ? initial.autoInject : true)
  const [tags, setTags] = useState(initial?.tags?.join(', ') || '')

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return

    const params: CreateUnifiedKnowledgeParams = {
      type,
      scope: type === 'project-knowledge' || type === 'working-memory' ? 'project' : 'global',
      lifecycle: type === 'project-knowledge' || type === 'cross-session-memory' ? 'persistent' : 'temporary',
      projectPath: type === 'project-knowledge' ? (projectPath || initial?.projectPath || '') : undefined,
      sessionId: type === 'working-memory' || type === 'session-context' ? (sessionId || initial?.sessionId) : undefined,
      category,
      title: title.trim(),
      content: content.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      priority,
      autoInject,
      source: initial?.source || 'manual',
      metadata: initial?.metadata
    }

    onSave(params)
  }

  return (
    <div className={`px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2 ${compact ? 'space-y-1.5' : ''}`}>
      {/* 类型选择（仅新建时显示） */}
      {!initial && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-text-muted mr-1">类型:</span>
          {TYPE_OPTIONS.map(t => (
            <button
              key={t.value}
              onClick={() => !t.disabled && setType(t.value)}
              disabled={t.disabled}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                type === t.value
                  ? 'text-accent-blue bg-accent-blue/10'
                  : t.disabled
                    ? 'text-text-muted/50 cursor-not-allowed'
                    : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* 分类 + 优先级 */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-text-muted mr-1">分类:</span>
        {CATEGORY_CONFIG.map(c => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value as UnifiedKnowledgeCategory)}
            className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
              category === c.value
                ? `${c.color} ${c.bg}`
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {c.label}
          </button>
        ))}
        <span className="mx-1 text-border">|</span>
        <span className="text-[10px] text-text-muted mr-1">优先级:</span>
        {PRIORITY_CONFIG.map(p => (
          <button
            key={p.value}
            onClick={() => setPriority(p.value as UnifiedPriority)}
            className={`px-1.5 py-0.5 rounded text-[10px] ${
              priority === p.value ? p.color : 'text-text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 标题 */}
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="知识标题..."
        className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue"
      />

      {/* 内容 */}
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="知识内容..."
        className={`w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary resize-y focus:outline-none focus:border-accent-blue ${
          compact ? 'min-h-[50px]' : 'min-h-[60px]'
        }`}
      />

      {/* 标签 */}
      <input
        value={tags}
        onChange={e => setTags(e.target.value)}
        placeholder="标签，用逗号分隔..."
        className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue"
      />

      {/* 自动注入 + 操作按钮 */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={autoInject}
            onChange={e => setAutoInject(e.target.checked)}
            className="w-3 h-3 accent-accent-blue"
          />
          自动注入新会话
        </label>
        <div className="flex gap-1">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-text-muted hover:text-text-primary"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !content.trim()}
            className="px-2 py-1 bg-accent-blue/15 text-accent-blue rounded text-xs hover:bg-accent-blue/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
