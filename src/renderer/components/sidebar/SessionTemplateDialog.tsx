/**
 * 会话模板创建对话框
 */
import { useState, useEffect } from 'react'
import { FileCode, FileText, Bug, PenTool, TestTube, RefreshCw, Plus, Trash2, X } from 'lucide-react'
import { useSessionTemplateStore, type TemplateCategory, type SessionTemplate } from '../../stores/sessionTemplateStore'

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  coding: FileCode, review: FileText, docs: FileText, testing: TestTube,
  debug: Bug, architecture: PenTool, custom: Plus, refactoring: RefreshCw,
}

const CATEGORY_LABELS: Record<string, string> = {
  coding: '编码', review: '代码审查', docs: '文档', testing: '测试',
  debug: '调试', architecture: '架构', custom: '自定义', refactoring: '重构',
}

interface Props {
  onClose: () => void
  onSelectTemplate?: (template: SessionTemplate) => void
}

export default function SessionTemplateDialog({ onClose, onSelectTemplate }: Props) {
  const store = useSessionTemplateStore()
  const templates = useSessionTemplateStore(s => s.templates)
  const categories = useSessionTemplateStore(s => s.categories)
  const loading = useSessionTemplateStore(s => s.loading)

  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<TemplateCategory>('custom')
  const [newSystemPrompt, setNewSystemPrompt] = useState('')
  const [newDescription, setNewDescription] = useState('')

  useEffect(() => {
    store.listTemplates()
    store.loadCategories()
  }, [])

  const filteredTemplates = selectedCategory
    ? templates.filter(t => t.category === selectedCategory)
    : templates

  const handleCreate = async () => {
    if (!newName.trim()) return
    await store.createTemplate({
      name: newName.trim(),
      category: newCategory,
      description: newDescription.trim(),
      icon: CATEGORY_LABELS[newCategory] || 'custom',
      defaultProviderId: '',
      defaultWorkingDir: '',
      systemPrompt: newSystemPrompt.trim(),
      initialPrompt: '',
      mcpServers: [],
      enableAgent: false,
      supervisorMode: false,
      envOverrides: {},
      sortOrder: 0,
    })
    setNewName(''); setNewSystemPrompt(''); setNewDescription(''); setShowCreate(false)
  }

  const handleCategorySelect = (catId: TemplateCategory) => {
    const next = selectedCategory === catId ? null : catId
    setSelectedCategory(next)
    store.listTemplates(next || undefined)
  }

  const inputCls = 'w-full px-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] max-h-[80vh] bg-bg-secondary border border-border rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">会话模板</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-blue/15 text-accent-blue text-xs hover:bg-accent-blue/25 transition-colors">
              <Plus className="w-3 h-3" /> 新建模板
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="px-4 py-3 border-b border-border bg-bg-tertiary/30 space-y-2">
            <div className="flex gap-2">
              <input className={`${inputCls} flex-1`} placeholder="模板名称" value={newName} onChange={e => setNewName(e.target.value)} />
              <select className={`${inputCls} w-28`} value={newCategory} onChange={e => setNewCategory(e.target.value as TemplateCategory)}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <input className={inputCls} placeholder="简短描述..." value={newDescription} onChange={e => setNewDescription(e.target.value)} />
            <textarea className={`${inputCls} min-h-[80px] resize-y`} placeholder="System Prompt..." value={newSystemPrompt} onChange={e => setNewSystemPrompt(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1 rounded-lg text-xs text-text-muted hover:text-text-primary">取消</button>
              <button onClick={handleCreate} className="px-3 py-1 rounded-lg bg-accent-blue text-white text-xs hover:bg-accent-blue/90">创建</button>
            </div>
          </div>
        )}

        {/* Category Filter */}
        <div className="px-4 py-2 border-b border-border flex gap-1.5 overflow-x-auto">
          <button onClick={() => handleCategorySelect(null as any)}
            className={`px-2.5 py-1 rounded-full text-[10px] whitespace-nowrap transition-colors ${
              !selectedCategory ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40' : 'text-text-muted hover:text-text-secondary border border-transparent'
            }`}>全部</button>
          {categories.map(cat => (
            <button key={cat.id} onClick={() => handleCategorySelect(cat.id)}
              className={`px-2.5 py-1 rounded-full text-[10px] whitespace-nowrap transition-colors ${
                selectedCategory === cat.id ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40' : 'text-text-muted hover:text-text-secondary border border-transparent'
              }`}>{cat.name}</button>
          ))}
        </div>

        {/* Template List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <div className="text-xs text-text-muted text-center py-4">加载中...</div>}
          {filteredTemplates.map(t => {
            const Icon = CATEGORY_ICONS[t.category] || FileCode
            return (
              <div key={t.id} onClick={() => { onSelectTemplate?.(t); onClose() }}
                className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-accent-blue/40 hover:bg-bg-hover cursor-pointer transition-colors group">
                <div className="p-1.5 rounded-lg bg-accent-blue/10 text-accent-blue shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-primary">{t.name}</span>
                    {t.isBuiltin && <span className="text-[9px] px-1 py-0.5 rounded bg-accent-purple/15 text-accent-purple">内置</span>}
                  </div>
                  {t.description && <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{t.description}</p>}
                </div>
                {!t.isBuiltin && (
                  <button onClick={(e) => { e.stopPropagation(); store.deleteTemplate(t.id) }}
                    className="p-1 rounded text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })}
          {!loading && !filteredTemplates.length && (
            <div className="text-xs text-text-muted text-center py-8">{selectedCategory ? '该分类下暂无模板' : '暂无模板'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
