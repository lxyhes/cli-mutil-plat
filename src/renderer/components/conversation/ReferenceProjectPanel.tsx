/**
 * 参考项目面板 - 从 GitHub 搜索相似技术栈项目，获取参考代码
 * 作为 Tab 嵌入 SessionKnowledgePanel
 * @author spectrai
 */
import { useState, useCallback } from 'react'
import { Search, Star, ExternalLink, FolderOpen, File, ChevronRight, ChevronDown, BookMarked, Trash2, Save, Loader2, X, Zap, ArrowLeft } from 'lucide-react'

interface GithubRepo {
  id: number
  name: string
  fullName: string
  description: string
  htmlUrl: string
  stars: number
  language: string
  topics: string[]
  updatedAt: string
}

interface RepoFile {
  path: string
  type: 'file' | 'dir'
  size?: number
  sha: string
  downloadUrl?: string
}

interface Props {
  sessionId: string
  projectPath: string
  onClose?: () => void
}

type ViewMode = 'search' | 'browse'

export default function ReferenceProjectPanel({ sessionId, projectPath }: Props) {
  const [view, setView] = useState<ViewMode>('search')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [searchError, setSearchError] = useState('')
  const [suggested, setSuggested] = useState<GithubRepo[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestAttempted, setSuggestAttempted] = useState(false)

  // 浏览状态
  const [activeRepo, setActiveRepo] = useState<GithubRepo | null>(null)
  const [tree, setTree] = useState<RepoFile[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [dirCache, setDirCache] = useState<Record<string, RepoFile[]>>({})

  // 文件查看状态
  const [viewingFile, setViewingFile] = useState<{ path: string; content: string; lang: string } | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  // 保存状态
  const [savingToKb, setSavingToKb] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  const api = () => (window as any).spectrAI?.reference

  // 智能推荐：基于当前项目的 package.json 依赖推荐相似项目
  const handleSuggest = useCallback(async () => {
    setSuggestLoading(true)
    setSuggestAttempted(true)
    try {
      const r = await api()?.suggest(projectPath)
      if (r?.repos) setSuggested(r.repos)
    } catch { /* ignore */ }
    setSuggestLoading(false)
  }, [projectPath])

  // 搜索 GitHub
  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearchError('')
    setRepos([])
    try {
      const r = await api()?.search(query.trim())
      if (r?.error) {
        setSearchError(r.error)
      } else if (r?.repos) {
        setRepos(r.repos)
      }
    } catch (err) {
      setSearchError('搜索失败，请检查网络')
    }
    setSearching(false)
  }, [query])

  // 点击仓库 → 进入浏览模式
  const handleSelectRepo = useCallback(async (repo: GithubRepo) => {
    setActiveRepo(repo)
    setTree([])
    setTreeError('')
    setDirCache({})
    setExpandedDirs(new Set())
    setView('browse')
    setTreeLoading(true)
    const owner = repo.fullName.split('/')[0]
    const r = await api()?.getRepoTree(owner, repo.name)
    if (r?.error) {
      setTreeError(r.error)
    } else if (r?.files) {
      setTree(r.files)
      setDirCache({ '': r.files })
    }
    setTreeLoading(false)
  }, [])

  // 展开目录
  const handleExpandDir = useCallback(async (file: RepoFile) => {
    if (!activeRepo) return
    const parent = file.path
    if (expandedDirs.has(parent)) {
      setExpandedDirs(prev => {
        const next = new Set(prev)
        next.delete(parent)
        return next
      })
      return
    }
    if (dirCache[parent]) {
      setExpandedDirs(prev => new Set([...prev, parent]))
      return
    }
    const owner = activeRepo.fullName.split('/')[0]
    const r = await api()?.getRepoTree(owner, activeRepo.name)
    if (r?.files) {
      // 过滤出当前目录的子项
      const children = r.files.filter((f: RepoFile) => f.path.startsWith(parent + '/'))
      setDirCache(prev => ({ ...prev, [parent]: children }))
      setExpandedDirs(prev => new Set([...prev, parent]))
    }
  }, [activeRepo, expandedDirs, dirCache])

  // 查看文件内容
  const handleViewFile = useCallback(async (file: RepoFile) => {
    if (!activeRepo) return
    setFileLoading(true)
    setViewingFile(null)
    try {
      const owner = activeRepo.fullName.split('/')[0]
      const lang = detectLang(file.path)
      const r = await api()?.getFileContent(owner, activeRepo.name, file.path)
      if (r?.content !== undefined) {
        setViewingFile({ path: file.path, content: r.content, lang })
      }
    } catch { /* ignore */ }
    setFileLoading(false)
  }, [activeRepo])

  // 保存到知识库
  const handleSaveToKb = useCallback(async (file: RepoFile, content: string) => {
    if (!activeRepo) return
    setSavingToKb(true)
    try {
      const owner = activeRepo.fullName.split('/')[0]
      await api()?.saveToKnowledge({
        projectPath,
        repoFullName: activeRepo.fullName,
        repoUrl: activeRepo.htmlUrl,
        filePath: file.path,
        codeContent: content,
        category: 'architecture',
        title: `[${activeRepo.fullName}] ${file.path}`,
      })
      setSavedIds(prev => new Set([...prev, file.path]))
    } catch { /* ignore */ }
    setSavingToKb(false)
  }, [activeRepo, projectPath])

  // 初始加载推荐（只尝试一次，避免 API 失败时无限循环）
  if (suggested.length === 0 && !suggestLoading && !suggestAttempted && view === 'search') {
    handleSuggest()
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-bg-secondary">
        {view === 'browse' && (
          <button onClick={() => { setView('search'); setActiveRepo(null); setViewingFile(null) }}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
          <Search className="w-4 h-4 text-accent-blue" />
          <span>{view === 'search' ? '参考项目搜索' : activeRepo?.fullName}</span>
        </div>
        {activeRepo && (
          <a href={activeRepo.htmlUrl} target="_blank" rel="noopener noreferrer"
            className="ml-auto p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue transition-colors"
            title="在 GitHub 打开">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Search View */}
      {view === 'search' && (
        <>
          {/* 搜索框 */}
          <div className="px-3 py-2 border-b border-border space-y-2">
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索相似项目：electron react, multi-agent framework..."
                  className="w-full pl-7 pr-2.5 py-1.5 bg-bg-tertiary border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                />
              </div>
              <button onClick={handleSearch} disabled={searching}
                className="px-2.5 py-1.5 bg-accent-blue/15 text-accent-blue rounded-lg text-xs hover:bg-accent-blue/25 disabled:opacity-50 transition-colors">
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '搜索'}
              </button>
            </div>
            {searchError && (
              <div className="text-[10px] text-accent-red bg-accent-red/10 px-2 py-1 rounded">{searchError}</div>
            )}
          </div>

          {/* 智能推荐 */}
          {!query && (
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center gap-1.5 mb-2">
                <Zap className="w-3 h-3 text-accent-yellow" />
                <span className="text-[10px] text-text-muted font-medium">智能推荐（基于你的依赖）</span>
                <button onClick={handleSuggest} disabled={suggestLoading}
                  className="ml-auto text-[10px] text-accent-blue hover:underline disabled:opacity-50">
                  {suggestLoading ? '加载中...' : '换一批'}
                </button>
              </div>
              {suggestLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                </div>
              ) : (
                <div className="space-y-1">
                  {suggested.map(repo => (
                    <RepoCard key={repo.id} repo={repo} onClick={() => handleSelectRepo(repo)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 搜索结果 */}
          {query && (
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <div className="text-[10px] text-text-muted mb-2">
                找到 {repos.length} 个结果
              </div>
              {repos.length === 0 && !searching && (
                <div className="text-xs text-text-muted text-center py-6">
                  未找到相关项目，试试其他关键词
                </div>
              )}
              <div className="space-y-1">
                {repos.map(repo => (
                  <RepoCard key={repo.id} repo={repo} onClick={() => handleSelectRepo(repo)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Browse View */}
      {view === 'browse' && activeRepo && (
        <div className="flex flex-1 min-h-0">
          {/* 文件树 */}
          <div className="w-52 border-r border-border flex flex-col flex-shrink-0">
            <div className="px-2 py-1.5 border-b border-border">
              <div className="text-[10px] text-text-muted truncate" title={activeRepo.description}>
                {activeRepo.description || '无描述'}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="flex items-center gap-0.5 text-[10px] text-text-muted">
                  <Star className="w-2.5 h-2.5 text-accent-yellow" />
                  {activeRepo.stars >= 1000 ? (activeRepo.stars / 1000).toFixed(1) + 'k' : activeRepo.stars}
                </span>
                {activeRepo.language && (
                  <span className="text-[10px] text-text-muted">{activeRepo.language}</span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {treeLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                </div>
              )}
              {treeError && (
                <div className="px-2 py-2 text-[10px] text-accent-red">{treeError}</div>
              )}
              {!treeLoading && !treeError && (
                <FileTree
                  files={tree}
                  dirCache={dirCache}
                  expandedDirs={expandedDirs}
                  onExpand={handleExpandDir}
                  onView={handleViewFile}
                />
              )}
            </div>
          </div>

          {/* 文件内容 */}
          <div className="flex-1 flex flex-col min-w-0">
            {viewingFile ? (
              <>
                <div className="px-3 py-1.5 border-b border-border flex items-center justify-between bg-bg-secondary/50">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <File className="w-3 h-3 text-accent-green shrink-0" />
                    <span className="text-[10px] text-text-secondary font-mono truncate">{viewingFile.path}</span>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    {savedIds.has(viewingFile.path) ? (
                      <span className="text-[10px] text-accent-green flex items-center gap-0.5">
                        <BookMarked className="w-2.5 h-2.5" /> 已保存
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSaveToKb(
                          { path: viewingFile.path, type: 'file' } as any,
                          viewingFile.content
                        )}
                        disabled={savingToKb}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-accent-blue/15 text-accent-blue rounded hover:bg-accent-blue/25 disabled:opacity-50 transition-colors"
                      >
                        {savingToKb ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
                        保存到知识库
                      </button>
                    )}
                    <button onClick={() => setViewingFile(null)}
                      className="p-0.5 text-text-muted hover:text-text-primary transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto px-3 py-2">
                  <CodeViewer content={viewingFile.content} language={viewingFile.lang} />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-text-muted">
                {fileLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                ) : (
                  <>
                    <File className="w-8 h-8 opacity-20 mb-2" />
                    <p className="text-xs">点击左侧文件查看内容</p>
                    <p className="text-[10px] opacity-60 mt-1">选择代码后可保存到知识库</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 子组件 ──

function RepoCard({ repo, onClick }: { repo: GithubRepo; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-bg-hover transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-text-primary truncate">{repo.name}</span>
            <span className="flex items-center gap-0.5 text-[10px] text-text-muted shrink-0">
              <Star className="w-2.5 h-2.5 text-accent-yellow" />
              {repo.stars >= 1000 ? (repo.stars / 1000).toFixed(1) + 'k' : repo.stars}
            </span>
          </div>
          <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2 leading-relaxed">{repo.description}</p>
          {repo.topics.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-1">
              {repo.topics.slice(0, 4).map(t => (
                <span key={t} className="text-[8px] px-1 py-0.5 rounded bg-bg-tertiary text-text-muted">{t}</span>
              ))}
            </div>
          )}
        </div>
        <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-opacity" />
      </div>
    </button>
  )
}

function FileTree({ files, dirCache, expandedDirs, onExpand, onView }: {
  files: RepoFile[]
  dirCache: Record<string, RepoFile[]>
  expandedDirs: Set<string>
  onExpand: (f: RepoFile) => void
  onView: (f: RepoFile) => void
}) {
  const visibleFiles = files.filter(f => {
    // 只显示根级和展开目录的子项
    const depth = f.path.split('/').length - 1
    if (depth === 0) return true
    const parent = f.path.split('/').slice(0, -1).join('/')
    return expandedDirs.has(parent)
  })

  return (
    <div className="px-1">
      {visibleFiles.map(file => {
        const isDir = file.type === 'dir'
        const isExpanded = expandedDirs.has(file.path)
        const children = dirCache[file.path] || []
        const name = file.path.split('/').pop() || file.path
        const isViewable = !isDir && isViewableFile(file.path)

        return (
          <div key={file.path}>
            <button
              onClick={() => isDir ? onExpand(file) : (isViewable ? onView(file) : undefined)}
              className={`w-full flex items-center gap-1 px-1 py-0.5 rounded text-left hover:bg-bg-hover transition-colors ${
                !isDir && !isViewable ? 'opacity-40' : ''
              }`}
              title={file.path}
            >
              {isDir
                ? (isExpanded ? <ChevronDown className="w-3 h-3 text-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />)
                : <File className="w-3 h-3 text-text-muted shrink-0" />
              }
              {isDir
                ? <FolderOpen className="w-3 h-3 text-accent-yellow shrink-0" />
                : <span className="w-3" />
              }
              <span className="text-[11px] text-text-secondary truncate">{name}</span>
            </button>
            {/* 展开的子目录 */}
            {isDir && isExpanded && children.length > 0 && (
              <div className="pl-3 border-l border-border/40 ml-1">
                {children.map(child => {
                  const childIsDir = child.type === 'dir'
                  const childIsViewable = !childIsDir && isViewableFile(child.path)
                  const childName = child.path.split('/').pop() || child.path
                  return (
                    <button
                      key={child.path}
                      onClick={() => childIsDir ? onExpand(child) : (childIsViewable ? onView(child) : undefined)}
                      className={`w-full flex items-center gap-1 px-1 py-0.5 rounded text-left hover:bg-bg-hover transition-colors ${
                        !childIsDir && !childIsViewable ? 'opacity-40' : ''
                      }`}
                    >
                      {childIsDir
                        ? <FolderOpen className="w-3 h-3 text-accent-yellow shrink-0" />
                        : <File className="w-3 h-3 text-text-muted shrink-0" />
                      }
                      <span className="text-[11px] text-text-secondary truncate">{childName}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CodeViewer({ content, language }: { content: string; language: string }) {
  // 简单按行高亮：检测 //, #, /*, */ 等注释
  const lines = content.split('\n')
  return (
    <pre className="text-xs font-mono leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
      {lines.map((line, i) => {
        let cls = 'text-text-secondary'
        if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
          cls = 'text-text-muted italic'
        } else if (line.trim().startsWith('/*') || line.trim().startsWith('*')) {
          cls = 'text-accent-green/70'
        } else if (line.trim().startsWith('import ') || line.trim().startsWith('from ') || line.trim().startsWith('const ') || line.trim().startsWith('let ') || line.trim().startsWith('var ')) {
          cls = 'text-accent-blue'
        } else if (line.trim().startsWith('interface ') || line.trim().startsWith('type ') || line.trim().startsWith('class ') || line.trim().startsWith('export ')) {
          cls = 'text-accent-purple'
        } else if (line.trim().startsWith('function ') || line.trim().startsWith('async ') || line.trim().startsWith('def ')) {
          cls = 'text-accent-green'
        }
        return (
          <div key={i} className={`${cls} ${i % 2 === 0 ? 'bg-bg-primary' : 'bg-bg-secondary/30'}`}>
            <span className="inline-block w-8 text-right pr-2 text-text-muted/50 select-none shrink-0">{i + 1}</span>
            {line}
          </div>
        )
      })}
    </pre>
  )
}

function detectLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', go: 'Go', rs: 'Rust', java: 'Java',
    cs: 'C#', cpp: 'C++', c: 'C', h: 'C/C++',
    rb: 'Ruby', php: 'PHP', swift: 'Swift', md: 'Markdown',
    json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
    sh: 'Shell', bash: 'Bash', css: 'CSS', scss: 'SCSS',
    html: 'HTML', vue: 'Vue', sql: 'SQL',
  }
  return map[ext] || 'Text'
}

function isViewableFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const skipExts = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'svg', 'pdf',
    'zip', 'tar', 'gz', 'rar', '7z',
    'exe', 'dll', 'so', 'dylib', 'o', 'obj',
    'mp3', 'mp4', 'wav', 'avi', 'mov',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'lock', 'sum', 'map',
  ])
  if (skipExts.has(ext)) return false
  if (['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', '.DS_Store', 'Thumbs.db'].includes(path.split('/').pop() || '')) return false
  return true
}
