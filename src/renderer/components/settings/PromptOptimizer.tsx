/**
 * PromptOptimizer - 提示词优化管理面板
 * 模板 CRUD、版本管理、测试运行、AI 自动优化
 */
import { useState, useEffect, useRef } from 'react'
import {
  Sparkles, Plus, Trash2, Play, Loader2, Check, AlertCircle, XCircle,
  ChevronDown, ChevronRight, CheckCircle2, X, Edit2, BarChart3,
  Copy, GitCompare, ArrowUp, BookOpen, History, FlaskConical,
  Zap, MessageSquare, Code2, Clock, TrendingUp, Target
} from 'lucide-react'
import {
  usePromptOptimizerStore,
  type PromptTemplate,
  type PromptVersion,
  type PromptTest,
  type PromptOptimizationRun,
  type PromptVariable,
  type TestStats,
} from '../../stores/promptOptimizerStore'
import { useSessionStore } from '../../stores/sessionStore'
import ConfirmDialog from '../common/ConfirmDialog'

// ── Status helpers ──────────────────────────────────────────
const RUN_STATUS_COLORS: Record<string, string> = {
  pending: 'text-text-muted',
  running: 'text-accent-yellow',
  completed: 'text-accent-green',
  failed: 'text-accent-red',
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
}

const RUN_STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <AlertCircle className="w-3.5 h-3.5 text-text-muted" />,
  running: <Loader2 className="w-3.5 h-3.5 text-accent-yellow animate-spin" />,
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />,
  failed: <XCircle className="w-3.5 h-3.5 text-accent-red" />,
}

const getScoreColor = (score: number) => {
  if (score >= 0.8) return 'bg-accent-green'
  if (score >= 0.6) return 'bg-accent-yellow'
  if (score >= 0.4) return 'bg-accent-orange'
  return 'bg-accent-red'
}

const getScoreTextColor = (score: number) => {
  if (score >= 0.8) return 'text-accent-green'
  if (score >= 0.6) return 'text-accent-yellow'
  if (score >= 0.4) return 'text-accent-orange'
  return 'text-accent-red'
}

type TabId = 'templates' | 'versions' | 'testing' | 'optimization'

export default function PromptOptimizer() {
  const store = usePromptOptimizerStore()
  const { sessions, fetchSessions } = useSessionStore()

  const [activeTab, setActiveTab] = useState<TabId>('templates')

  // Create/edit template state
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [templateForm, setTemplateForm] = useState({
    name: '',
    description: '',
    category: '',
    tags: '',
    content: '',
  })
  const [templateVars, setTemplateVars] = useState<PromptVariable[]>([])
  const [savingTemplate, setSavingTemplate] = useState(false)

  // Version editor state
  const [showVersionForm, setShowVersionForm] = useState(false)
  const [versionContent, setVersionContent] = useState('')
  const [versionNotes, setVersionNotes] = useState('')
  const [versionSystemPrompt, setVersionSystemPrompt] = useState('')
  const [savingVersion, setSavingVersion] = useState(false)
  const [compareVersionIds, setCompareVersionIds] = useState<string[]>([])
  const [compareInput, setCompareInput] = useState('')
  const [compareResult, setCompareResult] = useState<any>(null)
  const [comparing, setComparing] = useState(false)

  // Test state
  const [testInput, setTestInput] = useState('')
  const [testProviderId, setTestProviderId] = useState('')
  const [testTargetVersionId, setTestTargetVersionId] = useState('')
  const [runningTest, setRunningTest] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  const [selectedVersionForTest, setSelectedVersionForTest] = useState<string | null>(null)
  const [expandedTest, setExpandedTest] = useState<string | null>(null)

  // Optimization state
  const [optimizationHints, setOptimizationHints] = useState('')
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState<any>(null)
  const [optimizationRun, setOptimizationRun] = useState<PromptOptimizationRun | null>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'template' | 'version'; id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    store.fetchTemplates()
    store.fetchOptimizationRuns()
    fetchSessions()
    store.initListeners()
    return () => store.cleanup()
  }, [])

  // Load versions when a template is selected and on versions tab
  useEffect(() => {
    if (store.activeTemplate && activeTab === 'versions') {
      store.fetchVersions(store.activeTemplate.id)
    }
  }, [store.activeTemplate, activeTab])

  // Load tests when a version is selected on testing tab
  useEffect(() => {
    if (selectedVersionForTest) {
      store.fetchTests(selectedVersionForTest)
      store.fetchTestStats(selectedVersionForTest)
    }
  }, [selectedVersionForTest])

  // ── Template operations ──────────────────────────────────

  const resetTemplateForm = () => {
    setEditingTemplate(null)
    setTemplateForm({ name: '', description: '', category: '', tags: '', content: '' })
    setTemplateVars([])
    setShowTemplateForm(false)
  }

  const openCreateTemplate = () => {
    resetTemplateForm()
    setShowTemplateForm(true)
  }

  const openEditTemplate = (t: PromptTemplate) => {
    setEditingTemplate(t)
    setTemplateForm({
      name: t.name,
      description: t.description || '',
      category: t.category || '',
      tags: t.tags?.join(', ') || '',
      content: '',
    })
    setTemplateVars(t.variables || [])
    setShowTemplateForm(true)
  }

  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim()) return
    setSavingTemplate(true)
    try {
      const data = {
        name: templateForm.name.trim(),
        description: templateForm.description.trim() || undefined,
        category: templateForm.category.trim() || undefined,
        tags: templateForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        variables: templateVars,
        content: templateForm.content.trim(),
      }
      if (editingTemplate) {
        await store.updateTemplate(editingTemplate.id, data)
      } else {
        const result = await store.createTemplate(data)
        if (result?.success && data.content) {
          // auto-create version 1 with content, createVersion 2 with same content
          // The service auto-creates v1, so we update it if content provided
        }
      }
      resetTemplateForm()
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleDeleteTemplate = async () => {
    if (!deleteTarget || deleteTarget.type !== 'template') return
    setDeleting(true)
    try {
      await store.deleteTemplate(deleteTarget.id)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  const addTemplateVar = () => {
    setTemplateVars([...templateVars, { name: '', description: '', defaultValue: '' }])
  }

  const removeTemplateVar = (index: number) => {
    setTemplateVars(templateVars.filter((_, i) => i !== index))
  }

  const updateTemplateVar = (index: number, field: keyof PromptVariable, value: string) => {
    const vars = [...templateVars]
    ;(vars[index] as any)[field] = value
    setTemplateVars(vars)
  }

  // ── Version operations ───────────────────────────────────

  const openCreateVersion = () => {
    setVersionContent('')
    setVersionNotes('')
    setVersionSystemPrompt('')
    setShowVersionForm(true)
  }

  const handleSaveVersion = async () => {
    if (!versionContent.trim() || !store.activeTemplate) return
    setSavingVersion(true)
    try {
      const versions = store.versions[store.activeTemplate.id] || []
      const nextNum = versions.length > 0 ? Math.max(...versions.map(v => v.versionNumber)) + 1 : 1
      await store.createVersion(store.activeTemplate.id, {
        content: versionContent.trim(),
        systemPrompt: versionSystemPrompt.trim() || undefined,
        changeNotes: versionNotes.trim() || undefined,
      })
      setShowVersionForm(false)
    } finally {
      setSavingVersion(false)
    }
  }

  const handleSetBaseline = async (versionId: string) => {
    await store.setBaseline(versionId)
    if (store.activeTemplate) {
      store.fetchVersions(store.activeTemplate.id)
    }
  }

  const handleDeleteVersion = (v: PromptVersion) => {
    setDeleteTarget({ type: 'version', id: v.id, name: `v${v.versionNumber}` })
  }

  // ── Test operations ─────────────────────────────────────

  const handleRunTest = async () => {
    if (!testInput.trim() || !selectedVersionForTest) return
    setRunningTest(true)
    setTestResult(null)
    try {
      const result = await store.runTest(selectedVersionForTest, testInput.trim(), testProviderId || undefined)
      setTestResult(result)
      await store.fetchTests(selectedVersionForTest)
      await store.fetchTestStats(selectedVersionForTest)
    } finally {
      setRunningTest(false)
    }
  }

  const handleCompare = async () => {
    if (compareVersionIds.length !== 2 || !compareInput.trim()) return
    setComparing(true)
    setCompareResult(null)
    try {
      const result = await store.compareVersions(compareVersionIds[0], compareVersionIds[1], compareInput.trim())
      setCompareResult(result)
    } finally {
      setComparing(false)
    }
  }

  // ── Optimization operations ──────────────────────────────

  const handleOptimize = async (strategy: 'auto' | 'hints') => {
    if (!store.activeTemplate || !store.activeVersion) return
    setOptimizing(true)
    setOptimizeResult(null)
    setOptimizationRun(null)
    try {
      let result: any
      if (strategy === 'auto') {
        result = await store.optimizeAuto(store.activeTemplate.id, store.activeVersion.id)
      } else {
        result = await store.optimizeWithHints(store.activeTemplate.id, store.activeVersion.id, optimizationHints)
      }
      setOptimizeResult(result)
      if (result?.runId) {
        const run = await store.fetchOptimizationRun(result.runId)
        if (run) setOptimizationRun((run as any).data || run)
      }
      await store.fetchOptimizationRuns()
    } finally {
      setOptimizing(false)
    }
  }

  const handlePromoteBest = async () => {
    if (!store.activeTemplate) return
    await store.promoteBest(store.activeTemplate.id)
    store.fetchVersions(store.activeTemplate.id)
  }

  // ── Helpers ─────────────────────────────────────────────

  const activeVersions = store.activeTemplate
    ? (store.versions[store.activeTemplate.id] || [])
    : []

  const activeTests = selectedVersionForTest
    ? (store.tests[selectedVersionForTest] || [])
    : []

  const activeStats = selectedVersionForTest
    ? store.testStats[selectedVersionForTest]
    : null

  const handleSelectTemplate = (t: PromptTemplate) => {
    store.setActiveTemplate(t)
    store.fetchVersions(t.id)
    setSelectedVersionForTest(null)
    setCompareVersionIds([])
  }

  const handleSelectVersionForTest = (v: PromptVersion) => {
    setSelectedVersionForTest(v.id)
    store.setActiveVersion(v)
    store.fetchTests(v.id)
    store.fetchTestStats(v.id)
  }

  const providers = [
    { id: 'claude-code', name: 'Claude Code' },
    { id: 'codex', name: 'Codex' },
    { id: 'gemini-cli', name: 'Gemini CLI' },
    { id: 'qwen-coder', name: 'Qwen Coder' },
    { id: 'opencode', name: 'OpenCode' },
    { id: 'iflow', name: 'iFlow' },
  ]

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'templates',    label: '模板',      icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'versions',    label: '版本',      icon: <History className="w-3.5 h-3.5" /> },
    { id: 'testing',      label: '测试',      icon: <FlaskConical className="w-3.5 h-3.5" /> },
    { id: 'optimization', label: 'AI 优化',  icon: <Sparkles className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent-purple/10">
            <Sparkles className="w-4 h-4 text-accent-purple" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">提示词优化器</h2>
            <p className="text-xs text-text-muted">管理和优化 AI 提示词模板</p>
          </div>
        </div>
        <button
          onClick={openCreateTemplate}
          className="px-3 py-1.5 bg-accent-purple text-white rounded-lg text-xs font-medium hover:bg-accent-purple/80 btn-transition flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新建模板
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-4 p-1 bg-bg-tertiary rounded-lg shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-bg-secondary text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-3 min-h-0">

        {/* ── TEMPLATES TAB ── */}
        {activeTab === 'templates' && (
          <>
            {/* Quick stats */}
            <div className="flex gap-3">
              <div className="flex-1 p-3 bg-bg-tertiary rounded-xl border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen className="w-3.5 h-3.5 text-accent-blue" />
                  <span className="text-xs text-text-secondary font-medium">模板总数</span>
                </div>
                <p className="text-xl font-bold text-text-primary">{store.templates.length}</p>
              </div>
              <div className="flex-1 p-3 bg-bg-tertiary rounded-xl border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-accent-purple" />
                  <span className="text-xs text-text-secondary font-medium">优化记录</span>
                </div>
                <p className="text-xl font-bold text-text-primary">{store.optimizationRuns.length}</p>
              </div>
              <div className="flex-1 p-3 bg-bg-tertiary rounded-xl border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <FlaskConical className="w-3.5 h-3.5 text-accent-green" />
                  <span className="text-xs text-text-secondary font-medium">测试次数</span>
                </div>
                <p className="text-xl font-bold text-text-primary">—</p>
              </div>
            </div>

            {/* Template list */}
            {store.templates.length === 0 ? (
              <div className="py-12 text-center">
                <BookOpen className="w-10 h-10 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-muted mb-1">暂无提示词模板</p>
                <p className="text-xs text-text-muted">点击右上角「新建模板」创建第一个提示词模板</p>
              </div>
            ) : (
              <div className="space-y-2">
                {store.templates.map(t => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    isActive={store.activeTemplate?.id === t.id}
                    onSelect={() => handleSelectTemplate(t)}
                    onEdit={() => openEditTemplate(t)}
                    onDelete={() => setDeleteTarget({ type: 'template', id: t.id, name: t.name })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── VERSIONS TAB ── */}
        {activeTab === 'versions' && (
          <>
            {!store.activeTemplate ? (
              <div className="py-12 text-center">
                <History className="w-10 h-10 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-muted mb-1">请先选择一个模板</p>
                <p className="text-xs text-text-muted">在「模板」标签中选择要管理的模板</p>
              </div>
            ) : (
              <>
                {/* Template header */}
                <div className="flex items-center justify-between p-3 bg-bg-tertiary rounded-xl border border-border">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{store.activeTemplate.name}</p>
                    <p className="text-xs text-text-muted mt-0.5 truncate">
                      {store.activeTemplate.description || '无描述'} · {activeVersions.length} 个版本
                    </p>
                  </div>
                  <button
                    onClick={openCreateVersion}
                    className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition flex items-center gap-1.5 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新版本
                  </button>
                </div>

                {/* A/B Compare */}
                <div className="p-3 bg-bg-tertiary rounded-xl border border-border space-y-2">
                  <div className="flex items-center gap-2">
                    <GitCompare className="w-3.5 h-3.5 text-accent-yellow" />
                    <p className="text-xs font-medium text-text-secondary">A/B 版本对比</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <select
                      value={compareVersionIds[0] || ''}
                      onChange={e => setCompareVersionIds([e.target.value, compareVersionIds[1] || ''])}
                      className="flex-1 px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                    >
                      <option value="">选择版本 A...</option>
                      {activeVersions.map(v => (
                        <option key={v.id} value={v.id} disabled={v.id === compareVersionIds[1]}>
                          v{v.versionNumber}{v.isBaseline ? ' ★ 基线' : ''}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-text-muted">vs</span>
                    <select
                      value={compareVersionIds[1] || ''}
                      onChange={e => setCompareVersionIds([compareVersionIds[0] || '', e.target.value])}
                      className="flex-1 px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                    >
                      <option value="">选择版本 B...</option>
                      {activeVersions.map(v => (
                        <option key={v.id} value={v.id} disabled={v.id === compareVersionIds[0]}>
                          v{v.versionNumber}{v.isBaseline ? ' ★ 基线' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={compareInput}
                    onChange={e => setCompareInput(e.target.value)}
                    placeholder="输入测试输入内容，对比两个版本的输出差异..."
                    rows={2}
                    className="w-full px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none font-mono"
                  />
                  <button
                    onClick={handleCompare}
                    disabled={compareVersionIds.length !== 2 || !compareInput.trim() || comparing}
                    className="w-full py-1.5 bg-accent-yellow text-bg-primary rounded-lg text-xs font-medium hover:bg-accent-yellow/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {comparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCompare className="w-3.5 h-3.5" />}
                    开始对比
                  </button>

                  {/* Compare result */}
                  {compareResult && (
                    <CompareResultView result={compareResult} />
                  )}
                </div>

                {/* Version list */}
                {activeVersions.length === 0 ? (
                  <div className="py-8 text-center">
                    <History className="w-8 h-8 text-text-muted mx-auto mb-2" />
                    <p className="text-xs text-text-muted">暂无版本记录</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeVersions.map(v => (
                      <VersionCard
                        key={v.id}
                        version={v}
                        onSetBaseline={() => handleSetBaseline(v.id)}
                        onDelete={() => handleDeleteVersion(v)}
                        onTest={() => handleSelectVersionForTest(v)}
                        isSelectedForTest={selectedVersionForTest === v.id}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── TESTING TAB ── */}
        {activeTab === 'testing' && (
          <>
            {!selectedVersionForTest ? (
              <div className="py-12 text-center">
                <FlaskConical className="w-10 h-10 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-muted mb-1">选择要测试的版本</p>
                <p className="text-xs text-text-muted">在「版本」标签中点击测试按钮，或在此页面侧边选择</p>
                {store.activeTemplate && activeVersions.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {activeVersions.map(v => (
                      <button
                        key={v.id}
                        onClick={() => handleSelectVersionForTest(v)}
                        className="px-3 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary hover:border-accent-blue/50 btn-transition"
                      >
                        v{v.versionNumber}{v.isBaseline ? ' ★' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Test input form */}
                <div className="p-3 bg-bg-tertiary rounded-xl border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="w-3.5 h-3.5 text-accent-green" />
                      <p className="text-xs font-medium text-text-secondary">运行测试</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={testProviderId}
                        onChange={e => setTestProviderId(e.target.value)}
                        className="px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                      >
                        <option value="">默认 Provider</option>
                        {providers.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setSelectedVersionForTest(null)}
                        className="text-xs text-text-muted hover:text-text-secondary"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={testInput}
                    onChange={e => setTestInput(e.target.value)}
                    placeholder="输入测试内容..."
                    rows={3}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none font-mono"
                  />
                  <button
                    onClick={handleRunTest}
                    disabled={!testInput.trim() || runningTest}
                    className="w-full py-2 bg-accent-green text-white rounded-lg text-xs font-medium hover:bg-accent-green/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {runningTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {runningTest ? '测试运行中...' : '运行测试'}
                  </button>

                  {/* Test result */}
                  {testResult && (
                    <TestResultView result={testResult} />
                  )}
                </div>

                {/* Test stats */}
                {activeStats && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-bg-tertiary rounded-lg border border-border text-center">
                      <p className="text-xs text-text-muted">平均分</p>
                      <p className={`text-sm font-bold ${getScoreTextColor(activeStats.avgScore)}`}>
                        {activeStats.avgScore.toFixed(1)}
                      </p>
                    </div>
                    <div className="p-2 bg-bg-tertiary rounded-lg border border-border text-center">
                      <p className="text-xs text-text-muted">平均 Token</p>
                      <p className="text-sm font-bold text-text-primary">{activeStats.avgTokens}</p>
                    </div>
                    <div className="p-2 bg-bg-tertiary rounded-lg border border-border text-center">
                      <p className="text-xs text-text-muted">测试次数</p>
                      <p className="text-sm font-bold text-text-primary">{activeStats.count}</p>
                    </div>
                  </div>
                )}

                {/* Test history */}
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-2">测试历史</p>
                  {activeTests.length === 0 ? (
                    <div className="py-4 text-center">
                      <p className="text-xs text-text-muted">暂无测试记录</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {activeTests.map(test => (
                        <TestCard
                          key={test.id}
                          test={test}
                          expanded={expandedTest === test.id}
                          onToggle={() => setExpandedTest(expandedTest === test.id ? null : test.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ── OPTIMIZATION TAB ── */}
        {activeTab === 'optimization' && (
          <>
            {!store.activeTemplate ? (
              <div className="py-12 text-center">
                <Sparkles className="w-10 h-10 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-muted mb-1">请先选择一个模板</p>
                <p className="text-xs text-text-muted">在「模板」标签中选择要优化的模板</p>
              </div>
            ) : (
              <>
                {/* Optimization controls */}
                <div className="p-3 bg-bg-tertiary rounded-xl border border-border space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-accent-purple" />
                    <p className="text-xs font-medium text-text-secondary">AI 自动优化</p>
                  </div>

                  {/* Version selector */}
                  <div>
                    <label className="block text-xs text-text-muted mb-1">选择版本</label>
                    <select
                      value={store.activeVersion?.id || ''}
                      onChange={e => {
                        const v = activeVersions.find(v => v.id === e.target.value)
                        if (v) store.setActiveVersion(v)
                      }}
                      className="w-full px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                    >
                      {activeVersions.map(v => (
                        <option key={v.id} value={v.id}>
                          v{v.versionNumber}{v.isBaseline ? ' ★ 基线' : ''} (评分: {v.score?.toFixed(1) || '—'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Strategy buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleOptimize('auto')}
                      disabled={optimizing || !store.activeVersion}
                      className="py-2 bg-accent-purple text-white rounded-lg text-xs font-medium hover:bg-accent-purple/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {optimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                      AI 自动优化
                    </button>
                    <button
                      onClick={() => handleOptimize('hints')}
                      disabled={optimizing || !store.activeVersion}
                      className="py-2 bg-bg-hover text-text-primary rounded-lg text-xs font-medium hover:bg-bg-tertiary btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      引导式优化
                    </button>
                  </div>

                  {/* Hints input */}
                  <div>
                    <label className="block text-xs text-text-muted mb-1">优化提示（可选）</label>
                    <textarea
                      value={optimizationHints}
                      onChange={e => setOptimizationHints(e.target.value)}
                      placeholder="例如：让提示词更简洁、加入更多示例..."
                      rows={2}
                      className="w-full px-2.5 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
                    />
                  </div>

                  {/* Optimize result */}
                  {optimizeResult && (
                    <OptimizeResultView result={optimizeResult} />
                  )}
                </div>

                {/* Promote best */}
                {store.activeTemplate && (
                  <button
                    onClick={handlePromoteBest}
                    className="w-full py-2 bg-bg-tertiary border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent-green/50 btn-transition flex items-center justify-center gap-1.5"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                    将评分最高版本设为基线
                  </button>
                )}

                {/* Optimization history */}
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-2 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    优化历史
                  </p>
                  {store.optimizationRuns.length === 0 ? (
                    <div className="py-4 text-center">
                      <p className="text-xs text-text-muted">暂无优化记录</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {store.optimizationRuns
                        .filter(r => !store.activeTemplate || r.templateId === store.activeTemplate.id)
                        .map(run => (
                          <OptimizationRunCard key={run.id} run={run} />
                        ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── TEMPLATE CREATE/EDIT MODAL ── */}
      {showTemplateForm && (
        <TemplateFormModal
          editing={editingTemplate}
          form={templateForm}
          vars={templateVars}
          saving={savingTemplate}
          onChange={setTemplateForm}
          onVarAdd={addTemplateVar}
          onVarRemove={removeTemplateVar}
          onVarUpdate={updateTemplateVar}
          onSave={handleSaveTemplate}
          onClose={resetTemplateForm}
        />
      )}

      {/* ── VERSION CREATE MODAL ── */}
      {showVersionForm && (
        <VersionFormModal
          content={versionContent}
          notes={versionNotes}
          systemPrompt={versionSystemPrompt}
          saving={savingVersion}
          onContentChange={setVersionContent}
          onNotesChange={setVersionNotes}
          onSystemPromptChange={setVersionSystemPrompt}
          onSave={handleSaveVersion}
          onClose={() => setShowVersionForm(false)}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.type === 'template' ? '删除模板' : '删除版本'}
        message={`确定要删除${deleteTarget?.type === 'template' ? `模板「${deleteTarget?.name}」` : `版本 ${deleteTarget?.name}`}吗？${
          deleteTarget?.type === 'template' ? '所有版本和测试记录也会被删除。' : ''
        }`}
        danger
        onConfirm={handleDeleteTemplate}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function TemplateCard({ template, isActive, onSelect, onEdit, onDelete }: {
  template: PromptTemplate
  isActive: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`bg-bg-tertiary rounded-xl border overflow-hidden cursor-pointer transition-all ${
        isActive
          ? 'border-accent-purple/50 shadow-md'
          : 'border-border hover:border-accent-blue/30'
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className={`p-1.5 rounded-lg ${isActive ? 'bg-accent-purple/20' : 'bg-bg-secondary'}`}>
          <BookOpen className={`w-4 h-4 ${isActive ? 'text-accent-purple' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{template.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {template.category && (
              <span className="px-1.5 py-0.5 bg-bg-secondary rounded text-xs text-text-muted">
                {template.category}
              </span>
            )}
            {template.tags?.slice(0, 2).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-bg-secondary rounded text-xs text-text-muted">
                #{tag}
              </span>
            ))}
            {template.description && (
              <span className="text-xs text-text-muted truncate max-w-32">{template.description}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button onClick={onEdit} className="p-1.5 text-text-muted hover:text-accent-blue rounded btn-transition">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 text-text-muted hover:text-accent-red rounded btn-transition">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {isActive && <CheckCircle2 className="w-4 h-4 text-accent-purple" />}
        </div>
      </div>
    </div>
  )
}

function VersionCard({ version, onSetBaseline, onDelete, onTest, isSelectedForTest }: {
  version: PromptVersion
  onSetBaseline: () => void
  onDelete: () => void
  onTest: () => void
  isSelectedForTest: boolean
}) {
  return (
    <div className={`bg-bg-tertiary rounded-lg border overflow-hidden ${
      isSelectedForTest ? 'border-accent-green/50' : 'border-border'
    }`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5">
          {version.isBaseline ? (
            <span className="px-1.5 py-0.5 bg-accent-yellow/10 text-accent-yellow rounded text-xs font-medium">★ 基线</span>
          ) : (
            <span className="text-xs text-text-muted font-mono">v{version.versionNumber}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {version.score !== undefined && version.score !== null && (
              <span className={`text-xs font-medium ${getScoreTextColor(version.score)}`}>
                {version.score.toFixed(1)}
              </span>
            )}
            {version.testCount > 0 && (
              <span className="text-xs text-text-muted">{version.testCount} 次测试</span>
            )}
          </div>
          {version.changeNotes && (
            <p className="text-xs text-text-muted mt-0.5 truncate">{version.changeNotes}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!version.isBaseline && (
            <button
              onClick={onSetBaseline}
              className="p-1 text-text-muted hover:text-accent-yellow rounded btn-transition"
              title="设为基线"
            >
              <Target className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onTest}
            className={`p-1 rounded btn-transition ${isSelectedForTest ? 'text-accent-green' : 'text-text-muted hover:text-accent-green'}`}
            title="测试此版本"
          >
            <FlaskConical className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1 text-text-muted hover:text-accent-red rounded btn-transition"
            title="删除版本"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Content preview */}
      <div className="px-3 pb-2">
        <div className="bg-bg-secondary rounded p-2 border border-border/50">
          <p className="text-xs text-text-muted font-mono line-clamp-3 whitespace-pre-wrap">
            {version.content}
          </p>
        </div>
      </div>
    </div>
  )
}

function TestCard({ test, expanded, onToggle }: {
  test: PromptTest
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-secondary/50"
        onClick={onToggle}
      >
        <button className="text-text-muted">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {test.score !== undefined && test.score !== null && (
          <span className={`text-xs font-medium ${getScoreTextColor(test.score)}`}>
            {test.score.toFixed(1)}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-secondary truncate font-mono">{test.testInput}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {test.tokensUsed && (
            <span className="text-xs text-text-muted">{test.tokensUsed} tokens</span>
          )}
          {test.durationMs && (
            <span className="text-xs text-text-muted">{test.durationMs}ms</span>
          )}
          <span className="text-xs text-text-muted">
            {new Date(test.createdAt).toLocaleString()}
          </span>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2 pt-0 border-t border-border/50 space-y-2">
          <div>
            <p className="text-xs text-text-muted mb-1">输入：</p>
            <pre className="text-xs text-text-secondary bg-bg-secondary rounded p-2 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
              {test.testInput}
            </pre>
          </div>
          {test.testOutput && (
            <div>
              <p className="text-xs text-text-muted mb-1">输出：</p>
              <pre className="text-xs text-text-secondary bg-bg-secondary rounded p-2 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                {test.testOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OptimizationRunCard({ run }: { run: PromptOptimizationRun }) {
  return (
    <div className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        {RUN_STATUS_ICONS[run.status] || RUN_STATUS_ICONS.pending}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">
              {run.optimizationStrategy === 'auto' ? 'AI 自动优化' : '引导式优化'}
            </span>
            <span className={`text-xs ${RUN_STATUS_COLORS[run.status]}`}>
              {RUN_STATUS_LABELS[run.status]}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
            <span>{run.iterations} 次迭代</span>
            <span>·</span>
            <span>{new Date(run.startedAt).toLocaleString()}</span>
          </div>
        </div>
        {run.improvementScore !== undefined && run.improvementScore !== null && (
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-accent-green" />
            <span className={`text-xs font-medium ${run.improvementScore >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
              {run.improvementScore >= 0 ? '+' : ''}{run.improvementScore.toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function TestResultView({ result }: { result: any }) {
  const success = result?.success !== false
  return (
    <div className={`mt-2 p-3 rounded-lg border ${
      success ? 'border-accent-green/30 bg-accent-green/5' : 'border-accent-red/30 bg-accent-red/5'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        {success
          ? <CheckCircle2 className="w-4 h-4 text-accent-green" />
          : <AlertCircle className="w-4 h-4 text-accent-red" />
        }
        <p className={`text-xs font-medium ${success ? 'text-accent-green' : 'text-accent-red'}`}>
          {success ? '测试完成' : '测试失败'}
        </p>
        {result?.tokensUsed && (
          <span className="text-xs text-text-muted">{result.tokensUsed} tokens</span>
        )}
        {result?.durationMs && (
          <span className="text-xs text-text-muted">{result.durationMs}ms</span>
        )}
        {result?.score !== undefined && result?.score !== null && (
          <span className={`text-xs font-medium ${getScoreTextColor(result.score)}`}>
            评分: {result.score.toFixed(1)}
          </span>
        )}
      </div>
      {result?.testOutput && (
        <pre className="text-xs text-text-secondary bg-bg-secondary rounded p-2 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
          {result.testOutput}
        </pre>
      )}
      {result?.error && (
        <p className="text-xs text-accent-red">{result.error.message || result.error}</p>
      )}
    </div>
  )
}

function CompareResultView({ result }: { result: any }) {
  const success = result?.success !== false
  return (
    <div className={`mt-2 p-3 rounded-lg border ${
      success ? 'border-accent-yellow/30 bg-accent-yellow/5' : 'border-accent-red/30 bg-accent-red/5'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <GitCompare className="w-4 h-4 text-accent-yellow" />
        <p className={`text-xs font-medium ${success ? 'text-accent-yellow' : 'text-accent-red'}`}>
          {success ? '对比结果' : '对比失败'}
        </p>
        {result?.scoreA !== undefined && (
          <span className="text-xs text-text-muted">版本A: {result.scoreA.toFixed(1)}</span>
        )}
        {result?.scoreB !== undefined && (
          <span className="text-xs text-text-muted">版本B: {result.scoreB.toFixed(1)}</span>
        )}
      </div>
      {result?.outputA && (
        <div className="mb-2">
          <p className="text-xs text-text-muted mb-1">版本 A 输出：</p>
          <pre className="text-xs text-text-secondary bg-bg-secondary rounded p-2 whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">
            {result.outputA}
          </pre>
        </div>
      )}
      {result?.outputB && (
        <div>
          <p className="text-xs text-text-muted mb-1">版本 B 输出：</p>
          <pre className="text-xs text-text-secondary bg-bg-secondary rounded p-2 whitespace-pre-wrap font-mono max-h-24 overflow-y-auto">
            {result.outputB}
          </pre>
        </div>
      )}
      {result?.summary && (
        <p className="text-xs text-text-secondary mt-2 italic">{result.summary}</p>
      )}
      {result?.error && (
        <p className="text-xs text-accent-red">{result.error.message || result.error}</p>
      )}
    </div>
  )
}

function OptimizeResultView({ result }: { result: any }) {
  const success = result?.success !== false
  return (
    <div className={`p-3 rounded-lg border ${
      success ? 'border-accent-purple/30 bg-accent-purple/5' : 'border-accent-red/30 bg-accent-red/5'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        {success
          ? <Sparkles className="w-4 h-4 text-accent-purple" />
          : <AlertCircle className="w-4 h-4 text-accent-red" />
        }
        <p className={`text-xs font-medium ${success ? 'text-accent-purple' : 'text-accent-red'}`}>
          {success ? '优化完成' : '优化失败'}
        </p>
        {result?.improvementScore !== undefined && result?.improvementScore !== null && (
          <span className={`text-xs font-medium ${result.improvementScore >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            提升: {result.improvementScore >= 0 ? '+' : ''}{result.improvementScore.toFixed(1)}
          </span>
        )}
        {result?.iterations !== undefined && (
          <span className="text-xs text-text-muted">{result.iterations} 次迭代</span>
        )}
      </div>
      {result?.promptAfter && (
        <div>
          <p className="text-xs text-text-muted mb-1">优化后提示词：</p>
          <pre className="text-xs text-text-secondary bg-bg-secondary rounded p-2 whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
            {result.promptAfter}
          </pre>
        </div>
      )}
      {result?.improvementSummary && (
        <p className="text-xs text-text-secondary mt-2 italic">{result.improvementSummary}</p>
      )}
      {result?.error && (
        <p className="text-xs text-accent-red">{result.error.message || result.error}</p>
      )}
    </div>
  )
}

// ── Modal Components ─────────────────────────────────────────

function TemplateFormModal({ editing, form, vars, saving, onChange, onVarAdd, onVarRemove, onVarUpdate, onSave, onClose }: {
  editing: PromptTemplate | null
  form: { name: string; description: string; category: string; tags: string; content: string }
  vars: PromptVariable[]
  saving: boolean
  onChange: (f: typeof form) => void
  onVarAdd: () => void
  onVarRemove: (i: number) => void
  onVarUpdate: (i: number, f: keyof PromptVariable, v: string) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bg-secondary border border-border rounded-xl w-[560px] max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-accent-purple" />
            <h3 className="text-sm font-semibold text-text-primary">
              {editing ? '编辑模板' : '新建提示词模板'}
            </h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">模板名称 *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder="例如：代码审查提示词"
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={e => onChange({ ...form, description: e.target.value })}
              placeholder="可选描述"
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple"
            />
          </div>

          {/* Category + Tags */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">分类</label>
              <input
                type="text"
                value={form.category}
                onChange={e => onChange({ ...form, category: e.target.value })}
                placeholder="例如：代码质量"
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">标签（逗号分隔）</label>
              <input
                type="text"
                value={form.tags}
                onChange={e => onChange({ ...form, tags: e.target.value })}
                placeholder="例如：code, review"
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple"
              />
            </div>
          </div>

          {/* Variables */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-secondary">变量定义</label>
              <button
                onClick={onVarAdd}
                className="text-xs text-accent-purple hover:text-accent-purple/80 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> 添加变量
              </button>
            </div>
            {vars.length > 0 ? (
              <div className="space-y-1.5">
                {vars.map((v, i) => (
                  <div key={i} className="flex gap-2 items-center p-2 bg-bg-tertiary rounded-lg border border-border/50">
                    <div className="flex-1 grid grid-cols-3 gap-1.5">
                      <input
                        type="text"
                        value={v.name}
                        onChange={e => onVarUpdate(i, 'name', e.target.value)}
                        placeholder="变量名"
                        className="px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple"
                      />
                      <input
                        type="text"
                        value={v.description || ''}
                        onChange={e => onVarUpdate(i, 'description', e.target.value)}
                        placeholder="描述"
                        className="px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple"
                      />
                      <input
                        type="text"
                        value={v.defaultValue || ''}
                        onChange={e => onVarUpdate(i, 'defaultValue', e.target.value)}
                        placeholder="默认值"
                        className="px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple"
                      />
                    </div>
                    <button
                      onClick={() => onVarRemove(i)}
                      className="p-1 text-text-muted hover:text-accent-red rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted p-2 bg-bg-tertiary rounded-lg border border-dashed border-border text-center">
                无变量，点击上方「添加变量」定义模板占位符
              </p>
            )}
          </div>

          {/* Content */}
          {!editing && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                初始提示词内容 <span className="text-text-muted font-normal">(将自动创建 v1)</span>
              </label>
              <textarea
                value={form.content}
                onChange={e => onChange({ ...form, content: e.target.value })}
                placeholder="输入提示词内容，支持使用 {'{{变量名}}'} 占位符..."
                rows={6}
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-purple resize-none font-mono"
              />
            </div>
          )}

          <button
            onClick={onSave}
            disabled={!form.name.trim() || saving}
            className="w-full py-2 bg-accent-purple text-white rounded-lg text-sm font-medium hover:bg-accent-purple/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {editing ? '保存修改' : '创建模板'}
          </button>
        </div>
      </div>
    </div>
  )
}

function VersionFormModal({ content, notes, systemPrompt, saving, onContentChange, onNotesChange, onSystemPromptChange, onSave, onClose }: {
  content: string
  notes: string
  systemPrompt: string
  saving: boolean
  onContentChange: (v: string) => void
  onNotesChange: (v: string) => void
  onSystemPromptChange: (v: string) => void
  onSave: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'content' | 'system'>('content')

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bg-secondary border border-border rounded-xl w-[600px] max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-accent-blue" />
            <h3 className="text-sm font-semibold text-text-primary">新建版本</h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
            <button
              onClick={() => setTab('content')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'content' ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Code2 className="w-3.5 h-3.5 inline mr-1" />
              提示词内容
            </button>
            <button
              onClick={() => setTab('system')}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'system' ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 inline mr-1" />
              System Prompt
            </button>
          </div>

          {tab === 'content' ? (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">提示词内容 *</label>
              <textarea
                value={content}
                onChange={e => onContentChange(e.target.value)}
                placeholder="输入提示词内容，支持 {'{{变量名}}'} 占位符..."
                rows={10}
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none font-mono"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">System Prompt（可选）</label>
              <p className="text-xs text-text-muted mb-1.5">为 AI 角色设定系统级指令</p>
              <textarea
                value={systemPrompt}
                onChange={e => onSystemPromptChange(e.target.value)}
                placeholder="例如：你是一位专业的代码审查专家..."
                rows={5}
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none font-mono"
              />
            </div>
          )}

          {/* Change notes */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">版本说明（可选）</label>
            <input
              type="text"
              value={notes}
              onChange={e => onNotesChange(e.target.value)}
              placeholder="例如：增加了示例，更明确了输出格式"
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            />
          </div>

          <button
            onClick={onSave}
            disabled={!content.trim() || saving}
            className="w-full py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            创建版本
          </button>
        </div>
      </div>
    </div>
  )
}
