/**
 * Dashboard 全局概览视图 - 会话卡片 + 统计 + 活动流 + 用量图表
 * @author weibin
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Activity, Zap, Clock, Monitor, CheckCircle, AlertCircle,
  PlayCircle, PauseCircle, Terminal
} from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { STATUS_COLORS, STATUS_LABELS } from '../../../shared/constants'
import type { Session, SessionStatus, ActivityEvent } from '../../../shared/types'
import UsageDashboard from '../usage/UsageDashboard'
import {
  DELIVERY_METRICS_EVENT,
  formatMetricDuration,
  formatMetricPercent,
  loadDeliveryMetricSnapshots,
  summarizeDeliveryMetrics,
  type DeliveryMetricSnapshotRecord,
} from '../../utils/deliveryMetrics'

function formatDuration(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
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
  const { sessions, selectSession, activities } = useSessionStore()
  const [recentEvents, setRecentEvents] = useState<(ActivityEvent & { sessionName: string })[]>([])
  const [deliveryRecords, setDeliveryRecords] = useState<DeliveryMetricSnapshotRecord[]>(() => loadDeliveryMetricSnapshots())
  const [, setTick] = useState(0)

  // 分类
  const runningSessions = sessions.filter(s => s.status === 'running')
  const waitingSessions = sessions.filter(s => s.status === 'waiting_input' || s.status === 'idle')
  const errorSessions = sessions.filter(s => s.status === 'error')
  const completedSessions = sessions.filter(s => s.status === 'completed')
  const activeSessions = sessions.filter(s =>
    s.status !== 'completed' && s.status !== 'terminated' && s.status !== 'interrupted'
  )
  const successSummary = useMemo(() => summarizeDeliveryMetrics(deliveryRecords), [deliveryRecords])

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
    const refreshMetrics = () => setDeliveryRecords(loadDeliveryMetricSnapshots())
    refreshMetrics()
    window.addEventListener(DELIVERY_METRICS_EVENT, refreshMetrics)
    window.addEventListener('storage', refreshMetrics)
    return () => {
      window.removeEventListener(DELIVERY_METRICS_EVENT, refreshMetrics)
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
