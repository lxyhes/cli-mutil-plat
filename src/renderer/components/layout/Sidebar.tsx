/**
 * 左侧边栏 - 任务看板与快速操作
 * 子组件已拆分至 ./sidebar/ 目录
 * @author weibin
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Plus, Terminal, X, FolderOpen, RotateCcw, Play, Square, Search, Star, ChevronDown, ChevronUp, Settings2, Cpu, Pencil, Sparkles, Layers, Trash2, type LucideIcon } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useGitStore } from '../../stores/gitStore'
import type { SessionStatus, AIProvider, Workspace } from '../../../shared/types'
import ProviderManager from '../settings/ProviderManager'
import UnifiedSettingsModal from '../settings/UnifiedSettingsModal'
import DashboardSidebarView from '../sidebar/DashboardSidebarView'
import McpSidebarView from '../sidebar/McpSidebarView'
import SkillsSidebarView from '../sidebar/SkillsSidebarView'
import ToolboxView from '../sidebar/ToolboxView'
import CheckpointView from '../sidebar/CheckpointView'
import CostDashboardView from '../sidebar/CostDashboardView'
import CodeReviewView from '../sidebar/CodeReviewView'
import BattleView from '../sidebar/BattleView'
import ReplayView from '../sidebar/ReplayView'
import ArenaView from '../sidebar/ArenaView'
import ContextBudgetView from '../sidebar/ContextBudgetView'
import DailyReportView from '../sidebar/DailyReportView'
import VoiceView from '../sidebar/VoiceView'
import { TeamSidebarView } from '../team'
import TimelinePanel from '../panels/TimelinePanel'
import StatsPanel from '../panels/StatsPanel'
import { FileManagerPanel } from '../file-manager'
import GitPanel from '../panels/GitPanel'
import { toPlatformShortcutLabel } from '../../utils/shortcut'
import BrandLogo from '../brand/BrandLogo'

// ── 从 sidebar/ 子模块导入 ──
import {
  EXECUTING_STATUSES,
  type GroupByMode,
  type DirGroup,
} from './sidebar/types'
import {
  groupSessionsByTime,
  groupSessionsByDirectory,
  groupSessionsByWorkspace,
} from './sidebar/utils'
import { TimeGroupCard, DirGroupCard } from './sidebar/SessionGroupCards'
import { SessionPickerModal } from './sidebar/SessionPickerModal'
import { GroupByToggle } from './sidebar/GroupByToggle'

type SessionStartTemplate = {
  id: 'blank' | 'review' | 'fix' | 'feature' | 'team'
  title: string
  description: string
  prompt: string
  supervisorMode: boolean
  icon: LucideIcon
  accentClass: string
}

const SESSION_START_TEMPLATES: SessionStartTemplate[] = [
  {
    id: 'blank',
    title: '空白会话',
    description: '先打开会话，稍后再输入任务',
    prompt: '',
    supervisorMode: false,
    icon: Terminal,
    accentClass: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
  },
  {
    id: 'review',
    title: '审视项目',
    description: '快速了解结构、风险和下一步',
    prompt: '请先审视当前项目：梳理项目结构、核心模块、运行方式和最明显的风险点。先不要改代码，最后给出按优先级排序的下一步建议。',
    supervisorMode: false,
    icon: Search,
    accentClass: 'text-accent-purple bg-accent-purple/10 border-accent-purple/30',
  },
  {
    id: 'fix',
    title: '修复问题',
    description: '定位报错、补齐验证、收敛改动',
    prompt: '请帮我定位并修复当前最明显的问题。先复现或确认问题位置，再做最小必要修改，最后运行相关 typecheck/test/build 验证并说明结果。',
    supervisorMode: false,
    icon: Sparkles,
    accentClass: 'text-accent-yellow bg-accent-yellow/10 border-accent-yellow/30',
  },
  {
    id: 'feature',
    title: '实现功能',
    description: '按现有架构落地一个新能力',
    prompt: '请按现有项目架构实现我接下来描述的功能。开始前先确认相关模块和约束，改动保持聚焦，完成后运行必要验证。',
    supervisorMode: false,
    icon: Play,
    accentClass: 'text-accent-green bg-accent-green/10 border-accent-green/30',
  },
  {
    id: 'team',
    title: '团队模式',
    description: '适合多模块、可拆分的大任务',
    prompt: '请以 Supervisor 模式处理这个任务：先拆解目标，识别可以并行推进的子任务，再协调执行、汇总结果并做最终验证。',
    supervisorMode: true,
    icon: Layers,
    accentClass: 'text-accent-blue bg-accent-blue/10 border-accent-blue/30',
  },
]
// ─────────────────────────────────────────────────────────
// 会话列表内容
// ─────────────────────────────────────────────────────────

export function SessionsContent() {
  const { toggleNewTaskDialog, showNewSessionDialog, setShowNewSessionDialog, toggleSearchPanel, setActivePanelLeft, setViewMode } = useUIStore()
  const { createSession, resumeSession, terminateSession, deleteSession, renameSession, aiRenameSession, toggleSessionPin, sessions, selectSession, selectedSessionId, lastActivities, agents, resumeError, clearResumeError, openSessionForChat } = useSessionStore()
  const setGitActiveTab = useGitStore((s) => s.setActiveTab)
  // ── 分组方式 ──
  const [groupBy, setGroupBy] = useState<GroupByMode>(() => {
    try {
      const stored = localStorage.getItem('sidebar-group-by') as GroupByMode
      if (stored === 'time' || stored === 'directory' || stored === 'workspace') return stored
    } catch { /* ignore */ }
    return 'directory'
  })
  const handleSetGroupBy = useCallback((mode: GroupByMode) => {
    setGroupBy(mode)
    try { localStorage.setItem('sidebar-group-by', mode) } catch { /* ignore */ }
  }, [])

  // ── 工作区列表（workspace 模式加载） ──
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  useEffect(() => {
    if (groupBy === 'workspace') {
      window.spectrAI.workspace?.list?.()
        ?.then(list => setWorkspaces(list || []))
        ?.catch(() => setWorkspaces([]))
    }
  }, [groupBy])

  // ── 滚动容器 ref（时间分组模式下自动滚动定位） ──
  const sessionListScrollRef = useRef<HTMLDivElement>(null)
  const newSessionLoadSeqRef = useRef(0)

  // ── 自动定位激活会话（仅时间分组模式需要滚动；目录/工作区模式使用弹框选择器，无需滚动） ──
  useEffect(() => {
    if (!selectedSessionId || groupBy !== 'time') return
    const timer = setTimeout(() => {
      const el = sessionListScrollRef.current?.querySelector<HTMLElement>(`[data-session-id="${selectedSessionId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 80)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId])

  // ── 会话切换视图逻辑 ──
  const handleSelectSession = useCallback((id: string) => {
    const { viewMode, setViewMode, setTemporaryTab, layoutMode, primaryPane, setPaneContent } = useUIStore.getState()
    const { sessions } = useSessionStore.getState()
    const session = sessions.find((s) => s.id === id)
    const isInactive =
      !session || session.status === 'completed' || session.status === 'terminated'

    if (layoutMode === 'single' && primaryPane !== 'sessions') {
      setPaneContent('primary', 'sessions')
    }

    if (isInactive) {
      setTemporaryTab(id)
      if (viewMode !== 'tabs') {
        setViewMode('tabs')
      }
      void openSessionForChat(id)
    } else {
      if (viewMode !== 'tabs') {
        setViewMode('tabs')
      }
      selectSession(id)
    }
  }, [openSessionForChat, selectSession])

  const handleOpenWorktree = useCallback((sessionId: string) => {
    const target = sessions.find((s) => s.id === sessionId)
    if (!target) return
    handleSelectSession(sessionId)
    const repoPath = target.config?.worktreeSourceRepo
    if (repoPath) setGitActiveTab(repoPath, 'worktrees')
    setActivePanelLeft('git')
  }, [sessions, handleSelectSession, setGitActiveTab, setActivePanelLeft])

  // ── Toast 自动消失 ──
  useEffect(() => {
    if (resumeError) {
      const timer = setTimeout(() => clearResumeError(), 5000)
      return () => clearTimeout(timer)
    }
  }, [resumeError])

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [aiRenamingSessionId, setAiRenamingSessionId] = useState<string | null>(null)
  const [aiRenameError, setAiRenameError] = useState<string | null>(null)

  // ── 会话分组弹框选择器 ──
  const [pickerGroup, setPickerGroup] = useState<DirGroup | null>(null)

  // 当 sessionStore 中的 sessions 变化时，同步刷新 pickerGroup
  useEffect(() => {
    if (!pickerGroup) return
    const existingIds = new Set(pickerGroup.sessions.map(s => s.id))
    const added = sessions.filter(s => !existingIds.has(s.id))
    const removed = pickerGroup.sessions.filter(s => sessions.some(cs => cs.id === s.id))
    if (added.length > 0 || removed.length !== pickerGroup.sessions.length) {
      setPickerGroup(prev => prev ? {
        ...prev,
        sessions: [...prev.sessions.filter(s => sessions.some(cs => cs.id === s.id)), ...added]
      } : null)
    }
  }, [sessions])

  // ── 删除确认弹框 ──
  const [deleteConfirm, setDeleteConfirm] = useState<{ sessionId: string; sessionName: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (aiRenameError) {
      const timer = setTimeout(() => setAiRenameError(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [aiRenameError])

  // ── 新建会话表单状态 ──
  const [sessionName, setSessionName] = useState('')
  const [sessionCwd, setSessionCwd] = useState('')
  const [sessionPrompt, setSessionPrompt] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<SessionStartTemplate['id']>('blank')
  const [supervisorMode, setSupervisorMode] = useState(false)
  const [autoAccept, setAutoAccept] = useState(true)
  const [createSessionError, setCreateSessionError] = useState<string | null>(null)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [recentDirs, setRecentDirs] = useState<Array<{ path: string; isPinned: boolean; useCount: number; lastUsedAt: string }>>([])
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [showProviderManager, setShowProviderManager] = useState(false)
  const [showGeneralSettings, setShowGeneralSettings] = useState(false)
  const [showAllDirs, setShowAllDirs] = useState(false)
  const [sessionMode, setSessionMode] = useState<'directory' | 'workspace'>('directory')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [isWorkspacesLoading, setIsWorkspacesLoading] = useState(false)

  // ── 会话右键菜单 ──
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; sessionId: string; status: SessionStatus
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string, status: SessionStatus) => {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 160)
    const y = Math.min(e.clientY, window.innerHeight - 120)
    setContextMenu({ x, y, sessionId, status })
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    if (contextMenu) {
      window.addEventListener('mousedown', handleClick)
      return () => window.removeEventListener('mousedown', handleClick)
    }
  }, [contextMenu])

  // ── 目录右键菜单 ──
  const [dirContextMenu, setDirContextMenu] = useState<{
    x: number; y: number; workDir: string
  } | null>(null)
  const dirMenuRef = useRef<HTMLDivElement>(null)

  const handleDirContextMenu = useCallback((e: React.MouseEvent, workDir: string) => {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 80)
    setDirContextMenu({ x, y, workDir })
  }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dirMenuRef.current && !dirMenuRef.current.contains(e.target as Node)) setDirContextMenu(null)
    }
    if (dirContextMenu) {
      window.addEventListener('mousedown', handleClick)
      return () => window.removeEventListener('mousedown', handleClick)
    }
  }, [dirContextMenu])

  /**
   * 等待 window.spectrAI.app 可用（最多等待 3 秒）
   * 返回 true 表示可用，false 表示超时
   */
  const waitForSpectrAIApp = async (): Promise<boolean> => {
    let attempts = 0
    const maxAttempts = 30
    while (!window.spectrAI?.app && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
    }
    if (!window.spectrAI?.app) {
      console.error('[Sidebar] window.spectrAI.app not available after waiting')
      return false
    }
    return true
  }

  const handleSelectTemplate = (template: SessionStartTemplate) => {
    setSelectedTemplateId(template.id)
    setSessionName(`${template.title} ${new Date().toLocaleTimeString()}`)
    setSessionPrompt(template.prompt)
    setSupervisorMode(template.supervisorMode)
  }

  const loadWorkspaceOptions = useCallback(async () => {
    if (!window.spectrAI?.workspace) {
      setWorkspaces([])
      setIsWorkspacesLoading(false)
      return
    }
    setIsWorkspacesLoading(true)
    try {
      const ws = await window.spectrAI.workspace.list()
      setWorkspaces(ws || [])
    } catch {
      setWorkspaces([])
    } finally {
      setIsWorkspacesLoading(false)
    }
  }, [])

  const openNewSessionDialog = (prefillDir?: string) => {
    const loadSeq = newSessionLoadSeqRef.current + 1
    newSessionLoadSeqRef.current = loadSeq
    setCreateSessionError(null)
    setSessionName(`会话 ${new Date().toLocaleTimeString()}`)
    setSessionPrompt('')
    setSelectedTemplateId('blank')
    setSelectedProviderId('')
    setSupervisorMode(false)
    setSessionMode('directory')
    setSelectedWorkspaceId('')
    setShowAllDirs(false)
    setIsCreatingSession(false)
    setIsWorkspacesLoading(false)
    setSessionCwd(prefillDir || sessionCwd || '')
    setShowNewSessionDialog(true)

    window.requestAnimationFrame(() => {
      void (async () => {
        if (!window.spectrAI?.provider || !window.spectrAI?.app) {
          console.warn('[Sidebar] window.spectrAI not available')
          if (newSessionLoadSeqRef.current !== loadSeq) return
          setProviders([])
          setRecentDirs([])
          setSessionCwd(prefillDir || '')
          return
        }

        const [providerResult, dirsResult] = await Promise.allSettled([
          window.spectrAI.provider.getAll(),
          window.spectrAI.app.getRecentDirectories(),
        ])

        if (newSessionLoadSeqRef.current !== loadSeq) return

        if (providerResult.status === 'fulfilled') {
          setProviders(providerResult.value)
          setSelectedProviderId(prev => (
            prev && providerResult.value.some(p => p.id === prev)
              ? prev
              : (providerResult.value[0]?.id || '')
          ))
        } else {
          setProviders([])
        }

        if (dirsResult.status === 'fulfilled') {
          const dirs = dirsResult.value
          setRecentDirs(dirs)
          if (prefillDir) {
            setSessionCwd(prefillDir)
          } else if (dirs.length > 0) {
            const mostRecent = dirs.reduce((a, b) => new Date(a.lastUsedAt) > new Date(b.lastUsedAt) ? a : b)
            setSessionCwd(mostRecent.path || '')
          } else {
            setSessionCwd(window.spectrAI.app.getCwd() || '')
          }
        } else {
          setRecentDirs([])
          try { setSessionCwd(prefillDir || window.spectrAI.app.getCwd() || '') } catch { setSessionCwd(prefillDir || '') }
        }
      })()
    })
  }

  useEffect(() => {
    if (!showNewSessionDialog || sessionMode !== 'workspace' || isWorkspacesLoading || workspaces.length > 0) return
    void loadWorkspaceOptions()
  }, [showNewSessionDialog, sessionMode, isWorkspacesLoading, workspaces.length, loadWorkspaceOptions])

  const handleCreateSession = async () => {
    if (isCreatingSession) return
    const ws = sessionMode === 'workspace'
      ? workspaces.find(w => w.id === selectedWorkspaceId)
      : null
    const primaryRepo = ws?.repos.find(r => r.isPrimary) ?? ws?.repos[0]
    const workingDir = sessionMode === 'workspace' && primaryRepo
      ? primaryRepo.repoPath
      : (sessionCwd ?? '').trim()

    if (!workingDir) return

    const providerId = selectedProviderId || providers[0]?.id || 'claude-code'
    setCreateSessionError(null)

    try {
      setIsCreatingSession(true)
      await createSession({
        id: `session-${Date.now()}`,
        name: sessionName.trim() || `会话 ${new Date().toLocaleTimeString()}`,
        workingDirectory: workingDir,
        workspaceId: sessionMode === 'workspace' ? selectedWorkspaceId : undefined,
        autoAccept,
        initialPrompt: sessionPrompt.trim() || undefined,
        providerId,
        enableAgent: supervisorMode,
        supervisorMode,
        // ★ iFlow: 预热模式，创建时即完成握手，后续发消息无需等待 60 秒
        prewarm: providerId === 'iflow',
      })
      setShowNewSessionDialog(false)
      // 切换到标签页视图，让新建会话立即可见
      setViewMode('tabs')
    } catch (error: any) {
      setCreateSessionError(error?.message || '创建会话失败，请检查 Provider 配置')
      console.error('Failed to create session:', error)
    } finally {
      setIsCreatingSession(false)
    }
  }

  const handleSelectDirectory = async () => {
    if (!await waitForSpectrAIApp()) return

    try {
      const result = await window.spectrAI.app.selectDirectory()
      if (result) setSessionCwd(result)
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }

  // 过滤子 Agent 会话（只显示顶层会话）
  const topLevelSessions = useMemo(
    () => sessions.filter(s => !s.config?.agentId),
    [sessions]
  )
  const executingTopLevelCount = useMemo(
    () => topLevelSessions.filter(s => EXECUTING_STATUSES.has(s.status)).length,
    [topLevelSessions]
  )
  const timeGroups = useMemo(
    () => groupBy === 'time' ? groupSessionsByTime(topLevelSessions) : [],
    [groupBy, topLevelSessions]
  )
  const directoryGroups = useMemo(
    () => groupBy === 'directory' ? groupSessionsByDirectory(topLevelSessions) : [],
    [groupBy, topLevelSessions]
  )
  const workspaceGroups = useMemo(
    () => groupBy === 'workspace' ? groupSessionsByWorkspace(topLevelSessions, workspaces) : [],
    [groupBy, topLevelSessions, workspaces]
  )
  const sortedRecentDirs = useMemo(() => {
    const uniqueDirs = Array.from(new Map(recentDirs.map(d => [d.path, d])).values())
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
      })
    const pinnedDirs = uniqueDirs.filter(d => d.isPinned)
    const unpinnedDirs = uniqueDirs.filter(d => !d.isPinned)
    return {
      pinnedDirs,
      unpinnedDirs,
      visibleDirs: showAllDirs ? uniqueDirs : pinnedDirs,
    }
  }, [recentDirs, showAllDirs])

  // 公共 props（时间分组卡片）
  const commonCardProps = useMemo(() => ({
    selectedSessionId,
    lastActivities,
    selectSession: handleSelectSession,
    onOpenWorktree: handleOpenWorktree,
    handleContextMenu,
    resumeSession,
    renameSession,
    renamingSessionId,
    setRenamingSessionId,
    aiRenamingSessionId,
    providers,
    agents,
  }), [
    selectedSessionId,
    lastActivities,
    handleSelectSession,
    handleOpenWorktree,
    handleContextMenu,
    resumeSession,
    renameSession,
    renamingSessionId,
    setRenamingSessionId,
    aiRenamingSessionId,
    providers,
    agents,
  ])

  // 选择器 props（传递给 SessionPickerModal）
  const pickerProps = useMemo(() => ({
    onOpenWorktree: handleOpenWorktree,
    handleContextMenu,
    lastActivities,
    renamingSessionId,
    setRenamingSessionId,
    renameSession,
    aiRenamingSessionId,
    providers,
    agents,
    resumeSession,
  }), [
    handleOpenWorktree,
    handleContextMenu,
    lastActivities,
    renamingSessionId,
    setRenamingSessionId,
    renameSession,
    aiRenamingSessionId,
    providers,
    agents,
    resumeSession,
  ])

  return (
    <div className="flex flex-col h-full bg-bg-secondary/95 shadow-[1px_0_0_rgba(255,255,255,0.035)]">

      {/* ── 顶部标题栏（可拖拽） ── */}
      <div className="flex items-center justify-between p-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2">
          <BrandLogo size={24} />
          <h1 className="text-lg font-semibold text-text-primary">PrismOps</h1>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={toggleSearchPanel}
            className="p-2 rounded hover:bg-bg-hover btn-transition text-text-secondary hover:text-text-primary"
            title={`搜索日志 (${toPlatformShortcutLabel('Ctrl+F')})`}
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => openNewSessionDialog()}
            className="p-2 rounded hover:bg-bg-hover btn-transition text-text-secondary hover:text-text-primary"
            title="新建会话"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── 会话列表 ── */}
      <div ref={sessionListScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {sessions.length === 0 ? (
          <div className="text-center text-text-muted text-sm mt-8">
            <p>暂无会话</p>
            <p className="mt-2 text-xs">点击下方"新建会话"开始</p>
          </div>
        ) : (
          <>
            {/* 统计 + 分组切换 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-0.5">
                <h3 className="text-sm font-medium text-text-primary">会话</h3>
                <span className="text-xs text-text-muted">
                  {executingTopLevelCount} 处理中 / {topLevelSessions.length} 总
                </span>
              </div>
              <GroupByToggle value={groupBy} onChange={handleSetGroupBy} />
            </div>

            {/* 时间分组 */}
            {groupBy === 'time' && timeGroups.map(group => (
              <TimeGroupCard key={group.key} group={group} {...commonCardProps} />
            ))}

            {/* 目录分组 */}
            {groupBy === 'directory' && directoryGroups.map(group => (
              <DirGroupCard
                key={group.key}
                group={group}
                onOpenPicker={() => setPickerGroup(group)}
                onDirContextMenu={handleDirContextMenu}
                {...commonCardProps}
              />
            ))}

            {/* 工作区分组 */}
            {groupBy === 'workspace' && workspaceGroups.map(group => (
              <DirGroupCard
                key={group.key}
                group={group}
                onOpenPicker={() => setPickerGroup(group)}
                onDirContextMenu={handleDirContextMenu}
                {...commonCardProps}
              />
            ))}

            {/* 工作区模式未配置时的引导提示 */}
            {groupBy === 'workspace' && workspaces.length === 0 && topLevelSessions.length > 0 && (
              <div className="text-center text-text-muted text-xs py-6 px-2">
                <Layers className="w-5 h-5 mx-auto mb-2 opacity-40" />
                <p>尚未配置工作区</p>
                <button
                  onClick={() => setShowGeneralSettings(true)}
                  className="mt-1.5 text-accent-blue hover:underline"
                >
                  前往设置 → 工作区
                </button>
              </div>
            )}
          </>
        )}

      </div>

      {/* ── 底部快速操作 ── */}
      <div className="px-3 py-3 shadow-[0_-1px_0_rgba(255,255,255,0.035)]">
        <button
          onClick={() => openNewSessionDialog()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent-blue/25 bg-accent-blue/10 px-3 py-2 text-sm font-medium text-accent-blue transition-colors hover:border-accent-blue/40 hover:bg-accent-blue/15"
        >
          <Terminal className="w-4 h-4" />
          <span>新建会话</span>
        </button>
      </div>

      {/* ── 右键上下文菜单 ── */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[90] bg-bg-secondary border border-border rounded-lg shadow-2xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => { setRenamingSessionId(contextMenu.sessionId); setContextMenu(null) }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover btn-transition text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-accent-blue" />
            重命名
          </button>
          <button
            disabled={aiRenamingSessionId === contextMenu.sessionId}
            onClick={async () => {
              const sid = contextMenu.sessionId
              setContextMenu(null)
              setAiRenamingSessionId(sid)
              const result = await aiRenameSession(sid)
              setAiRenamingSessionId(null)
              if (!result.success) setAiRenameError(result.error || 'AI 重命名失败')
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover btn-transition text-left disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 text-accent-purple ${aiRenamingSessionId === contextMenu.sessionId ? 'animate-pulse' : ''}`} />
            {aiRenamingSessionId === contextMenu.sessionId ? 'AI 命名中...' : 'AI 重命名'}
          </button>
          <button
            onClick={() => {
              void toggleSessionPin(contextMenu.sessionId)
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover btn-transition text-left"
          >
            <Star
              className={`w-3.5 h-3.5 ${
                sessions.find(s => s.id === contextMenu.sessionId)?.isPinned
                  ? 'fill-accent-yellow text-accent-yellow'
                  : 'text-text-muted'
              }`}
            />
            {sessions.find(s => s.id === contextMenu.sessionId)?.isPinned ? '取消置顶' : '置顶会话'}
          </button>
          {(contextMenu.status === 'completed' || contextMenu.status === 'terminated') && (
            <button
              onClick={() => { resumeSession(contextMenu.sessionId); setContextMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover btn-transition text-left"
            >
              <Play className="w-3.5 h-3.5 text-accent-green" />
              继续任务
            </button>
          )}
          {contextMenu.status === 'interrupted' && (
            <button
              onClick={() => { resumeSession(contextMenu.sessionId); setContextMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover btn-transition text-left"
            >
              <RotateCcw className="w-3.5 h-3.5 text-accent-blue" />
              恢复会话
            </button>
          )}
          {(contextMenu.status === 'running' || contextMenu.status === 'idle' || contextMenu.status === 'waiting_input' || contextMenu.status === 'starting') && (
            <button
              onClick={() => { terminateSession(contextMenu.sessionId); setContextMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-accent-red hover:bg-bg-hover btn-transition text-left"
            >
              <Square className="w-3.5 h-3.5" />
              终止会话
            </button>
          )}
          <div className="my-1 border-t border-border" />
          <button
            onClick={() => {
              const sid = contextMenu.sessionId
              const sName = sessions.find(s => s.id === sid)?.name || sid
              setContextMenu(null)
              setDeleteConfirm({ sessionId: sid, sessionName: sName })
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-accent-red hover:bg-bg-hover btn-transition text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除任务
          </button>
        </div>
      )}

      {/* ── 目录右键菜单 ── */}
      {dirContextMenu && (
        <div
          ref={dirMenuRef}
          className="fixed z-[90] bg-bg-secondary border border-border rounded-lg shadow-2xl py-1 min-w-[160px]"
          style={{ left: dirContextMenu.x, top: dirContextMenu.y }}
        >
          <button
            onClick={() => {
              const dir = dirContextMenu.workDir
              setDirContextMenu(null)
              openNewSessionDialog(dir || undefined)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover btn-transition text-left"
          >
            <Plus className="w-3.5 h-3.5 text-accent-green" />
            {dirContextMenu.workDir ? '在此新建对话' : '新建对话'}
          </button>
        </div>
      )}

      {/* ── 会话分组选择器弹框 ── */}
      {pickerGroup && (
        <SessionPickerModal
          group={pickerGroup}
          onSelect={handleSelectSession}
          onClose={() => setPickerGroup(null)}
          {...pickerProps}
        />
      )}

      {/* ── 删除会话确认弹框 ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-secondary rounded-xl shadow-2xl border border-border w-full max-w-sm p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-accent-red/15 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-4.5 h-4.5 text-accent-red" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary mb-1">删除任务</h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  确定要永久删除 <span className="font-medium text-text-primary">"{deleteConfirm.sessionName}"</span> 吗？<br />
                  此操作将删除会话及其所有历史记录，且无法撤销。
                </p>
                {deleteError && (
                  <p className="text-xs text-accent-red mt-1">{deleteError}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-bg-hover hover:bg-bg-tertiary rounded btn-transition disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  setIsDeleting(true)
                  setDeleteError(null)
                  try {
                    await deleteSession(deleteConfirm.sessionId)
                    setDeleteConfirm(null)
                  } catch (err) {
                    setDeleteError(err instanceof Error ? err.message : '删除失败')
                  } finally {
                    setIsDeleting(false)
                  }
                }}
                disabled={isDeleting}
                className="px-3 py-1.5 text-xs text-white bg-accent-red hover:bg-accent-red/80 rounded btn-transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeleting ? (
                  <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />删除中...</>
                ) : (
                  <><Trash2 className="w-3 h-3" />确认删除</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Provider 管理弹窗 ── */}
      {showProviderManager && (
        <ProviderManager
          onClose={async () => {
            setShowProviderManager(false)
            if (!window.spectrAI?.provider) {
              console.warn('[Sidebar] window.spectrAI.provider not available')
              return
            }
            try {
              const providerList = await window.spectrAI.provider.getAll()
              setProviders(providerList)
              setSelectedProviderId((prev) => (
                providerList.some((p) => p.id === prev) ? prev : (providerList[0]?.id || '')
              ))
            } catch { /* ignore */ }
          }}
        />
      )}

      {/* ── 新建会话对话框 ── */}
      {showNewSessionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-bg-secondary rounded-lg shadow-lg w-full max-w-2xl border border-border max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">新建会话</h2>
              <button onClick={() => { if (!isCreatingSession) setShowNewSessionDialog(false) }} className="text-text-muted hover:text-text-primary btn-transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-text-secondary">先选目标</label>
                  <span className="text-[11px] text-text-muted">会自动填好指令和模式</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SESSION_START_TEMPLATES.map(template => {
                    const Icon = template.icon
                    const active = selectedTemplateId === template.id
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => handleSelectTemplate(template)}
                        className={`group flex items-start gap-3 rounded-lg border p-3 text-left btn-transition ${
                          active
                            ? 'border-accent-blue/60 bg-accent-blue/10 shadow-sm'
                            : 'border-border bg-bg-primary hover:border-accent-blue/40 hover:bg-bg-hover'
                        }`}
                      >
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${template.accentClass}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text-primary">{template.title}</span>
                            {template.supervisorMode && (
                              <span className="rounded border border-accent-green/30 bg-accent-green/10 px-1.5 py-0.5 text-[10px] text-accent-green">
                                Supervisor
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-text-muted">{template.description}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">会话名称</label>
                <input
                  type="text"
                  value={sessionName}
                  onChange={e => setSessionName(e.target.value)}
                  placeholder="输入会话名称"
                  className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
                  autoFocus
                />
              </div>
              {/* 工作目录 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-text-secondary">
                    工作目录 <span className="text-accent-red">*</span>
                  </label>
                  <div className="flex rounded overflow-hidden border border-border text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSessionMode('directory')}
                      className={`px-2 py-0.5 btn-transition ${
                        sessionMode === 'directory'
                          ? 'bg-accent-blue text-white'
                          : 'bg-bg-hover text-text-muted hover:text-text-primary'
                      }`}
                    >
                      目录
                    </button>
                    <button
                      type="button"
                      disabled={isWorkspacesLoading}
                      onClick={() => setSessionMode('workspace')}
                      className={`px-2 py-0.5 btn-transition ${
                        sessionMode === 'workspace'
                          ? 'bg-accent-blue text-white'
                          : 'bg-bg-hover text-text-muted hover:text-text-primary'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {isWorkspacesLoading ? '加载中…' : '工作区'}
                    </button>
                  </div>
                </div>

                {sessionMode === 'directory' ? (
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={sessionCwd}
                        onChange={e => setSessionCwd(e.target.value)}
                        placeholder="选择工作目录"
                        className="flex-1 px-3 py-2 bg-bg-primary border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
                      />
                      <button
                        type="button"
                        onClick={handleSelectDirectory}
                        className="px-3 py-2 bg-bg-hover hover:bg-bg-tertiary border border-border rounded text-text-secondary btn-transition"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                    </div>
                    {/* 常用/最近目录快速选择 */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-text-muted">常用目录</span>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!await waitForSpectrAIApp()) return
                            const dir = await window.spectrAI.app.selectDirectory()
                            if (!dir) return
                            const existing = recentDirs.find(d => d.path === dir)
                            if (!existing || !existing.isPinned) {
                              await window.spectrAI.app.toggleDirectoryPin(dir)
                            }
                            const dirs = await window.spectrAI.app.getRecentDirectories()
                            setRecentDirs(dirs)
                            setSessionCwd(dir)
                          }}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-text-muted hover:text-accent-blue hover:bg-bg-hover btn-transition"
                          title="添加常用目录"
                        >
                          <Plus className="w-3 h-3" />
                          <span>添加</span>
                        </button>
                      </div>
                      {recentDirs.length > 0 ? (
                        <div className="max-h-[120px] overflow-y-auto pr-1">
                          <div className="flex flex-wrap gap-1.5">
                            <>
                                  {sortedRecentDirs.visibleDirs.map(dir => {
                                    const parts = dir.path.replace(/\\/g, '/').split('/').filter(Boolean)
                                    const shortPath = parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/')
                                    return (
                                      <div
                                        key={dir.path}
                                        className={`group relative flex items-center gap-1 pl-2 pr-1.5 py-1 rounded text-[11px] border cursor-pointer btn-transition ${
                                          sessionCwd === dir.path
                                            ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue'
                                            : 'bg-bg-hover hover:bg-bg-tertiary border-border text-text-secondary'
                                        }`}
                                        onClick={() => setSessionCwd(dir.path)}
                                        title={dir.path}
                                      >
                                        {dir.isPinned && (
                                          <Star className="w-3 h-3 text-accent-yellow fill-accent-yellow flex-shrink-0" />
                                        )}
                                        <span className="truncate max-w-[120px]">{shortPath}</span>
                                        <div className="flex items-center ml-0.5 opacity-0 group-hover:opacity-100 btn-transition">
                                          <button
                                            onClick={async (e) => {
                                              e.stopPropagation()
                                              if (!await waitForSpectrAIApp()) return
                                              try {
                                                await window.spectrAI.app.toggleDirectoryPin(dir.path)
                                                const dirs = await window.spectrAI.app.getRecentDirectories()
                                                setRecentDirs(dirs)
                                              } catch (error) {
                                                console.error('Failed to toggle directory pin:', error)
                                              }
                                            }}
                                            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-yellow btn-transition"
                                            title={dir.isPinned ? '取消收藏' : '收藏'}
                                          >
                                            <Star className={`w-3 h-3 ${dir.isPinned ? 'fill-accent-yellow text-accent-yellow' : ''}`} />
                                          </button>
                                          <button
                                            onClick={async (e) => {
                                              e.stopPropagation()
                                              if (!await waitForSpectrAIApp()) return
                                              if (confirm(`确定从常用列表中移除 "${dir.path}" 吗？`)) {
                                                try {
                                                  await window.spectrAI.app.removeDirectory(dir.path)
                                                  const dirs = await window.spectrAI.app.getRecentDirectories()
                                                  setRecentDirs(dirs)
                                                  if (sessionCwd === dir.path) setSessionCwd('')
                                                } catch (error) {
                                                  console.error('Failed to remove directory:', error)
                                                }
                                              }
                                            }}
                                            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-red btn-transition"
                                            title="移除"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  })}
                                  {sortedRecentDirs.unpinnedDirs.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setShowAllDirs(v => !v)}
                                      className="flex items-center gap-0.5 px-1.5 py-1 rounded text-[11px] text-text-muted hover:text-accent-blue hover:bg-bg-hover btn-transition border border-dashed border-border"
                                    >
                                      {showAllDirs ? (
                                        <><ChevronUp className="w-3 h-3" /><span>收起</span></>
                                      ) : (
                                        <><ChevronDown className="w-3 h-3" /><span>展开更多 {sortedRecentDirs.unpinnedDirs.length} 个</span></>
                                      )}
                                    </button>
                                  )}
                            </>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-2 text-[11px] text-text-muted">
                          暂无常用目录，点击上方"添加"设置
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  /* 工作区选择模式 */
                  <div className="space-y-2">
                    <select
                      value={selectedWorkspaceId}
                      onChange={e => setSelectedWorkspaceId(e.target.value)}
                      disabled={isWorkspacesLoading}
                      className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="">{isWorkspacesLoading ? '正在加载工作区…' : '-- 选择工作区 --'}</option>
                      {!isWorkspacesLoading && workspaces.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                    {selectedWorkspaceId && (() => {
                      const selectedWs = workspaces.find(w => w.id === selectedWorkspaceId)
                      if (!selectedWs) return null
                      return (
                        <div className="text-[11px] text-text-muted space-y-0.5 pl-1">
                          {selectedWs.repos.map(r => (
                            <div key={r.id} className="flex items-center gap-1">
                              {r.isPrimary && <span className="text-accent-blue font-medium">[主]</span>}
                              <span className="truncate">{r.name}</span>
                              <span className="text-text-disabled truncate">{r.repoPath}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  初始指令（可选）
                </label>
                <textarea
                  value={sessionPrompt}
                  onChange={e => setSessionPrompt(e.target.value)}
                  placeholder="输入要让 Claude 执行的指令，留空则进入交互模式"
                  className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue resize-none"
                  rows={3}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-text-secondary">AI 提供者</label>
                  <button
                    type="button"
                    onClick={() => setShowProviderManager(true)}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-text-muted hover:text-accent-blue hover:bg-bg-hover btn-transition"
                    title="管理 AI 提供者"
                  >
                    <Settings2 className="w-3 h-3" />
                    <span>管理</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {providers.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProviderId(p.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border btn-transition ${
                        selectedProviderId === p.id
                          ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue'
                          : 'bg-bg-hover hover:bg-bg-tertiary border-border text-text-secondary'
                      }`}
                    >
                      {p.icon === 'claude' ? <Terminal className="w-3.5 h-3.5" /> : <Cpu className="w-3.5 h-3.5" />}
                      {p.name}
                    </button>
                  ))}
                  {providers.length === 0 && (
                    <span className="text-xs text-text-muted py-1">加载中...</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto-accept-toggle"
                  checked={autoAccept}
                  onChange={e => setAutoAccept(e.target.checked)}
                  className="rounded border-border accent-accent-blue"
                />
                <label htmlFor="auto-accept-toggle" className="text-sm text-text-secondary select-none">
                  自动接受权限请求
                </label>
                <span className="text-[10px] text-text-muted">（--dangerously-skip-permissions）</span>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">会话模式</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSupervisorMode(false)}
                    className={`px-3 py-2 rounded text-xs border btn-transition ${
                      !supervisorMode
                        ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue'
                        : 'bg-bg-hover hover:bg-bg-tertiary border-border text-text-secondary'
                    }`}
                  >
                    普通会话
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupervisorMode(true)}
                    className={`px-3 py-2 rounded text-xs border btn-transition ${
                      supervisorMode
                        ? 'bg-accent-green/15 border-accent-green/40 text-accent-green'
                        : 'bg-bg-hover hover:bg-bg-tertiary border-border text-text-secondary'
                    }`}
                  >
                    Supervisor
                  </button>
                </div>
                <p className="text-[10px] text-text-muted mt-1">
                  {supervisorMode ? 'AI 可自动拆解任务并分派给子会话执行' : '标准单会话模式'}
                </p>
              </div>
              {createSessionError && (
                <div className="text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded px-2.5 py-2">
                  {createSessionError}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateSession}
                  disabled={
                    isCreatingSession || (sessionMode === 'workspace'
                      ? !selectedWorkspaceId
                      : !(sessionCwd ?? '').trim()
                    )
                  }
                  className="flex-1 px-4 py-2 text-white rounded font-medium btn-transition hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed bg-accent-blue"
                >
                  {isCreatingSession ? '创建中...' : '创建'}
                </button>
                <button
                  onClick={() => {
                    if (isCreatingSession) return
                    setShowNewSessionDialog(false)
                  }}
                  className="px-4 py-2 bg-bg-hover hover:bg-bg-tertiary text-text-secondary rounded font-medium btn-transition"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 统一设置面板 ── */}
      {showGeneralSettings && (
        <UnifiedSettingsModal onClose={() => setShowGeneralSettings(false)} />
      )}

      {/* ── Toast：恢复失败 ── */}
      {resumeError && (
        <div className="fixed bottom-4 right-4 z-[100] max-w-sm px-4 py-3 rounded-lg shadow-lg border border-accent-red/30 bg-bg-secondary text-text-primary text-xs animate-in slide-in-from-bottom-2">
          <div className="flex items-start gap-2">
            <span className="text-accent-red font-medium shrink-0">恢复失败</span>
            <span className="text-text-secondary">{resumeError}</span>
            <button onClick={clearResumeError} className="ml-auto shrink-0 text-text-muted hover:text-text-primary">✕</button>
          </div>
        </div>
      )}

      {/* ── Toast：AI 重命名失败 ── */}
      {aiRenameError && (
        <div className="fixed bottom-4 right-4 z-[100] max-w-sm px-4 py-3 rounded-lg shadow-lg border border-accent-purple/30 bg-bg-secondary text-text-primary text-xs animate-in slide-in-from-bottom-2">
          <div className="flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-accent-purple shrink-0 mt-0.5" />
            <span className="text-accent-purple font-medium shrink-0">AI 重命名失败</span>
            <span className="text-text-secondary">{aiRenameError}</span>
            <button onClick={() => setAiRenameError(null)} className="ml-auto shrink-0 text-text-muted hover:text-text-primary">✕</button>
          </div>
        </div>
      )}

    </div>
  )
}

/**
 * 侧边栏主入口 - 根据左侧激活面板渲染对应内容
 * 支持所有 PanelId，包括从右侧拖过来的面板（timeline / stats）
 * @author weibin
 */
export default function Sidebar() {
  const activePanelLeft = useUIStore((s) => s.activePanelLeft)

  switch (activePanelLeft) {
    case 'dashboard':
      return <DashboardSidebarView />
    case 'explorer':
      return <FileManagerPanel />
    case 'git':
      return <GitPanel />
    case 'timeline':
      return <TimelinePanel />
    case 'stats':
      return <StatsPanel />
    case 'team':
      return <TeamSidebarView />
    case 'sessions':
      return <SessionsContent />
    // === 其他功能统一整合到工具箱 ===
    default:
      return <ToolboxView />
  }
}
