/**
 * Agent Teams - 任务看板视图
 * 支持 Kanban 看板模式和 DAG 依赖图模式
 * @author weibin
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  LayoutGrid, GitBranch, Lock, AlertCircle, ChevronDown, RefreshCw, RotateCcw, UserRoundCheck, Hand
} from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'
import type { DAGValidation, TaskDAGNode, TeamTask } from '../../../shared/types'
import TaskEditDialog from './TaskEditDialog'
import EnhancedDAGView from './EnhancedDAGView'

type ViewMode = 'board' | 'dag'

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-green-500/20 text-green-400 border border-green-500/30',
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
  in_progress: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  completed: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  cancelled: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待办',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface TaskCardProps {
  task: TeamTask
  dagNode?: TaskDAGNode
  members: any[]
  onEdit: (task: TeamTask) => void
  onCancelTask: (teamId: string, taskId: string) => Promise<boolean>
  onRetryTask: (task: TeamTask, memberId?: string) => Promise<boolean>
  onManualTask: (task: TeamTask) => Promise<void>
  teamId: string
}

function TaskCard({ task, dagNode, members, onEdit, onCancelTask, onRetryTask, onManualTask, teamId }: TaskCardProps) {
  const [showMenu, setShowMenu] = useState(false)
  const colors = STATUS_COLORS[task.status] || STATUS_COLORS.pending
  const claimedMember = members.find((m: any) => m.id === task.claimedBy)
  const assignedMember = members.find((m: any) => m.id === task.assignedTo)
  const ownerMember = claimedMember || assignedMember
  const alternateMember = members.find((m: any) =>
    m.status !== 'failed' &&
    m.id !== ownerMember?.id &&
    (!ownerMember?.providerId || m.providerId !== ownerMember.providerId)
  ) || members.find((m: any) => m.status !== 'failed' && m.id !== ownerMember?.id)

  return (
    <div
      className={`relative p-2.5 rounded-lg border ${colors.bg} ${dagNode?.isBlocked ? 'border-red-500/40' : 'border-border'} hover:border-accent-blue/40 btn-transition cursor-pointer group`}
      onClick={() => onEdit(task)}
    >
      {/* 优先级 + 状态行 */}
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}`}>
          {task.priority === 'critical' ? '紧急' : task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}
        </span>
        <div className="flex items-center gap-1">
          {dagNode?.isBlocked && (
            <div className="flex items-center gap-0.5 text-[10px] text-red-400" title={`被 ${dagNode.blockedBy.length} 个任务阻塞`}>
              <Lock className="w-2.5 h-2.5" />
            </div>
          )}
          <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
          <span className={`text-[10px] ${colors.text}`}>{STATUS_LABELS[task.status] || task.status}</span>
        </div>
      </div>

      {/* 标题 */}
      <div className="text-xs text-text-primary font-medium leading-snug mb-1.5 line-clamp-2">
        {task.title}
      </div>

      {/* 底部信息 */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {claimedMember ? (
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-[10px]">{claimedMember.role?.icon || '👤'}</span>
              <span className="text-[10px] text-text-muted truncate max-w-[80px]">{claimedMember.role?.name || claimedMember.roleId}</span>
            </div>
          ) : (
            <span className="text-[10px] text-text-muted">未指派</span>
          )}
        </div>
        {dagNode && (
          <span className="text-[10px] text-text-muted flex-shrink-0">
            波次 {dagNode.executionWave + 1}
          </span>
        )}
      </div>

      {/* 阻塞提示 */}
      {dagNode?.isBlocked && dagNode.blockedBy.length > 0 && (
        <div className="mt-1.5 p-1.5 rounded bg-red-500/10 border border-red-500/20">
          <div className="text-[9px] text-red-400 flex items-center gap-1">
            <Lock className="w-2.5 h-2.5 flex-shrink-0" />
            <span>等待 {dagNode.blockedBy.length} 个依赖完成</span>
          </div>
        </div>
      )}

      {task.status === 'failed' && (
        <div className="mt-2 space-y-1.5">
          {task.result && (
            <div className="line-clamp-2 rounded bg-red-500/10 px-1.5 py-1 text-[10px] text-red-300">
              {task.result}
            </div>
          )}
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); void onRetryTask(task) }}
              className="flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary hover:text-accent-green"
              title="重置为待办，让团队重新认领"
            >
              <RotateCcw className="h-3 w-3" />
              重试
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (alternateMember) void onRetryTask(task, alternateMember.id) }}
              disabled={!alternateMember}
              className="flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary hover:text-accent-blue disabled:opacity-40"
              title={alternateMember ? `改派给 ${alternateMember.role?.name || alternateMember.roleId} (${alternateMember.providerId})` : '没有可用的其他成员'}
            >
              <UserRoundCheck className="h-3 w-3" />
              换模型
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void onManualTask(task) }}
              className="flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-1 text-[10px] text-text-secondary hover:text-yellow-500"
              title="向团队广播人工介入请求"
            >
              <Hand className="h-3 w-3" />
              人工
            </button>
          </div>
        </div>
      )}

      {/* 操作菜单（hover 显示） */}
      {task.status === 'pending' || task.status === 'in_progress' ? (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
            className="p-1 rounded hover:bg-bg-hover text-text-muted"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-6 z-10 w-28 bg-bg-secondary border border-border rounded-lg shadow-lg py-1">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(false); onEdit(task) }}
                className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover"
              >
                编辑任务
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(false); onCancelTask(teamId, task.id) }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
              >
                取消任务
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface DAGViewProps {
  tasks: TeamTask[]
  dag: TaskDAGNode[]
  validation: DAGValidation
  onEdit: (task: TeamTask) => void
}

function DAGView({ tasks, dag, validation, onEdit }: DAGViewProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const taskMap = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const dagMap = useMemo(() => new Map(dag.map(d => [d.taskId, d])), [dag])

  // 计算布局
  const waves = useMemo(() => {
    const waveMap = new Map<number, TaskDAGNode[]>()
    for (const node of dag) {
      const wave = node.executionWave
      if (!waveMap.has(wave)) waveMap.set(wave, [])
      waveMap.get(wave)!.push(node)
    }
    return Array.from(waveMap.entries()).sort((a, b) => a[0] - b[0])
  }, [dag])
  const waveEntries = useMemo(() => Object.fromEntries(waves), [waves])

  const maxWaveHeight = Math.max(...waves.map(([, nodes]) => nodes.length), 1)

  if (dag.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-text-muted">
        <GitBranch className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">暂无任务，无法绘制依赖图</p>
      </div>
    )
  }

  // 验证提示
  if (!validation.valid) {
    return (
      <div className="p-3 mb-3 rounded-lg bg-red-500/10 border border-red-500/30">
        <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
          <AlertCircle className="w-3.5 h-3.5" />
          检测到循环依赖
        </div>
        {validation.cycles.map((cycle, i) => (
          <div key={i} className="text-[10px] text-red-300 ml-5">{cycle.join(' → ')}</div>
        ))}
      </div>
    )
  }

  const hoveredDag = hoveredNode ? dagMap.get(hoveredNode) : null
  // 高亮上游（被 hovered 节点依赖的）
  const upstreamIds = useMemo(() => {
    if (!hoveredDag) return new Set<string>()
    const ids = new Set<string>()
    const queue = [...hoveredDag.dependsOn]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (ids.has(id)) continue
      ids.add(id)
      const n = dagMap.get(id)
      if (n) queue.push(...n.dependsOn)
    }
    return ids
  }, [hoveredDag, dagMap])
  // 高亮下游（依赖 hovered 节点的）
  const downstreamIds = useMemo(() => {
    if (!hoveredDag) return new Set<string>()
    const ids = new Set<string>()
    const queue = [...hoveredDag.dependents]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (ids.has(id)) continue
      ids.add(id)
      const n = dagMap.get(id)
      if (n) queue.push(...n.dependents)
    }
    return ids
  }, [hoveredDag, dagMap])

  const CELL_WIDTH = 160
  const CELL_HEIGHT = 90
  const WAVE_GAP = 60
  const PADDING = 24

  const totalWidth = (waves.length * CELL_WIDTH) + ((waves.length - 1) * WAVE_GAP) + (PADDING * 2)
  const totalHeight = (maxWaveHeight * CELL_HEIGHT) + (maxWaveHeight * 8) + (PADDING * 2)

  return (
    <div className="overflow-auto">
      {/* 图例 */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <span className="w-3 h-3 rounded border-2 border-dashed border-green-400/50" />
          <span>就绪可执行</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <span className="w-3 h-3 rounded border-2 border-dashed border-red-400/50" />
          <span>被阻塞</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <span className="w-3 h-3 bg-blue-400/20 rounded" />
          <span>进行中</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <span className="w-3 h-3 bg-green-400/20 rounded" />
          <span>已完成</span>
        </div>
        <span className="text-[10px] text-text-muted ml-auto">
          悬停节点可查看上下游依赖链
        </span>
      </div>

      <svg
        width={Math.max(totalWidth, 400)}
        height={Math.max(totalHeight, 200)}
        className="overflow-visible"
      >
        {/* 绘制边（依赖箭头） */}
        {dag.map(node => {
          const nodeX = PADDING + node.executionWave * (CELL_WIDTH + WAVE_GAP)
          const nodeIdx = waveEntries[node.executionWave]?.findIndex(n => n.taskId === node.taskId) ?? 0
          const nodeY = PADDING + nodeIdx * (CELL_HEIGHT + 8)

          return node.dependsOn.map(depId => {
            const dep = dagMap.get(depId)
            if (!dep) return null
            const depX = PADDING + dep.executionWave * (CELL_WIDTH + WAVE_GAP)
            const depIdx = waveEntries[dep.executionWave]?.findIndex(n => n.taskId === depId) ?? 0
            const depY = PADDING + depIdx * (CELL_HEIGHT + 8)

            const isHighlighted = hoveredNode === node.taskId || hoveredNode === depId
            const isUpstream = upstreamIds.has(depId)
            const isDownstream = downstreamIds.has(node.taskId)

            const stroke = isHighlighted ? '#58A6FF' : (isUpstream || isDownstream) ? '#58A6FF60' : '#6B728040'
            const strokeWidth = isHighlighted ? 2 : 1

            // 曲线：右出左入
            const sx = nodeX
            const sy = nodeY + CELL_HEIGHT / 2
            const ex = depX + CELL_WIDTH
            const ey = depY + CELL_HEIGHT / 2
            const mx = (sx + ex) / 2

            return (
              <path
                key={`${depId}-${node.taskId}`}
                d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`}
                stroke={stroke}
                strokeWidth={strokeWidth}
                fill="none"
                markerEnd="url(#arrowhead)"
              />
            )
          })
        })}

        {/* 箭头标记 */}
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M 0 0 L 6 3 L 0 6 Z" fill="#6B7280" />
          </marker>
        </defs>

        {/* 绘制节点 */}
        {dag.map((node, nodeIdx) => {
          const task = taskMap.get(node.taskId)
          if (!task) return null
          const x = PADDING + node.executionWave * (CELL_WIDTH + WAVE_GAP)
          const idx = waveEntries[node.executionWave]?.findIndex(n => n.taskId === node.taskId) ?? 0
          const y = PADDING + idx * (CELL_HEIGHT + 8)

          const isHighlighted = hoveredNode === node.taskId
          const isUpstream = upstreamIds.has(node.taskId)
          const isDownstream = downstreamIds.has(node.taskId)
          const colors = STATUS_COLORS[task.status] || STATUS_COLORS.pending

          let borderColor = 'var(--color-border)'
          let bgColor = 'var(--color-bg-secondary)'
          if (isHighlighted) {
            borderColor = '#58A6FF'
            bgColor = '#58A6FF10'
          } else if (isUpstream || isDownstream) {
            borderColor = '#58A6FF60'
          } else if (node.isBlocked) {
            borderColor = '#F8514960'
          }

          return (
            <g
              key={node.taskId}
              transform={`translate(${x}, ${y})`}
              className="cursor-pointer"
              onClick={() => onEdit(task)}
              onMouseEnter={() => setHoveredNode(node.taskId)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* 背景 */}
              <rect
                width={CELL_WIDTH}
                height={CELL_HEIGHT}
                rx={6}
                fill={isHighlighted ? bgColor : colors.bg}
                stroke={borderColor}
                strokeWidth={isHighlighted ? 2 : 1}
                strokeDasharray={node.isBlocked && !isHighlighted ? '4,2' : undefined}
              />
              {/* 优先级条 */}
              <rect
                width={4}
                height={CELL_HEIGHT}
                rx={2}
                fill={task.priority === 'critical' ? '#F85149' : task.priority === 'high' ? '#D29922' : task.priority === 'medium' ? '#E3B341' : '#3FB950'}
              />
              {/* 标题 */}
              <text
                x={12}
                y={20}
                className="fill-[var(--color-text-primary)]"
                style={{ fontSize: '11px', fontWeight: 500 }}
              >
                {task.title.length > 18 ? task.title.slice(0, 18) + '…' : task.title}
              </text>
              {/* 状态 + 波次 */}
              <text
                x={12}
                y={36}
                className="fill-[var(--color-text-muted)]"
                style={{ fontSize: '9px' }}
              >
                {STATUS_LABELS[task.status] || task.status} · 波次 {node.executionWave + 1}
              </text>
              {/* 依赖信息 */}
              {node.dependsOn.length > 0 && (
                <text x={12} y={52} className="fill-[var(--color-text-muted)]" style={{ fontSize: '9px' }}>
                  ← {node.dependsOn.length} 个依赖
                </text>
              )}
              {/* 阻塞信息 */}
              {node.isBlocked && (
                <g transform="translate(12, 60)">
                  <rect width={10} height={10} rx={2} fill="#F8514920" />
                  <text x={12} y={9} className="fill-red-400" style={{ fontSize: '9px' }}>🔒</text>
                </g>
              )}
              {/* 悬停时显示"查看" */}
              {isHighlighted && (
                <text
                  x={CELL_WIDTH / 2}
                  y={CELL_HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-accent-blue"
                  style={{ fontSize: '9px' }}
                >
                  点击编辑
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface TaskBoardViewProps {
  teamId: string
  tasks: TeamTask[]
  members: any[]
}

export default function TaskBoardView({ teamId, tasks, members }: TaskBoardViewProps) {
  const { fetchTaskDAG, cancelTask, retryTask, broadcastMessage } = useTeamStore()
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [dag, setDAG] = useState<TaskDAGNode[]>([])
  const [validation, setValidation] = useState<DAGValidation>({ valid: true, cycles: [], missingDependencies: [], readyTasks: [], blockedTasks: [] })
  const [editingTask, setEditingTask] = useState<TeamTask | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadDAG = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await fetchTaskDAG(teamId)
      setDAG(result.dag || [])
      setValidation(result.validation || { valid: true, cycles: [], missingDependencies: [], readyTasks: [], blockedTasks: [] })
    } finally {
      setRefreshing(false)
    }
  }, [teamId, fetchTaskDAG])

  useEffect(() => {
    loadDAG()
  }, [loadDAG])

  // 实时更新 DAG：当任务列表变化时，重新加载
  useEffect(() => {
    if (viewMode === 'dag') {
      loadDAG()
    }
  }, [tasks, viewMode, loadDAG])

  const dagMap = useMemo(() => new Map(dag.map(d => [d.taskId, d])), [dag])

  const handleCancelTask = async (tid: string, taskId: string): Promise<boolean> => {
    return cancelTask(tid, taskId)
  }

  const handleRetryTask = async (task: TeamTask, memberId?: string): Promise<boolean> => {
    const note = memberId ? '换模型/成员后重试' : '原任务重试'
    const retried = await retryTask(teamId, task.id, { memberId, note })
    if (retried) {
      await loadDAG()
      return true
    }
    return false
  }

  const handleManualTask = async (task: TeamTask): Promise<void> => {
    const note = prompt('转人工处理说明', `请人工介入处理失败任务：${task.title}`)
    if (note === null) return
    await broadcastMessage(teamId, note.trim() || `请人工介入处理失败任务：${task.title}`)
  }

  const columns: { key: string; label: string; statuses: string[] }[] = [
    { key: 'pending', label: '待办', statuses: ['pending'] },
    { key: 'in_progress', label: '进行中', statuses: ['in_progress'] },
    { key: 'completed', label: '已完成', statuses: ['completed'] },
    { key: 'terminal', label: '终止', statuses: ['failed', 'cancelled'] },
  ]

  const completedCount = tasks.filter(t => t.status === 'completed').length
  const totalCount = tasks.length
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('board')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                viewMode === 'board' ? 'bg-accent-blue/20 text-accent-blue' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <LayoutGrid className="w-3 h-3" />
              看板
            </button>
            <button
              onClick={() => { setViewMode('dag'); loadDAG() }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                viewMode === 'dag' ? 'bg-accent-blue/20 text-accent-blue' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <GitBranch className="w-3 h-3" />
              依赖图
            </button>
          </div>

          {/* 进度 */}
          {totalCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div className="h-full bg-accent-green rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-[10px] text-text-muted">{completedCount}/{totalCount}</span>
            </div>
          )}

          {/* DAG 验证提示 */}
          {!validation.valid && (
            <div className="flex items-center gap-1 text-red-400 text-[10px]">
              <AlertCircle className="w-3 h-3" />
              <span>存在循环依赖</span>
            </div>
          )}
          {validation.missingDependencies.length > 0 && (
            <div className="flex items-center gap-1 text-yellow-400 text-[10px]">
              <AlertCircle className="w-3 h-3" />
              <span>{validation.missingDependencies.length} 个缺失依赖</span>
            </div>
          )}
        </div>

        <button
          onClick={loadDAG}
          className="p-1.5 text-text-muted hover:text-text-secondary hover:bg-bg-hover rounded transition-colors"
          title="刷新 DAG"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'board' ? (
          <div className="grid grid-cols-4 gap-3 h-full">
            {columns.map(col => {
              const colTasks = tasks.filter(t => col.statuses.includes(t.status))
              return (
                <div key={col.key} className="flex flex-col min-h-0">
                  {/* 列头 */}
                  <div className="flex items-center justify-between mb-2 px-1 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        col.key === 'pending' ? 'bg-gray-400' :
                        col.key === 'in_progress' ? 'bg-blue-400' :
                        col.key === 'completed' ? 'bg-green-400' : 'bg-yellow-400'
                      }`} />
                      <span className="text-xs font-medium text-text-secondary">{col.label}</span>
                      <span className="text-[10px] text-text-muted">({colTasks.length})</span>
                    </div>
                  </div>

                  {/* 任务列表 */}
                  <div className="flex-1 space-y-2 overflow-y-auto">
                    {colTasks.length === 0 ? (
                      <div className="text-center text-text-muted text-[10px] py-4 opacity-50">
                        {col.label === '终止' ? '无终止任务' : '无任务'}
                      </div>
                    ) : (
                      colTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dagNode={dagMap.get(task.id)}
                          members={members}
                          onEdit={setEditingTask}
                          onCancelTask={handleCancelTask}
                          onRetryTask={handleRetryTask}
                          onManualTask={handleManualTask}
                          teamId={teamId}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EnhancedDAGView
            tasks={tasks}
            dag={dag}
            validation={validation}
            onEdit={setEditingTask}
          />
        )}
      </div>

      {/* 任务编辑弹窗 */}
      {editingTask && (
        <TaskEditDialog
          task={editingTask}
          allTasks={tasks}
          members={members}
          teamId={teamId}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  )
}
