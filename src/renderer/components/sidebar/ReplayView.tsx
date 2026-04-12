/**
 * 会话录像面板 - 录制和回放 AI 会话过程
 * 支持：录像列表、事件回放、导出、自动录制设置
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Video, Play, Pause, Circle, Square, Download, Trash2, Clock,
  Loader2, Settings, List, ChevronRight, ChevronLeft, Wrench,
  MessageSquare, FileCode, Terminal, Shield, Zap, SkipBack, SkipForward
} from 'lucide-react'
import { useReplayStore } from '../../stores/replayStore'

interface ReplayEvent {
  type: string
  timestamp: number
  sessionId: string
  data: any
}

const EVENT_ICONS: Record<string, any> = {
  message: MessageSquare,
  tool_use: Wrench,
  file_change: FileCode,
  terminal_output: Terminal,
  permission: Shield,
  checkpoint: Zap,
  status_change: Circle,
  usage: Clock,
}

const EVENT_COLORS: Record<string, string> = {
  message: 'text-accent-blue',
  tool_use: 'text-accent-purple',
  file_change: 'text-accent-green',
  terminal_output: 'text-text-muted',
  permission: 'text-accent-yellow',
  checkpoint: 'text-accent-orange',
  status_change: 'text-text-muted',
  usage: 'text-accent-cyan',
}

const EVENT_LABELS: Record<string, string> = {
  message: '消息',
  tool_use: '工具调用',
  file_change: '文件变更',
  terminal_output: '终端输出',
  permission: '权限请求',
  checkpoint: '回溯点',
  status_change: '状态变化',
  usage: 'Token 用量',
}

function formatDuration(s: number) {
  if (!s) return '0秒'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`
}

function formatTimestamp(ts: number, baseTs: number) {
  const diff = Math.round((ts - baseTs) / 1000)
  const m = Math.floor(diff / 60)
  const sec = diff % 60
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

function getEventSummary(event: ReplayEvent): string {
  const d = event.data
  switch (event.type) {
    case 'message': {
      const role = d.role || d.type || ''
      const content = d.content || ''
      if (typeof content === 'string') return `${role}: ${content.slice(0, 80)}${content.length > 80 ? '…' : ''}`
      return `${role}: [消息]`
    }
    case 'tool_use': {
      const name = d.toolName || d.name || d.activityType || '工具'
      const detail = d.detail || d.filePath || ''
      return `${name}${detail ? ': ' + detail.slice(0, 50) : ''}`
    }
    case 'file_change': {
      const path = d.filePath || d.path || '文件'
      return path.split('/').pop() || path
    }
    case 'permission': return '权限确认请求'
    case 'checkpoint': return '代码回溯点'
    case 'status_change': return `状态 → ${d.status || ''}`
    case 'usage': return `输入: ${d.inputTokens || 0} / 输出: ${d.outputTokens || 0}`
    case 'terminal_output': return (d.output || d.content || '').slice(0, 80)
    default: return JSON.stringify(d).slice(0, 80)
  }
}

// ── 事件查看器/回放器 ──
function EventPlayer({ events, replayDuration }: { events: ReplayEvent[]; replayDuration: number }) {
  const [playing, setPlaying] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [playSpeed, setPlaySpeed] = useState(1)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const baseTs = events.length > 0 ? events[0].timestamp : 0

  const stopPlaying = useCallback(() => {
    setPlaying(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (playing && currentIndex < events.length - 1) {
      const current = events[currentIndex]
      const next = events[currentIndex + 1]
      const delay = Math.max(50, (next.timestamp - current.timestamp) / playSpeed)
      timerRef.current = setTimeout(() => {
        setCurrentIndex(i => i + 1)
      }, Math.min(delay, 3000 / playSpeed))
    } else if (playing && currentIndex >= events.length - 1) {
      stopPlaying()
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [playing, currentIndex, events, playSpeed, stopPlaying])

  const togglePlay = () => {
    if (playing) {
      stopPlaying()
    } else {
      if (currentIndex >= events.length - 1) setCurrentIndex(0)
      setPlaying(true)
    }
  }

  const skipToStart = () => { stopPlaying(); setCurrentIndex(0) }
  const skipToEnd = () => { stopPlaying(); setCurrentIndex(events.length - 1) }

  // 滚动到当前事件
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.children[currentIndex] as HTMLElement
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [currentIndex])

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-text-muted text-xs">
        暂无事件数据
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 控制栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary">
        <button onClick={skipToStart} className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button onClick={togglePlay} className="p-1.5 rounded-full bg-accent-blue text-white hover:bg-accent-blue/80">
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button onClick={skipToEnd} className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary">
          <SkipForward className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] text-text-muted ml-1">
          {currentIndex + 1}/{events.length}
        </span>
        <div className="flex-1" />
        <select
          value={playSpeed}
          onChange={e => setPlaySpeed(Number(e.target.value))}
          className="text-[10px] bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-text-primary"
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={5}>5x</option>
          <option value={10}>10x</option>
        </select>
      </div>

      {/* 进度条 */}
      <div className="h-1 bg-bg-tertiary relative">
        <div
          className="h-full bg-accent-blue transition-all"
          style={{ width: `${((currentIndex + 1) / events.length) * 100}%` }}
        />
        <input
          type="range"
          min={0}
          max={events.length - 1}
          value={currentIndex}
          onChange={e => { stopPlaying(); setCurrentIndex(Number(e.target.value)) }}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>

      {/* 事件列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {events.map((event, idx) => {
          const Icon = EVENT_ICONS[event.type] || Circle
          const color = EVENT_COLORS[event.type] || 'text-text-muted'
          const isCurrent = idx <= currentIndex
          const isHighlight = idx === currentIndex
          return (
            <div
              key={idx}
              className={`flex items-start gap-2 px-3 py-1.5 text-[11px] border-l-2 transition-colors ${
                isHighlight ? 'border-l-accent-blue bg-accent-blue/5' :
                isCurrent ? 'border-l-transparent bg-bg-secondary/50' :
                'border-l-transparent opacity-40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isCurrent ? color : 'text-text-muted'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-text-muted text-[9px] font-mono">
                    {formatTimestamp(event.timestamp, baseTs)}
                  </span>
                  <span className={`text-[9px] font-medium ${isCurrent ? color : 'text-text-muted'}`}>
                    {EVENT_LABELS[event.type] || event.type}
                  </span>
                </div>
                <p className={`truncate ${isCurrent ? 'text-text-primary' : 'text-text-muted'}`}>
                  {getEventSummary(event)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 设置面板 ──
function SettingsPanel() {
  const { settings, updateSettings } = useReplayStore()

  if (!settings) return null

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-text-primary">自动录制</div>
          <div className="text-[10px] text-text-muted">会话启动时自动开始录制</div>
        </div>
        <button
          onClick={() => updateSettings({ autoRecordEnabled: !settings.autoRecordEnabled })}
          className={`w-8 h-4 rounded-full transition-colors ${settings.autoRecordEnabled ? 'bg-accent-blue' : 'bg-bg-tertiary'}`}
        >
          <div className={`w-3 h-3 rounded-full bg-white transition-transform ${settings.autoRecordEnabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div>
        <div className="text-xs font-medium text-text-primary mb-1">最大录制时长</div>
        <div className="text-[10px] text-text-muted mb-2">超过此时长自动停止录制</div>
        <select
          value={settings.maxDuration}
          onChange={e => updateSettings({ maxDuration: Number(e.target.value) })}
          className="w-full text-xs bg-bg-tertiary border border-border rounded px-2 py-1.5 text-text-primary"
        >
          <option value={0}>无限制</option>
          <option value={1800}>30 分钟</option>
          <option value={3600}>1 小时</option>
          <option value={7200}>2 小时</option>
          <option value={14400}>4 小时</option>
        </select>
      </div>

      <div>
        <div className="text-xs font-medium text-text-primary mb-1">录制事件类型</div>
        <div className="space-y-1.5">
          {[
            { key: 'message', label: '消息' },
            { key: 'tool_use', label: '工具调用' },
            { key: 'file_change', label: '文件变更' },
            { key: 'permission', label: '权限请求' },
            { key: 'status_change', label: '状态变化' },
            { key: 'usage', label: 'Token 用量' },
          ].map(item => {
            const checked = settings.captureEvents.includes(item.key)
            return (
              <label key={item.key} className="flex items-center gap-2 text-[11px] text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? settings.captureEvents.filter(e => e !== item.key)
                      : [...settings.captureEvents, item.key]
                    updateSettings({ captureEvents: next })
                  }}
                  className="rounded border-border"
                />
                {item.label}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── 主组件 ──
export default function ReplayView() {
  const {
    replays, currentReplay, currentEvents, settings, loading, activeTab,
    fetchList, deleteReplay, fetchEvents, exportReplay, fetchSettings,
    setCurrentReplay, setActiveTab
  } = useReplayStore()

  const [eventFilter, setEventFilter] = useState<string>('all')

  useEffect(() => {
    fetchList()
    fetchSettings()
  }, [])

  const handleSelectReplay = async (replay: any) => {
    setCurrentReplay(replay)
    await fetchEvents(replay.id)
    setActiveTab('player')
  }

  const handleExport = async (id: string) => {
    const json = await exportReplay(id)
    if (json) {
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `replay-${id}.json`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const filteredEvents = eventFilter === 'all'
    ? currentEvents
    : currentEvents.filter(e => e.type === eventFilter)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Video className="w-4 h-4 text-accent-purple" />
          会话录像
        </div>
        {activeTab !== 'list' && (
          <button
            onClick={() => { setActiveTab('list'); setCurrentReplay(null) }}
            className="flex items-center gap-0.5 text-[10px] text-accent-blue hover:text-accent-blue/80"
          >
            <ChevronLeft className="w-3 h-3" /> 返回列表
          </button>
        )}
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border">
        {[
          { key: 'list' as const, icon: List, label: '录像' },
          { key: 'player' as const, icon: Play, label: '回放' },
          { key: 'settings' as const, icon: Settings, label: '设置' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] transition-colors ${
              activeTab === tab.key
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'list' && (
          <div className="h-full overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
              </div>
            ) : replays.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                <Video className="w-7 h-7 mb-3 opacity-30" />
                <p className="text-sm mb-1">暂无录像</p>
                <p className="text-[10px]">开启自动录制后，AI 会话过程将被自动记录</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {replays.map(r => (
                  <div key={r.id} className="px-3 py-2.5 hover:bg-bg-hover transition-colors cursor-pointer"
                    onClick={() => handleSelectReplay(r)}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-text-primary truncate flex-1">
                        {r.sessionName}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] ml-2 ${
                        r.status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
                        r.status === 'recording' ? 'bg-accent-yellow/10 text-accent-yellow animate-pulse' :
                        'bg-bg-tertiary text-text-muted'
                      }`}>
                        {r.status === 'completed' ? '已完成' : r.status === 'recording' ? '录制中' : '已导出'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-text-muted">
                      <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> {formatDuration(r.duration)}</span>
                      <span>{r.eventCount} 事件</span>
                      <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                    {/* 关键时刻预览 */}
                    {r.keyMoments && r.keyMoments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {r.keyMoments.slice(0, 3).map((km, idx) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded text-[9px] bg-bg-tertiary text-text-muted">
                            {km.label}
                          </span>
                        ))}
                        {r.keyMoments.length > 3 && (
                          <span className="text-[9px] text-text-muted">+{r.keyMoments.length - 3}</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleSelectReplay(r)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20"
                      >
                        <Play className="w-3 h-3" /> 回放
                      </button>
                      <button onClick={() => handleExport(r.id)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] bg-bg-tertiary text-text-muted hover:text-text-primary">
                        <Download className="w-3 h-3" /> 导出
                      </button>
                      <button onClick={() => deleteReplay(r.id)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] text-text-muted hover:text-accent-red">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'player' && (
          <div className="flex flex-col h-full">
            {currentReplay ? (
              <>
                {/* 录像信息 */}
                <div className="px-3 py-2 border-b border-border bg-bg-secondary">
                  <div className="text-xs font-medium text-text-primary">{currentReplay.sessionName}</div>
                  <div className="flex items-center gap-3 text-[10px] text-text-muted mt-0.5">
                    <span>{formatDuration(currentReplay.duration)}</span>
                    <span>{currentReplay.eventCount} 事件</span>
                    <span>{new Date(currentReplay.createdAt).toLocaleString()}</span>
                  </div>
                  {/* 事件过滤 */}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <button
                      onClick={() => setEventFilter('all')}
                      className={`px-1.5 py-0.5 rounded text-[9px] ${eventFilter === 'all' ? 'bg-accent-blue/10 text-accent-blue' : 'bg-bg-tertiary text-text-muted'}`}
                    >
                      全部
                    </button>
                    {Object.entries(EVENT_LABELS).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setEventFilter(key)}
                        className={`px-1.5 py-0.5 rounded text-[9px] ${eventFilter === key ? 'bg-accent-blue/10 text-accent-blue' : 'bg-bg-tertiary text-text-muted'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* 事件回放器 */}
                <div className="flex-1 overflow-hidden">
                  <EventPlayer events={filteredEvents} replayDuration={currentReplay.duration} />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <Play className="w-7 h-7 mb-3 opacity-30" />
                <p className="text-sm mb-1">选择录像开始回放</p>
                <p className="text-[10px]">点击左侧列表中的录像查看详情</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && <SettingsPanel />}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        {settings?.autoRecordEnabled ? '自动录制已开启' : '自动录制已关闭'} · {replays.length} 个录像
      </div>
    </div>
  )
}
