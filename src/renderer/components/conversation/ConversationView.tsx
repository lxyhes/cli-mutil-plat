/**
 * 对话视图组件
 *
 * SDK V2 架构的主要交互视图，替代 xterm.js 终端渲染。
 * 显示结构化对话消息流：用户消息、AI 回复、工具调用卡片、权限请求等。
 *
 * @author weibin
 */

import React, { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, RotateCcw, Copy, ArrowUp, ArrowDown, Download, X, BookMarked } from 'lucide-react'
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

const COMMON_PROMPTS = [
  { label: '审视项目', text: '审视下我的项目，先给出结构、风险点和下一步优先级。' },
  { label: '继续下一步', text: '继续下一步，按最短路径推进，改完后帮我验证。' },
  { label: '排查问题', text: '帮我排查这个问题，先定位根因，再给出最小修复方案。' },
  { label: '优化 UI', text: '帮我优化这个页面的 UI/UX，不破坏现有功能，完成后说明改了什么。' },
  { label: '更新 todo', text: '根据当前进度更新 todo.md，并继续完成最高优先级事项。' },
]

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
    <div className="flex flex-row flex-1 min-h-0 bg-bg-primary">
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
              className="absolute top-3 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-bg-secondary/90 border border-border text-xs text-text-secondary hover:text-accent-purple hover:border-accent-purple/40 transition-all backdrop-blur-sm shadow-sm hover:shadow-md hover:scale-105 active:scale-95 hover:bg-bg-secondary"
            >
              <BookMarked className="w-3.5 h-3.5 transition-all duration-300 hover:rotate-12" />
              <span>知识库</span>
            </button>
          )}
          <div className="mx-auto max-w-[1080px]">
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
              <div className="w-full max-w-[640px] rounded-2xl border border-border/40 bg-bg-secondary/35 p-6 shadow-sm">
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
                  <div className="mb-5 flex items-start gap-2 rounded-xl border border-border/35 bg-bg-primary/35 px-3 py-2.5">
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
                    <div key={key} className="rounded-xl border border-border/30 bg-bg-primary/25 px-3 py-2 text-xs text-text-muted">
                      <kbd className="mb-1 inline-flex rounded border border-border/45 bg-bg-primary px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
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
                      <div className="flex-1 border-t border-border/40" />
                      <span className="text-[10px] text-text-muted">{timeLabel}</span>
                      <div className="flex-1 border-t border-border/40" />
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
          <div className="mb-4 flex justify-start animate-fade-in">
            <div className="relative max-w-[min(620px,78%)] overflow-hidden rounded-2xl border border-border/35 bg-bg-secondary/35 px-4 py-3 text-sm text-text-muted shadow-sm transition-all duration-300 hover:border-border/70">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent-blue/5 to-transparent animate-pulse" />
              <div className="relative flex items-center gap-2">
                <span className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border border-text-muted/50 border-t-accent-blue" />
                <span className="font-medium text-text-secondary">AI 正在处理</span>
                {thinkingSeconds > 0 && (
                  <span className="font-mono text-[11px] text-text-muted/60">
                    {formatThinkingTime(thinkingSeconds)}
                  </span>
                )}
              </div>
              {!!liveProgressText && (
                <div className="relative mt-2 max-w-full truncate text-[11px] text-text-muted/80" title={liveProgressText}>
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
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-bg-secondary/95 px-3 py-1.5 text-xs text-text-secondary shadow-lg backdrop-blur-sm transition-all hover:border-accent-blue/40 hover:text-accent-blue"
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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border border-border rounded-full text-xs text-text-secondary hover:text-accent-red hover:border-accent-red/50 hover:bg-accent-red/5 transition-all shadow-sm"
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
        <div className="relative border-t border-border/40 bg-bg-primary/95 px-4 pt-2 pb-3 shadow-[0_-18px_40px_rgba(0,0,0,0.14)]">
          {/* Skill 快捷按钮 + MCP 状态 */}
          <SessionToolbar
            sessionId={sessionId}
            onSkillClick={setPendingInsert}
            onSkillExecute={handleSkillExecute}
          />

          <div className="mx-auto mb-2 flex w-full max-w-[1080px] items-center gap-1.5 overflow-x-auto rounded-2xl border border-border/35 bg-bg-secondary/25 px-2.5 py-2">
            <span className="flex-shrink-0 text-[11px] font-medium text-text-muted">常用提示词</span>
            {COMMON_PROMPTS.map(prompt => (
              <button
                key={prompt.label}
                type="button"
                onClick={() => setPendingInsert(prompt.text)}
                disabled={!canSend}
                className="flex-shrink-0 rounded-full border border-border/45 bg-bg-primary/35 px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue/40 hover:bg-accent-blue/10 hover:text-accent-blue disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                title={prompt.text}
              >
                {prompt.label}
              </button>
            ))}
          </div>

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
        <div className="border-t border-border bg-bg-secondary px-4 py-3 animate-fade-in">
          <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 rounded-2xl border border-border/45 bg-bg-primary/35 px-3 py-2.5">
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

      {/* 右侧：知识库抽屉 */}
      {knowledgePanelOpen && workingDirectory && (
        <SessionKnowledgePanel
          sessionId={sessionId}
          projectPath={workingDirectory}
          onClose={() => setKnowledgePanelOpen(false)}
        />
      )}
    </div>
  )
}

ConversationView.displayName = 'ConversationView'
export default ConversationView
