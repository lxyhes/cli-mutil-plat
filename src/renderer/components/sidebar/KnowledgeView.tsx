/**
 * 知识中心统一视图
 * 整合项目知识库、跨会话记忆、工作记忆三合一
 * 按 范围×生命周期 矩阵组织：
 * - 项目知识库 (project-knowledge): 项目级 + 持久
 * - 跨会话记忆 (cross-session-memory): 全局级 + 持久
 * - 工作记忆 (working-memory): 项目级 + 临时
 *
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import {
  BookMarked, Brain, Cpu, Plus, Search, Trash2, RefreshCw, Sparkles,
  Check, X, Zap, Download, Upload, MessageSquare, CheckSquare,
  ChevronDown, Lightbulb, Layers
} from 'lucide-react'
import { useKnowledgeCenterStore } from '../../stores/knowledgeCenterStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { UnifiedKnowledgeType, UnifiedKnowledgeEntry, UnifiedKnowledgeCategory } from '../../../shared/knowledgeCenterTypes'
import KnowledgeCard, { CategoryBadge, TypeIcon } from '../knowledge/KnowledgeCard'
import EntryForm from '../knowledge/EntryForm'
import WorkingMemoryPanel from '../knowledge/WorkingMemoryPanel'

// Tab 配置
const TABS: { id: UnifiedKnowledgeType | 'all'; label: string; icon: React.ComponentType<{ className?: string }>; description: string; color: string }[] = [
  {
    id: 'all',
    label: '全部知识',
    icon: Layers,
    description: '项目知识、跨会话记忆、工作记忆统一视图',
    color: 'text-accent-cyan'
  },
  {
    id: 'project-knowledge',
    label: '项目知识库',
    icon: BookMarked,
    description: '项目级持久知识，自动注入新会话',
    color: 'text-accent-purple'
  },
  {
    id: 'cross-session-memory',
    label: '跨会话记忆',
    icon: Brain,
    description: '全局历史会话摘要，智能检索复用',
    color: 'text-accent-blue'
  },
  {
    id: 'working-memory',
    label: '工作记忆',
    icon: Cpu,
    description: '当前项目的临时工作上下文',
    color: 'text-accent-green'
  }
]

const PROJECT_CATEGORY_FILTERS: UnifiedKnowledgeCategory[] = [
  'architecture',
  'tech-stack',
  'convention',
  'api',
  'decision',
  'summary',
  'context',
  'task',
  'custom',
]

export default function KnowledgeView() {
  // ===== Store 状态 =====
  const store = useKnowledgeCenterStore()
  const entries = useKnowledgeCenterStore(s => s.entries)
  const loading = useKnowledgeCenterStore(s => s.loading)
  const pagination = useKnowledgeCenterStore(s => s.pagination)
  const selectedIds = useKnowledgeCenterStore(s => s.selectedIds)
  const currentTab = useKnowledgeCenterStore(s => s.currentTab)
  const searchQuery = useKnowledgeCenterStore(s => s.searchQuery)
  const filterCategory = useKnowledgeCenterStore(s => s.filterCategory)
  const filterScope = useKnowledgeCenterStore(s => s.filterScope)
  const filterLifecycle = useKnowledgeCenterStore(s => s.filterLifecycle)

  // ===== 本地状态 =====
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractingSession, setExtractingSession] = useState(false)
  const [extractResult, setExtractResult] = useState<{ count: number; extracted: string[] } | null>(null)
  const [showBatchOps, setShowBatchOps] = useState(false)
  const [batchCategory, setBatchCategory] = useState<string>('')
  const [batchPriority, setBatchPriority] = useState<string>('')
  const [memorySearchQuery, setMemorySearchQuery] = useState('')
  const [memorySearchResults, setMemorySearchResults] = useState<UnifiedKnowledgeEntry[]>([])

  // ===== 会话上下文 =====
  const selectedSessionId = useSessionStore(s => s.selectedSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const session = sessions.find(s => s.id === selectedSessionId)
  const projectPath = session?.config?.workingDirectory || (session as any)?.workDir || ''

  // ===== 初始化 =====
  useEffect(() => {
    if (projectPath) {
      store.setCurrentProject(projectPath)
    }
  }, [projectPath])

  // 清理选择状态
  useEffect(() => {
    if (!showBatchOps) {
      store.clearSelection()
    }
  }, [showBatchOps])

  // ===== 事件处理 =====
  const handleTabChange = (tabId: UnifiedKnowledgeType | 'all') => {
    store.setCurrentTab(tabId)
    setShowAdd(false)
    setEditingId(null)
    setExtractResult(null)
  }

  const handleAdd = async (params: any) => {
    const entry = await store.createEntry(params)
    if (entry) {
      setShowAdd(false)
    }
  }

  const handleEdit = async (id: string, params: any) => {
    const success = await store.updateEntry(id, params)
    if (success) {
      setEditingId(null)
    }
  }

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    if (confirm(`确定删除选中的 ${ids.length} 条知识？`)) {
      await store.deleteBatch(ids)
      setShowBatchOps(false)
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
    const data = await store.exportData(projectPath)
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `knowledge-${currentTab}-${Date.now()}.json`
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
    if (!projectPath || !selectedSessionId) return
    setExtractingSession(true)
    setExtractResult(null)
    try {
      const result = await store.extractFromSession(selectedSessionId, projectPath)
      setExtractResult(result)
    } finally {
      setExtractingSession(false)
    }
  }

  const handleToggleInject = async (id: string, autoInject: boolean) => {
    await store.toggleAutoInject(id, autoInject)
  }

  const handleDelete = async (id: string) => {
    await store.deleteEntry(id)
  }

  const handleLoadMore = async () => {
    await store.loadMore()
  }

  const handleSearchMemory = async () => {
    if (!memorySearchQuery.trim()) {
      setMemorySearchResults([])
      return
    }
    const results = await store.searchMemory(memorySearchQuery, 10)
    setMemorySearchResults(results)
  }

  // ===== 过滤后的条目 =====
  const filteredEntries = store.getFilteredEntries()

  // ===== 当前 Tab 配置 =====
  const currentTabConfig = TABS.find(t => t.id === currentTab) || TABS[0]
  const TabIcon = currentTabConfig.icon

  // ===== 编辑中的条目 =====
  const editingEntry = editingId ? entries.find(e => e.id === editingId) : null

  // ===== 空状态提示 =====
  if (!projectPath && currentTab !== 'cross-session-memory' && currentTab !== 'all') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted p-6">
        <BookMarked className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">请先选择一个会话</p>
        <p className="text-xs mt-1 opacity-60">知识中心需要项目上下文</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* ===== Tab 导航 ===== */}
      <div className="flex items-center px-2 py-1.5 border-b border-border bg-bg-secondary gap-0.5">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                currentTab === tab.id
                  ? `${tab.color} bg-bg-primary font-medium`
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
              title={tab.description}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="px-3 py-2 border-b border-border bg-bg-primary/40 space-y-1.5">
        <div className="flex items-center gap-1">
          {[
            { value: 'all', label: '全部范围' },
            { value: 'project', label: '项目' },
            { value: 'global', label: '全局' },
          ].map(option => (
            <button
              key={option.value}
              onClick={() => store.setFilterScope(option.value as any)}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                filterScope === option.value
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {[
            { value: 'all', label: '全部周期' },
            { value: 'persistent', label: '持久' },
            { value: 'temporary', label: '临时' },
          ].map(option => (
            <button
              key={option.value}
              onClick={() => store.setFilterLifecycle(option.value as any)}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                filterLifecycle === option.value
                  ? 'bg-accent-green/15 text-accent-green'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 头部工具栏 ===== */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <TabIcon className={`w-4 h-4 ${currentTabConfig.color}`} />
          {currentTabConfig.label}
          {showBatchOps && selectedIds.size > 0 && (
            <span className="text-xs text-accent-blue">已选 {selectedIds.size}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 批量操作按钮 */}
          <button
            onClick={() => setShowBatchOps(!showBatchOps)}
            title="批量操作"
            className={`p-1 rounded transition-colors ${
              showBatchOps ? 'bg-accent-blue/20 text-accent-blue' : 'hover:bg-bg-hover text-text-muted hover:text-accent-blue'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>

          {/* 导入导出（仅项目知识库） */}
          {currentTab === 'project-knowledge' && (
            <>
              <button
                onClick={handleImport}
                title="导入"
                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-green transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleExport}
                title="导出"
                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-purple transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {/* 自动提取（仅项目知识库） */}
          {currentTab === 'project-knowledge' && (
            <button
              onClick={handleAutoExtract}
              title="从项目文件提取知识"
              disabled={extracting}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue transition-colors disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${extracting ? 'animate-pulse' : ''}`} />
            </button>
          )}

          {/* 从会话提取（项目知识库和工作记忆） */}
          {(currentTab === 'project-knowledge' || currentTab === 'working-memory') && (
            <button
              onClick={handleExtractFromSession}
              title="从当前会话提取知识"
              disabled={extractingSession || !selectedSessionId}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-purple transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ opacity: !selectedSessionId ? 0.4 : 1 }}
            >
              <MessageSquare className={`w-3.5 h-3.5 ${extractingSession ? 'animate-pulse' : ''}`} />
            </button>
          )}

          {/* 添加（仅项目知识库支持手动添加） */}
          {currentTab === 'project-knowledge' && (
            <button
              onClick={() => setShowAdd(!showAdd)}
              title="添加知识"
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-green transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 刷新 */}
          <button
            onClick={() => store.refresh()}
            title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ===== 批量操作栏 ===== */}
      {showBatchOps && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-blue/5 border-b border-accent-blue/20">
          <span className="text-xs text-accent-blue">批量操作：</span>
          <select
            value={batchCategory}
            onChange={e => setBatchCategory(e.target.value)}
            className="px-1.5 py-0.5 text-xs bg-bg-secondary border border-border rounded text-text-primary"
          >
            <option value="">不改分类</option>
            <option value="architecture">架构</option>
            <option value="tech-stack">技术栈</option>
            <option value="convention">规范</option>
            <option value="api">API</option>
            <option value="decision">决策</option>
            <option value="custom">自定义</option>
          </select>
          <select
            value={batchPriority}
            onChange={e => setBatchPriority(e.target.value)}
            className="px-1.5 py-0.5 text-xs bg-bg-secondary border border-border rounded text-text-primary"
          >
            <option value="">不改优先级</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <button
            onClick={handleBatchUpdate}
            className="px-2 py-0.5 text-xs bg-accent-blue/15 text-accent-blue rounded hover:bg-accent-blue/25"
          >
            应用
          </button>
          <button
            onClick={handleBatchDelete}
            className="px-2 py-0.5 text-xs bg-accent-red/15 text-accent-red rounded hover:bg-accent-red/25"
          >
            删除
          </button>
          <button
            onClick={() => store.clearSelection()}
            className="ml-auto text-xs text-text-muted hover:text-text-primary"
          >
            清除选择
          </button>
        </div>
      )}

      {/* ===== 提取结果提示 ===== */}
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
            <button
              onClick={() => setExtractResult(null)}
              className="ml-auto text-text-muted hover:text-text-primary shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ===== 添加表单 ===== */}
      {showAdd && currentTab === 'project-knowledge' && (
        <EntryForm
          initial={null}
          projectPath={projectPath}
          onSave={handleAdd}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* ===== 编辑表单 ===== */}
      {editingEntry && (
        <EntryForm
          initial={editingEntry}
          projectPath={projectPath}
          onSave={(params) => handleEdit(editingEntry.id, params)}
          onCancel={() => setEditingId(null)}
        />
      )}

      {/* ===== 搜索与过滤 ===== */}
      <div className="px-3 py-2 border-b border-border space-y-1">
        {/* 跨会话记忆专用搜索 */}
        {currentTab === 'cross-session-memory' ? (
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Brain className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                value={memorySearchQuery}
                onChange={e => setMemorySearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearchMemory()}
                placeholder="搜索历史会话记忆..."
                className="w-full pl-7 pr-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
              />
            </div>
            <button
              onClick={handleSearchMemory}
              className="px-2 py-1 bg-accent-blue/15 text-accent-blue rounded text-xs hover:bg-accent-blue/25"
            >
              搜索
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              value={searchQuery}
              onChange={e => store.setSearchQuery(e.target.value)}
              placeholder="搜索知识..."
              className="w-full pl-7 pr-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            />
          </div>
        )}

        {/* 分类过滤（仅项目知识库） */}
        {currentTab !== 'working-memory' && (
          <div className="flex gap-0.5 flex-wrap">
            <button
              onClick={() => store.setFilterCategory(null)}
              className={`px-1 py-0.5 rounded text-[9px] transition-colors ${
                !filterCategory ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              全部
            </button>
            {PROJECT_CATEGORY_FILTERS.map(cat => (
              <button
                key={cat}
                onClick={() => store.setFilterCategory(filterCategory === cat ? null : cat)}
                className={`px-1 py-0.5 rounded text-[9px] transition-colors ${
                  filterCategory === cat ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {cat === 'architecture' && '架构'}
                {cat === 'tech-stack' && '技术栈'}
                {cat === 'convention' && '规范'}
                {cat === 'api' && 'API'}
                {cat === 'decision' && '决策'}
                {cat === 'summary' && '摘要'}
                {cat === 'context' && '上下文'}
                {cat === 'task' && '任务'}
                {cat === 'custom' && '自定义'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ===== 内容列表 ===== */}
      <div className="flex-1 overflow-y-auto">
        {/* 工作记忆专用面板 */}
        {currentTab === 'working-memory' && selectedSessionId && projectPath && (
          <WorkingMemoryPanel sessionId={selectedSessionId} projectPath={projectPath} />
        )}

        {/* 跨会话记忆搜索结果 */}
        {currentTab !== 'working-memory' && currentTab === 'cross-session-memory' && memorySearchResults.length > 0 && (
          <div className="px-3 py-2 border-b border-border bg-accent-blue/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-accent-blue">搜索结果 ({memorySearchResults.length})</span>
              <button
                onClick={() => setMemorySearchResults([])}
                className="text-[10px] text-text-muted hover:text-text-primary"
              >
                清除
              </button>
            </div>
            <div className="divide-y divide-border/50">
              {memorySearchResults.map(entry => (
                <KnowledgeCard
                  key={entry.id}
                  entry={entry}
                  compact
                  onToggleInject={(autoInject) => handleToggleInject(entry.id, autoInject)}
                />
              ))}
            </div>
          </div>
        )}

        {/* 主列表 */}
        {currentTab !== 'working-memory' && (
          filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <TabIcon className="w-7 h-7 mb-3 opacity-30" />
              <p className="text-sm mb-1">
                {searchQuery || filterCategory ? '未找到匹配' : '暂无知识条目'}
              </p>
              <p className="text-[10px]">
                {currentTab === 'project-knowledge' && '点击 ✨ 从项目文件提取 · 🔮 从会话对话提取'}
                {currentTab === 'cross-session-memory' && '会话结束后自动生成摘要'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredEntries.map(entry => (
                <div key={entry.id} className="group">
                  <KnowledgeCard
                    entry={entry}
                    selected={selectedIds.has(entry.id)}
                    onToggleSelect={showBatchOps ? () => store.toggleSelect(entry.id) : undefined}
                    onEdit={currentTab === 'project-knowledge' ? () => setEditingId(entry.id) : undefined}
                    onDelete={() => handleDelete(entry.id)}
                    onToggleInject={(autoInject) => handleToggleInject(entry.id, autoInject)}
                    batchMode={showBatchOps}
                    showType={currentTab === 'all'}
                  />
                </div>
              ))}

              {/* 加载更多 */}
              {pagination.hasMore && (
                <div className="px-3 py-2 flex justify-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={loading}
                    className="px-3 py-1 text-xs text-text-secondary hover:text-accent-blue disabled:opacity-50 transition-colors"
                  >
                    {loading ? '加载中...' : '加载更多'}
                  </button>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* ===== 底部统计 ===== */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between text-[10px] text-text-muted">
        <span>
          {pagination.total > 0 ? `${entries.length}/${pagination.total}` : entries.length} 条知识
          {currentTab === 'project-knowledge' && (
            <span> · {entries.filter(e => e.autoInject).length} 条自动注入</span>
          )}
        </span>
        <span className="flex items-center gap-1">
          <Lightbulb className="w-3 h-3" />
          {currentTab === 'project-knowledge' && '标记"自动注入"的知识在新会话时注入 AI 上下文'}
          {currentTab === 'cross-session-memory' && '相关记忆会自动匹配注入到新会话'}
          {currentTab === 'working-memory' && '工作记忆仅在当前会话内有效'}
        </span>
      </div>
    </div>
  )
}
