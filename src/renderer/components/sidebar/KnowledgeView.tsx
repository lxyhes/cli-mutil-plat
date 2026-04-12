/**
 * 项目知识库面板 - 管理和浏览项目知识
 * 功能：CRUD、搜索、自动提取、编辑、优先级/来源标记、自动注入开关
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import {
  BookMarked, Plus, Search, Trash2, RefreshCw, Sparkles,
  ChevronDown, ChevronRight, Edit3, Check, X, Zap, FileText, Bot, User
} from 'lucide-react'
import { useKnowledgeStore, type KnowledgeEntry } from '../../stores/knowledgeStore'
import { useSessionStore } from '../../stores/sessionStore'

const CATEGORIES = [
  { value: 'architecture', label: '架构', color: 'text-accent-blue', bg: 'bg-accent-blue/10' },
  { value: 'tech-stack', label: '技术栈', color: 'text-accent-green', bg: 'bg-accent-green/10' },
  { value: 'convention', label: '规范', color: 'text-accent-yellow', bg: 'bg-accent-yellow/10' },
  { value: 'api', label: 'API', color: 'text-accent-purple', bg: 'bg-accent-purple/10' },
  { value: 'decision', label: '决策', color: 'text-accent-red', bg: 'bg-accent-red/10' },
  { value: 'custom', label: '自定义', color: 'text-text-secondary', bg: 'bg-bg-tertiary' },
]

const PRIORITIES = [
  { value: 'high', label: '高', color: 'text-accent-red' },
  { value: 'medium', label: '中', color: 'text-accent-yellow' },
  { value: 'low', label: '低', color: 'text-text-muted' },
]

const SOURCE_ICONS = {
  'manual': User,
  'auto-extract': FileText,
  'ai-generated': Bot,
}

function SourceIcon({ source }: { source: string }) {
  const Icon = (SOURCE_ICONS as any)[source] || FileText
  const labels: Record<string, string> = { 'manual': '手动', 'auto-extract': '自动', 'ai-generated': 'AI' }
  return (
    <span className="flex items-center gap-0.5 text-[9px] text-text-muted" title={labels[source] || source}>
      <Icon className="w-2.5 h-2.5" />
    </span>
  )
}

/** 编辑表单（新增/编辑共用） */
function EntryForm({ initial, projectPath, onSave, onCancel }: {
  initial: Partial<KnowledgeEntry> | null
  projectPath: string
  onSave: (params: any) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title || '')
  const [content, setContent] = useState(initial?.content || '')
  const [category, setCategory] = useState(initial?.category || 'custom')
  const [priority, setPriority] = useState(initial?.priority || 'medium')
  const [autoInject, setAutoInject] = useState(initial?.autoInject !== undefined ? initial.autoInject : true)

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return
    onSave({
      projectPath, category, title, content, priority, autoInject,
      tags: initial?.tags || [], source: initial?.source || 'manual',
    })
  }

  return (
    <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2">
      {/* Category + Priority */}
      <div className="flex items-center gap-1 flex-wrap">
        {CATEGORIES.map(c => (
          <button key={c.value} onClick={() => setCategory(c.value)}
            className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
              category === c.value ? `${c.color} ${c.bg}` : 'text-text-muted hover:text-text-primary'
            }`}>
            {c.label}
          </button>
        ))}
        <span className="mx-1 text-border">|</span>
        {PRIORITIES.map(p => (
          <button key={p.value} onClick={() => setPriority(p.value)}
            className={`px-1.5 py-0.5 rounded text-[10px] ${priority === p.value ? p.color : 'text-text-muted'}`}>
            {p.label}
          </button>
        ))}
      </div>
      {/* Title */}
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题"
        className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue" />
      {/* Content */}
      <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="内容..."
        className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary resize-y min-h-[60px] focus:outline-none focus:border-accent-blue" />
      {/* Auto inject + Actions */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-text-secondary cursor-pointer">
          <input type="checkbox" checked={autoInject} onChange={e => setAutoInject(e.target.checked)}
            className="w-3 h-3 accent-accent-blue" />
          自动注入新会话
        </label>
        <div className="flex gap-1">
          <button onClick={onCancel} className="px-2 py-1 text-xs text-text-muted hover:text-text-primary">取消</button>
          <button onClick={handleSubmit}
            className="px-2 py-1 bg-accent-blue/15 text-accent-blue rounded text-xs hover:bg-accent-blue/25">保存</button>
        </div>
      </div>
    </div>
  )
}

/** 条目卡片 */
function EntryCard({ entry, onEdit, onDelete, onToggleInject }: {
  entry: KnowledgeEntry
  onEdit: () => void
  onDelete: () => void
  onToggleInject: (autoInject: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const cat = CATEGORIES.find(c => c.value === entry.category)
  const pri = PRIORITIES.find(p => p.value === entry.priority)

  return (
    <div className="px-3 py-2.5 hover:bg-bg-hover transition-colors">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-1.5 min-w-0">
          {expanded ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />}
          <span className={`text-[9px] px-1 py-0.5 rounded ${cat?.color || 'text-text-muted'} ${cat?.bg || 'bg-bg-tertiary'}`}>
            {cat?.label || entry.category}
          </span>
          <span className="text-xs text-text-primary truncate">{entry.title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {entry.autoInject && <Zap className="w-3 h-3 text-accent-blue" />}
          <SourceIcon source={entry.source} />
          <button onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="p-0.5 text-text-muted hover:text-accent-blue opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity">
            <Edit3 className="w-3 h-3" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-0.5 text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 ml-5 space-y-2">
          <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{entry.content}</div>
          {/* Tags */}
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((tag, i) => (
                <span key={i} className="text-[9px] px-1 py-0.5 bg-bg-tertiary rounded text-text-muted">#{tag}</span>
              ))}
            </div>
          )}
          {/* Meta */}
          <div className="flex items-center justify-between text-[9px] text-text-muted">
            <div className="flex items-center gap-2">
              <SourceIcon source={entry.source} />
              <span>优先级: <span className={pri?.color}>{pri?.label}</span></span>
            </div>
            <label className="flex items-center gap-1 cursor-pointer" onClick={e => e.stopPropagation()}>
              <input type="checkbox" checked={entry.autoInject}
                onChange={e => onToggleInject(e.target.checked)}
                className="w-2.5 h-2.5 accent-accent-blue" />
              自动注入
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── 主面板 ─── */

export default function KnowledgeView() {
  const store = useKnowledgeStore()
  const entries = useKnowledgeStore(s => s.entries)
  const loading = useKnowledgeStore(s => s.loading)
  const activeSessionId = useSessionStore(s => s.currentSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const [searchQ, setSearchQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractResult, setExtractResult] = useState<{ count: number; extracted: string[] } | null>(null)

  const session = sessions.find(s => s.id === activeSessionId)
  const projectPath = session?.config?.workingDirectory || (session as any)?.workDir || ''

  useEffect(() => {
    if (projectPath) store.fetchList(projectPath)
  }, [projectPath])

  const handleAdd = async (params: any) => {
    await store.createEntry(params)
    setShowAdd(false)
  }

  const handleEdit = async (id: string, params: any) => {
    await store.updateEntry(id, params)
    setEditingId(null)
  }

  const handleAutoExtract = async () => {
    if (!projectPath) return
    setExtracting(true)
    setExtractResult(null)
    try {
      const result = await store.autoExtract(projectPath)
      setExtractResult(result)
    } finally {
      setExtracting(false)
    }
  }

  const handleToggleInject = async (id: string, autoInject: boolean) => {
    await store.updateEntry(id, { autoInject })
  }

  const handleDelete = async (id: string) => {
    await store.deleteEntry(id)
  }

  // 分类过滤
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const filtered = entries.filter(e => {
    if (filterCategory && e.category !== filterCategory) return false
    if (searchQ) {
      const q = searchQ.toLowerCase()
      return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
    }
    return true
  })

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted p-6">
        <BookMarked className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">请先选择一个会话</p>
      </div>
    )
  }

  const editingEntry = editingId ? entries.find(e => e.id === editingId) : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <BookMarked className="w-4 h-4 text-accent-purple" />
          项目知识库
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleAutoExtract} title="自动提取知识" disabled={extracting}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue transition-colors disabled:opacity-50">
            <Sparkles className={`w-3.5 h-3.5 ${extracting ? 'animate-pulse' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} title="添加知识"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-green transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => store.fetchList(projectPath)} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Extract Result */}
      {extractResult && (
        <div className="flex items-start gap-2 px-3 py-2 bg-accent-green/5 border-b border-accent-green/20 text-xs text-accent-green">
          <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div>
            <span>已提取 {extractResult.count} 条知识</span>
            {extractResult.extracted.length > 0 && (
              <span className="text-accent-green/70 ml-1">({extractResult.extracted.join(', ')})</span>
            )}
          </div>
          <button onClick={() => setExtractResult(null)} className="ml-auto text-text-muted hover:text-text-primary shrink-0">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <EntryForm initial={null} projectPath={projectPath} onSave={handleAdd} onCancel={() => setShowAdd(false)} />
      )}

      {/* Edit Form */}
      {editingEntry && (
        <EntryForm initial={editingEntry} projectPath={projectPath}
          onSave={(params) => handleEdit(editingEntry.id, params)} onCancel={() => setEditingId(null)} />
      )}

      {/* Search + Filter */}
      <div className="px-3 py-2 border-b border-border space-y-1">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索知识..." className="w-full pl-7 pr-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue" />
        </div>
        <div className="flex gap-0.5 flex-wrap">
          <button onClick={() => setFilterCategory(null)}
            className={`px-1 py-0.5 rounded text-[9px] transition-colors ${!filterCategory ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-primary'}`}>
            全部
          </button>
          {CATEGORIES.map(c => (
            <button key={c.value} onClick={() => setFilterCategory(filterCategory === c.value ? null : c.value)}
              className={`px-1 py-0.5 rounded text-[9px] transition-colors ${filterCategory === c.value ? `${c.color} ${c.bg}` : 'text-text-muted hover:text-text-primary'}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <BookMarked className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">{searchQ || filterCategory ? '未找到匹配' : '暂无知识条目'}</p>
            <p className="text-[10px]">点击 ✨ 自动从项目提取知识</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(entry => (
              <div key={entry.id} className="group">
                <EntryCard entry={entry}
                  onEdit={() => setEditingId(entry.id)}
                  onDelete={() => handleDelete(entry.id)}
                  onToggleInject={(autoInject) => handleToggleInject(entry.id, autoInject)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between text-[10px] text-text-muted">
        <span>{entries.length} 条知识 · {entries.filter(e => e.autoInject).length} 条自动注入</span>
        <span>标记"自动注入"的知识在新会话时注入 AI 上下文</span>
      </div>
    </div>
  )
}
