/**
 * AI 代码审查面板 - 查看审查结果和行内标注
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import { ShieldCheck, Play, AlertTriangle, Bug, Zap, Lock, Palette, Code2, CheckCircle2, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { useReviewStore, type CodeReview, type ReviewComment } from '../../stores/reviewStore'
import { useSessionStore } from '../../stores/sessionStore'

const SEVERITY_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  error: { color: 'text-accent-red bg-accent-red/10', icon: Bug, label: '严重' },
  warning: { color: 'text-accent-yellow bg-accent-yellow/10', icon: AlertTriangle, label: '警告' },
  suggestion: { color: 'text-accent-blue bg-accent-blue/10', icon: Zap, label: '建议' },
  info: { color: 'text-text-muted bg-bg-tertiary', icon: Code2, label: '信息' },
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  bug: Bug, security: Lock, performance: Zap, style: Palette, 'best-practice': CheckCircle2, architecture: Code2,
}

export default function CodeReviewView() {
  const store = useReviewStore()
  const reviews = useReviewStore(s => s.reviews)
  const comments = useReviewStore(s => s.comments)
  const loading = useReviewStore(s => s.loading)
  const activeSessionId = useSessionStore(s => s.currentSessionId)
  const [expandedReview, setExpandedReview] = useState<string | null>(null)

  useEffect(() => {
    if (activeSessionId) store.fetchList(activeSessionId)
  }, [activeSessionId])

  const handleStartReview = async () => {
    if (!activeSessionId) return
    const session = useSessionStore.getState().sessions.find(s => s.id === activeSessionId)
    if (!session) return
    await store.startReview({
      sessionId: activeSessionId,
      sessionName: session.name,
      repoPath: session.workDir || '',
    })
    await store.fetchList(activeSessionId)
  }

  const handleExpand = async (reviewId: string) => {
    if (expandedReview === reviewId) {
      setExpandedReview(null)
    } else {
      setExpandedReview(reviewId)
      await store.fetchComments(reviewId)
    }
  }

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
        <button onClick={handleStartReview}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-green/15 text-accent-green text-xs hover:bg-accent-green/25 transition-colors">
          <Play className="w-3 h-3" />
          审查
        </button>
      </div>

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
                      review.status === 'running' ? 'bg-accent-yellow/10 text-accent-yellow' :
                      'bg-bg-tertiary text-text-muted'
                    }`}>{review.status === 'completed' ? '完成' : review.status === 'running' ? '审查中' : '待审查'}</span>
                    <span className="text-xs text-text-primary">评分: {review.score}/100</span>
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0">{new Date(review.createdAt).toLocaleDateString()}</span>
                </div>

                {/* Summary */}
                {review.summary && expandedReview !== review.id && (
                  <p className="text-[10px] text-text-muted mt-1 line-clamp-1">{review.summary}</p>
                )}

                {/* Comments */}
                {expandedReview === review.id && (
                  <div className="mt-2 space-y-2">
                    {review.summary && (
                      <div className="text-xs text-text-secondary bg-bg-tertiary/50 rounded p-2">{review.summary}</div>
                    )}
                    {comments.filter(c => c.reviewId === review.id).map(comment => {
                      const sev = SEVERITY_CONFIG[comment.severity] || SEVERITY_CONFIG.info
                      const CatIcon = CATEGORY_ICONS[comment.category] || Code2
                      return (
                        <div key={comment.id} className={`rounded border p-2 text-xs ${comment.resolved ? 'border-border opacity-60' : 'border-border'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1 py-0.5 rounded text-[9px] ${sev.color}`}>
                                <sev.icon className="w-3 h-3 inline mr-0.5" />{sev.label}
                              </span>
                              <CatIcon className="w-3 h-3 text-text-muted" />
                              <span className="text-text-muted text-[10px]">{comment.category}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              {!comment.resolved && (
                                <button onClick={() => store.resolveComment(comment.id)}
                                  className="text-[10px] text-accent-green hover:underline">解决</button>
                              )}
                              {comment.suggestion && !comment.resolved && (
                                <button onClick={() => store.applyFix(comment.id)}
                                  className="text-[10px] text-accent-blue hover:underline">应用修复</button>
                              )}
                            </div>
                          </div>
                          <div className="text-text-primary text-[10px] mb-0.5">
                            {comment.filePath} {comment.lineStart > 0 && `:${comment.lineStart}-${comment.lineEnd}`}
                          </div>
                          <div className="text-text-secondary">{comment.message}</div>
                          {comment.suggestion && (
                            <div className="mt-1 bg-bg-primary rounded p-1.5 text-[10px] font-mono text-text-primary overflow-x-auto">
                              {comment.suggestion}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        AI 审查自动分析代码改动，提供行级标注和修复建议
      </div>
    </div>
  )
}
