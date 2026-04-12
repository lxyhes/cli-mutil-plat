/**
 * 跨会话语义记忆面板 - 搜索和浏览历史会话记忆
 */
import { useState, useEffect } from 'react'
import { BookOpen, Search, Trash2, ChevronDown, ChevronRight, BarChart3, RefreshCw } from 'lucide-react'
import { useCrossMemoryStore, type MemoryEntry } from '../../stores/crossMemoryStore'

export default function CrossMemoryView() {
  const store = useCrossMemoryStore()
  const entries = useCrossMemoryStore(s => s.entries)
  const searchResult = useCrossMemoryStore(s => s.searchResult)
  const stats = useCrossMemoryStore(s => s.stats)
  const loading = useCrossMemoryStore(s => s.loading)

  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showStats, setShowStats] = useState(false)

  useEffect(() => {
    store.listAll(50)
    store.getStats()
  }, [])

  const handleSearch = async () => {
    if (!query.trim()) { setSearchMode(false); return }
    setSearchMode(true)
    await store.search(query.trim(), 20)
  }

  const handleDelete = async (id: string) => {
    await store.deleteEntry(id)
    if (searchMode) await store.search(query.trim(), 20)
    else await store.listAll(50)
    await store.getStats()
  }

  const displayList: MemoryEntry[] = searchMode ? (searchResult?.entries || []) : entries

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <BookOpen className="w-4 h-4 text-accent-blue" />
          跨会话记忆
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowStats(!showStats)} title="统计"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { store.listAll(50); store.getStats() }} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Stats */}
      {showStats && stats && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div>
              <div className="text-sm font-medium text-text-primary">{stats.totalEntries}</div>
              <div className="text-[9px] text-text-muted">总记忆</div>
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{stats.uniqueSessions}</div>
              <div className="text-[9px] text-text-muted">覆盖会话</div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex gap-1">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input className="w-full pl-7 pr-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
              placeholder="搜索历史会话记忆..." value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          </div>
          <button onClick={handleSearch}
            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-accent-blue/15 text-accent-blue text-xs hover:bg-accent-blue/25 transition-colors">
            搜索
          </button>
          {searchMode && (
            <button onClick={() => { setSearchMode(false); setQuery(''); store.listAll(50) }}
              className="shrink-0 px-2 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-primary">
              清除
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && !displayList.length && <div className="text-xs text-text-muted text-center py-8">加载中...</div>}
        {!loading && !displayList.length && (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <BookOpen className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm mb-1">{searchMode ? '未找到匹配的记忆' : '暂无历史记忆'}</p>
            <p className="text-[10px]">会话摘要生成后会自动索引到记忆库</p>
          </div>
        )}
        <div className="divide-y divide-border">
          {displayList.map((m: MemoryEntry) => (
            <div key={m.id} className="px-3 py-2.5 hover:bg-bg-hover transition-colors">
              <div className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}>
                <div className="flex items-center gap-2 min-w-0">
                  {expandedId === m.id ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />}
                  <span className="text-xs text-text-primary font-medium truncate">{m.sessionName}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9px] text-text-muted">{new Date(m.createdAt).toLocaleDateString()}</span>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(m.id) }}
                    className="p-0.5 rounded text-text-muted hover:text-accent-red transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {expandedId === m.id && (
                <div className="mt-2 ml-5 space-y-2">
                  <div className="text-xs text-text-secondary leading-relaxed">{m.summary}</div>
                  {m.keyPoints && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-text-muted uppercase tracking-wider">关键要点</div>
                      <div className="text-xs text-text-secondary">{m.keyPoints}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        跨会话记忆会在新会话开始时自动注入相关上下文
      </div>
    </div>
  )
}
