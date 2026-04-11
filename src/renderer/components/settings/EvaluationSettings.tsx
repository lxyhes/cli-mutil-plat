/**
 * Evaluation Settings - 任务评估配置面板
 */
import { useState, useEffect } from 'react'
import {
  Target, Plus, Trash2, Play, Loader2, Check, AlertCircle, XCircle,
  ChevronDown, ChevronRight, CheckCircle2, X, Edit2, BarChart3
} from 'lucide-react'
import {
  useEvaluationStore,
  type EvaluationTemplate,
  type EvaluationRun,
  type EvaluationResult,
  type EvaluationCriterion,
} from '../../stores/evaluationStore'
import { useSessionStore } from '../../stores/sessionStore'

const DEFAULT_PROMPT_TEMPLATE = `你是一位专业的 AI 代码质量评估专家。请对以下 AI 会话进行多维度评估。

评估要点：
- 代码正确性：生成的代码是否功能正确
- 代码质量：是否符合最佳实践
- 问题解决：是否有效解决了用户问题
- 工具使用：是否恰当使用了可用工具

请仔细阅读会话内容，为每个维度给出客观评分。`

const DEFAULT_CRITERIA: EvaluationCriterion[] = [
  { name: '代码正确性', description: '生成的代码是否功能正确、无语法错误', max_score: 10, weight: 1.0 },
  { name: '代码质量', description: '是否符合最佳实践、代码可读性、可维护性', max_score: 10, weight: 1.0 },
  { name: '问题解决', description: '是否有效解决了用户提出的问题', max_score: 10, weight: 1.0 },
  { name: '工具使用', description: '是否恰当使用了可用工具和命令', max_score: 10, weight: 1.0 },
]

const RUN_STATUS_COLORS: Record<string, string> = {
  pending: 'text-text-muted',
  running: 'text-accent-yellow',
  completed: 'text-accent-green',
  failed: 'text-accent-red',
}

const RUN_STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <AlertCircle className="w-3.5 h-3.5 text-text-muted" />,
  running: <Loader2 className="w-3.5 h-3.5 text-accent-yellow animate-spin" />,
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />,
  failed: <XCircle className="w-3.5 h-3.5 text-accent-red" />,
}

export default function EvaluationSettings() {
  const {
    templates,
    runs,
    results,
    loading,
    fetchTemplates,
    fetchRuns,
    fetchResults,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    startRun,
    initListeners,
    cleanup,
  } = useEvaluationStore()

  const { sessions, fetchSessions } = useSessionStore()

  const [activeTab, setActiveTab] = useState<'templates' | 'runs'>('templates')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EvaluationTemplate | null>(null)

  // Create/edit form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrompt, setFormPrompt] = useState(DEFAULT_PROMPT_TEMPLATE)
  const [formCriteria, setFormCriteria] = useState<EvaluationCriterion[]>(DEFAULT_CRITERIA)
  const [saving, setSaving] = useState(false)

  // Run evaluation state
  const [runSessionId, setRunSessionId] = useState('')
  const [runTemplateId, setRunTemplateId] = useState('')
  const [running, setRunning] = useState(false)

  // Results view state
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  useEffect(() => {
    fetchTemplates()
    fetchRuns()
    fetchSessions()
    initListeners()
    return () => cleanup()
  }, [])

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormPrompt(DEFAULT_PROMPT_TEMPLATE)
    setFormCriteria(DEFAULT_CRITERIA)
    setEditingTemplate(null)
  }

  const handleCreateTemplate = async () => {
    if (!formName.trim()) return
    setSaving(true)
    try {
      if (editingTemplate) {
        await updateTemplate(editingTemplate.id, {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          promptTemplate: formPrompt,
          criteria: formCriteria,
        })
      } else {
        await createTemplate({
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          promptTemplate: formPrompt,
          criteria: formCriteria,
        })
      }
      setShowCreateForm(false)
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  const handleEditTemplate = (template: EvaluationTemplate) => {
    setEditingTemplate(template)
    setFormName(template.name)
    setFormDescription(template.description || '')
    setFormPrompt(template.promptTemplate)
    setFormCriteria(template.criteria.length > 0 ? template.criteria : DEFAULT_CRITERIA)
    setShowCreateForm(true)
  }

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('确定删除此评估模板？相关评估记录也会被删除。')) return
    await deleteTemplate(templateId)
  }

  const handleStartEvaluation = async () => {
    if (!runSessionId || !runTemplateId) return
    setRunning(true)
    try {
      await startRun(runSessionId, runTemplateId)
      fetchRuns()
    } finally {
      setRunning(false)
    }
  }

  const handleViewResults = async (runId: string) => {
    setSelectedRunId(runId)
    if (!results[runId]) {
      await fetchResults(runId)
    }
  }

  const toggleExpandRun = (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null)
    } else {
      setExpandedRun(runId)
      handleViewResults(runId)
    }
  }

  const getTemplate = (templateId: string) => templates.find(t => t.id === templateId)
  const getSession = (sessionId: string) => sessions.find(s => s.id === sessionId)

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'bg-accent-green'
    if (score >= 0.6) return 'bg-accent-yellow'
    if (score >= 0.4) return 'bg-accent-orange'
    return 'bg-accent-red'
  }

  return (
    <div className="space-y-4 p-4 min-w-0">
      {/* 状态栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
          <Target className="w-4 h-4 text-accent-purple" />
          <span className="text-sm text-text-primary">{templates.length} 个模板</span>
          <span className="text-xs text-text-muted">·</span>
          <span className="text-sm text-text-muted">{runs.length} 次评估</span>
        </div>
        <button
          onClick={() => { setShowCreateForm(true); resetForm() }}
          className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新建模板
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
        {(['templates', 'runs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'templates' ? `评估模板 (${templates.length})` : `评估记录 (${runs.length})`}
          </button>
        ))}
      </div>

      {/* 快速运行评估 */}
      <div className="p-3 bg-bg-tertiary rounded-xl border border-border">
        <p className="text-xs font-medium text-text-secondary mb-2 flex items-center gap-1.5">
          <Play className="w-3.5 h-3.5 text-accent-green" />
          快速运行评估
        </p>
        <div className="flex gap-2">
          <select
            value={runSessionId}
            onChange={e => setRunSessionId(e.target.value)}
            className="flex-1 px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent-blue"
          >
            <option value="">选择会话...</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={runTemplateId}
            onChange={e => setRunTemplateId(e.target.value)}
            className="flex-1 px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent-blue"
          >
            <option value="">选择模板...</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            onClick={handleStartEvaluation}
            disabled={!runSessionId || !runTemplateId || running}
            className="px-3 py-1.5 bg-accent-green text-white rounded-lg text-xs font-medium hover:bg-accent-green/80 btn-transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            评估
          </button>
        </div>
      </div>

      {/* 新建/编辑表单 */}
      {showCreateForm && (
        <div className="p-4 bg-bg-tertiary rounded-xl border border-border space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">
              {editingTemplate ? '编辑模板' : '新建评估模板'}
            </p>
            <button
              onClick={() => { setShowCreateForm(false); resetForm() }}
              className="text-text-muted hover:text-text-secondary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 名称 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">模板名称 *</label>
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="例如：代码质量评估"
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述</label>
            <input
              type="text"
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder="可选描述"
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* 评估维度 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-secondary">评估维度</label>
              <button
                onClick={() => setFormCriteria([...formCriteria, { name: '', description: '', max_score: 10, weight: 1.0 }])}
                className="text-xs text-accent-blue hover:text-accent-blue/80 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> 添加维度
              </button>
            </div>
            <div className="space-y-2">
              {formCriteria.map((c, i) => (
                <div key={i} className="flex gap-2 items-start p-2 bg-bg-secondary rounded-lg border border-border/50">
                  <div className="flex-1 space-y-1.5">
                    <input
                      type="text"
                      value={c.name}
                      onChange={e => {
                        const criteria = [...formCriteria]
                        criteria[i].name = e.target.value
                        setFormCriteria(criteria)
                      }}
                      placeholder="维度名称"
                      className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                    />
                    <input
                      type="text"
                      value={c.description}
                      onChange={e => {
                        const criteria = [...formCriteria]
                        criteria[i].description = e.target.value
                        setFormCriteria(criteria)
                      }}
                      placeholder="维度描述"
                      className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                    />
                  </div>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      value={c.max_score}
                      onChange={e => {
                        const criteria = [...formCriteria]
                        criteria[i].max_score = parseInt(e.target.value) || 10
                        setFormCriteria(criteria)
                      }}
                      min={1}
                      max={100}
                      className="w-14 px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary text-center focus:outline-none focus:border-accent-blue"
                    />
                    <span className="text-xs text-text-muted">分</span>
                    <button
                      onClick={() => setFormCriteria(formCriteria.filter((_, idx) => idx !== i))}
                      className="p-1 text-text-muted hover:text-accent-red rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Prompt 模板 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">评估 Prompt 模板</label>
            <p className="text-xs text-text-muted mb-1.5">
              使用 {'{conversation}'} 或 {'{criteria}'} 占位符让 AI 理解上下文
            </p>
            <textarea
              value={formPrompt}
              onChange={e => setFormPrompt(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none font-mono"
            />
          </div>

          <button
            onClick={handleCreateTemplate}
            disabled={!formName.trim() || saving}
            className="w-full py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {editingTemplate ? '保存修改' : '创建模板'}
          </button>
        </div>
      )}

      {/* 模板列表 */}
      {activeTab === 'templates' && (
        <div className="space-y-2">
          {templates.length === 0 ? (
            <div className="py-8 text-center">
              <Target className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-xs text-text-muted">暂无评估模板</p>
              <p className="text-xs text-text-muted mt-1">点击上方「新建模板」创建第一个评估模板</p>
            </div>
          ) : (
            templates.map(template => (
              <div key={template.id} className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{template.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-text-muted">
                        {template.criteria.length} 个维度
                      </span>
                      {template.description && (
                        <span className="text-xs text-text-muted truncate max-w-48">
                          · {template.description}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleEditTemplate(template)}
                    className="p-1.5 text-text-muted hover:text-accent-blue rounded btn-transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(template.id)}
                    className="p-1.5 text-text-muted hover:text-accent-red rounded btn-transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* 维度预览 */}
                <div className="px-3 pb-2 pt-0 flex flex-wrap gap-1">
                  {template.criteria.map((c, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-bg-secondary rounded text-xs text-text-secondary">
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 评估记录 */}
      {activeTab === 'runs' && (
        <div className="space-y-2">
          {runs.length === 0 ? (
            <div className="py-8 text-center">
              <BarChart3 className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-xs text-text-muted">暂无评估记录</p>
              <p className="text-xs text-text-muted mt-1">选择会话和模板后开始评估</p>
            </div>
          ) : (
            runs.map(run => {
              const template = getTemplate(run.templateId)
              const session = getSession(run.sessionId)
              const runResults = results[run.id] || []

              return (
                <div key={run.id} className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg-secondary/50"
                    onClick={() => toggleExpandRun(run.id)}
                  >
                    <button className="text-text-muted">
                      {expandedRun === run.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {RUN_STATUS_ICONS[run.status] || RUN_STATUS_ICONS.pending}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {template?.name || run.templateId.slice(0, 16)}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                        <span>会话：{session?.name || run.sessionId.slice(0, 16)}</span>
                        {run.createdAt && (
                          <span>{new Date(run.createdAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs ${RUN_STATUS_COLORS[run.status]}`}>
                      {run.status === 'pending' ? '等待' : run.status === 'running' ? '运行中' : run.status === 'completed' ? '已完成' : '失败'}
                    </span>
                  </div>

                  {/* 展开详情 */}
                  {expandedRun === run.id && run.status === 'completed' && (
                    <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/50">
                      {runResults.length > 0 ? (
                        runResults.map((result, i) => {
                          const criterion = template?.criteria.find(c => c.name === result.criterionName)
                          const maxScore = criterion?.max_score || 10
                          const displayScore = result.score * maxScore
                          const pct = result.score * 100

                          return (
                            <div key={i} className="mt-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-text-primary">{result.criterionName}</span>
                                <span className="text-xs text-text-muted">
                                  {displayScore.toFixed(1)} / {maxScore}
                                </span>
                              </div>
                              <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${getScoreColor(result.score)}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              {result.reasoning && (
                                <p className="text-xs text-text-secondary mt-1">{result.reasoning}</p>
                              )}
                              {result.suggestions && (
                                <p className="text-xs text-accent-blue mt-0.5 italic">{result.suggestions}</p>
                              )}
                            </div>
                          )
                        })
                      ) : (
                        <p className="text-xs text-text-muted mt-2">暂无详细结果</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
