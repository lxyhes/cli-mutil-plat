/**
 * 成本仪表盘面板 - Token 消耗换算为实际金额
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import { DollarSign, TrendingUp, AlertTriangle, PieChart, RefreshCw, Settings2, X } from 'lucide-react'
import { useCostStore, type CostSummary } from '../../stores/costStore'

function StatCard({ label, value, sub, color = 'text-text-primary' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-bg-tertiary/50 rounded-lg p-2.5">
      <div className="text-[9px] text-text-muted mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-text-muted">{sub}</div>}
    </div>
  )
}

function formatCost(usd: number, currency: string = 'CNY'): string {
  if (currency === 'CNY') return `¥${(usd * 7.25).toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export default function CostDashboardView() {
  const store = useCostStore()
  const summary = useCostStore(s => s.summary)
  const budget = useCostStore(s => s.budget)
  const loading = useCostStore(s => s.loading)
  const [showBudget, setShowBudget] = useState(false)
  const [dailyLimit, setDailyLimit] = useState('')

  useEffect(() => {
    store.fetchSummary()
    store.fetchBudget()
  }, [])

  const handleSetBudget = async () => {
    if (dailyLimit) {
      await store.setBudget({ dailyLimit: parseFloat(dailyLimit) })
      setShowBudget(false)
    }
  }

  const budgetWarning = summary && budget?.dailyLimit
    ? (summary.todayCost >= budget.dailyLimit * (budget.alertThreshold || 0.8) ? 'warning' : 'none')
    : 'none'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <DollarSign className="w-4 h-4 text-accent-green" />
          成本仪表盘
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowBudget(!showBudget)} title="预算设置"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => store.fetchSummary()} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Budget Alert */}
      {budgetWarning === 'warning' && (
        <div className="flex items-start gap-2 px-3 py-2 bg-accent-yellow/5 border-b border-accent-yellow/20 text-xs text-accent-yellow">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>今日花费已接近预算上限！</span>
        </div>
      )}

      {/* Budget Settings */}
      {showBudget && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2">
          <div className="text-xs text-text-secondary">设置日预算（美元）</div>
          <div className="flex gap-1">
            <input type="number" value={dailyLimit} onChange={e => setDailyLimit(e.target.value)}
              placeholder="例如: 10" className="flex-1 px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue" />
            <button onClick={handleSetBudget} className="px-2 py-1 bg-accent-blue/15 text-accent-blue rounded text-xs hover:bg-accent-blue/25">保存</button>
          </div>
          {budget?.dailyLimit && <div className="text-[10px] text-text-muted">当前日预算: ${budget.dailyLimit}</div>}
        </div>
      )}

      {/* Stats Grid */}
      {summary && (
        <div className="grid grid-cols-2 gap-2 p-3">
          <StatCard label="今日花费" value={formatCost(summary.todayCost)} sub={`${formatTokens(summary.todayTokens)} tokens`} color="text-accent-green" />
          <StatCard label="本月花费" value={formatCost(summary.monthCost)} sub={`${formatTokens(summary.monthTokens)} tokens`} />
          <StatCard label="累计花费" value={formatCost(summary.totalCost)} sub={`${formatTokens(summary.totalTokens)} tokens`} />
          <StatCard label="活跃 Provider" value={String(summary.byProvider.length)} sub={`${summary.bySession.length} 个会话`} />
        </div>
      )}

      {/* Provider Breakdown */}
      {summary && summary.byProvider.length > 0 && (
        <div className="px-3 pb-3">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">按 Provider 分布</div>
          <div className="space-y-1.5">
            {summary.byProvider.map(p => {
              const pct = summary.totalCost > 0 ? (p.cost / summary.totalCost * 100) : 0
              return (
                <div key={p.providerId}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-text-primary">{p.providerName}</span>
                    <span className="text-text-muted">{formatCost(p.cost)} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="w-full h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                    <div className="h-full bg-accent-blue rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Session Cost List */}
      {summary && summary.bySession.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">会话成本排名</div>
          <div className="space-y-1">
            {summary.bySession.slice(0, 10).map((s, i) => (
              <div key={s.sessionId} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-bg-hover text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-text-muted w-4 text-right shrink-0">{i + 1}</span>
                  <span className="text-text-primary truncate">{s.sessionName}</span>
                </div>
                <span className="text-text-muted shrink-0">{formatCost(s.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!summary && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
          <PieChart className="w-7 h-7 mb-3 opacity-30" />
          <p className="text-sm">暂无成本数据</p>
          <p className="text-[10px]">开始使用 AI 会话后将自动统计</p>
        </div>
      )}

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        费用按各 Provider 官方定价估算，实际以账单为准
      </div>
    </div>
  )
}
