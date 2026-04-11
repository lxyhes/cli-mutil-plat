/**
 * Scheduler 设置面板 - 定时任务调度配置
 */
import { useState, useEffect } from 'react'
import {
  Clock, Play, Pause, Trash2, Plus, Loader2, Check, Zap,
  ChevronDown, ChevronRight, AlertCircle, CheckCircle2, XCircle
} from 'lucide-react'
import { useSchedulerStore, type ScheduledTask, type TaskRun, type ScheduleType } from '../../stores/schedulerStore'

const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  interval: '间隔执行',
  cron: 'Cron 表达式',
  once: '单次执行',
  daily: '每日定时',
  weekly: '每周定时',
}

const RUN_STATUS_COLORS: Record<string, string> = {
  pending: 'text-text-muted',
  running: 'text-accent-yellow',
  completed: 'text-accent-green',
  failed: 'text-accent-red',
  cancelled: 'text-text-muted',
  timeout: 'text-accent-orange',
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: '等待',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '超时',
}

export default function SchedulerSettings() {
  const {
    tasks,
    recentRuns,
    status,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    triggerRun,
    fetchRecentRuns,
    validateCron,
    initListeners,
    cleanup,
  } = useSchedulerStore()

  const [activeTab, setActiveTab] = useState<'tasks' | 'runs'>('tasks')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newScheduleType, setNewScheduleType] = useState<ScheduleType>('interval')
  const [newCron, setNewCron] = useState('*/5 * * * *')
  const [newIntervalSecs, setNewIntervalSecs] = useState(300)
  const [newPrompt, setNewPrompt] = useState('')
  const [cronError, setCronError] = useState<string | null>(null)
  const [cronValidating, setCronValidating] = useState(false)
  const [cronNextRun, setCronNextRun] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [taskRuns, setTaskRuns] = useState<Record<string, TaskRun[]>>({})

  useEffect(() => {
    fetchTasks()
    fetchRecentRuns(50)
    initListeners()
    return () => cleanup()
  }, [])

  // Validate cron on change
  useEffect(() => {
    if (newScheduleType === 'cron' || newScheduleType === 'daily' || newScheduleType === 'weekly') {
      const timer = setTimeout(async () => {
        if (!newCron.trim()) { setCronError(null); setCronNextRun(null); return }
        setCronValidating(true)
        const result = await validateCron(newCron.trim())
        setCronValidating(false)
        if (result.valid) {
          setCronError(null)
          setCronNextRun(result.nextRun ? new Date(result.nextRun).toLocaleString() : null)
        } else {
          setCronError(result.error || '无效的 Cron 表达式')
          setCronNextRun(null)
        }
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [newCron, newScheduleType])

  const handleCreateTask = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const scheduleType = newScheduleType as ScheduleType
      const data: any = {
        name: newName.trim(),
        description: newDescription.trim(),
        taskType: 'prompt',
        scheduleType,
        config: { prompt: newPrompt.trim() },
      }
      if (scheduleType === 'cron' || scheduleType === 'daily' || scheduleType === 'weekly') {
        data.cronExpression = newCron.trim()
      }
      if (scheduleType === 'interval') {
        data.intervalSeconds = newIntervalSecs
      }
      const result = await createTask(data)
      if (result.success) {
        setShowCreateForm(false)
        setNewName(''); setNewDescription(''); setNewCron('*/5 * * * *')
        setNewIntervalSecs(300); setNewPrompt(''); setCronError(null); setCronNextRun(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleToggleTask = async (task: ScheduledTask) => {
    await updateTask(task.id, { isEnabled: !task.isEnabled })
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('确定删除此定时任务？')) return
    await deleteTask(taskId)
  }

  const handleTrigger = async (taskId: string) => {
    await triggerRun(taskId)
    fetchRecentRuns(50)
  }

  const toggleExpandTask = async (taskId: string) => {
    if (expandedTask === taskId) {
      setExpandedTask(null)
    } else {
      setExpandedTask(taskId)
      const runs = await useSchedulerStore.getState().fetchRuns(taskId, 10)
      setTaskRuns(prev => ({ ...prev, [taskId]: runs }))
    }
  }

  const getTaskRuns = (taskId: string): TaskRun[] => taskRuns[taskId] || []

  const statusColors: Record<string, string> = {
    stopped: 'text-text-muted',
    running: 'text-accent-green',
    error: 'text-accent-red',
  }

  const statusLabels: Record<string, string> = {
    stopped: '已停止',
    running: '运行中',
    error: '错误',
  }

  const renderRunIcon = (runStatus: string) => {
    if (runStatus === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
    if (runStatus === 'failed' || runStatus === 'timeout') return <XCircle className="w-3.5 h-3.5 text-accent-red" />
    if (runStatus === 'running') return <Loader2 className="w-3.5 h-3.5 text-accent-yellow animate-spin" />
    return <AlertCircle className="w-3.5 h-3.5 text-text-muted" />
  }

  return (
    <div className="space-y-4 p-4 min-w-0">
      {/* 状态栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
          <span className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-accent-green' : status === 'error' ? 'bg-accent-red' : 'bg-text-muted'}`} />
          <span className={`text-sm ${statusColors[status] || 'text-text-muted'}`}>
            {statusLabels[status] || status}
          </span>
          <span className="text-xs text-text-muted">· {tasks.length} 个任务</span>
        </div>
        <button
          onClick={() => { setShowCreateForm(true); setActiveTab('tasks') }}
          className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          新建任务
        </button>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
        {(['tasks', 'runs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'tasks' ? `任务列表 (${tasks.length})` : `最近执行 (${recentRuns.length})`}
          </button>
        ))}
      </div>

      {/* 新建表单 */}
      {showCreateForm && (
        <div className="p-4 bg-bg-tertiary rounded-xl border border-border space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">新建定时任务</p>
            <button onClick={() => setShowCreateForm(false)} className="text-text-muted hover:text-text-secondary">
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          {/* 任务名称 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">任务名称 *</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="例如：每日代码审查"
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

          {/* 执行方式 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">执行方式</label>
            <div className="grid grid-cols-2 gap-2">
              {(['interval', 'cron', 'once', 'daily'] as ScheduleType[]).map(st => (
                <button
                  key={st}
                  onClick={() => { setNewScheduleType(st); setCronError(null); setCronNextRun(null) }}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    newScheduleType === st
                      ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                      : 'border-border bg-bg-secondary text-text-secondary hover:border-border-hover'
                  }`}
                >
                  {SCHEDULE_TYPE_LABELS[st]}
                </button>
              ))}
            </div>
          </div>

          {/* Cron 表达式 */}
          {(newScheduleType === 'cron' || newScheduleType === 'daily') && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Cron 表达式</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCron}
                  onChange={e => setNewCron(e.target.value)}
                  placeholder="*/5 * * * *"
                  className="flex-1 px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                />
                {cronValidating && <Loader2 className="w-4 h-4 animate-spin text-text-muted mt-2" />}
              </div>
              {cronError && <p className="mt-1 text-xs text-accent-red">{cronError}</p>}
              {cronNextRun && !cronError && <p className="mt-1 text-xs text-accent-green">下次执行：{cronNextRun}</p>}
              <p className="mt-1 text-xs text-text-muted">格式：分 时 日 月 周（例：0 9 * * * = 每天 9:00）</p>
            </div>
          )}

          {/* 间隔秒数 */}
          {newScheduleType === 'interval' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">间隔（秒）</label>
              <div className="flex gap-2">
                {[60, 300, 900, 3600].map(secs => (
                  <button
                    key={secs}
                    onClick={() => setNewIntervalSecs(secs)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      newIntervalSecs === secs
                        ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                        : 'border-border bg-bg-secondary text-text-secondary'
                    }`}
                  >
                    {secs < 60 ? `${secs}秒` : secs < 3600 ? `${secs / 60}分钟` : `${secs / 3600}小时`}
                  </button>
                ))}
                <input
                  type="number"
                  value={newIntervalSecs}
                  onChange={e => setNewIntervalSecs(parseInt(e.target.value) || 60)}
                  min={10}
                  className="w-20 px-2 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs text-text-primary text-center focus:outline-none focus:border-accent-blue"
                />
              </div>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Prompt 内容</label>
            <textarea
              value={newPrompt}
              onChange={e => setNewPrompt(e.target.value)}
              placeholder="在此输入 AI 执行指令..."
              rows={3}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
            />
          </div>

          <button
            onClick={handleCreateTask}
            disabled={!newName.trim() || saving || !!cronError}
            className="w-full py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            创建任务
          </button>
        </div>
      )}

      {/* 任务列表 */}
      {activeTab === 'tasks' && (
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <div className="py-8 text-center">
              <Clock className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-xs text-text-muted">暂无定时任务</p>
              <p className="text-xs text-text-muted mt-1">点击上方「新建任务」创建第一个定时任务</p>
            </div>
          ) : (
            tasks.map(task => (
              <div key={task.id} className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
                {/* 任务行 */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button onClick={() => toggleExpandTask(task.id)} className="text-text-muted hover:text-text-secondary">
                    {expandedTask === task.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{task.name}</p>
                      {!task.isEnabled && (
                        <span className="px-1.5 py-0.5 bg-bg-secondary rounded text-xs text-text-muted">已禁用</span>
                      )}
                      {task.isPaused && (
                        <span className="px-1.5 py-0.5 bg-accent-orange/10 rounded text-xs text-accent-orange">暂停</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-text-muted">
                        {SCHEDULE_TYPE_LABELS[task.scheduleType as ScheduleType] || task.scheduleType}
                        {task.scheduleType === 'interval' && task.intervalSeconds ? ` · ${task.intervalSeconds}s` : ''}
                        {task.cronExpression ? ` · ${task.cronExpression}` : ''}
                      </span>
                    </div>
                  </div>

                  {/* 启用开关 */}
                  <button
                    onClick={() => handleToggleTask(task)}
                    className={`relative w-9 h-5 rounded-full transition-colors ${task.isEnabled ? 'bg-accent-blue' : 'bg-bg-secondary'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${task.isEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>

                  {/* 立即执行 */}
                  <button
                    onClick={() => handleTrigger(task.id)}
                    title="立即执行"
                    className="p-1.5 text-accent-blue hover:bg-accent-blue/10 rounded btn-transition"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>

                  {/* 删除 */}
                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="p-1.5 text-text-muted hover:text-accent-red rounded btn-transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 扩展详情 */}
                {expandedTask === task.id && (
                  <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/50">
                    {task.description && (
                      <p className="text-xs text-text-secondary mt-2">{task.description}</p>
                    )}
                    <div className="flex flex-wrap gap-4 text-xs text-text-muted">
                      {task.nextRunAt && <span>下次：{new Date(task.nextRunAt).toLocaleString()}</span>}
                      {task.lastRunAt && <span>上次：{new Date(task.lastRunAt).toLocaleString()}</span>}
                      <span>超时：{task.timeoutSeconds}s</span>
                      <span>最大失败：{task.maxFailures}</span>
                    </div>
                    {/* 最近运行记录 */}
                    {getTaskRuns(task.id).length > 0 ? (
                      <div className="space-y-1 mt-2">
                        <p className="text-xs font-medium text-text-secondary">最近执行</p>
                        {getTaskRuns(task.id).slice(0, 5).map(run => (
                          <div key={run.id} className="flex items-center gap-2 text-xs">
                            {renderRunIcon(run.status)}
                            <span className={RUN_STATUS_COLORS[run.status] || 'text-text-muted'}>
                              {RUN_STATUS_LABELS[run.status] || run.status}
                            </span>
                            {run.startedAt && (
                              <span className="text-text-muted">
                                {new Date(run.startedAt).toLocaleString()}
                              </span>
                            )}
                            {run.durationMs !== undefined && (
                              <span className="text-text-muted">({(run.durationMs / 1000).toFixed(1)}s)</span>
                            )}
                            {run.error && <span className="text-accent-red truncate max-w-48">{run.error}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-text-muted mt-1">暂无执行记录</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 最近执行记录 */}
      {activeTab === 'runs' && (
        <div className="space-y-1">
          {recentRuns.length === 0 ? (
            <div className="py-8 text-center">
              <AlertCircle className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-xs text-text-muted">暂无执行记录</p>
            </div>
          ) : (
            recentRuns.map(run => {
              const task = tasks.find(t => t.id === run.scheduledTaskId)
              return (
                <div key={run.id} className="flex items-center gap-2.5 px-3 py-2 bg-bg-tertiary rounded-lg">
                  {renderRunIcon(run.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">
                      {task?.name || run.scheduledTaskId.slice(0, 16)}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span className={RUN_STATUS_COLORS[run.status]}>
                        {RUN_STATUS_LABELS[run.status] || run.status}
                      </span>
                      {run.startedAt && (
                        <span>{new Date(run.startedAt).toLocaleString()}</span>
                      )}
                      {run.durationMs !== undefined && (
                        <span>{(run.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {run.error && <p className="text-xs text-accent-red mt-0.5 truncate">{run.error}</p>}
                  </div>
                  <span className="text-xs text-text-muted">{run.triggerType === 'manual' ? '手动' : '定时'}</span>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Cron 帮助 */}
      <div className="p-3 bg-bg-tertiary rounded-lg">
        <p className="text-xs font-medium text-text-secondary mb-1.5">Cron 表达式格式</p>
        <div className="text-xs text-text-muted space-y-0.5 font-mono">
          <div><span className="text-text-secondary">分</span> <span className="text-text-secondary">时</span> <span className="text-text-secondary">日</span> <span className="text-text-secondary">月</span> <span className="text-text-secondary">周</span></div>
          <div>0-59 0-23 1-31 1-12 0-6 (周日=0)</div>
          <div className="pt-1">例：<span className="text-text-secondary">0 9 * * *</span> = 每天 9:00</div>
          <div>例：<span className="text-text-secondary">*/15 * * * *</span> = 每 15 分钟</div>
          <div>例：<span className="text-text-secondary">0 9,18 * * 1-5</span> = 工作日 9:00 和 18:00</div>
        </div>
      </div>
    </div>
  )
}
