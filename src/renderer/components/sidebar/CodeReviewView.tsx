/**
 * AI 代码审查面板 - 查看审查结果和行内标注
 * 功能：启动审查、查看结果、行内标注、一键修复、自动审查设置
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import {
  ShieldCheck, Play, AlertTriangle, Bug, Zap, Lock, Palette, Code2,
  CheckCircle2, Loader2, ChevronDown, ChevronRight, Settings2, RefreshCw, X
} from 'lucide-react'
import { useReviewStore, type CodeReview, type ReviewComment } from '../../stores/reviewStore'
import { useSessionStore } from '../../stores/sessionStore'

const SEVERITY_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  error: { color: 'text-accent-red bg-accent-red/10', icon: Bug, label: '严重' },
  warning: { color: 'text-accent-yellow bg-accent-yellow/10', icon: AlertTriangle, label: '警告' },
  suggestion: { color: 'text-accent-blue bg-accent-blue/10', icon: Zap, label: '建议' },
  info: { color: 'text-text-muted bg-bg-tertiary', icon: Code2, label: '信息' },
}

const CATEGORY_LABELS: Record<string, string> = {
  bug: '缺陷', security: '安全', performance: '性能', style: '风格',
  'best-practice': '最佳实践', architecture: '架构',
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'text-accent-green' : score >= 70 ? 'text-accent-blue' : score >= 50 ? 'text-accent-yellow' : 'text-accent-red'
  const label = score >= 90 ? '优秀' : score >= 70 ? '良好' : score >= 50 ? '一般' : '较差'
  return (
    <span className={`text-xs font-semibold ${color}`}>
      {score}<span className="text-[9px] font-normal text-text-muted">/100 {label}</span>
    </span>
  )
}

function CommentCard({ comment, onResolve, onApplyFix }: {
  comment: ReviewComment
  onResolve: () => void
  onApplyFix: () => void
}) {
  const sev = SEVERITY_CONFIG[comment.severity] || SEVERITY_CONFIG.info
  const SevIcon = sev.icon

  return (
    <div className={`rounded border p-2 text-xs transition-colors ${comment.resolved ? 'border-border opacity-60' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className={`px-1 py-0.5 rounded text-[9px] flex items-center gap-0.5 ${sev.color}`}>
            <SevIcon className="w-3 h-3" />{sev.label}
          </span>
          <span className="text-[9px] text-text-muted">{CATEGORY_LABELS[comment.category] || comment.category}</span>
        </div>
        <div className="flex items-center gap-1">
          {!comment.resolved && (
            <button onClick={onResolve}
              className="text-[10px] text-accent-green hover:underline">解决</button>
          )}
          {comment.suggestion && !comment.resolved && (
            <button onClick={onApplyFix}
              className="text-[10px] text-accent-blue hover:underline">应用修复</button>
          )}
          {comment.resolved && <CheckCircle2 className="w-3 h-3 text-accent-green" />}
        </div>
      </div>
      <div className="text-text-primary text-[10px] mb-0.5 font-mono">
        {comment.filePath} {comment.lineStart > 0 && `:${comment.lineStart}-${comment.lineEnd}`}
      </div>
      <div className="text-text-secondary leading-relaxed">{comment.message}</div>
      {comment.suggestion && (
        <div className="mt-1 bg-bg-primary rounded p-1.5 text-[10px] font-mono text-text-primary overflow-x-auto border border-border">
          {comment.suggestion}
        </div>
      )}
    </div>
  )
}

/* ─── 主面板 ─── */

export default function CodeReviewView() {
  const store = useReviewStore()
  const reviews = useReviewStore(s => s.reviews)
  const comments = useReviewStore(s => s.comments)
  const loading = useReviewStore(s => s.loading)
  const settings = useReviewStore(s => s.settings)
  const activeSessionId = useSessionStore(s => s.currentSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const [expandedReview, setExpandedReview] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [filterSeverity, setFilterSeverity] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const session = sessions.find(s => s.id === activeSessionId)

  useEffect(() => {
    if (activeSessionId) store.fetchList(activeSessionId)
    store.fetchSettings()
  }, [activeSessionId])

  const handleStartReview = async () => {
    if (!activeSessionId || !session) return
    setStarting(true)
    try {
      const repoPath = session.config?.workingDirectory || (session as any)?.workDir || ''
      await store.startReview({
        sessionId: activeSessionId,
        sessionName: session.name,
        repoPath,
      })
    } finally {
      setStarting(false)
    }
  }

  const handleExpand = async (reviewId: string) => {
    if (expandedReview === reviewId) {
      setExpandedReview(null)
    } else {
      setExpandedReview(reviewId)
      await store.fetchComments(reviewId)
    }
  }

  // 过滤评论
  const filteredComments = filterSeverity
    ? comments.filter(c => c.severity === filterSeverity)
    : comments

  // 统计
  const reviewComments = expandedReview ? filteredComments.filter(c => c.reviewId === expandedReview) : []
  const errorCount = reviewComments.filter(c => c.severity === 'error' && !c.resolved).length
  const warningCount = reviewComments.filter(c => c.severity === 'warning' && !c.resolved).length

  if (!activeSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted p-6">
        <ShieldCheck className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">请先选择一个会话</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <ShieldCheck className="w-4 h-4 text-accent-green" />
          AI 代码审查
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowSettings(!showSettings)} title="设置"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => store.fetchList(activeSessionId)} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleStartReview} disabled={starting}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-green/15 text-accent-green text-xs hover:bg-accent-green/25 transition-colors disabled:opacity-50">
            {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            审查
          </button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2">
          <div className="text-xs text-text-secondary font-medium">自动审查设置</div>
          <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
            <input type="checkbox" checked={settings?.autoReviewEnabled || false}
              onChange={e => store.updateSettings({ autoReviewEnabled: e.target.checked })}
              className="w-3.5 h-3.5 accent-accent-blue" />
            AI 完成代码修改后自动审查
          </label>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">审查间隔</span>
            <select value={settings?.autoReviewInterval || 300000}
              onChange={e => store.updateSettings({ autoReviewInterval: parseInt(e.target.value) })}
              className="px-1 py-0.5 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none">
              <option value={60000}>1 分钟</option>
              <option value={300000}>5 分钟</option>
              <option value={600000}>10 分钟</option>
              <option value={1800000}>30 分钟</option>
            </select>
          </div>
        </div>
      )}

      {/* Reviews */}
      <div className="flex-1 overflow-y-auto">
        {loading && !reviews.length ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
          </div>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <ShieldCheck className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">暂无审查记录</p>
            <p className="text-[10px]">点击"审查"按钮启动 AI 代码审查</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {reviews.map(review => (
              <div key={review.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between cursor-pointer" onClick={() => handleExpand(review.id)}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {expandedReview === review.id ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />}
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      review.status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
                      review.status === 'running' ? 'bg-accent-yellow/10 text-accent-yellow animate-pulse' :
                      review.status === 'failed' ? 'bg-accent-red/10 text-accent-red' :
                      'bg-bg-tertiary text-text-muted'
                    }`}>
                      {review.status === 'completed' ? '完成' : review.status === 'running' ? '审查中' : review.status === 'failed' ? '失败' : '待审查'}
                    </span>
                    {review.status === 'completed' && <ScoreBadge score={review.score} />}
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {review.criticalCount > 0 && <span className="text-accent-red mr-1">{review.criticalCount} 严重</span>}
                    {new Date(review.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Summary */}
                {review.summary && expandedReview !== review.id && (
                  <p className="text-[10px] text-text-muted mt-1 line-clamp-1 ml-5">{review.summary}</p>
                )}

                {/* Expanded Content */}
                {expandedReview === review.id && (
                  <div className="mt-2 space-y-2">
                    {/* Summary */}
                    {review.summary && (
                      <div className="text-xs text-text-secondary bg-bg-tertiary/50 rounded p-2 leading-relaxed">{review.summary}</div>
                    )}

                    {/* Severity Filter */}
                    <div className="flex gap-1">
                      <button onClick={() => setFilterSeverity(null)}
                        className={`px-1 py-0.5 rounded text-[9px] ${!filterSeverity ? 'text-accent-blue bg-accent-blue/10' : 'text-text-muted hover:text-text-primary'}`}>
                        全部 ({reviewComments.length})
                      </button>
                      {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => {
                        const count = reviewComments.filter(c => c.severity === key).length
                        if (count === 0) return null
                        return (
                          <button key={key} onClick={() => setFilterSeverity(filterSeverity === key ? null : key)}
                            className={`px-1 py-0.5 rounded text-[9px] flex items-center gap-0.5 ${filterSeverity === key ? cfg.color : 'text-text-muted hover:text-text-primary'}`}>
                            <cfg.icon className="w-2.5 h-2.5" />{count}
                          </button>
                        )
                      })}
                    </div>

                    {/* Comments */}
                    {reviewComments.length === 0 ? (
                      <div className="text-center py-4 text-text-muted text-[10px]">暂无评论</div>
                    ) : (
                      <div className="space-y-1.5">
                        {reviewComments.map(comment => (
                          <CommentCard key={comment.id} comment={comment}
                            onResolve={() => store.resolveComment(comment.id)}
                            onApplyFix={async () => {
                              const result = await store.applyFix(comment.id)
                              if (result.success) store.resolveComment(comment.id)
                            }} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        AI 审查自动分析代码改动，提供行级标注和修复建议
      </div>
    </div>
  )
}
