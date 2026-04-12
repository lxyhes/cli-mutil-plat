/**
 * Skill 技能模板管理页面
 * 通过 /命令 在任意 Provider 的会话中调用技能模板
 * @author weibin
 */
import React, { useState, useEffect, useRef } from 'react'
import {
  Zap, ChevronDown, Check, Loader2, Search, X, RefreshCw, Database,
  AlertTriangle, Inbox, Upload, Plus, CheckCircle, Bookmark, Store,
  Pencil, Trash2, Lock, Eye, EyeOff,
} from 'lucide-react'
import { useSkillStore } from '../../stores/skillStore'
import type { Skill } from '../../../shared/types'

// 过滤类型配置
const SKILL_TYPES = [
  { id: 'all',           label: '全部'      },
  { id: 'prompt',        label: 'Prompt 技能' },
  { id: 'orchestration', label: '编排技能'    },
  { id: 'native',        label: '原生技能'    },
  { id: 'builtin',       label: '内置'       },
]

// 技能类型颜色
const TYPE_COLORS: Record<string, string> = {
  prompt:        'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  orchestration: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  native:        'bg-green-500/10 text-green-400 border border-green-500/20',
}

// Provider 显示映射
const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'codex':       'Codex',
  'gemini-cli':  'Gemini',
  'iflow':       'iFlow',
  'opencode':    'OpenCode',
  'qwen-coder':  'Qwen',
}

// 市场技能分类标签颜色 + 图标
const CATEGORY_COLORS: Record<string, string> = {
  development:    'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  database:       'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  security:       'bg-red-500/10 text-red-400 border border-red-500/20',
  language:       'bg-green-500/10 text-green-400 border border-green-500/20',
  general:        'bg-gray-500/10 text-gray-400 border border-gray-500/20',
  devops:         'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
  data:           'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  architecture:   'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  prompt:         'bg-pink-500/10 text-pink-400 border border-pink-500/20',
  performance:    'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  documentation:  'bg-teal-500/10 text-teal-400 border border-teal-500/20',
  learning:       'bg-lime-500/10 text-lime-400 border border-lime-500/20',
}

const CATEGORY_ICONS: Record<string, string> = {
  development:    '⚙️',
  database:       '🗄️',
  security:       '🔒',
  language:       '🌐',
  general:        '📦',
  devops:         '🚀',
  data:           '📊',
  architecture:   '🏗️',
  prompt:         '✨',
  performance:    '⚡',
  documentation:  '📝',
  learning:       '📚',
}

// 市场技能分类名
const CATEGORY_LABELS: Record<string, string> = {
  development:    '开发',
  database:       '数据库',
  security:       '安全',
  language:       '语言',
  general:        '通用',
  devops:         'DevOps',
  data:           '数据分析',
  architecture:   '架构设计',
  prompt:         'Prompt 工程',
  performance:    '性能优化',
  documentation:  '文档',
  learning:       '学习',
}

// ── Registry 数据源类型 ──
interface RegistrySource {
  id: string
  name: string
  description: string
  url: string
  icon?: string
  official?: boolean
}

// ── 顶部说明 Banner ──
function SkillBanner() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-3 bg-gradient-to-r from-blue-500/6 to-indigo-500/6 border border-blue-500/15 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-500/15 flex items-center justify-center shrink-0">
            <Zap className="w-3 h-3 text-blue-400" />
          </div>
          <span className="text-xs font-medium text-blue-300">技能 vs MCP 工具</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-blue-400/60 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3.5 pb-3 border-t border-blue-500/10 pt-2.5 space-y-2">
          <div className="flex items-start gap-2">
            <div className="w-4 h-4 rounded bg-blue-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[10px] text-blue-400 font-bold">S</span>
            </div>
            <div className="text-xs text-blue-300/80 leading-relaxed">
              <strong>技能</strong>：快捷 Prompt 模板，输入 <code className="text-blue-300 bg-blue-500/15 px-1 rounded">/命令</code> 后展开发送给 AI
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-4 h-4 rounded bg-purple-500/15 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[10px] text-purple-400 font-bold">M</span>
            </div>
            <div className="text-xs text-blue-300/80 leading-relaxed">
              <strong>MCP 工具</strong>：给 AI 增加真实工具能力（读文件、查数据库等）
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 市场技能卡片 ──
interface MarketSkillItem {
  id: string
  name: string
  description: string
  category?: string
  slashCommand?: string
  type: string
  author?: string
  version?: string
  tags?: string[]
  downloadUrl?: string
  promptTemplate?: string
  systemPromptAddition?: string
  compatibleProviders?: string[] | 'all'
}

function MarketSkillCard({
  item,
  installed,
  installing,
  onInstall,
}: {
  item: MarketSkillItem
  installed: boolean
  installing: boolean
  onInstall: () => void
}) {
  const catColor = CATEGORY_COLORS[item.category || 'general'] || CATEGORY_COLORS.general
  const catLabel = CATEGORY_LABELS[item.category || 'general'] || item.category || '通用'
  const catIcon = CATEGORY_ICONS[item.category || 'general'] || '📦'

  return (
    <div className="group border border-border rounded-lg bg-bg-tertiary hover:border-accent-blue/30 hover:bg-bg-secondary transition-all duration-200 overflow-hidden">
      {/* 顶部色带 */}
      <div className="h-0.5 bg-gradient-to-r from-accent-blue/40 to-accent-purple/40 opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="p-3.5">
        {/* 顶部：名称 + 斜杠命令 */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-text-primary truncate">{item.name}</span>
              {item.slashCommand && (
                <span className="text-[11px] font-mono text-accent-blue bg-accent-blue/10 px-1.5 py-0.5 rounded border border-accent-blue/20 flex-shrink-0">
                  /{item.slashCommand}
                </span>
              )}
            </div>
          </div>

          {/* 安装按钮 */}
          <div className="flex-shrink-0">
            {installed ? (
              <span className="flex items-center gap-1 text-[11px] text-accent-green bg-accent-green/10 border border-accent-green/20 px-2 py-0.5 rounded-md">
                <Check className="w-3 h-3" strokeWidth={2.5} />
                已安装
              </span>
            ) : (
              <button
                onClick={onInstall}
                disabled={installing}
                className="px-2.5 py-0.5 text-[11px] bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors whitespace-nowrap btn-transition"
              >
                {installing ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    安装中
                  </span>
                ) : '+ 安装'}
              </button>
            )}
          </div>
        </div>

        {/* 描述 */}
        <p className="text-xs text-text-secondary leading-relaxed mb-2.5 line-clamp-2">{item.description}</p>

        {/* 底部元信息 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 ${catColor}`}>
            {catIcon} {catLabel}
          </span>
          {item.type && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 ${TYPE_COLORS[item.type] || 'bg-bg-hover text-text-secondary'}`}>
              {item.type}
            </span>
          )}
          <div className="flex-1" />
          {item.author && (
            <span className="text-[11px] text-text-muted truncate">{item.author}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 技能市场 Tab ──
function MarketplaceTab({ installedSkills, onInstalled }: { installedSkills: Skill[]; onInstalled: () => void }) {
  const [items, setItems] = useState<MarketSkillItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set())
  const [successIds, setSuccessIds] = useState<Set<string>>(new Set())
  const [filterCat, setFilterCat] = useState('all')
  const [searchQ, setSearchQ] = useState('')
  const [sources, setSources] = useState<RegistrySource[]>([])
  const [activeSource, setActiveSource] = useState<string>('all')

  const installedIds = new Set((installedSkills ?? []).map(s => s.id))

  const [sourcesLoaded, setSourcesLoaded] = useState(false)

  useEffect(() => {
    loadSources().then(() => setSourcesLoaded(true))
  }, [])

  useEffect(() => {
    if (sourcesLoaded) fetchMarket()
  }, [activeSource, sourcesLoaded])

  const loadSources = async () => {
    try {
      const spectrAI = (window as any).spectrAI
      const result = await spectrAI?.registry?.getSources?.()
      if (Array.isArray(result)) {
        setSources(result)
      }
    } catch {}
  }

  const fetchMarket = async () => {
    setLoading(true)
    setError(null)
    const startTime = Date.now()
    
    try {
      const spectrAI = (window as any).spectrAI
      let result: any[] = []

      // 超时保护：前端设 30s，给主进程（10s超时 + fallback降级）足够时间返回
      const withTimeout = <T,>(promise: Promise<T>, timeoutMs = 30000): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
          )
        ])
      }

      if (activeSource === 'all') {
        // 合并所有数据源
        const fetchPromises: Promise<any[]>[] = [
          // 默认 registry（含内置 fallback）
          withTimeout<any[]>(spectrAI?.registry?.fetchSkills?.()?.catch(() => []) ?? Promise.resolve([]))
            .catch(() => []),
        ]
        // 各个数据源
        for (const s of sources) {
          fetchPromises.push(
            withTimeout<any[]>(spectrAI?.registry?.fetchSkillsFromSource?.(s.id)?.catch(() => []) ?? Promise.resolve([]))
              .catch(() => [])
          )
        }
        const allResults = await Promise.allSettled(fetchPromises)
        const merged = new Map<string, MarketSkillItem>()
        for (const r of allResults) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            for (const item of r.value) {
              if (!merged.has(item.id)) merged.set(item.id, item)
            }
          }
        }
        result = Array.from(merged.values())
        console.log('[SkillManager] fetched from all sources:', result.length, 'skills, took', Date.now() - startTime, 'ms')
      } else {
        // 单个数据源也要加超时保护（30s 给主进程 fallback 足够时间）
        result = await withTimeout<any[]>(
          spectrAI?.registry?.fetchSkillsFromSource?.(activeSource)?.catch(() => []) ?? Promise.resolve([])
        ).catch(() => [])
        console.log('[SkillManager] fetched from source', activeSource, ':', result.length, 'skills, took', Date.now() - startTime, 'ms')
      }

      if (Array.isArray(result) && result.length > 0) {
        setItems(result)
      } else if (Array.isArray(result) && result.length === 0) {
        // 结果为空数组，保留空状态（不报错）
        setItems([])
      } else {
        setItems([])
        setError('暂无数据，请检查网络或 Registry URL 配置')
      }
    } catch (e: any) {
      console.error('[SkillManager] fetchMarket error:', e)
      setError(e.message || '加载失败')
    } finally {
      console.log('[SkillManager] fetchMarket finally, setting loading=false, took', Date.now() - startTime, 'ms')
      setLoading(false)
    }
  }

  const handleInstall = async (item: MarketSkillItem) => {
    setInstallingIds(prev => new Set(prev).add(item.id))
    try {
      const spectrAI = (window as any).spectrAI
      let result: { success: boolean; error?: string } | null = null

      if (item.downloadUrl) {
        // 优先通过 URL 导入（主进程 fetch + createSkill）
        result = await spectrAI?.registry?.importSkillFromUrl?.(item.downloadUrl)
      }

      if (!result?.success) {
        // 降级：直接用 registry 返回的数据在本地创建
        const now = new Date().toISOString()
        const skillData: Omit<Skill, 'createdAt' | 'updatedAt'> = {
          id: item.id || `skill-${Date.now()}`,
          name: item.name,
          description: item.description || '',
          category: item.category || 'general',
          slashCommand: item.slashCommand,
          type: (item.type || 'prompt') as Skill['type'],
          compatibleProviders: item.compatibleProviders || 'all',
          promptTemplate: item.promptTemplate,
          systemPromptAddition: item.systemPromptAddition,
          author: item.author,
          version: item.version,
          tags: item.tags,
          isInstalled: true,
          isEnabled: true,
          source: 'marketplace',
        }
        result = await spectrAI?.skill?.create?.(skillData)
      }

      if (result?.success) {
        setSuccessIds(prev => new Set(prev).add(item.id))
        onInstalled()
      } else {
        setError(`安装"${item.name}"失败：${result?.error || '未知错误'}`)
      }
    } catch (e: any) {
      setError(`安装失败：${e.message}`)
    } finally {
      setInstallingIds(prev => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  // 分类列表
  const categories = ['all', ...Array.from(new Set(items.map(i => i.category || 'general')))]

  const filtered = items.filter(item => {
    const matchCat = filterCat === 'all' || (item.category || 'general') === filterCat
    const matchSearch = !searchQ || [item.name, item.description, ...(item.tags || [])].some(
      s => s?.toLowerCase().includes(searchQ.toLowerCase())
    )
    return matchCat && matchSearch
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 工具栏：搜索 + 刷新 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索技能名称、描述或标签..."
            className="w-full bg-bg-tertiary border border-border text-text-primary text-xs rounded-lg pl-8 pr-8 py-1.5 focus:outline-none focus:border-accent-blue/60 transition-colors min-w-0 placeholder:text-text-muted"
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
        <button
          onClick={fetchMarket}
          className="px-2.5 py-1.5 text-xs border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-lg transition-colors flex items-center gap-1 shrink-0 btn-transition"
          title="刷新列表"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 数据源选择器 */}
      {sources.length > 0 && (
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1 scrollbar-thin">
          <button
            onClick={() => setActiveSource('all')}
            className={`px-2.5 py-1 text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 flex items-center gap-1 ${
              activeSource === 'all'
                ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
                : 'bg-bg-tertiary text-text-muted hover:text-text-secondary border border-transparent hover:border-border'
            }`}
          >
            <Database className="w-3 h-3" />
            全部市场
          </button>
          <div className="w-px h-4 bg-border shrink-0" />
          {sources.map(source => (
            <button
              key={source.id}
              onClick={() => setActiveSource(source.id)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-all duration-150 whitespace-nowrap shrink-0 flex items-center gap-1 ${
                activeSource === source.id
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-secondary border border-transparent hover:border-border'
              }`}
              title={source.description}
            >
              {source.icon && <span className="text-[11px]">{source.icon}</span>}
              {source.name}
              {source.official && (
                <span className="ml-0.5 text-[9px] bg-accent-blue/20 text-accent-blue px-1 py-0 rounded-full leading-tight">官方</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 分类过滤标签栏 */}
      {items.length > 0 && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-2.5 py-1 text-xs rounded-lg transition-all duration-150 flex items-center gap-1 ${
                filterCat === cat
                  ? 'bg-accent-blue text-white shadow-sm shadow-accent-blue/20'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-secondary border border-transparent hover:border-border'
              }`}
            >
              {cat === 'all' ? '📋' : (CATEGORY_ICONS[cat] || '📦')}
              {cat === 'all' ? '全部' : (CATEGORY_LABELS[cat] || cat)}
            </button>
          ))}
          <div className="flex-1" />
          <span className="text-[11px] text-text-muted shrink-0">
            {filtered.length} 个技能
            {activeSource !== 'all' && ` · ${sources.find(s => s.id === activeSource)?.name || activeSource}`}
          </span>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-accent-red/5 border border-accent-red/20 rounded-lg text-xs text-accent-red">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-accent-red/60 hover:text-accent-red shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 列表 */}
      {loading ? null : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-12">
          <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center mb-3">
            <Inbox className="w-7 h-7 text-text-muted/40" strokeWidth={1.5} />
          </div>
          <div className="text-sm text-text-secondary mb-1">
            {items.length === 0 ? '暂无市场技能' : '没有匹配的技能'}
          </div>
          {items.length === 0 && (
            <div className="text-xs text-text-muted text-center max-w-xs leading-relaxed">
              请在设置中配置 Registry URL，或检查网络连接
            </div>
          )}
          {items.length > 0 && (
            <button
              onClick={() => { setFilterCat('all'); setSearchQ('') }}
              className="mt-2 text-xs text-accent-blue hover:text-accent-blue/80 transition-colors btn-transition"
            >
              清除筛选条件 →
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto grid grid-cols-1 xl:grid-cols-2 gap-2 pb-4 content-start">
          {filtered.map(item => (
            <MarketSkillCard
              key={item.id}
              item={item}
              installed={installedIds.has(item.id) || successIds.has(item.id)}
              installing={installingIds.has(item.id)}
              onInstall={() => handleInstall(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SkillManager() {
  const skills = useSkillStore(s => s.skills)
  const loading = useSkillStore(s => s.loading)
  const error = useSkillStore(s => s.error)
  const fetchAll = useSkillStore(s => s.fetchAll)
  const create = useSkillStore(s => s.create)
  const update = useSkillStore(s => s.update)
  const remove = useSkillStore(s => s.remove)
  const toggle = useSkillStore(s => s.toggle)
  const clearError = useSkillStore(s => s.clearError)
  const [mainTab, setMainTab] = useState<'mine' | 'market'>('mine')
  const [activeType, setActiveType] = useState('all')
  const [showEditor, setShowEditor] = useState(false)
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)

  useEffect(() => { fetchAll() }, [])

  const skillsArray = Array.isArray(skills) ? skills : []
  const filteredSkills = skillsArray.filter(s => {
    if (activeType === 'all')     return true
    if (activeType === 'builtin') return s.source === 'builtin'
    return s.type === activeType
  })

  const enabledCount = skillsArray.filter(s => s.isEnabled).length

  return (
    <div className="flex flex-col h-full p-4 min-w-0">

      {/* 顶部区域 */}
      <div className="mb-3">
        {/* 标题行 */}
        <div className="flex items-start justify-between gap-3 mb-2.5 min-w-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-primary">技能库</h2>
            <p className="text-xs text-text-muted mt-0.5">
              通过 <code className="text-accent-blue bg-accent-blue/10 px-1 py-0.5 rounded text-[11px] font-mono">/命令</code> 在任意会话中调用技能模板
            </p>
          </div>
          {mainTab === 'mine' && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowImportDialog(true)}
                className="px-2.5 py-1.5 border border-border hover:border-accent-blue/50 text-text-secondary hover:text-text-primary text-xs rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap btn-transition"
              >
                <Upload className="w-3.5 h-3.5" />
                导入
              </button>
              <button
                onClick={() => { setEditingSkill(null); setShowEditor(true) }}
                className="px-2.5 py-1.5 bg-accent-blue hover:bg-accent-blue/80 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5 font-medium whitespace-nowrap btn-transition"
              >
                <Plus className="w-3 h-3" strokeWidth={2.5} />
                新建
              </button>
            </div>
          )}
        </div>

        {/* 统计栏 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-[11px] text-text-muted bg-bg-tertiary border border-border rounded-md px-2 py-1">
            <Zap className="w-3 h-3 text-accent-blue shrink-0" />
            <span>{skillsArray.length} 技能</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-text-muted bg-bg-tertiary border border-border rounded-md px-2 py-1">
            <CheckCircle className="w-3 h-3 text-accent-green shrink-0" />
            <span>{enabledCount} 启用</span>
          </div>
        </div>
      </div>

      {/* 主 Tab 导航 */}
      <div className="flex items-center gap-0.5 mb-3 p-0.5 bg-bg-tertiary border border-border rounded-lg w-fit">
        <button
          onClick={() => setMainTab('mine')}
          className={`px-3 py-1.5 text-xs rounded-md transition-all duration-150 flex items-center gap-1.5 ${
            mainTab === 'mine'
              ? 'bg-bg-secondary text-text-primary shadow-sm border border-border'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <Bookmark className="w-3.5 h-3.5" />
          我的技能
          {skills.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              mainTab === 'mine' ? 'bg-accent-blue/15 text-accent-blue' : 'bg-bg-hover text-text-muted'
            }`}>
              {skills.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab('market')}
          className={`px-3 py-1.5 text-xs rounded-md transition-all duration-150 flex items-center gap-1.5 ${
            mainTab === 'market'
              ? 'bg-bg-secondary text-text-primary shadow-sm border border-border'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <Store className="w-3.5 h-3.5" />
          技能市场
        </button>
      </div>

      {/* 我的技能 Tab */}
      {mainTab === 'mine' && (
        <>
          {/* 说明 Banner */}
          <SkillBanner />

          {/* 错误提示 */}
          {error && (
            <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-accent-red/5 border border-accent-red/20 rounded-lg text-xs text-accent-red">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
              <button onClick={clearError} className="text-accent-red/60 hover:text-accent-red shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 类型过滤标签栏 */}
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            {SKILL_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveType(t.id)}
                className={`px-2.5 py-1 text-xs rounded-lg transition-all duration-150 ${
                  activeType === t.id
                    ? 'bg-accent-blue text-white shadow-sm shadow-accent-blue/20'
                    : 'bg-bg-tertiary text-text-muted hover:text-text-secondary border border-transparent hover:border-border'
                }`}
              >
                {t.label}
              </button>
            ))}
            {filteredSkills.length > 0 && (
              <span className="ml-auto text-[11px] text-text-muted self-center">
                {filteredSkills.length} 个结果
              </span>
            )}
          </div>

          {/* Skill 列表 */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-text-muted text-xs py-8">
              <Loader2 className="w-4 h-4 animate-spin text-accent-blue mr-2" />
              加载中...
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-12">
              <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center mb-3">
                <Zap className="w-7 h-7 text-text-muted/40" strokeWidth={1.5} />
              </div>
              <div className="text-sm text-text-secondary mb-1">暂无技能</div>
              <div className="text-xs text-text-muted text-center max-w-xs mb-4 leading-relaxed">
                点击「新建」创建，或前往「技能市场」一键安装
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditingSkill(null); setShowEditor(true) }}
                  className="px-3 py-1.5 bg-accent-blue hover:bg-accent-blue/80 text-white text-xs rounded-lg transition-colors font-medium btn-transition"
                >
                  + 新建技能
                </button>
                <button
                  onClick={() => setMainTab('market')}
                  className="px-3 py-1.5 border border-border hover:border-accent-blue/50 text-text-secondary hover:text-text-primary text-xs rounded-lg transition-colors btn-transition"
                >
                  去技能市场 →
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-1.5 pb-4">
              {filteredSkills.map(skill => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onToggle={(enabled) => toggle(skill.id, enabled)}
                  onEdit={() => { setEditingSkill(skill); setShowEditor(true) }}
                  onDelete={() => remove(skill.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* 技能市场 Tab */}
      {mainTab === 'market' && (
        <MarketplaceTab
          installedSkills={skillsArray}
          onInstalled={fetchAll}
        />
      )}

      {/* 编辑弹窗 */}
      {showEditor && (
        <SkillEditorDialog
          skill={editingSkill}
          onClose={() => { setShowEditor(false); setEditingSkill(null) }}
          onSave={async (data) => {
            if (editingSkill) {
              await update(editingSkill.id, data)
            } else {
              await create(data as any)
            }
            setShowEditor(false)
            setEditingSkill(null)
          }}
        />
      )}
      {showImportDialog && (
        <SkillImportDialog
          onClose={() => setShowImportDialog(false)}
          onImported={() => fetchAll()}
        />
      )}
    </div>
  )
}

// ── Skill 卡片 ──
function SkillCard({ skill, onToggle, onEdit, onDelete }: {
  skill: Skill
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const isBuiltin = skill.source === 'builtin'

  return (
    <div className={`group border rounded-lg px-3.5 py-2.5 flex items-center gap-3 transition-all duration-150 ${
      skill.isEnabled
        ? 'border-border/60 bg-bg-tertiary hover:border-accent-blue/30 hover:bg-bg-secondary'
        : 'border-border/30 bg-bg-tertiary/50 opacity-50'
    }`}>
      {/* 斜杠命令徽章 */}
      <div className="flex-shrink-0">
        <div className={`text-sm font-mono font-semibold px-2 py-1 rounded-md min-w-[72px] text-center transition-colors ${
          skill.isEnabled
            ? 'text-accent-blue bg-accent-blue/10 border border-accent-blue/20'
            : 'text-text-muted bg-bg-hover border border-border/50'
        }`}>
          {skill.slashCommand ? `/${skill.slashCommand}` : '—'}
        </div>
      </div>

      {/* 主信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className="text-sm font-medium text-text-primary">{skill.name}</span>
          {isBuiltin && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-purple/10 text-accent-purple border border-accent-purple/20">内置</span>
          )}
          {skill.source === 'marketplace' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">市场</span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_COLORS[skill.type] || 'bg-bg-hover text-text-secondary'}`}>
            {skill.type}
          </span>
        </div>
        <div className="text-xs text-text-muted leading-relaxed line-clamp-1">{skill.description || <span className="italic">暂无描述</span>}</div>
      </div>

      {/* 操作按钮组 */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {!isBuiltin && (
          <button
            onClick={onEdit}
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="编辑"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        {!isBuiltin && (
          <button
            onClick={onDelete}
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
            title="删除"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 开关（始终显示，不随 hover 隐藏） */}
      <div className="flex-shrink-0">
        {isBuiltin ? (
          <div className="w-6 h-6 flex items-center justify-center text-text-muted/30" title="内置技能不可禁用">
            <Lock className="w-3 h-3" />
          </div>
        ) : (
          <button
            onClick={() => onToggle(!skill.isEnabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors btn-transition ${
              skill.isEnabled ? 'bg-accent-blue' : 'bg-bg-tertiary border border-border'
            }`}
            title={skill.isEnabled ? '点击禁用' : '点击启用'}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
              skill.isEnabled ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </button>
        )}
      </div>
    </div>
  )
}

// 预览时变量示例值映射
const PREVIEW_EXAMPLES: Record<string, string> = {
  user_input:   '用户输入的内容示例',
  file_content: '[文件内容]',
  selection:    '[选中的文本]',
}

/** 将模板中的 {{变量名}} 替换为示例值 */
function renderPreview(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    PREVIEW_EXAMPLES[name] !== undefined ? PREVIEW_EXAMPLES[name] : `[${name}]`
  )
}

// ── Orchestration Step 类型 ──
interface OrchestrationStep {
  id: string
  name: string
  providerId: string
  prompt: string
  dependsOn: string[]
}

// ── 创建/编辑技能弹窗 ──
function SkillEditorDialog({ skill, onClose, onSave }: {
  skill: Skill | null
  onClose: () => void
  onSave: (data: Partial<Skill>) => Promise<void>
}) {
  const isEdit = !!skill

  const [form, setForm] = useState({
    name:                skill?.name || '',
    description:         skill?.description || '',
    category:            skill?.category || 'general',
    slashCommand:        skill?.slashCommand || '',
    type:                (skill?.type || 'prompt') as Skill['type'],
    compatibleProviders: skill?.compatibleProviders || ('all' as string[] | 'all'),
    promptTemplate:      skill?.promptTemplate || '',
    systemPromptAddition: skill?.systemPromptAddition || '',
    // ---- Native Skill ----
    nativeProviderId:    skill?.nativeConfig?.providerId || '',
    nativeRawContent:    skill?.nativeConfig?.rawContent || '',
    // ---- Orchestration Skill ----
    orchestrationMode:   skill?.orchestrationConfig?.mode || 'sequential',
    orchestrationSteps:  (skill?.orchestrationConfig?.steps || []) as unknown as OrchestrationStep[],
  })
  const [allProviders, setAllProviders] = useState(!skill || skill.compatibleProviders === 'all')
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // textarea ref，用于光标位置插入
  const templateRef = useRef<HTMLTextAreaElement>(null)

  const PROVIDERS = ['claude-code', 'codex', 'gemini-cli', 'iflow', 'opencode', 'qwen-coder']

  /** 在光标处插入变量占位符 */
  const insertVariable = (varName: string) => {
    const textarea = templateRef.current
    if (!textarea) return
    const start = textarea.selectionStart ?? form.promptTemplate.length
    const end   = textarea.selectionEnd   ?? start
    const insertion = `{{${varName}}}`
    const newValue =
      form.promptTemplate.slice(0, start) +
      insertion +
      form.promptTemplate.slice(end)
    setForm(p => ({ ...p, promptTemplate: newValue }))
    // 下一帧恢复焦点并定位光标到插入内容之后
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + insertion.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  /** 弹出自定义变量名输入框，然后插入 */
  const insertCustomVariable = () => {
    const name = window.prompt('请输入变量名（字母、数字、下划线）：')
    if (!name) return
    const cleaned = name.trim().replace(/[^\w]/g, '_')
    if (cleaned) insertVariable(cleaned)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const now = new Date().toISOString()

    // 根据类型构建对应的 config
    const nativeConfig = form.type === 'native' && form.nativeProviderId
      ? { providerId: form.nativeProviderId, rawContent: form.nativeRawContent }
      : undefined

    const orchestrationConfig = form.type === 'orchestration' && form.orchestrationSteps.length > 0
      ? { mode: form.orchestrationMode, steps: form.orchestrationSteps as unknown as Array<Record<string, unknown>> }
      : form.type === 'orchestration'
        ? { mode: form.orchestrationMode, steps: [] }
        : undefined

    await onSave({
      name:                form.name,
      description:         form.description,
      category:            form.category,
      slashCommand:        form.slashCommand,
      type:                form.type,
      compatibleProviders: allProviders
        ? 'all'
        : (Array.isArray(form.compatibleProviders) ? form.compatibleProviders : []),
      promptTemplate:       form.promptTemplate || undefined,
      systemPromptAddition: form.systemPromptAddition || undefined,
      nativeConfig,
      orchestrationConfig,
      isInstalled: true,
      isEnabled:   true,
      source:      'custom',
      id:          skill?.id || `skill-${Date.now()}`,
      createdAt:   skill?.createdAt || now,
      updatedAt:   now,
    })
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-border rounded-xl w-[600px] max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">
            {isEdit ? '编辑技能' : '新建技能'}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* 名称 + 斜杠命令 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">
                技能名称 <span className="text-red-400">*</span>
              </label>
              <input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
                placeholder="如：代码审查"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">/slash 命令</label>
              <div className="flex">
                <span className="px-2 py-2 bg-bg-tertiary border border-r-0 border-border rounded-l-md text-text-secondary text-sm">/</span>
                <input
                  value={form.slashCommand}
                  onChange={e => setForm(p => ({
                    ...p,
                    slashCommand: e.target.value.replace(/[^a-z0-9-]/g, ''),
                  }))}
                  className="flex-1 bg-bg-input border border-border text-text-primary text-sm rounded-r-md px-3 py-2 focus:outline-none focus:border-blue-500"
                  placeholder="code-review"
                />
              </div>
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">描述</label>
            <input
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
              placeholder="简短描述这个技能的功能"
            />
          </div>

          {/* 类型 + 分类 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">类型</label>
              <select
                value={form.type}
                onChange={e => setForm(p => ({ ...p, type: e.target.value as any }))}
                className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                <option value="prompt">Prompt 技能（展开模板发送给 AI）</option>
                <option value="native">原生技能（使用 Provider 特定功能）</option>
                <option value="orchestration">编排技能（多 AI 协作工作流）</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">分类</label>
              <input
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
                placeholder="如：development, language"
              />
            </div>
          </div>

          {/* 兼容 Provider */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">兼容 Provider</label>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="skill-all-providers"
                checked={allProviders}
                onChange={e => setAllProviders(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="skill-all-providers" className="text-xs text-text-secondary">所有 Provider</label>
              {allProviders && (
                <span className="text-xs text-text-muted">技能会向所有 AI 发送相同 Prompt</span>
              )}
            </div>
            {!allProviders && (
              <div className="flex flex-wrap gap-3">
                {PROVIDERS.map(pid => (
                  <label key={pid} className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Array.isArray(form.compatibleProviders) && form.compatibleProviders.includes(pid)}
                      onChange={e => {
                        const curr = Array.isArray(form.compatibleProviders) ? form.compatibleProviders : []
                        setForm(p => ({
                          ...p,
                          compatibleProviders: e.target.checked
                            ? [...curr, pid]
                            : curr.filter(x => x !== pid),
                        }))
                      }}
                      className="rounded"
                    />
                    {PROVIDER_LABELS[pid] || pid}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Prompt 模板（仅 prompt 类型） */}
          {form.type === 'prompt' && (
            <>
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">提示词模板</label>

                {/* 变量快速插入工具栏 */}
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <span className="text-xs text-text-muted mr-0.5">插入变量：</span>
                  {(['user_input', 'file_content', 'selection'] as const).map(varName => (
                    <button
                      key={varName}
                      type="button"
                      onClick={() => insertVariable(varName)}
                      className="px-2 py-1 text-xs bg-bg-hover hover:bg-bg-tertiary text-text-secondary rounded transition-colors font-mono"
                    >
                      {`{{${varName}}}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={insertCustomVariable}
                    className="px-2 py-1 text-xs bg-bg-hover hover:bg-bg-tertiary text-text-secondary rounded transition-colors"
                  >
                    + 自定义
                  </button>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setShowPreview(v => !v)}
                    className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                      showPreview
                        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/30'
                        : 'bg-bg-hover hover:bg-bg-tertiary text-text-secondary'
                    }`}
                  >
                    {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showPreview ? '隐藏预览' : '预览'}
                  </button>
                </div>

                <textarea
                  ref={templateRef}
                  value={form.promptTemplate}
                  onChange={e => setForm(p => ({ ...p, promptTemplate: e.target.value }))}
                  rows={8}
                  className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 font-mono resize-y"
                  placeholder={'请对以下代码进行审查：\n\n{{user_input}}\n\n重点关注：\n1. 逻辑正确性\n2. 性能\n3. 安全性'}
                />

                {/* 占位符提示 */}
                <p className="text-xs text-text-muted mt-1">
                  支持 <code className="text-text-secondary bg-bg-hover px-1 rounded">{`{{变量名}}`}</code> 占位符，触发技能时会提示用户输入
                </p>

                {/* 预览区域 */}
                {showPreview && (
                  <div className="mt-2">
                    <div className="text-xs text-text-muted mb-1">预览效果（变量已替换为示例值）：</div>
                    <div className="bg-bg-input border border-border rounded p-3 text-sm text-text-primary whitespace-pre-wrap font-mono leading-relaxed">
                      {form.promptTemplate
                        ? renderPreview(form.promptTemplate)
                        : <span className="text-text-muted italic">（模板为空）</span>
                      }
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-text-secondary mb-1.5">系统提示词补充（可选）</label>
                <textarea
                  value={form.systemPromptAddition}
                  onChange={e => setForm(p => ({ ...p, systemPromptAddition: e.target.value }))}
                  rows={3}
                  className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 font-mono resize-y"
                  placeholder="追加到系统提示词的内容（可选）"
                />
              </div>
            </>
          )}

          {/* Orchestration 类型编辑器 */}
          {form.type === 'orchestration' && (
            <div className="space-y-3">
              {/* 执行模式选择 */}
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">执行模式</label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="radio"
                      name="orch-mode"
                      checked={form.orchestrationMode === 'sequential'}
                      onChange={() => setForm(p => ({ ...p, orchestrationMode: 'sequential' }))}
                    />
                    顺序执行
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="radio"
                      name="orch-mode"
                      checked={form.orchestrationMode === 'parallel'}
                      onChange={() => setForm(p => ({ ...p, orchestrationMode: 'parallel' }))}
                    />
                    并行执行
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="radio"
                      name="orch-mode"
                      checked={form.orchestrationMode === 'dag'}
                      onChange={() => setForm(p => ({ ...p, orchestrationMode: 'dag' }))}
                    />
                    DAG 依赖
                  </label>
                </div>
              </div>

              {/* 步骤列表 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-text-secondary">编排步骤</label>
                  <button
                    type="button"
                    onClick={() => {
                      const newStep: OrchestrationStep = {
                        id: `step-${Date.now()}`,
                        name: `步骤 ${form.orchestrationSteps.length + 1}`,
                        providerId: '',
                        prompt: '',
                        dependsOn: [],
                      }
                      setForm(p => ({ ...p, orchestrationSteps: [...p.orchestrationSteps, newStep] }))
                    }}
                    className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" strokeWidth={2.5} />
                    添加步骤
                  </button>
                </div>

                {form.orchestrationSteps.length === 0 ? (
                  <div className="text-xs text-text-muted bg-bg-tertiary border border-border rounded-md px-3 py-4 text-center">
                    暂无步骤，点击「添加步骤」开始编排
                  </div>
                ) : (
                  <div className="space-y-2">
                    {form.orchestrationSteps.map((step, idx) => (
                      <div key={step.id} className="border border-border rounded-lg px-3 py-2.5 bg-bg-tertiary space-y-2">
                        {/* 步骤头部 */}
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-text-muted bg-bg-hover px-1.5 py-0.5 rounded font-mono">#{idx + 1}</span>
                          <input
                            value={step.name}
                            onChange={e => {
                              const updated = [...form.orchestrationSteps]
                              updated[idx] = { ...updated[idx], name: e.target.value }
                              setForm(p => ({ ...p, orchestrationSteps: updated }))
                            }}
                            className="flex-1 bg-bg-input border border-border text-text-primary text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500 min-w-0"
                            placeholder="步骤名称"
                          />
                          {/* 上移/下移/删除 */}
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => {
                              const updated = [...form.orchestrationSteps]
                              ;[updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]]
                              setForm(p => ({ ...p, orchestrationSteps: updated }))
                            }}
                            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                            title="上移"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={idx === form.orchestrationSteps.length - 1}
                            onClick={() => {
                              const updated = [...form.orchestrationSteps]
                              ;[updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]]
                              setForm(p => ({ ...p, orchestrationSteps: updated }))
                            }}
                            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                            title="下移"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = form.orchestrationSteps.filter((_, i) => i !== idx)
                              setForm(p => ({ ...p, orchestrationSteps: updated }))
                            }}
                            className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-accent-red transition-colors"
                            title="删除"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Provider 选择 */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-text-muted mb-0.5">Provider</label>
                            <select
                              value={step.providerId}
                              onChange={e => {
                                const updated = [...form.orchestrationSteps]
                                updated[idx] = { ...updated[idx], providerId: e.target.value }
                                setForm(p => ({ ...p, orchestrationSteps: updated }))
                              }}
                              className="w-full bg-bg-input border border-border text-text-primary text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                            >
                              <option value="">当前会话 Provider</option>
                              {PROVIDERS.map(pid => (
                                <option key={pid} value={pid}>{PROVIDER_LABELS[pid] || pid}</option>
                              ))}
                            </select>
                          </div>
                          {/* DAG 依赖选择 */}
                          {form.orchestrationMode === 'dag' && (
                            <div>
                              <label className="block text-[10px] text-text-muted mb-0.5">依赖步骤</label>
                              <div className="flex flex-wrap gap-1">
                                {form.orchestrationSteps
                                  .filter((_, i) => i !== idx)
                                  .map(s => (
                                    <label key={s.id} className="flex items-center gap-0.5 text-[10px] text-text-secondary cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={step.dependsOn.includes(s.id)}
                                        onChange={e => {
                                          const updated = [...form.orchestrationSteps]
                                          updated[idx] = {
                                            ...updated[idx],
                                            dependsOn: e.target.checked
                                              ? [...updated[idx].dependsOn, s.id]
                                              : updated[idx].dependsOn.filter(id => id !== s.id),
                                          }
                                          setForm(p => ({ ...p, orchestrationSteps: updated }))
                                        }}
                                      />
                                      {s.name || `#${form.orchestrationSteps.indexOf(s) + 1}`}
                                    </label>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Prompt */}
                        <div>
                          <label className="block text-[10px] text-text-muted mb-0.5">Prompt 模板</label>
                          <textarea
                            value={step.prompt}
                            onChange={e => {
                              const updated = [...form.orchestrationSteps]
                              updated[idx] = { ...updated[idx], prompt: e.target.value }
                              setForm(p => ({ ...p, orchestrationSteps: updated }))
                            }}
                            rows={2}
                            className="w-full bg-bg-input border border-border text-text-primary text-xs rounded px-2 py-1 focus:outline-none focus:border-blue-500 font-mono resize-y"
                            placeholder="此步骤发送给 AI 的提示词..."
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-xs text-text-muted mt-1">
                  编排技能触发时，按{form.orchestrationMode === 'sequential' ? '顺序' : form.orchestrationMode === 'parallel' ? '并行' : '依赖关系'}依次或同时执行各步骤。
                </p>
              </div>
            </div>
          )}

          {/* Native 类型编辑器 */}
          {form.type === 'native' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1.5">目标 Provider</label>
                <select
                  value={form.nativeProviderId}
                  onChange={e => setForm(p => ({ ...p, nativeProviderId: e.target.value }))}
                  className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
                >
                  <option value="">选择 Provider...</option>
                  {PROVIDERS.map(pid => (
                    <option key={pid} value={pid}>{PROVIDER_LABELS[pid] || pid}</option>
                  ))}
                </select>
                <p className="text-xs text-text-muted mt-1">
                  选择需要使用的 AI Provider，技能触发时直接将原始内容透传给该 Provider
                </p>
              </div>

              <div>
                <label className="block text-xs text-text-secondary mb-1.5">原始内容 (rawContent)</label>
                <textarea
                  value={form.nativeRawContent}
                  onChange={e => setForm(p => ({ ...p, nativeRawContent: e.target.value }))}
                  rows={6}
                  className="w-full bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500 font-mono resize-y"
                  placeholder="直接发送给 Provider 的原始内容，支持 {{user_input}} 等变量占位符"
                />
                <p className="text-xs text-text-muted mt-1">
                  原生技能的内容将直接透传给所选 Provider 处理，适合 Provider 特定的功能调用
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {saving ? '保存中...' : (isEdit ? '更新' : '创建')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 从 URL 导入技能弹窗 ──
function SkillImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFetchPreview = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      const res = await fetch(url.trim())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.name || !data.type) throw new Error('无效的 Skill 格式')
      setPreview(data)
    } catch (e: any) {
      setError(e.message || '获取失败')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const result = await (window as any).spectrAI?.registry?.importSkillFromUrl?.(url.trim())
      if (result?.success) {
        onImported()
        onClose()
      } else {
        setError(result?.error || '导入失败')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-secondary border border-border rounded-xl w-[520px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">从 URL 导入技能</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">Skill JSON URL</label>
            <div className="flex gap-2">
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFetchPreview()}
                className="flex-1 bg-bg-input border border-border text-text-primary text-sm rounded-md px-3 py-2 focus:outline-none focus:border-blue-500"
                placeholder="https://raw.githubusercontent.com/..."
              />
              <button
                onClick={handleFetchPreview}
                disabled={loading || !url.trim()}
                className="px-3 py-2 text-sm bg-bg-hover hover:bg-bg-hover disabled:opacity-50 text-text-primary rounded-md transition-colors whitespace-nowrap"
              >
                {loading ? '获取中...' : '获取预览'}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          {preview && (
            <div className="bg-bg-tertiary border border-border rounded-lg px-4 py-3 space-y-1.5">
              <div className="text-xs text-text-muted mb-2">预览</div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{preview.name}</span>
                {preview.slashCommand && (
                  <span className="text-xs font-mono text-accent-blue bg-accent-blue/10 px-1.5 py-0.5 rounded border border-accent-blue/20">
                    /{preview.slashCommand}
                  </span>
                )}
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  preview.type === 'orchestration' ? 'bg-accent-purple/15 text-accent-purple' : 'bg-accent-blue/15 text-accent-blue'
                }`}>
                  {preview.type}
                </span>
              </div>
              {preview.description && (
                <div className="text-xs text-text-muted">{preview.description}</div>
              )}
              {preview.author && (
                <div className="text-xs text-text-muted">作者：{preview.author}</div>
              )}
            </div>
          )}

          <div className="text-xs text-text-muted">
            支持格式：标准 SpectrAI Skill JSON（含 name、type、promptTemplate 等字段）
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-text-secondary hover:text-text-primary">取消</button>
          <button
            onClick={handleImport}
            disabled={!preview || importing}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {importing ? '导入中...' : '确认导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
