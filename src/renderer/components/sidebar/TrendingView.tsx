/**
 * 热门 AI 项目视图 - 展示 GitHub/Gitee 热门开源项目
 * @author weibin
 */
import { useState, useEffect } from 'react'
import { Flame, RefreshCw, Loader2, Star, ExternalLink, X } from 'lucide-react'

// ── 热门项目类型 ──
interface TrendingRepo {
  id: string
  name: string
  fullName: string
  description: string
  url: string
  stars: number
  language: string
  topics: string[]
  updatedAt: string
  platform: 'github' | 'gitee'
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: 'bg-blue-400',
  JavaScript: 'bg-yellow-400',
  Python: 'bg-green-400',
  Go: 'bg-cyan-400',
  Rust: 'bg-orange-400',
  Java: 'bg-red-400',
  C: 'bg-gray-400',
  'C++': 'bg-pink-400',
  Shell: 'bg-lime-400',
  Vue: 'bg-emerald-400',
  HTML: 'bg-orange-500',
  CSS: 'bg-purple-400',
}

function formatStars(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function TrendingRepoCard({ repo }: { repo: TrendingRepo }) {
  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-bg-secondary border border-border rounded-lg p-3 hover:border-accent-blue/40 hover:bg-bg-hover transition-all duration-150"
    >
      <div className="flex items-start gap-2 mb-1.5">
        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 text-[10px] font-bold ${
          repo.platform === 'github' ? 'bg-gray-800 text-white' : 'bg-red-500 text-white'
        }`}>
          {repo.platform === 'github' ? 'G' : 'GIT'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-text-primary truncate group-hover:text-accent-blue transition-colors">
              {repo.fullName}
            </span>
            <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
        </div>
      </div>
      {repo.description && (
        <p className="text-[11px] text-text-muted line-clamp-2 mb-2 leading-relaxed">
          {repo.description}
        </p>
      )}
      <div className="flex items-center gap-3 text-[11px] text-text-muted">
        {repo.language && (
          <span className="flex items-center gap-1">
            <span className={`w-2.5 h-2.5 rounded-full ${LANG_COLORS[repo.language] || 'bg-gray-400'}`} />
            {repo.language}
          </span>
        )}
        <span className="flex items-center gap-0.5">
          <Star className="w-3 h-3 text-yellow-500" />
          {formatStars(repo.stars)}
        </span>
        {repo.topics?.slice(0, 3).map(t => (
          <span key={t} className="px-1.5 py-0.5 bg-accent-blue/10 text-accent-blue rounded text-[10px]">
            {t}
          </span>
        ))}
      </div>
    </a>
  )
}

export default function TrendingView() {
  const [repos, setRepos] = useState<TrendingRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [platform, setPlatform] = useState<'github' | 'gitee'>('github')
  const [searchQ, setSearchQ] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTrending()
  }, [platform])

  const fetchTrending = async () => {
    setLoading(true)
    setError(null)
    try {
      const spectrAI = (window as any).spectrAI
      console.log('[TrendingView] fetching trending, platform:', platform, 'spectrAI available:', !!spectrAI?.registry?.fetchTrending)
      const result = await spectrAI?.registry?.fetchTrending?.(platform)
      console.log('[TrendingView] result:', Array.isArray(result) ? `${result.length} repos` : result)
      if (Array.isArray(result)) {
        setRepos(result)
        if (result.length === 0) {
          setError('未获取到数据，GitHub API 可能被限流，请稍后再试或切换到 Gitee')
        }
      } else {
        setRepos([])
        setError('接口返回数据异常')
      }
    } catch (e: any) {
      console.error('[TrendingView] fetch error:', e)
      setRepos([])
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const filtered = repos.filter(repo => {
    if (!searchQ) return true
    const q = searchQ.toLowerCase()
    return [repo.fullName, repo.description, repo.language, ...(repo.topics || [])].some(
      s => s?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col h-full p-4">
      {/* 标题 */}
      <div className="mb-3">
        <h2 className="text-base font-semibold text-text-primary">热门 AI 项目</h2>
        <p className="text-xs text-text-muted mt-0.5">
          发现 GitHub / Gitee 上最热门的 AI 开源项目
        </p>
      </div>

      {/* 工具栏：搜索 + 平台切换 + 刷新 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative min-w-0">
          <input
            type="text"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索项目名称、描述..."
            className="w-full bg-bg-tertiary border border-border text-text-primary text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent-blue/60 transition-colors min-w-0 placeholder:text-text-muted"
          />
          {searchQ && (
            <button
              onClick={() => setSearchQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full bg-text-muted/30 hover:bg-text-muted/50 text-text-primary transition-colors"
            >
              <X className="w-2.5 h-2.5" strokeWidth={3} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5 p-0.5 bg-bg-tertiary border border-border rounded-lg shrink-0">
          <button
            onClick={() => setPlatform('github')}
            className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
              platform === 'github'
                ? 'bg-gray-700 text-white shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            GitHub
          </button>
          <button
            onClick={() => setPlatform('gitee')}
            className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${
              platform === 'gitee'
                ? 'bg-red-500 text-white shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Gitee
          </button>
        </div>

        <button
          onClick={fetchTrending}
          className="px-2.5 py-1.5 text-xs border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors flex items-center gap-1 shrink-0"
          title="刷新"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-accent-red/5 border border-accent-red/20 rounded-lg text-xs text-accent-red">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-accent-red/60 hover:text-accent-red shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-xs gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-12">
          <Flame className="w-7 h-7 text-text-muted/40 mb-3" strokeWidth={1.5} />
          <div className="text-sm text-text-secondary mb-1">
            {repos.length === 0 ? '暂无数据' : '没有匹配的项目'}
          </div>
          {!error && (
            <div className="text-xs text-text-muted">请检查网络连接或切换平台</div>
          )}
          {repos.length === 0 && (
            <button
              onClick={fetchTrending}
              className="mt-3 text-xs text-accent-blue hover:text-accent-blue/80 transition-colors"
            >
              重试 →
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pb-4">
          {filtered.map(repo => (
            <TrendingRepoCard key={repo.id} repo={repo} />
          ))}
        </div>
      )}
    </div>
  )
}
