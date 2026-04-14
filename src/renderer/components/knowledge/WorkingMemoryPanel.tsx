/**
 * 工作记忆交互面板
 * 提供任务、问题、决策、待办、代码片段的管理界面
 * 集成到 KnowledgeView 的工作记忆 Tab 中
 * 
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import {
  Target, AlertTriangle, Lightbulb, ListTodo, Code2,
  Plus, CheckCircle2, X, Camera
} from 'lucide-react'
import { useKnowledgeCenterStore } from '../../stores/knowledgeCenterStore'
import type { UnifiedKnowledgeEntry } from '../../../shared/knowledgeCenterTypes'

type WorkingMemoryTab = 'task' | 'problems' | 'decisions' | 'todos' | 'snippets'

const TABS: { key: WorkingMemoryTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'task', label: '任务', icon: Target },
  { key: 'problems', label: '问题', icon: AlertTriangle },
  { key: 'decisions', label: '决策', icon: Lightbulb },
  { key: 'todos', label: '待办', icon: ListTodo },
  { key: 'snippets', label: '片段', icon: Code2 },
]

const inputCls = 'w-full px-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue'

interface WorkingMemoryPanelProps {
  sessionId: string
  projectPath: string
}

export default function WorkingMemoryPanel({ sessionId, projectPath }: WorkingMemoryPanelProps) {
  const [activeTab, setActiveTab] = useState<WorkingMemoryTab>('task')
  const [newProblem, setNewProblem] = useState('')
  const [newDecision, setNewDecision] = useState('')
  const [newTodo, setNewTodo] = useState('')
  const [newTask, setNewTask] = useState('')

  const store = useKnowledgeCenterStore()
  const workingMemoryEntries = useKnowledgeCenterStore(s => 
    s.entries.filter(e => e.type === 'working-memory' && e.sessionId === sessionId)
  )

  // 加载工作记忆
  useEffect(() => {
    store.fetchEntries({
      type: 'working-memory',
      sessionId,
      projectPath
    })
  }, [sessionId, projectPath])

  // 解析工作记忆条目为结构化数据
  const parseWorkingMemory = () => {
    const task = workingMemoryEntries.find(e => e.category === 'task')
    const problems = workingMemoryEntries
      .filter(e => e.category === 'task' && e.metadata?.itemType === 'problem')
      .map(e => ({ id: e.id, content: e.content, resolved: e.metadata?.resolved || false, createdAt: e.createdAt }))
    const decisions = workingMemoryEntries
      .filter(e => e.category === 'task' && e.metadata?.itemType === 'decision')
      .map(e => ({ id: e.id, content: e.content, createdAt: e.createdAt }))
    const todos = workingMemoryEntries
      .filter(e => e.category === 'task' && e.metadata?.itemType === 'todo')
      .map(e => ({ id: e.id, content: e.content, resolved: e.metadata?.resolved || false, createdAt: e.createdAt }))
    const snippets = workingMemoryEntries
      .filter(e => e.category === 'task' && e.metadata?.itemType === 'snippet')
      .map(e => ({ id: e.id, content: e.content, filePath: e.metadata?.filePath || '', lineRange: e.metadata?.lineRange || '', createdAt: e.createdAt }))

    return {
      currentTask: task?.content || '',
      problems,
      decisions,
      todos,
      snippets
    }
  }

  const wm = parseWorkingMemory()

  // 事件处理
  const handleCreateTask = async () => {
    if (!newTask.trim()) return
    await store.createEntry({
      type: 'working-memory',
      scope: 'project',
      lifecycle: 'temporary',
      sessionId,
      projectPath,
      category: 'task',
      title: '当前任务',
      content: newTask.trim(),
      priority: 'medium',
      source: 'manual',
      autoInject: true
    })
    setNewTask('')
  }

  const handleAddProblem = async () => {
    if (!newProblem.trim()) return
    await store.createEntry({
      type: 'working-memory',
      scope: 'project',
      lifecycle: 'temporary',
      sessionId,
      projectPath,
      category: 'task',
      title: '问题',
      content: newProblem.trim(),
      priority: 'medium',
      source: 'manual',
      autoInject: false,
      metadata: { itemType: 'problem', resolved: false }
    })
    setNewProblem('')
  }

  const handleAddDecision = async () => {
    if (!newDecision.trim()) return
    await store.createEntry({
      type: 'working-memory',
      scope: 'project',
      lifecycle: 'temporary',
      sessionId,
      projectPath,
      category: 'task',
      title: '决策',
      content: newDecision.trim(),
      priority: 'medium',
      source: 'manual',
      autoInject: false,
      metadata: { itemType: 'decision' }
    })
    setNewDecision('')
  }

  const handleAddTodo = async () => {
    if (!newTodo.trim()) return
    await store.createEntry({
      type: 'working-memory',
      scope: 'project',
      lifecycle: 'temporary',
      sessionId,
      projectPath,
      category: 'task',
      title: '待办',
      content: newTodo.trim(),
      priority: 'medium',
      source: 'manual',
      autoInject: false,
      metadata: { itemType: 'todo', resolved: false }
    })
    setNewTodo('')
  }

  const handleResolveItem = async (id: string) => {
    const entry = store.getEntryById(id)
    if (!entry) return
    await store.updateEntry(id, {
      metadata: { ...entry.metadata, resolved: true }
    })
  }

  const handleDeleteItem = async (id: string) => {
    await store.deleteEntry(id)
  }

  const handleCreateSnapshot = async () => {
    await store.createEntry({
      type: 'working-memory',
      scope: 'project',
      lifecycle: 'temporary',
      sessionId,
      projectPath,
      category: 'context',
      title: `快照 ${new Date().toLocaleTimeString()}`,
      content: JSON.stringify(wm, null, 2),
      priority: 'low',
      source: 'manual',
      autoInject: false,
      metadata: { itemType: 'snapshot' }
    })
  }

  if (!sessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm p-6">
        <Target className="w-8 h-8 mb-3 opacity-40" />
        <p>请先选择一个会话</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Target className="w-4 h-4 text-accent-green" />
          工作记忆
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleCreateSnapshot} title="创建快照"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <Camera className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Task Section */}
      <div className="px-3 py-2 border-b border-border">
        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">当前任务</div>
        {wm.currentTask ? (
          <div>
            <div className="text-xs text-text-primary">{wm.currentTask}</div>
            <button onClick={() => handleDeleteItem(wm.currentTask)}
              className="text-[10px] text-text-muted hover:text-text-primary mt-1">编辑任务</button>
          </div>
        ) : (
          <input className={inputCls} placeholder="描述当前任务..." value={newTask}
            onChange={e => setNewTask(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && newTask.trim()) {
                await handleCreateTask()
              }
            }} />
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1 px-1 py-2 text-[10px] transition-colors ${
              activeTab === tab.key ? 'text-accent-green border-b-2 border-accent-green' : 'text-text-muted hover:text-text-secondary'
            }`}>
            <tab.icon className="w-3 h-3" />
            {tab.label}
            {tab.key === 'problems' && wm.problems.length ? (
              <span className="bg-accent-yellow/20 text-accent-yellow rounded-full px-1 text-[9px]">
                {wm.problems.filter(p => !p.resolved).length}
              </span>
            ) : null}
            {tab.key === 'todos' && wm.todos.length ? (
              <span className="bg-accent-blue/20 text-accent-blue rounded-full px-1 text-[9px]">
                {wm.todos.filter(t => !t.resolved).length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activeTab === 'problems' && (
          <>
            <div className="flex gap-1">
              <input className={inputCls} placeholder="记录遇到的问题..." value={newProblem}
                onChange={e => setNewProblem(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && handleAddProblem()} />
              <button onClick={handleAddProblem} className="shrink-0 p-1.5 rounded bg-accent-yellow/15 text-accent-yellow hover:bg-accent-yellow/25">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {wm.problems.map(p => (
              <div key={p.id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
                p.resolved ? 'border-border bg-bg-tertiary/50 opacity-60' : 'border-accent-yellow/30 bg-accent-yellow/5'
              }`}>
                <button onClick={() => !p.resolved && handleResolveItem(p.id)} className="mt-0.5 shrink-0">
                  {p.resolved ? <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" /> : <AlertTriangle className="w-3.5 h-3.5 text-accent-yellow" />}
                </button>
                <span className={p.resolved ? 'line-through text-text-muted' : 'text-text-primary'}>{p.content}</span>
                <button onClick={() => handleDeleteItem(p.id)} className="ml-auto shrink-0 text-text-muted hover:text-accent-red">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </>
        )}

        {activeTab === 'decisions' && (
          <>
            <div className="flex gap-1">
              <input className={inputCls} placeholder="记录关键决策..." value={newDecision}
                onChange={e => setNewDecision(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && handleAddDecision()} />
              <button onClick={handleAddDecision} className="shrink-0 p-1.5 rounded bg-accent-purple/15 text-accent-purple hover:bg-accent-purple/25">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {wm.decisions.map(d => (
              <div key={d.id} className="flex items-start gap-2 p-2 rounded-lg border border-border bg-bg-tertiary/50 text-xs">
                <Lightbulb className="w-3.5 h-3.5 text-accent-purple shrink-0 mt-0.5" />
                <span className="text-text-primary">{d.content}</span>
                <span className="ml-auto text-text-muted shrink-0 text-[10px]">{new Date(d.createdAt).toLocaleTimeString()}</span>
                <button onClick={() => handleDeleteItem(d.id)} className="shrink-0 text-text-muted hover:text-accent-red">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </>
        )}

        {activeTab === 'todos' && (
          <>
            <div className="flex gap-1">
              <input className={inputCls} placeholder="添加待办..." value={newTodo}
                onChange={e => setNewTodo(e.target.value)} 
                onKeyDown={e => e.key === 'Enter' && handleAddTodo()} />
              <button onClick={handleAddTodo} className="shrink-0 p-1.5 rounded bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {wm.todos.map(t => (
              <div key={t.id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
                t.resolved ? 'border-border bg-bg-tertiary/50 opacity-60' : 'border-border'
              }`}>
                <button onClick={() => !t.resolved && handleResolveItem(t.id)} className="mt-0.5 shrink-0">
                  {t.resolved ? <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" /> : <div className="w-3.5 h-3.5 rounded border border-border" />}
                </button>
                <span className={t.resolved ? 'line-through text-text-muted' : 'text-text-primary'}>{t.content}</span>
                <button onClick={() => handleDeleteItem(t.id)} className="ml-auto shrink-0 text-text-muted hover:text-accent-red">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </>
        )}

        {activeTab === 'snippets' && (
          <>
            {wm.snippets.length === 0 && (
              <div className="text-xs text-text-muted text-center py-4">代码片段可在文件管理器中右键注入</div>
            )}
            {wm.snippets.map(s => (
              <div key={s.id} className="p-2 rounded-lg border border-border bg-bg-tertiary/50 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-text-secondary font-medium">{s.filePath.split('/').pop()}</span>
                  <button onClick={() => handleDeleteItem(s.id)} className="text-text-muted hover:text-accent-red">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {s.lineRange && <div className="text-[9px] text-text-muted mb-1">行 {s.lineRange}</div>}
                <pre className="text-text-primary bg-bg-primary rounded p-1.5 overflow-x-auto text-[10px] leading-relaxed">{s.content}</pre>
              </div>
            ))}
          </>
        )}

        {activeTab === 'task' && (
          <div className="space-y-3">
            <textarea className={`${inputCls} min-h-[80px] resize-y`} placeholder="描述当前任务目标..."
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              onBlur={async (e) => {
                if (e.target.value.trim()) {
                  await handleCreateTask()
                }
              }} />
            <div className="text-[10px] text-text-muted">
              工作记忆会自动注入到 AI 对话上下文中，帮助 AI 理解你的当前任务和遇到的问题。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
