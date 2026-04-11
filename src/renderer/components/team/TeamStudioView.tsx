import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock3,
  Focus,
  MessageSquareText,
  Radio,
  Send,
  TerminalSquare,
  TimerReset,
} from 'lucide-react'
import type { TeamInstance, TeamMember, TeamMessage, TeamTask } from '../../../shared/types'
import type { TeamLogEntry } from '../../stores/teamStore'
import { useTeamStore } from '../../stores/teamStore'

interface TeamStudioViewProps {
  team: TeamInstance
  tasks: TeamTask[]
  messages: TeamMessage[]
  teamLogs: TeamLogEntry[]
  selectedMemberId?: string | null
  onSelectMember: (member: TeamMember) => void
}

type StudioTab = 'timeline' | 'logs' | 'collaboration'
type MemberFilter = 'all' | 'focused' | 'watch' | 'error' | 'done'

interface TimelineItem {
  id: string
  timestamp: string
  title: string
  description: string
  tone: 'focused' | 'waiting' | 'done' | 'error' | 'info'
}

interface CollaborationEdge {
  id: string
  fromId: string
  toId: string
  messageCount: number
  handoffCount: number
  lastTouchedAt?: string
  intensity: number
}

interface MemberStudioState {
  member: TeamMember
  currentTask?: TeamTask
  queuedTasks: TeamTask[]
  recentMessage?: TeamMessage
  energy: number
  mood: 'focused' | 'waiting' | 'done' | 'error' | 'idle'
  riskScore: number
  riskLabel: 'stable' | 'watch' | 'high'
}

interface StudioRecommendation {
  id: string
  title: string
  detail: string
  actionLabel: string
  tone: 'warning' | 'error' | 'info'
  mode: 'member' | 'broadcast'
  memberId?: string
  prompt: string
}

interface StudioOverviewNode {
  state: MemberStudioState
  x: number
  y: number
  isHub: boolean
}

interface TeamActivityItem extends TimelineItem {
  actor?: string
  actorMemberId?: string
}

interface QuickCommandTemplate {
  id: string
  label: string
  prompt: string
  tone: 'default' | 'primary' | 'warning'
  mode: 'member' | 'broadcast'
}

interface StudioActionFeedback {
  tone: 'success' | 'error' | 'info'
  title: string
  detail: string
  createdAt: number
}

interface MonitorDeskState {
  state: MemberStudioState
  lines: string[]
  loading: boolean
  error?: string
}

function formatRelativeTime(timestamp?: string): string {
  if (!timestamp) return '刚刚'
  const diff = Date.now() - new Date(timestamp).getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`
  return new Date(timestamp).toLocaleDateString()
}

function truncate(text: string | undefined, maxLength: number): string {
  if (!text) return '暂无动态'
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function minutesSince(timestamp?: string): number | null {
  if (!timestamp) return null
  return Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000))
}

function extractLogLines(chunks: string[], limit: number): string[] {
  return chunks
    .flatMap(chunk => chunk.split('\n'))
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(-limit)
}

function extractLogLinesFromText(text: string, limit: number): string[] {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(-limit)
}

function getMemberMood(member: TeamMember): MemberStudioState['mood'] {
  if (member.status === 'running') return 'focused'
  if (member.status === 'waiting') return 'waiting'
  if (member.status === 'completed') return 'done'
  if (member.status === 'failed') return 'error'
  return 'idle'
}

function getMemberEnergy(member: TeamMember, currentTask?: TeamTask): number {
  if (member.status === 'running') return currentTask ? 86 : 70
  if (member.status === 'waiting') return 42
  if (member.status === 'completed') return 96
  if (member.status === 'failed') return 24
  return 30
}

function getStatusLabel(member: TeamMember, currentTask?: TeamTask): string {
  if (member.status === 'running') return currentTask ? '执行中' : '协作中'
  if (member.status === 'waiting') return '等待中'
  if (member.status === 'completed') return '已完成'
  if (member.status === 'failed') return '需介入'
  return '待命中'
}

function getStatusTone(mood: MemberStudioState['mood'] | TimelineItem['tone']): string {
  switch (mood) {
    case 'focused':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    case 'waiting':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    case 'done':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
    case 'error':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
    default:
      return 'border-border bg-bg-tertiary text-text-secondary'
  }
}

function getRiskTone(riskLabel: MemberStudioState['riskLabel']): string {
  if (riskLabel === 'high') return 'border-rose-500/30 bg-rose-500/10 text-rose-200'
  if (riskLabel === 'watch') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
}

function getFeedbackTone(tone: StudioActionFeedback['tone']): string {
  if (tone === 'success') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
  if (tone === 'error') return 'border-rose-500/25 bg-rose-500/10 text-rose-200'
  return 'border-sky-500/25 bg-sky-500/10 text-sky-200'
}

function getActivityIcon(mood: MemberStudioState['mood'] | TimelineItem['tone']) {
  switch (mood) {
    case 'focused':
      return <Activity size={12} />
    case 'waiting':
      return <Clock3 size={12} />
    case 'done':
      return <CheckCircle2 size={12} />
    case 'error':
      return <AlertTriangle size={12} />
    default:
      return <TimerReset size={12} />
  }
}

function pickLogTone(line: string): TimelineItem['tone'] {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('failed')) return 'error'
  if (lower.includes('completed') || lower.includes('done') || lower.includes('success')) return 'done'
  if (lower.includes('waiting') || lower.includes('queued')) return 'waiting'
  if (lower.includes('run') || lower.includes('task') || lower.includes('plan')) return 'focused'
  return 'info'
}

function matchesMemberLog(entry: TeamLogEntry, member: TeamMember): boolean {
  const haystack = `${entry.msg} ${JSON.stringify(entry.data || [])}`.toLowerCase()
  return [
    member.id,
    member.sessionId,
    member.roleId,
    member.role.identifier,
    member.role.name,
  ].some(token => token && haystack.includes(token.toLowerCase()))
}

function computeRisk(
  member: TeamMember,
  queuedTasks: TeamTask[],
  currentTask?: TeamTask,
): Pick<MemberStudioState, 'riskScore' | 'riskLabel'> {
  let riskScore = 8
  const staleMinutes = minutesSince(member.lastActiveAt) ?? 0

  if (member.status === 'failed') riskScore += 65
  if (member.status === 'running' && staleMinutes >= 10) riskScore += 28
  if (member.status === 'running' && !currentTask) riskScore += 12
  if (queuedTasks.length >= 3) riskScore += 18
  if (queuedTasks.length >= 5) riskScore += 10
  if (currentTask) riskScore += 8

  const normalized = Math.min(100, riskScore)
  const riskLabel: MemberStudioState['riskLabel'] =
    normalized >= 70 ? 'high' : normalized >= 40 ? 'watch' : 'stable'

  return { riskScore: normalized, riskLabel }
}

function buildTimeline(
  member: TeamMember,
  tasks: TeamTask[],
  messages: TeamMessage[],
  teamLogs: TeamLogEntry[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: `join-${member.id}`,
      timestamp: member.joinedAt,
      title: '加入团队',
      description: `${member.role.name} 工位已连接`,
      tone: 'info',
    },
  ]

  for (const task of tasks) {
    if (task.claimedBy === member.id && task.claimedAt) {
      items.push({
        id: `claim-${task.id}`,
        timestamp: task.claimedAt,
        title: '开始执行任务',
        description: task.title,
        tone: 'focused',
      })
    }
    if (task.assignedTo === member.id && task.status === 'pending') {
      items.push({
        id: `queue-${task.id}`,
        timestamp: task.createdAt,
        title: '进入待办队列',
        description: task.title,
        tone: 'waiting',
      })
    }
    if (task.claimedBy === member.id && task.status === 'completed' && task.completedAt) {
      items.push({
        id: `complete-${task.id}`,
        timestamp: task.completedAt,
        title: '完成任务',
        description: task.title,
        tone: 'done',
      })
    }
    if (task.claimedBy === member.id && task.status === 'cancelled') {
      items.push({
        id: `cancel-${task.id}`,
        timestamp: task.completedAt || task.claimedAt || task.createdAt,
        title: '任务被取消',
        description: task.title,
        tone: 'error',
      })
    }
  }

  for (const message of messages) {
    if (message.from !== member.id && message.to !== member.id) continue
    items.push({
      id: `msg-${message.id}`,
      timestamp: message.timestamp,
      title: message.from === member.id ? '发出团队消息' : '收到团队消息',
      description: truncate(message.content, 88),
      tone: message.from === member.id ? 'focused' : 'info',
    })
  }

  for (const entry of teamLogs) {
    if (!matchesMemberLog(entry, member)) continue
    items.push({
      id: entry.id,
      timestamp: entry.time,
      title: '团队调试日志',
      description: truncate(entry.msg, 96),
      tone: entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'waiting' : 'info',
    })
  }

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 12)
}

function buildTeamActivityTimeline(
  members: TeamMember[],
  tasks: TeamTask[],
  messages: TeamMessage[],
): TeamActivityItem[] {
  const items: TeamActivityItem[] = []

  for (const task of tasks) {
    if (task.claimedAt && task.claimedBy) {
      const member = members.find(item => item.id === task.claimedBy)
      items.push({
        id: `team-claim-${task.id}`,
        timestamp: task.claimedAt,
        title: '任务启动',
        description: task.title,
        tone: 'focused',
        actor: member?.role.name,
        actorMemberId: member?.id,
      })
    }
    if (task.completedAt && task.status === 'completed') {
      const member = members.find(item => item.id === task.claimedBy || item.id === task.assignedTo)
      items.push({
        id: `team-complete-${task.id}`,
        timestamp: task.completedAt,
        title: '任务完成',
        description: task.title,
        tone: 'done',
        actor: member?.role.name,
        actorMemberId: member?.id,
      })
    }
    if (task.status === 'cancelled') {
      items.push({
        id: `team-cancel-${task.id}`,
        timestamp: task.completedAt || task.claimedAt || task.createdAt,
        title: '任务取消',
        description: task.title,
        tone: 'error',
        actor: undefined,
      })
    }
  }

  for (const message of messages.slice(-16)) {
    const fromMember = members.find(item => item.id === message.from)
    items.push({
      id: `team-message-${message.id}`,
      timestamp: message.timestamp,
      title: message.type === 'broadcast' ? '团队广播' : '协作消息',
      description: truncate(message.content, 48),
      tone: message.type === 'broadcast' ? 'info' : 'waiting',
      actor: fromMember?.role.name,
      actorMemberId: fromMember?.id,
    })
  }

  return items
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-8)
}

function buildCollaborationEdges(
  members: TeamMember[],
  messages: TeamMessage[],
  tasks: TeamTask[],
): CollaborationEdge[] {
  const memberIds = new Set(members.map(member => member.id))
  const edgeMap = new Map<string, CollaborationEdge>()

  const ensureEdge = (fromId: string, toId: string): CollaborationEdge | null => {
    if (fromId === toId || !memberIds.has(fromId) || !memberIds.has(toId)) return null
    const key = `${fromId}->${toId}`
    const existing = edgeMap.get(key)
    if (existing) return existing

    const created: CollaborationEdge = {
      id: key,
      fromId,
      toId,
      messageCount: 0,
      handoffCount: 0,
      intensity: 0,
    }
    edgeMap.set(key, created)
    return created
  }

  for (const message of messages) {
    if (!message.to) continue
    const edge = ensureEdge(message.from, message.to)
    if (!edge) continue
    edge.messageCount += 1
    edge.lastTouchedAt = message.timestamp
  }

  const taskMap = new Map(tasks.map(task => [task.id, task]))
  for (const task of tasks) {
    if (!task.claimedBy || task.dependencies.length === 0) continue
    for (const depId of task.dependencies) {
      const depTask = taskMap.get(depId)
      if (!depTask?.claimedBy || depTask.claimedBy === task.claimedBy) continue
      const edge = ensureEdge(depTask.claimedBy, task.claimedBy)
      if (!edge) continue
      edge.handoffCount += 1
      edge.lastTouchedAt = task.claimedAt || depTask.completedAt || depTask.claimedAt || edge.lastTouchedAt
    }
  }

  return Array.from(edgeMap.values())
    .map(edge => ({
      ...edge,
      intensity: edge.messageCount + edge.handoffCount * 2,
    }))
    .sort((a, b) => {
      const timeDiff = new Date(b.lastTouchedAt || 0).getTime() - new Date(a.lastTouchedAt || 0).getTime()
      if (timeDiff !== 0) return timeDiff
      return b.intensity - a.intensity
    })
}

function buildRecommendations(
  memberStates: MemberStudioState[],
  tasks: TeamTask[],
): StudioRecommendation[] {
  const recommendations: StudioRecommendation[] = []
  const highestRisk = [...memberStates].sort((a, b) => b.riskScore - a.riskScore)[0]
  const blockedTasks = tasks.filter(task => task.status === 'pending' && task.dependencies.length > 0)
  const unassignedTasks = tasks.filter(task => task.status === 'pending' && !task.assignedTo)

  if (highestRisk && highestRisk.riskLabel !== 'stable') {
    recommendations.push({
      id: `risk-${highestRisk.member.id}`,
      memberId: highestRisk.member.id,
      title: `优先关注 ${highestRisk.member.role.name}`,
      detail: highestRisk.currentTask
        ? `当前任务「${truncate(highestRisk.currentTask.title, 26)}」风险较高`
        : `${highestRisk.member.role.name} 当前状态不稳定`,
      actionLabel: '催办汇报',
      tone: highestRisk.riskLabel === 'high' ? 'error' : 'warning',
      mode: 'member',
      prompt: '请立即汇报当前进度、阻塞项、下一步计划，并说明是否需要其他成员支持。',
    })
  }

  if (blockedTasks.length > 0) {
    recommendations.push({
      id: 'blocked-chain',
      title: '优先解锁阻塞链',
      detail: `${blockedTasks.length} 个任务受依赖阻塞，建议先同步前序任务状态`,
      actionLabel: '全员同步',
      tone: 'warning',
      mode: 'broadcast',
      prompt: '请所有成员同步自己负责任务的完成状态，并明确是否阻塞了其他成员的后续工作。',
    })
  }

  if (unassignedTasks.length > 0) {
    recommendations.push({
      id: 'unassigned',
      title: '待认领任务需要处理',
      detail: `${unassignedTasks.length} 个待办尚未明确负责人`,
      actionLabel: '广播认领',
      tone: 'info',
      mode: 'broadcast',
      prompt: '请团队负责人确认未认领任务的负责人，并让相关成员立即认领或说明阻塞原因。',
    })
  }

  return recommendations.slice(0, 3)
}

function buildQuickCommandTemplates(
  selectedState: MemberStudioState | undefined,
  blockedTasks: TeamTask[],
): QuickCommandTemplate[] {
  if (!selectedState) return []

  const templates: QuickCommandTemplate[] = [
    {
      id: 'report',
      label: '进展汇报',
      prompt: '请汇报你当前的进展、阻塞项、下一步计划，以及是否需要其他成员支持。',
      tone: 'default',
      mode: 'member',
    },
  ]

  if (selectedState.currentTask) {
    templates.push({
      id: 'push-current',
      label: '推进当前任务',
      prompt: `请优先推进当前任务「${selectedState.currentTask.title}」，完成后立即同步结果和影响范围。`,
      tone: 'primary',
      mode: 'member',
    })
  }

  if (selectedState.riskLabel !== 'stable') {
    templates.push({
      id: 'risk-check',
      label: '风险盘点',
      prompt: '请立刻说明当前风险、卡点、预计恢复时间，以及你需要谁来协作。',
      tone: 'warning',
      mode: 'member',
    })
  }

  if (selectedState.queuedTasks.length > 0) {
    templates.push({
      id: 'queue-plan',
      label: '队列梳理',
      prompt: `请梳理你待办队列中的 ${selectedState.queuedTasks.length} 个任务，按优先级给出执行顺序和依赖项。`,
      tone: 'default',
      mode: 'member',
    })
  }

  if (blockedTasks.length > 0) {
    templates.push({
      id: 'unlock-chain',
      label: '解锁阻塞',
      prompt: '请优先处理会影响他人的阻塞项，完成后立即回复是否已解除依赖。',
      tone: 'warning',
      mode: 'broadcast',
    })
  }

  templates.push({
    id: 'sync-all',
    label: '全员同步',
    prompt: '请所有成员同步各自进度、阻塞项和预计完成时间。',
    tone: 'primary',
    mode: 'broadcast',
  })

  return templates.slice(0, 5)
}

function MemberRow({
  state,
  active,
  linked,
  spotlight,
  index,
  onSelect,
}: {
  state: MemberStudioState
  active: boolean
  linked: boolean
  spotlight: boolean
  index: number
  onSelect: () => void
}) {
  const { member, currentTask, recentMessage, riskScore, riskLabel, mood } = state
  const staleMinutes = minutesSince(member.lastActiveAt)
  const moodRippleClass =
    mood === 'focused'
      ? 'studio-ripple-focused'
      : mood === 'done'
        ? 'studio-ripple-done'
        : mood === 'error'
          ? 'studio-ripple-error'
          : 'studio-ripple-info'
  const moodBadgeClass =
    mood === 'focused'
      ? 'studio-pulse-badge studio-pulse-focused'
      : mood === 'done'
        ? 'studio-pulse-badge studio-pulse-done'
        : mood === 'error'
          ? 'studio-pulse-badge studio-pulse-error'
          : 'studio-pulse-badge studio-pulse-info'

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-[1.4rem] border p-3 text-left transition-all ${
        active
          ? 'border-accent-blue/35 bg-accent-blue/10 shadow-[0_0_0_1px_rgba(88,166,255,0.15),0_10px_30px_rgba(15,23,42,0.18)]'
          : spotlight
            ? 'border-violet-400/35 bg-violet-500/10 shadow-[0_0_0_1px_rgba(167,139,250,0.12),0_8px_24px_rgba(15,23,42,0.14)]'
            : linked
              ? 'border-amber-400/25 bg-amber-500/8 shadow-[0_0_0_1px_rgba(251,191,36,0.08)]'
          : 'border-white/6 bg-[linear-gradient(180deg,rgba(15,23,42,0.18),rgba(15,23,42,0.08))] hover:border-white/12 hover:bg-bg-hover'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/8 bg-bg-secondary px-1 text-[10px] text-text-muted">
              {index + 1}
            </span>
            <span className="text-base">{member.role.icon || '👤'}</span>
            <div className="truncate text-sm font-medium text-text-primary">{member.role.name}</div>
          </div>
          <div className="mt-1 text-[11px] text-text-muted">
            {getStatusLabel(member, currentTask)}
            {staleMinutes !== null && staleMinutes > 0 && ` · ${staleMinutes} 分钟未活跃`}
          </div>
        </div>
        <div className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${getRiskTone(riskLabel)}`}>
          风险 {riskScore}
        </div>
      </div>

      <div className="relative mb-3 overflow-hidden rounded-[1.2rem] border border-white/6 bg-[linear-gradient(180deg,rgba(15,23,42,0.16),rgba(15,23,42,0.04))] px-3 py-3">
        <div className={`studio-desk-ripple ${moodRippleClass}`} />
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-bg-secondary/85 text-xl shadow-inner">
              <div className={`studio-desk-ripple ${moodRippleClass}`} />
              <span className="relative z-10">{member.role.icon || '👤'}</span>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">当前工位</div>
              <div className="mt-1 truncate text-sm text-text-primary">
                {currentTask ? truncate(currentTask.title, 28) : '等待新任务'}
              </div>
            </div>
          </div>
          <div className={moodBadgeClass}>
            {mood === 'focused' ? '忙碌' : mood === 'done' ? '完成' : mood === 'error' ? '异常' : mood === 'waiting' ? '等待' : '空闲'}
          </div>
        </div>
      </div>

      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className={`h-full rounded-full ${
            riskLabel === 'high'
              ? 'bg-rose-400'
              : riskLabel === 'watch'
                ? 'bg-amber-400'
                : 'bg-emerald-400'
          }`}
          style={{ width: `${riskScore}%` }}
        />
      </div>

      <div className="text-xs text-text-primary">
        {currentTask ? truncate(currentTask.title, 34) : '当前没有活跃任务'}
      </div>
      <div className="mt-1 text-[11px] text-text-muted">
        {recentMessage ? truncate(recentMessage.content, 44) : '暂无最新消息'}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${getStatusTone(mood)}`}>
          {getActivityIcon(mood)}
          <span>{member.providerId}</span>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-bg-secondary px-2 py-0.5 text-[10px] text-text-muted">
          队列 {state.queuedTasks.length}
        </div>
      </div>
    </button>
  )
}

export default function TeamStudioView({
  team,
  tasks,
  messages,
  teamLogs,
  selectedMemberId,
  onSelectMember,
}: TeamStudioViewProps) {
  const [activeTab, setActiveTab] = useState<StudioTab>('timeline')
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('all')
  const [memberSearch, setMemberSearch] = useState('')
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null)
  const [sessionLogLines, setSessionLogLines] = useState<string[]>([])
  const [streamingLogLines, setStreamingLogLines] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [logsRefreshKey, setLogsRefreshKey] = useState(0)
  const [monitorRefreshKey, setMonitorRefreshKey] = useState(0)
  const [monitorLogLines, setMonitorLogLines] = useState<Record<string, string[]>>({})
  const [monitorLoading, setMonitorLoading] = useState<Record<string, boolean>>({})
  const [monitorErrors, setMonitorErrors] = useState<Record<string, string | undefined>>({})
  const [followLogs, setFollowLogs] = useState(true)
  const [commandText, setCommandText] = useState('')
  const [commandMode, setCommandMode] = useState<'member' | 'broadcast'>('member')
  const [sendingCommand, setSendingCommand] = useState(false)
  const [autoFocusRisk, setAutoFocusRisk] = useState(!selectedMemberId)
  const [immersiveMode, setImmersiveMode] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<StudioActionFeedback | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const logScrollRef = useRef<HTMLDivElement | null>(null)
  const { sendMessage, broadcastMessage } = useTeamStore()

  const memberStates = useMemo<MemberStudioState[]>(() => {
    return (team.members || [])
      .map(member => {
        const currentTask =
          tasks.find(task => task.id === member.currentTaskId && task.status === 'in_progress') ||
          tasks.find(task => task.claimedBy === member.id && task.status === 'in_progress')
        const queuedTasks = tasks.filter(task =>
          task.status === 'pending' && (task.assignedTo === member.id || task.claimedBy === member.id),
        )
        const recentMessage = [...messages]
          .reverse()
          .find(message => message.from === member.id || message.to === member.id)

        return {
          member,
          currentTask,
          queuedTasks,
          recentMessage,
          energy: getMemberEnergy(member, currentTask),
          mood: getMemberMood(member),
          ...computeRisk(member, queuedTasks, currentTask),
        }
      })
      .sort((a, b) => b.riskScore - a.riskScore)
  }, [messages, tasks, team.members])

  const selectedState = memberStates.find(state => state.member.id === selectedMemberId) || memberStates[0]
  const recommendations = useMemo(() => buildRecommendations(memberStates, tasks), [memberStates, tasks])
  const blockedTasks = useMemo(
    () => tasks.filter(task => task.status === 'pending' && task.dependencies.length > 0).slice(0, 6),
    [tasks],
  )
  const collaborationEdges = useMemo(
    () => buildCollaborationEdges(team.members || [], messages, tasks),
    [messages, tasks, team.members],
  )
  const relatedEdges = useMemo(() => {
    if (!selectedState) return []
    return collaborationEdges.filter(edge =>
      edge.fromId === selectedState.member.id || edge.toId === selectedState.member.id,
    )
  }, [collaborationEdges, selectedState])
  const activeEdge = relatedEdges.find(edge => edge.id === activeEdgeId) || null
  const linkedMemberIds = useMemo(() => {
    const ids = new Set<string>()
    if (activeEdge) {
      ids.add(activeEdge.fromId)
      ids.add(activeEdge.toId)
    }
    return ids
  }, [activeEdge])
  const timelineItems = useMemo(
    () => (selectedState ? buildTimeline(selectedState.member, tasks, messages, teamLogs) : []),
    [messages, selectedState, tasks, teamLogs],
  )
  const collaborationMessages = useMemo(() => {
    if (!activeEdge) return []
    return messages.filter(message =>
      (message.from === activeEdge.fromId && message.to === activeEdge.toId) ||
      (message.from === activeEdge.toId && message.to === activeEdge.fromId),
    ).slice(-8)
  }, [activeEdge, messages])
  const teamActivityTimeline = useMemo(
    () => buildTeamActivityTimeline(team.members || [], tasks, messages),
    [messages, tasks, team.members],
  )
  const filteredMemberStates = useMemo(() => {
    const query = memberSearch.trim().toLowerCase()
    return memberStates.filter(state => {
      const matchesFilter =
        memberFilter === 'all' ? true :
        memberFilter === 'focused' ? state.member.status === 'running' :
        memberFilter === 'watch' ? state.riskLabel === 'watch' || state.riskLabel === 'high' :
        memberFilter === 'error' ? state.member.status === 'failed' || state.riskLabel === 'high' :
        state.member.status === 'completed'

      const haystack = [
        state.member.role.name,
        state.member.role.identifier,
        state.currentTask?.title,
        state.recentMessage?.content,
      ].filter(Boolean).join(' ').toLowerCase()

      const matchesQuery = query.length === 0 || haystack.includes(query)
      return matchesFilter && matchesQuery
    })
  }, [memberFilter, memberSearch, memberStates])
  const visibleLogLines = useMemo(
    () => (streamingLogLines.length > 0 ? streamingLogLines : sessionLogLines).slice(-28),
    [sessionLogLines, streamingLogLines],
  )
  const primaryRecommendation = recommendations[0] || null
  const quickCommandTemplates = useMemo(
    () => buildQuickCommandTemplates(selectedState, blockedTasks),
    [blockedTasks, selectedState],
  )
  const collaborationPartner =
    activeEdge && selectedState
      ? team.members.find(member =>
          member.id === (activeEdge.fromId === selectedState.member.id ? activeEdge.toId : activeEdge.fromId),
        ) || null
      : null
  const monitorStates = useMemo(() => {
    const picked: MemberStudioState[] = []
    const seen = new Set<string>()
    const append = (candidate?: MemberStudioState | null) => {
      if (!candidate || seen.has(candidate.member.id) || !candidate.member.sessionId) return
      seen.add(candidate.member.id)
      picked.push(candidate)
    }

    append(selectedState)
    if (collaborationPartner) {
      append(memberStates.find(item => item.member.id === collaborationPartner.id))
    }
    memberStates
      .filter(item => item.member.status === 'running' || item.riskLabel !== 'stable')
      .forEach(append)
    memberStates.forEach(append)

    return picked.slice(0, 4)
  }, [collaborationPartner, memberStates, selectedState])
  const monitorDesks = useMemo<MonitorDeskState[]>(() => {
    return monitorStates.map(state => ({
      state,
      lines: monitorLogLines[state.member.id] || [],
      loading: !!monitorLoading[state.member.id],
      error: monitorErrors[state.member.id],
    }))
  }, [monitorErrors, monitorLoading, monitorLogLines, monitorStates])
  const studioTabs: Array<{
    key: StudioTab
    label: string
    description: string
    accentClass: string
    panelClass: string
    icon: ReactNode
    stat: string
  }> = [
    {
      key: 'timeline',
      label: '执行轨迹',
      description: '按时间回放该成员的任务推进、等待和完成节点。',
      accentClass: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
      panelClass: 'border-emerald-500/10 bg-[linear-gradient(180deg,rgba(16,185,129,0.06),rgba(2,6,23,0.04))]',
      icon: <Activity size={13} />,
      stat: `${timelineItems.length} 条轨迹`,
    },
    {
      key: 'logs',
      label: '实时输出',
      description: '像盯终端一样看当前会话输出，适合判断是否卡住。',
      accentClass: 'border-sky-500/25 bg-sky-500/10 text-sky-300',
      panelClass: 'border-sky-500/10 bg-[linear-gradient(180deg,rgba(14,165,233,0.07),rgba(2,6,23,0.04))]',
      icon: <TerminalSquare size={13} />,
      stat: `${visibleLogLines.length} 行可见`,
    },
    {
      key: 'collaboration',
      label: '协作关系',
      description: '查看上下游交接和成员之间的消息往来。',
      accentClass: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
      panelClass: 'border-violet-500/10 bg-[linear-gradient(180deg,rgba(139,92,246,0.06),rgba(2,6,23,0.04))]',
      icon: <ArrowRightLeft size={13} />,
      stat: `${relatedEdges.length} 条协作边`,
    },
  ]
  const activeStudioTab = studioTabs.find(tab => tab.key === activeTab) || studioTabs[0]
  const overviewNodes = useMemo<StudioOverviewNode[]>(() => {
    if (memberStates.length === 0) return []

    const hubState =
      memberStates.find(state => state.member.role.isLeader) ||
      memberStates.find(state => state.member.role.identifier === 'leader') ||
      memberStates[0]
    const orbitStates = memberStates.filter(state => state.member.id !== hubState.member.id)

    return [
      { state: hubState, x: 110, y: 78, isHub: true },
      ...orbitStates.map((state, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(orbitStates.length, 1)
        return {
          state,
          x: 110 + Math.cos(angle) * 72,
          y: 78 + Math.sin(angle) * 48,
          isHub: false,
        }
      }),
    ]
  }, [memberStates])
  const overviewEdges = useMemo(() => {
    const nodeMap = new Map(overviewNodes.map(node => [node.state.member.id, node]))
    return collaborationEdges
      .map(edge => {
        const from = nodeMap.get(edge.fromId)
        const to = nodeMap.get(edge.toId)
        if (!from || !to) return null
        return { edge, from, to }
      })
      .filter(Boolean)
      .slice(0, 12) as Array<{
      edge: CollaborationEdge
      from: StudioOverviewNode
      to: StudioOverviewNode
    }>
  }, [collaborationEdges, overviewNodes])

  useEffect(() => {
    setActiveEdgeId(null)
  }, [selectedState?.member.id])

  useEffect(() => {
    if (!selectedState) {
      setCommandMode('broadcast')
      return
    }
    setCommandMode('member')
  }, [selectedState?.member.id])

  useEffect(() => {
    const container = timelineScrollRef.current
    if (!container || teamActivityTimeline.length === 0) return
    container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' })
  }, [teamActivityTimeline])

  useEffect(() => {
    if (!followLogs || activeTab !== 'logs') return
    const container = logScrollRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [activeTab, followLogs, visibleLogLines])

  useEffect(() => {
    if (!actionFeedback) return
    const timeout = window.setTimeout(() => setActionFeedback(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [actionFeedback])

  useEffect(() => {
    if (!autoFocusRisk) return
    const topRisk = memberStates[0]
    if (topRisk && topRisk.member.id !== selectedMemberId) {
      onSelectMember(topRisk.member)
    }
  }, [autoFocusRisk, memberStates, onSelectMember, selectedMemberId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      if (target?.isContentEditable || tagName === 'textarea' || tagName === 'input') return
      if (memberStates.length === 0) return

      const currentIndex = Math.max(0, memberStates.findIndex(state => state.member.id === selectedState?.member.id))
      if (event.key === 'ArrowDown' || event.key.toLowerCase() === 'j') {
        event.preventDefault()
        const next = memberStates[Math.min(memberStates.length - 1, currentIndex + 1)]
        if (next) {
          setAutoFocusRisk(false)
          onSelectMember(next.member)
        }
      }
      if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const prev = memberStates[Math.max(0, currentIndex - 1)]
        if (prev) {
          setAutoFocusRisk(false)
          onSelectMember(prev.member)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [memberStates, onSelectMember, selectedState?.member.id])

  useEffect(() => {
    if (!selectedState?.member.sessionId) {
      setSessionLogLines([])
      setStreamingLogLines([])
      return
    }

    let cancelled = false
    setStreamingLogLines([])
    setLogsError(null)

    const refreshLogs = async () => {
      setLogsLoading(true)
      try {
        const result = await (window as any).spectrAI.session.getLogs(selectedState.member.sessionId)
        if (!cancelled) {
          setSessionLogLines(extractLogLines(Array.isArray(result) ? result : [], 18))
          setLogsError(null)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[TeamStudio] Failed to get session logs:', err)
          setSessionLogLines([])
          setLogsError(err instanceof Error ? err.message : '拉取日志失败')
        }
      } finally {
        if (!cancelled) setLogsLoading(false)
      }
    }

    refreshLogs()
    const interval = window.setInterval(refreshLogs, 4000)
    const unsubscribeOutput = (window as any).spectrAI.session.onOutput((sessionId: string, data: string) => {
      if (cancelled || sessionId !== selectedState.member.sessionId || !data) return
      setStreamingLogLines(prev => extractLogLinesFromText([...prev, data].join('\n'), 28))
    })

    return () => {
      cancelled = true
      window.clearInterval(interval)
      if (typeof unsubscribeOutput === 'function') unsubscribeOutput()
    }
  }, [logsRefreshKey, selectedState?.member.lastActiveAt, selectedState?.member.sessionId])

  useEffect(() => {
    if (activeTab !== 'logs') return

    const targets = monitorStates.filter(item => item.member.sessionId)
    const targetIds = new Set(targets.map(item => item.member.id))
    if (targets.length === 0) {
      setMonitorLogLines({})
      setMonitorLoading({})
      setMonitorErrors({})
      return
    }

    let cancelled = false
    setMonitorLogLines(prev =>
      Object.fromEntries(Object.entries(prev).filter(([memberId]) => targetIds.has(memberId))),
    )
    setMonitorLoading(prev =>
      Object.fromEntries(Object.entries(prev).filter(([memberId]) => targetIds.has(memberId))),
    )
    setMonitorErrors(prev =>
      Object.fromEntries(Object.entries(prev).filter(([memberId]) => targetIds.has(memberId))),
    )

    const refreshTarget = async (target: MemberStudioState) => {
      setMonitorLoading(prev => ({ ...prev, [target.member.id]: true }))
      try {
        const result = await (window as any).spectrAI.session.getLogs(target.member.sessionId)
        if (cancelled) return
        setMonitorLogLines(prev => ({
          ...prev,
          [target.member.id]: extractLogLines(Array.isArray(result) ? result : [], 10),
        }))
        setMonitorErrors(prev => ({ ...prev, [target.member.id]: undefined }))
      } catch (err) {
        if (cancelled) return
        setMonitorLogLines(prev => ({ ...prev, [target.member.id]: [] }))
        setMonitorErrors(prev => ({
          ...prev,
          [target.member.id]: err instanceof Error ? err.message : '拉取失败',
        }))
      } finally {
        if (!cancelled) {
          setMonitorLoading(prev => ({ ...prev, [target.member.id]: false }))
        }
      }
    }

    const refreshAll = () => Promise.all(targets.map(refreshTarget))

    refreshAll()
    const interval = window.setInterval(refreshAll, 5000)
    const unsubscribeOutput = (window as any).spectrAI.session.onOutput((sessionId: string, data: string) => {
      if (cancelled || !data) return
      const target = targets.find(item => item.member.sessionId === sessionId)
      if (!target) return
      setMonitorLogLines(prev => ({
        ...prev,
        [target.member.id]: extractLogLinesFromText([...(prev[target.member.id] || []), data].join('\n'), 10),
      }))
      setMonitorErrors(prev => ({ ...prev, [target.member.id]: undefined }))
    })

    return () => {
      cancelled = true
      window.clearInterval(interval)
      if (typeof unsubscribeOutput === 'function') unsubscribeOutput()
    }
  }, [activeTab, monitorRefreshKey, monitorStates])

  const handleQuickMessage = async (content: string, mode: 'member' | 'broadcast', targetMemberId?: string) => {
    if (!team.id || sendingCommand) return
    setSendingCommand(true)
    try {
      if (mode === 'member') {
        const memberId = targetMemberId || selectedState?.member.id
        const targetMember = team.members.find(member => member.id === memberId)
        if (!memberId || !targetMember) {
          setActionFeedback({
            tone: 'error',
            title: '没有可发送的目标成员',
            detail: '先在左侧选中一个成员，或者切换到团队广播。',
            createdAt: Date.now(),
          })
          return
        }
        const message = await sendMessage(team.id, memberId, content)
        if (!message) throw new Error('消息未成功写入团队通道')
        setActionFeedback({
          tone: 'success',
          title: `已发送给 ${targetMember.role.name}`,
          detail: truncate(content, 72),
          createdAt: Date.now(),
        })
      } else {
        const message = await broadcastMessage(team.id, content)
        if (!message) throw new Error('广播未成功写入团队通道')
        setActionFeedback({
          tone: 'success',
          title: '已广播给整个团队',
          detail: truncate(content, 72),
          createdAt: Date.now(),
        })
      }
      setCommandText('')
    } catch (err) {
      setActionFeedback({
        tone: 'error',
        title: '指令发送失败',
        detail: err instanceof Error ? err.message : '团队通道暂时不可用',
        createdAt: Date.now(),
      })
    } finally {
      setSendingCommand(false)
    }
  }

  const handleSendCommand = async () => {
    const text = commandText.trim()
    if (!text) return
    await handleQuickMessage(text, commandMode, commandMode === 'member' ? selectedState?.member.id : undefined)
  }

  const handleRecommendation = async (recommendation: StudioRecommendation) => {
    if (recommendation.memberId) {
      const member = team.members.find(item => item.id === recommendation.memberId)
      if (member) {
        setAutoFocusRisk(false)
        onSelectMember(member)
      }
    }
    await handleQuickMessage(recommendation.prompt, recommendation.mode, recommendation.memberId)
  }

  const handleSelectMember = (member: TeamMember, keepAutoFocus: boolean = false) => {
    setAutoFocusRisk(keepAutoFocus)
    onSelectMember(member)
  }

  const handleStepMember = (direction: -1 | 1) => {
    if (!memberStates.length || !selectedState) return
    const currentIndex = Math.max(0, memberStates.findIndex(state => state.member.id === selectedState.member.id))
    const nextIndex = Math.min(memberStates.length - 1, Math.max(0, currentIndex + direction))
    const target = memberStates[nextIndex]
    if (target) {
      setAutoFocusRisk(false)
      onSelectMember(target.member)
    }
  }

  const handleActivityFocus = (item: TeamActivityItem) => {
    if (!item.actorMemberId) return
    const member = team.members.find(entry => entry.id === item.actorMemberId)
    if (!member) return
    setAutoFocusRisk(false)
    setActiveEdgeId(null)
    setActiveTab(item.tone === 'focused' || item.tone === 'done' ? 'timeline' : 'logs')
    onSelectMember(member)
    setActionFeedback({
      tone: 'info',
      title: `已聚焦 ${member.role.name}`,
      detail: `${item.title} · ${truncate(item.description, 56)}`,
      createdAt: Date.now(),
    })
  }

  const handleOverviewEdgeFocus = (edge: CollaborationEdge) => {
    const member =
      team.members.find(entry => entry.id === edge.toId) ||
      team.members.find(entry => entry.id === edge.fromId)
    if (member) {
      setAutoFocusRisk(false)
      onSelectMember(member)
    }
    setActiveTab('collaboration')
    setActiveEdgeId(edge.id)
    setActionFeedback({
      tone: 'info',
      title: '已切到协作关系视角',
      detail: `${edge.messageCount} 条消息 · ${edge.handoffCount} 次交接`,
      createdAt: Date.now(),
    })
  }

  const applyQuickTemplate = async (template: QuickCommandTemplate) => {
    setCommandMode(template.mode)
    await handleQuickMessage(
      template.prompt,
      template.mode,
      template.mode === 'member' ? selectedState?.member.id : undefined,
    )
  }

  const handleDeskFocus = (member: TeamMember) => {
    setAutoFocusRisk(false)
    setActiveTab('logs')
    onSelectMember(member)
    setActionFeedback({
      tone: 'info',
      title: `已切换到 ${member.role.name} 的终端`,
      detail: '右侧主窗格会继续显示该成员的完整会话输出。',
      createdAt: Date.now(),
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col gap-4 p-4">
      <div className="shrink-0 rounded-3xl border border-border bg-[linear-gradient(135deg,rgba(88,166,255,0.08),rgba(63,185,80,0.05))] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">团队工作室</h3>
            <p className="mt-1 text-xs text-text-muted">
              一眼看全员风险，聚焦一个成员，立即下达指令。
            </p>
          </div>
          <button
            onClick={() => handleQuickMessage('请所有成员立即同步当前进展、阻塞项和预计完成时间，Leader 请汇总后更新整体状态。', 'broadcast')}
            disabled={sendingCommand}
            className="inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1.5 text-[11px] text-violet-300 hover:bg-violet-500/15 disabled:opacity-50"
          >
            <Radio size={12} />
            召回全员汇报
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
          <button
            onClick={() => setAutoFocusRisk(value => !value)}
            className={`rounded-full border px-3 py-1 ${
              autoFocusRisk
                ? 'border-accent-blue/30 bg-accent-blue/12 text-accent-blue'
                : 'border-border bg-bg-secondary text-text-secondary'
            }`}
          >
            {autoFocusRisk ? '自动关注最高风险中' : '开启自动关注最高风险'}
          </button>
          <button
            onClick={() => setImmersiveMode(value => !value)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${
              immersiveMode
                ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                : 'border-border bg-bg-secondary text-text-secondary'
            }`}
          >
            <Focus size={12} />
            {immersiveMode ? '退出沉浸模式' : '进入沉浸模式'}
          </button>
          <span>`↑/↓` 或 `J/K` 可切换成员</span>
        </div>
        {actionFeedback && (
          <div className={`mt-3 rounded-2xl border px-3 py-2 ${getFeedbackTone(actionFeedback.tone)}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium">{actionFeedback.title}</div>
                <div className="mt-1 text-[11px] opacity-90">{actionFeedback.detail}</div>
              </div>
              <div className="shrink-0 text-[10px] opacity-70">{formatRelativeTime(new Date(actionFeedback.createdAt).toISOString())}</div>
            </div>
          </div>
        )}
        {selectedState && (
          <div className="mt-4 rounded-[1.8rem] border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.12),rgba(15,23,42,0.04))] p-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)_minmax(320px,0.82fr)]">
            <div className="rounded-2xl border border-white/8 bg-bg-secondary/75 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">当前焦点</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-primary">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2.5 py-1 text-[11px] text-accent-blue">
                  <span>{selectedState.member.role.icon}</span>
                  <span>{selectedState.member.role.name}</span>
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${getStatusTone(selectedState.mood)}`}>
                  {getActivityIcon(selectedState.mood)}
                  <span>{getStatusLabel(selectedState.member, selectedState.currentTask)}</span>
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${getRiskTone(selectedState.riskLabel)}`}>
                  风险 {selectedState.riskScore}
                </span>
              </div>
              <div className="mt-2 text-sm text-text-primary">
                {selectedState.currentTask ? selectedState.currentTask.title : '当前没有认领中的任务'}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">
                {selectedState.recentMessage
                  ? `最近动态：${truncate(selectedState.recentMessage.content, 92)}`
                  : '最近动态：暂无团队消息'}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-bg-secondary/75 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">团队流动图</div>
                <div className="text-[10px] text-text-muted">点击节点切换焦点</div>
              </div>
              <div className="mt-3 rounded-[1.4rem] border border-white/6 bg-[linear-gradient(180deg,rgba(15,23,42,0.18),rgba(15,23,42,0.06))] p-2">
                <svg viewBox="0 0 220 156" className="h-[156px] w-full">
                  {overviewEdges.map(({ edge, from, to }) => {
                    const highlighted =
                      edge.id === activeEdgeId ||
                      selectedState.member.id === edge.fromId ||
                      selectedState.member.id === edge.toId
                    return (
                      <line
                        key={edge.id}
                        onClick={() => handleOverviewEdgeFocus(edge)}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={highlighted ? 'rgba(88,166,255,0.52)' : 'rgba(148,163,184,0.24)'}
                        strokeWidth={highlighted ? 2.2 : 1.3}
                        strokeDasharray={edge.handoffCount > 0 ? '0' : '4 4'}
                        className={highlighted ? 'studio-edge-flow' : ''}
                        style={{ cursor: 'pointer' }}
                      />
                    )
                  })}
                  {overviewNodes.map(node => {
                    const isSelected = node.state.member.id === selectedState.member.id
                    const strokeColor =
                      node.state.riskLabel === 'high'
                        ? '#fb7185'
                        : node.state.riskLabel === 'watch'
                          ? '#fbbf24'
                          : '#34d399'
                    return (
                      <g
                        key={node.state.member.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onClick={() => handleSelectMember(node.state.member)}
                        className="cursor-pointer"
                      >
                        <circle
                          r={node.isHub ? 22 : 17}
                          fill="rgba(15,23,42,0.88)"
                          stroke={isSelected ? 'rgba(88,166,255,0.95)' : 'rgba(255,255,255,0.14)'}
                          strokeWidth={isSelected ? 2.6 : 1.4}
                        />
                        <circle
                          r={node.isHub ? 28 : 22}
                          fill="none"
                          stroke={strokeColor}
                          strokeOpacity={isSelected ? 0.62 : 0.28}
                          strokeWidth="1.5"
                          className={node.state.member.status === 'running' ? 'studio-node-ripple' : ''}
                        />
                        <text textAnchor="middle" dominantBaseline="central" fontSize={node.isHub ? 18 : 15}>
                          {node.state.member.role.icon || '👤'}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-text-muted">
                <div className="rounded-xl border border-white/6 bg-bg-primary/45 px-2 py-1.5">
                  <div className="text-text-primary">{collaborationEdges.length}</div>
                  <div>协作链路</div>
                </div>
                <div className="rounded-xl border border-white/6 bg-bg-primary/45 px-2 py-1.5">
                  <div className="text-text-primary">{memberStates.filter(state => state.member.status === 'running').length}</div>
                  <div>进行中</div>
                </div>
                <div className="rounded-xl border border-white/6 bg-bg-primary/45 px-2 py-1.5">
                  <div className="text-text-primary">{memberStates.filter(state => state.riskLabel === 'high').length}</div>
                  <div>高风险</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-bg-secondary/75 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">下一步建议</div>
                <div className="text-[10px] text-text-muted">系统按风险自动整理</div>
              </div>
              {primaryRecommendation ? (
                <>
                  <div className="mt-2 text-sm text-text-primary">{primaryRecommendation.title}</div>
                  <div className="mt-1 text-[11px] text-text-muted">{primaryRecommendation.detail}</div>
                  <button
                    onClick={() => handleRecommendation(primaryRecommendation)}
                    disabled={sendingCommand}
                    className="mt-3 inline-flex items-center rounded-full border border-white/10 bg-bg-primary/60 px-3 py-1 text-[11px] text-text-primary hover:bg-bg-hover disabled:opacity-50"
                  >
                    {primaryRecommendation.actionLabel}
                  </button>
                </>
              ) : (
                <div className="mt-2 text-[11px] text-text-muted">当前没有需要立刻执行的调度建议。</div>
              )}
            </div>
            </div>

            <div className="mt-3 rounded-2xl border border-white/8 bg-bg-secondary/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">团队活动时间轴</div>
                  <div className="mt-1 text-[11px] text-text-muted">点击任一事件可直接切换到对应成员焦点，时间轴会自动滚到最新。</div>
                </div>
                <div className="rounded-full border border-white/8 bg-bg-primary/50 px-2.5 py-1 text-[10px] text-text-muted">
                  最近 {teamActivityTimeline.length} 条
                </div>
              </div>
              <div ref={timelineScrollRef} className="mt-3 overflow-x-auto pb-1">
                <div className="flex min-w-max items-start gap-3 pr-2">
                  {teamActivityTimeline.length > 0 ? teamActivityTimeline.map((item, index) => (
                    <div key={item.id} className="flex items-start gap-3">
                      <button
                        onClick={() => handleActivityFocus(item)}
                        className={`w-[176px] rounded-[1.2rem] border p-3 text-left transition-colors ${
                          item.actorMemberId && item.actorMemberId === selectedState.member.id
                            ? 'border-accent-blue/30 bg-accent-blue/10'
                            : 'border-white/8 bg-bg-primary/45 hover:bg-bg-hover'
                        }`}
                      >
                        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${getStatusTone(item.tone)}`}>
                          {getActivityIcon(item.tone)}
                          <span>{item.title}</span>
                        </div>
                        <div className="mt-2 text-sm text-text-primary">{item.description}</div>
                        <div className="mt-2 text-[11px] text-text-muted">
                          {item.actor ? `${item.actor} · ` : ''}{formatRelativeTime(item.timestamp)}
                        </div>
                      </button>
                      {index < teamActivityTimeline.length - 1 && (
                        <div className="mt-8 h-px w-6 shrink-0 bg-border" />
                      )}
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-border bg-bg-primary/35 px-4 py-5 text-xs text-text-muted">
                      暂时还没有足够的团队活动数据。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {!immersiveMode && (
          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-3">
            <div className="rounded-2xl border border-white/6 bg-bg-secondary/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">活跃成员</div>
              <div className="mt-2 text-lg font-semibold text-text-primary">
                {memberStates.filter(state => state.member.status === 'running').length}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">当前正在执行任务的成员</div>
            </div>
            <div className="rounded-2xl border border-white/6 bg-bg-secondary/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">阻塞任务</div>
              <div className="mt-2 text-lg font-semibold text-text-primary">{blockedTasks.length}</div>
              <div className="mt-1 text-[11px] text-text-muted">等待依赖完成后继续</div>
            </div>
            <div className="rounded-2xl border border-white/6 bg-bg-secondary/80 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">高风险成员</div>
              <div className="mt-2 text-lg font-semibold text-text-primary">
                {memberStates.filter(state => state.riskLabel === 'high').length}
              </div>
              <div className="mt-1 text-[11px] text-text-muted">建议优先逐一催办</div>
            </div>
          </div>
        )}
      </div>

      <div className={`grid min-h-[680px] flex-1 grid-cols-1 gap-4 ${
        immersiveMode ? 'xl:grid-cols-[240px_minmax(0,1fr)]' : 'xl:grid-cols-[280px_minmax(0,1fr)_340px]'
      }`}>
        <section className="flex min-h-0 flex-col rounded-3xl border border-border bg-bg-secondary/80 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-text-primary">成员态势</div>
              <div className="text-[11px] text-text-muted">按风险排序</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleStepMember(-1)}
                className="rounded-full border border-white/10 bg-bg-primary/60 p-1 text-text-secondary hover:text-text-primary"
                title="上一位"
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() => handleStepMember(1)}
                className="rounded-full border border-white/10 bg-bg-primary/60 p-1 text-text-secondary hover:text-text-primary"
                title="下一位"
              >
                <ChevronDown size={12} />
              </button>
            </div>
          </div>
          <div className="mb-3 space-y-2">
            <input
              value={memberSearch}
              onChange={event => setMemberSearch(event.target.value)}
              placeholder="搜索成员 / 任务 / 动态"
              className="w-full rounded-2xl border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all', label: '全部' },
                { key: 'focused', label: '执行中' },
                { key: 'watch', label: '需关注' },
                { key: 'error', label: '异常' },
                { key: 'done', label: '已完成' },
              ].map(filter => (
                <button
                  key={filter.key}
                  onClick={() => setMemberFilter(filter.key as MemberFilter)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] ${
                    memberFilter === filter.key
                      ? 'border-accent-blue/30 bg-accent-blue/12 text-accent-blue'
                      : 'border-white/8 bg-bg-primary/50 text-text-muted'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {filteredMemberStates.map((state, index) => (
                  <MemberRow
                    key={state.member.id}
                    index={index}
                    state={state}
                    active={selectedState?.member.id === state.member.id}
                    linked={linkedMemberIds.has(state.member.id)}
                    spotlight={Boolean(activeEdge && state.member.id !== selectedState?.member.id && linkedMemberIds.has(state.member.id))}
                    onSelect={() => handleSelectMember(state.member)}
                  />
                ))}
                {filteredMemberStates.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border bg-bg-primary/35 p-4 text-xs text-text-muted">
                <div>当前筛选条件下没有成员。</div>
                <button
                  onClick={() => {
                    setMemberFilter('all')
                    setMemberSearch('')
                  }}
                  className="mt-3 rounded-full border border-white/10 bg-bg-secondary px-3 py-1 text-[11px] text-text-primary hover:bg-bg-hover"
                >
                  清空筛选
                </button>
              </div>
                )}
              </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-3xl border border-border bg-bg-secondary/80 p-4">
          {selectedState ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 rounded-3xl border border-white/6 bg-bg-primary/55 p-4">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{selectedState.member.role.icon}</span>
                      <div>
                        <div className="text-lg font-semibold text-text-primary">{selectedState.member.role.name}</div>
                        <div className="text-xs text-text-muted">
                          {selectedState.member.role.identifier} · {selectedState.member.providerId}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${getStatusTone(selectedState.mood)}`}>
                      {getActivityIcon(selectedState.mood)}
                      <span>{getStatusLabel(selectedState.member, selectedState.currentTask)}</span>
                    </div>
                    <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${getRiskTone(selectedState.riskLabel)}`}>
                      风险 {selectedState.riskScore}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div className="rounded-2xl border border-white/6 bg-bg-secondary/70 p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">当前任务</div>
                    <div className="mt-2 text-sm text-text-primary">
                      {selectedState.currentTask ? selectedState.currentTask.title : '当前没有认领中的任务'}
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      {selectedState.currentTask?.description
                        ? truncate(selectedState.currentTask.description, 96)
                        : '等待新的任务或协作指令'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-bg-secondary/70 p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">最近动态</div>
                    <div className="mt-2 text-sm text-text-primary">
                      {truncate(selectedState.recentMessage?.content, 90)}
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      {selectedState.recentMessage ? formatRelativeTime(selectedState.recentMessage.timestamp) : '暂无团队消息'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-bg-secondary/70 p-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">监控摘要</div>
                    <div className="mt-2 space-y-1 text-[11px] text-text-secondary">
                      <div>工作强度: <span className="text-text-primary">{selectedState.energy}%</span></div>
                      <div>待办队列: <span className="text-text-primary">{selectedState.queuedTasks.length} 项</span></div>
                      <div>最后活跃: <span className="text-text-primary">{formatRelativeTime(selectedState.member.lastActiveAt)}</span></div>
                      <div>工作目录: <span className="text-text-primary">{truncate(selectedState.member.worktreePath || selectedState.member.workDir, 30)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/6 bg-bg-secondary/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">快速指挥</div>
                    <div className="text-[11px] text-text-muted">指令会直接注入该成员会话</div>
                  </div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setCommandMode('member')}
                      disabled={!selectedState}
                      className={`rounded-full border px-3 py-1 text-[11px] ${
                        commandMode === 'member'
                          ? 'border-accent-blue/25 bg-accent-blue/10 text-accent-blue'
                          : 'border-white/10 bg-bg-primary/60 text-text-muted'
                      } disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      发给当前成员
                    </button>
                    <button
                      onClick={() => setCommandMode('broadcast')}
                      className={`rounded-full border px-3 py-1 text-[11px] ${
                        commandMode === 'broadcast'
                          ? 'border-violet-500/25 bg-violet-500/10 text-violet-300'
                          : 'border-white/10 bg-bg-primary/60 text-text-muted'
                      }`}
                    >
                      广播全队
                    </button>
                    <span className="text-[11px] text-text-muted">
                      {commandMode === 'member'
                        ? `目标：${selectedState.member.role.name}`
                        : `目标：${team.members.length} 位成员`}
                    </span>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {quickCommandTemplates.map(template => (
                      <button
                        key={template.id}
                        onClick={() => applyQuickTemplate(template)}
                        disabled={sendingCommand}
                        className={`rounded-full border px-3 py-1 text-[11px] disabled:opacity-50 ${
                          template.tone === 'primary'
                            ? 'border-accent-blue/25 bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/15'
                            : template.tone === 'warning'
                              ? 'border-amber-500/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
                              : 'border-white/10 bg-bg-primary/60 text-text-primary hover:bg-bg-hover'
                        }`}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => handleQuickMessage('请汇报你当前的进展、阻塞项和下一步计划。', 'member')}
                      disabled={sendingCommand}
                      className="rounded-full border border-accent-blue/25 bg-accent-blue/10 px-3 py-1 text-[11px] text-accent-blue hover:bg-accent-blue/15 disabled:opacity-50"
                    >
                      催办汇报
                    </button>
                    <button
                      onClick={() => handleQuickMessage(`请优先推进当前任务：${selectedState.currentTask?.title || '当前负责事项'}，完成后立即同步结果。`, 'member')}
                      disabled={sendingCommand}
                      className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
                    >
                      催办当前任务
                    </button>
                    <button
                      onClick={() => handleQuickMessage('请所有成员同步各自进度、阻塞项和预计完成时间。', 'broadcast')}
                      disabled={sendingCommand}
                      className="rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[11px] text-violet-300 hover:bg-violet-500/15 disabled:opacity-50"
                    >
                      全员同步
                    </button>
                  </div>
                  <div className="flex items-end gap-2">
                    <textarea
                      value={commandText}
                      onChange={event => setCommandText(event.target.value)}
                      placeholder={
                        commandMode === 'member'
                          ? `向 ${selectedState.member.role.name} 下达更具体的指令`
                          : '向整个团队发布调度指令'
                      }
                      rows={2}
                      className="flex-1 resize-none rounded-2xl border border-border bg-bg-primary px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none"
                    />
                    <button
                      onClick={handleSendCommand}
                      disabled={sendingCommand || !commandText.trim()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-2xl bg-accent-blue px-3 text-xs text-white hover:bg-accent-blue/85 disabled:opacity-50"
                    >
                      <Send size={12} />
                      发送
                    </button>
                  </div>
                </div>
              </div>

              <div className="mb-3 mt-4 grid shrink-0 grid-cols-1 gap-2 xl:grid-cols-3">
                {studioTabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as StudioTab)}
                    className={`rounded-2xl border px-3 py-2 text-left transition-colors ${
                      activeTab === tab.key
                        ? `${tab.accentClass} shadow-[0_0_0_1px_rgba(255,255,255,0.02)]`
                        : 'border-border bg-bg-primary text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-[11px] font-medium">
                        {tab.icon}
                        <span>{tab.label}</span>
                      </div>
                      <span className="text-[10px] opacity-80">{tab.stat}</span>
                    </div>
                    <div className="mt-1 text-[10px] opacity-80">
                      {tab.description}
                    </div>
                  </button>
                ))}
              </div>

              <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border p-3 ${activeStudioTab.panelClass}`}>
                <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-white/6 bg-bg-primary/35 px-3 py-2">
                  <div>
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-text-primary">
                      {activeStudioTab.icon}
                      <span>{activeStudioTab.label}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      {activeStudioTab.description}
                    </div>
                  </div>
                  <div className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] ${activeStudioTab.accentClass}`}>
                    {activeStudioTab.stat}
                  </div>
                </div>

                {activeTab === 'timeline' && (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                    {timelineItems.length > 0 ? timelineItems.map(item => (
                      <div key={item.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border ${getStatusTone(item.tone)}`}>
                            {getActivityIcon(item.tone)}
                          </div>
                          <div className="mt-1 h-full w-px bg-border" />
                        </div>
                        <div className="flex-1 rounded-2xl border border-white/6 bg-bg-secondary/70 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-text-primary">{item.title}</div>
                            <div className="text-[11px] text-text-muted">{formatRelativeTime(item.timestamp)}</div>
                          </div>
                          <div className="mt-1 text-xs text-text-secondary">{item.description}</div>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-border bg-bg-secondary/40 p-4 text-xs text-text-muted">
                        暂时还没有足够的执行轨迹数据。
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'logs' && (
                  <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_380px]">
                    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-800 bg-[#0b1220] p-3 font-mono text-[11px] leading-5 text-slate-200 shadow-inner">
                      <div className="mb-3 flex items-center justify-between gap-3 text-[11px] text-slate-400">
                        <div>
                          <div className="inline-flex items-center gap-1.5">
                            <TerminalSquare size={12} />
                            <span>{selectedState.member.role.name} 主终端</span>
                          </div>
                          <div className="mt-1 text-[10px] text-slate-500">
                            {logsLoading ? '刷新中...' : streamingLogLines.length > 0 ? '实时流式窥屏' : '历史日志回放'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setLogsRefreshKey(value => value + 1)}
                            className="rounded-full border border-slate-700 bg-slate-900/50 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800/80"
                          >
                            刷新主屏
                          </button>
                          <button
                            onClick={() => setFollowLogs(value => !value)}
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              followLogs
                                ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                                : 'border-slate-700 bg-slate-900/50 text-slate-400'
                            }`}
                          >
                            {followLogs ? '自动跟随中' : '开启自动跟随'}
                          </button>
                          <span>展示 {visibleLogLines.length} 行</span>
                        </div>
                      </div>
                      {visibleLogLines.length > 0 ? (
                        <div ref={logScrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                          {visibleLogLines.map((line, index) => (
                            <div
                              key={`${index}-${line.slice(0, 24)}`}
                              className={`rounded px-2 py-1 ${
                                pickLogTone(line) === 'error'
                                  ? 'bg-rose-500/10 text-rose-200'
                                  : pickLogTone(line) === 'done'
                                    ? 'bg-emerald-500/10 text-emerald-200'
                                    : pickLogTone(line) === 'focused'
                                      ? 'bg-sky-500/10 text-sky-200'
                                      : 'bg-white/0 text-slate-300'
                              }`}
                            >
                              {line}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-700/60 bg-slate-900/40 p-4 text-slate-400">
                          <div>{logsLoading ? '正在抓取日志...' : '这个成员暂时还没有可展示的终端输出。'}</div>
                          {logsError && <div className="mt-2 text-rose-300">最近一次拉取失败：{logsError}</div>}
                        </div>
                      )}
                    </div>

                    <div className="flex min-h-0 flex-col rounded-2xl border border-white/6 bg-bg-secondary/70 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-text-primary">终端监控墙</div>
                          <div className="mt-1 text-[11px] text-text-muted">
                            自动挑选焦点成员、协作对象、运行中或高风险成员。
                          </div>
                        </div>
                        <button
                          onClick={() => setMonitorRefreshKey(value => value + 1)}
                          className="rounded-full border border-white/10 bg-bg-primary/60 px-2.5 py-1 text-[10px] text-text-primary hover:bg-bg-hover"
                        >
                          刷新工位墙
                        </button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                        {monitorDesks.length > 0 ? (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-1">
                            {monitorDesks.map(desk => (
                              <button
                                key={desk.state.member.id}
                                onClick={() => handleDeskFocus(desk.state.member)}
                                className={`rounded-2xl border p-3 text-left transition-colors ${
                                  selectedState.member.id === desk.state.member.id
                                    ? 'border-accent-blue/30 bg-accent-blue/10'
                                    : 'border-white/6 bg-bg-primary/45 hover:bg-bg-hover'
                                }`}
                              >
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm text-text-primary">
                                      <span>{desk.state.member.role.icon}</span>
                                      <span className="truncate">{desk.state.member.role.name}</span>
                                    </div>
                                    <div className="mt-1 text-[10px] text-text-muted">
                                      {getStatusLabel(desk.state.member, desk.state.currentTask)} · 风险 {desk.state.riskScore}
                                    </div>
                                  </div>
                                  <div className={`rounded-full border px-2 py-0.5 text-[10px] ${getStatusTone(desk.state.mood)}`}>
                                    {desk.loading ? '刷新中' : '在线'}
                                  </div>
                                </div>
                                <div className="mb-2 rounded-xl border border-slate-800 bg-[#0b1220] p-2 font-mono text-[10px] leading-5 text-slate-300">
                                  {desk.lines.length > 0 ? desk.lines.slice(-6).map((line, index) => (
                                    <div
                                      key={`${desk.state.member.id}-${index}-${line.slice(0, 16)}`}
                                      className={`truncate rounded px-1.5 ${
                                        pickLogTone(line) === 'error'
                                          ? 'bg-rose-500/10 text-rose-200'
                                          : pickLogTone(line) === 'done'
                                            ? 'bg-emerald-500/10 text-emerald-200'
                                            : pickLogTone(line) === 'focused'
                                              ? 'bg-sky-500/10 text-sky-200'
                                              : ''
                                      }`}
                                    >
                                      {line}
                                    </div>
                                  )) : (
                                    <div className="text-slate-500">
                                      {desk.loading ? '正在抓取...' : '暂无终端输出'}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center justify-between gap-2 text-[10px] text-text-muted">
                                  <span className="truncate">
                                    {desk.state.currentTask ? truncate(desk.state.currentTask.title, 24) : '暂无当前任务'}
                                  </span>
                                  <span>{formatRelativeTime(desk.state.member.lastActiveAt)}</span>
                                </div>
                                {desk.error && (
                                  <div className="mt-2 text-[10px] text-rose-300">日志异常：{desk.error}</div>
                                )}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-border bg-bg-primary/40 p-4 text-xs text-text-muted">
                            当前没有可监控的成员终端。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'collaboration' && (
                  <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                      {relatedEdges.length > 0 ? relatedEdges.map(edge => {
                        const fromMember = team.members.find(member => member.id === edge.fromId)
                        const toMember = team.members.find(member => member.id === edge.toId)
                        if (!fromMember || !toMember) return null

                        return (
                          <button
                            key={edge.id}
                            onClick={() => setActiveEdgeId(current => current === edge.id ? null : edge.id)}
                            className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                              activeEdgeId === edge.id
                                ? 'border-accent-blue/30 bg-accent-blue/10'
                                : 'border-white/6 bg-bg-secondary/70 hover:bg-bg-hover'
                            }`}
                          >
                            <div className="flex items-center gap-2 text-sm text-text-primary">
                              <span>{fromMember.role.icon}</span>
                              <span>{fromMember.role.name}</span>
                              <ArrowRightLeft size={12} className="text-text-muted" />
                              <span>{toMember.role.icon}</span>
                              <span>{toMember.role.name}</span>
                            </div>
                            <div className="mt-2 text-[11px] text-text-muted">
                              {edge.messageCount} 条消息 · {edge.handoffCount} 次交接
                              {edge.lastTouchedAt && ` · ${formatRelativeTime(edge.lastTouchedAt)}`}
                            </div>
                          </button>
                        )
                      }) : (
                        <div className="rounded-2xl border border-dashed border-border bg-bg-secondary/40 p-4 text-xs text-text-muted">
                          当前还没有明显的协作链路。
                        </div>
                      )}
                    </div>

                    <div className="flex min-h-0 flex-col rounded-2xl border border-white/6 bg-bg-secondary/70 p-3">
                      <div className="mb-3 flex items-center gap-2">
                        <MessageSquareText size={13} className="text-accent-blue" />
                        <div className="text-sm font-medium text-text-primary">
                          {activeEdge ? '协作边消息流' : '选择一条协作关系查看详情'}
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                        {activeEdge && (
                          <div className="rounded-xl border border-white/6 bg-bg-primary/55 p-3">
                            <div className="text-[11px] text-text-muted">协作诊断</div>
                            <div className="mt-1 text-sm text-text-primary">
                              {collaborationPartner
                                ? `${selectedState.member.role.name} 正与 ${collaborationPartner.role.name} 发生协作`
                                : '当前成员存在一条活跃协作关系'}
                            </div>
                            <div className="mt-2 text-[11px] text-text-secondary">
                              最近强度 {activeEdge.intensity} · 消息 {activeEdge.messageCount} · 交接 {activeEdge.handoffCount}
                            </div>
                          </div>
                        )}
                        {activeEdge && collaborationMessages.length > 0 ? collaborationMessages.map(message => {
                          const fromMember = team.members.find(member => member.id === message.from)
                          const toMember = team.members.find(member => member.id === message.to)
                          return (
                            <div key={message.id} className="rounded-xl border border-white/6 bg-bg-primary/60 p-3">
                              <div className="flex items-center justify-between gap-3 text-xs">
                                <div className="text-text-primary">
                                  {fromMember?.role.icon} {fromMember?.role.name} → {toMember?.role.icon} {toMember?.role.name}
                                </div>
                                <div className="text-text-muted">{formatRelativeTime(message.timestamp)}</div>
                              </div>
                              <div className="mt-1 text-xs text-text-secondary">{message.content}</div>
                            </div>
                          )
                        }) : (
                          <div className="rounded-xl border border-dashed border-border bg-bg-primary/40 p-4 text-xs text-text-muted">
                            {activeEdge
                              ? '这条协作链暂时没有直接消息，可能主要通过任务依赖接力。'
                              : '先点击左侧某条协作关系。'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              暂无成员数据
            </div>
          )}
        </section>

        {!immersiveMode && (
        <section className="flex min-h-0 flex-col rounded-3xl border border-border bg-bg-secondary/80 p-3">
          <div className="mb-3 shrink-0">
            <div className="text-xs font-medium text-text-primary">调度面板</div>
            <div className="mt-1 text-[11px] text-text-muted">先处理高风险成员，再清阻塞链，最后做团队广播。</div>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium text-text-primary">建议动作</div>
                <div className="rounded-full border border-white/8 bg-bg-primary/60 px-2 py-0.5 text-[10px] text-text-muted">
                  {recommendations.length} 项
                </div>
              </div>
              <div className="space-y-2">
                {recommendations.length > 0 ? recommendations.map(item => (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-3 ${
                      item.tone === 'error'
                        ? 'border-rose-500/25 bg-rose-500/10'
                        : item.tone === 'warning'
                          ? 'border-amber-500/25 bg-amber-500/10'
                          : 'border-sky-500/25 bg-sky-500/10'
                    }`}
                  >
                    <div className="text-xs font-medium text-text-primary">{item.title}</div>
                    <div className="mt-1 text-[11px] text-text-secondary">{item.detail}</div>
                    <button
                      onClick={() => handleRecommendation(item)}
                      disabled={sendingCommand}
                      className="mt-3 rounded-full border border-white/10 bg-bg-primary/60 px-3 py-1 text-[11px] text-text-primary hover:bg-bg-hover disabled:opacity-50"
                    >
                      {item.actionLabel}
                    </button>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-border bg-bg-primary/40 p-4 text-xs text-text-muted">
                    当前没有需要优先触发的调度动作。
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium text-text-primary">阻塞摘要</div>
                <div className="rounded-full border border-white/8 bg-bg-primary/60 px-2 py-0.5 text-[10px] text-text-muted">
                  {blockedTasks.length} 项
                </div>
              </div>
              <div className="space-y-2">
                {blockedTasks.length > 0 ? blockedTasks.map(task => (
                  <div key={task.id} className="rounded-2xl border border-white/6 bg-bg-primary/55 p-3">
                    <div className="flex items-center gap-2 text-sm text-text-primary">
                      <AlertTriangle size={13} className="text-amber-300" />
                      <span>{truncate(task.title, 34)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-text-muted">
                      依赖 {task.dependencies.length} 项 · 优先级 {task.priority}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-border bg-bg-primary/40 p-4 text-xs text-text-muted">
                    当前没有明显的依赖阻塞任务。
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-3 text-[11px] font-medium text-text-primary">团队广播</div>
              <div className="space-y-2">
                <button
                  onClick={() => handleQuickMessage('请所有成员同步各自进度、阻塞项和预计完成时间。', 'broadcast')}
                  disabled={sendingCommand}
                  className="w-full rounded-2xl border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-left text-xs text-violet-300 hover:bg-violet-500/15 disabled:opacity-50"
                >
                  进度同步
                </button>
                <button
                  onClick={() => handleQuickMessage('请所有成员优先处理会影响他人的阻塞项，处理完立即回复。', 'broadcast')}
                  disabled={sendingCommand}
                  className="w-full rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-500/15 disabled:opacity-50"
                >
                  解锁阻塞
                </button>
                {actionFeedback && (
                  <div className={`rounded-2xl border px-3 py-2 ${getFeedbackTone(actionFeedback.tone)}`}>
                    <div className="text-[11px] font-medium">{actionFeedback.title}</div>
                    <div className="mt-1 text-[11px] opacity-85">{actionFeedback.detail}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
        )}
      </div>
      </div>
    </div>
  )
}
