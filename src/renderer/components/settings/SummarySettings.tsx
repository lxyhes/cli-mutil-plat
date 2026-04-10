/**
 * Summary 设置面板 - 会话摘要配置
 */
import { useState, useEffect } from 'react'
import {
  FileText, Plus, Trash2, Loader2, RefreshCw, ChevronDown,
  ChevronRight, Clock, Sparkles, Eye, Settings, List, CheckCircle2, XCircle
} from 'lucide-react'
import { useSummaryStore, type SessionSummary, type SummaryType } from '../../stores/summaryStore'
import { useSessionStore } from '../../stores/sessionStore'

const SUMMARY_TYPE_LABELS: Record<SummaryType, string> = {
  auto: '自动摘要',
  manual: '手动摘要',
  key_points: '关键点',
}

const SUMMARY_TYPE_COLORS: Record<SummaryType, string> = {
  auto: 'text-accent-blue',
  manual: 'text-accent-purple',
  key_points: 'text-accent-green',
}

export default function SummarySettings() {
  const {
    summaries,
    allSummaries,
    generating,
    autoEnabled,
    loading,
    fetchSummaries,
    fetchAllSummaries,
    generateSummary,
    deleteSummary,
    setAutoEnabled,
    getLatest,
  } = useSummaryStore()

  const { sessions, selectedSessionId: currentSessionId } = useSessionStore()

  const [activeTab, setActiveTab] = useState<'session' | 'all'>('session')
  const [selectedSessionId, setSelectedSessionId] = useState<string>(currentSessionId || '')
  const [generateType, setGenerateType] = useState<SummaryType>('auto')
  const [includeKeyPoints, setIncludeKeyPoints] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [latestSummary, setLatestSummary] = useState<SessionSummary | null>(null)

  useEffect(() => {
    fetchAllSummaries(50)
    if (selectedSessionId) {
      fetchSummaries(selectedSessionId)
      getLatest(selectedSessionId).then((s) => setLatestSummary(s))
    }
  }, [selectedSessionId])

  const handleGenerate = async () => {
    if (!selectedSessionId) return
    const result = await generateSummary(selectedSessionId, {
      type: generateType,
      includeKeyPoints,
    })
    if (result?.success) {
      getLatest(selectedSessionId).then((s) => setLatestSummary(s))
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此摘要？')) return
    await deleteSummary(id)
    getLatest(selectedSessionId).then((s) => setLatestSummary(s))
  }

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id)
  }

  const currentSession = sessions.find((s: any) => s.id === selectedSessionId)

  const renderSummaryCard = (summary: SessionSummary) => (
    <div key={summary.id} className="bg-bg-tertiary rounded-lg border border-border overflow-hidden">
      {/* 摘要头部 */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <button
          onClick={() => summary.id !== undefined && toggleExpand(summary.id)}
          className="text-text-muted hover:text-text-secondary mt-0.5 flex-shrink-0"
        >
          {summary.id !== undefined && expandedId === summary.id
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${SUMMARY_TYPE_COLORS[summary.summaryType] || 'text-text-muted'}`}>
              {SUMMARY_TYPE_LABELS[summary.summaryType] || summary.summaryType}
            </span>
            {summary.createdAt && (
              <span className="text-xs text-text-muted">
                {new Date(summary.createdAt).toLocaleString()}
              </span>
            )}
            {summary.tokensUsed !== undefined && (
              <span className="text-xs text-text-muted">
                {summary.tokensUsed.toLocaleString()} tokens
              </span>
            )}
            {summary.costUsd !== undefined && summary.costUsd > 0 && (
              <span className="text-xs text-accent-green">
                ${summary.costUsd.toFixed(4)}
              </span>
            )}
          </div>
          {/* 摘要预览（折叠时显示前两行） */}
          {summary.id === undefined || expandedId !== summary.id ? (
            <p className="text-sm text-text-secondary mt-1 line-clamp-2">
              {summary.summary.slice(0, 200)}
              {summary.summary.length > 200 ? '...' : ''}
            </p>
          ) : null}
        </div>

        {/* 删除按钮 */}
        {summary.id !== undefined && (
          <button
            onClick={() => handleDelete(summary.id!)}
            className="p-1 text-text-muted hover:text-accent-red rounded flex-shrink-0"
            title="删除摘要"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 展开详情 */}
      {summary.id !== undefined && expandedId === summary.id && (
        <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border/50">
          {/* 摘要正文 */}
          <div className="mt-2">
            <p className="text-xs font-medium text-text-secondary mb-1">摘要内容</p>
            <div className="bg-bg-secondary rounded-lg p-3 text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
              {summary.summary}
            </div>
          </div>

          {/* 关键点 */}
          {summary.keyPoints && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1">关键点</p>
              <div className="bg-bg-secondary rounded-lg p-3 text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                {summary.keyPoints}
              </div>
            </div>
          )}

          {/* 元信息 */}
          <div className="flex flex-wrap gap-3 text-xs text-text-muted">
            {summary.aiProvider && <span>Provider: {summary.aiProvider}</span>}
            {summary.aiModel && <span>Model: {summary.aiModel}</span>}
            {summary.inputTokens !== undefined && <span>Input: {summary.inputTokens.toLocaleString()} tokens</span>}
            {summary.outputTokens !== undefined && <span>Output: {summary.outputTokens.toLocaleString()} tokens</span>}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 状态栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
          <Sparkles className="w-4 h-4 text-accent-blue" />
          <span className="text-sm text-text-primary font-medium">会话摘要</span>
          <span className="text-xs text-text-muted">· {allSummaries.length} 条记录</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 自动摘要开关 */}
          <button
            onClick={() => setAutoEnabled(!autoEnabled)}
            className={`relative w-9 h-5 rounded-full transition-colors ${autoEnabled ? 'bg-accent-blue' : 'bg-bg-secondary'}`}
            title={autoEnabled ? '关闭自动摘要' : '开启自动摘要'}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-xs text-text-muted">自动摘要</span>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
        {(['session', 'all'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab ? 'bg-bg-secondary text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab === 'session'
              ? `当前会话 (${summaries.length})`
              : `全部会话 (${allSummaries.length})`}
          </button>
        ))}
      </div>

      {/* 会话选择 + 生成控制 */}
      {activeTab === 'session' && (
        <div className="space-y-3">
          {/* 会话选择器 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">选择会话</label>
            <select
              value={selectedSessionId}
              onChange={(e) => {
                setSelectedSessionId(e.target.value)
                setLatestSummary(null)
              }}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            >
              <option value="">-- 选择会话 --</option>
              {sessions.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id.slice(0, 16)} ({s.status})
                </option>
              ))}
            </select>
          </div>

          {/* 生成选项 */}
          <div className="p-3 bg-bg-tertiary rounded-lg border border-border space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-primary">生成摘要</p>
              <button
                onClick={handleGenerate}
                disabled={!selectedSessionId || generating}
                className="px-3 py-1.5 bg-accent-blue text-white rounded-lg text-xs font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {generating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {generating ? '生成中...' : '生成'}
              </button>
            </div>

            {/* 摘要类型选择 */}
            <div className="flex gap-2">
              {(['auto', 'manual', 'key_points'] as SummaryType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setGenerateType(type)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    generateType === type
                      ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                      : 'border-border bg-bg-secondary text-text-secondary hover:border-border-hover'
                  }`}
                >
                  {SUMMARY_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            {/* 关键点开关 */}
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeKeyPoints}
                onChange={(e) => setIncludeKeyPoints(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border bg-bg-secondary accent-accent-blue"
              />
              同时生成关键点
            </label>
          </div>

          {/* 最新摘要预览 */}
          {latestSummary && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
                最新摘要
              </p>
              <div className="bg-bg-secondary rounded-lg p-3 text-sm text-text-primary whitespace-pre-wrap leading-relaxed line-clamp-4">
                {latestSummary.summary}
              </div>
              {latestSummary.keyPoints && (
                <div className="mt-2 bg-bg-secondary rounded-lg p-3 text-sm text-text-secondary whitespace-pre-wrap line-clamp-3">
                  {latestSummary.keyPoints}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 摘要列表 */}
      {activeTab === 'session' ? (
        <div className="space-y-2">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="w-6 h-6 text-text-muted mx-auto mb-2 animate-spin" />
              <p className="text-sm text-text-muted">加载中...</p>
            </div>
          ) : summaries.length === 0 ? (
            <div className="py-8 text-center">
              <FileText className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">暂无摘要</p>
              <p className="text-xs text-text-muted mt-1">选择会话并点击「生成」创建摘要</p>
            </div>
          ) : (
            summaries.map(renderSummaryCard)
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="w-6 h-6 text-text-muted mx-auto mb-2 animate-spin" />
              <p className="text-sm text-text-muted">加载中...</p>
            </div>
          ) : allSummaries.length === 0 ? (
            <div className="py-8 text-center">
              <FileText className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">暂无摘要记录</p>
            </div>
          ) : (
            allSummaries.map(renderSummaryCard)
          )}
        </div>
      )}

      {/* 帮助信息 */}
      <div className="p-3 bg-bg-tertiary rounded-lg">
        <p className="text-xs font-medium text-text-secondary mb-1.5">会话摘要说明</p>
        <div className="text-xs text-text-muted space-y-0.5">
          <div><span className="text-text-secondary">自动摘要</span> - 会话结束后自动生成摘要</div>
          <div><span className="text-text-secondary">手动摘要</span> - 手动触发，生成详细摘要</div>
          <div><span className="text-text-secondary">关键点</span> - 提取对话中的关键决策和成果</div>
          <div className="pt-1">摘要使用 AI 模型生成，会消耗少量 token 配额。</div>
        </div>
      </div>
    </div>
  )
}
