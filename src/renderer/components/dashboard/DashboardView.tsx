/**
 * Dashboard 全局概览视图 - 会话卡片 + 统计 + 活动流 + 用量图表
 * @author weibin
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Activity, Zap, Clock, Monitor, CheckCircle, AlertCircle,
  PlayCircle, PauseCircle, Terminal, BarChart3, Users
} from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { STATUS_COLORS, STATUS_LABELS } from '../../../shared/constants'
import type { Session, SessionStatus, ActivityEvent } from '../../../shared/types'
import UsageDashboard from '../usage/UsageDashboard'
import {
  DELIVERY_ACTION_EVENT,
  DELIVERY_METRICS_EVENT,
  formatMetricAge,
  formatMetricDuration,
  formatMetricPercent,
  getDeliveryMetricActionItems,
  getDeliveryMetricFreshness,
  loadDeliveryMetricActionLifecycles,
  loadDeliveryMetricSnapshots,
  queueDeliveryMetricAction,
  summarizeDeliveryMetricActionLifecycles,
  summarizeDeliveryMetrics,
  type DeliveryMetricActionItem,
  type DeliveryMetricActionLifecycleRecord,
  type DeliveryMetricActionLifecycleSummary,
  type DeliveryMetricFreshness,
  type DeliveryMetricSnapshotRecord,
} from '../../utils/deliveryMetrics'
import {
  PROJECT_MEMORY_TELEMETRY_EVENT,
  loadProjectMemoryTelemetryEvents,
  summarizeProjectMemoryTelemetryHistory,
  summarizeProjectMemoryTelemetry,
  type ProjectMemoryTelemetryEvent,
  type ProjectMemoryTelemetryHistoryReport,
  type ProjectMemoryTelemetrySummary,
} from '../../utils/projectMemorySuggestions'

function formatDuration(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

interface AgentGovernanceSummary {
  parentSessionCount: number
  totalCount: number
  activeCount: number
  completedCount: number
  blockedCount: number
  completionRate: number
  blockedRate: number
}

function summarizeAgentGovernance(agentsBySession: Record<string, Array<{ status: string }>>): AgentGovernanceSummary {
  const parentSessionCount = Object.values(agentsBySession).filter(agents => agents.length > 0).length
  const allAgents = Object.values(agentsBySession).flat()
  const activeCount = allAgents.filter(agent => agent.status === 'pending' || agent.status === 'running').length
  const completedCount = allAgents.filter(agent => agent.status === 'completed').length
  const blockedCount = allAgents.filter(agent => agent.status === 'failed' || agent.status === 'cancelled').length
  const totalCount = allAgents.length

  return {
    parentSessionCount,
    totalCount,
    activeCount,
    completedCount,
    blockedCount,
    completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
    blockedRate: totalCount > 0 ? Math.round((blockedCount / totalCount) * 100) : 0,
  }
}

/** 会话卡片 */
function SessionCard({ session, onClick }: { session: Session; onClick: () => void }) {
  const lastActivity = useSessionStore(s => s.getLastActivity(session.id))
  const isActive = session.status === 'running' || session.status === 'waiting_input' || session.status === 'idle'

  return (
    <button
      onClick={onClick}
      className="card p-3 text-left hover:border-accent-blue/40 btn-transition w-full"
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${session.status === 'running' ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: STATUS_COLORS[session.status] || STATUS_COLORS.idle }}
        />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {session.name || session.config.name}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
          style={{
            backgroundColor: (STATUS_COLORS[session.status] || STATUS_COLORS.idle) + '20',
            color: STATUS_COLORS[session.status] || STATUS_COLORS.idle
          }}
        >
          {STATUS_LABELS[session.status] || session.status}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-text-muted">
        {isActive && session.startedAt && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(session.startedAt)}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          {session.estimatedTokens.toLocaleString()}
        </span>
      </div>

      {lastActivity && (
        <div className="mt-1.5 text-[10px] text-text-muted truncate">
          {lastActivity.detail}
        </div>
      )}
    </button>
  )
}

export default function DashboardView() {
  const { sessions, selectSession, activities, agents } = useSessionStore()
  const [recentEvents, setRecentEvents] = useState<(ActivityEvent & { sessionName: string })[]>([])
  const [deliveryRecords, setDeliveryRecords] = useState<DeliveryMetricSnapshotRecord[]>(() => loadDeliveryMetricSnapshots())
  const [actionLifecycles, setActionLifecycles] = useState<DeliveryMetricActionLifecycleRecord[]>(() => loadDeliveryMetricActionLifecycles())
  const [memoryTelemetryEvents, setMemoryTelemetryEvents] = useState<ProjectMemoryTelemetryEvent[]>(() => loadProjectMemoryTelemetryEvents())
  const [clockTick, setTick] = useState(0)

  // 分类
  const runningSessions = sessions.filter(s => s.status === 'running')
  const waitingSessions = sessions.filter(s => s.status === 'waiting_input' || s.status === 'idle')
  const errorSessions = sessions.filter(s => s.status === 'error')
  const completedSessions = sessions.filter(s => s.status === 'completed')
  const activeSessions = sessions.filter(s =>
    s.status !== 'completed' && s.status !== 'terminated' && s.status !== 'interrupted'
  )
  const successSummary = useMemo(() => summarizeDeliveryMetrics(deliveryRecords), [deliveryRecords])
  const metricFreshness = useMemo(() => getDeliveryMetricFreshness(deliveryRecords), [deliveryRecords, clockTick])
  const actionItems = useMemo(() => getDeliveryMetricActionItems(deliveryRecords, 5), [deliveryRecords])
  const actionLifecycleSummary = useMemo(
    () => summarizeDeliveryMetricActionLifecycles(actionLifecycles),
    [actionLifecycles],
  )
  const memoryTelemetrySummary = useMemo(
    () => summarizeProjectMemoryTelemetry(memoryTelemetryEvents),
    [memoryTelemetryEvents],
  )
  const memoryHistoryReport = useMemo(
    () => summarizeProjectMemoryTelemetryHistory(memoryTelemetryEvents, { dayCount: 14, projectLimit: 4 }),
    [memoryTelemetryEvents],
  )
  const agentGovernanceSummary = useMemo(() => summarizeAgentGovernance(agents), [agents])
  const openActionItem = (item: DeliveryMetricActionItem) => {
    queueDeliveryMetricAction(item)
    selectSession(item.sessionId)
  }

  // 聚合最近活动事件（跨会话）
  useEffect(() => {
    const allEvents: (ActivityEvent & { sessionName: string })[] = []
    for (const [sessionId, events] of Object.entries(activities)) {
      const session = sessions.find(s => s.id === sessionId)
      const name = session?.name || session?.config.name || sessionId.slice(0, 8)
      for (const event of events.slice(-10)) {
        allEvents.push({ ...event, sessionName: name })
      }
    }
    // 按时间倒序，取最近 15 条
    allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    setRecentEvents(allEvents.slice(0, 15))
  }, [activities, sessions])

  // 每秒更新运行时长
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const refreshMetrics = () => {
      setDeliveryRecords(loadDeliveryMetricSnapshots())
      setActionLifecycles(loadDeliveryMetricActionLifecycles())
      setMemoryTelemetryEvents(loadProjectMemoryTelemetryEvents())
    }
    refreshMetrics()
    window.addEventListener(DELIVERY_METRICS_EVENT, refreshMetrics)
    window.addEventListener(DELIVERY_ACTION_EVENT, refreshMetrics)
    window.addEventListener(PROJECT_MEMORY_TELEMETRY_EVENT, refreshMetrics)
    window.addEventListener('storage', refreshMetrics)
    return () => {
      window.removeEventListener(DELIVERY_METRICS_EVENT, refreshMetrics)
      window.removeEventListener(DELIVERY_ACTION_EVENT, refreshMetrics)
      window.removeEventListener(PROJECT_MEMORY_TELEMETRY_EVENT, refreshMetrics)
      window.removeEventListener('storage', refreshMetrics)
    }
  }, [])

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard
          icon={Monitor}
          label="总会话"
          value={sessions.length}
          color="#58A6FF"
        />
        <StatCard
          icon={PlayCircle}
          label="正在处理"
          value={runningSessions.length}
          color="#3FB950"
        />
        <StatCard
          icon={PauseCircle}
          label="等你继续"
          value={waitingSessions.length}
          color="#D29922"
        />
        <StatCard
          icon={AlertCircle}
          label="需要处理"
          value={errorSessions.length}
          color="#F85149"
        />
        <StatCard
          icon={CheckCircle}
          label="已完成"
          value={completedSessions.length}
          color="#8B949E"
        />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-accent-green" />
            核心竞争力指标
          </h3>
          <span className="text-[11px] text-text-muted">
            {successSummary.sessionCount > 0 ? `${successSummary.sessionCount} 个会话样本` : '等待会话产生指标'}
          </span>
        </div>
        <MetricsStateNotice freshness={metricFreshness} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <SuccessMetricCard
            icon={Activity}
            label="综合得分"
            value={successSummary.sessionCount > 0 ? String(successSummary.averageScore) : '--'}
            detail={`安全会话 ${formatMetricPercent(successSummary.safeSessionRate)}`}
            tone={successSummary.averageScore >= 80 ? 'good' : successSummary.averageScore >= 60 ? 'warn' : successSummary.sessionCount > 0 ? 'bad' : 'neutral'}
          />
          <SuccessMetricCard
            icon={CheckCircle}
            label="交付包率"
            value={formatMetricPercent(successSummary.deliveryPackRate)}
            detail="已导出交付包的会话占比"
            tone={successSummary.deliveryPackRate >= 70 ? 'good' : successSummary.deliveryPackRate > 0 ? 'warn' : 'neutral'}
          />
          <SuccessMetricCard
            icon={Terminal}
            label="验证覆盖"
            value={formatMetricPercent(successSummary.validationCoverageRate)}
            detail="代码改动会话中的验证占比"
            tone={successSummary.validationCoverageRate >= 80 ? 'good' : successSummary.validationCoverageRate > 0 ? 'warn' : 'neutral'}
          />
          <SuccessMetricCard
            icon={Clock}
            label="平均交付"
            value={formatMetricDuration(successSummary.averageHandoffMinutes)}
            detail="从任务开始到可交付证据"
            tone={successSummary.averageHandoffMinutes !== undefined ? 'good' : 'neutral'}
          />
          <SuccessMetricCard
            icon={Monitor}
            label="项目记忆"
            value={String(successSummary.projectMemoryCount)}
            detail="已沉淀的复用知识条目"
            tone={successSummary.projectMemoryCount > 0 ? 'good' : 'neutral'}
          />
          <SuccessMetricCard
            icon={AlertCircle}
            label="阻塞会话"
            value={String(successSummary.blockedCount)}
            detail="存在异常工具或错误状态"
            tone={successSummary.blockedCount > 0 ? 'bad' : successSummary.sessionCount > 0 ? 'good' : 'neutral'}
          />
        </div>
        <ActionQueue
          items={actionItems}
          freshness={metricFreshness}
          lifecycleSummary={actionLifecycleSummary}
          onOpenAction={openActionItem}
        />
        <MemoryFlywheelPanel summary={memoryTelemetrySummary} />
        <MemoryHistoryReportPanel report={memoryHistoryReport} />
        <AgentGovernancePanel summary={agentGovernanceSummary} />
      </section>

      <div className="grid grid-cols-3 gap-4">
        {/* 左侧：活跃会话卡片 */}
        <div className="col-span-2 space-y-3">
          <h3 className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
            <Terminal className="w-4 h-4" />
            活跃会话 ({activeSessions.length})
          </h3>

          {activeSessions.length === 0 ? (
            <div className="card p-6 text-center text-text-muted text-sm">
              暂无活跃会话
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {activeSessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onClick={() => selectSession(session.id)}
                />
              ))}
            </div>
          )}

          {/* 最近活动流 */}
          <h3 className="text-sm font-medium text-text-secondary flex items-center gap-1.5 mt-4">
            <Activity className="w-4 h-4" />
            最近活动
          </h3>

          {recentEvents.length === 0 ? (
            <div className="card p-4 text-center text-text-muted text-xs">
              暂无活动事件
            </div>
          ) : (
            <div className="card p-2 space-y-0.5 max-h-[280px] overflow-y-auto">
              {recentEvents.map(event => (
                <div key={event.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-bg-hover btn-transition">
                  <span className="text-[10px] text-text-muted flex-shrink-0 w-14 text-right">
                    {new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-accent-blue/10 text-accent-blue flex-shrink-0">
                    {event.sessionName}
                  </span>
                  <span className="text-xs text-text-primary truncate">
                    {event.detail}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：用量图表 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
            <Zap className="w-4 h-4" />
            用量统计
          </h3>
          <UsageDashboard />
        </div>
      </div>
    </div>
  )
}

/** 统计卡片子组件 */
function StatCard({ icon: Icon, label, value, color }: {
  icon: typeof Monitor
  label: string
  value: number
  color: string
}) {
  return (
    <div className="card p-3 text-center">
      <Icon className="w-5 h-5 mx-auto mb-1" style={{ color }} />
      <div className="text-xl font-bold text-text-primary">{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  )
}

type SuccessMetricTone = 'good' | 'warn' | 'bad' | 'neutral'

const SUCCESS_METRIC_TONE_CLASS: Record<SuccessMetricTone, string> = {
  good: 'border-accent-green/20 bg-accent-green/5 text-accent-green',
  warn: 'border-accent-yellow/25 bg-accent-yellow/10 text-accent-yellow',
  bad: 'border-accent-red/25 bg-accent-red/10 text-accent-red',
  neutral: 'border-border-subtle bg-bg-elevated text-text-secondary',
}

const ACTION_PRIORITY_CLASS: Record<DeliveryMetricActionItem['priority'], string> = {
  high: 'border-accent-red/25 bg-accent-red/10 text-accent-red',
  medium: 'border-accent-yellow/25 bg-accent-yellow/10 text-accent-yellow',
  low: 'border-accent-blue/20 bg-accent-blue/10 text-accent-blue',
}

const ACTION_PRIORITY_LABEL: Record<DeliveryMetricActionItem['priority'], string> = {
  high: '优先',
  medium: '补齐',
  low: '优化',
}

function SuccessMetricCard({ icon: Icon, label, value, detail, tone }: {
  icon: typeof Monitor
  label: string
  value: string
  detail: string
  tone: SuccessMetricTone
}) {
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${SUCCESS_METRIC_TONE_CLASS[tone]}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[11px] font-medium text-text-secondary">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold leading-none text-text-primary">{value}</div>
      <div className="mt-1 truncate text-[10px] text-text-muted" title={detail}>
        {detail}
      </div>
    </div>
  )
}

function MetricsStateNotice({ freshness }: { freshness: DeliveryMetricFreshness }) {
  if (freshness.state === 'empty') {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated/70 px-3 py-2 text-xs text-text-secondary">
        还没有可用交付指标。打开会话并产生工具、验证或交付包后，这里会开始统计。
      </div>
    )
  }

  if (freshness.state === 'stale') {
    return (
      <div className="rounded-lg border border-accent-yellow/25 bg-accent-yellow/10 px-3 py-2 text-xs text-text-secondary">
        指标已超过 {formatMetricAge(freshness.ageHours)} 未刷新。回到活跃会话或生成交付包后会自动更新。
      </div>
    )
  }

  if (freshness.staleCount > 0) {
    return (
      <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/10 px-3 py-2 text-xs text-text-secondary">
        最近指标已更新，另有 {freshness.staleCount} 个旧样本仅用于趋势参考。
      </div>
    )
  }

  return null
}

function MemoryFlywheelPanel({ summary }: { summary: ProjectMemoryTelemetrySummary }) {
  if (summary.eventCount === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated/60 px-3 py-2 text-xs text-text-secondary">
        记忆飞轮还没有审核数据。接受、编辑、拒绝建议记忆，或插入团队 playbook 后，这里会显示复用和沉淀趋势。
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/65 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <Monitor className="h-3.5 w-3.5 text-accent-purple" />
          记忆飞轮
        </div>
        <span className="text-[10px] text-text-muted">{summary.eventCount} 条事件</span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SuccessMetricCard
          icon={CheckCircle}
          label="审核闭环"
          value={formatMetricPercent(summary.promotionRate)}
          detail={`${summary.acceptedCount + summary.editedCount} 沉淀 / ${summary.rejectedCount} 拒绝`}
          tone={summary.promotionRate >= 60 ? 'good' : summary.reviewedCount > 0 ? 'warn' : 'neutral'}
        />
        <SuccessMetricCard
          icon={Monitor}
          label="审核样本"
          value={String(summary.reviewedCount)}
          detail={`编辑 ${summary.editedCount} 条，平均置信 ${summary.averageConfidence}%`}
          tone={summary.reviewedCount > 0 ? 'good' : 'neutral'}
        />
        <SuccessMetricCard
          icon={Activity}
          label="Playbook 复用"
          value={String(summary.playbookInjectionCount)}
          detail="团队模板注入相关记忆次数"
          tone={summary.playbookInjectionCount > 0 ? 'good' : 'neutral'}
        />
        <SuccessMetricCard
          icon={Zap}
          label="相关内容"
          value={summary.averageFilteredLength > 0 ? `${summary.averageFilteredLength}` : '--'}
          detail="平均注入字符数，越高代表可复用上下文越丰富"
          tone={summary.averageFilteredLength > 0 ? 'good' : 'neutral'}
        />
      </div>
    </div>
  )
}

function formatHistoryActivity(value?: string): string {
  if (!value) return '暂无活动'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function MemoryHistoryReportPanel({ report }: { report: ProjectMemoryTelemetryHistoryReport }) {
  if (report.total.eventCount === 0) return null

  const maxDailyEvents = Math.max(1, ...report.trend.map(point => point.eventCount))

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/65 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <BarChart3 className="h-3.5 w-3.5 text-accent-blue" />
          团队/项目记忆历史
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
          <span>近 {report.dayCount} 天</span>
          <span>{report.total.eventCount} 条事件</span>
          <span>审核闭环 {formatMetricPercent(report.total.promotionRate)}</span>
          <span>旧知识处置 {report.total.staleResolutionCount}</span>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
        <div className="rounded-md border border-border-subtle bg-bg-primary/55 p-2">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-muted">
            <span>每日事件趋势</span>
            <span>峰值 {maxDailyEvents}</span>
          </div>
          <div className="flex h-20 items-end gap-1">
            {report.trend.map(point => {
              const height = Math.max(6, Math.round((point.eventCount / maxDailyEvents) * 52))
              const tone = point.staleResolutionCount > 0
                ? 'bg-accent-yellow/70'
                : point.promotionRate >= 60
                  ? 'bg-accent-green/70'
                  : point.eventCount > 0
                    ? 'bg-accent-blue/65'
                    : 'bg-border-subtle'

              return (
                <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-sm ${tone}`}
                    style={{ height }}
                    title={`${point.date}: ${point.eventCount} 条事件，审核闭环 ${formatMetricPercent(point.promotionRate)}`}
                  />
                  <span className="w-full truncate text-center text-[9px] text-text-muted">
                    {point.label.slice(3)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-md border border-border-subtle bg-bg-primary/55 p-2">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-muted">
            <span>项目报告</span>
            <span>{report.projects.length} 个项目</span>
          </div>
          <div className="space-y-1.5">
            {report.projects.map(project => (
              <div key={project.projectPath || project.projectLabel} className="rounded-md border border-border-subtle bg-bg-elevated/60 px-2 py-1.5">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-primary" title={project.projectPath || project.projectLabel}>
                      {project.projectLabel}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-text-muted">
                      最近 {formatHistoryActivity(project.lastActivityAt)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-semibold text-text-primary">{project.eventCount}</div>
                    <div className="text-[9px] text-text-muted">事件</div>
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px]">
                  <span className="rounded bg-accent-green/10 px-1.5 py-1 text-accent-green">
                    闭环 {formatMetricPercent(project.promotionRate)}
                  </span>
                  <span className="rounded bg-accent-blue/10 px-1.5 py-1 text-accent-blue">
                    Playbook {project.playbookInjectionCount}
                  </span>
                  <span className="rounded bg-accent-yellow/10 px-1.5 py-1 text-accent-yellow">
                    旧知识 {project.staleResolutionCount}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentGovernancePanel({ summary }: { summary: AgentGovernanceSummary }) {
  if (summary.totalCount === 0) return null

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/65 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <Users className="h-3.5 w-3.5 text-accent-purple" />
          Agent 交付治理
        </div>
        <span className="text-[10px] text-text-muted">
          {summary.parentSessionCount} 个会话 / {summary.totalCount} 个 Agent
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SuccessMetricCard
          icon={Users}
          label="执行中"
          value={String(summary.activeCount)}
          detail="pending/running 子任务"
          tone={summary.activeCount > 0 ? 'warn' : 'neutral'}
        />
        <SuccessMetricCard
          icon={CheckCircle}
          label="完成率"
          value={formatMetricPercent(summary.completionRate)}
          detail={`${summary.completedCount} 已完成 / ${summary.totalCount} 总数`}
          tone={summary.completionRate >= 70 ? 'good' : summary.completedCount > 0 ? 'warn' : 'neutral'}
        />
        <SuccessMetricCard
          icon={AlertCircle}
          label="阻塞率"
          value={formatMetricPercent(summary.blockedRate)}
          detail={`${summary.blockedCount} 失败或取消`}
          tone={summary.blockedCount > 0 ? 'bad' : 'good'}
        />
        <SuccessMetricCard
          icon={BarChart3}
          label="治理样本"
          value={String(summary.parentSessionCount)}
          detail="存在可见子 Agent 的父会话"
          tone={summary.parentSessionCount > 0 ? 'good' : 'neutral'}
        />
      </div>
    </div>
  )
}

function getLifecycleSummaryText(summary: DeliveryMetricActionLifecycleSummary): string {
  if (summary.active > 0) return `${summary.active} 项处理中`
  if (summary.completed > 0) return `已闭环 ${summary.completed} 项`
  if (summary.abandoned > 0) return `${summary.abandoned} 项已放弃`
  return '按风险和分数排序'
}

function ActionQueue({ items, freshness, lifecycleSummary, onOpenAction }: {
  items: DeliveryMetricActionItem[]
  freshness: DeliveryMetricFreshness
  lifecycleSummary: DeliveryMetricActionLifecycleSummary
  onOpenAction: (item: DeliveryMetricActionItem) => void
}) {
  if (items.length === 0) {
    if (freshness.state !== 'fresh') return null

    return (
      <div className="rounded-lg border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-text-secondary">
        当前没有明显改进项，继续保持交付包、验证证据和项目记忆闭环。
        {lifecycleSummary.completed > 0 && (
          <span className="ml-1 text-accent-green">已闭环 {lifecycleSummary.completed} 个队列动作。</span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated/70 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <AlertCircle className="h-3.5 w-3.5 text-accent-yellow" />
          改进队列
        </div>
        <span className="text-[10px] text-text-muted">{getLifecycleSummaryText(lifecycleSummary)}</span>
      </div>
      <div className="grid gap-1.5 lg:grid-cols-2">
        {items.map(item => (
          <button
            key={item.sessionId}
            type="button"
            onClick={() => onOpenAction(item)}
            className="min-w-0 rounded-md border border-border-subtle bg-bg-primary/70 px-2.5 py-2 text-left transition-colors hover:border-accent-blue/35 hover:bg-bg-hover"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-text-primary" title={item.projectName}>
                  {item.projectName}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-text-muted" title={item.detail}>
                  {item.detail}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${ACTION_PRIORITY_CLASS[item.priority]}`}>
                  {ACTION_PRIORITY_LABEL[item.priority]}
                </span>
                <span className="rounded-md bg-bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
                  {item.score}
                </span>
              </div>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px]">
              <span className="shrink-0 font-medium text-text-secondary">{item.reason}</span>
              <span className="truncate text-text-muted" title={item.suggestedAction}>
                {item.suggestedAction}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
