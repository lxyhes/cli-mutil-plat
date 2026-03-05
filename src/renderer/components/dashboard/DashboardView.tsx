/**
 * Dashboard 全局概览视图 - 会话卡片 + 统计 + 活动流 + 用量图表
 * @author weibin
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Zap, Clock, Monitor, CheckCircle, AlertCircle,
  PlayCircle, PauseCircle, Terminal, AlertTriangle, Sparkles, RefreshCw
} from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { STATUS_COLORS } from '../../../shared/constants'
import type { Session, SessionStatus, ActivityEvent, BriefingItem } from '../../../shared/types'
import UsageDashboard from '../usage/UsageDashboard'

const STATUS_LABELS: Record<SessionStatus, string> = {
  starting: '启动中',
  running: '运行中',
  idle: '空闲',
  waiting_input: '等待输入',
  paused: '已暂停',
  completed: '已完成',
  error: '出错',
  terminated: '已终止',
  interrupted: '已中断'
}

function formatDuration(startedAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

/** AI 简报组件 */
function AIBriefingPanel() {
  const { briefing, briefingLoading, generateBriefing, selectSession } = useSessionStore()

  useEffect(() => {
    // 首次进入时自动生成一次简报（如果有活跃会话）
    if (briefing.length === 0) {
      generateBriefing()
    }
  }, [])

  if (!briefingLoading && briefing.length === 0) return null

  return (
    <div className="card p-4 bg-gradient-to-br from-bg-secondary to-bg-tertiary border-accent-blue/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent-blue/10">
            <Sparkles className="w-4 h-4 text-accent-blue" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary">AI 智能简报</h3>
          <span className="text-[10px] text-text-muted bg-bg-hover px-1.5 py-0.5 rounded">Beta</span>
        </div>
        <button
          onClick={() => generateBriefing()}
          disabled={briefingLoading}
          className="p-1.5 rounded hover:bg-bg-hover btn-transition text-text-muted hover:text-text-primary disabled:opacity-50"
          title="刷新简报"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${briefingLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {briefingLoading && briefing.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded bg-bg-hover animate-pulse" />
          ))
        ) : (
          briefing.map((item: BriefingItem) => (
            <div
              key={item.sessionId}
              onClick={() => selectSession(item.sessionId)}
              className={`p-3 rounded border cursor-pointer btn-transition ${
                item.priority === 'high'
                  ? 'bg-accent-red/5 border-accent-red/20 hover:border-accent-red/40'
                  : 'bg-bg-hover border-border hover:border-accent-blue/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-text-muted truncate flex-1 uppercase tracking-wider">
                  {item.sessionName}
                </span>
                {item.priority === 'high' && (
                  <AlertTriangle className="w-3 h-3 text-accent-red" />
                )}
              </div>
              <p className="text-xs text-text-primary font-medium leading-snug mb-1">
                {item.summary}
              </p>
              {item.nextStep && (
                <p className="text-[10px] text-text-muted truncate">
                  <span className="text-accent-blue opacity-80">下一步:</span> {item.nextStep}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
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
  const [, setTick] = useState(0)

  // 分类
  const runningSessions = sessions.filter(s => s.status === 'running')
  const waitingSessions = sessions.filter(s => s.status === 'waiting_input' || s.status === 'idle')
  const errorSessions = sessions.filter(s => s.status === 'error')
  const completedSessions = sessions.filter(s => s.status === 'completed')
  const activeSessions = sessions.filter(s =>
    s.status !== 'completed' && s.status !== 'terminated' && s.status !== 'interrupted'
  )

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

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* AI 智能简报 */}
      <AIBriefingPanel />

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
          label="运行中"
          value={runningSessions.length}
          color="#3FB950"
        />
        <StatCard
          icon={PauseCircle}
          label="等待中"
          value={waitingSessions.length}
          color="#D29922"
        />
        <StatCard
          icon={AlertCircle}
          label="异常"
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
