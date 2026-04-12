/**
 * 项目知识库面板 - 管理和浏览项目知识
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import { BookMarked, Plus, Search, Trash2, RefreshCw, Sparkles, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useKnowledgeStore, type KnowledgeEntry } from '../../stores/knowledgeStore'
import { useSessionStore } from '../../stores/sessionStore'

const CATEGORIES = [
  { value: 'architecture', label: '架构', color: 'text-accent-blue' },
  { value: 'tech-stack', label: '技术栈', color: 'text-accent-green' },
  { value: 'convention', label: '规范', color: 'text-accent-yellow' },
  { value: 'api', label: 'API', color: 'text-accent-purple' },
  { value: 'decision', label: '决策', color: 'text-accent-red' },
  { value: 'custom', label: '自定义', color: 'text-text-secondary' },
]

export default function KnowledgeView() {
  const store = useKnowledgeStore()
  const entries = useKnowledgeStore(s => s.entries)
  const loading = useKnowledgeStore(s => s.loading)
  const activeSessionId = useSessionStore(s => s.currentSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const [searchQ, setSearchQ] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('custom')

  const session = sessions.find(s => s.id === activeSessionId)
  const projectPath = session?.workDir || ''

  useEffect(() => {
    if (projectPath) store.fetchList(projectPath)
  }, [projectPath])

  const handleAdd = async () => {
    if (!newTitle.trim() || !newContent.trim() || !projectPath) return
    await store.createEntry({
      projectPath, category: newCategory, title: newTitle, content: newContent,
      tags: [], priority: 'medium', autoInject: true, source: 'manual',
    })
    setNewTitle(''); setNewContent(''); setShowAdd(false)
  }

  const handleAutoExtract = async () => {
    if (!projectPath) return
    const count = await store.autoExtract(projectPath)
    alert(`已自动提取 ${count} 条知识`)
  }

  const filtered = searchQ
    ? entries.filter(e => e.title.toLowerCase().includes(searchQ.toLowerCase()) || e.content.toLowerCase().includes(searchQ.toLowerCase()))
    : entries

  if (!projectPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted p-6">
        <BookMarked className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">请先选择一个会话</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <BookMarked className="w-4 h-4 text-accent-purple" />
          项目知识库
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleAutoExtract} title="自动提取知识"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue transition-colors">
            <Sparkles className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowAdd(!showAdd)} title="添加知识"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-green transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => store.fetchList(projectPath)} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2">
          <div className="flex gap-1">
            {CATEGORIES.map(c => (
              <button key={c.value} onClick={() => setNewCategory(c.value)}
                className={`px-1.5 py-0.5 rounded text-[10px] ${newCategory === c.value ? `${c.color} bg-bg-hover` : 'text-text-muted hover:text-text-primary'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="标题" className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue" />
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)}
            placeholder="内容..." className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary resize-y min-h-[60px] focus:outline-none focus:border-accent-blue" />
          <div className="flex justify-end gap-1">
            <button onClick={() => setShowAdd(false)} className="px-2 py-1 text-xs text-text-muted hover:text-text-primary">取消</button>
            <button onClick={handleAdd} className="px-2 py-1 bg-accent-blue/15 text-accent-blue rounded text-xs hover:bg-accent-blue/25">添加</button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索知识..." className="w-full pl-7 pr-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue" />
        </div>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <BookMarked className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">{searchQ ? '未找到匹配' : '暂无知识条目'}</p>
            <p className="text-[10px]">点击 ✨ 自动从项目提取知识</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(entry => {
              const cat = CATEGORIES.find(c => c.value === entry.category)
              return (
                <div key={entry.id} className="px-3 py-2.5 hover:bg-bg-hover transition-colors">
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      {expandedId === entry.id ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />}
                      <span className={`text-[9px] px-1 py-0.5 rounded ${cat?.color || 'text-text-muted'} bg-bg-tertiary`}>{cat?.label || entry.category}</span>
                      <span className="text-xs text-text-primary truncate">{entry.title}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {entry.autoInject && <span className="text-[9px] text-accent-blue">自动注入</span>}
                      <button onClick={(e) => { e.stopPropagation(); store.deleteEntry(entry.id) }}
                        className="p-0.5 text-text-muted hover:text-accent-red"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                  {expandedId === entry.id && (
                    <div className="mt-2 ml-5 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{entry.content}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        标记"自动注入"的知识会在新会话开始时自动注入 AI 上下文
      </div>
    </div>
  )
}
