/**
 * Session 工具栏组件
 *
 * 显示在消息输入框上方，提供两类快捷入口：
 * 1. Skill 按钮：显示可用 Skill 数量，点击弹出列表，列表中点击注入 /slashCommand 到输入框
 * 2. MCP 状态按钮：显示当前会话已启用的 MCP 数量，点击弹出只读列表
 *
 * Skill 来源合并策略（三类来源）：
 *   - SpectrAI DB Skill：isEnabled + 有 slashCommand + compatibleProviders 兼容当前 Provider
 *   - Provider 原生命令：来自 sessionInitData.skills（Claude Code 的 /compact、/memory 等）
 *   - 去重规则：DB Skill 优先，原生命令中与 DB 同名的 slashCommand 不重复展示
 *
 * @author weibin
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Zap, Plug, Cpu, Users, Sparkles, FileText, Mic, ShieldCheck, Activity, BookMarked, Brain, ChevronDown, Check, GitBranch, Send } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSkillStore } from '../../stores/skillStore'
import { useMcpStore } from '../../stores/mcpStore'
import { useUIStore } from '../../stores/uiStore'
import { useFileManagerStore } from '../../stores/fileManagerStore'
import type { ToolboxFeatureId } from '../../stores/uiStore'

// ---- 类型 ----

/** 展示在 Popover 中的统一 Skill 条目 */
export interface SkillItem {
  slashCommand: string
  name: string
  description: string
  /** 来源标识，用于在 Popover 中显示不同的视觉标记 */
  source: 'custom' | 'builtin' | 'native'
  /**
   * Skill 类型
   * - 'prompt'：SpectrAI 管理的模板型 Skill，需要静默展开后发送
   * - 'native'：Provider 原生命令（/compact 等），直接插入输入框由 CLI 处理
   */
  type: 'prompt' | 'native' | 'orchestration'
  /** promptTemplate 原文（type==='prompt' 时有值） */
  promptTemplate?: string
}

interface CodeGraphAnswer {
  projectPath?: string
  summary?: string
  suggestedPrompt?: string
  sections?: Array<{ title: string; items: string[] }>
  references?: CodeGraphReference[]
}

interface CodeGraphReference {
  type: 'file' | 'symbol'
  filePath: string
  symbolName?: string
  line?: number
  label: string
  reason: string
}

interface SessionToolbarProps {
  sessionId: string
  /** 原生命令点击时回调：插入 "/slashCommand " 到输入框，由 CLI 原生处理 */
  onSkillClick: (command: string) => void
  /** Prompt 型 Skill 点击时回调：父组件负责静默展开并发送，不插入输入框 */
  onSkillExecute: (skill: SkillItem) => void
  /** Code Graph 问答完成后，把结构化上下文交给输入框或上层会话 */
  onCodeGraphAnswer?: (answer: CodeGraphAnswer) => void
}

// ---- 通用 hook ----

/** Popover 通用的"点击外部 + Esc 关闭"逻辑 */
function usePopoverClose(
  open: boolean,
  setOpen: (v: boolean) => void,
  btnRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const handleOutside = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open, setOpen, btnRef, panelRef])
}

// ---- 来源标记样式 ----

const SOURCE_DOT: Record<SkillItem['source'], string> = {
  custom:  'bg-accent-blue',
  builtin: 'bg-text-muted',
  native:  'bg-accent-green',
}

const SOURCE_LABEL: Record<SkillItem['source'], string> = {
  custom:  'Custom',
  builtin: 'Built-in',
  native:  'Native',
}

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

const CODEX_MODEL_FALLBACKS = [
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
  { id: 'codex-mini-latest', name: 'Codex Mini' },
]

const REASONING_OPTIONS: Array<{ id: string; label: string; model?: string; effort: ReasoningEffort }> = [
  { id: 'smart', label: '\u667a\u80fd', model: 'gpt-5.5', effort: 'high' },
  { id: 'low', label: '\u4f4e', effort: 'low' },
  { id: 'medium', label: '\u4e2d', effort: 'medium' },
  { id: 'high', label: '\u9ad8', effort: 'high' },
  { id: 'xhigh', label: '\u8d85\u9ad8', effort: 'xhigh' },
]

const REASONING_LABEL: Record<string, string> = {
  low: '\u4f4e',
  medium: '\u4e2d',
  high: '\u9ad8',
  xhigh: '\u8d85\u9ad8',
}

function resolveProjectFilePath(projectPath: string | undefined, filePath: string): string {
  if (!projectPath || /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\')) {
    return filePath
  }
  const separator = projectPath.includes('\\') ? '\\' : '/'
  return `${projectPath.replace(/[\\/]+$/, '')}${separator}${filePath.replace(/[\\/]+/g, separator)}`
}
// ---- 主组件 ----

const SessionToolbar: React.FC<SessionToolbarProps> = ({ sessionId, onSkillClick, onSkillExecute, onCodeGraphAnswer }) => {
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false)
  const [mcpPopoverOpen, setMcpPopoverOpen] = useState(false)
  const [codeGraphPopoverOpen, setCodeGraphPopoverOpen] = useState(false)
  const [codeGraphQuestion, setCodeGraphQuestion] = useState('')
  const [codeGraphLoading, setCodeGraphLoading] = useState(false)
  const [codeGraphError, setCodeGraphError] = useState<string | null>(null)
  const [codeGraphAnswer, setCodeGraphAnswer] = useState<CodeGraphAnswer | null>(null)
  /** Skill 搜索框内容 */
  const [skillFilter, setSkillFilter] = useState('')

  const skillBtnRef = useRef<HTMLButtonElement>(null)
  const skillPopoverRef = useRef<HTMLDivElement>(null)
  const skillFilterRef = useRef<HTMLInputElement>(null)
  const mcpBtnRef = useRef<HTMLButtonElement>(null)
  const mcpPopoverRef = useRef<HTMLDivElement>(null)
  const codeGraphBtnRef = useRef<HTMLButtonElement>(null)
  const codeGraphPopoverRef = useRef<HTMLDivElement>(null)
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false)
  const [modelSwitching, setModelSwitching] = useState(false)
  const modelBtnRef = useRef<HTMLButtonElement>(null)
  const modelPopoverRef = useRef<HTMLDivElement>(null)

  // ---- 数据来源 ----
  const initData = useSessionStore(s => s.sessionInitData[sessionId])
  const setSessionInitData = useSessionStore(s => s.setSessionInitData)
  // 当前会话的 Provider（用于过滤 compatibleProviders）
  const providerId = useSessionStore(s =>
    s.sessions.find(sess => sess.id === sessionId)?.providerId
  )
  // 当前会话是否为 Supervisor 模式
  const isSupervisor = useSessionStore(s =>
    !!s.sessions.find(sess => sess.id === sessionId)?.config?.supervisorMode
  )
  const workingDirectory = useSessionStore(s =>
    s.sessions.find(sess => sess.id === sessionId)?.config?.workingDirectory
  )
  // 当前使用的模型
  const currentModel = initData?.model || ''
  const currentReasoningEffort = initData?.reasoningEffort || ''
  const availableModels = (initData?.availableModels?.length ? initData.availableModels : CODEX_MODEL_FALLBACKS)
  const allSkills = useSkillStore(s => s.skills)
  const fetchSkills = useSkillStore(s => s.fetchAll)
  const allMcpServers = useMcpStore(s => s.servers)
  const fetchMcps = useMcpStore(s => s.fetchAll)
  const openFileInTab = useFileManagerStore(s => s.openFileInTab)

  // 首次挂载时确保数据已加载
  useEffect(() => {
    if ((allSkills?.length ?? 0) === 0) fetchSkills()
    if ((allMcpServers?.length ?? 0) === 0) fetchMcps()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Popover 打开时自动聚焦搜索框；关闭时清空筛选词
  useEffect(() => {
    if (skillPopoverOpen) {
      // 等 DOM 渲染后聚焦
      setTimeout(() => skillFilterRef.current?.focus(), 50)
    } else {
      setSkillFilter('')
    }
  }, [skillPopoverOpen])

  // ---- 计算合并后的 Skill 列表 ----
  const skillList = useMemo((): SkillItem[] => {
    // 1. SpectrAI DB Skill：isEnabled + 有 slashCommand + 兼容当前 Provider
    const safeSkills = Array.isArray(allSkills) ? allSkills : []
    const dbItems: SkillItem[] = safeSkills
      .filter(s => {
        if (!s.isEnabled || !s.slashCommand) return false
        if (s.compatibleProviders === 'all') return true
        if (!providerId) return true
        return Array.isArray(s.compatibleProviders) && s.compatibleProviders.includes(providerId)
      })
      .map(s => ({
        slashCommand: s.slashCommand!,
        name: s.name,
        description: s.description || '',
        source: (s.source === 'custom' ? 'custom' : 'builtin') as SkillItem['source'],
        type: (s.type || 'prompt') as SkillItem['type'],
        promptTemplate: s.promptTemplate,
      }))

    // 2. Provider 原生命令：解析 sessionInitData.skills
    const nativeItems: SkillItem[] = []
    if (initData?.skills && initData.skills.length > 0) {
      for (const s of initData.skills as any[]) {
        const cmd = typeof s === 'string'
          ? (s.startsWith('/') ? s.slice(1) : s)
          : (s.name || s.command || s.slug || '')
        const desc = typeof s === 'object'
          ? (s.description || s.hint || s.summary || s.help || '')
          : ''
        if (cmd) {
          nativeItems.push({ slashCommand: cmd, name: cmd, description: desc, source: 'native', type: 'native' })
        }
      }
    }

    // 3. 去重：DB 中已有同名 slashCommand 的原生命令不再重复
    const dbCommandSet = new Set(dbItems.map(i => i.slashCommand))
    const uniqueNative = nativeItems.filter(n => !dbCommandSet.has(n.slashCommand))

    // 4. SpectrAI 系统 Skill：custom（自定义 + MCP 安装）在前，builtin（内置）在后
    const systemItems = [
      ...dbItems.filter(i => i.source === 'custom'),
      ...dbItems.filter(i => i.source === 'builtin'),
    ]

    // 5. CLI 原生命令排最后
    return [...systemItems, ...uniqueNative]
  }, [initData?.skills, allSkills, providerId])

  /** 搜索过滤后的列表（忽略大小写，匹配命令名 or 描述） */
  const filteredSkillList = useMemo(() => {
    const q = skillFilter.trim().toLowerCase()
    if (!q) return skillList
    return skillList.filter(s =>
      s.slashCommand.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    )
  }, [skillList, skillFilter])

  // ---- 计算 MCP 列表 ----
  const mcpList = useMemo(() => {
    // 防御性检查：确保 allMcpServers 是数组
    const safeMcpServers = Array.isArray(allMcpServers) ? allMcpServers : []
    
    // 从 initData.tools 中解析 MCP 工具（格式：mcp__serverKey__toolName）
    const toolsByServer: Record<string, string[]> = {}
    if (initData?.tools && Array.isArray(initData.tools)) {
      for (const tool of initData.tools as string[]) {
        if (tool.startsWith('mcp__')) {
          // mcp__serverKey__toolName，serverKey 本身可能含双下划线，取第一段
          const withoutPrefix = tool.slice('mcp__'.length)
          const secondSep = withoutPrefix.indexOf('__')
          if (secondSep > 0) {
            const serverKey = withoutPrefix.slice(0, secondSep)
            const toolName = withoutPrefix.slice(secondSep + 2)
            if (!toolsByServer[serverKey]) toolsByServer[serverKey] = []
            toolsByServer[serverKey].push(toolName)
          }
        }
      }
    }

    if (initData?.mcpServers && initData.mcpServers.length > 0) {
      return initData.mcpServers.map((m: any) => {
        // initData.mcpServers 中存放的是 Claude Code 上报的配置键名（即 McpServer.id）
        // 需要同时匹配 s.id（用户自建 MCP）和 s.name（内置 MCP 键名与名称相同的情况）
        const key = typeof m === 'string' ? m : (m.name || m.id || String(m))
        const full = safeMcpServers.find(s => s.id === key || s.name === key)
        // 优先展示用户填写的中文显示名，若未找到则回退到 key
        const tools = toolsByServer[key] || []
        return { name: full?.name ?? key, category: full?.category, description: full?.description, key, tools }
      }).filter(m => m.name)
    }
    return safeMcpServers
      .filter(s => s.isGlobalEnabled)
      .map(s => {
        const tools = toolsByServer[s.id] || toolsByServer[s.name] || []
        return { name: s.name, category: s.category, description: s.description, key: s.id, tools }
      })
  }, [initData?.mcpServers, initData?.tools, allMcpServers])

  // ---- MCP 工具展开状态 ----
  const [expandedMcps, setExpandedMcps] = useState<Set<string>>(new Set())
  const toggleMcpExpand = useCallback((key: string) => {
    setExpandedMcps(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 工具箱功能状态
  const [toolboxPopoverOpen, setToolboxPopoverOpen] = useState(false)
  const toolboxBtnRef = useRef<HTMLButtonElement>(null)
  const toolboxPopoverRef = useRef<HTMLDivElement>(null)
  const setToolboxFeature = useUIStore(s => s.setToolboxFeature)
  const setActivePanelLeft = useUIStore(s => s.setActivePanelLeft)

  // 工具箱功能列表
  const toolboxFeatures = useMemo<Array<{
    id: ToolboxFeatureId
    name: string
    description: string
    icon: React.ElementType
    color: string
  }>>(() => [
    {
      id: 'prompt-optimizer',
      name: '提示词优化',
      description: 'AI 驱动的提示词工程',
      icon: Sparkles,
      color: 'text-accent-yellow'
    },
    {
      id: 'summary',
      name: '会话摘要',
      description: '自动生成会话总结',
      icon: FileText,
      color: 'text-accent-green'
    },
    {
      id: 'voice',
      name: '语音交互',
      description: '语音输入与 TTS 播报',
      icon: Mic,
      color: 'text-accent-green'
    },
    {
      id: 'review',
      name: '代码审查',
      description: 'AI 自动代码审查',
      icon: ShieldCheck,
      color: 'text-accent-green'
    },
    {
      id: 'resource-monitor',
      name: '资源监控',
      description: '成本、Token、上下文预算',
      icon: Activity,
      color: 'text-accent-cyan'
    },
    {
      id: 'knowledge',
      name: '知识中心',
      description: '知识库+记忆+工作上下文',
      icon: BookMarked,
      color: 'text-accent-purple'
    }
  ], [])

  // 工具箱 Popover 关闭逻辑
  usePopoverClose(toolboxPopoverOpen, setToolboxPopoverOpen, toolboxBtnRef, toolboxPopoverRef)
  usePopoverClose(modelPopoverOpen, setModelPopoverOpen, modelBtnRef, modelPopoverRef)
  usePopoverClose(codeGraphPopoverOpen, setCodeGraphPopoverOpen, codeGraphBtnRef, codeGraphPopoverRef)

  // 处理工具箱功能点击
  const handleToolboxFeatureClick = useCallback((featureId: ToolboxFeatureId) => {
    setToolboxPopoverOpen(false)
    setToolboxFeature(featureId)
    setActivePanelLeft('toolbox')
  }, [setToolboxFeature, setActivePanelLeft])


  const modelOptions = useMemo(() => {
    const seen = new Set<string>()
    return availableModels.filter(model => {
      if (!model?.id || seen.has(model.id)) return false
      seen.add(model.id)
      return true
    })
  }, [availableModels])

  const handleModelSwitch = useCallback(async (model: string, reasoningEffort?: ReasoningEffort) => {
    if (!model || modelSwitching) return
    setModelSwitching(true)
    try {
      const result = await window.spectrAI.session.setModel(sessionId, model, { reasoningEffort })
      if (!result?.success) {
        console.error('[SessionToolbar] Failed to switch model:', result?.error || result)
      } else {
        const payload = result.data || result
        setSessionInitData(sessionId, {
          model: payload.model || model,
          reasoningEffort: payload.reasoningEffort ?? reasoningEffort ?? currentReasoningEffort,
          availableModels: payload.availableModels,
        })
      }
    } catch (error) {
      console.error('[SessionToolbar] Failed to switch model:', error)
    } finally {
      setModelSwitching(false)
      setModelPopoverOpen(false)
    }
  }, [sessionId, modelSwitching, setSessionInitData, currentReasoningEffort])

  const handleCodeGraphAsk = useCallback(async () => {
    const question = codeGraphQuestion.trim()
    if (!question || !workingDirectory || codeGraphLoading) return
    setCodeGraphLoading(true)
    setCodeGraphError(null)
    try {
      const result = await window.spectrAI.codeGraph.ask(workingDirectory, question)
      if (!result?.success) {
        setCodeGraphError(result?.error?.userMessage || result?.error?.message || result?.error || '代码库问答失败')
        return
      }
      const answer = (result.data || result) as CodeGraphAnswer
      setCodeGraphAnswer(answer)
      if (answer.suggestedPrompt) {
        onCodeGraphAnswer?.(answer)
      }
    } catch (error: any) {
      setCodeGraphError(error?.message || '代码库问答失败')
    } finally {
      setCodeGraphLoading(false)
    }
  }, [codeGraphQuestion, workingDirectory, codeGraphLoading, onCodeGraphAnswer])

  const handleOpenGraphReference = useCallback((reference: CodeGraphReference) => {
    void openFileInTab(resolveProjectFilePath(codeGraphAnswer?.projectPath || workingDirectory, reference.filePath))
  }, [codeGraphAnswer?.projectPath, workingDirectory, openFileInTab])

  const handleInsertGraphReference = useCallback((reference: CodeGraphReference) => {
    const absolutePath = resolveProjectFilePath(codeGraphAnswer?.projectPath || workingDirectory, reference.filePath)
    const lineSuffix = reference.line ? `:${reference.line}` : ''
    const symbolSuffix = reference.symbolName ? `#${reference.symbolName}` : ''
    onCodeGraphAnswer?.({
      suggestedPrompt: reference.type === 'symbol'
        ? `[符号: ${absolutePath}${lineSuffix}${symbolSuffix}]`
        : `[文件: ${absolutePath}]`,
    })
  }, [codeGraphAnswer?.projectPath, workingDirectory, onCodeGraphAnswer])

  // ---- Popover 关闭逻辑 ----
  usePopoverClose(skillPopoverOpen, setSkillPopoverOpen, skillBtnRef, skillPopoverRef)
  usePopoverClose(mcpPopoverOpen, setMcpPopoverOpen, mcpBtnRef, mcpPopoverRef)

  // 点击 Skill 列表项：根据类型路由
  // - native：插入 /command 到输入框，由 CLI 原生处理
  // - prompt/orchestration：触发静默执行（展开模板后发送，用户不见模板原文）
  const handleSkillSelect = useCallback((skill: SkillItem) => {
    setSkillPopoverOpen(false)
    if (skill.type === 'native') {
      onSkillClick(`/${skill.slashCommand} `)
    } else {
      onSkillExecute(skill)
    }
  }, [onSkillClick, onSkillExecute])

  return (
    <div className="mx-auto mb-2 flex w-full max-w-[1080px] flex-wrap items-center gap-1.5 rounded-2xl border border-border/35 bg-bg-secondary/30 px-2.5 py-2 shadow-sm">
      <span className="order-1 mr-1 flex-shrink-0 text-[11px] font-medium text-text-muted">
        会话配置
      </span>

      {/* ---- 会话模式 + 模型信息 ---- */}
      <div className="order-1 flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-bg-primary/35 border border-border/25 text-text-muted select-none">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${isSupervisor ? 'bg-accent-green' : 'bg-accent-blue'}`} />
        {isSupervisor ? (
          <Users size={11} className="text-accent-green flex-shrink-0" />
        ) : (
          <Cpu size={11} className="text-accent-blue/60 flex-shrink-0" />
        )}
        <span className="text-text-secondary font-medium">
          {isSupervisor ? 'Supervisor' : '普通会话'}
        </span>
      </div>

      {/* ---- Model / reasoning selector ---- */}
      <div className="relative order-1 flex-shrink-0">
        <button
          ref={modelBtnRef}
          onClick={() => setModelPopoverOpen(o => !o)}
          disabled={modelSwitching}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
            bg-bg-primary/35 border border-border/25 text-text-muted
            hover:text-text-secondary hover:bg-bg-hover
            transition-colors cursor-pointer select-none disabled:opacity-60 disabled:cursor-wait
            ${modelPopoverOpen ? 'border-accent-blue/40 text-text-secondary' : 'border-border'}`}
          title={`${currentModel || 'Model'}${currentReasoningEffort ? ` / ${REASONING_LABEL[currentReasoningEffort] || currentReasoningEffort}` : ''}`}
        >
          <Brain size={12} />
          <span className="max-w-[120px] truncate">{currentModel || '\u6a21\u578b'}</span>
          {currentReasoningEffort && (
            <span className="text-[10px] text-text-muted/80">
              {REASONING_LABEL[currentReasoningEffort] || currentReasoningEffort}
            </span>
          )}
          <ChevronDown size={11} />
        </button>

        {modelPopoverOpen && (
          <div
            ref={modelPopoverRef}
            className="absolute bottom-full left-0 mb-1.5 w-48 bg-bg-secondary border border-border rounded-lg shadow-lg py-1.5 z-50"
          >
            <div className="px-2 pb-1 border-b border-border/70">
              {REASONING_OPTIONS.map(option => {
                const targetModel = option.model || currentModel || 'gpt-5.5'
                const active = currentReasoningEffort === option.effort && (!option.model || currentModel === option.model)
                return (
                  <button
                    key={option.id}
                    onClick={() => handleModelSwitch(targetModel, option.effort)}
                    className={`w-full px-2 py-1.5 flex items-center gap-2 rounded-md text-left text-xs transition-colors
                      ${active
                        ? 'bg-accent-blue/12 text-accent-blue border border-accent-blue/25'
                        : 'text-text-secondary border border-transparent hover:bg-bg-hover'}`}
                  >
                    <span className="w-3.5 flex justify-center">
                      {active && <Check size={12} />}
                    </span>
                    <span className={`flex-1 truncate ${active ? 'font-medium' : ''}`}>{option.label}</span>
                  </button>
                )
              })}
            </div>
            <div className="pt-1">
              {modelOptions.map(model => {
                const active = currentModel === model.id
                return (
                  <button
                    key={model.id}
                    onClick={() => handleModelSwitch(model.id, currentReasoningEffort as ReasoningEffort | undefined)}
                    className={`w-full px-2 py-1.5 flex items-center gap-2 text-left text-xs transition-colors
                      ${active
                        ? 'bg-accent-blue/12 text-accent-blue border border-accent-blue/25'
                        : 'text-text-secondary border border-transparent hover:bg-bg-hover'}`}
                  >
                    <span className="w-3.5 flex justify-center">
                      {active && <Check size={12} />}
                    </span>
                    <span className={`flex-1 truncate ${active ? 'font-medium' : ''}`}>{model.name || model.id}</span>
                  </button>
                )
              })}
              {(() => {
                const active = currentModel === 'gpt-5.4' && currentReasoningEffort === 'low'
                return (
              <button
                onClick={() => handleModelSwitch('gpt-5.4', 'low')}
                className={`w-full px-2 py-1.5 flex items-center gap-2 text-left text-xs transition-colors
                  ${active
                    ? 'bg-accent-blue/12 text-accent-blue border border-accent-blue/25'
                    : 'text-text-secondary border border-transparent hover:bg-bg-hover'}`}
              >
                <span className="w-3.5 flex justify-center">
                  {active && <Check size={12} />}
                </span>
                <span className={`flex-1 truncate ${active ? 'font-medium' : ''}`}>{'\u901f\u5ea6'}</span>
              </button>
                )
              })()}
            </div>
          </div>
        )}
      </div>
      <div className="order-3 basis-full border-t border-border/30 pt-2" />
      <span className="order-4 mr-1 flex-shrink-0 text-[11px] font-medium text-text-muted">
        快捷动作
      </span>

      {/* ---- Code Graph 问答 ---- */}
      <div className="relative order-4 flex-shrink-0">
        <button
          ref={codeGraphBtnRef}
          onClick={() => setCodeGraphPopoverOpen(o => !o)}
          disabled={!workingDirectory}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
            bg-accent-purple/10 border border-accent-purple/20 text-accent-purple
            hover:text-accent-purple hover:bg-accent-purple/15
            transition-colors cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-45
            ${codeGraphPopoverOpen ? 'border-accent-purple/50 text-accent-purple' : ''}`}
          title={workingDirectory ? '基于 Code Graph 询问当前项目' : '当前会话没有工作目录'}
        >
          <GitBranch size={12} />
          <span>代码库问答</span>
        </button>

        {codeGraphPopoverOpen && (
          <div
            ref={codeGraphPopoverRef}
            className="absolute bottom-full left-0 mb-1.5 w-96 max-w-[calc(100vw-32px)] rounded-lg border border-border bg-bg-secondary py-2 shadow-lg z-50"
          >
            <div className="border-b border-border px-3 pb-2">
              <div className="text-xs font-medium text-text-secondary">问当前代码库</div>
              <div className="mt-0.5 truncate text-[10px] text-text-muted" title={workingDirectory || ''}>
                {workingDirectory || '未绑定工作目录'}
              </div>
            </div>
            <div className="space-y-2 px-3 pt-2">
              <textarea
                value={codeGraphQuestion}
                onChange={event => {
                  setCodeGraphQuestion(event.target.value)
                  setCodeGraphError(null)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleCodeGraphAsk()
                  }
                }}
                placeholder="例如：改 src/main/agent/AgentBridge.ts 会影响哪里？"
                className="h-20 w-full resize-none rounded-md border border-border bg-bg-primary px-2.5 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCodeGraphAsk}
                  disabled={!codeGraphQuestion.trim() || !workingDirectory || codeGraphLoading}
                  className="inline-flex items-center gap-1 rounded-md bg-accent-purple/80 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-purple disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Send size={12} />
                  {codeGraphLoading ? '分析中...' : '分析并插入'}
                </button>
                {codeGraphAnswer?.suggestedPrompt && (
                  <span className="text-[11px] text-accent-green">已插入到输入框</span>
                )}
              </div>
              {codeGraphError && (
                <div className="rounded-md border border-accent-red/30 bg-accent-red/10 px-2 py-1.5 text-[11px] text-accent-red">
                  {codeGraphError}
                </div>
              )}
              {codeGraphAnswer?.summary && (
                <div className="rounded-md border border-border/50 bg-bg-primary/40 px-2.5 py-2">
                  <div className="text-[11px] font-medium text-text-secondary">图谱结论</div>
                  <div className="mt-1 text-[11px] leading-5 text-text-muted">{codeGraphAnswer.summary}</div>
                  {codeGraphAnswer.sections?.[0]?.items?.length ? (
                    <div className="mt-1.5 text-[10px] text-text-muted">
                      {codeGraphAnswer.sections[0].title}：{codeGraphAnswer.sections[0].items.slice(0, 2).join('；')}
                    </div>
                  ) : null}
                </div>
              )}
              {!!codeGraphAnswer?.references?.length && (
                <div className="rounded-md border border-border/50 bg-bg-primary/35 px-2.5 py-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-text-secondary">可操作引用</span>
                    <span className="text-[10px] text-text-muted">{codeGraphAnswer.references.length} 个</span>
                  </div>
                  <div className="max-h-36 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                    {codeGraphAnswer.references.slice(0, 10).map((reference, index) => (
                      <div
                        key={`${reference.type}-${reference.filePath}-${reference.symbolName || ''}-${index}`}
                        className="flex items-center gap-1.5 rounded border border-border/35 bg-bg-secondary/40 px-2 py-1.5"
                        title={`${reference.reason}: ${reference.label}`}
                      >
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                          reference.type === 'symbol'
                            ? 'bg-accent-purple/10 text-accent-purple'
                            : 'bg-accent-blue/10 text-accent-blue'
                        }`}>
                          {reference.type === 'symbol' ? '符号' : '文件'}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary">
                          {reference.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenGraphReference(reference)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-bg-hover hover:text-accent-blue transition-colors"
                          title="打开文件"
                        >
                          打开
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInsertGraphReference(reference)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-bg-hover hover:text-accent-green transition-colors"
                          title="插入到输入框"
                        >
                          引用
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---- Skill 按钮 ---- */}
      {skillList.length > 0 && (
        <div className="relative order-4 flex-shrink-0">
          <button
            ref={skillBtnRef}
            onClick={() => setSkillPopoverOpen(o => !o)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
              bg-accent-blue/10 border border-accent-blue/20 text-accent-blue
              hover:text-accent-blue hover:bg-accent-blue/15
              transition-colors cursor-pointer select-none
              ${skillPopoverOpen ? 'border-accent-blue/50 text-accent-blue' : ''}`}
          >
            <Zap size={12} />
            <span>{skillList.length} 个 Skill</span>
          </button>

          {/* Skill Popover */}
          {skillPopoverOpen && (
            <div
              ref={skillPopoverRef}
              className="absolute bottom-full left-0 mb-1.5
                w-80 bg-bg-secondary border border-border rounded-lg shadow-lg
                py-1.5 z-50"
            >
              {/* 标题行 */}
              <div className="px-3 pb-1.5 flex items-center justify-between border-b border-border">
                <span className="text-[11px] text-text-muted font-medium uppercase tracking-wide">
                  可用 Skill
                </span>
                <span className="text-[10px] text-text-muted">
                  PrismOps 优先
                </span>
              </div>

              {/* 搜索框 */}
              <div className="px-2 pt-1.5 pb-1">
                <input
                  ref={skillFilterRef}
                  type="text"
                  value={skillFilter}
                  onChange={e => setSkillFilter(e.target.value)}
                  placeholder="搜索 Skill..."
                  className="w-full px-2.5 py-1 text-xs rounded-md
                    bg-bg-primary border border-border
                    text-text-primary placeholder:text-text-muted
                    focus:outline-none focus:border-accent-blue/50
                    transition-colors"
                  // 阻止 Enter/Esc 冒泡到 Popover 关闭逻辑
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      if (skillFilter) {
                        e.stopPropagation()
                        setSkillFilter('')
                      }
                      // 若搜索框已空，让 Esc 正常冒泡关闭 Popover
                    }
                  }}
                />
              </div>

              {/* Skill 列表（带分组 header） */}
              <div className="max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {filteredSkillList.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-text-muted text-center">
                    未找到「{skillFilter}」相关 Skill
                  </div>
                ) : (() => {
                  // 按 source 分组渲染，保持已排好序的顺序，遇到新 source 插入分组 header
                  const elements: React.ReactNode[] = []
                  let lastSource: SkillItem['source'] | null = null
                  const GROUP_LABEL: Record<SkillItem['source'], string> = {
                    custom:  'PrismOps 技能',
                    builtin: '内置技能',
                    native:  'CLI 原生命令',
                  }
                  for (let i = 0; i < filteredSkillList.length; i++) {
                    const skill = filteredSkillList[i]
                    if (skill.source !== lastSource) {
                      // 分组 header（除第一组外加上间距）
                      elements.push(
                        <div
                          key={`group-${skill.source}`}
                          className={`px-3 py-1 flex items-center gap-1.5
                            ${lastSource !== null ? 'mt-0.5 border-t border-border/40' : ''}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SOURCE_DOT[skill.source]}`} />
                          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide">
                            {GROUP_LABEL[skill.source]}
                          </span>
                        </div>
                      )
                      lastSource = skill.source
                    }
                    elements.push(
                      <button
                        key={`skill-${i}-${skill.source}-${skill.slashCommand}`}
                        onClick={() => handleSkillSelect(skill)}
                        className="w-full px-3 py-1.5 flex items-start gap-2 text-left
                          hover:bg-bg-hover transition-colors"
                      >
                        {/* 两行布局：命令名 + 描述 */}
                        <span className="flex flex-col gap-0.5 min-w-0 pl-3">
                          <span className="font-mono text-xs text-accent-blue leading-none">
                            /{skill.slashCommand}
                          </span>
                          {skill.description && (
                            <span className="text-[11px] text-text-muted leading-snug break-words whitespace-normal">
                              {skill.description}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  }
                  return elements
                })()}
              </div>

              {/* 底部统计 */}
              <div className="px-3 pt-1 mt-0.5 border-t border-border/60">
                <span className="text-[10px] text-text-muted">
                  {skillFilter
                    ? `${filteredSkillList.length} / ${skillList.length} 个结果`
                    : `共 ${skillList.length} 个 Skill`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- MCP 状态按钮 ---- */}
      {mcpList.length > 0 && (
        <div className="relative order-2 ml-auto flex-shrink-0">
          <button
            ref={mcpBtnRef}
            onClick={() => setMcpPopoverOpen(o => !o)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
              bg-bg-primary/25 border border-transparent text-text-muted
              hover:text-text-secondary hover:bg-bg-hover
              transition-colors cursor-pointer select-none
              ${mcpPopoverOpen ? 'border-accent-blue/40 text-text-secondary' : 'border-border'}`}
          >
            <Plug size={12} />
            <span>能力 {mcpList.length}</span>
          </button>

          {/* 只读 Popover */}
          {mcpPopoverOpen && (
            <div
              ref={mcpPopoverRef}
              className="absolute bottom-full left-0 mb-1.5
                w-64 bg-bg-secondary border border-border rounded-lg shadow-lg
                py-1.5 z-50"
            >
              <div className="px-3 pb-1.5 text-[11px] text-text-muted font-medium uppercase tracking-wide border-b border-border mb-1">
                当前会话已启用 MCP
              </div>
              <div className="max-h-72 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                {mcpList.map((mcp, mcpIdx) => {
                  const isExpanded = expandedMcps.has(mcp.key)
                  const hasTools = mcp.tools && mcp.tools.length > 0
                  return (
                    <div key={`mcp-${mcpIdx}-${mcp.key}`}>
                      {/* MCP 服务器行 */}
                      <div
                        className={`px-3 py-1.5 flex items-center gap-2 ${hasTools ? 'cursor-pointer hover:bg-bg-hover' : ''} transition-colors`}
                        onClick={() => hasTools && toggleMcpExpand(mcp.key)}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-green flex-shrink-0" />
                        <span className="flex-1 text-xs text-text-secondary truncate">{mcp.name}</span>
                        {mcp.category && (
                          <span className="text-[10px] text-text-muted flex-shrink-0 bg-bg-primary px-1 py-0.5 rounded">
                            {mcp.category}
                          </span>
                        )}
                        {hasTools && (
                          <span className="text-[10px] text-text-muted flex-shrink-0 ml-0.5">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                      {/* 工具列表（展开时显示） */}
                      {isExpanded && hasTools && (
                        <div className="pb-1 bg-bg-primary/40">
                          <div className="px-4 py-0.5 text-[10px] text-text-muted">
                            {mcp.tools.length} 个工具
                          </div>
                          {mcp.tools.map((tool: string, toolIdx: number) => (
                            <div key={`tool-${mcpIdx}-${toolIdx}`} className="px-5 py-0.5 flex items-center gap-1.5">
                              <span className="text-text-muted text-[10px]">›</span>
                              <span className="text-[11px] text-text-secondary font-mono truncate">{tool}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="px-3 pt-1.5 mt-0.5 border-t border-border">
                <p className="text-[10px] text-text-muted">在设置中管理 MCP 服务器</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- 工具箱功能按钮 ---- */}
      <div className="relative order-4 flex-shrink-0">
        <button
          ref={toolboxBtnRef}
          onClick={() => setToolboxPopoverOpen(o => !o)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs
            bg-bg-primary/35 border border-border/25 text-text-muted
            hover:text-text-secondary hover:bg-bg-hover
            transition-colors cursor-pointer select-none
            ${toolboxPopoverOpen ? 'border-accent-blue/40 text-text-secondary' : 'border-border'}`}
        >
          <Zap size={12} />
          <span>工具箱</span>
        </button>

        {/* 工具箱功能 Popover */}
        {toolboxPopoverOpen && (
          <div
            ref={toolboxPopoverRef}
            className="absolute bottom-full left-0 mb-1.5
              w-80 bg-bg-secondary border border-border rounded-lg shadow-lg
              py-1.5 z-50"
          >
            <div className="px-3 pb-1.5 text-[11px] text-text-muted font-medium uppercase tracking-wide border-b border-border mb-1">
              工具箱功能
            </div>
            <div className="max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {toolboxFeatures.map((feature, idx) => {
                const Icon = feature.icon
                return (
                  <button
                    key={`toolbox-${idx}-${feature.id}`}
                    onClick={() => handleToolboxFeatureClick(feature.id)}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-left
                      hover:bg-bg-hover transition-colors"
                  >
                    <Icon className={`w-4 h-4 ${feature.color} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-text-secondary font-medium">
                        {feature.name}
                      </div>
                      <div className="text-[11px] text-text-muted leading-snug">
                        {feature.description}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="px-3 pt-1.5 mt-0.5 border-t border-border">
              <p className="text-[10px] text-text-muted">更多功能在工具箱面板中</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

SessionToolbar.displayName = 'SessionToolbar'
export default SessionToolbar
