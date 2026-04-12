/**
 * 工作记忆面板 - 会话级工作上下文管理
 * 显示当前会话的任务、问题、决策、待办、代码片段
 * 集成漂移检测护栏状态
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Brain, Target, AlertTriangle, CheckCircle2, Lightbulb,
  ListTodo, Code2, Camera, Plus, Play, Pause, Shield, X
} from 'lucide-react'
import { useWorkingContextStore, type WorkingContext } from '../../stores/workingContextStore'
import { useDriftGuardStore, type SessionDriftState, type DriftConfig } from '../../stores/driftGuardStore'
import { useSessionStore } from '../../stores/sessionStore'

type TabKey = 'task' | 'problems' | 'decisions' | 'todos' | 'snippets'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'task',      label: '任务',   icon: Target },
  { key: 'problems',  label: '问题',   icon: AlertTriangle },
  { key: 'decisions', label: '决策',   icon: Lightbulb },
  { key: 'todos',     label: '待办',   icon: ListTodo },
  { key: 'snippets',  label: '片段',   icon: Code2 },
]

const inputCls = 'w-full px-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue'

export default function WorkingContextView() {
  const [activeTab, setActiveTab] = useState<TabKey>('task')
  const [showDriftPanel, setShowDriftPanel] = useState(false)

  const activeSessionId = useSessionStore(s => s.currentSessionId)

  // Working Context Store
  const ctx = useWorkingContextStore()
  const context = useWorkingContextStore(s => s.currentContext)
  const loading = useWorkingContextStore(s => s.loading)

  // Drift Guard Store
  const dg = useDriftGuardStore()
  const driftStates = useDriftGuardStore(s => s.monitoringStates)
  const lastDriftResult = useDriftGuardStore(s => s.lastDriftResult)
  const driftConfig = useDriftGuardStore(s => s.config)

  const driftState: SessionDriftState | undefined = activeSessionId ? driftStates.get(activeSessionId) : undefined
  const isMonitoring = !!driftState && !driftState.paused

  useEffect(() => {
    if (activeSessionId) ctx.get(activeSessionId)
  }, [activeSessionId])

  useEffect(() => {
    dg.getConfig()
  }, [])

  const handleDriftToggle = useCallback(async () => {
    if (!activeSessionId) return
    if (isMonitoring) {
      await dg.stopMonitoring(activeSessionId)
    } else {
      await dg.startMonitoring(activeSessionId, '')
    }
  }, [activeSessionId, isMonitoring])

  const [newProblem, setNewProblem] = useState('')
  const [newDecision, setNewDecision] = useState('')
  const [newTodo, setNewTodo] = useState('')

  const handleAddProblem = async () => {
    if (!newProblem.trim() || !activeSessionId) return
    await ctx.addProblem(activeSessionId, newProblem.trim())
    setNewProblem('')
  }
  const handleAddDecision = async () => {
    if (!newDecision.trim() || !activeSessionId) return
    await ctx.addDecision(activeSessionId, newDecision.trim())
    setNewDecision('')
  }
  const handleAddTodo = async () => {
    if (!newTodo.trim() || !activeSessionId) return
    await ctx.addTodo(activeSessionId, newTodo.trim())
    setNewTodo('')
  }
  const handleSnapshot = async () => {
    if (!activeSessionId) return
    await ctx.createSnapshot(activeSessionId, 'manual')
  }

  if (!activeSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted text-sm p-6">
        <Brain className="w-8 h-8 mb-3 opacity-40" />
        <p>请先选择一个会话</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Brain className="w-4 h-4 text-accent-purple" />
          工作记忆
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleSnapshot} title="创建快照"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <Camera className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowDriftPanel(!showDriftPanel)} title="漂移检测"
            className={`p-1 rounded hover:bg-bg-hover transition-colors ${isMonitoring ? 'text-accent-green' : 'text-text-muted hover:text-text-primary'}`}>
            <Shield className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Drift Guard Bar */}
      {showDriftPanel && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">漂移检测</span>
            <button onClick={handleDriftToggle}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                isMonitoring ? 'bg-accent-green/15 text-accent-green border border-accent-green/30' : 'bg-bg-secondary text-text-muted border border-border hover:text-text-primary'
              }`}>
              {isMonitoring ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {isMonitoring ? '暂停' : '启动'}
            </button>
          </div>
          {isMonitoring && driftState && driftConfig && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-text-muted">轮次 {driftState.turnCount}/{driftConfig.checkIntervalTurns}</span>
              <span className={lastDriftResult ? 'text-accent-yellow' : 'text-text-muted'}>
                {lastDriftResult?.severity === 'none' || !lastDriftResult ? '正常' :
                 lastDriftResult.severity === 'minor' ? '轻微偏移' :
                 lastDriftResult.severity === 'moderate' ? '中度漂移' : '严重漂移'}
              </span>
            </div>
          )}
          {lastDriftResult && lastDriftResult.severity !== 'none' && (
            <div className="text-[10px] text-accent-yellow bg-accent-yellow/10 rounded px-2 py-1">
              {lastDriftResult.suggestion}
            </div>
          )}
        </div>
      )}

      {/* Task Section */}
      <div className="px-3 py-2 border-b border-border">
        <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">当前任务</div>
        {context?.currentTask ? (
          <div>
            <div className="text-xs text-text-primary">{context.currentTask}</div>
            <button onClick={() => ctx.updateTask(activeSessionId, '')}
              className="text-[10px] text-text-muted hover:text-text-primary mt-1">编辑任务</button>
          </div>
        ) : (
          <input className={inputCls} placeholder="描述当前任务..." onKeyDown={async (e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              await ctx.updateTask(activeSessionId, e.currentTarget.value.trim())
              e.currentTarget.value = ''
            }
          }} />
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1 px-1 py-2 text-[10px] transition-colors ${
              activeTab === tab.key ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-text-muted hover:text-text-secondary'
            }`}>
            <tab.icon className="w-3 h-3" />
            {tab.label}
            {tab.key === 'problems' && context?.problems.length ? (
              <span className="bg-accent-red/20 text-accent-red rounded-full px-1 text-[9px]">{context.problems.filter(p => !p.resolved).length}</span>
            ) : null}
            {tab.key === 'todos' && context?.todos.length ? (
              <span className="bg-accent-blue/20 text-accent-blue rounded-full px-1 text-[9px]">{context.todos.filter(t => !t.resolved).length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-xs text-text-muted text-center py-4">加载中...</div>}

        {activeTab === 'problems' && (
          <>
            <div className="flex gap-1">
              <input className={inputCls} placeholder="记录遇到的问题..." value={newProblem}
                onChange={e => setNewProblem(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddProblem()} />
              <button onClick={handleAddProblem} className="shrink-0 p-1.5 rounded bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {context?.problems.map(p => (
              <div key={p.id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
                p.resolved ? 'border-border bg-bg-tertiary/50 opacity-60' : 'border-accent-yellow/30 bg-accent-yellow/5'
              }`}>
                <button onClick={() => !p.resolved && ctx.resolveProblem(activeSessionId, p.id)} className="mt-0.5 shrink-0">
                  {p.resolved ? <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" /> : <AlertTriangle className="w-3.5 h-3.5 text-accent-yellow" />}
                </button>
                <span className={p.resolved ? 'line-through text-text-muted' : 'text-text-primary'}>{p.content}</span>
                <button onClick={() => ctx.removeItem(activeSessionId, 'problems', p.id)} className="ml-auto shrink-0 text-text-muted hover:text-accent-red">
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
                onChange={e => setNewDecision(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDecision()} />
              <button onClick={handleAddDecision} className="shrink-0 p-1.5 rounded bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {context?.decisions.map(d => (
              <div key={d.id} className="flex items-start gap-2 p-2 rounded-lg border border-border bg-bg-tertiary/50 text-xs">
                <Lightbulb className="w-3.5 h-3.5 text-accent-purple shrink-0 mt-0.5" />
                <span className="text-text-primary">{d.content}</span>
                <span className="ml-auto text-text-muted shrink-0 text-[10px]">{new Date(d.createdAt).toLocaleTimeString()}</span>
                <button onClick={() => ctx.removeItem(activeSessionId, 'decisions', d.id)} className="shrink-0 text-text-muted hover:text-accent-red">
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
                onChange={e => setNewTodo(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTodo()} />
              <button onClick={handleAddTodo} className="shrink-0 p-1.5 rounded bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {context?.todos.map(t => (
              <div key={t.id} className={`flex items-start gap-2 p-2 rounded-lg border text-xs ${
                t.resolved ? 'border-border bg-bg-tertiary/50 opacity-60' : 'border-border'
              }`}>
                <button onClick={() => !t.resolved && ctx.resolveTodo(activeSessionId, t.id)} className="mt-0.5 shrink-0">
                  {t.resolved ? <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" /> : <div className="w-3.5 h-3.5 rounded border border-border" />}
                </button>
                <span className={t.resolved ? 'line-through text-text-muted' : 'text-text-primary'}>{t.content}</span>
                <button onClick={() => ctx.removeItem(activeSessionId, 'todos', t.id)} className="ml-auto shrink-0 text-text-muted hover:text-accent-red">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </>
        )}

        {activeTab === 'snippets' && (
          <>
            {context?.codeSnippets.length === 0 && (
              <div className="text-xs text-text-muted text-center py-4">代码片段可在文件管理器中右键注入</div>
            )}
            {context?.codeSnippets.map(s => (
              <div key={s.id} className="p-2 rounded-lg border border-border bg-bg-tertiary/50 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-text-secondary font-medium">{s.filePath.split('/').pop()}</span>
                  <button onClick={() => ctx.removeItem(activeSessionId, 'codeSnippets', s.id)} className="text-text-muted hover:text-accent-red">
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
              defaultValue={context?.currentTask || ''} onBlur={async (e) => {
                if (e.target.value.trim() !== (context?.currentTask || '')) {
                  await ctx.updateTask(activeSessionId, e.target.value.trim())
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
