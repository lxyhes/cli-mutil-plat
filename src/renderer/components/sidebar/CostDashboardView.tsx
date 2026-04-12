/**
 * 成本仪表盘面板 - Token 消耗换算为实际金额
 * 功能：概览统计、成本趋势图、预算设置、定价管理
 * @author spectrai
 */
import { useState, useEffect, useCallback } from 'react'
import {
  DollarSign, TrendingUp, AlertTriangle, PieChart, RefreshCw,
  Settings2, ChevronLeft, Calendar, Coins, Globe, Edit3, Check, X
} from 'lucide-react'
import { useCostStore, type CostSummary, type CostHistoryPoint, type BudgetConfig, type PricingTier } from '../../stores/costStore'

/* ─── 工具函数 ─── */

function formatCost(usd: number, currency: string = 'CNY', cnyRate: number = 7.25): string {
  if (currency === 'CNY') return `¥${(usd * cnyRate).toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/* ─── 子组件 ─── */

function StatCard({ label, value, sub, color = 'text-text-primary', icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: any
}) {
  return (
    <div className="bg-bg-tertiary/50 rounded-lg p-2.5">
      <div className="flex items-center gap-1 text-[9px] text-text-muted mb-0.5">
        {Icon && <Icon className="w-2.5 h-2.5" />}
        {label}
      </div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-text-muted">{sub}</div>}
    </div>
  )
}

/** 成本趋势迷你柱状图（纯 CSS） */
function CostChart({ data, currency, cnyRate }: { data: CostHistoryPoint[]; currency: string; cnyRate: number }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-text-muted text-xs">
        暂无历史数据
      </div>
    )
  }

  const maxCost = Math.max(...data.map(d => d.cost), 0.01)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex items-end gap-[3px] h-24 px-1">
      {data.map((d, i) => {
        const heightPct = maxCost > 0 ? (d.cost / maxCost * 100) : 0
        const isToday = d.date === today
        const isWeekend = [0, 6].includes(new Date(d.date).getDay())
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center group relative" style={{ minWidth: 0 }}>
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-bg-secondary border border-border rounded px-2 py-1 text-[9px] whitespace-nowrap shadow-lg">
              <div className="text-text-primary font-medium">{formatDate(d.date)}</div>
              <div className="text-accent-green">{formatCost(d.cost, currency, cnyRate)}</div>
              <div className="text-text-muted">{formatTokens(d.tokens)} tokens</div>
            </div>
            <div
              className={`w-full rounded-t-sm transition-all ${isToday ? 'bg-accent-blue' : isWeekend ? 'bg-accent-green/40' : 'bg-accent-green/70'}`}
              style={{ height: `${Math.max(heightPct, 2)}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** 预算进度条 */
function BudgetProgress({ current, limit, label, currency, cnyRate, threshold = 0.8 }: {
  current: number; limit: number | null; label: string; currency: string; cnyRate: number; threshold?: number
}) {
  if (!limit) return null
  const pct = Math.min((current / limit) * 100, 100)
  const isWarning = current >= limit * threshold
  const isDanger = current >= limit
  const barColor = isDanger ? 'bg-accent-red' : isWarning ? 'bg-accent-yellow' : 'bg-accent-green'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">
          {formatCost(current, currency, cnyRate)} / {formatCost(limit, currency, cnyRate)}
        </span>
      </div>
      <div className="w-full h-2 bg-bg-tertiary rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[9px] text-text-muted text-right">{pct.toFixed(0)}%</div>
    </div>
  )
}

/** 定价编辑行 */
function PricingRow({ tier, onSave }: { tier: PricingTier; onSave: (t: PricingTier) => void }) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(String(tier.inputPricePer1M))
  const [output, setOutput] = useState(String(tier.outputPricePer1M))

  const handleSave = () => {
    onSave({ ...tier, inputPricePer1M: parseFloat(input) || 0, outputPricePer1M: parseFloat(output) || 0 })
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-bg-hover text-xs group">
        <div className="min-w-0">
          <div className="text-text-primary truncate">{tier.providerName}</div>
          <div className="text-[9px] text-text-muted">{tier.modelName}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-text-muted text-[10px]">${tier.inputPricePer1M}/${tier.outputPricePer1M}</span>
          <button onClick={() => setEditing(true)}
            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            <Edit3 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-2 py-1.5 bg-bg-tertiary/50 rounded space-y-1">
      <div className="text-[10px] text-text-secondary">{tier.providerName} - {tier.modelName}</div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-text-muted w-8">输入$</span>
        <input type="number" step="0.01" value={input} onChange={e => setInput(e.target.value)}
          className="flex-1 px-1 py-0.5 bg-bg-secondary border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent-blue" />
        <span className="text-[9px] text-text-muted w-8">输出$</span>
        <input type="number" step="0.01" value={output} onChange={e => setOutput(e.target.value)}
          className="flex-1 px-1 py-0.5 bg-bg-secondary border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent-blue" />
        <button onClick={handleSave} className="p-0.5 text-accent-green hover:text-accent-green/80">
          <Check className="w-3 h-3" />
        </button>
        <button onClick={() => setEditing(false)} className="p-0.5 text-text-muted hover:text-text-primary">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="text-[8px] text-text-muted">每百万 Token 价格（美元）</div>
    </div>
  )
}

/* ─── 主面板 ─── */

export default function CostDashboardView() {
  const store = useCostStore()
  const summary = useCostStore(s => s.summary)
  const history = useCostStore(s => s.history)
  const budget = useCostStore(s => s.budget)
  const pricing = useCostStore(s => s.pricing)
  const loading = useCostStore(s => s.loading)
  const activeTab = useCostStore(s => s.activeTab)

  const currency = budget?.currency || 'CNY'
  const cnyRate = budget?.cnyRate || 7.25

  // 设置表单
  const [dailyLimit, setDailyLimit] = useState('')
  const [monthlyLimit, setMonthlyLimit] = useState('')
  const [cnyRateInput, setCnyRateInput] = useState('')
  const [historyDays, setHistoryDays] = useState(30)

  useEffect(() => {
    store.fetchSummary()
    store.fetchBudget()
    store.fetchPricing()
    store.fetchHistory(30)
  }, [])

  useEffect(() => {
    if (budget) {
      setDailyLimit(budget.dailyLimit != null ? String(budget.dailyLimit) : '')
      setMonthlyLimit(budget.monthlyLimit != null ? String(budget.monthlyLimit) : '')
      setCnyRateInput(String(budget.cnyRate))
    }
  }, [budget])

  const handleSetBudget = async () => {
    const updates: Partial<BudgetConfig> = {}
    if (dailyLimit) updates.dailyLimit = parseFloat(dailyLimit)
    if (monthlyLimit) updates.monthlyLimit = parseFloat(monthlyLimit)
    if (cnyRateInput) updates.cnyRate = parseFloat(cnyRateInput)
    await store.setBudget(updates)
  }

  const handleHistoryDaysChange = (days: number) => {
    setHistoryDays(days)
    store.fetchHistory(days)
  }

  const handlePricingSave = async (tier: PricingTier) => {
    const newPricing = pricing.map(p => p.providerId === tier.providerId && p.modelId === tier.modelId ? tier : p)
    await store.updatePricing(newPricing)
  }

  const budgetWarning = summary && budget?.dailyLimit
    ? (summary.todayCost >= budget.dailyLimit ? 'danger'
      : summary.todayCost >= budget.dailyLimit * (budget.alertThreshold || 0.8) ? 'warning' : 'none')
    : 'none'

  const tabs = [
    { id: 'overview' as const, label: '概览', icon: PieChart },
    { id: 'history' as const, label: '趋势', icon: TrendingUp },
    { id: 'settings' as const, label: '设置', icon: Settings2 },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <DollarSign className="w-4 h-4 text-accent-green" />
          成本仪表盘
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { store.fetchSummary(); store.fetchHistory(historyDays) }} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border">
        {tabs.map(tab => (
          <button key={tab.id}
            onClick={() => store.setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] transition-colors
              ${activeTab === tab.id ? 'text-accent-blue border-b-2 border-accent-blue' : 'text-text-muted hover:text-text-primary'}`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Budget Alert */}
      {budgetWarning !== 'none' && (
        <div className={`flex items-start gap-2 px-3 py-2 border-b text-xs ${
          budgetWarning === 'danger'
            ? 'bg-accent-red/5 border-accent-red/20 text-accent-red'
            : 'bg-accent-yellow/5 border-accent-yellow/20 text-accent-yellow'
        }`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{budgetWarning === 'danger' ? '今日花费已超过日预算！' : '今日花费已接近日预算上限！'}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* ── 概览 Tab ── */}
        {activeTab === 'overview' && (
          <>
            {/* Stats Grid */}
            {summary && (
              <div className="grid grid-cols-2 gap-2 p-3">
                <StatCard label="今日花费" value={formatCost(summary.todayCost, currency, cnyRate)}
                  sub={`${formatTokens(summary.todayTokens)} tokens`} color="text-accent-green" icon={DollarSign} />
                <StatCard label="本月花费" value={formatCost(summary.monthCost, currency, cnyRate)}
                  sub={`${formatTokens(summary.monthTokens)} tokens`} icon={Calendar} />
                <StatCard label="累计花费" value={formatCost(summary.totalCost, currency, cnyRate)}
                  sub={`${formatTokens(summary.totalTokens)} tokens`} icon={Coins} />
                <StatCard label="活跃 Provider" value={String(summary.byProvider.length)}
                  sub={`${summary.bySession.length} 个会话`} icon={Globe} />
              </div>
            )}

            {/* Budget Progress */}
            {summary && budget && (budget.dailyLimit || budget.monthlyLimit) && (
              <div className="px-3 pb-3 space-y-2">
                <BudgetProgress current={summary.todayCost} limit={budget.dailyLimit}
                  label="日预算" currency={currency} cnyRate={cnyRate} threshold={budget.alertThreshold} />
                <BudgetProgress current={summary.monthCost} limit={budget.monthlyLimit}
                  label="月预算" currency={currency} cnyRate={cnyRate} threshold={budget.alertThreshold} />
              </div>
            )}

            {/* Mini Chart (最近 7 天) */}
            {history.length > 0 && (
              <div className="px-3 pb-3">
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">近7天花费</div>
                <CostChart data={history.slice(-7)} currency={currency} cnyRate={cnyRate} />
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
                          <span className="text-text-muted">{formatCost(p.cost, currency, cnyRate)} ({pct.toFixed(0)}%)</span>
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
              <div className="px-3 pb-3">
                <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">会话成本排名</div>
                <div className="space-y-1">
                  {summary.bySession.slice(0, 10).map((s, i) => (
                    <div key={s.sessionId} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-bg-hover text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-text-muted w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-text-primary truncate">{s.sessionName}</span>
                      </div>
                      <span className="text-text-muted shrink-0">{formatCost(s.cost, currency, cnyRate)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!summary && !loading && (
              <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                <PieChart className="w-7 h-7 mb-3 opacity-30" />
                <p className="text-sm">暂无成本数据</p>
                <p className="text-[10px]">开始使用 AI 会话后将自动统计</p>
              </div>
            )}
          </>
        )}

        {/* ── 趋势 Tab ── */}
        {activeTab === 'history' && (
          <div className="p-3 space-y-3">
            {/* 时间范围选择 */}
            <div className="flex gap-1">
              {[7, 14, 30, 60].map(d => (
                <button key={d} onClick={() => handleHistoryDaysChange(d)}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    historyDays === d ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-muted hover:bg-bg-hover'
                  }`}
                >
                  {d}天
                </button>
              ))}
            </div>

            {/* 趋势图 */}
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
                每日花费趋势（{historyDays}天）
              </div>
              <CostChart data={history} currency={currency} cnyRate={cnyRate} />
            </div>

            {/* 历史明细表 */}
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">每日明细</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {[...history].reverse().map(d => (
                  <div key={d.date} className="flex items-center justify-between px-2 py-1 rounded hover:bg-bg-hover text-xs">
                    <span className="text-text-primary">{formatDate(d.date)}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted">{d.sessions} 会话</span>
                      <span className="text-text-muted">{formatTokens(d.tokens)}</span>
                      <span className="text-accent-green w-16 text-right">{formatCost(d.cost, currency, cnyRate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {history.length === 0 && (
              <div className="text-center py-8 text-text-muted text-xs">暂无历史数据</div>
            )}
          </div>
        )}

        {/* ── 设置 Tab ── */}
        {activeTab === 'settings' && (
          <div className="p-3 space-y-4">
            {/* 预算设置 */}
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">预算设置</div>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-text-secondary">日预算（美元）</label>
                  <input type="number" step="0.1" value={dailyLimit} onChange={e => setDailyLimit(e.target.value)}
                    placeholder="不限制" className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue" />
                </div>
                <div>
                  <label className="text-[10px] text-text-secondary">月预算（美元）</label>
                  <input type="number" step="1" value={monthlyLimit} onChange={e => setMonthlyLimit(e.target.value)}
                    placeholder="不限制" className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue" />
                </div>
                <div>
                  <label className="text-[10px] text-text-secondary">汇率（1 USD = ? CNY）</label>
                  <input type="number" step="0.01" value={cnyRateInput} onChange={e => setCnyRateInput(e.target.value)}
                    placeholder="7.25" className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue" />
                </div>
                <button onClick={handleSetBudget}
                  className="w-full py-1.5 bg-accent-blue/15 text-accent-blue rounded text-xs hover:bg-accent-blue/25 transition-colors">
                  保存设置
                </button>
              </div>
              {budget?.dailyLimit && (
                <div className="mt-1 text-[10px] text-text-muted">
                  当前：日预算 ${budget.dailyLimit} | 月预算 {budget.monthlyLimit ? `$${budget.monthlyLimit}` : '无限制'} | 汇率 {budget.cnyRate}
                </div>
              )}
            </div>

            {/* 定价管理 */}
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-2">定价配置（$/百万 Token）</div>
              <div className="space-y-1">
                {pricing.map(p => (
                  <PricingRow key={`${p.providerId}-${p.modelId}`} tier={p} onSave={handlePricingSave} />
                ))}
              </div>
              <div className="mt-1 text-[9px] text-text-muted">
                点击编辑按钮修改定价，悬停查看完整信息
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        费用按各 Provider 官方定价估算，实际以账单为准
      </div>
    </div>
  )
}
