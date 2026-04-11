/**
 * GoalSettings - 目标锚点设置面板
 */
import { useState, useEffect } from 'react'
import {
  Target, Plus, Trash2, Loader2, Check, XCircle, ChevronDown,
  ChevronRight, AlertCircle, CheckCircle2, X, StickyNote, BookmarkCheck, Bell, Eye
} from 'lucide-react'
import { useGoalStore, type Goal, type GoalActivity, type GoalPriority, type GoalActivityType } from '../../stores/goalStore'
import ConfirmDialog from '../common/ConfirmDialog'

const PRIORITY_LABELS: Record<GoalPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-accent-red',
  medium: 'text-accent-yellow',
  low: 'text-accent-blue',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-accent-green',
  achieved: 'text-accent-blue',
  abandoned: 'text-text-muted',
}

const STATUS_LABELS: Record<string, string> = {
  active: '进行中',
  achieved: '已达成',
  abandoned: '已放弃',
}

const ACTIVITY_ICONS: Record<GoalActivityType, React.ReactNode> = {
  note: <StickyNote className="w-3.5 h-3.5 text-text-muted" />,
  reminder: <Bell className="w-3.5 h-3.5 text-accent-yellow" />,
  checkpoint: <BookmarkCheck className="w-3.5 h-3.5 text-accent-green" />,
  review: <Eye className="w-3.5 h-3.5 text-accent-blue" />,
}

const ACTIVITY_LABELS: Record<GoalActivityType, string> = {
  note: '笔记',
  reminder: '提醒',
  checkpoint: '里程碑',
  review: '回顾',
}

export default function GoalSettings() {
  const {
    goals,
    activeGoal,
    activities,
    stats,
    loading,
    fetchGoals,
    fetchGoal,
    createGoal,
    updateGoal,
    deleteGoal,
    setActiveGoal,
    addActivity,
    fetchActivities,
    fetchSessions,
    fetchStats,
    initListeners,
    cleanup,
  } = useGoalStore()

  const [activeTab, setActiveTab] = useState<'list' | 'detail' | 'create'>('list')
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Create form state
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newTargetDate, setNewTargetDate] = useState('')
  const [newPriority, setNewPriority] = useState<GoalPriority>('medium')
  const [newTags, setNewTags] = useState('')
  const [saving, setSaving] = useState(false)

  // Quick add activity state
  const [quickActivityType, setQuickActivityType] = useState<GoalActivityType>('note')
  const [quickActivityContent, setQuickActivityContent] = useState('')
  const [quickProgress, setQuickProgress] = useState('')
  const [addingActivity, setAddingActivity] = useState(false)

  // 删除确认状态
  const [deleteGoalConfirm, setDeleteGoalConfirm] = useState<{ goalId: string; name: string } | null>(null)
  const [abandonGoalConfirm, setAbandonGoalConfirm] = useState<Goal | null>(null)

  // Edit goal state
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTargetDate, setEditTargetDate] = useState('')
  const [editPriority, setEditPriority] = useState<GoalPriority>('medium')
  const [editProgress, setEditProgress] = useState('')
  const [editTags, setEditTags] = useState('')

  useEffect(() => {
    fetchGoals()
    fetchStats()
    initListeners()
    return () => cleanup()
  }, [])

  // Load activities/sessions when viewing a goal
  useEffect(() => {
    if (activeGoal) {
      fetchActivities(activeGoal.id)
      fetchSessions(activeGoal.id)
    }
  }, [activeGoal?.id])

  const handleCreateGoal = async () => {
    if (!newTitle.trim()) return
    setSaving(true)
    try {
      const tags = newTags.trim()
        ? newTags.split(',').map(t => t.trim()).filter(Boolean)
        : []
      const result = await createGoal({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        targetDate: newTargetDate || undefined,
        priority: newPriority,
        tags,
      })
      if (result.success) {
        setShowCreateForm(false)
        setNewTitle(''); setNewDescription(''); setNewTargetDate('')
        setNewPriority('medium'); setNewTags('')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleOpenEdit = (goal: Goal) => {
    setEditingGoal(goal)
    setEditTitle(goal.title)
    setEditDescription(goal.description || '')
    setEditTargetDate(goal.targetDate || '')
    setEditPriority(goal.priority)
    setEditProgress(String(goal.progress))
    setEditTags(goal.tags.join(', '))
  }

  const handleSaveEdit = async () => {
    if (!editingGoal || !editTitle.trim()) return
    setSaving(true)
    try {
      const tags = editTags.trim()
        ? editTags.split(',').map(t => t.trim()).filter(Boolean)
        : []
      await updateGoal(editingGoal.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
        targetDate: editTargetDate || undefined,
        priority: editPriority,
        progress: parseInt(editProgress) || 0,
        tags,
      })
      setEditingGoal(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteGoal = async () => {
    if (!deleteGoalConfirm) return
    await deleteGoal(deleteGoalConfirm.goalId)
    setActiveGoal(null)
    setActiveTab('list')
    setDeleteGoalConfirm(null)
  }

  const handleSetAchieved = async (goal: Goal) => {
    await updateGoal(goal.id, { status: 'achieved', progress: 100 })
    if (activeGoal?.id === goal.id) {
      setActiveGoal({ ...goal, status: 'achieved', progress: 100 })
    }
  }

  const handleSetAbandoned = async () => {
    if (!abandonGoalConfirm) return
    await updateGoal(abandonGoalConfirm.id, { status: 'abandoned' })
    if (activeGoal?.id === abandonGoalConfirm.id) {
      setActiveGoal({ ...abandonGoalConfirm, status: 'abandoned' })
    }
    setAbandonGoalConfirm(null)
  }

  const handleAddActivity = async () => {
    if (!activeGoal || !quickActivityContent.trim()) return
    setAddingActivity(true)
    try {
      await addActivity({
        goalId: activeGoal.id,
        type: quickActivityType,
        content: quickActivityContent.trim(),
        progressBefore: activeGoal.progress,
        progressAfter: quickProgress ? parseInt(quickProgress) : undefined,
      })
      setQuickActivityContent('')
      setQuickProgress('')
    } finally {
      setAddingActivity(false)
    }
  }

  const openGoalDetail = (goal: Goal) => {
    setActiveGoal(goal)
    setActiveTab('detail')
  }

  const goalActivities = activeGoal ? (activities[activeGoal.id] || []) : []
  const goalSessions = activeGoal ? [] : [] // loaded separately if needed

  const filteredGoals = filterStatus
    ? goals.filter(g => g.status === filterStatus)
    : goals

  const inputCls = 'w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue'

  const progressColor = (p: number) => {
    if (p >= 80) return 'bg-accent-green'
    if (p >= 40) return 'bg-accent-yellow'
    return 'bg-accent-blue'
  }

  return (
    <div className="space-y-4 p-4 min-w-0">
      {/* 统计概览 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '进行中', value: stats.activeCount, color: 'text-accent-green' },
          { label: '已达成', value: stats.achievedCount, color: 'text-accent-blue' },
          { label: '本月达成', value: stats.achievedThisMonth, color: 'text-accent-purple' },
          { label: '平均进度', value: `${stats.avgProgress}%`, color: 'text-accent-yellow' },
        ].map((item, i) => (
          <div key={i} className="bg-bg-tertiary rounded-lg px-3 py-2.5 text-center border border-border">
            <div className={`text-xl font-semibold ${item.color}`}>{item.value}</div>
            <div className="text-xs text-text-muted mt-0.5">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg flex-1">
          {(['list', 'create'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setEditingGoal(null) }}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === tab ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab === 'list' ? `目标列表 (${filteredGoals.length})` : '创建目标'}
            </button>
          ))}
        </div>
        {activeTab === 'detail' && (
          <button
            onClick={() => { setActiveTab('list'); setActiveGoal(null) }}
            className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-xs text-text-muted hover:text-text-primary border border-border"
          >
            返回列表
          </button>
        )}
      </div>

      {/* 状态过滤器 */}
      {activeTab === 'list' && (
        <div className="flex gap-1.5">
          {([undefined, 'active', 'achieved', 'abandoned'] as const).map(s => (
            <button
              key={String(s)}
              onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                filterStatus === s
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                  : 'bg-bg-tertiary text-text-muted border border-border hover:text-text-secondary'
              }`}
            >
              {s ? STATUS_LABELS[s] : '全部'}
            </button>
          ))}
        </div>
      )}

      {/* 创建表单 */}
      {activeTab === 'create' && (
        <div className="p-4 bg-bg-tertiary rounded-xl border border-border space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">新建目标</p>
            <button onClick={() => setShowCreateForm(false)} className="text-text-muted hover:text-text-secondary">
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">目标标题 *</label>
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="例如：完成用户认证功能"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述</label>
            <textarea
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="目标的详细描述..."
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">截止日期</label>
              <input
                type="date"
                value={newTargetDate}
                onChange={e => setNewTargetDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">优先级</label>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as GoalPriority[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setNewPriority(p)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      newPriority === p
                        ? p === 'high' ? 'border-accent-red/50 bg-accent-red/10 text-accent-red'
                        : p === 'medium' ? 'border-accent-yellow/50 bg-accent-yellow/10 text-accent-yellow'
                        : 'border-accent-blue/50 bg-accent-blue/10 text-accent-blue'
                        : 'border-border bg-bg-secondary text-text-secondary'
                    }`}
                  >
                    {PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">标签（逗号分隔）</label>
            <input
              type="text"
              value={newTags}
              onChange={e => setNewTags(e.target.value)}
              placeholder="例如：后端, 认证, 重要"
              className={inputCls}
            />
          </div>

          <button
            onClick={handleCreateGoal}
            disabled={!newTitle.trim() || saving}
            className="w-full py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            创建目标
          </button>
        </div>
      )}

      {/* 目标列表 */}
      {activeTab === 'list' && (
        <div className="space-y-2">
          {filteredGoals.length === 0 ? (
            <div className="py-8 text-center">
              <Target className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-xs text-text-muted">暂无目标</p>
              <p className="text-xs text-text-muted mt-1">点击上方「创建目标」添加第一个目标</p>
            </div>
          ) : (
            filteredGoals.map(goal => (
              <div
                key={goal.id}
                className={`bg-bg-tertiary rounded-lg border border-border overflow-hidden hover:border-border-hover cursor-pointer ${
                  activeGoal?.id === goal.id ? 'border-accent-blue' : ''
                }`}
                onClick={() => openGoalDetail(goal)}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{goal.title}</p>
                      <span className={`text-xs ${STATUS_COLORS[goal.status]}`}>
                        {STATUS_LABELS[goal.status]}
                      </span>
                      <span className={`text-xs ${PRIORITY_COLORS[goal.priority]}`}>
                        {PRIORITY_LABELS[goal.priority]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {goal.targetDate && (
                        <span className="text-xs text-text-muted">
                          截止：{new Date(goal.targetDate).toLocaleDateString()}
                        </span>
                      )}
                      {goal.tags.length > 0 && (
                        <span className="text-xs text-text-muted">
                          {goal.tags.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div className="flex items-center gap-2 w-28">
                    <div className="flex-1 h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full ${progressColor(goal.progress)} transition-all`}
                        style={{ width: `${goal.progress}%` }}
                      />
                    </div>
                    <span className="text-xs text-text-muted w-8 text-right">{goal.progress}%</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 目标详情 */}
      {activeTab === 'detail' && activeGoal && (
        <div className="space-y-4">
          {/* 目标基本信息 */}
          <div className="bg-bg-tertiary rounded-xl border border-border p-4 space-y-3">
            {/* 编辑模式 */}
            {editingGoal ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-text-primary">编辑目标</p>
                  <button onClick={() => setEditingGoal(null)} className="text-text-muted hover:text-text-secondary">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">标题</label>
                  <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">描述</label>
                  <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">截止日期</label>
                    <input type="date" value={editTargetDate} onChange={e => setEditTargetDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">进度 %</label>
                    <input type="number" min={0} max={100} value={editProgress} onChange={e => setEditProgress(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">优先级</label>
                    <select value={editPriority} onChange={e => setEditPriority(e.target.value as GoalPriority)} className={inputCls}>
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">标签</label>
                  <input type="text" value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="逗号分隔" className={inputCls} />
                </div>
                <button onClick={handleSaveEdit} disabled={saving} className="w-full py-2 bg-accent-blue text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  保存修改
                </button>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-text-primary">{activeGoal.title}</h3>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[activeGoal.status]} bg-bg-secondary`}>
                        {STATUS_LABELS[activeGoal.status]}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_COLORS[activeGoal.priority]} bg-bg-secondary`}>
                        {PRIORITY_LABELS[activeGoal.priority]}
                      </span>
                    </div>
                    {activeGoal.description && (
                      <p className="text-sm text-text-secondary">{activeGoal.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                      {activeGoal.targetDate && <span>截止：{new Date(activeGoal.targetDate).toLocaleDateString()}</span>}
                      {activeGoal.tags.length > 0 && <span>{activeGoal.tags.join(', ')}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenEdit(activeGoal) }}
                      className="p-1.5 text-text-muted hover:text-text-primary rounded btn-transition"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSetAchieved(activeGoal) }}
                      className="p-1.5 text-text-muted hover:text-accent-green rounded btn-transition"
                      title="标记为已达成"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteGoalConfirm({ goalId: activeGoal.id, name: activeGoal.title }) }}
                      className="p-1.5 text-text-muted hover:text-accent-red rounded btn-transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 进度条 */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-secondary">完成进度</span>
                    <span className="text-text-primary font-medium">{activeGoal.progress}%</span>
                  </div>
                  <div className="h-2.5 bg-bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${progressColor(activeGoal.progress)} transition-all`}
                      style={{ width: `${activeGoal.progress}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 快速添加活动 */}
          {activeGoal.status === 'active' && !editingGoal && (
            <div className="bg-bg-tertiary rounded-xl border border-border p-4 space-y-3">
              <p className="text-sm font-medium text-text-primary">快速记录</p>
              <div className="flex gap-1.5">
                {(['note', 'checkpoint', 'reminder', 'review'] as GoalActivityType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => setQuickActivityType(type)}
                    className={`px-2 py-1 rounded text-xs border flex items-center gap-1 transition-colors ${
                      quickActivityType === type
                        ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                        : 'border-border bg-bg-secondary text-text-secondary hover:border-text-muted'
                    }`}
                  >
                    {ACTIVITY_ICONS[type]}
                    {ACTIVITY_LABELS[type]}
                  </button>
                ))}
              </div>
              <textarea
                value={quickActivityContent}
                onChange={e => setQuickActivityContent(e.target.value)}
                placeholder="记录内容..."
                rows={2}
                className={`${inputCls} resize-none`}
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={quickProgress}
                  onChange={e => setQuickProgress(e.target.value)}
                  placeholder="进度 0-100"
                  className="w-28 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                />
                <button
                  onClick={handleAddActivity}
                  disabled={!quickActivityContent.trim() || addingActivity}
                  className="flex-1 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {addingActivity ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  添加记录
                </button>
              </div>
            </div>
          )}

          {/* 活动时间线 */}
          {goalActivities.length > 0 && (
            <div className="bg-bg-tertiary rounded-xl border border-border p-4">
              <p className="text-sm font-medium text-text-primary mb-3">活动记录</p>
              <div className="space-y-2">
                {goalActivities.map((activity, idx) => (
                  <div key={activity.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-6 h-6 rounded-full bg-bg-secondary border border-border flex items-center justify-center flex-shrink-0">
                        {ACTIVITY_ICONS[activity.type]}
                      </div>
                      {idx < goalActivities.length - 1 && (
                        <div className="w-px flex-1 bg-border mt-1" />
                      )}
                    </div>
                    <div className="flex-1 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-secondary">
                          {ACTIVITY_LABELS[activity.type]}
                        </span>
                        {activity.progressAfter !== undefined && (
                          <span className="text-xs text-text-muted">
                            {activity.progressBefore}% → {activity.progressAfter}%
                          </span>
                        )}
                        <span className="text-xs text-text-muted ml-auto">
                          {new Date(activity.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-text-primary mt-0.5">{activity.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 删除目标确认 */}
      <ConfirmDialog
        open={!!deleteGoalConfirm}
        title="删除目标"
        message={`确定要永久删除目标「${deleteGoalConfirm?.name}」吗？此操作不可撤销。`}
        danger
        onConfirm={handleDeleteGoal}
        onCancel={() => setDeleteGoalConfirm(null)}
      />

      {/* 放弃目标确认 */}
      <ConfirmDialog
        open={!!abandonGoalConfirm}
        title="放弃目标"
        message={`确定要放弃目标「${abandonGoalConfirm?.title}」吗？`}
        onConfirm={handleSetAbandoned}
        onCancel={() => setAbandonGoalConfirm(null)}
      />
    </div>
  )
}
