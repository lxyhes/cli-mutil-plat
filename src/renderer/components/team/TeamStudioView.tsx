import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  GitBranch,
  MessageSquareText,
  ScrollText,
  Share2,
  Skull,
  Sparkles,
  TerminalSquare,
  TimerReset,
} from 'lucide-react'
import type { TeamInstance, TeamMember, TeamMessage, TeamTask } from '../../../shared/types'
import type { TeamLogEntry } from '../../stores/teamStore'

interface TeamStudioViewProps {
  team: TeamInstance
  tasks: TeamTask[]
  messages: TeamMessage[]
  teamLogs: TeamLogEntry[]
  selectedMemberId?: string | null
  onSelectMember: (member: TeamMember) => void
}

interface MemberStudioState {
  member: TeamMember
  currentTask?: TeamTask
  queuedTasks: TeamTask[]
  recentMessage?: TeamMessage
  energy: number
  mood: 'focused' | 'waiting' | 'done' | 'error' | 'idle'
}

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

function getMemberEnergy(member: TeamMember, currentTask?: TeamTask): number {
  if (member.status === 'running') return currentTask ? 88 : 74
  if (member.status === 'waiting') return 48
  if (member.status === 'completed') return 100
  if (member.status === 'failed') return 28
  return 36
}

function getMemberMood(member: TeamMember): MemberStudioState['mood'] {
  if (member.status === 'running') return 'focused'
  if (member.status === 'waiting') return 'waiting'
  if (member.status === 'completed') return 'done'
  if (member.status === 'failed') return 'error'
  return 'idle'
}

function getStatusLabel(member: TeamMember, currentTask?: TeamTask): string {
  if (member.status === 'running') return currentTask ? '正在处理任务' : '正在协作'
  if (member.status === 'waiting') return '等待指令'
  if (member.status === 'completed') return '本轮已完成'
  if (member.status === 'failed') return '需要介入'
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

function getActivityIcon(mood: MemberStudioState['mood'] | TimelineItem['tone']) {
  switch (mood) {
    case 'focused':
      return <Activity size={12} />
    case 'waiting':
      return <Clock3 size={12} />
    case 'done':
      return <CheckCircle2 size={12} />
    case 'error':
      return <Skull size={12} />
    default:
      return <TimerReset size={12} />
  }
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

function extractLogLines(chunks: string[], limit: number): string[] {
  return chunks
    .flatMap(chunk => chunk.split('\n'))
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(-limit)
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
      description: `${member.role.name} 工位已连接到工作室`,
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
      id: `message-${message.id}`,
      timestamp: message.timestamp,
      title: message.from === member.id ? '发出团队消息' : '收到团队消息',
      description: truncate(message.content, 90),
      tone: message.from === member.id ? 'focused' : 'info',
    })
  }

  for (const entry of teamLogs) {
    if (!matchesMemberLog(entry, member)) continue
    items.push({
      id: entry.id,
      timestamp: entry.time,
      title: '团队调试日志',
      description: truncate(entry.msg, 100),
      tone: entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'waiting' : 'info',
    })
  }

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10)
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
    .slice(0, 14)
}

function getEdgeColor(edge: CollaborationEdge, selectedMemberId?: string | null): string {
  const isSelected = selectedMemberId && (edge.fromId === selectedMemberId || edge.toId === selectedMemberId)
  if (edge.handoffCount > 0 && isSelected) return 'rgba(88,166,255,0.95)'
  if (edge.handoffCount > 0) return 'rgba(88,166,255,0.5)'
  if (isSelected) return 'rgba(63,185,80,0.9)'
  return 'rgba(255,255,255,0.26)'
}

function getEdgeLabel(edge: CollaborationEdge): string {
  if (edge.handoffCount > 0 && edge.messageCount > 0) {
    return `${edge.messageCount} 消息 / ${edge.handoffCount} 交接`
  }
  if (edge.handoffCount > 0) return `${edge.handoffCount} 次任务交接`
  return `${edge.messageCount} 条消息`
}

function MiniWorker({
  member,
  mood,
  active,
  currentTask,
}: {
  member: TeamMember
  mood: MemberStudioState['mood']
  active: boolean
  currentTask?: TeamTask
}) {
  const haloClass =
    mood === 'focused'
      ? 'bg-emerald-400/20 ring-emerald-300/20'
      : mood === 'waiting'
        ? 'bg-amber-400/20 ring-amber-300/20'
        : mood === 'done'
          ? 'bg-sky-400/20 ring-sky-300/20'
          : mood === 'error'
            ? 'bg-rose-400/20 ring-rose-300/20'
            : 'bg-white/5 ring-white/10'

  const shirtClass =
    mood === 'focused'
      ? 'bg-emerald-300'
      : mood === 'waiting'
        ? 'bg-amber-300'
        : mood === 'done'
          ? 'bg-sky-300'
          : mood === 'error'
            ? 'bg-rose-300'
            : 'bg-slate-300'

  return (
    <div className="relative h-32">
      <div className={`absolute left-4 right-4 top-4 h-4 rounded-full blur-xl ${haloClass} ${mood === 'focused' ? 'animate-pulse' : ''}`} />
      <div className="absolute inset-x-6 bottom-2 h-3 rounded-full bg-black/20 blur-md" />

      <div className="absolute right-4 top-5 h-12 w-16 rounded-lg border border-slate-600 bg-slate-900 shadow-inner">
        <div className="flex h-full flex-col justify-between p-1.5">
          <div className={`h-1.5 rounded-full ${mood === 'focused' ? 'bg-emerald-300 animate-pulse' : mood === 'error' ? 'bg-rose-300' : 'bg-sky-300/70'}`} />
          <div className="space-y-1">
            <div className="h-1 rounded bg-slate-700" />
            <div className="h-1 w-2/3 rounded bg-slate-700" />
          </div>
        </div>
      </div>
      <div className="absolute right-2 top-[4.2rem] h-2 w-24 rounded bg-amber-700/80" />

      <div className={`absolute left-7 top-5 transition-transform ${mood === 'focused' ? '-rotate-2' : ''}`}>
        <div className={`absolute -inset-2 rounded-full ring-1 ${haloClass} ${active ? 'ring-2' : ''}`} />
        <div className="relative mx-auto h-7 w-7 rounded-full border border-amber-100/70 bg-amber-100 shadow-sm">
          <div className="absolute left-1.5 top-2 h-1 w-1 rounded-full bg-slate-700" />
          <div className="absolute right-1.5 top-2 h-1 w-1 rounded-full bg-slate-700" />
          <div className="absolute left-1/2 top-4 h-1 w-3 -translate-x-1/2 rounded-full bg-slate-700/70" />
        </div>
        <div className={`mx-auto mt-1 h-8 w-5 rounded-t-lg rounded-b-md ${shirtClass} shadow-sm`} />
        <div className="absolute left-0 top-9 h-6 w-1 origin-top rotate-[28deg] rounded-full bg-amber-100" />
        <div className={`absolute right-0 top-9 h-6 w-1 origin-top rounded-full bg-amber-100 ${mood === 'focused' ? '-rotate-[55deg]' : '-rotate-[18deg]'}`} />
        <div className="absolute left-2 top-[3.5rem] h-6 w-1 origin-top rotate-[8deg] rounded-full bg-slate-300" />
        <div className="absolute right-2 top-[3.5rem] h-6 w-1 origin-top -rotate-[8deg] rounded-full bg-slate-300" />
      </div>

      <div className="absolute left-3 top-1 rounded-full border border-white/10 bg-bg-primary/90 px-2 py-0.5 text-[10px] text-text-secondary backdrop-blur">
        {member.role.icon} {member.role.name}
      </div>

      {currentTask && (
        <div className="absolute left-20 top-3 max-w-[160px] rounded-2xl border border-white/10 bg-bg-primary/95 px-2.5 py-1.5 text-[10px] text-text-secondary shadow-lg backdrop-blur">
          <div className="mb-0.5 flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-text-muted">
            <Sparkles size={10} />
            当前聚焦
          </div>
          <div className="line-clamp-2 text-text-primary">{currentTask.title}</div>
        </div>
      )}
    </div>
  )
}

function MemberDeskCard({
  state,
  active,
  onSelect,
}: {
  state: MemberStudioState
  active: boolean
  onSelect: () => void
}) {
  const { member, currentTask, queuedTasks, recentMessage, energy, mood } = state

  return (
    <button
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all ${
        active
          ? 'border-accent-blue/40 bg-accent-blue/10 shadow-[0_0_0_1px_rgba(88,166,255,0.15)]'
          : 'border-border bg-bg-secondary hover:border-accent-blue/25 hover:bg-bg-hover'
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_70%)]" />
      <div className="relative">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">{member.role.icon || '👤'}</span>
              <div>
                <div className="text-sm font-medium text-text-primary">{member.role.name}</div>
                <div className="text-[11px] text-text-muted">
                  {member.providerId}
                  {member.role.isLeader && ' · Leader'}
                </div>
              </div>
            </div>
          </div>
          <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${getStatusTone(mood)}`}>
            {getActivityIcon(mood)}
            <span>{getStatusLabel(member, currentTask)}</span>
          </div>
        </div>

        <MiniWorker member={member} mood={mood} active={active} currentTask={currentTask} />

        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-text-muted">
              <span>工作强度</span>
              <span>{energy}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className={`h-full rounded-full transition-all ${
                  mood === 'focused'
                    ? 'bg-emerald-400'
                    : mood === 'waiting'
                      ? 'bg-amber-400'
                      : mood === 'done'
                        ? 'bg-sky-400'
                        : mood === 'error'
                          ? 'bg-rose-400'
                          : 'bg-text-muted'
                }`}
                style={{ width: `${energy}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">当前任务</div>
              <div className="mt-1 line-clamp-2 text-text-primary">
                {currentTask ? currentTask.title : '暂无认领中的任务'}
              </div>
            </div>
            <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">待办队列</div>
              <div className="mt-1 text-text-primary">{queuedTasks.length} 项</div>
              <div className="text-[11px] text-text-muted">
                {queuedTasks[0] ? truncate(queuedTasks[0].title, 18) : '队列空闲'}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-text-muted">
              <MessageSquareText size={11} />
              最近动态
            </div>
            <div className="line-clamp-2 text-xs text-text-primary">
              {truncate(recentMessage?.content, 96)}
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              {recentMessage ? formatRelativeTime(recentMessage.timestamp) : '等待新的团队消息'}
            </div>
          </div>
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
  const [sessionLogLines, setSessionLogLines] = useState<string[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [activeEdgeId, setActiveEdgeId] = useState<string | null>(null)

  const memberStates = useMemo<MemberStudioState[]>(() => {
    return (team.members || []).map(member => {
      const currentTask =
        tasks.find(task => task.id === member.currentTaskId && task.status === 'in_progress') ||
        tasks.find(task => task.claimedBy === member.id && task.status === 'in_progress')

      const queuedTasks = tasks.filter(task => {
        if (task.status !== 'pending') return false
        return task.assignedTo === member.id || task.claimedBy === member.id
      })

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
      }
    })
  }, [messages, tasks, team.members])

  const runningCount = memberStates.filter(state => state.member.status === 'running').length
  const focusCount = memberStates.filter(state => state.currentTask).length
  const waitingCount = memberStates.filter(state => state.member.status === 'waiting' || state.member.status === 'idle').length
  const selectedState = memberStates.find(state => state.member.id === selectedMemberId) || memberStates[0]

  const collaborationEdges = useMemo(
    () => buildCollaborationEdges(team.members || [], messages, tasks),
    [messages, tasks, team.members],
  )
  const activeEdge = collaborationEdges.find(edge => edge.id === activeEdgeId) || null

  const timelineItems = useMemo(() => {
    if (activeEdge) {
      const relatedIds = new Set([activeEdge.fromId, activeEdge.toId])
      const scopedMessages = messages.filter(message =>
        relatedIds.has(message.from) && (!message.to || relatedIds.has(message.to)),
      )
      const scopedTasks = tasks.filter(task => {
        if (task.claimedBy && relatedIds.has(task.claimedBy)) return true
        if (task.assignedTo && relatedIds.has(task.assignedTo)) return true
        return task.dependencies.some(depId => {
          const depTask = tasks.find(item => item.id === depId)
          return !!depTask?.claimedBy && relatedIds.has(depTask.claimedBy)
        })
      })
      const scopedLogs = teamLogs.filter(entry => {
        const payload = `${entry.msg} ${JSON.stringify(entry.data || [])}`.toLowerCase()
        return Array.from(relatedIds).some(id => payload.includes(id.toLowerCase()))
      })

      return Array.from(relatedIds)
        .flatMap(memberId => {
          const member = team.members.find(item => item.id === memberId)
          return member ? buildTimeline(member, scopedTasks, scopedMessages, scopedLogs).slice(0, 5) : []
        })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 12)
    }

    return selectedState
      ? buildTimeline(selectedState.member, tasks, messages, teamLogs)
      : []
  }, [activeEdge, messages, selectedState, tasks, team.members, teamLogs])

  const collaborationMessages = useMemo(() => {
    if (!activeEdge) return []
    return messages.filter(message =>
      (message.from === activeEdge.fromId && message.to === activeEdge.toId)
      || (message.from === activeEdge.toId && message.to === activeEdge.fromId),
    ).slice(-8)
  }, [activeEdge, messages])

  const nodePositions = useMemo(() => {
    const members = team.members || []
    const radius = 122
    const centerX = 170
    const centerY = 150
    return members.map((member, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(members.length, 1) - Math.PI / 2
      return {
        member,
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      }
    })
  }, [team.members])

  const nodeMap = useMemo(
    () => new Map(nodePositions.map(node => [node.member.id, node])),
    [nodePositions],
  )

  useEffect(() => {
    if (!selectedState?.member.sessionId) {
      setSessionLogLines([])
      return
    }

    let cancelled = false

    const refreshLogs = async () => {
      setLogsLoading(true)
      try {
        const result = await (window as any).spectrAI.session.getLogs(selectedState.member.sessionId)
        if (!cancelled) {
          setSessionLogLines(extractLogLines(Array.isArray(result) ? result : [], 18))
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[TeamStudio] Failed to get session logs:', err)
          setSessionLogLines([])
        }
      } finally {
        if (!cancelled) setLogsLoading(false)
      }
    }

    refreshLogs()
    const interval = window.setInterval(refreshLogs, 4000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [selectedState?.member.lastActiveAt, selectedState?.member.sessionId])

  return (
    <div className="p-4">
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">在线工位</div>
          <div className="mt-2 flex items-end gap-2">
            <div className="text-2xl font-semibold text-text-primary">{runningCount}</div>
            <div className="pb-1 text-xs text-text-muted">成员正在执行</div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">聚焦任务</div>
          <div className="mt-2 flex items-end gap-2">
            <div className="text-2xl font-semibold text-text-primary">{focusCount}</div>
            <div className="pb-1 text-xs text-text-muted">工位当前有活跃任务</div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">待命席位</div>
          <div className="mt-2 flex items-end gap-2">
            <div className="text-2xl font-semibold text-text-primary">{waitingCount}</div>
            <div className="pb-1 text-xs text-text-muted">等待指令或下一批任务</div>
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-3xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent_28%),linear-gradient(135deg,rgba(88,166,255,0.06),rgba(63,185,80,0.04))] p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text-primary">团队工作室</h3>
            <p className="mt-1 text-xs text-text-muted">每个工位都会根据成员状态、当前任务和近期团队消息实时变化。</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            实时监控中
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {memberStates.map(state => (
            <MemberDeskCard
              key={state.member.id}
              state={state}
              active={selectedState?.member.id === state.member.id}
              onSelect={() => onSelectMember(state.member)}
            />
          ))}
        </div>

        {selectedState && (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-border bg-bg-secondary/80 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{selectedState.member.role.icon}</span>
                    <h4 className="text-sm font-medium text-text-primary">
                      {selectedState.member.role.name} 监控台
                    </h4>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {selectedState.member.role.identifier} · {selectedState.member.providerId}
                  </p>
                </div>
                <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${getStatusTone(selectedState.mood)}`}>
                  {getActivityIcon(selectedState.mood)}
                  {getStatusLabel(selectedState.member, selectedState.currentTask)}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">当前任务</div>
                  <div className="mt-2 text-sm text-text-primary">
                    {selectedState.currentTask ? selectedState.currentTask.title : '当前没有认领中的任务'}
                  </div>
                  {selectedState.currentTask?.description && (
                    <div className="mt-1 line-clamp-3 text-xs text-text-muted">
                      {selectedState.currentTask.description}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">最近消息</div>
                  <div className="mt-2 text-sm text-text-primary">
                    {truncate(selectedState.recentMessage?.content, 120)}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {selectedState.recentMessage ? formatRelativeTime(selectedState.recentMessage.timestamp) : '暂无团队消息'}
                  </div>
                </div>
                <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">工作台</div>
                  <div className="mt-2 space-y-1 text-xs text-text-secondary">
                    <div>会话: <span className="text-text-primary">{selectedState.member.sessionId.slice(0, 10)}...</span></div>
                    <div>活跃度: <span className="text-text-primary">{selectedState.energy}%</span></div>
                    <div>最后活跃: <span className="text-text-primary">{formatRelativeTime(selectedState.member.lastActiveAt)}</span></div>
                    <div>工作目录: <span className="text-text-primary">{truncate(selectedState.member.worktreePath || selectedState.member.workDir, 38)}</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch size={14} className="text-accent-blue" />
                    <h4 className="text-sm font-medium text-text-primary">任务执行时间轴</h4>
                  </div>
                  <span className="text-[11px] text-text-muted">{timelineItems.length} 条轨迹</span>
                </div>

                <div className="space-y-3">
                  {timelineItems.length > 0 ? timelineItems.map(item => (
                    <div key={item.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border ${getStatusTone(item.tone)}`}>
                          {getActivityIcon(item.tone)}
                        </div>
                        <div className="mt-1 h-full w-px bg-border" />
                      </div>
                      <div className="flex-1 rounded-xl border border-white/6 bg-bg-primary/60 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm text-text-primary">{item.title}</div>
                          <div className="text-[11px] text-text-muted">{formatRelativeTime(item.timestamp)}</div>
                        </div>
                        <div className="mt-1 text-xs text-text-secondary">{item.description}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-border bg-bg-primary/40 p-4 text-xs text-text-muted">
                      {activeEdge
                        ? '这条协作边暂时还没有更细的轨迹数据。'
                        : '暂时还没有足够的执行轨迹，成员开始认领任务或发送消息后，这里会自动出现时间轴。'}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TerminalSquare size={14} className="text-emerald-300" />
                    <h4 className="text-sm font-medium text-text-primary">成员终端 / 日志窥屏</h4>
                  </div>
                  <span className="text-[11px] text-text-muted">
                    {logsLoading ? '刷新中...' : '每 4 秒同步'}
                  </span>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-text-muted">
                      <ScrollText size={11} />
                      调试日志
                    </div>
                    <div className="mt-2 text-xs text-text-secondary">
                      {teamLogs.filter(entry => matchesMemberLog(entry, selectedState.member)).length} 条与该成员相关
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/6 bg-bg-primary/60 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-text-muted">
                      <MessageSquareText size={11} />
                      最近输出
                    </div>
                    <div className="mt-2 text-xs text-text-secondary">
                      尾部保留 {sessionLogLines.length} 行终端片段
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-3 font-mono text-[11px] leading-5 text-slate-200 shadow-inner">
                  {sessionLogLines.length > 0 ? (
                    <div className="space-y-1">
                      {sessionLogLines.map((line, index) => (
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
                      {logsLoading ? '正在抓取日志...' : '这个成员暂时还没有可展示的终端输出。'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-bg-secondary p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Share2 size={14} className="text-violet-300" />
                  <h4 className="text-sm font-medium text-text-primary">成员协作拓扑</h4>
                </div>
                <span className="text-[11px] text-text-muted">{collaborationEdges.length} 条连线</span>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.95fr]">
                <div className="rounded-2xl border border-white/6 bg-bg-primary/50 p-3">
                  <svg viewBox="0 0 340 300" className="h-[300px] w-full">
                    <defs>
                      <radialGradient id="studio-center-glow" cx="50%" cy="50%" r="55%">
                        <stop offset="0%" stopColor="rgba(88,166,255,0.14)" />
                        <stop offset="100%" stopColor="rgba(88,166,255,0)" />
                      </radialGradient>
                    </defs>
                    <circle cx="170" cy="150" r="115" fill="url(#studio-center-glow)" />

                    {collaborationEdges.map(edge => {
                      const fromNode = nodeMap.get(edge.fromId)
                      const toNode = nodeMap.get(edge.toId)
                      if (!fromNode || !toNode) return null

                      const dx = toNode.x - fromNode.x
                      const dy = toNode.y - fromNode.y
                      const mx = (fromNode.x + toNode.x) / 2
                      const my = (fromNode.y + toNode.y) / 2 - 18
                      const highlight = selectedState && (edge.fromId === selectedState.member.id || edge.toId === selectedState.member.id)

                      return (
                        <g key={edge.id}>
                          <path
                            d={`M ${fromNode.x} ${fromNode.y} Q ${mx} ${my} ${toNode.x} ${toNode.y}`}
                            fill="none"
                            stroke={getEdgeColor(edge, selectedState?.member.id)}
                            strokeWidth={highlight ? 3 : Math.max(1.2, Math.min(3, 1 + edge.intensity * 0.35))}
                            strokeDasharray={edge.handoffCount > 0 ? '0' : '5 5'}
                            strokeLinecap="round"
                            opacity={highlight ? 1 : 0.8}
                            className="cursor-pointer"
                            onClick={() => setActiveEdgeId(current => current === edge.id ? null : edge.id)}
                          />
                        </g>
                      )
                    })}

                    {nodePositions.map(node => {
                      const isSelected = selectedState?.member.id === node.member.id
                      const state = memberStates.find(item => item.member.id === node.member.id)
                      const mood = state?.mood || 'idle'
                      return (
                        <g key={node.member.id} transform={`translate(${node.x}, ${node.y})`}>
                          <circle
                            r={isSelected ? 27 : 22}
                            fill={isSelected ? 'rgba(88,166,255,0.18)' : 'rgba(15,23,42,0.88)'}
                            stroke={
                              mood === 'focused'
                                ? 'rgba(63,185,80,0.9)'
                                : mood === 'done'
                                  ? 'rgba(88,166,255,0.9)'
                                  : mood === 'error'
                                    ? 'rgba(244,63,94,0.9)'
                                    : 'rgba(255,255,255,0.16)'
                            }
                            strokeWidth={isSelected ? 2.5 : 1.5}
                          />
                          <text
                            x="0"
                            y="-2"
                            textAnchor="middle"
                            fontSize="16"
                          >
                            {node.member.role.icon || '👤'}
                          </text>
                          <text
                            x="0"
                            y="36"
                            textAnchor="middle"
                            fontSize="10"
                            fill="rgba(226,232,240,0.9)"
                          >
                            {truncate(node.member.role.name, 8)}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                </div>

                <div className="space-y-2">
                  {collaborationEdges.length > 0 ? collaborationEdges.map(edge => {
                    const fromMember = team.members.find(member => member.id === edge.fromId)
                    const toMember = team.members.find(member => member.id === edge.toId)
                    if (!fromMember || !toMember) return null
                    const highlight = selectedState && (edge.fromId === selectedState.member.id || edge.toId === selectedState.member.id)

                    return (
                      <div
                        key={edge.id}
                        onClick={() => setActiveEdgeId(current => current === edge.id ? null : edge.id)}
                        className={`rounded-xl border p-3 transition-colors ${
                          activeEdgeId === edge.id
                            ? 'border-emerald-400/30 bg-emerald-500/10'
                            : highlight
                            ? 'border-accent-blue/30 bg-accent-blue/10'
                            : 'border-white/6 bg-bg-primary/50'
                        } cursor-pointer`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm text-text-primary">
                            <span>{fromMember.role.icon}</span>
                            <span>{fromMember.role.name}</span>
                            <ArrowRightLeft size={12} className="text-text-muted" />
                            <span>{toMember.role.icon}</span>
                            <span>{toMember.role.name}</span>
                          </div>
                          <span className="text-[11px] text-text-muted">
                            {edge.lastTouchedAt ? formatRelativeTime(edge.lastTouchedAt) : '暂无时间'}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-text-secondary">
                          {getEdgeLabel(edge)}
                        </div>
                      </div>
                    )
                  }) : (
                    <div className="rounded-xl border border-dashed border-border bg-bg-primary/40 p-4 text-xs text-text-muted">
                      当前还没有足够的成员协作数据。等成员开始互相发消息或接力执行依赖任务后，这里会形成连线。
                    </div>
                  )}
                </div>
              </div>

              {activeEdge && (
                <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft size={14} className="text-emerald-300" />
                      <h4 className="text-sm font-medium text-text-primary">协作边聚焦</h4>
                    </div>
                    <button
                      onClick={() => setActiveEdgeId(null)}
                      className="text-[11px] text-text-muted hover:text-text-primary"
                    >
                      清除过滤
                    </button>
                  </div>

                  <div className="space-y-2">
                    {collaborationMessages.length > 0 ? collaborationMessages.map(message => {
                      const fromMember = team.members.find(member => member.id === message.from)
                      const toMember = team.members.find(member => member.id === message.to)
                      return (
                        <div key={message.id} className="rounded-xl border border-white/6 bg-bg-primary/50 p-3">
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
                        这条协作边目前还没有直接消息记录，可能主要是通过任务依赖接力协作。
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
