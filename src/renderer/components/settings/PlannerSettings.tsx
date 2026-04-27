/**
 * PlannerSettings - 自主规划引擎配置面板
 */
import { useState, useEffect } from 'react'
import {
  Brain, Play, Pause, Trash2, Plus, Loader2, Check, Zap,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle2, XCircle,
  SkipForward, ChevronUp, ChevronLeft, Users
} from 'lucide-react'
import { usePlannerStore, type PlanSession, type PlanTask, type PlanStep, type Priority } from '../../stores/plannerStore'
import { useTeamStore } from '../../stores/teamStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'text-accent-blue',
  medium: 'text-accent-yellow',
  high: 'text-accent-orange',
  critical: 'text-accent-red',
}

const PRIORITY_LABELS: Record<Priority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '紧急',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-text-muted',
  in_progress: 'text-accent-yellow',
  completed: 'text-accent-green',
  skipped: 'text-text-muted',
  running: 'text-accent-yellow',
  failed: 'text-accent-red',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  in_progress: '进行中',
  completed: '已完成',
  skipped: '已跳过',
  running: '运行中',
  failed: '失败',
}

export default function PlannerSettings() {
  const {
    plans,
    activePlan,
    activeTasks,
    activeSteps,
    status,
    loading,
    fetchPlans,
    fetchTasks,
    fetchSteps,
    createPlan,
    deletePlan,
    startPlan,
    syncToKanban,
    updatePlan,
    executeStep,
    skipTask,
    skipStep,
    initListeners,
    cleanup,
  } = usePlannerStore()
  const {
    createTeam,
    createTask: createTeamTask,
    setActiveTeam,
  } = useTeamStore()
  const { sessions, selectedSessionId } = useSessionStore()

  const [activeTab, setActiveTab] = useState<'plans' | 'detail'>('plans')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Create form state
  const [newGoal, setNewGoal] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncingKanban, setSyncingKanban] = useState(false)
  const [dispatchingTeam, setDispatchingTeam] = useState(false)
  const [expandedTask, setExpandedTask] = useState<string | null>(null)

  useEffect(() => {
    fetchPlans()
    initListeners()
    return () => cleanup()
  }, [])

  const handleCreatePlan = async () => {
    if (!newGoal.trim()) return
    setSaving(true)
    try {
      const result = await createPlan({
        sessionId: 'planner-' + Date.now(),
        goal: newGoal.trim(),
      })
      if (result.success) {
        setShowCreateForm(false)
        setNewGoal('')
        await fetchPlans()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePlan = async (planId: string) => {
    if (!confirm('确定删除此规划？')) return
    await deletePlan(planId)
  }

  const handleOpenPlan = async (plan: PlanSession) => {
    await fetchTasks(plan.id)
    setActiveTab('detail')
  }

  const handleBack = () => {
    setActiveTab('plans')
  }

  const handleStartPlan = async (planId: string) => {
    await startPlan(planId, 'planner-' + planId)
  }

  const handleSyncToKanban = async (planId: string) => {
    if (syncingKanban) return
    setSyncingKanban(true)
    try {
      const result = await syncToKanban(planId, activePlan?.sessionId || `planner-${planId}`)
      if (!result.success) {
        const message = result.error?.userMessage || result.error?.message || result.error || '同步失败'
        alert(`同步到看板失败：${message}`)
      } else {
        alert(`已同步 ${result.data?.taskCount ?? result.taskCount ?? 0} 个任务到看板`)
      }
    } finally {
      setSyncingKanban(false)
    }
  }

  const getPlanSession = () => {
    if (!activePlan) return null
    return (
      sessions.find(session => session.id === activePlan.sessionId) ||
      sessions.find(session => session.id === selectedSessionId) ||
      sessions[0] ||
      null
    )
  }

  const handleDispatchPlanToTeam = async () => {
    if (!activePlan || dispatchingTeam || activeTasks.length === 0) return

    setDispatchingTeam(true)
    try {
      const sourceSession = getPlanSession()
      const workDir = sourceSession?.config?.workingDirectory || await window.spectrAI.app.getCwd()
      const providerId = sourceSession?.providerId || 'codex'
      const team = await createTeam({
        name: `执行规划：${activePlan.goal.slice(0, 32)}`,
        objective: [
          `完成自主规划目标：${activePlan.goal}`,
          `来源规划：${activePlan.id}`,
          activePlan.goalId ? `来源目标：${activePlan.goalId}` : '',
        ].filter(Boolean).join('\n\n'),
        workDir,
        templateId: 'dev-team',
        providerId,
        worktreeIsolation: false,
      })

      if (!team) return

      const latestSteps = (await Promise.all(
        activeTasks.map(async planTask => ((window as any).spectrAI.planner.getSteps(planTask.id)))
      )).flat() as PlanStep[]

      for (const planTask of activeTasks) {
        const taskSteps = latestSteps
          .filter(step => step.planTaskId === planTask.id)
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map(step => `- ${step.description}`)

        await createTeamTask(team.id, {
          title: planTask.title,
          description: [
            planTask.description || '',
            taskSteps.length > 0 ? `执行步骤：\n${taskSteps.join('\n')}` : '',
            `来源规划任务：${planTask.id}`,
          ].filter(Boolean).join('\n\n'),
          status: 'pending',
          priority: planTask.priority,
          dependencies: [],
        })
      }

      setActiveTeam(team.id)
      useUIStore.getState().setActivePanelLeft('team')
      useUIStore.getState().setPaneContent('primary', 'team')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      alert(`派发到 Agent Team 失败：${message}`)
    } finally {
      setDispatchingTeam(false)
    }
  }

  const toggleExpandTask = async (taskId: string) => {
    if (expandedTask === taskId) {
      setExpandedTask(null)
      // clear steps
    } else {
      setExpandedTask(taskId)
      await fetchSteps(taskId)
    }
  }

  const handleExecuteStep = async (step: PlanStep) => {
    if (!activePlan) return
    await executeStep(step.id, activePlan.sessionId || activePlan.id)
  }

  const renderStatusIcon = (stepStatus: string) => {
    if (stepStatus === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
    if (stepStatus === 'failed') return <XCircle className="w-3.5 h-3.5 text-accent-red" />
    if (stepStatus === 'running') return <Loader2 className="w-3.5 h-3.5 text-accent-yellow animate-spin" />
    if (stepStatus === 'skipped') return <SkipForward className="w-3.5 h-3.5 text-text-muted" />
    return <AlertCircle className="w-3.5 h-3.5 text-text-muted" />
  }

  const statusColorClass = status === 'running' || status === 'planning'
    ? 'text-accent-yellow'
    : status === 'completed'
    ? 'text-accent-green'
    : status === 'failed'
    ? 'text-accent-red'
    : 'text-text-muted'

  // ── 规划列表 Tab ──
  if (activeTab === 'plans') {
    return (
      <div className="space-y-4">
        {/* 状态栏 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
            <span className={`w-2 h-2 rounded-full ${
              status === 'running' || status === 'planning' ? 'bg-accent-yellow' :
              status === 'completed' ? 'bg-accent-green' :
              status === 'failed' ? 'bg-accent-red' : 'bg-text-muted'
            }`} />
            <span className={`text-sm ${statusColorClass}`}>
              {status === 'idle' ? '空闲' : status === 'planning' ? '规划中...' : status === 'running' ? '执行中' : status === 'completed' ? '已完成' : '失败'}
            </span>
            <span className="text-xs text-text-muted">· {plans.length} 个规划</span>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            新建规划
          </button>
        </div>

        {/* 新建表单 */}
        {showCreateForm && (
          <div className="p-4 bg-bg-tertiary rounded-xl border border-border space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Brain className="w-4 h-4 text-accent-blue" />
                新建规划
              </p>
              <button onClick={() => setShowCreateForm(false)} className="text-text-muted hover:text-text-secondary">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                目标描述 *
              </label>
              <textarea
                value={newGoal}
                onChange={e => setNewGoal(e.target.value)}
                placeholder="描述你想要达成的目标，AI 将自动分解为具体任务..."
                rows={4}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
              />
              <p className="mt-1 text-xs text-text-muted">
                AI 会分析目标并自动生成可执行的任务列表
              </p>
            </div>

            <button
              onClick={handleCreatePlan}
              disabled={!newGoal.trim() || saving}
              className="w-full py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              {saving ? '规划中...' : '开始规划'}
            </button>
          </div>
        )}

        {/* 规划列表 */}
        <div className="space-y-2">
          {plans.length === 0 && !showCreateForm ? (
            <div className="py-12 text-center">
              <Brain className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <p className="text-xs text-text-muted">暂无规划</p>
              <p className="text-xs text-text-muted mt-1">输入目标，AI 将自动分解为可执行的任务</p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="mt-4 px-4 py-2 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition"
              >
                创建第一个规划
              </button>
            </div>
          ) : (
            plans.map(plan => (
              <div key={plan.id} className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-3">
                  {/* 展开按钮 */}
                  <button
                    onClick={() => handleOpenPlan(plan)}
                    className="text-text-muted hover:text-text-secondary"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{plan.goal}</p>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        plan.status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
                        plan.status === 'running' ? 'bg-accent-yellow/10 text-accent-yellow' :
                        plan.status === 'failed' ? 'bg-accent-red/10 text-accent-red' :
                        'bg-bg-secondary text-text-muted'
                      }`}>
                        {STATUS_LABELS[plan.status] || plan.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
                      {plan.createdAt && <span>创建于 {new Date(plan.createdAt).toLocaleDateString()}</span>}
                      {plan.startedAt && <span>开始于 {new Date(plan.startedAt).toLocaleDateString()}</span>}
                      {plan.completedAt && <span>完成于 {new Date(plan.completedAt).toLocaleDateString()}</span>}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1">
                    {plan.status === 'pending' && (
                      <button
                        onClick={() => handleStartPlan(plan.id)}
                        title="开始执行"
                        className="p-1.5 text-accent-green hover:bg-accent-green/10 rounded btn-transition"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {plan.status === 'running' && (
                      <button
                        onClick={() => handleStartPlan(plan.id)}
                        title="重新开始"
                        className="p-1.5 text-accent-yellow hover:bg-accent-yellow/10 rounded btn-transition"
                      >
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeletePlan(plan.id)}
                      className="p-1.5 text-text-muted hover:text-accent-red rounded btn-transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 功能说明 */}
        <div className="p-3 bg-bg-tertiary rounded-lg">
          <p className="text-xs font-medium text-text-secondary mb-1.5">自主规划引擎说明</p>
          <div className="text-xs text-text-muted space-y-1">
            <div className="flex items-center gap-1.5">
              <Brain className="w-3 h-3 text-accent-blue shrink-0" />
              <span>输入目标，AI 自动分解为任务列表</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-accent-yellow shrink-0" />
              <span>任务包含步骤，可逐步执行</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Play className="w-3 h-3 text-accent-green shrink-0" />
              <span>每个步骤在独立会话中运行</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── 规划详情 Tab ──
  return (
    <div className="space-y-4 p-4 min-w-0">
      {/* 顶部导航 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary btn-transition"
        >
          <ChevronLeft className="w-4 h-4" />
          返回列表
        </button>
      </div>

      {/* 规划信息 */}
      {activePlan && (
        <div className="bg-bg-tertiary rounded-lg border border-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">{activePlan.goal}</p>
              <div className="flex items-center gap-3 mt-1">
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  activePlan.status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
                  activePlan.status === 'running' ? 'bg-accent-yellow/10 text-accent-yellow' :
                  activePlan.status === 'failed' ? 'bg-accent-red/10 text-accent-red' :
                  'bg-bg-secondary text-text-muted'
                }`}>
                  {STATUS_LABELS[activePlan.status] || activePlan.status}
                </span>
                <span className="text-xs text-text-muted">{activeTasks.length} 个任务</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSyncToKanban(activePlan.id)}
                disabled={syncingKanban || activeTasks.length === 0}
                className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {syncingKanban ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                同步到看板
              </button>
              <button
                onClick={handleDispatchPlanToTeam}
                disabled={dispatchingTeam || activeTasks.length === 0}
                className="px-3 py-1.5 bg-accent-purple text-white rounded-lg text-xs font-medium hover:bg-accent-purple/80 btn-transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {dispatchingTeam ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                派发团队
              </button>
              {activePlan.status === 'pending' && (
                <button
                  onClick={() => handleStartPlan(activePlan.id)}
                  className="px-3 py-1.5 bg-accent-green text-white rounded-lg text-xs font-medium hover:bg-accent-green/80 btn-transition flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  开始执行
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-2">
        {activeTasks.length === 0 ? (
          <div className="py-8 text-center">
            <Brain className="w-8 h-8 text-text-muted mx-auto mb-2" />
            <p className="text-xs text-text-muted">暂无任务</p>
          </div>
        ) : (
          activeTasks.map(task => (
            <div key={task.id} className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
              {/* 任务行 */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button
                  onClick={() => toggleExpandTask(task.id)}
                  className="text-text-muted hover:text-text-secondary"
                >
                  {expandedTask === task.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text-primary truncate">{task.title}</p>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_COLORS[task.priority] || 'text-text-muted'} bg-bg-secondary`}>
                      {PRIORITY_LABELS[task.priority] || task.priority}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      task.status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
                      task.status === 'in_progress' ? 'bg-accent-yellow/10 text-accent-yellow' :
                      task.status === 'skipped' ? 'bg-bg-secondary text-text-muted' :
                      'bg-bg-secondary text-text-muted'
                    }`}>
                      {STATUS_LABELS[task.status] || task.status}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-xs text-text-secondary mt-0.5 truncate">{task.description}</p>
                  )}
                </div>

                {/* 跳过任务 */}
                {task.status !== 'completed' && task.status !== 'skipped' && (
                  <button
                    onClick={() => skipTask(task.id)}
                    title="跳过任务"
                    className="p-1.5 text-text-muted hover:text-accent-yellow rounded btn-transition"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 步骤详情 */}
              {expandedTask === task.id && (
                <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/50">
                  {task.description && (
                    <p className="text-xs text-text-secondary mt-2">{task.description}</p>
                  )}

                  {task.dependencies.length > 0 && (
                    <div className="flex items-start gap-1.5 mt-1">
                      <span className="text-xs text-text-muted shrink-0">依赖:</span>
                      <div className="flex flex-wrap gap-1">
                        {task.dependencies.map((dep, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-bg-secondary rounded text-xs text-text-muted">
                            {dep}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 步骤列表 */}
                  {activeSteps.filter(s => s.planTaskId === task.id).length > 0 ? (
                    <div className="space-y-1.5 mt-2">
                      <p className="text-xs font-medium text-text-secondary">执行步骤</p>
                      {activeSteps
                        .filter(s => s.planTaskId === task.id)
                        .sort((a, b) => a.orderIndex - b.orderIndex)
                        .map(step => (
                          <div key={step.id} className="flex items-start gap-2 px-3 py-2 bg-bg-secondary rounded-lg">
                            <div className="mt-0.5 shrink-0">
                              {renderStatusIcon(step.status)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-text-primary">{step.description}</p>
                              {step.result && (
                                <p className="text-xs text-text-muted mt-1 line-clamp-2">{step.result}</p>
                              )}
                            </div>
                            {step.status === 'pending' && activePlan?.status === 'running' && (
                              <button
                                onClick={() => handleExecuteStep(step)}
                                className="shrink-0 px-2 py-1 bg-accent-blue text-white rounded text-xs hover:bg-accent-blue/80 btn-transition"
                              >
                                执行
                              </button>
                            )}
                            {step.status === 'pending' && (
                              <button
                                onClick={() => skipStep(step.id)}
                                className="shrink-0 p-1 text-text-muted hover:text-text-secondary rounded btn-transition"
                                title="跳过步骤"
                              >
                                <SkipForward className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ))
                      }
                    </div>
                  ) : (
                    <p className="text-xs text-text-muted mt-1">暂无步骤</p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
