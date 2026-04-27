/**
 * Resource Monitor View - unified cost, usage, and context budget center.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Archive, BarChart3, DollarSign, Gauge,
  RefreshCw, WalletCards, Zap
} from 'lucide-react'
import { useCostStore } from '../../stores/costStore'
import { useContextBudgetStore } from '../../stores/contextBudgetStore'
import { useSessionStore } from '../../stores/sessionStore'
import CostDashboardView from './CostDashboardView'
import ContextBudgetView from './ContextBudgetView'
import UsageDashboard from '../usage/UsageDashboard'

type ResourceTab = 'overview' | 'cost' | 'usage' | 'context'

interface UsageSummary {
  totalTokens: number
  totalMinutes: number
  todayTokens: number
  todayMinutes: number
  activeSessions: number
  sessionBreakdown: Record<string, number>
}

type StrategyTone = 'normal' | 'warning' | 'danger' | 'info'

interface StrategySuggestion {
  id: string
  title: string
  description: string
  tone: StrategyTone
  icon: React.ElementType
  actionLabel?: string
  onAction?: () => void
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatMinutes(m: number): string {
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const min = m % 60
    return min > 0 ? `${h}h ${min}m` : `${h}h`
  }
  return `${m}m`
}

function formatCost(usd: number, currency = 'CNY', cnyRate = 7.25): string {
  if (currency === 'CNY') return `¥${(usd * cnyRate).toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

function percent(value: number): string {
  return `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`
}

function toneForRatio(ratio: number): string {
  if (ratio >= 0.9) return 'text-accent-red'
  if (ratio >= 0.75) return 'text-accent-yellow'
  return 'text-accent-green'
}

function ResourceCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-text-primary',
}: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-primary p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted mb-1">
        <Icon className={`w-3 h-3 ${color}`} />
        <span>{label}</span>
      </div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted truncate">{sub}</div>}
    </div>
  )
}

function ProgressRow({
  label,
  current,
  limit,
  value,
  color,
}: {
  label: string
  current: string
  limit: string
  value: number
  color: string
}) {
  const pct = Math.min(Math.max(value, 0), 1)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted truncate">{current} / {limit}</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  )
}

function StrategyCard({ suggestion }: { suggestion: StrategySuggestion }) {
  const Icon = suggestion.icon
  const toneClass: Record<StrategyTone, string> = {
    normal: 'border-accent-green/20 bg-accent-green/5 text-accent-green',
    warning: 'border-accent-yellow/25 bg-accent-yellow/10 text-accent-yellow',
    danger: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    info: 'border-accent-blue/20 bg-accent-blue/5 text-accent-blue',
  }

  return (
    <div className={`rounded-lg border p-2.5 ${toneClass[suggestion.tone]}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">{suggestion.title}</div>
          <div className="mt-1 text-[10px] leading-4 text-text-muted">{suggestion.description}</div>
          {suggestion.actionLabel && suggestion.onAction && (
            <button
              type="button"
              onClick={suggestion.onAction}
              className="mt-2 rounded border border-current/20 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-current/10"
            >
              {suggestion.actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResourceMonitorView() {
  const [activeTab, setActiveTab] = useState<ResourceTab>('overview')
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)

  const selectedSessionId = useSessionStore(s => s.selectedSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const costSummary = useCostStore(s => s.summary)
  const costBudget = useCostStore(s => s.budget)
  const costLoading = useCostStore(s => s.loading)
  const fetchCostSummary = useCostStore(s => s.fetchSummary)
  const fetchCostHistory = useCostStore(s => s.fetchHistory)
  const fetchCostBudget = useCostStore(s => s.fetchBudget)

  const contextBudget = useContextBudgetStore(s => s.budget)
  const contextConfig = useContextBudgetStore(s => s.config)
  const contextLoading = useContextBudgetStore(s => s.loading)
  const fetchContextBudget = useContextBudgetStore(s => s.fetchBudget)
  const fetchContextConfig = useContextBudgetStore(s => s.fetchConfig)

  const fetchUsage = useCallback(async () => {
    if (!window.spectrAI?.usage) return
    setUsageLoading(true)
    try {
      const summary = await window.spectrAI.usage.getSummary()
      setUsageSummary(summary)
    } catch {
      // usage data is best-effort in this overview
    } finally {
      setUsageLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([
      fetchCostSummary(),
      fetchCostHistory(14),
      fetchCostBudget(),
      fetchUsage(),
      fetchContextConfig(),
      selectedSessionId ? fetchContextBudget(selectedSessionId) : Promise.resolve(),
    ])
  }, [
    fetchCostSummary,
    fetchCostHistory,
    fetchCostBudget,
    fetchUsage,
    fetchContextConfig,
    fetchContextBudget,
    selectedSessionId,
  ])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh])

  const currency = costBudget?.currency ?? 'CNY'
  const cnyRate = costBudget?.cnyRate ?? 7.25

  const contextRatio = contextBudget?.usagePercent ?? 0
  const dailyRatio = costBudget?.dailyLimit ? (costSummary?.todayCost ?? 0) / costBudget.dailyLimit : null
  const monthlyRatio = costBudget?.monthlyLimit ? (costSummary?.monthCost ?? 0) / costBudget.monthlyLimit : null
  const isLoading = costLoading || contextLoading || usageLoading

  const topProviders = useMemo(
    () => (costSummary?.byProvider ?? []).slice(0, 3),
    [costSummary?.byProvider]
  )

  const inactiveSessionCount = useMemo(() => sessions.filter(session => (
    ['completed', 'terminated', 'error', 'interrupted'].includes(session.status) ||
    (session.estimatedTokens >= 30_000 && !['starting', 'running', 'waiting_input'].includes(session.status))
  )).length, [sessions])

  const strategySuggestions = useMemo<StrategySuggestion[]>(() => {
    const suggestions: StrategySuggestion[] = []
    const alertThreshold = costBudget?.alertThreshold ?? 0.8
    const costRatio = Math.max(dailyRatio ?? 0, monthlyRatio ?? 0)

    if (costRatio >= alertThreshold) {
      suggestions.push({
        id: 'cost-model-switch',
        title: costRatio >= 1 ? '预算已超，后续任务切换低成本模型' : '预算接近上限，建议切换低成本模型',
        description: '新会话优先使用 gpt-5.4 low、codex-mini-latest、Gemini Flash 或 Qwen Coder；把高推理模型留给架构设计、复杂修复和最终审查。',
        tone: costRatio >= 1 ? 'danger' : 'warning',
        icon: DollarSign,
        actionLabel: '查看成本设置',
        onAction: () => setActiveTab('cost'),
      })
    }

    const warningThreshold = contextConfig?.warningThreshold ?? 0.7
    const criticalThreshold = contextConfig?.criticalThreshold ?? 0.9
    if (selectedSessionId && contextRatio >= warningThreshold) {
      suggestions.push({
        id: 'context-compress',
        title: contextRatio >= criticalThreshold ? '上下文快满，请迁移或压缩' : '上下文偏高，建议先压缩',
        description: contextRatio >= criticalThreshold
          ? '当前会话继续堆上下文容易丢失早期约束。建议压缩后继续，或迁移到新会话保留关键上下文。'
          : '当前会话已进入高水位。先压缩会话，再继续长任务，可以减少响应变慢和遗忘风险。',
        tone: contextRatio >= criticalThreshold ? 'danger' : 'warning',
        icon: Gauge,
        actionLabel: '处理上下文',
        onAction: () => setActiveTab('context'),
      })
    }

    if (inactiveSessionCount > 0) {
      suggestions.push({
        id: 'archive-low-value',
        title: '建议归档低价值会话',
        description: `发现 ${inactiveSessionCount} 个已结束、异常中断或高 token 空闲会话。建议保留关键结论到知识中心，然后归档，避免侧边栏和资源统计被旧会话干扰。`,
        tone: 'info',
        icon: Archive,
        actionLabel: '查看用量',
        onAction: () => setActiveTab('usage'),
      })
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: 'healthy',
        title: '资源状态健康',
        description: '当前没有明显的预算或上下文风险。继续保持：短任务用轻量模型，复杂任务再切到高推理模型。',
        tone: 'normal',
        icon: Zap,
      })
    }

    return suggestions
  }, [costBudget?.alertThreshold, contextConfig?.criticalThreshold, contextConfig?.warningThreshold, contextRatio, dailyRatio, inactiveSessionCount, monthlyRatio, selectedSessionId])

  const tabs: Array<{ id: ResourceTab; label: string; icon: React.ElementType }> = [
    { id: 'overview', label: '总览', icon: Activity },
    { id: 'cost', label: '成本', icon: DollarSign },
    { id: 'usage', label: '用量', icon: BarChart3 },
    { id: 'context', label: '上下文', icon: Gauge },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Activity className="w-4 h-4 text-accent-cyan" />
          资源监控
        </div>
        <button
          onClick={refresh}
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="刷新"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-4 border-b border-border shrink-0">
        {tabs.map(tab => {
          const Icon = tab.icon
          const selected = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-center gap-1 px-1.5 py-2 text-[10px] transition-colors ${
                selected
                  ? 'text-accent-blue border-b-2 border-accent-blue'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon className="w-3 h-3" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview' && (
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <ResourceCard
                icon={DollarSign}
                label="今日成本"
                value={formatCost(costSummary?.todayCost ?? 0, currency, cnyRate)}
                sub={`${formatTokens(costSummary?.todayTokens ?? usageSummary?.todayTokens ?? 0)} tokens`}
                color="text-accent-green"
              />
              <ResourceCard
                icon={WalletCards}
                label="本月成本"
                value={formatCost(costSummary?.monthCost ?? 0, currency, cnyRate)}
                sub={`${formatTokens(costSummary?.monthTokens ?? 0)} tokens`}
                color="text-accent-blue"
              />
              <ResourceCard
                icon={Zap}
                label="今日用量"
                value={formatTokens(usageSummary?.todayTokens ?? costSummary?.todayTokens ?? 0)}
                sub={formatMinutes(usageSummary?.todayMinutes ?? 0)}
                color="text-accent-yellow"
              />
              <ResourceCard
                icon={Gauge}
                label="上下文"
                value={selectedSessionId ? percent(contextRatio) : '未选会话'}
                sub={selectedSessionId ? `${formatTokens(contextBudget?.usedTokens ?? 0)} / ${formatTokens(contextBudget?.maxTokens ?? contextConfig?.maxContextTokens ?? 0)}` : '选择会话后显示'}
                color={selectedSessionId ? toneForRatio(contextRatio) : 'text-text-muted'}
              />
            </div>

            {(dailyRatio != null || monthlyRatio != null || selectedSessionId) && (
              <div className="rounded-lg border border-border bg-bg-primary p-3 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                  <AlertTriangle className="w-3.5 h-3.5 text-accent-yellow" />
                  预算水位
                </div>
                {dailyRatio != null && costBudget?.dailyLimit && (
                  <ProgressRow
                    label="日预算"
                    current={formatCost(costSummary?.todayCost ?? 0, currency, cnyRate)}
                    limit={formatCost(costBudget.dailyLimit, currency, cnyRate)}
                    value={dailyRatio}
                    color={dailyRatio >= (costBudget.alertThreshold ?? 0.8) ? 'bg-accent-yellow' : 'bg-accent-green'}
                  />
                )}
                {monthlyRatio != null && costBudget?.monthlyLimit && (
                  <ProgressRow
                    label="月预算"
                    current={formatCost(costSummary?.monthCost ?? 0, currency, cnyRate)}
                    limit={formatCost(costBudget.monthlyLimit, currency, cnyRate)}
                    value={monthlyRatio}
                    color={monthlyRatio >= (costBudget.alertThreshold ?? 0.8) ? 'bg-accent-yellow' : 'bg-accent-blue'}
                  />
                )}
                {selectedSessionId && (
                  <ProgressRow
                    label="当前会话上下文"
                    current={formatTokens(contextBudget?.usedTokens ?? 0)}
                    limit={formatTokens(contextBudget?.maxTokens ?? contextConfig?.maxContextTokens ?? 0)}
                    value={contextRatio}
                    color={contextRatio >= (contextConfig?.criticalThreshold ?? 0.9) ? 'bg-accent-red' : contextRatio >= (contextConfig?.warningThreshold ?? 0.75) ? 'bg-accent-yellow' : 'bg-accent-cyan'}
                  />
                )}
              </div>
            )}

            <div className="rounded-lg border border-border bg-bg-primary p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                  <Zap className="h-3.5 w-3.5 text-accent-yellow" />
                  策略建议
                </div>
                <div className="text-[10px] text-text-muted">{strategySuggestions.length} 条</div>
              </div>
              <div className="space-y-2">
                {strategySuggestions.map(suggestion => (
                  <StrategyCard key={suggestion.id} suggestion={suggestion} />
                ))}
              </div>
            </div>

            {topProviders.length > 0 && (
              <div className="rounded-lg border border-border bg-bg-primary p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-text-secondary">Provider 成本</div>
                  <div className="text-[10px] text-text-muted">Top {topProviders.length}</div>
                </div>
                <div className="space-y-2">
                  {topProviders.map(provider => {
                    const ratio = costSummary?.totalCost ? provider.cost / costSummary.totalCost : 0
                    return (
                      <div key={provider.providerId} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-text-secondary truncate">{provider.providerName}</span>
                          <span className="text-text-muted shrink-0">{formatCost(provider.cost, currency, cnyRate)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-bg-tertiary overflow-hidden">
                          <div className="h-full rounded-full bg-accent-green" style={{ width: `${Math.max(ratio * 100, 4)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!costSummary && !usageSummary && !contextBudget && (
              <div className="text-center text-text-muted text-xs py-8">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                暂无资源数据
              </div>
            )}
          </div>
        )}

        {activeTab === 'cost' && <CostDashboardView />}
        {activeTab === 'usage' && <div className="p-3"><UsageDashboard /></div>}
        {activeTab === 'context' && <ContextBudgetView />}
      </div>
    </div>
  )
}
