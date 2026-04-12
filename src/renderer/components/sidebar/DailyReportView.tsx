/**
 * DailyReportView - 每日 AI 日报侧边栏视图
 * 三个标签页：日报列表 / 日报详情 / 设置
 */
import { useState, useEffect } from 'react'
import {
  Calendar, RefreshCw, Download, Trash2, Clock, Zap,
  DollarSign, FileText, ChevronRight, ChevronDown, Settings,
  BarChart3, Bot, CheckCircle2, XCircle, Copy, Send
} from 'lucide-react'
import { useDailyReportStore } from '../../stores/dailyReportStore'
import type { DailyReport, DailyReportConfig } from '../../stores/dailyReportStore'

type Tab = 'reports' | 'detail' | 'settings'

// ── 工具函数 ──
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(4)}`
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
    if (dateStr === today) return '今天'
    if (dateStr === yesterday) return '昨天'
    return `${d.getMonth() + 1}月${d.getDate()}日`
  } catch {
    return dateStr
  }
}

function getWeekday(dateStr: string): string {
  const days = ['日', '一', '二', '三', '四', '五', '六']
  const d = new Date(dateStr + 'T00:00:00')
  return '周' + days[d.getDay()]
}

// ── 日报卡片 ──
function ReportCard({
  report, isSelected, onClick
}: { report: DailyReport; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isSelected
          ? 'bg-accent-blue/10 border-accent-blue/30'
          : 'bg-bg-hover/50 border-border hover:bg-bg-hover'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-accent-blue" />
          <span className="text-sm font-medium text-text-primary">
            {formatDate(report.date)}
          </span>
          <span className="text-[10px] text-text-muted">
            {getWeekday(report.date)}
          </span>
        </div>
        <span className="text-[10px] text-text-muted">
          {report.generatedAt ? new Date(report.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </div>

      {/* 统计行 */}
      <div className="flex items-center gap-3 text-[11px] text-text-secondary">
        <span className="flex items-center gap-0.5">
          <Bot className="w-3 h-3 text-accent-green" />
          {report.sessionsCompleted} 会话
        </span>
        <span className="flex items-center gap-0.5">
          <Zap className="w-3 h-3 text-accent-yellow" />
          {formatTokens(report.tokensUsed)}
        </span>
        <span className="flex items-center gap-0.5">
          <Clock className="w-3 h-3 text-accent-purple" />
          {formatDuration(report.duration)}
        </span>
      </div>

      {/* Provider 标签 */}
      {report.providers.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {report.providers.slice(0, 3).map(p => (
            <span key={p.name} className="px-1.5 py-0.5 rounded text-[10px] bg-bg-primary text-text-muted">
              {p.name}
            </span>
          ))}
          {report.providers.length > 3 && (
            <span className="text-[10px] text-text-muted">+{report.providers.length - 3}</span>
          )}
        </div>
      )}
    </button>
  )
}

// ── 日报详情 ──
function ReportDetail({
  report, onExport, onDelete
}: { report: DailyReport; onExport: () => void; onDelete: () => void }) {
  const [expandedHighlights, setExpandedHighlights] = useState(false)
  const [expandedProviders, setExpandedProviders] = useState(false)

  return (
    <div className="space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">
          {formatDate(report.date)} {getWeekday(report.date)}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={onExport} title="导出 Markdown" className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} title="删除日报" className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-red transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 摘要 */}
      <div className="p-3 rounded-lg bg-bg-hover/50 border border-border">
        <p className="text-xs text-text-secondary leading-relaxed">{report.summary}</p>
      </div>

      {/* 统计网格 */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard icon={<Bot className="w-4 h-4" />} label="完成会话" value={String(report.sessionsCompleted)} color="text-accent-green" />
        <StatCard icon={<Zap className="w-4 h-4" />} label="Token 消耗" value={formatTokens(report.tokensUsed)} color="text-accent-yellow" />
        <StatCard icon={<Clock className="w-4 h-4" />} label="运行时长" value={formatDuration(report.duration)} color="text-accent-purple" />
        <StatCard icon={<DollarSign className="w-4 h-4" />} label="预估费用" value={formatCost(report.estimatedCost)} color="text-accent-blue" />
      </div>

      {/* 关键成果 */}
      <div>
        <button
          onClick={() => setExpandedHighlights(!expandedHighlights)}
          className="flex items-center gap-1 text-xs font-medium text-text-primary hover:text-accent-blue transition-colors"
        >
          {expandedHighlights ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <FileText className="w-3.5 h-3.5 text-accent-blue" />
          关键成果 ({report.highlights.length})
        </button>
        {expandedHighlights && (
          <div className="mt-1.5 space-y-1 pl-4">
            {report.highlights.map((h, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-text-secondary">
                <CheckCircle2 className="w-3 h-3 text-accent-green mt-0.5 flex-shrink-0" />
                <span>{h}</span>
              </div>
            ))}
            {report.highlights.length === 0 && (
              <p className="text-xs text-text-muted pl-1">暂无关键成果</p>
            )}
          </div>
        )}
      </div>

      {/* Provider 使用 */}
      <div>
        <button
          onClick={() => setExpandedProviders(!expandedProviders)}
          className="flex items-center gap-1 text-xs font-medium text-text-primary hover:text-accent-blue transition-colors"
        >
          {expandedProviders ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <BarChart3 className="w-3.5 h-3.5 text-accent-purple" />
          Provider 使用 ({report.providers.length})
        </button>
        {expandedProviders && (
          <div className="mt-1.5 space-y-1">
            {/* 表头 */}
            <div className="grid grid-cols-[1fr_60px_80px] gap-1 text-[10px] text-text-muted font-medium px-3 py-1">
              <span>Provider</span>
              <span className="text-center">会话数</span>
              <span className="text-right">Tokens</span>
            </div>
            {report.providers.map((p, i) => {
              const maxTokens = Math.max(...report.providers.map(pp => pp.tokens), 1)
              const barWidth = (p.tokens / maxTokens) * 100
              return (
                <div key={i} className="relative rounded px-3 py-1.5 text-xs bg-bg-hover/50 overflow-hidden">
                  {/* 背景条 */}
                  <div
                    className="absolute inset-y-0 left-0 bg-accent-blue/10"
                    style={{ width: `${barWidth}%` }}
                  />
                  <div className="relative grid grid-cols-[1fr_60px_80px] gap-1">
                    <span className="text-text-primary font-medium truncate">{p.name}</span>
                    <span className="text-center text-text-secondary">{p.sessions}</span>
                    <span className="text-right text-text-muted">{formatTokens(p.tokens)}</span>
                  </div>
                </div>
              )
            })}
            {report.providers.length === 0 && (
              <p className="text-xs text-text-muted pl-3">今日无 Provider 使用</p>
            )}
          </div>
        )}
      </div>

      {/* 生成时间 */}
      <div className="text-[10px] text-text-muted pt-1">
        生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}
      </div>
    </div>
  )
}

// ── 统计小卡片 ──
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-bg-hover/50 border border-border">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[10px] text-text-muted">{label}</span>
      </div>
      <div className="text-sm font-semibold text-text-primary">{value}</div>
    </div>
  )
}

// ── 设置面板 ──
function SettingsPanel() {
  const { config, fetchConfig, updateConfig } = useDailyReportStore()

  useEffect(() => { fetchConfig() }, [fetchConfig])

  if (!config) return <div className="text-xs text-text-muted text-center py-4">加载中...</div>

  const toggle = (key: keyof DailyReportConfig) => {
    updateConfig({ [key]: !config[key] })
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">日报设置</h3>

      {/* 自动生成 */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-bg-hover/50 border border-border">
        <div>
          <div className="text-xs font-medium text-text-primary">自动生成</div>
          <div className="text-[10px] text-text-muted">每天定时自动生成日报</div>
        </div>
        <button
          onClick={() => toggle('autoGenerate')}
          className={`w-9 h-5 rounded-full transition-colors ${
            config.autoGenerate ? 'bg-accent-blue' : 'bg-bg-tertiary'
          }`}
        >
          <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${
            config.autoGenerate ? 'translate-x-4.5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* 生成时间 */}
      {config.autoGenerate && (
        <div className="p-3 rounded-lg bg-bg-hover/50 border border-border">
          <div className="text-xs font-medium text-text-primary mb-2">生成时间</div>
          <div className="flex gap-1.5 flex-wrap">
            {['20:00', '21:00', '22:00', '23:00', '00:00'].map(time => (
              <button
                key={time}
                onClick={() => updateConfig({ generateTime: time })}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  config.generateTime === time
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-primary text-text-secondary hover:bg-bg-tertiary'
                }`}
              >
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 包含费用 */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-bg-hover/50 border border-border">
        <div>
          <div className="text-xs font-medium text-text-primary">包含费用估算</div>
          <div className="text-[10px] text-text-muted">在日报中显示预估费用</div>
        </div>
        <button
          onClick={() => toggle('includeCost')}
          className={`w-9 h-5 rounded-full transition-colors ${
            config.includeCost ? 'bg-accent-blue' : 'bg-bg-tertiary'
          }`}
        >
          <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${
            config.includeCost ? 'translate-x-4.5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* 推送设置 */}
      <div className="p-3 rounded-lg bg-bg-hover/50 border border-border">
        <div className="text-xs font-medium text-text-primary mb-2">推送渠道</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-accent-blue" />
              <span className="text-xs text-text-secondary">推送到飞书</span>
            </div>
            <button
              onClick={() => toggle('pushToFeishu')}
              className={`w-9 h-5 rounded-full transition-colors ${
                config.pushToFeishu ? 'bg-accent-blue' : 'bg-bg-tertiary'
              }`}
            >
              <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                config.pushToFeishu ? 'translate-x-4.5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-accent-green" />
              <span className="text-xs text-text-secondary">推送到 Telegram</span>
            </div>
            <button
              onClick={() => toggle('pushToTelegram')}
              className={`w-9 h-5 rounded-full transition-colors ${
                config.pushToTelegram ? 'bg-accent-blue' : 'bg-bg-tertiary'
              }`}
            >
              <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                config.pushToTelegram ? 'translate-x-4.5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 主视图 ──
export default function DailyReportView() {
  const { reports, currentReport, exportedMarkdown, loading, fetchList, generate, getReport, exportReport, deleteReport } = useDailyReportStore()
  const [activeTab, setActiveTab] = useState<Tab>('reports')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => { fetchList() }, [fetchList])

  const handleGenerate = async () => {
    setGenerating(true)
    const today = new Date().toISOString().slice(0, 10)
    const report = await generate(today)
    setGenerating(false)
    if (report) {
      setActiveTab('detail')
    }
  }

  const handleSelectReport = (report: DailyReport) => {
    getReport(report.date)
    setActiveTab('detail')
  }

  const handleExport = async () => {
    if (!currentReport) return
    const md = await exportReport(currentReport.date)
    if (md) {
      try {
        await navigator.clipboard.writeText(md)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch { /* ignore */ }
    }
  }

  const handleDelete = async () => {
    if (!currentReport) return
    await deleteReport(currentReport.date)
    setActiveTab('reports')
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'reports', label: '日报列表', icon: Calendar },
    { key: 'detail', label: '日报详情', icon: FileText },
    { key: 'settings', label: '设置', icon: Settings },
  ]

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      {/* 标题 */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-accent-blue" />
          <h2 className="text-sm font-semibold text-text-primary">每日 AI 日报</h2>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
        >
          {generating ? (
            <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />生成中...</>
          ) : (
            <><RefreshCw className="w-3 h-3" />生成今日</>
          )}
        </button>
      </div>

      {/* 标签页切换 */}
      <div className="flex border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors ${
              activeTab === tab.key
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'reports' && (
          <>
            {loading && reports.length === 0 ? (
              <div className="text-center py-8 text-xs text-text-muted">加载中...</div>
            ) : reports.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-8 h-8 mx-auto text-text-muted/30 mb-2" />
                <p className="text-xs text-text-muted">暂无日报</p>
                <p className="text-[10px] text-text-muted mt-1">点击"生成今日"创建第一份日报</p>
              </div>
            ) : (
              <div className="space-y-2">
                {reports.map(r => (
                  <ReportCard
                    key={r.id}
                    report={r}
                    isSelected={currentReport?.date === r.date}
                    onClick={() => handleSelectReport(r)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'detail' && (
          <>
            {currentReport ? (
              <ReportDetail
                report={currentReport}
                onExport={handleExport}
                onDelete={handleDelete}
              />
            ) : exportedMarkdown ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">导出结果</h3>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(exportedMarkdown)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      } catch { /* ignore */ }
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-bg-hover hover:bg-bg-tertiary text-text-secondary transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-bg-primary border border-border text-xs text-text-secondary overflow-x-auto whitespace-pre-wrap">
                  {exportedMarkdown}
                </pre>
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="w-8 h-8 mx-auto text-text-muted/30 mb-2" />
                <p className="text-xs text-text-muted">请从列表中选择一份日报</p>
              </div>
            )}
          </>
        )}

        {activeTab === 'settings' && <SettingsPanel />}
      </div>

      {/* 复制成功提示 */}
      {copied && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-accent-green text-white text-xs shadow-lg">
          已复制到剪贴板
        </div>
      )}
    </div>
  )
}
