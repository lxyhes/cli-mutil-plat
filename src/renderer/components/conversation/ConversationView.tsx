/**
 * 对话视图组件
 *
 * SDK V2 架构的主要交互视图，替代 xterm.js 终端渲染。
 * 显示结构化对话消息流：用户消息、AI 回复、工具调用卡片、权限请求等。
 *
 * @author weibin
 */

import React, { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FolderOpen, Plus, RotateCcw, Settings2, Trash2, Copy, ArrowUp, ArrowDown, Download, X, BookMarked, Target, GitPullRequest, Wrench, ShieldCheck, FileText, Activity } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ConversationMessage, UserQuestionMeta, AskUserQuestionMeta } from '../../../shared/types'
import ContextMenu from '../common/ContextMenu'
import type { MenuItem } from '../common/ContextMenu'
import { useConversation } from '../../hooks/useConversation'
import type { QueuedMessage } from '../../hooks/useConversation'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import SessionToolbar, { type SkillItem } from './SessionToolbar'
import ToolOperationGroup from './ToolOperationGroup'
import FileChangeCard from './FileChangeCard'
import UserQuestionBar from './UserQuestionBar'
import AskUserQuestionPanel from './AskUserQuestionPanel'
import PlanApprovalPanel from './PlanApprovalPanel'
import CrossSessionSearch from './CrossSessionSearch'
import SessionKnowledgePanel from './SessionKnowledgePanel'
import { isPrimaryModifierPressed, toPlatformShortcutLabel } from '../../utils/shortcut'


// ---- Provider 颜色映射 ----

const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': '#58A6FF',
  'iflow':       '#A78BFA',
  'codex':       '#F97316',
  'gemini-cli':  '#34D399',
  'qwen-coder':  '#A855F7',
}

function getProviderColor(providerId?: string): string {
  return (providerId && PROVIDER_COLORS[providerId]) ?? '#6B7280'
}

// ---- 消息分组类型 ----

type MessageGroup =
  | { type: 'message'; message: ConversationMessage }
  | { type: 'tool_group'; messages: ConversationMessage[]; isActive: boolean }
  | { type: 'file_change'; message: ConversationMessage }

interface OpsBriefSnapshot {
  projectName: string
  projectPath?: string
  goal: string
  statusLabel: string
  statusTone: 'neutral' | 'active' | 'blocked' | 'done'
  changedFileCount: number
  additions: number
  deletions: number
  toolCount: number
  failedToolCount: number
  validationCount: number
  messageCount: number
  lastFiles: string[]
  lastCommand?: string
  phaseLabel: string
  liveProgressText?: string
  nextActions: string[]
  risks: string[]
  evidence: string[]
}

interface CommonPrompt {
  id: string
  label: string
  text: string
}

const COMMON_PROMPTS_STORAGE_KEY = 'prismops-common-prompts'

const DEFAULT_COMMON_PROMPTS: CommonPrompt[] = [
  { id: 'review-project', label: '审视项目', text: '审视下我的项目，先给出结构、风险点和下一步优先级。' },
  { id: 'next-step', label: '继续下一步', text: '继续下一步，按最短路径推进，改完后帮我验证。' },
  { id: 'debug-issue', label: '排查问题', text: '帮我排查这个问题，先定位根因，再给出最小修复方案。' },
  { id: 'improve-ui', label: '优化 UI', text: '帮我优化这个页面的 UI/UX，不破坏现有功能，完成后说明改了什么。' },
  { id: 'update-todo', label: '更新 todo', text: '根据当前进度更新 todo.md，并继续完成最高优先级事项。' },
]

function normalizeCommonPrompts(value: unknown): CommonPrompt[] {
  if (!Array.isArray(value)) return DEFAULT_COMMON_PROMPTS
  const prompts = value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Partial<CommonPrompt>
      const label = String(raw.label || '').trim()
      const text = String(raw.text || '').trim()
      if (!label || !text) return null
      return { id: String(raw.id || `custom-${index}-${label}`), label, text }
    })
    .filter(Boolean) as CommonPrompt[]
  return prompts.length > 0 ? prompts : DEFAULT_COMMON_PROMPTS
}

function loadCommonPrompts(): CommonPrompt[] {
  try {
    const raw = localStorage.getItem(COMMON_PROMPTS_STORAGE_KEY)
    if (raw) return normalizeCommonPrompts(JSON.parse(raw))
  } catch {
    // ignore
  }
  return DEFAULT_COMMON_PROMPTS
}

function saveCommonPrompts(prompts: CommonPrompt[]): void {
  try {
    localStorage.setItem(COMMON_PROMPTS_STORAGE_KEY, JSON.stringify(prompts))
  } catch {
    // ignore
  }
}

function getProjectName(workingDirectory?: string, fallback?: string): string {
  const normalized = (workingDirectory || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || fallback || '未绑定项目'
}

function getShortFileName(filePath: string): string {
  const normalized = (filePath || '').replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || filePath
}

function compactText(value: string, max = 110): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function getToolCommand(message: ConversationMessage): string {
  const command = message.toolInput?.command
  if (typeof command === 'string') return command
  return ''
}

function isValidationCommand(command: string): boolean {
  return /\b(test|typecheck|build|lint|check|pytest|vitest|jest|tsc|cargo\s+check|go\s+test)\b/i.test(command)
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  starting: '启动中',
  running: '执行中',
  idle: '空闲',
  waiting_input: '待输入',
  paused: '已暂停',
  completed: '已完成',
  error: '需处理',
  terminated: '已终止',
  interrupted: '已中断',
}

/**
 * 将消息序列按规则分组：
 * - user / assistant / system 消息各自独立
 * - 连续的 tool_use + tool_result 合并为一个 tool_group
 * - 末尾的 tool_group 标记为 isActive（可能还在执行中）
 */
function groupMessages(messages: ConversationMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentToolGroup: ConversationMessage[] = []

  for (const msg of messages) {
    // ★ 文件变更消息：独立为 file_change 组
    if (msg.fileChange) {
      if (currentToolGroup.length > 0) {
        groups.push({ type: 'tool_group', messages: [...currentToolGroup], isActive: false })
        currentToolGroup = []
      }
      groups.push({ type: 'file_change', message: msg })
      continue
    }

    if (msg.role === 'tool_use' || msg.role === 'tool_result') {
      currentToolGroup.push(msg)
    } else {
      if (currentToolGroup.length > 0) {
        groups.push({ type: 'tool_group', messages: [...currentToolGroup], isActive: false })
        currentToolGroup = []
      }
      groups.push({ type: 'message', message: msg })
    }
  }
  // 末尾残留的 tool 分组（可能还在执行中）
  if (currentToolGroup.length > 0) {
    groups.push({ type: 'tool_group', messages: currentToolGroup, isActive: true })
  }
  return groups
}

/** 格式化思考耗时：超过 60s 显示分秒 */
function formatThinkingTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

interface ConversationViewProps {
  sessionId: string
}

interface OpsBriefProps {
  snapshot: OpsBriefSnapshot
  onInsertPrompt: (text: string) => void
  onOpenKnowledge: () => void
  canOpenKnowledge: boolean
  expanded: boolean
  onToggleExpanded: () => void
}

const OpsBrief: React.FC<OpsBriefProps> = ({ snapshot, onInsertPrompt, onOpenKnowledge, canOpenKnowledge, expanded, onToggleExpanded }) => {
  const statusClass = {
    neutral: 'bg-bg-tertiary text-text-secondary',
    active: 'bg-accent-blue/10 text-accent-blue',
    blocked: 'bg-accent-yellow/10 text-accent-yellow',
    done: 'bg-accent-green/10 text-accent-green',
  }[snapshot.statusTone]
  const hasRisk = snapshot.risks.some(risk => !risk.includes('暂无明显'))
  const deliverySteps = [
    { label: '理解', done: snapshot.messageCount > 0, active: snapshot.messageCount > 0 && snapshot.changedFileCount === 0 && snapshot.toolCount === 0 },
    { label: '执行', done: snapshot.toolCount > 0 || snapshot.changedFileCount > 0, active: snapshot.toolCount > 0 && snapshot.changedFileCount === 0 },
    { label: '改动', done: snapshot.changedFileCount > 0, active: snapshot.changedFileCount > 0 && snapshot.validationCount === 0 },
    { label: '验证', done: snapshot.validationCount > 0, active: snapshot.validationCount > 0 && snapshot.failedToolCount === 0 },
    { label: '交付', done: snapshot.validationCount > 0 && snapshot.changedFileCount > 0 && snapshot.failedToolCount === 0, active: false },
  ]

  return (
    <section className={`rounded-lg border border-border-subtle bg-bg-elevated shadow-[0_12px_28px_var(--color-shadow-sm)] ${expanded ? 'mb-5 px-4 py-3' : 'mb-4 px-3 py-2'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2 py-1 text-xs font-medium text-text-secondary">
              <Target size={13} className="text-accent-blue" />
              {snapshot.projectName}
            </span>
            <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${statusClass}`}>
              {snapshot.statusLabel}
            </span>
            {expanded && snapshot.projectPath && (
              <span className="min-w-0 truncate font-mono text-[11px] text-text-muted" title={snapshot.projectPath}>
                {snapshot.projectPath}
              </span>
            )}
          </div>
          <div className={`font-medium text-text-primary ${expanded ? 'text-sm leading-6' : 'truncate text-xs leading-5'}`} title={snapshot.goal}>
            {snapshot.goal}
          </div>
          {expanded && snapshot.liveProgressText && (
            <div className="mt-1 truncate text-xs text-text-muted" title={snapshot.liveProgressText}>
              {snapshot.liveProgressText}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            {deliverySteps.map((step, index) => {
              const active = step.active || (!step.done && deliverySteps.slice(0, index).every(s => s.done))
              return (
                <span
                  key={step.label}
                  title={step.label}
                  className={`h-1.5 flex-1 max-w-12 rounded-full ${
                    step.done
                      ? 'bg-accent-green'
                      : active
                        ? 'bg-accent-blue'
                        : 'bg-border-subtle'
                  }`}
                />
              )
            })}
            <span className="ml-1 shrink-0 rounded-md bg-bg-tertiary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
              {snapshot.phaseLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onInsertPrompt('继续推进当前目标。先总结当前状态，再执行下一步；如果涉及代码改动，完成后运行必要验证。')}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-accent-blue/10 px-2 text-xs font-medium text-accent-blue transition-colors hover:bg-accent-blue/15"
          >
            <Activity size={13} />
            继续推进
          </button>
          <button
            type="button"
            onClick={() => onInsertPrompt('基于当前改动做一次交付前检查：列出变更摘要、风险点、建议验证命令和提交说明。')}
            className={`h-7 items-center gap-1 rounded-md bg-accent-green/10 px-2 text-xs font-medium text-accent-green transition-colors hover:bg-accent-green/15 ${expanded ? 'inline-flex' : 'hidden'}`}
          >
            <ShieldCheck size={13} />
            交付检查
          </button>
          <button
            type="button"
            onClick={onOpenKnowledge}
            disabled={!canOpenKnowledge}
            className={`h-7 items-center gap-1 rounded-md bg-bg-tertiary px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45 ${expanded ? 'inline-flex' : 'hidden'}`}
          >
            <BookMarked size={13} />
            项目记忆
          </button>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-bg-tertiary px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover"
            title={expanded ? '收起工作简报' : '展开工作简报'}
          >
            <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? '收起' : '展开'}
          </button>
        </div>
      </div>

      {!expanded && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle pt-2 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1">
            <GitPullRequest size={12} className="text-accent-green" />
            {snapshot.changedFileCount} 文件
          </span>
          <span className="inline-flex items-center gap-1">
            <Wrench size={12} className="text-accent-purple" />
            {snapshot.toolCount} 工具
          </span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 size={12} className="text-accent-cyan" />
            {snapshot.validationCount} 验证
          </span>
          <span className={hasRisk ? 'text-accent-yellow' : 'text-accent-green'}>
            {hasRisk ? snapshot.risks[0] : '暂无明显阻塞'}
          </span>
        </div>
      )}

      {expanded && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border-subtle py-2">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <GitPullRequest size={14} className="text-accent-green" />
              <span>{snapshot.changedFileCount} 文件</span>
              <span className="text-accent-green">+{snapshot.additions}</span>
              <span className="text-accent-red">-{snapshot.deletions}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <Wrench size={14} className="text-accent-purple" />
              <span>{snapshot.toolCount} 工具</span>
              {snapshot.failedToolCount > 0 && <span className="text-accent-red">{snapshot.failedToolCount} 异常</span>}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <CheckCircle2 size={14} className="text-accent-cyan" />
              <span>{snapshot.validationCount} 验证</span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
              <FileText size={14} className="shrink-0 text-accent-yellow" />
              <span className="truncate">{snapshot.messageCount} 对话</span>
            </div>
            {snapshot.lastCommand && (
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted" title={snapshot.lastCommand}>
                {snapshot.lastCommand}
              </span>
            )}
          </div>

      <div className="mt-3 grid gap-3 text-xs md:grid-cols-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium text-text-secondary">下一步</span>
            <button
              type="button"
              onClick={() => onInsertPrompt(`按当前会话状态继续推进：${snapshot.nextActions.join('；')}。执行前先说明计划，完成后给出验证结果。`)}
              className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/10"
            >
              插入
            </button>
          </div>
          <div className="space-y-1.5 text-text-secondary">
            {snapshot.nextActions.map(action => (
              <div key={action} className="flex min-w-0 items-start gap-2">
                <Activity size={13} className="mt-0.5 shrink-0 text-accent-blue" />
                <span className="min-w-0 leading-5">{action}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 md:border-l md:border-border-subtle md:pl-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="font-medium text-text-secondary">风险</span>
            {hasRisk && <span className="rounded bg-accent-yellow/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-yellow">需关注</span>}
          </div>
          <div className="space-y-1.5">
            {snapshot.risks.map(risk => (
              <div key={risk} className="flex min-w-0 items-start gap-2 text-text-secondary">
                <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${hasRisk ? 'text-accent-yellow' : 'text-accent-green'}`} />
                <span className="min-w-0 leading-5">{risk}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 md:border-l md:border-border-subtle md:pl-3">
          <div className="mb-2 font-medium text-text-secondary">证据</div>
          <div className="space-y-1.5">
            {snapshot.evidence.map(item => (
              <div key={item} className="flex min-w-0 items-start gap-2 text-text-secondary">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-accent-green" />
                <span className="min-w-0 leading-5">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
        </>
      )}
    </section>
  )
}

const ConversationView: React.FC<ConversationViewProps> = ({ sessionId }) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages, isStreaming, isLoading, sendMessage, respondPermission, respondQuestion, approvePlan, abortSession } = useConversation(sessionId)
  const [resuming, setResuming] = useState(false)
  // SessionToolbar Skill chip 点击时注入输入框的命令，处理后清零
  const [pendingInsert, setPendingInsert] = useState<string | undefined>(undefined)
  // 跨会话搜索引用插入到输入框的内容
  const [externalInsert, setExternalInsert] = useState<string | undefined>(undefined)
  // 跨会话搜索面板开关 + 模式（cross: 所有会话 | current: 当前会话）
  const [crossSessionSearchOpen, setCrossSessionSearchOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<'cross' | 'current'>('cross')
  // 知识库抽屉面板开关
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(false)
  // 右键菜单显示状态
  const [ctxMenu, setCtxMenu] = useState({ visible: false, x: 0, y: 0 })
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const [queueHintText, setQueueHintText] = useState('')
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [commonPrompts, setCommonPrompts] = useState<CommonPrompt[]>(() => loadCommonPrompts())
  const [promptPickerOpen, setPromptPickerOpen] = useState(false)
  const [promptManagerOpen, setPromptManagerOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState({ label: '', text: '' })
  const [opsBriefExpanded, setOpsBriefExpanded] = useState(() => {
    try {
      return localStorage.getItem('prismops-ops-brief-expanded') !== 'false'
    } catch {
      return true
    }
  })
  // 记录是否已完成首次滚到底部（每次组件挂载重置）
  const hasScrolledInitially = useRef(false)

  // 思考计时器：streaming 开始时重置，每秒 +1
  const [thinkingSeconds, setThinkingSeconds] = useState(0)
  const thinkingStartRef = useRef<number>(0)

  useEffect(() => {
    if (isStreaming) {
      thinkingStartRef.current = Date.now()
      setThinkingSeconds(0)
      const timer = setInterval(() => {
        setThinkingSeconds(Math.floor((Date.now() - thinkingStartRef.current) / 1000))
      }, 1000)
      return () => clearInterval(timer)
    }
  }, [isStreaming])

  useEffect(() => {
    try {
      localStorage.setItem('prismops-ops-brief-expanded', String(opsBriefExpanded))
    } catch {
      // ignore
    }
  }, [opsBriefExpanded])

  // 获取会话状态（精确选择器，各字段独立订阅，减少无关更新触发的重渲染）
  const status = useSessionStore(state =>
    state.sessions.find(s => s.id === sessionId)?.status
  )
  const providerId = useSessionStore(state =>
    state.sessions.find(s => s.id === sessionId)?.providerId
  )
  const workingDirectory = useSessionStore(state =>
    state.sessions.find(s => s.id === sessionId)?.config?.workingDirectory
  )
  const resumeSession = useSessionStore(state => state.resumeSession)
  const isResumingSession = useSessionStore(state => state.resumingSessions.has(sessionId))
  const sendSkillMessage = useSessionStore(state => state.sendSkillMessage)
  const selectSession = useSessionStore(state => state.selectSession)
  const selectedSessionId = useSessionStore(state => state.selectedSessionId)
  const session = useSessionStore(state => state.sessions.find(s => s.id === sessionId))

  // 是否有未响应的权限请求
  const lastActivity = useSessionStore(state => state.lastActivities[sessionId])
  const liveProgressText = useSessionStore(state => {
    const list = state.activities[sessionId] || []
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i]
      if (!a?.detail) continue
      if (a.type === 'thinking' || a.type === 'tool_use' || a.type === 'command_execute' || a.type === 'file_edit' || a.type === 'file_write') {
        return a.detail
      }
    }
    return ''
  })
  const pendingPermission = lastActivity?.type === 'waiting_confirmation'

  // AI 交互式提问检测：turn_complete 后若检测到问题+选项，显示交互栏
  // AI 思考中（isStreaming）时隐藏，避免闪烁
  const pendingQuestion = !isStreaming && lastActivity?.type === 'user_question'
  const questionMeta = pendingQuestion
    ? (lastActivity?.metadata as UserQuestionMeta | undefined)
    : null

  // AskUserQuestion 工具调用检测
  const pendingAskQuestion = lastActivity?.type === 'waiting_ask_question'
  const askQuestionMeta = pendingAskQuestion
    ? (lastActivity?.metadata as { questions?: AskUserQuestionMeta['questions'] } | undefined)
    : null

  // ExitPlanMode 工具调用检测
  const pendingPlanApproval = lastActivity?.type === 'waiting_plan_approval'
  const planApprovalMeta = pendingPlanApproval
    ? (lastActivity?.metadata as { toolInput?: Record<string, unknown> } | undefined)
    : null
  const messageCount = messages.length
  const lastMessage = messages[messageCount - 1]
  const lastMessageId = lastMessage?.id
  const lastMessageRole = lastMessage?.role
  const lastMessageContentLength = lastMessage?.content?.length ?? 0

  // 挂载时同步滚到底部（paint 前执行，无 flash）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || messages.length === 0) return
    el.scrollTop = el.scrollHeight
    hasScrolledInitially.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动滚动到底部（新消息到达时）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    if (!hasScrolledInitially.current && messageCount > 0) {
      hasScrolledInitially.current = true
      el.scrollTop = el.scrollHeight
      setShowScrollBottom(prev => prev ? false : prev)
      return
    }

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150
    if (lastMessageRole === 'user' || isNearBottom) {
      el.scrollTop = el.scrollHeight
      setShowScrollBottom(prev => prev ? false : prev)
    } else if (messageCount > 0) {
      setShowScrollBottom(prev => prev ? prev : true)
    }
  }, [messageCount, lastMessageId, lastMessageRole, lastMessageContentLength])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    setShowScrollBottom(false)
  }, [])

  const handleConversationScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180
    setShowScrollBottom(prev => prev === !isNearBottom ? prev : !isNearBottom)
  }, [])

  // 切换标签页时滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let prevHeight = el.clientHeight
    const observer = new ResizeObserver(() => {
      const cur = el.clientHeight
      if (prevHeight === 0 && cur > 0) {
        el.scrollTop = el.scrollHeight
      }
      prevHeight = cur
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 全局快捷键：Ctrl/Cmd+F → 当前会话搜索，Ctrl/Cmd+Shift+F → 跨会话搜索
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 只响应当前选中会话，避免多个 ConversationView 同时触发
      if (sessionId !== selectedSessionId) return
      // 面板已打开时交由 CrossSessionSearch 内部处理，不重复触发
      if (crossSessionSearchOpen) return
      if (isPrimaryModifierPressed(e) && e.shiftKey && e.key.toUpperCase() === 'F') {
        e.preventDefault()
        setSearchMode('cross')
        setCrossSessionSearchOpen(true)
      } else if (isPrimaryModifierPressed(e) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchMode('current')
        setCrossSessionSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [crossSessionSearchOpen, sessionId, selectedSessionId])

  // 判断是否可发送消息
  const isSessionEnded =
    status === 'completed' ||
    status === 'terminated' ||
    status === 'error' ||
    status === 'interrupted'
  const canSend =
    status === 'running' ||
    status === 'waiting_input' ||
    status === 'idle' ||
    (status === 'starting' && isResumingSession) ||
    isSessionEnded

  // 从后端刷新队列状态
  const refreshQueue = useCallback(async () => {
    try {
      const result = await window.spectrAI.session.getQueue(sessionId)
      if (result?.success && result.messages) {
        setQueuedMessages(result.messages)
        if (result.messages.length === 0) {
          setQueueHintText('')
        }
      }
    } catch { /* ignore */ }
  }, [sessionId])

  const sendWithSmartScheduling = useCallback(async (text: string) => {
    // ★ 拦截 /model 命令：本地切换模型，不发送给 CLI
    if (text.trim() === '/model' || text.startsWith('/model ')) {
      const modelId = text.slice(7).trim()
      if (!modelId) {
        setQueueHintText('请输入 /model <模型ID>，或从模型菜单中选择一个模型')
        return
      }
      if (modelId) {
        try {
          const result = await window.spectrAI.session.setModel(sessionId, modelId)
          if (result?.success) {
            if (result.effectiveNow) {
              setQueueHintText(`模型已切换为 ${result.model || modelId}，后续消息将使用新模型`)
            } else if (result.requiresRestart) {
              setQueueHintText(`模型已切换为 ${modelId}，请重启会话使新模型生效`)
            } else {
              setQueueHintText(`模型已切换为 ${modelId}，下次启动时生效`)
            }
          } else {
            setQueueHintText(`模型切换失败: ${result?.error || '未知错误'}`)
          }
        } catch (err: any) {
          setQueueHintText(`模型切换失败: ${err?.message || '未知错误'}`)
        }
      }
      return
    }

    const dispatch = await sendMessage(text)
    if (!dispatch?.scheduled) return

    if (dispatch.reason === 'session_starting') {
      setQueueHintText('会话仍在启动中，消息已缓存')
    } else if (dispatch.strategy === 'interrupt_now') {
      setQueueHintText('已打断并排队，下一轮优先处理')
    } else {
      setQueueHintText('当前任务执行中，消息已排队')
    }

    // 从后端获取最新队列内容
    await refreshQueue()
  }, [sendMessage, refreshQueue])

  // 当 streaming 结束时，从后端刷新队列状态；若队列已空则清除提示
  useEffect(() => {
    if (!isStreaming && queuedMessages.length > 0) {
      refreshQueue()
    }
  }, [isStreaming]) // eslint-disable-line react-hooks/exhaustive-deps

  // 将消息分组
  const messageGroups = useMemo(() => groupMessages(messages), [messages])

  const opsBrief = useMemo<OpsBriefSnapshot>(() => {
    const userGoal = [...messages].reverse().find(m =>
      m.role === 'user' &&
      m.content &&
      !m.content.startsWith('\u25B6 /')
    )?.content
    const fileChanges = messages.filter(m => m.fileChange)
    const uniqueFiles = Array.from(new Set(fileChanges.map(m => m.fileChange?.filePath).filter(Boolean) as string[]))
    const additions = fileChanges.reduce((sum, m) => sum + (m.fileChange?.additions || 0), 0)
    const deletions = fileChanges.reduce((sum, m) => sum + (m.fileChange?.deletions || 0), 0)
    const toolUseMessages = messages.filter(m => m.role === 'tool_use')
    const commands = toolUseMessages.map(getToolCommand).filter(Boolean)
    const validationCommands = commands.filter(isValidationCommand)
    const failedToolCount = messages.filter(m => m.role === 'tool_result' && m.isError).length
    const messageCount = messages.filter(m => m.role === 'user' || m.role === 'assistant').length
    const hasWaitingAction = pendingPermission || pendingAskQuestion || pendingQuestion || pendingPlanApproval
    const phaseLabel = pendingPermission || pendingAskQuestion || pendingQuestion || pendingPlanApproval || status === 'error'
      ? '需要处理'
      : validationCommands.length > 0 && uniqueFiles.length > 0 && failedToolCount === 0
        ? '待交付'
        : validationCommands.length > 0
          ? '验证中'
          : uniqueFiles.length > 0
            ? '实现中'
            : toolUseMessages.length > 0
              ? '探索中'
              : '理解任务'
    const statusTone: OpsBriefSnapshot['statusTone'] =
      pendingPermission || pendingAskQuestion || pendingQuestion || pendingPlanApproval || status === 'error'
        ? 'blocked'
        : isStreaming || status === 'running'
          ? 'active'
          : status === 'completed'
            ? 'done'
            : 'neutral'
    const risks = [
      pendingPermission ? '有权限确认待处理' : '',
      pendingAskQuestion || pendingQuestion ? 'AI 正在等待你的回答' : '',
      pendingPlanApproval ? '执行计划需要审批' : '',
      status === 'error' ? '会话处于错误状态' : '',
      failedToolCount > 0 ? `${failedToolCount} 个工具调用异常` : '',
      uniqueFiles.length > 0 && validationCommands.length === 0 ? '已有改动，尚未看到验证命令' : '',
      !workingDirectory ? '未绑定项目目录' : '',
    ].filter(Boolean)
    if (risks.length === 0) risks.push('暂无明显阻塞')

    const nextActions = (() => {
      if (hasWaitingAction) return ['先处理等待项，再继续执行', '回答后让 AI 复述当前决策']
      if (status === 'error') return ['定位会话错误并恢复上下文', '确认错误是否影响当前交付']
      if (failedToolCount > 0) return ['复盘失败工具输出', '必要时换一条验证路径']
      if (uniqueFiles.length > 0 && validationCommands.length === 0) return ['运行类型检查、构建或关键测试', '确认改动范围是否符合预期']
      if (validationCommands.length > 0 && uniqueFiles.length > 0) return ['整理交付摘要和风险点', '生成提交说明或更新项目记忆']
      if (toolUseMessages.length > 0) return ['继续收敛根因和方案', '把发现沉淀成明确改动']
      return ['先让 AI 审视项目结构', '明确目标、约束和验收标准']
    })()

    const evidence = [
      uniqueFiles.length > 0
        ? `最近文件：${uniqueFiles.slice(-3).map(getShortFileName).join('、')}`
        : '暂无文件改动',
      validationCommands.length > 0
        ? `验证：${compactText(validationCommands[validationCommands.length - 1], 56)}`
        : commands.length > 0
          ? `最近命令：${compactText(commands[commands.length - 1], 56)}`
          : '尚未调用工具',
      `${toolUseMessages.length} 次工具调用，${failedToolCount} 个异常`,
    ]

    return {
      projectName: getProjectName(workingDirectory, session?.name || session?.config?.name),
      projectPath: workingDirectory,
      goal: compactText(userGoal || session?.config?.initialPrompt || session?.name || session?.config?.name || '还没有明确目标，先发送一条任务描述开始推进。', 120),
      statusLabel: pendingPermission
        ? '等待确认'
        : pendingAskQuestion || pendingQuestion
          ? '等待回答'
          : pendingPlanApproval
            ? '等待审批'
            : isStreaming
              ? '处理中'
              : SESSION_STATUS_LABEL[status || ''] || '待输入',
      statusTone,
      changedFileCount: uniqueFiles.length,
      additions,
      deletions,
      toolCount: toolUseMessages.length,
      failedToolCount,
      validationCount: validationCommands.length,
      messageCount,
      lastFiles: uniqueFiles.slice(-3).map(getShortFileName),
      lastCommand: compactText(commands[commands.length - 1] || validationCommands[validationCommands.length - 1] || '', 92),
      phaseLabel,
      liveProgressText,
      nextActions,
      risks,
      evidence,
    }
  }, [
    messages,
    workingDirectory,
    session?.name,
    session?.config?.name,
    session?.config?.initialPrompt,
    pendingPermission,
    pendingAskQuestion,
    pendingQuestion,
    pendingPlanApproval,
    status,
    isStreaming,
    liveProgressText,
  ])

  // Prompt 型 Skill 静默执行：展开模板后静默发送，用户只看到 ▶ /skillname 徽章
  const handleSkillExecute = useCallback(async (skill: SkillItem) => {
    if (!skill.promptTemplate) return
    const expanded = skill.promptTemplate
      .replace(/\{\{user_input\}\}/gi, '')
      .replace(/\{\{file_content\}\}/gi, '')
      .replace(/\{\{selection\}\}/gi, '')
      .replace(/\{\{[^}]+\}\}/g, '')
      .trim()
    if (!expanded) return
    try {
      await sendSkillMessage(sessionId, skill.slashCommand, expanded)
    } catch (err) {
      console.error('[SessionToolbar] sendSkillMessage 失败:', err)
    }
  }, [sendSkillMessage, sessionId])

  // 跨会话搜索：跳转到目标会话
  const handleJumpToSession = useCallback((targetSessionId: string) => {
    selectSession(targetSessionId)
  }, [selectSession])

  const updateCommonPrompts = useCallback((next: CommonPrompt[]) => {
    setCommonPrompts(next)
    saveCommonPrompts(next)
  }, [])

  const addCommonPrompt = useCallback(() => {
    const label = promptDraft.label.trim()
    const text = promptDraft.text.trim()
    if (!label || !text) return
    updateCommonPrompts([
      ...commonPrompts,
      { id: `custom-${Date.now()}`, label, text },
    ])
    setPromptDraft({ label: '', text: '' })
  }, [commonPrompts, promptDraft, updateCommonPrompts])

  const removeCommonPrompt = useCallback((id: string) => {
    const next = commonPrompts.filter(prompt => prompt.id !== id)
    updateCommonPrompts(next.length > 0 ? next : DEFAULT_COMMON_PROMPTS)
  }, [commonPrompts, updateCommonPrompts])

  const resetCommonPrompts = useCallback(() => {
    updateCommonPrompts(DEFAULT_COMMON_PROMPTS)
    setPromptDraft({ label: '', text: '' })
  }, [updateCommonPrompts])

  const handleCodeGraphAnswer = useCallback((answer: { suggestedPrompt?: string }) => {
    if (answer.suggestedPrompt) {
      setExternalInsert(answer.suggestedPrompt)
      setQueueHintText('已插入 Code Graph 上下文，检查后发送即可')
    }
  }, [])

  // 右键菜单项
  const ctxMenuItems: MenuItem[] = [
    {
      key: 'copy-all',
      label: '复制全部对话内容',
      icon: <Copy size={13} />,
      onClick: () => {
        const formatted = messages.map(m => {
          const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role
          return `[${role}] ${m.content || ''}`
        }).join('\n\n')
        navigator.clipboard.writeText(formatted)
      },
    },
    { key: 'div1', type: 'divider' },
    {
      key: 'scroll-top',
      label: '滚动到顶部',
      icon: <ArrowUp size={13} />,
      onClick: () => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0
      },
    },
    {
      key: 'scroll-bottom',
      label: '滚动到底部',
      icon: <ArrowDown size={13} />,
      onClick: () => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      },
    },
    { key: 'div2', type: 'divider' },
    {
      key: 'export-json',
      label: '导出对话（JSON）',
      icon: <Download size={13} />,
      onClick: () => {
        const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `conversation-${sessionId.slice(0, 8)}-${Date.now()}.json`
        a.click()
        URL.revokeObjectURL(url)
      },
    },
  ]

  return (
    <div className="relative flex flex-row flex-1 min-h-0 overflow-hidden bg-bg-primary">
      {/* 左侧：消息区域 */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        {/* 消息列表 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4 pb-8 smooth-scroll scroll-optimized md:px-8 lg:px-10"
          onScroll={handleConversationScroll}
          onContextMenu={(e) => {
            e.preventDefault()
            setCtxMenu({ visible: true, x: e.clientX, y: e.clientY })
          }}
        >
          {/* 知识库 FAB */}
          {workingDirectory && !knowledgePanelOpen && (
            <button
              onClick={() => setKnowledgePanelOpen(true)}
              title="打开项目知识库"
              className="absolute top-3 right-4 z-10 flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-elevated px-2.5 py-1.5 text-xs text-text-secondary shadow-sm backdrop-blur-sm transition-all hover:border-accent-purple/40 hover:bg-bg-hover hover:text-accent-purple hover:shadow-md hover:scale-105 active:scale-95"
            >
              <BookMarked className="w-3.5 h-3.5 transition-all duration-300 hover:rotate-12" />
              <span>知识库</span>
            </button>
          )}
          <div className="mx-auto max-w-[1080px]">
        {messages.length > 0 && (
          <OpsBrief
            snapshot={opsBrief}
            onInsertPrompt={setPendingInsert}
            onOpenKnowledge={() => setKnowledgePanelOpen(true)}
            canOpenKnowledge={!!workingDirectory}
            expanded={opsBriefExpanded}
            onToggleExpanded={() => setOpsBriefExpanded(expanded => !expanded)}
          />
        )}
        {messages.length === 0 ? (
          <div className="flex min-h-[420px] items-center justify-center text-text-muted text-sm">
            {isLoading ? (
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>加载对话历史...</span>
              </div>
            ) : isSessionEnded ? '会话已结束，点击下方恢复继续对话' : (
              <div className="w-full max-w-[640px] rounded-lg border border-border-subtle bg-bg-elevated p-6 shadow-[0_12px_32px_var(--color-shadow-sm)]">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium text-white"
                        style={{ backgroundColor: getProviderColor(providerId) }}
                      >
                        {providerId ?? '未知'}
                      </span>
                      <span className="font-mono text-xs text-text-muted select-all">
                        #{sessionId.slice(0, 8)}
                      </span>
                    </div>
                    <div className="text-lg font-semibold text-text-primary">准备开始</div>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                      从下方输入消息，或点击常用提示词快速进入工作流。
                    </p>
                  </div>
                </div>

                {workingDirectory && (
                  <div className="mb-5 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5">
                    <FolderOpen className="w-4 h-4 mt-0.5 flex-shrink-0 text-text-muted" />
                    <span className="break-all font-mono text-xs text-text-secondary leading-relaxed">
                      {workingDirectory}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {[
                    { key: 'Enter',         desc: '发送消息' },
                    { key: '/',             desc: '查看可用命令' },
                    { key: '@',             desc: '引用项目文件' },
                    { key: toPlatformShortcutLabel('Ctrl+Shift+F'),  desc: '跨会话搜索' },
                  ].map(({ key, desc }) => (
                    <div key={key} className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-xs text-text-muted">
                      <kbd className="mb-1 inline-flex rounded border border-border-subtle bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                        {key}
                      </kbd>
                      <div>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          messageGroups.map((group, idx) => {
            // 时间分割线：相邻 message 类型消息间隔超过 5 分钟时显示
            const elements: ReactNode[] = []
            if (group.type === 'message') {
              const prevGroup = idx > 0 ? messageGroups[idx - 1] : null
              if (prevGroup?.type === 'message') {
                const prevTime = new Date(prevGroup.message.timestamp || '').getTime()
                const curTime = new Date(group.message.timestamp || '').getTime()
                if (prevTime && curTime && (curTime - prevTime) > 5 * 60 * 1000) {
                  const timeLabel = new Date(curTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                  elements.push(
                    <div key={`divider-${group.message.id}`} className="flex items-center gap-3 my-4">
                      <div className="flex-1 border-t border-border-subtle" />
                      <span className="text-[10px] text-text-muted">{timeLabel}</span>
                      <div className="flex-1 border-t border-border-subtle" />
                    </div>
                  )
                }
              }
            }

            if (group.type === 'tool_group') {
              const groupKey = `tg-${group.messages[0]?.id}`
              elements.push(
                <ToolOperationGroup
                  key={groupKey}
                  messages={group.messages}
                  isActive={group.isActive && isStreaming}
                />
              )
            } else if (group.type === 'file_change') {
              elements.push(<FileChangeCard key={group.message.id} message={group.message} />)
            } else {
              elements.push(<MessageBubble key={group.message.id} message={group.message} isStreaming={isStreaming} />)
            }
            const fragmentKey =
              group.type === 'message' || group.type === 'file_change'
                ? group.message.id
                : `tg-${group.messages[0]?.id || idx}`
            return <React.Fragment key={fragmentKey}>{elements}</React.Fragment>
          })
        )}

        {/* 流式响应指示器 - 带实时计时器 + 渐变扫光动画 */}
        {isStreaming && (
          <div className="mb-6 flex justify-start animate-fade-in">
            <div className="relative max-w-[min(980px,92%)] py-2 pl-6 pr-3 text-sm text-text-muted">
              <span className="absolute bottom-0 left-0 top-0 w-px bg-border-subtle" aria-hidden="true" />
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border border-text-muted/40 border-t-accent-blue" />
                <span className="font-medium text-text-muted">正在思考</span>
                {thinkingSeconds > 0 && (
                  <span className="font-mono text-[11px] text-text-muted/60">
                    {formatThinkingTime(thinkingSeconds)}
                  </span>
                )}
              </div>
              {!!liveProgressText && (
                <div className="mt-2 max-w-full truncate text-[12px] text-text-muted/75" title={liveProgressText}>
                  {liveProgressText}
                </div>
              )}
            </div>
          </div>
        )}

        {showScrollBottom && (
          <div className="sticky bottom-3 z-20 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={() => scrollToBottom()}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary shadow-lg backdrop-blur-sm transition-all hover:border-accent-blue/40 hover:text-accent-blue"
              title="滚动到底部"
            >
              <ArrowDown size={13} />
              <span>回到底部</span>
            </button>
          </div>
        )}

        {/* 权限请求确认栏 */}
        {pendingPermission && (
          <div className="flex justify-center my-3 animate-fade-in">
            <div className="bg-accent-yellow/10 border border-accent-yellow/30 rounded-lg px-4 py-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-all duration-300">
              <span className="text-sm text-text-primary">
                {lastActivity?.detail || '需要确认'}
              </span>
              <button
                onClick={() => respondPermission(true)}
                className="px-3 py-1 bg-accent-green text-white text-xs rounded hover:bg-accent-green/80 transition-all hover:scale-105 active:scale-95"
              >
                允许
              </button>
              <button
                onClick={() => respondPermission(false)}
                className="px-3 py-1 bg-accent-red text-white text-xs rounded hover:bg-accent-red/80 transition-all hover:scale-105 active:scale-95"
              >
                拒绝
              </button>
            </div>
          </div>
        )}

        {/* AskUserQuestion 工具调用：多问题答题面板 */}
        {pendingAskQuestion && askQuestionMeta?.questions && askQuestionMeta.questions.length > 0 && (
          <AskUserQuestionPanel
            questions={askQuestionMeta.questions}
            onSubmit={respondQuestion}
            disabled={false}
          />
        )}

        {/* ExitPlanMode 工具调用：计划审批面板 */}
        {pendingPlanApproval && planApprovalMeta?.toolInput && (
          <PlanApprovalPanel
            toolInput={planApprovalMeta.toolInput}
            onApprove={() => approvePlan(true)}
            onReject={() => approvePlan(false)}
            disabled={false}
          />
        )}

        {/* AI 交互式提问栏 */}
        {pendingQuestion && questionMeta && (
          <UserQuestionBar
            question={questionMeta.question}
            options={questionMeta.options}
            onAnswer={sendWithSmartScheduling}
            disabled={!canSend}
          />
        )}

        {/* AI 运行中：停止按钮（sticky 定位在滚动区域底部） */}
        {isStreaming && (
          <div className="sticky bottom-0 flex justify-center py-2 bg-gradient-to-t from-bg-primary via-bg-primary/95 to-transparent z-10">
            <button
              onClick={abortSession}
              className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary shadow-sm transition-all hover:border-accent-red/50 hover:bg-accent-red/10 hover:text-accent-red"
              title="停止 AI 思考（软中断，会话保持可用）"
            >
              <span className="inline-block w-2 h-2 rounded-sm bg-current opacity-80" />
              停止生成
            </button>
          </div>
        )}

        {/* 右键菜单（Portal 渲染，挂在 body 上） */}
          </div>

        <ContextMenu
          visible={ctxMenu.visible}
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenuItems}
          onClose={() => setCtxMenu(m => ({ ...m, visible: false }))}
        />
      </div>

      {/* 输入区域 */}
      {!isSessionEnded && (
        <div className="relative border-t border-border-subtle bg-bg-primary px-4 pt-1.5 pb-2.5 shadow-[0_-10px_28px_var(--color-shadow-sm)]">
          {/* Skill 快捷按钮 + MCP 状态 */}
          <SessionToolbar
            sessionId={sessionId}
            onSkillClick={setPendingInsert}
            onSkillExecute={handleSkillExecute}
            onCodeGraphAnswer={handleCodeGraphAnswer}
            promptActions={
              <button
                type="button"
                onClick={() => {
                  setPromptPickerOpen(open => !open)
                  setPromptManagerOpen(false)
                }}
                className={`flex h-6 flex-shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                  promptPickerOpen
                    ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue'
                    : 'border-transparent bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                }`}
                title="打开常用提示词"
              >
                <Settings2 size={12} />
                <span>提示词</span>
                <span className="text-[10px] text-text-muted">{commonPrompts.length}</span>
              </button>
            }
          />

          {promptPickerOpen && !promptManagerOpen && (
            <div className="mx-auto mb-2 flex w-full max-w-[1080px] items-center gap-1.5 overflow-x-auto rounded-lg border border-border-subtle bg-bg-elevated px-2.5 py-2 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="flex-shrink-0 text-[11px] font-medium text-text-muted">常用提示词</span>
              {commonPrompts.map(prompt => (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => {
                    setPendingInsert(prompt.text)
                    setPromptPickerOpen(false)
                  }}
                  disabled={!canSend}
                  className="flex h-6 flex-shrink-0 items-center rounded-md border border-transparent bg-bg-tertiary px-2.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-accent-blue/10 hover:text-accent-blue disabled:cursor-not-allowed disabled:opacity-40"
                  title={prompt.text}
                >
                  {prompt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPromptPickerOpen(false)
                  setPromptManagerOpen(true)
                }}
                className="ml-auto flex h-6 flex-shrink-0 items-center gap-1 rounded-md border border-border-subtle px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:border-accent-blue/35 hover:text-accent-blue"
                title="管理常用提示词"
              >
                <Settings2 size={12} />
                管理
              </button>
            </div>
          )}

          {promptManagerOpen && (
            <div className="mx-auto mb-2 w-full max-w-[1080px] rounded-lg border border-border-subtle bg-bg-elevated p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-secondary">管理常用提示词</span>
                <button
                  type="button"
                  onClick={resetCommonPrompts}
                  className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-muted transition-colors hover:border-accent-blue/35 hover:text-accent-blue"
                >
                  <RotateCcw size={11} />
                  恢复默认
                </button>
              </div>
              <div className="mb-2 grid gap-2 md:grid-cols-[160px_1fr_auto]">
                <input
                  value={promptDraft.label}
                  onChange={event => setPromptDraft(draft => ({ ...draft, label: event.target.value }))}
                  placeholder="名称，例如：写测试"
                  className="rounded-lg border border-border-subtle bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-blue/50 focus:outline-none"
                />
                <input
                  value={promptDraft.text}
                  onChange={event => setPromptDraft(draft => ({ ...draft, text: event.target.value }))}
                  onKeyDown={event => {
                    if (event.key === 'Enter') addCommonPrompt()
                  }}
                  placeholder="提示词内容"
                  className="rounded-lg border border-border-subtle bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-blue/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addCommonPrompt}
                  disabled={!promptDraft.label.trim() || !promptDraft.text.trim()}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-accent-blue/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                >
                  <Plus size={12} />
                  添加
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {commonPrompts.map(prompt => (
                  <div
                    key={`manage-${prompt.id}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-transparent bg-bg-tertiary px-2 py-1 text-xs text-text-secondary"
                    title={prompt.text}
                  >
                    <span className="truncate max-w-[180px]">{prompt.label}</span>
                    <button
                      type="button"
                      onClick={() => removeCommonPrompt(prompt.id)}
                      className="rounded-full p-0.5 text-text-muted hover:bg-accent-red/10 hover:text-accent-red transition-colors"
                      title="删除"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {queuedMessages.length > 0 && (
            <div className="px-4 pb-1">
              <div className="px-2.5 py-1.5 text-xs rounded-md border border-accent-blue/40 bg-accent-blue/10 text-accent-blue">
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 font-medium">
                    {queueHintText || '消息已排队'}（{queuedMessages.length} 条）
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        await window.spectrAI.session.clearQueue(sessionId)
                        setQueuedMessages([])
                        setQueueHintText('')
                      } catch { /* ignore */ }
                    }}
                    className="p-0.5 rounded hover:bg-accent-blue/20 transition-colors flex-shrink-0"
                    title="取消所有排队消息"
                  >
                    <X size={12} />
                  </button>
                </div>
                {queuedMessages.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {queuedMessages.map((msg, idx) => (
                      <div key={msg.id} className="flex items-center gap-1 text-accent-blue/70 truncate">
                        <span className="text-accent-blue/40 flex-shrink-0">{idx + 1}.</span>
                        <span className="truncate">{msg.text.length > 60 ? msg.text.slice(0, 60) + '…' : msg.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <MessageInput
            sessionId={sessionId}
            onSend={sendWithSmartScheduling}
            disabled={!canSend}
            pendingInsert={pendingInsert}
            onPendingInsertHandled={() => setPendingInsert(undefined)}
            externalInsert={externalInsert}
            onExternalInsertHandled={() => setExternalInsert(undefined)}
            onOpenSessionSearch={() => { setSearchMode('cross'); setCrossSessionSearchOpen(true) }}
            placeholder={
              isStreaming
                ? 'AI 正在执行中，可直接插入新消息，系统会自动判断打断或排队。'
                : status === 'starting'
                  ? 'Session is recovering... if this takes too long, try resume again.'
                  : isSessionEnded
                  ? '发送第一条消息将先恢复上下文，再继续对话。'
                  : pendingPermission
                  ? '等待确认...'
                  : pendingAskQuestion
                    ? '请在上方回答 Claude 的问题...'
                    : pendingPlanApproval
                      ? '请在上方审批 Claude 的计划...'
                      : pendingQuestion
                        ? '可点击上方选项，或直接输入自定义答案...'
                        : '输入消息，Enter 发送，/ 查看命令，拖拽文件引用'
            }
          />
        </div>
      )}

      {/* 已结束会话：恢复继续按钮 */}
      {isSessionEnded && (
        <div className="border-t border-border-subtle bg-bg-primary px-4 py-3 animate-fade-in">
          <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              {status === 'error' ? (
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-accent-red" />
              ) : (
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-accent-blue" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium text-text-secondary">
                  {status === 'error' ? '会话需要处理' : '会话已结束'}
                </div>
                <div className="truncate text-[11px] text-text-muted">
                  {status === 'error'
                    ? '可以恢复会话后继续排查，原有上下文会尽量保留。'
                    : '需要继续时可以恢复会话，并接着发送新消息。'}
                </div>
              </div>
            </div>
          <button
            disabled={resuming}
            onClick={async () => {
              setResuming(true)
              try {
                await resumeSession(sessionId)
              } finally {
                setResuming(false)
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${resuming ? 'animate-spin' : ''}`} />
            {resuming ? '恢复中...' : '恢复继续'}
          </button>
          </div>
        </div>
      )}

      {/* 跨会话搜索面板（Modal） */}
      {crossSessionSearchOpen && (
        <CrossSessionSearch
          currentSessionId={sessionId}
          onInsert={(text) => setExternalInsert(text)}
          onJumpToSession={handleJumpToSession}
          onClose={() => setCrossSessionSearchOpen(false)}
          initialMode={searchMode}
        />
      )}
      </div>

      {/* 右侧：知识库抽屉。作为浮层显示，避免被主区/右侧详情面板挤压成窄栏。 */}
      {knowledgePanelOpen && workingDirectory && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-40 flex max-w-full justify-end">
          <div className="pointer-events-auto h-full w-[min(420px,calc(100vw-96px))] min-w-[320px] max-w-full border-l border-border-subtle bg-bg-primary shadow-[-18px_0_36px_var(--color-shadow-sm)]">
            <SessionKnowledgePanel
              sessionId={sessionId}
              projectPath={workingDirectory}
              onClose={() => setKnowledgePanelOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

ConversationView.displayName = 'ConversationView'
export default ConversationView
