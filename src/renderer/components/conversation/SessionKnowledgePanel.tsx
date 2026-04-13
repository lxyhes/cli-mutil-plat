/**
 * 会话内嵌知识库抽屉面板
 * 从 ConversationView 右侧滑出，提供项目知识库的完整管理功能
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import {
  BookMarked, Plus, Search, Trash2, RefreshCw, Sparkles,
  ChevronDown, ChevronRight, Edit3, Check, X, Zap, FileText, Bot, User,
  CheckSquare, Download, Upload, MessageSquare, PanelRightClose
} from 'lucide-react'
import { useKnowledgeStore, type KnowledgeEntry } from '../../stores/knowledgeStore'

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

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'manual': User,
  'auto-extract': FileText,
  'ai-generated': Bot,
}

function SourceIcon({ source }: { source: string }) {
  const Icon = SOURCE_ICONS[source] || FileText
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
          <button key={c.value} onClick={() => setCategory(c.value as KnowledgeEntry['category'])}
            className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
              category === c.value ? `${c.color} ${c.bg}` : 'text-text-muted hover:text-text-primary'
            }`}>
            {c.label}
          </button>
        ))}
        <span className="mx-1 text-border">|</span>
        {PRIORITIES.map(p => (
          <button key={p.value} onClick={() => setPriority(p.value as KnowledgeEntry['priority'])}
            className={`px-1.5 py-0.5 rounded text-[10px] ${priority === p.value ? p.color : 'text-text-muted'}`}>
            {p.label}
          </button>
        ))}
      </div>
      {/* Title */}
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题"
        className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue" />
      {/* Content */}
      <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="内容..."
        className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary resize-y min-h-[60px] focus:outline-none focus:border-accent-blue" />
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
function EntryCard({ entry, onEdit, onDelete, onToggleInject, selected, onToggleSelect, batchMode }: {
  entry: KnowledgeEntry
  onEdit: () => void
  onDelete: () => void
  onToggleInject: (autoInject: boolean) => void
  selected?: boolean
  onToggleSelect?: () => void
  batchMode: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const cat = CATEGORIES.find(c => c.value === entry.category)
  const pri = PRIORITIES.find(p => p.value === entry.priority)

  return (
    <div className="px-3 py-2.5 hover:bg-bg-hover transition-colors group">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-1.5 min-w-0">
          {batchMode && (
            <input type="checkbox" checked={!!selected} onChange={onToggleSelect}
              onClick={e => e.stopPropagation()}
              className="w-3 h-3 accent-accent-blue shrink-0" />
          )}
          {expanded
            ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
            : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
          }
          <span className={`text-[9px] px-1 py-0.5 rounded ${cat?.color || 'text-text-muted'} ${cat?.bg || 'bg-bg-tertiary'}`}>
            {cat?.label || entry.category}
          </span>
          <span className="text-xs text-text-primary truncate">{entry.title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {entry.autoInject && <Zap className="w-3 h-3 text-accent-blue" />}
          <SourceIcon source={entry.source} />
          {!batchMode && (
            <>
              <button onClick={(e) => { e.stopPropagation(); onEdit() }}
                className="p-0.5 text-text-muted hover:text-accent-blue opacity-0 group-hover:opacity-100 transition-opacity">
                <Edit3 className="w-3 h-3" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete() }}
                className="p-0.5 text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
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

interface Props {
  sessionId: string
  projectPath: string
  onClose: () => void
}

export default function SessionKnowledgePanel({ sessionId, projectPath, onClose }: Props) {
  const store = useKnowledgeStore()
  const entries = useKnowledgeStore(s => s.entries)
  const loading = useKnowledgeStore(s => s.loading)
  const pagination = useKnowledgeStore(s => s.pagination)
  const selectedIds = useKnowledgeStore(s => s.selectedIds)

  const [searchQ, setSearchQ] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractingSession, setExtractingSession] = useState(false)
  const [extractResult, setExtractResult] = useState<{ count: number; extracted: string[] } | null>(null)
  const [showBatchOps, setShowBatchOps] = useState(false)
  const [batchCategory, setBatchCategory] = useState<string>('')
  const [batchPriority, setBatchPriority] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string | null>(null)

  useEffect(() => {
    if (projectPath) store.fetchList(projectPath)
  }, [projectPath])

  useEffect(() => {
    if (!showBatchOps) store.clearSelection()
  }, [showBatchOps])

  const handleAdd = async (params: any) => {
    await store.createEntry(params)
    setShowAdd(false)
  }

  const handleEdit = async (id: string, params: any) => {
    await store.updateEntry(id, params)
    setEditingId(null)
  }

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    if (confirm(`确定删除选中的 ${ids.length} 条知识？`)) {
      await store.deleteBatch(ids)
    }
  }

  const handleBatchUpdate = async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    const updates: any = {}
    if (batchCategory) updates.category = batchCategory
    if (batchPriority) updates.priority = batchPriority
    if (Object.keys(updates).length === 0) return
    await store.updateBatch(ids, updates)
    setBatchCategory('')
    setBatchPriority('')
  }

  const handleExport = async () => {
    const data = await store.exportData()
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `knowledge-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        const count = await store.importData(data)
        alert(`成功导入 ${count} 条知识`)
      } catch {
        alert('导入失败：无效的 JSON 文件')
      }
    }
    input.click()
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

  const handleExtractFromSession = async () => {
    if (!projectPath || !sessionId) return
    setExtractingSession(true)
    setExtractResult(null)
    try {
      const result = await store.extractFromSession(sessionId, projectPath)
      setExtractResult(result)
    } finally {
      setExtractingSession(false)
    }
  }

  const handleToggleInject = async (id: string, autoInject: boolean) => {
    await store.updateEntry(id, { autoInject })
  }

  const handleDelete = async (id: string) => {
    await store.deleteEntry(id)
  }

  const handleLoadMore = async () => {
    await store.loadMore()
  }

  const filtered = entries.filter(e => {
    if (filterCategory && e.category !== filterCategory) return false
    if (searchQ) {
      const q = searchQ.toLowerCase()
      return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
    }
    return true
  })

  const editingEntry = editingId ? entries.find(e => e.id === editingId) : null

  return (
    <div className="flex flex-col h-full border-l border-border bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <BookMarked className="w-4 h-4 text-accent-purple" />
          项目知识库
          {showBatchOps && selectedIds.size > 0 && (
            <span className="text-xs text-accent-blue">已选 {selectedIds.size}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 批量操作按钮 */}
          <button onClick={() => setShowBatchOps(!showBatchOps)} title="批量操作"
            className={`p-1 rounded transition-colors ${showBatchOps ? 'bg-accent-blue/20 text-accent-blue' : 'hover:bg-bg-hover text-text-muted hover:text-accent-blue'}`}>
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleImport} title="导入"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-green transition-colors">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleExport} title="导出"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-purple transition-colors">
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleAutoExtract} title="从项目文件提取知识" disabled={extracting}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue transition-colors disabled:opacity-50">
            <Sparkles className={`w-3.5 h-3.5 ${extracting ? 'animate-pulse' : ''}`} />
          </button>
          <button onClick={handleExtractFromSession} title="从当前会话提取知识" disabled={extractingSession}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-purple transition-colors disabled:opacity-50">
            <MessageSquare className={`w-3.5 h-3.5 ${extractingSession ? 'animate-pulse' : ''}`} />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} title="添加知识"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-green transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => store.fetchList(projectPath)} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} title="关闭知识库"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Batch Operations Bar */}
      {showBatchOps && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-blue/5 border-b border-accent-blue/20">
          <span className="text-xs text-accent-blue">批量操作：</span>
          <select value={batchCategory} onChange={e => setBatchCategory(e.target.value)}
            className="px-1.5 py-0.5 text-xs bg-bg-secondary border border-border rounded text-text-primary">
            <option value="">不改分类</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select value={batchPriority} onChange={e => setBatchPriority(e.target.value)}
            className="px-1.5 py-0.5 text-xs bg-bg-secondary border border-border rounded text-text-primary">
            <option value="">不改优先级</option>
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button onClick={handleBatchUpdate}
            className="px-2 py-0.5 text-xs bg-accent-blue/15 text-accent-blue rounded hover:bg-accent-blue/25">
            应用
          </button>
          <button onClick={handleBatchDelete}
            className="px-2 py-0.5 text-xs bg-accent-red/15 text-accent-red rounded hover:bg-accent-red/25">
            删除
          </button>
          <button onClick={() => store.clearSelection()} className="ml-auto text-xs text-text-muted hover:text-text-primary">
            清除选择
          </button>
        </div>
      )}

      {/* Extract Result */}
      {extractResult && (
        <div className="flex items-start gap-2 px-3 py-2 bg-bg-secondary/50 border-b border-border">
          <div className="flex items-start gap-2 text-xs text-accent-green">
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
            <p className="text-[10px]">点击 ✨ 从项目文件提取 · 🔮 从会话对话提取</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(entry => (
              <div key={entry.id} className="group">
                <EntryCard entry={entry}
                  selected={selectedIds.has(entry.id)}
                  onToggleSelect={showBatchOps ? () => store.toggleSelect(entry.id) : undefined}
                  onEdit={() => setEditingId(entry.id)}
                  onDelete={() => handleDelete(entry.id)}
                  onToggleInject={(autoInject) => handleToggleInject(entry.id, autoInject)}
                  batchMode={showBatchOps} />
              </div>
            ))}
            {/* Load More */}
            {pagination.hasMore && (
              <div className="px-3 py-2 flex justify-center">
                <button onClick={handleLoadMore} disabled={loading}
                  className="px-3 py-1 text-xs text-text-secondary hover:text-accent-blue disabled:opacity-50 transition-colors">
                  {loading ? '加载中...' : '加载更多'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between text-[10px] text-text-muted">
        <span>{pagination.total > 0 ? `${entries.length}/${pagination.total}` : entries.length} 条知识 · {entries.filter(e => e.autoInject).length} 条自动注入</span>
        <span>自动注入的知识在新会话时注入 AI 上下文</span>
      </div>
    </div>
  )
}
