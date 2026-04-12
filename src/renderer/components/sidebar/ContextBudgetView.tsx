/**
 * 上下文预算面板 - 实时监控会话上下文使用量
 * 支持：容量监控、压缩建议、配置管理
 */
import { useState, useEffect } from 'react'
import {
  Brain, Settings, AlertTriangle, Zap, ArrowRightLeft,
  Loader2, ChevronDown, ChevronUp, Gauge
} from 'lucide-react'
import { useContextBudgetStore } from '../../stores/contextBudgetStore'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

// ── 使用量仪表盘 ──
function UsageGauge({ used, max, level }: { used: number; max: number; level: string }) {
  const percent = Math.min(used / max, 1)
  const circumference = 2 * Math.PI * 40
  const strokeDashoffset = circumference * (1 - percent)

  const colorMap: Record<string, string> = {
    normal: 'text-accent-green',
    warning: 'text-accent-yellow',
    critical: 'text-accent-red',
  }
  const strokeColorMap: Record<string, string> = {
    normal: '#10b981',
    warning: '#f59e0b',
    critical: '#ef4444',
  }

  return (
    <div className="flex items-center justify-center py-3">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="6" className="text-bg-tertiary" />
          <circle
            cx="48" cy="48" r="40" fill="none"
            stroke={strokeColorMap[level] || strokeColorMap.normal}
            strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-bold ${colorMap[level] || colorMap.normal}`}>
            {formatPercent(percent)}
          </span>
          <span className="text-[9px] text-text-muted">已使用</span>
        </div>
      </div>
    </div>
  )
}

// ── 消息列表 ──
function MessageList({ messages }: { messages: { role: string; tokens: number; summary: string }[] }) {
  const [expanded, setExpanded] = useState(false)
  if (messages.length === 0) return null

  const displayMessages = expanded ? messages : messages.slice(0, 3)

  const roleLabels: Record<string, string> = {
    user: '用户',
    assistant: 'AI',
    system: '系统',
    tool: '工具',
  }

  const roleColors: Record<string, string> = {
    user: 'text-accent-blue',
    assistant: 'text-accent-green',
    system: 'text-accent-yellow',
    tool: 'text-accent-purple',
  }

  return (
    <div>
      <div className="text-[10px] text-text-muted mb-1.5">最近消息</div>
      <div className="space-y-1">
        {displayMessages.map((msg, idx) => (
          <div key={idx} className="flex items-start gap-1.5 text-[10px]">
            <span className={`font-medium flex-shrink-0 ${roleColors[msg.role] || 'text-text-muted'}`}>
              {roleLabels[msg.role] || msg.role}
            </span>
            <span className="text-text-muted flex-shrink-0">{formatTokens(msg.tokens)}</span>
            <span className="text-text-secondary truncate">{msg.summary}</span>
          </div>
        ))}
      </div>
      {messages.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-0.5 text-[9px] text-accent-blue hover:text-accent-blue/80 mt-1"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? '收起' : `还有 ${messages.length - 3} 条`}
        </button>
      )}
    </div>
  )
}

// ── 设置面板 ──
function SettingsPanel() {
  const { config, updateConfig } = useContextBudgetStore()

  if (!config) return null

  return (
    <div className="p-3 space-y-4">
      <div>
        <div className="text-xs font-medium text-text-primary mb-1">上下文窗口大小</div>
        <div className="text-[10px] text-text-muted mb-2">模型的最大上下文长度</div>
        <select
          value={config.maxContextTokens}
          onChange={e => updateConfig({ maxContextTokens: Number(e.target.value) })}
          className="w-full text-xs bg-bg-tertiary border border-border rounded px-2 py-1.5 text-text-primary"
        >
          <option value={128000}>128K</option>
          <option value={200000}>200K</option>
          <option value={256000}>256K</option>
          <option value={500000}>500K</option>
          <option value={1000000}>1M</option>
        </select>
      </div>

      <div>
        <div className="text-xs font-medium text-text-primary mb-1">警告阈值</div>
        <div className="text-[10px] text-text-muted mb-2">使用量超过此比例时显示警告</div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.5}
            max={0.9}
            step={0.05}
            value={config.warningThreshold}
            onChange={e => updateConfig({ warningThreshold: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="text-[10px] text-text-muted w-10 text-right">{formatPercent(config.warningThreshold)}</span>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-text-primary mb-1">危险阈值</div>
        <div className="text-[10px] text-text-muted mb-2">使用量超过此比例时显示严重警告</div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.7}
            max={0.98}
            step={0.05}
            value={config.criticalThreshold}
            onChange={e => updateConfig({ criticalThreshold: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="text-[10px] text-text-muted w-10 text-right">{formatPercent(config.criticalThreshold)}</span>
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-text-primary mb-1">自动压缩阈值</div>
        <div className="text-[10px] text-text-muted mb-2">使用量超过此比例时自动压缩上下文</div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.7}
            max={0.95}
            step={0.05}
            value={config.autoCompressAt}
            onChange={e => updateConfig({ autoCompressAt: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="text-[10px] text-text-muted w-10 text-right">{formatPercent(config.autoCompressAt)}</span>
        </div>
      </div>
    </div>
  )
}

// ── 主组件 ──
export default function ContextBudgetView() {
  const { budget, config, loading, activeTab, fetchBudget, fetchConfig, compress, migrate, setActiveTab } = useContextBudgetStore()
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  // 获取当前活跃会话 ID
  useEffect(() => {
    const sessionId = (window as any).spectrAI?.sessions?.getActive?.() ||
      localStorage.getItem('active-session-id') || null
    setCurrentSessionId(sessionId)
  }, [])

  useEffect(() => {
    if (currentSessionId) {
      fetchBudget(currentSessionId)
    }
    fetchConfig()
  }, [currentSessionId])

  // 自动刷新（每30秒）
  useEffect(() => {
    const timer = setInterval(() => {
      if (currentSessionId) fetchBudget(currentSessionId)
    }, 30000)
    return () => clearInterval(timer)
  }, [currentSessionId])

  const handleCompress = async () => {
    if (!currentSessionId) return
    await compress(currentSessionId)
    setTimeout(() => fetchBudget(currentSessionId), 1000)
  }

  const handleMigrate = async () => {
    if (!currentSessionId) return
    await migrate(currentSessionId)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Gauge className="w-4 h-4 text-accent-cyan" />
          上下文预算
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border">
        {[
          { key: 'monitor' as const, icon: Gauge, label: '监控' },
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
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'monitor' && (
          loading ? (
            <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
            </div>
          ) : !budget ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Gauge className="w-7 h-7 mb-3 opacity-30" />
              <p className="text-sm mb-1">未选择会话</p>
              <p className="text-[10px]">选择一个活跃会话查看上下文使用情况</p>
            </div>
          ) : (
            <div className="p-3 space-y-4">
              {/* 仪表盘 */}
              <UsageGauge used={budget.usedTokens} max={budget.maxTokens} level={budget.level} />

              {/* 统计卡片 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="px-2.5 py-2 rounded bg-bg-secondary border border-border">
                  <div className="text-[9px] text-text-muted">已使用</div>
                  <div className="text-sm font-medium text-text-primary">{formatTokens(budget.usedTokens)}</div>
                </div>
                <div className="px-2.5 py-2 rounded bg-bg-secondary border border-border">
                  <div className="text-[9px] text-text-muted">总容量</div>
                  <div className="text-sm font-medium text-text-primary">{formatTokens(budget.maxTokens)}</div>
                </div>
                <div className="px-2.5 py-2 rounded bg-bg-secondary border border-border">
                  <div className="text-[9px] text-text-muted">消息数</div>
                  <div className="text-sm font-medium text-text-primary">{budget.messageCount}</div>
                </div>
                <div className="px-2.5 py-2 rounded bg-bg-secondary border border-border">
                  <div className="text-[9px] text-text-muted">可压缩</div>
                  <div className="text-sm font-medium text-text-primary">{budget.canCompress ? `${formatTokens(budget.compressionSavings)}` : '-'}</div>
                </div>
              </div>

              {/* 状态提示 */}
              {budget.level === 'warning' && (
                <div className="flex items-center gap-2 px-3 py-2 rounded bg-accent-yellow/10 border border-accent-yellow/20">
                  <AlertTriangle className="w-4 h-4 text-accent-yellow flex-shrink-0" />
                  <div>
                    <div className="text-[10px] font-medium text-accent-yellow">上下文使用量较高</div>
                    <div className="text-[9px] text-accent-yellow/70">已使用 {formatPercent(budget.usagePercent)}，建议压缩以节省空间</div>
                  </div>
                </div>
              )}
              {budget.level === 'critical' && (
                <div className="flex items-center gap-2 px-3 py-2 rounded bg-accent-red/10 border border-accent-red/20">
                  <AlertTriangle className="w-4 h-4 text-accent-red flex-shrink-0" />
                  <div>
                    <div className="text-[10px] font-medium text-accent-red">上下文即将用尽</div>
                    <div className="text-[9px] text-accent-red/70">已使用 {formatPercent(budget.usagePercent)}，请立即压缩或迁移会话</div>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              {budget.canCompress && (
                <div className="flex gap-2">
                  <button
                    onClick={handleCompress}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" /> 压缩上下文
                  </button>
                  <button
                    onClick={handleMigrate}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" /> 迁移到新会话
                  </button>
                </div>
              )}

              {/* 消息列表 */}
              <MessageList messages={budget.messages} />

              {/* 容量条 */}
              <div>
                <div className="text-[10px] text-text-muted mb-1">容量分布</div>
                <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      budget.level === 'critical' ? 'bg-accent-red' :
                      budget.level === 'warning' ? 'bg-accent-yellow' :
                      'bg-accent-green'
                    }`}
                    style={{ width: `${Math.min(budget.usagePercent * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-text-muted mt-0.5">
                  <span>0</span>
                  <span>{formatTokens(budget.maxTokens)}</span>
                </div>
              </div>
            </div>
          )
        )}

        {activeTab === 'settings' && <SettingsPanel />}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        监控上下文窗口使用量，防止超限
      </div>
    </div>
  )
}
