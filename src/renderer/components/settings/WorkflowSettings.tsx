/**
 * WorkflowSettings - 工作流编排配置面板
 */
import { useState, useEffect } from 'react'
import {
  Play, Trash2, Plus, Loader2, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, AlertCircle, Zap, Code2, Clock, GitBranch
} from 'lucide-react'
import { useWorkflowStore, type Workflow, type WorkflowStep, type WorkflowRun } from '../../stores/workflowStore'

const STEP_TYPE_LABELS: Record<string, string> = {
  prompt: 'Prompt',
  http: 'HTTP',
  condition: '条件',
  delay: '延迟',
}

const STEP_TYPE_ICONS: Record<string, React.ReactNode> = {
  prompt: <Zap className="w-3.5 h-3.5 text-accent-yellow" />,
  http: <Code2 className="w-3.5 h-3.5 text-accent-blue" />,
  condition: <GitBranch className="w-3.5 h-3.5 text-accent-purple" />,
  delay: <Clock className="w-3.5 h-3.5 text-accent-green" />,
}

const RUN_STATUS_COLORS: Record<string, string> = {
  pending: 'text-text-muted',
  running: 'text-accent-yellow',
  completed: 'text-accent-green',
  failed: 'text-accent-red',
  skipped: 'text-text-muted',
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  skipped: '跳过',
}

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  running: '运行中',
  paused: '已暂停',
}

function renderRunIcon(runStatus: string) {
  if (runStatus === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
  if (runStatus === 'failed') return <XCircle className="w-3.5 h-3.5 text-accent-red" />
  if (runStatus === 'running') return <Loader2 className="w-3.5 h-3.5 text-accent-yellow animate-spin" />
  return <AlertCircle className="w-3.5 h-3.5 text-text-muted" />
}

export default function WorkflowSettings() {
  const {
    workflows,
    loading,
    status,
    fetchWorkflows,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    executeWorkflow,
    fetchRuns,
    initListeners,
    cleanup,
  } = useWorkflowStore()

  const [activeTab, setActiveTab] = useState<'workflows' | 'executions'>('workflows')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newStepsJson, setNewStepsJson] = useState('[]')
  const [newVarsJson, setNewVarsJson] = useState('{}')
  const [saving, setSaving] = useState(false)
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null)
  const [workflowRuns, setWorkflowRuns] = useState<Record<string, WorkflowRun[]>>({})
  const [showStepEditor, setShowStepEditor] = useState(false)
  const [editingSteps, setEditingSteps] = useState<WorkflowStep[]>([])
  const [stepErrors, setStepErrors] = useState<string | null>(null)

  useEffect(() => {
    fetchWorkflows()
    initListeners()
    return () => cleanup()
  }, [])

  const handleCreateWorkflow = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      let steps: WorkflowStep[] = []
      let variables: Record<string, any> = {}
      try { steps = JSON.parse(newStepsJson) } catch { setStepErrors('Steps JSON 格式错误'); setSaving(false); return }
      try { variables = JSON.parse(newVarsJson) } catch { setStepErrors('Variables JSON 格式错误'); setSaving(false); return }

      const result = await createWorkflow({
        name: newName.trim(),
        description: newDescription.trim(),
        steps,
        variables,
      })
      if (result.success) {
        setShowCreateForm(false)
        setNewName(''); setNewDescription(''); setNewStepsJson('[]'); setNewVarsJson('{}'); setStepErrors(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleExecute = async (workflowId: string) => {
    await executeWorkflow(workflowId, 'manual')
  }

  const handleDelete = async (workflowId: string) => {
    if (!confirm('确定删除此工作流？')) return
    await deleteWorkflow(workflowId)
  }

  const toggleExpand = async (workflowId: string) => {
    if (expandedWorkflow === workflowId) {
      setExpandedWorkflow(null)
    } else {
      setExpandedWorkflow(workflowId)
    }
  }

  const openStepEditor = (workflow: Workflow) => {
    setShowStepEditor(true)
    setEditingSteps([...(workflow.steps || [])])
    setExpandedWorkflow(workflow.id)
  }

  const addStep = (type: string) => {
    const stepId = `step-${Date.now()}`
    const newStep: WorkflowStep = {
      id: stepId,
      type: type as WorkflowStep['type'],
      name: `新${STEP_TYPE_LABELS[type]}步骤`,
    }
    if (type === 'prompt') {
      newStep.prompt = ''
      newStep.providerId = 'claude-code'
    } else if (type === 'http') {
      newStep.httpMethod = 'GET'
      newStep.httpUrl = ''
    } else if (type === 'delay') {
      newStep.delayMs = 1000
    } else if (type === 'condition') {
      newStep.conditionExpression = 'context.value === true'
    }
    setEditingSteps([...editingSteps, newStep])
  }

  const removeStep = (stepId: string) => {
    setEditingSteps(editingSteps.filter(s => s.id !== stepId))
  }

  const updateStep = (stepId: string, updates: Partial<WorkflowStep>) => {
    setEditingSteps(editingSteps.map(s => s.id === stepId ? { ...s, ...updates } : s))
  }

  const saveStepEditor = async (workflowId: string) => {
    setStepErrors(null)
    try {
      JSON.stringify(editingSteps) // validate
    } catch {
      setStepErrors('Steps JSON 序列化失败')
      return
    }
    await updateWorkflow(workflowId, { steps: editingSteps })
  }

  const getStepJson = (steps: WorkflowStep[]): string => {
    return JSON.stringify(steps, null, 2)
  }

  const renderStepItem = (step: WorkflowStep, index: number) => (
    <div key={step.id} className="flex items-start gap-2 p-2 bg-bg-secondary rounded-lg border border-border/50">
      <div className="mt-0.5">{STEP_TYPE_ICONS[step.type] || <Zap className="w-3.5 h-3.5" />}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">{step.name || step.id}</span>
          <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-xs text-text-muted">{STEP_TYPE_LABELS[step.type] || step.type}</span>
        </div>
        {step.type === 'prompt' && step.prompt && (
          <p className="text-xs text-text-muted mt-0.5 truncate">{step.prompt}</p>
        )}
        {step.type === 'http' && (
          <p className="text-xs text-text-muted mt-0.5 font-mono">{step.httpMethod} {step.httpUrl}</p>
        )}
        {step.type === 'condition' && (
          <p className="text-xs text-text-muted mt-0.5 font-mono">{step.conditionExpression}</p>
        )}
        {step.type === 'delay' && (
          <p className="text-xs text-text-muted mt-0.5">{step.delayMs}ms</p>
        )}
      </div>
      <button onClick={() => removeStep(step.id)} className="p-1 text-text-muted hover:text-accent-red">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 状态栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
          <span className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-accent-green' : 'bg-text-muted'}`} />
          <span className={`text-sm ${status === 'running' ? 'text-accent-green' : 'text-text-muted'}`}>
            {status === 'running' ? '运行中' : '已停止'}
          </span>
          <span className="text-xs text-text-muted">· {workflows.length} 个工作流</span>
        </div>
        <button
          onClick={() => { setShowCreateForm(true); setActiveTab('workflows') }}
          className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新建工作流
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
        {(['workflows', 'executions'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'workflows' ? `工作流 (${workflows.length})` : '执行历史'}
          </button>
        ))}
      </div>

      {/* 新建表单 */}
      {showCreateForm && (
        <div className="p-4 bg-bg-tertiary rounded-xl border border-border space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">新建工作流</p>
            <button onClick={() => setShowCreateForm(false)} className="text-text-muted hover:text-text-secondary">
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          {/* 工作流名称 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">工作流名称 *</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="例如：代码审查流程"
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述</label>
            <input
              type="text"
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="可选描述"
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* 步骤 JSON */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">步骤定义 (JSON)</label>
            <textarea
              value={newStepsJson}
              onChange={e => setNewStepsJson(e.target.value)}
              placeholder='[{"id":"step1","type":"prompt","name":"分析代码","prompt":"请审查代码"}]'
              rows={4}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none font-mono"
            />
            <p className="mt-1 text-xs text-text-muted">支持 prompt / http / condition / delay 类型</p>
          </div>

          {/* 变量 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">初始变量 (JSON)</label>
            <input
              type="text"
              value={newVarsJson}
              onChange={e => setNewVarsJson(e.target.value)}
              placeholder='{}'
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue font-mono"
            />
          </div>

          {stepErrors && <p className="text-xs text-accent-red">{stepErrors}</p>}

          <button
            onClick={handleCreateWorkflow}
            disabled={!newName.trim() || saving}
            className="w-full py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            创建工作流
          </button>
        </div>
      )}

      {/* 工作流列表 */}
      {activeTab === 'workflows' && (
        <div className="space-y-2">
          {workflows.length === 0 ? (
            <div className="py-8 text-center">
              <Zap className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">暂无工作流</p>
              <p className="text-xs text-text-muted mt-1">点击上方「新建工作流」创建第一个工作流</p>
            </div>
          ) : (
            workflows.map(workflow => (
              <div key={workflow.id} className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
                {/* 工作流行 */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button onClick={() => toggleExpand(workflow.id)} className="text-text-muted hover:text-text-secondary">
                    {expandedWorkflow === workflow.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{workflow.name}</p>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        workflow.status === 'draft' ? 'bg-bg-secondary text-text-muted' :
                        workflow.status === 'running' ? 'bg-accent-green/10 text-accent-green' :
                        'bg-accent-orange/10 text-accent-orange'
                      }`}>
                        {STATUS_LABELS[workflow.status] || workflow.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-text-muted">{workflow.steps?.length || 0} 个步骤</span>
                      {workflow.description && <span className="text-xs text-text-muted truncate">{workflow.description}</span>}
                    </div>
                  </div>

                  {/* 编辑步骤 */}
                  <button
                    onClick={() => openStepEditor(workflow)}
                    title="编辑步骤"
                    className="p-1.5 text-accent-blue hover:bg-accent-blue/10 rounded btn-transition"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                  </button>

                  {/* 执行 */}
                  <button
                    onClick={() => handleExecute(workflow.id)}
                    title="执行工作流"
                    className="p-1.5 text-accent-green hover:bg-accent-green/10 rounded btn-transition"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>

                  {/* 删除 */}
                  <button
                    onClick={() => handleDelete(workflow.id)}
                    className="p-1.5 text-text-muted hover:text-accent-red rounded btn-transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 扩展详情 */}
                {expandedWorkflow === workflow.id && (
                  <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border/50">
                    {/* 步骤编辑器 */}
                    {showStepEditor && editingSteps.length > 0 && (
                      <div className="mt-2 p-3 bg-bg-secondary rounded-lg border border-border space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-text-secondary">步骤编辑器</p>
                          <div className="flex gap-1">
                            {(['prompt', 'http', 'condition', 'delay'] as const).map(type => (
                              <button
                                key={type}
                                onClick={() => addStep(type)}
                                className="px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-secondary hover:border-accent-blue/40"
                              >
                                + {STEP_TYPE_LABELS[type]}
                              </button>
                            ))}
                          </div>
                        </div>
                        {editingSteps.map((step, idx) => renderStepItem(step, idx))}
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveStepEditor(workflow.id)}
                            className="flex-1 py-1.5 bg-accent-blue text-white rounded text-xs font-medium hover:bg-accent-blue/80"
                          >
                            保存步骤
                          </button>
                          <button
                            onClick={() => setShowStepEditor(false)}
                            className="px-3 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-secondary"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 简单 JSON 编辑 */}
                    {!showStepEditor && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-medium text-text-secondary">步骤定义</p>
                          <button
                            onClick={() => setShowStepEditor(true)}
                            className="text-xs text-accent-blue hover:underline"
                          >
                            可视化编辑
                          </button>
                        </div>
                        <pre className="text-xs text-text-muted font-mono bg-bg-secondary p-2 rounded max-h-48 overflow-auto">
                          {getStepJson(workflow.steps || [])}
                        </pre>
                      </div>
                    )}

                    {/* 变量 */}
                    {Object.keys(workflow.variables || {}).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-text-secondary mb-1">初始变量</p>
                        <pre className="text-xs text-text-muted font-mono bg-bg-secondary p-2 rounded">
                          {JSON.stringify(workflow.variables, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* 步骤类型说明 */}
                    <div className="p-2 bg-bg-secondary rounded-lg">
                      <p className="text-xs font-medium text-text-secondary mb-1.5">步骤类型</p>
                      <div className="grid grid-cols-2 gap-1.5 text-xs text-text-muted">
                        <div className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-accent-yellow" /> prompt - 在会话中执行指令</div>
                        <div className="flex items-center gap-1.5"><Code2 className="w-3 h-3 text-accent-blue" /> http - 调用外部 API</div>
                        <div className="flex items-center gap-1.5"><GitBranch className="w-3 h-3 text-accent-purple" /> condition - 条件分支判断</div>
                        <div className="flex items-center gap-1.5"><Clock className="w-3 h-3 text-accent-green" /> delay - 延迟等待</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 执行历史 Tab */}
      {activeTab === 'executions' && (
        <div className="space-y-2">
          {workflows.length === 0 ? (
            <div className="py-8 text-center">
              <AlertCircle className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">暂无执行记录</p>
              <p className="text-xs text-text-muted mt-1">执行工作流后将显示执行历史</p>
            </div>
          ) : (
            <div className="space-y-3">
              {workflows.map(wf => (
                <div key={wf.id}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-text-secondary">{wf.name}</span>
                    <button
                      onClick={() => handleExecute(wf.id)}
                      className="px-2 py-0.5 bg-accent-green/10 text-accent-green rounded text-xs hover:bg-accent-green/20"
                    >
                      <Play className="w-3 h-3 inline" /> 执行
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
