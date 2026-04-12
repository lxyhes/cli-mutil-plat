/**
 * Skill 技能模板管理页面
 * 通过 /命令 在任意 Provider 的会话中调用技能模板
 * @author weibin
 */
import React, { useState, useEffect, useRef } from 'react'
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

// 市场技能分类标签颜色
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
            <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-blue-300">技能 vs MCP 工具</span>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-blue-400/60 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
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

  return (
    <div className="border border-border rounded-xl p-4 bg-bg-secondary hover:border-blue-500/30 transition-colors">
      {/* 顶部：名称 + 斜杠命令 + 标签 */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-sm font-medium text-text-primary">{item.name}</span>
            {item.slashCommand && (
              <span className="text-xs font-mono text-accent-blue bg-accent-blue/10 px-1.5 py-0.5 rounded border border-accent-blue/20 flex-shrink-0">
                /{item.slashCommand}
              </span>
            )}
          </div>
          {/* 分类标签行 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${catColor}`}>
              {catLabel}
            </span>
            {item.type && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${TYPE_COLORS[item.type] || 'bg-bg-hover text-text-secondary'}`}>
                {item.type}
              </span>
            )}
          </div>
        </div>

        {/* 右侧安装按钮 */}
        <div className="flex-shrink-0">
          {installed ? (
            <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-md">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              已安装
            </span>
          ) : (
            <button
              onClick={onInstall}
              disabled={installing}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors whitespace-nowrap"
            >
              {installing ? (
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  安装中
                </span>
              ) : '+ 安装'}
            </button>
          )}
        </div>
      </div>

      {/* 描述 */}
      <p className="text-xs text-text-secondary leading-relaxed mb-2.5">{item.description}</p>

      {/* 底部元信息 */}
      <div className="flex items-center gap-2 flex-wrap">
        {item.author && (
          <div className="flex items-center gap-1 text-xs text-text-muted">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {item.author}
          </div>
        )}
        {item.version && (
          <span className="text-xs text-text-muted">v{item.version}</span>
        )}
        {item.tags && item.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap ml-auto">
            {item.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-xs px-1.5 py-0.5 bg-bg-hover text-text-muted rounded border border-border/50">
                #{tag}
              </span>
            ))}
          </div>
        )}
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

  useEffect(() => {
    loadSources()
  }, [])

  useEffect(() => {
    fetchMarket()
  }, [activeSource])

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
    try {
      const spectrAI = (window as any).spectrAI
      let result: any[] = []

      if (activeSource === 'all') {
        // 合并所有数据源
        const allResults = await Promise.allSettled([
          spectrAI?.registry?.fetchSkills?.(),
          ...sources.map(s => spectrAI?.registry?.fetchSkillsFromSource?.(s.id).catch(() => [])),
        ])
        const merged = new Map<string, MarketSkillItem>()
        for (const r of allResults) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            for (const item of r.value) {
              if (!merged.has(item.id)) merged.set(item.id, item)
            }
          }
        }
        result = Array.from(merged.values())
      } else {
        result = await spectrAI?.registry?.fetchSkillsFromSource?.(activeSource)
      }

      if (Array.isArray(result)) {
        setItems(result)
      } else {
        setError('暂无数据，请检查网络或 Registry URL 配置')
      }
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
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

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3">
        <svg className="w-6 h-6 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm">正在加载技能市场...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 工具栏：搜索 + 刷新 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative min-w-0">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="搜索技能..."
            className="w-full bg-bg-input border border-border text-text-primary text-xs rounded-md pl-8 pr-3 py-1.5 focus:outline-none focus:border-accent-blue transition-colors min-w-0"
          />
        </div>
        <button
          onClick={fetchMarket}
          className="px-3 py-1.5 text-xs border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors flex items-center gap-1.5 shrink-0"
          title="刷新列表"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          刷新
        </button>
      </div>

      {/* 数据源选择器 */}
      {sources.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
          <span className="text-xs text-text-muted shrink-0">数据源:</span>
          <button
            onClick={() => setActiveSource('all')}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeSource === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-bg-secondary text-text-muted hover:text-text-secondary border border-border'
            }`}
          >
            全部市场
          </button>
          {sources.map(source => (
            <button
              key={source.id}
              onClick={() => setActiveSource(source.id)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeSource === source.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-bg-secondary text-text-muted hover:text-text-secondary border border-border'
              }`}
              title={source.description}
            >
              {source.icon && <span className="mr-1">{source.icon}</span>}
              {source.name}
              {source.official && (
                <span className="ml-1 text-[10px] opacity-70">官方</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 分类过滤标签栏 */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                filterCat === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-bg-secondary text-text-muted hover:text-text-secondary border border-border'
              }`}
            >
              {cat === 'all' ? '全部' : (CATEGORY_LABELS[cat] || cat)}
            </button>
          ))}
          <div className="ml-auto flex items-center text-xs text-text-muted self-center pr-1">
            共 {filtered.length}{activeSource !== 'all' ? ` (来自 ${sources.find(s => s.id === activeSource)?.name || activeSource})` : ''}
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mb-3 px-3 py-2 bg-accent-red/10 border border-accent-red/30 rounded-lg text-accent-red text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-accent-red hover:text-accent-red ml-2 font-bold">✕</button>
        </div>
      )}

      {/* 列表 */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-10">
          <div className="w-12 h-12 rounded-xl bg-bg-tertiary flex items-center justify-center mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
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
              className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              清除筛选条件 →
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pb-4">
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
  const promptCount = skillsArray.filter(s => s.type === 'prompt').length

  return (
    <div className="flex flex-col h-full p-4 min-w-0">

      {/* 顶部区域 */}
      <div className="mb-4">
        {/* 标题行 */}
        <div className="flex items-start justify-between gap-3 mb-3 min-w-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-primary">技能库</h2>
            <p className="text-xs text-text-muted mt-0.5">
              通过 <code className="text-accent-blue bg-accent-blue/10 px-1 py-0.5 rounded text-xs font-mono">/命令</code> 在任意会话中调用技能模板
            </p>
          </div>
          {mainTab === 'mine' && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowImportDialog(true)}
                className="px-3 py-1.5 border border-border hover:border-accent-blue/50 text-text-secondary hover:text-text-primary text-xs rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                从 URL 导入
              </button>
              <button
                onClick={() => { setEditingSkill(null); setShowEditor(true) }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5 font-medium whitespace-nowrap"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                新建技能
              </button>
            </div>
          )}
        </div>

        {/* 统计栏 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-text-muted bg-bg-secondary border border-border rounded-lg px-2.5 py-1.5">
            <svg className="w-3.5 h-3.5 text-accent-blue shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{skillsArray.length} 个技能</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted bg-bg-secondary border border-border rounded-lg px-2.5 py-1.5">
            <svg className="w-3.5 h-3.5 text-accent-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{enabledCount} 个已启用</span>
          </div>
          {promptCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-text-muted bg-bg-secondary border border-border rounded-lg px-2.5 py-1.5">
              <svg className="w-3.5 h-3.5 text-text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              <span>{promptCount} 个 Prompt</span>
            </div>
          )}
        </div>
      </div>

      {/* 主 Tab 导航 */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-bg-secondary border border-border rounded-lg w-fit">
        <button
          onClick={() => setMainTab('mine')}
          className={`px-4 py-1.5 text-sm rounded-md transition-all duration-150 flex items-center gap-1.5 ${
            mainTab === 'mine'
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          我的技能
          {skills.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              mainTab === 'mine' ? 'bg-white/20 text-white' : 'bg-bg-hover text-text-muted'
            }`}>
              {skills.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setMainTab('market')}
          className={`px-4 py-1.5 text-sm rounded-md transition-all duration-150 flex items-center gap-1.5 ${
            mainTab === 'market'
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/30'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
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
            <div className="mb-3 px-3 py-2 bg-accent-red/10 border border-accent-red/30 rounded-lg text-accent-red text-xs flex items-center justify-between">
              <span>{error}</span>
              <button onClick={clearError} className="text-accent-red hover:text-accent-red ml-2 font-bold">✕</button>
            </div>
          )}

          {/* 类型过滤标签栏 */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {SKILL_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveType(t.id)}
                className={`px-3 py-1 text-xs rounded-md transition-all duration-150 ${
                  activeType === t.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-bg-secondary text-text-muted hover:text-text-secondary border border-border'
                }`}
              >
                {t.label}
              </button>
            ))}
            {filteredSkills.length > 0 && (
              <span className="ml-auto text-xs text-text-muted self-center pr-1">
                {filteredSkills.length} 个结果
              </span>
            )}
          </div>

          {/* Skill 列表 */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-text-muted text-xs py-8">
              <svg className="w-4 h-4 animate-spin text-blue-400 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              加载中...
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted py-10">
              <div className="w-14 h-14 rounded-xl bg-bg-secondary border border-border flex items-center justify-center mb-3">
                <svg className="w-7 h-7 text-text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="text-xs text-text-secondary mb-1">暂无技能</div>
              <div className="text-xs text-text-muted text-center max-w-xs mb-4 leading-relaxed">
                点击「新建技能」创建，或前往「技能市场」一键安装
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setEditingSkill(null); setShowEditor(true) }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors font-medium"
                >
                  + 新建技能
                </button>
                <button
                  onClick={() => setMainTab('market')}
                  className="px-3 py-1.5 border border-border hover:border-accent-blue/50 text-text-secondary hover:text-text-primary text-xs rounded-lg transition-colors"
                >
                  去技能市场看看 →
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 pb-4">
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
    <div className={`border rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-150 ${
      skill.isEnabled
        ? 'border-border/60 bg-bg-secondary hover:border-accent-blue/30'
        : 'border-border/30 bg-bg-tertiary/50 opacity-60'
    }`}>
      {/* 斜杠命令徽章 */}
      <div className="flex-shrink-0">
        <div className="text-sm font-mono font-semibold text-accent-blue bg-accent-blue/10 border border-accent-blue/20 px-2.5 py-1.5 rounded-lg min-w-[80px] text-center">
          {skill.slashCommand ? `/${skill.slashCommand}` : '—'}
        </div>
      </div>

      {/* 主信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-medium text-text-primary">{skill.name}</span>
          {isBuiltin && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-bg-hover text-text-muted">内置</span>
          )}
          {skill.source === 'marketplace' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">市场</span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_COLORS[skill.type] || 'bg-bg-hover text-text-secondary'}`}>
            {skill.type}
          </span>
        </div>
        <div className="text-xs text-text-muted leading-relaxed line-clamp-1">{skill.description || <span className="text-text-muted italic">暂无描述</span>}</div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted mt-0.5 min-w-0">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="text-xs text-text-muted truncate min-w-0 flex-1">
            {skill.compatibleProviders === 'all'
              ? '所有 Provider'
              : Array.isArray(skill.compatibleProviders) && skill.compatibleProviders.length > 0
                ? skill.compatibleProviders.map(p => PROVIDER_LABELS[p] || p).join(', ')
                : '所有 Provider'}
          </span>
        </div>
      </div>

      {/* 操作按钮组 */}
      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
        {!isBuiltin && (
          <button
            onClick={onEdit}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="编辑"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
        {!isBuiltin && (
          <button
            onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
            title="删除"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
        {isBuiltin ? (
          <div className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted/40" title="内置技能不可禁用">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        ) : (
          <button
            onClick={() => onToggle(!skill.isEnabled)}
            className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
              skill.isEnabled ? 'bg-blue-600' : 'bg-bg-tertiary border border-border'
            }`}
            title={skill.isEnabled ? '点击禁用' : '点击启用'}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              skill.isEnabled ? 'translate-x-5' : 'translate-x-1'
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
    await onSave({
      ...form,
      compatibleProviders: allProviders
        ? 'all'
        : (Array.isArray(form.compatibleProviders) ? form.compatibleProviders : []),
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
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
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
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      showPreview
                        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/30'
                        : 'bg-bg-hover hover:bg-bg-tertiary text-text-secondary'
                    }`}
                  >
                    {showPreview ? '隐藏预览' : '👁 预览'}
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

          {/* Orchestration 类型提示 */}
          {form.type === 'orchestration' && (
            <div className="px-3 py-2 bg-accent-purple/10 border border-accent-purple/30 rounded-md text-accent-purple text-xs">
              编排技能的步骤配置需要通过 API 设置，当前 UI 支持基础信息编辑。复杂的多步骤编排建议使用内置模板。
            </div>
          )}

          {/* Native 类型提示 */}
          {form.type === 'native' && (
            <div className="px-3 py-2 bg-green-900/20 border border-green-800/30 rounded-md text-green-400 text-xs">
              原生技能直接调用所选 Provider 的特定功能，行为由 Provider 自身决定。
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
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">✕</button>
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
