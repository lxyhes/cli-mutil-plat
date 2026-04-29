/**
 * 对话视图组件
 *
 * SDK V2 架构的主要交互视图，替代 xterm.js 终端渲染。
 * 显示结构化对话消息流：用户消息、AI 回复、工具调用卡片、权限请求等。
 *
 * @author weibin
 */

import React, { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FolderOpen, Plus, RotateCcw, Settings2, Trash2, Copy, ArrowUp, ArrowDown, Download, X, BookMarked, Target, GitPullRequest, Wrench, ShieldCheck, FileText, Activity, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ActivityEvent, ConversationMessage, UserQuestionMeta, AskUserQuestionMeta } from '../../../shared/types'
import ContextMenu from '../common/ContextMenu'
import type { MenuItem } from '../common/ContextMenu'
import { useConversation } from '../../hooks/useConversation'
import type { QueuedMessage } from '../../hooks/useConversation'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTaskStore } from '../../stores/taskStore'
import { useFileManagerStore } from '../../stores/fileManagerStore'
import { useKnowledgeCenterStore } from '../../stores/knowledgeCenterStore'
import type { TaskCard } from '../../../shared/types'
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
import { isPrimaryModifierPressed } from '../../utils/shortcut'
import {
  DELIVERY_ACTION_EVENT,
  consumePendingDeliveryMetricAction,
  markDeliveryMetricActionSent,
  recordDeliveryMetricSnapshot,
  type PendingDeliveryMetricAction,
} from '../../utils/deliveryMetrics'
import {
  buildProjectMemorySuggestionKnowledgeParams,
  buildProjectMemorySuggestionPrompt,
  buildProjectMemorySuggestions,
  filterProjectMemoryForPlaybook,
  findStaleProjectMemoryCandidates,
  formatProjectMemorySuggestionsForMarkdown,
  recordProjectMemoryTelemetryEvent,
  type ProjectMemorySuggestion,
  type ProjectMemorySuggestionReview,
  type ProjectMemoryStaleCandidate,
} from '../../utils/projectMemorySuggestions'


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
  providerId?: string
  modelId?: string
  trustPolicyPresetId: TrustPolicyPresetId
  goal: string
  statusLabel: string
  statusTone: 'neutral' | 'active' | 'blocked' | 'done'
  missionHealthLabel: string
  missionHealthTone: 'good' | 'warn' | 'bad' | 'neutral'
  missionHealthScore: number
  deliveryReadiness: string
  primarySignal: string
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
  evidenceTimeline: EvidenceTimelineEntry[]
  projectMemorySuggestions: ProjectMemorySuggestion[]
  staleMemoryCandidates: ProjectMemoryStaleCandidate[]
  readinessGates: DeliveryReadinessGate[]
  deliveryMetrics: DeliveryMetric[]
  deliveryMetricScore: number
  deliveryPackGenerated: boolean
  validationStale: boolean
  verifiedHandoffMinutes?: number
  projectMemoryCount: number
  agents: OpsBriefAgent[]
  agentCount: number
  activeAgentCount: number
  blockedAgentCount: number
  agentConflictCount: number
  agentCoordinationRisks: string[]
  agentOwnershipLanes: AgentOwnershipLane[]
}

interface OpsBriefAgent {
  agentId: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  childSessionId?: string
  workDir?: string
  prompt?: string
  lastFiles: string[]
  lastCommand?: string
  risk?: string
  toolCount: number
  failedToolCount: number
  validationCount: number
}

type AgentMergeReadiness = 'ready' | 'watch' | 'needs-validation' | 'blocked'

interface AgentOwnershipLane {
  id: string
  owner: string
  status: OpsBriefAgent['status']
  workDir?: string
  ownedFiles: string[]
  lastCommand?: string
  validationLabel: string
  mergeReadiness: AgentMergeReadiness
  risk?: string
  /** IDs of other agents that have conflicting file or directory overlap */
  conflictingAgents?: string[]
  /** Human-readable conflict detail for merge-readiness decisions */
  conflictDetail?: string
}

interface DeliveryReadinessGate {
  id: string
  label: string
  detail: string
  status: 'passed' | 'warning' | 'blocked'
  prompt: string
}

interface DeliveryMetric {
  id: string
  label: string
  value: string
  detail: string
  status: 'passed' | 'warning' | 'blocked'
}

interface EvidenceTimelineEntry {
  id: string
  type: 'mission' | 'tool' | 'validation' | 'change' | 'risk' | 'handoff'
  label: string
  detail: string
  timestamp?: string
  tone: 'good' | 'warn' | 'bad' | 'neutral'
}

interface ShipCommandRunResult {
  id?: string
  label?: string
  command?: string
  status?: string
  exitCode?: number | null
  outputTail?: string
  errorMessage?: string
}

interface ShipRunResult {
  passed?: boolean
  summary?: string
  suggestedPrompt?: string
  plan?: {
    projectPath?: string
    changedFiles?: string[]
  }
  results?: ShipCommandRunResult[]
}

type ShipRepairTaskDraft = Partial<TaskCard> & { metadata?: Record<string, unknown> }

interface CommonPrompt {
  id: string
  label: string
  text: string
}

interface MissionTemplate {
  id: string
  label: string
  subtitle: string
  signal: string
  prompt: string
  tone: 'blue' | 'green' | 'yellow' | 'purple'
}

interface TeamPlaybookTemplate {
  id: string
  label: string
  description: string
  evidence: string[]
  validation: string[]
  finalOutput: string[]
}

type TrustSignalTone = 'good' | 'warn' | 'bad' | 'neutral'
type TrustPolicyPresetId = 'auto' | 'explore' | 'standard' | 'strict'

interface TrustPolicyPreset {
  id: TrustPolicyPresetId
  label: string
  detail: string
  tone: TrustSignalTone
}

interface MissionLaunchpadProps {
  providerId?: string
  sessionId: string
  workingDirectory?: string
  canSend: boolean
  onInsertPrompt: (text: string) => void
}

const COMMON_PROMPTS_STORAGE_KEY = 'prismops-common-prompts'
const TRUST_POLICY_STORAGE_KEY = 'prismops-trust-policy-presets'
const MEMORY_SUGGESTION_REVIEW_STORAGE_KEY = 'prismops-memory-suggestion-reviews'

const TRUST_POLICY_PRESETS: Record<Exclude<TrustPolicyPresetId, 'auto'>, TrustPolicyPreset> = {
  explore: {
    id: 'explore',
    label: '探索模式',
    detail: '以读取、分析和方案收敛为主',
    tone: 'neutral',
  },
  standard: {
    id: 'standard',
    label: '标准审批',
    detail: '代码改动需补齐验证证据',
    tone: 'warn',
  },
  strict: {
    id: 'strict',
    label: '保守审批',
    detail: '权限、失败项或等待项先人工确认',
    tone: 'warn',
  },
}

const TRUST_POLICY_OPTIONS: Array<{ id: TrustPolicyPresetId; label: string }> = [
  { id: 'auto', label: '自动策略' },
  { id: 'explore', label: '探索模式' },
  { id: 'standard', label: '标准审批' },
  { id: 'strict', label: '保守审批' },
]

const DEFAULT_COMMON_PROMPTS: CommonPrompt[] = [
  { id: 'review-project', label: '审视项目', text: '审视下我的项目，先给出结构、风险点和下一步优先级。' },
  { id: 'next-step', label: '继续下一步', text: '继续下一步，按最短路径推进，改完后帮我验证。' },
  { id: 'debug-issue', label: '排查问题', text: '帮我排查这个问题，先定位根因，再给出最小修复方案。' },
  { id: 'improve-ui', label: '优化 UI', text: '帮我优化这个页面的 UI/UX，不破坏现有功能，完成后说明改了什么。' },
  { id: 'update-todo', label: '更新 todo', text: '根据当前进度更新 todo.md，并继续完成最高优先级事项。' },
]

const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: 'project-audit',
    label: '项目体检',
    subtitle: '结构、风险、优先级',
    signal: '先建立全局判断',
    tone: 'blue',
    prompt: '像交付负责人一样审视这个项目：先梳理结构、核心链路、明显风险和下一步优先级，再给出最短推进路线。',
  },
  {
    id: 'debug-root-cause',
    label: '问题定位',
    subtitle: '根因、修复、验证',
    signal: '把问题收敛到证据',
    tone: 'yellow',
    prompt: '帮我定位当前问题。先复述现象和影响范围，再找根因，给出最小修复方案；涉及代码改动后请运行必要验证。',
  },
  {
    id: 'ui-polish',
    label: '体验打磨',
    subtitle: '界面、交互、可用性',
    signal: '让产品更像工作台',
    tone: 'purple',
    prompt: '帮我优化当前产品的 UI/UX。重点关注信息层级、操作效率、视觉噪音和主题适配；不要破坏已有功能，完成后说明变更和验证结果。',
  },
  {
    id: 'delivery-check',
    label: '交付检查',
    subtitle: '变更、风险、提交说明',
    signal: '确认能不能交付',
    tone: 'green',
    prompt: '为当前项目做一次交付前检查：总结改动范围、验证结果、剩余风险、建议提交说明，以及还需要补的下一步。',
  },
]

const MISSION_TONE_CLASS: Record<MissionTemplate['tone'], string> = {
  blue: 'bg-accent-blue/5 text-accent-blue hover:bg-accent-blue/10',
  green: 'bg-accent-green/5 text-accent-green hover:bg-accent-green/10',
  yellow: 'bg-accent-yellow/5 text-accent-yellow hover:bg-accent-yellow/10',
  purple: 'bg-accent-purple/5 text-accent-purple hover:bg-accent-purple/10',
}

const MISSION_STEP_TONE_CLASS = [
  'text-accent-blue',
  'text-accent-purple',
  'text-accent-cyan',
  'text-accent-green',
]

const MISSION_DELIVERY_STEPS = [
  { label: '定目标', detail: '范围与验收' },
  { label: '推进', detail: '读码与修改' },
  { label: '验证', detail: '命令与证据' },
  { label: '交付', detail: '摘要与风险' },
]

const TEAM_PLAYBOOK_TEMPLATES: TeamPlaybookTemplate[] = [
  {
    id: 'bug-fix',
    label: 'Bug 修复',
    description: '复现、根因、最小修复、回归验证',
    evidence: ['复现路径或失败现象', '根因定位依据', '受影响范围'],
    validation: ['优先重跑失败命令或相关测试', '补充边界用例或手工检查', '确认没有绕过原失败点'],
    finalOutput: ['根因', '修复范围', '验证结果', '剩余风险'],
  },
  {
    id: 'feature-delivery',
    label: '功能交付',
    description: '需求边界、实现切片、验收证据',
    evidence: ['需求目标与非目标', '关键文件与数据流', '用户可见行为'],
    validation: ['类型检查或构建', '关键路径测试', '必要的 UI/交互检查'],
    finalOutput: ['实现摘要', '验收结果', '配置/迁移影响', '下一步'],
  },
  {
    id: 'ui-polish',
    label: 'UI 打磨',
    description: '层级、效率、噪音、主题适配',
    evidence: ['当前体验问题', '改动前后的信息层级', '响应式与主题影响'],
    validation: ['构建或类型检查', '关键视口检查', '确认不破坏既有交互'],
    finalOutput: ['体验改动', '视觉/交互取舍', '验证结果', '残余问题'],
  },
  {
    id: 'code-review',
    label: '代码审查',
    description: '风险优先、行为回归、测试缺口',
    evidence: ['改动范围', '关键调用链', '潜在回归点'],
    validation: ['指出必要测试', '核对错误处理和边界', '确认兼容性影响'],
    finalOutput: ['按严重程度排序的问题', '开放问题', '测试缺口'],
  },
  {
    id: 'migration',
    label: '迁移改造',
    description: '兼容策略、分步切换、回滚路径',
    evidence: ['旧路径与新路径差异', '数据/配置/接口影响', '依赖清单'],
    validation: ['迁移前后等价性检查', '构建/测试', '回滚或降级方案检查'],
    finalOutput: ['迁移步骤', '兼容与回滚', '验证结果', '上线注意事项'],
  },
  {
    id: 'release-check',
    label: '发布检查',
    description: '变更、验证、风险、交付说明',
    evidence: ['变更文件和用户影响', '验证命令', '已知风险'],
    validation: ['QA/SHIP 或等价检查', '构建', '关键路径冒烟'],
    finalOutput: ['发布摘要', '验证矩阵', '风险与缓解', '发布/回滚建议'],
  },
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

function normalizeTrustPolicyPresetId(value: unknown): TrustPolicyPresetId {
  return value === 'explore' || value === 'standard' || value === 'strict' ? value : 'auto'
}

function loadTrustPolicyOverrides(): Record<string, TrustPolicyPresetId> {
  try {
    const raw = localStorage.getItem(TRUST_POLICY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.entries(parsed).reduce<Record<string, TrustPolicyPresetId>>((acc, [key, value]) => {
      const normalized = normalizeTrustPolicyPresetId(value)
      if (key && normalized !== 'auto') acc[key] = normalized
      return acc
    }, {})
  } catch {
    return {}
  }
}

function saveTrustPolicyOverrides(overrides: Record<string, TrustPolicyPresetId>): void {
  try {
    localStorage.setItem(TRUST_POLICY_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // ignore
  }
}

function getMemorySuggestionReviewStorageKey(sessionId: string): string {
  return `${MEMORY_SUGGESTION_REVIEW_STORAGE_KEY}:${sessionId}`
}

function normalizeMemorySuggestionReviews(value: unknown): ProjectMemorySuggestionReviewMap {
  if (!value || typeof value !== 'object') return {}
  return Object.entries(value as Record<string, Partial<ProjectMemorySuggestionReview>>).reduce<ProjectMemorySuggestionReviewMap>((acc, [key, item]) => {
    if (!item || typeof item !== 'object') return acc
    const status = item.status
    if (status !== 'accepted' && status !== 'rejected' && status !== 'edited') return acc
    const suggestionId = String(item.suggestionId || key)
    if (!suggestionId) return acc
    acc[suggestionId] = {
      suggestionId,
      status,
      reviewedAt: String(item.reviewedAt || new Date().toISOString()),
      promotedKnowledgeId: item.promotedKnowledgeId ? String(item.promotedKnowledgeId) : undefined,
      title: item.title ? String(item.title) : undefined,
      content: item.content ? String(item.content) : undefined,
    }
    return acc
  }, {})
}

function loadMemorySuggestionReviews(sessionId: string): ProjectMemorySuggestionReviewMap {
  try {
    const raw = localStorage.getItem(getMemorySuggestionReviewStorageKey(sessionId))
    if (!raw) return {}
    return normalizeMemorySuggestionReviews(JSON.parse(raw))
  } catch {
    return {}
  }
}

function saveMemorySuggestionReviews(sessionId: string, reviews: ProjectMemorySuggestionReviewMap): void {
  try {
    localStorage.setItem(getMemorySuggestionReviewStorageKey(sessionId), JSON.stringify(reviews))
  } catch {
    // ignore
  }
}

function getTrustPolicyScopeKey(projectPath: string | undefined, sessionId: string): string {
  return projectPath || `session:${sessionId}`
}

function getTrustPolicyOptionLabel(presetId: TrustPolicyPresetId): string {
  return TRUST_POLICY_OPTIONS.find(option => option.id === presetId)?.label || '自动策略'
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

function truncateLongText(value: string, max = 1800): string {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...已截断...`
}

function getToolCommand(message: ConversationMessage): string {
  const command = message.toolInput?.command
  if (typeof command === 'string') return command
  return ''
}

function summarizeOpsBriefAgent(
  agent: Pick<OpsBriefAgent, 'agentId' | 'name' | 'status' | 'childSessionId' | 'workDir' | 'prompt'>,
  messages: ConversationMessage[] = [],
  activities: ActivityEvent[] = [],
): OpsBriefAgent {
  const files: string[] = []
  const seenFiles = new Set<string>()
  const commands: string[] = []
  const validationCommands: string[] = []
  let toolCount = 0
  let failedToolCount = 0

  for (const message of messages) {
    if (message.fileChange?.filePath && !seenFiles.has(message.fileChange.filePath)) {
      seenFiles.add(message.fileChange.filePath)
      files.push(message.fileChange.filePath)
    }
    if (message.role === 'tool_use') {
      toolCount += 1
      const command = getToolCommand(message)
      if (command) {
        commands.push(command)
        if (isValidationCommand(command)) {
          validationCommands.push(command)
        }
      }
    } else if (message.role === 'tool_result' && message.isError) {
      failedToolCount += 1
    }
  }

  for (const activity of activities) {
    if (activity.type === 'command_execute' && activity.detail) {
      commands.push(activity.detail)
      if (isValidationCommand(activity.detail)) {
        validationCommands.push(activity.detail)
      }
    }
  }

  const risk = agent.status === 'failed'
    ? 'Agent 执行失败'
    : agent.status === 'cancelled'
      ? 'Agent 已取消'
      : failedToolCount > 0
        ? `${failedToolCount} 个工具结果异常`
        : files.length > 0 && validationCommands.length === 0
          ? '有改动但缺少验证证据'
          : undefined

  return {
    ...agent,
    lastFiles: files.slice(-3).map(getShortFileName),
    lastCommand: compactText(commands[commands.length - 1] || '', 72),
    risk,
    toolCount,
    failedToolCount,
    validationCount: validationCommands.length,
  }
}

function isValidationCommand(command: string): boolean {
  return /\b(test|typecheck|build|lint|check|pytest|vitest|jest|tsc|cargo\s+check|go\s+test)\b/i.test(command)
}

function isDeliveryMetricActionPrompt(text: string, action: PendingDeliveryMetricAction): boolean {
  return text.includes('请根据 Dashboard 改进队列') && text.includes(action.reason)
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

function buildDeliveryPackPrompt(snapshot: OpsBriefSnapshot): string {
  const changedFiles = snapshot.lastFiles.length > 0
    ? snapshot.lastFiles.map(file => `- ${file}`).join('\n')
    : '- 暂未识别到文件改动'
  const risks = snapshot.risks.map(risk => `- ${risk}`).join('\n')
  const evidence = snapshot.evidence.map(item => `- ${item}`).join('\n')
  const nextActions = snapshot.nextActions.map(action => `- ${action}`).join('\n')
  const memorySuggestions = formatProjectMemorySuggestionsForMarkdown(snapshot.projectMemorySuggestions)

  const ownershipMatrix = formatAgentOwnershipMatrixMarkdown(snapshot)

  return [
    '请为当前 Mission 生成一份可交付工作包，并在必要时继续补齐缺口。',
    '',
    '## 当前状态',
    `- 项目：${snapshot.projectName}`,
    `- 阶段：${snapshot.phaseLabel}`,
    `- 交付状态：${snapshot.deliveryReadiness}`,
    `- 健康分：${snapshot.missionHealthScore}`,
    `- 改动规模：${snapshot.changedFileCount} 个文件，+${snapshot.additions} / -${snapshot.deletions}`,
    `- 工具调用：${snapshot.toolCount} 次，异常 ${snapshot.failedToolCount} 次`,
    `- 验证命令：${snapshot.validationCount} 条`,
    snapshot.lastCommand ? `- 最近命令：${snapshot.lastCommand}` : '',
    '',
    '## 目标',
    snapshot.goal,
    '',
    '## 最近改动文件',
    changedFiles,
    '',
    '## 风险雷达',
    risks,
    '',
    '## 证据链',
    evidence,
    '',
    '## 建议下一步',
    nextActions,
    '',
    '## Agent Ownership Matrix',
    ownershipMatrix,
    '',
    '## 建议沉淀的项目记忆',
    memorySuggestions,
    '',
    '## 输出要求',
    '- 先判断当前是否可以交付；如果不能，列出最小补齐动作并执行。',
    '- 如果涉及代码改动，运行必要的 typecheck/test/build 或说明为什么无法运行。',
    '- 最后输出：变更摘要、验证结果、剩余风险、建议提交说明、用户下一步。',
  ].filter(Boolean).join('\n')
}

function downloadMarkdownFile(markdown: string, fileName: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function buildGatePrompt(gate: DeliveryReadinessGate, snapshot: OpsBriefSnapshot): string {
  return [
    `请处理交付门禁：「${gate.label}」。`,
    '',
    `门禁状态：${gate.status === 'passed' ? '已通过' : gate.status === 'blocked' ? '阻塞' : '需补齐'}`,
    `门禁说明：${gate.detail}`,
    '',
    '## 当前 Mission',
    `- 项目：${snapshot.projectName}`,
    `- 目标：${snapshot.goal}`,
    `- 交付状态：${snapshot.deliveryReadiness}`,
    `- 最近命令：${snapshot.lastCommand || '暂无'}`,
    '',
    '## 处理要求',
    gate.prompt,
    '',
    '完成后请输出：处理动作、验证结果、剩余风险，以及是否可以进入下一交付门禁。',
  ].join('\n')
}

function extractWorkingContextPrompt(result: any): string {
  const prompt = result?.prompt || result?.data?.prompt || result?.context?.prompt
  return typeof prompt === 'string' ? prompt.trim() : ''
}

function buildTeamPlaybookPrompt(template: TeamPlaybookTemplate, snapshot: OpsBriefSnapshot, memoryPrompt = ''): string {
  const changedFiles = snapshot.lastFiles.length > 0
    ? snapshot.lastFiles.map(file => `- ${file}`).join('\n')
    : '- 暂未识别到文件改动'
  const risks = snapshot.risks.map(risk => `- ${risk}`).join('\n')
  const evidence = snapshot.evidence.map(item => `- ${item}`).join('\n')
  const memory = memoryPrompt.trim()

  return [
    `请按「${template.label}」团队模板推进当前 Mission。`,
    '',
    `模板目标：${template.description}`,
    '',
    '## 当前上下文',
    `- 项目：${snapshot.projectName}`,
    `- 目标：${snapshot.goal}`,
    `- 阶段：${snapshot.phaseLabel}`,
    `- 交付状态：${snapshot.deliveryReadiness}`,
    `- 健康分：${snapshot.missionHealthScore}`,
    snapshot.lastCommand ? `- 最近命令：${snapshot.lastCommand}` : '',
    '',
    '## 最近文件',
    changedFiles,
    '',
    '## 项目记忆与团队默认偏好',
    memory ? truncateLongText(memory, 1800) : '- 暂未读取到项目记忆；按当前上下文、团队模板和已有证据推进。',
    '',
    '## 已有风险与证据',
    risks,
    evidence,
    '',
    '## 必要证据',
    template.evidence.map(item => `- ${item}`).join('\n'),
    '',
    '## 验证要求',
    template.validation.map(item => `- ${item}`).join('\n'),
    '',
    '## 最终输出',
    template.finalOutput.map(item => `- ${item}`).join('\n'),
    '',
    '请先判断当前证据是否足够；如果不足，先补齐最小缺口。涉及代码改动时，完成后运行必要验证并说明结果。',
  ].filter(Boolean).join('\n')
}

function getTrustPolicyPreset(snapshot: OpsBriefSnapshot): TrustPolicyPreset {
  if (snapshot.trustPolicyPresetId !== 'auto') {
    return TRUST_POLICY_PRESETS[snapshot.trustPolicyPresetId]
  }

  if (snapshot.failedToolCount > 0 || snapshot.statusTone === 'blocked') {
    return {
      id: 'strict',
      label: '保守审批',
      detail: '权限、失败项或等待项先人工确认',
      tone: 'warn',
    }
  }
  if (snapshot.changedFileCount > 0 && snapshot.validationCount > 0) {
    return {
      id: 'standard',
      label: '交付准入',
      detail: '已有改动与验证，可进入审计摘要',
      tone: 'good',
    }
  }
  if (snapshot.changedFileCount > 0) {
    return {
      id: 'standard',
      label: '标准审批',
      detail: '代码改动需补齐验证证据',
      tone: 'warn',
    }
  }
  return {
    id: 'explore',
    label: '探索模式',
    detail: '以读取、分析和方案收敛为主',
    tone: 'neutral',
  }
}

function getTrustSignalClass(tone: TrustSignalTone): string {
  return {
    good: 'border-transparent bg-accent-green/5 text-accent-green',
    warn: 'border-transparent bg-accent-yellow/10 text-accent-yellow',
    bad: 'border-transparent bg-accent-red/10 text-accent-red',
    neutral: 'border-transparent bg-bg-primary/55 text-text-secondary',
  }[tone]
}

function getDeliveryMetricClass(status: DeliveryMetric['status']): string {
  return {
    passed: 'border-transparent bg-accent-green/5 text-accent-green',
    warning: 'border-transparent bg-accent-yellow/10 text-accent-yellow',
    blocked: 'border-transparent bg-accent-red/10 text-accent-red',
  }[status]
}

function getDeliveryMetricLabel(status: DeliveryMetric['status']): string {
  return {
    passed: '通过',
    warning: '待补齐',
    blocked: '阻塞',
  }[status]
}

function getMemorySuggestionReviewLabel(review?: ProjectMemorySuggestionReview, editing = false): string {
  if (editing) return '编辑中'
  if (!review) return '待审核'
  return {
    accepted: '已沉淀',
    rejected: '已拒绝',
    edited: '已编辑沉淀',
  }[review.status]
}

function getMemorySuggestionReviewClass(review?: ProjectMemorySuggestionReview, editing = false): string {
  if (editing) return 'bg-accent-blue/10 text-accent-blue'
  if (!review) return 'bg-bg-tertiary text-text-muted'
  return {
    accepted: 'bg-accent-green/10 text-accent-green',
    rejected: 'bg-accent-red/10 text-accent-red',
    edited: 'bg-accent-purple/10 text-accent-purple',
  }[review.status]
}

function getEvidenceTimelineClass(tone: EvidenceTimelineEntry['tone']): string {
  return {
    good: 'border-transparent bg-accent-green/5 text-accent-green',
    warn: 'border-transparent bg-accent-yellow/10 text-accent-yellow',
    bad: 'border-transparent bg-accent-red/10 text-accent-red',
    neutral: 'border-transparent bg-bg-primary/55 text-text-secondary',
  }[tone]
}

function getEvidenceTimelineLabel(type: EvidenceTimelineEntry['type']): string {
  return {
    mission: '目标',
    tool: '工具',
    validation: '验证',
    change: '改动',
    risk: '风险',
    handoff: '交付',
  }[type]
}

function formatTimelineTimestamp(timestamp?: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatElapsedMinutes(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}

function markDeliveryPackGenerated(snapshot: OpsBriefSnapshot): OpsBriefSnapshot {
  const deliveryMetrics = snapshot.deliveryMetrics.map(metric =>
    metric.id === 'delivery-pack'
      ? {
        ...metric,
        value: '已导出',
        detail: '本会话已生成 Markdown 交付包',
        status: 'passed' as const,
      }
      : metric,
  )
  const deliveryMetricScore = Math.round((deliveryMetrics.filter(metric => metric.status === 'passed').length / deliveryMetrics.length) * 100)
  return { ...snapshot, deliveryMetrics, deliveryMetricScore }
}

function buildTrustAuditPrompt(snapshot: OpsBriefSnapshot): string {
  const policy = getTrustPolicyPreset(snapshot)
  const gates = snapshot.readinessGates
    .map(gate => `- ${gate.label}：${gate.status === 'passed' ? '通过' : gate.status === 'blocked' ? '阻塞' : '待补齐'}；${gate.detail}`)
    .join('\n')
  const metrics = snapshot.deliveryMetrics
    .map(metric => `- ${metric.label}：${getDeliveryMetricLabel(metric.status)}；${metric.value}；${metric.detail}`)
    .join('\n')
  const timeline = snapshot.evidenceTimeline
    .map(entry => `- ${entry.timestamp || '未知时间'}：${getEvidenceTimelineLabel(entry.type)}；${entry.label}；${entry.detail}`)
    .join('\n')
  const memorySuggestions = formatProjectMemorySuggestionsForMarkdown(snapshot.projectMemorySuggestions)
  const files = snapshot.lastFiles.length > 0
    ? snapshot.lastFiles.map(file => `- ${file}`).join('\n')
    : '- 暂未识别到文件改动'

  return [
    '请生成当前会话的组织可信交付摘要。',
    '',
    '## Mission',
    `- 项目：${snapshot.projectName}`,
    `- 目录：${snapshot.projectPath || '未绑定'}`,
    `- Provider：${snapshot.providerId || '未知'}`,
    `- 模型：${snapshot.modelId || '默认/未上报'}`,
    `- 目标：${snapshot.goal}`,
    `- 阶段：${snapshot.phaseLabel}`,
    `- 交付状态：${snapshot.deliveryReadiness}`,
    `- 健康分：${snapshot.missionHealthScore}`,
    '',
    '## 核心指标',
    `- 指标得分：${snapshot.deliveryMetricScore}`,
    metrics,
    '',
    '## 审计线索',
    `- 对话消息：${snapshot.messageCount} 条`,
    `- 工具调用：${snapshot.toolCount} 次，异常 ${snapshot.failedToolCount} 个`,
    `- 文件改动：${snapshot.changedFileCount} 个文件，+${snapshot.additions} / -${snapshot.deletions}`,
    `- 验证证据：${snapshot.validationCount} 条`,
    snapshot.lastCommand ? `- 最近命令：${snapshot.lastCommand}` : '',
    '',
    '## 权限与治理',
    `- 建议权限策略：${policy.label}（${policy.detail}）`,
    `- 策略预设：${getTrustPolicyOptionLabel(snapshot.trustPolicyPresetId)}`,
    `- Provider/模型治理：${snapshot.providerId || '未知'} / ${snapshot.modelId || '默认/未上报'}`,
    `- Agent 状态：${snapshot.activeAgentCount} 执行中 / ${snapshot.agentCount} 总数，${snapshot.agentConflictCount} 个协作风险信号`,
    '',
    '## 证据时间线',
    timeline || '- 暂无证据时间线',
    '',
    '## 项目知识与交付门禁',
    `- 项目知识：${snapshot.projectPath ? '已绑定项目目录，可沉淀共享记忆' : '未绑定项目目录，知识沉淀受限'}`,
    gates,
    '',
    '## 建议沉淀的项目记忆',
    memorySuggestions,
    '',
    '## 最近文件',
    files,
    '',
    '## 风险与证据',
    snapshot.risks.map(risk => `- 风险：${risk}`).join('\n'),
    snapshot.evidence.map(item => `- 证据：${item}`).join('\n'),
    '',
    '## 输出要求',
    '- 用团队可转发格式输出：交付结论、审计时间线、权限策略、知识库更新建议、验证证据、剩余风险。',
    '- 如果证据不足，列出最小补齐动作，并标明阻塞项。',
  ].filter(Boolean).join('\n')
}

function formatMarkdownList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : `- ${fallback}`
}

function buildStaleMemoryReviewPrompt(snapshot: OpsBriefSnapshot): string {
  const candidates = snapshot.staleMemoryCandidates.map(candidate => [
    `- 旧知识：${candidate.entryTitle}`,
    `  - 新证据：${candidate.suggestionTitle}`,
    `  - 原因：${candidate.reason}`,
    `  - 置信分：${candidate.score}`,
  ].join('\n')).join('\n')

  return [
    '请复核下面可能陈旧或冲突的项目记忆。',
    '',
    '## 复核原则',
    '- 只更新确实被当前会话证据推翻、替代或精炼的项目知识。',
    '- 保留仍然有效的长期约定，不要因为一次性状态覆盖稳定知识。',
    '- 如果需要更新，请给出新标题、内容、来源和是否继续自动注入。',
    '',
    '## 候选项',
    candidates || '- 暂无候选项',
  ].join('\n')
}

function getSafeReportFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'prismops'
}

function buildTrustReportMarkdown(snapshot: OpsBriefSnapshot): string {
  const policy = getTrustPolicyPreset(snapshot)
  const generatedAt = new Date().toISOString()
  const gates = snapshot.readinessGates.map(gate =>
    `- ${gate.label}: ${gate.status === 'passed' ? '通过' : gate.status === 'blocked' ? '阻塞' : '待补齐'} - ${gate.detail}`,
  )
  const metrics = snapshot.deliveryMetrics.map(metric =>
    `${metric.label}: ${getDeliveryMetricLabel(metric.status)} - ${metric.value} - ${metric.detail}`,
  )
  const timeline = snapshot.evidenceTimeline.map(entry => {
    const time = entry.timestamp ? `${entry.timestamp} - ` : ''
    return `${time}${getEvidenceTimelineLabel(entry.type)} - ${entry.label}: ${entry.detail}`
  })
  const memorySuggestions = formatProjectMemorySuggestionsForMarkdown(snapshot.projectMemorySuggestions)
  const agents = snapshot.agents.map(agent => [
    `- ${agent.name || agent.agentId}: ${getAgentStatusLabel(agent.status)}`,
    agent.workDir ? `  - 工作目录: ${agent.workDir}` : '',
    agent.lastFiles.length > 0 ? `  - 最近文件: ${agent.lastFiles.join(', ')}` : '',
    agent.lastCommand ? `  - 最近命令: ${agent.lastCommand}` : '',
    agent.risk ? `  - 风险: ${agent.risk}` : '',
  ].filter(Boolean).join('\n'))

  return [
    `# PrismOps 可信交付报告 - ${snapshot.projectName}`,
    '',
    `生成时间: ${generatedAt}`,
    `报告 Schema: prismops.trust-report.v1`,
    `生成来源: conversation-task-cockpit`,
    '',
    '## 交付结论',
    '',
    `- 当前阶段: ${snapshot.phaseLabel}`,
    `- 交付状态: ${snapshot.deliveryReadiness}`,
    `- Mission 健康分: ${snapshot.missionHealthScore} (${snapshot.missionHealthLabel})`,
    `- 核心指标得分: ${snapshot.deliveryMetricScore}`,
    `- 主信号: ${snapshot.primarySignal}`,
    '',
    '## Mission',
    '',
    `- 项目: ${snapshot.projectName}`,
    `- 目录: ${snapshot.projectPath || '未绑定'}`,
    `- 目标: ${snapshot.goal}`,
    `- Provider: ${snapshot.providerId || '未知'}`,
    `- 模型: ${snapshot.modelId || '默认/未上报'}`,
    '',
    '## 审计线索',
    '',
    `- 对话消息: ${snapshot.messageCount} 条`,
    `- 工具调用: ${snapshot.toolCount} 次`,
    `- 异常工具结果: ${snapshot.failedToolCount} 个`,
    `- 文件改动: ${snapshot.changedFileCount} 个文件`,
    `- Diff 规模: +${snapshot.additions} / -${snapshot.deletions}`,
    `- 验证证据: ${snapshot.validationCount} 条`,
    snapshot.lastCommand ? `- 最近命令: ${snapshot.lastCommand}` : '',
    '',
    '## 权限与治理',
    '',
    `- 建议权限策略: ${policy.label}`,
    `- 策略预设: ${getTrustPolicyOptionLabel(snapshot.trustPolicyPresetId)}`,
    `- 策略说明: ${policy.detail}`,
    `- Provider/模型治理: ${snapshot.providerId || '未知'} / ${snapshot.modelId || '默认/未上报'}`,
    `- 项目知识: ${snapshot.projectPath ? '已绑定项目目录，可沉淀共享记忆' : '未绑定项目目录，知识沉淀受限'}`,
    '',
    '## 核心指标',
    '',
    formatMarkdownList(metrics, '暂无核心指标'),
    '',
    '## 证据时间线',
    '',
    formatMarkdownList(timeline, '暂无证据时间线'),
    '',
    '## 交付门禁',
    '',
    formatMarkdownList(gates, '暂无门禁数据'),
    '',
    '## 项目记忆建议',
    '',
    memorySuggestions,
    '',
    '## 最近文件',
    '',
    formatMarkdownList(snapshot.lastFiles, '暂未识别到文件改动'),
    '',
    '## Agent 状态',
    '',
    `- Agent 总数: ${snapshot.agentCount}`,
    `- 执行中: ${snapshot.activeAgentCount}`,
    `- 阻塞/取消: ${snapshot.blockedAgentCount}`,
    `- 协作风险信号: ${snapshot.agentConflictCount}`,
    formatMarkdownList(agents, '当前会话没有可见子 Agent'),
    '',
    '## 风险',
    '',
    formatMarkdownList(snapshot.risks, '暂无明显阻塞'),
    '',
    '## 证据',
    '',
    formatMarkdownList(snapshot.evidence, '暂无证据'),
    '',
    '## 下一步',
    '',
    formatMarkdownList(snapshot.nextActions, '暂无下一步建议'),
  ].filter(Boolean).join('\n')
}

function buildDeliveryPackMarkdown(snapshot: OpsBriefSnapshot, summary?: any): string {
  const generatedAt = new Date().toISOString()
  const openGates = snapshot.readinessGates.filter(gate => gate.status !== 'passed')
  const gates = snapshot.readinessGates.map(gate =>
    `- ${gate.label}: ${gate.status === 'passed' ? '通过' : gate.status === 'blocked' ? '阻塞' : '待补齐'} - ${gate.detail}`,
  )
  const metrics = snapshot.deliveryMetrics.map(metric =>
    `${metric.label}: ${getDeliveryMetricLabel(metric.status)} - ${metric.value} - ${metric.detail}`,
  )
  const timeline = snapshot.evidenceTimeline.map(entry => {
    const time = entry.timestamp ? `${entry.timestamp} - ` : ''
    return `${time}${getEvidenceTimelineLabel(entry.type)} - ${entry.label}: ${entry.detail}`
  })
  const validationEvidence = snapshot.evidence.filter(item => item.includes('验证') || item.includes('命令') || item.includes('工具'))
  const memorySuggestions = formatProjectMemorySuggestionsForMarkdown(snapshot.projectMemorySuggestions)
  const ownershipMatrix = formatAgentOwnershipMatrixMarkdown(snapshot)
  const warnings = Array.isArray(summary?.warnings) ? summary.warnings : []

  return [
    `# PrismOps 交付包 - ${snapshot.projectName}`,
    '',
    `生成时间: ${generatedAt}`,
    `报告 Schema: prismops.delivery-pack.v1`,
    `生成来源: conversation-task-cockpit`,
    '',
    '## 交付结论',
    '',
    `- 状态: ${openGates.length === 0 ? '可交付' : `待补齐 ${openGates.length} 个门禁`}`,
    `- 阶段: ${snapshot.phaseLabel}`,
    `- 交付状态: ${snapshot.deliveryReadiness}`,
    `- 健康分: ${snapshot.missionHealthScore} (${snapshot.missionHealthLabel})`,
    `- 核心指标得分: ${snapshot.deliveryMetricScore}`,
    '',
    '## 变更摘要',
    '',
    summary?.summary ? `- ${summary.summary}` : '- 暂无自动摘要，请根据会话内容补充。',
    summary?.markdown ? `\n${summary.markdown}` : '',
    '',
    '## Mission',
    '',
    `- 项目: ${snapshot.projectName}`,
    `- 目录: ${snapshot.projectPath || '未绑定'}`,
    `- 目标: ${snapshot.goal}`,
    `- Provider: ${snapshot.providerId || '未知'}`,
    `- 模型: ${snapshot.modelId || '默认/未上报'}`,
    '',
    '## 改动范围',
    '',
    `- 文件数量: ${snapshot.changedFileCount}`,
    `- Diff 规模: +${snapshot.additions} / -${snapshot.deletions}`,
    formatMarkdownList(snapshot.lastFiles, '暂未识别到文件改动'),
    '',
    '## 验证证据',
    '',
    `- 验证命令数量: ${snapshot.validationCount}`,
    `- 最近命令: ${snapshot.lastCommand || '暂无'}`,
    formatMarkdownList(validationEvidence, '暂无验证证据'),
    '',
    '## 核心指标',
    '',
    formatMarkdownList(metrics, '暂无核心指标'),
    '',
    '## 证据时间线',
    '',
    formatMarkdownList(timeline, '暂无证据时间线'),
    '',
    '## 项目记忆建议',
    '',
    memorySuggestions,
    '',
    '## 交付门禁',
    '',
    formatMarkdownList(gates, '暂无门禁数据'),
    '',
    '## 风险与注意事项',
    '',
    formatMarkdownList([...snapshot.risks, ...warnings], '暂无明显风险'),
    '',
    '## 下一步',
    '',
    formatMarkdownList(snapshot.nextActions, '暂无下一步建议'),
    '',
    '## Agent Ownership Matrix',
    '',
    ownershipMatrix,
    '',
    '## 建议提交说明',
    '',
    summary?.suggestedCommitMessage || 'chore: update delivery work',
  ].filter(Boolean).join('\n')
}

function getAgentStatusLabel(status: OpsBriefAgent['status']): string {
  return {
    pending: '待启动',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status]
}

function getAgentMergeReadinessLabel(status: AgentMergeReadiness): string {
  return {
    ready: '可合并',
    watch: '需观察',
    'needs-validation': '缺验证',
    blocked: '阻塞',
  }[status]
}

function getAgentMergeReadinessClass(status: AgentMergeReadiness): string {
  return {
    ready: 'bg-accent-green/10 text-accent-green',
    watch: 'bg-accent-blue/10 text-accent-blue',
    'needs-validation': 'bg-accent-yellow/10 text-accent-yellow',
    blocked: 'bg-accent-red/10 text-accent-red',
  }[status]
}

function formatAgentOwnershipMatrixMarkdown(snapshot: OpsBriefSnapshot): string {
  if (snapshot.agentOwnershipLanes.length === 0) {
    return '- 暂无可见子 Agent；如需并行，请先定义 owner、文件边界、验证责任和合并顺序。'
  }

  return snapshot.agentOwnershipLanes.map(lane => [
    `- ${lane.owner}: ${getAgentStatusLabel(lane.status)} / ${getAgentMergeReadinessLabel(lane.mergeReadiness)}`,
    lane.workDir ? `  - 工作目录: ${lane.workDir}` : '',
    lane.ownedFiles.length > 0 ? `  - 文件边界: ${lane.ownedFiles.join(', ')}` : '  - 文件边界: 暂未识别',
    lane.lastCommand ? `  - 最近命令: ${lane.lastCommand}` : '',
    `  - 验证责任: ${lane.validationLabel}`,
    lane.risk ? `  - 风险: ${lane.risk}` : '',
  ].filter(Boolean).join('\n')).join('\n')
}

function buildSupervisorDispatchPrompt(snapshot: OpsBriefSnapshot): string {
  const agents = snapshot.agents.length > 0
    ? snapshot.agents.map(agent => [
      `- ${agent.name || agent.agentId}（${getAgentStatusLabel(agent.status)}）`,
      agent.workDir ? `  - 工作目录：${agent.workDir}` : '',
      agent.childSessionId ? `  - 子会话：${agent.childSessionId}` : '',
      agent.prompt ? `  - 当前任务：${compactText(agent.prompt, 120)}` : '',
      agent.lastFiles.length > 0 ? `  - 最近文件：${agent.lastFiles.join('、')}` : '',
      agent.lastCommand ? `  - 最近命令：${agent.lastCommand}` : '',
      agent.validationCount > 0 ? `  - 验证证据：${agent.validationCount} 条` : '',
      agent.risk ? `  - 风险：${agent.risk}` : '',
    ].filter(Boolean).join('\n')).join('\n')
    : '- 当前还没有可见子 Agent，请先按工作流拆分职责，再决定是否需要创建 Agent。'
  const gates = snapshot.readinessGates
    .map(gate => `- ${gate.label}：${gate.status === 'passed' ? '通过' : gate.status === 'blocked' ? '阻塞' : '待补齐'}；${gate.detail}`)
    .join('\n')
  const files = snapshot.lastFiles.length > 0
    ? snapshot.lastFiles.map(file => `- ${file}`).join('\n')
    : '- 暂未识别到文件改动'
  const coordinationRisks = snapshot.agentCoordinationRisks.length > 0
    ? snapshot.agentCoordinationRisks.map(risk => `- ${risk}`).join('\n')
    : '- 暂未发现明显 Agent 协作冲突'

  const ownershipMatrix = formatAgentOwnershipMatrixMarkdown(snapshot)

  return [
    '请以 Supervisor 的方式梳理当前多 Agent 工作板，并给出下一轮可执行分派。',
    '',
    '## Mission',
    `- 项目：${snapshot.projectName}`,
    `- 目标：${snapshot.goal}`,
    `- 阶段：${snapshot.phaseLabel}`,
    `- 交付状态：${snapshot.deliveryReadiness}`,
    `- 健康分：${snapshot.missionHealthScore}`,
    '',
    '## 当前 Agent',
    agents,
    '',
    '## Ownership Matrix',
    ownershipMatrix,
    '',
    '## 协作风险',
    coordinationRisks,
    '',
    '## 交付门禁',
    gates,
    '',
    '## 最近改动',
    files,
    '',
    '## 风险与证据',
    snapshot.risks.map(risk => `- 风险：${risk}`).join('\n'),
    snapshot.evidence.map(item => `- 证据：${item}`).join('\n'),
    '',
    '## 分派要求',
    '- 把剩余工作拆成 1-4 个互不重叠的工作流，并说明每个工作流的 owner、文件边界、输入、输出和验收条件。',
    '- 如果已有 Agent 正在运行，优先识别冲突、重复所有权、阻塞点和需要等待的依赖。',
    '- 每个工作流都要包含最小验证方式；如果不需要代码改动，也要说明交付证据。',
    '- 最后输出：推荐分派、并行/串行顺序、风险处理、合并与交付检查清单。',
  ].filter(Boolean).join('\n')
}

type SupervisorPromptMode = 'rebalance' | 'unblock' | 'validate' | 'mergeReadiness' | 'merge'

function buildSupervisorActionPrompt(snapshot: OpsBriefSnapshot, mode: SupervisorPromptMode): string {
  const modeConfig = {
    rebalance: {
      title: '请重新平衡当前多 Agent 工作板。',
      focus: [
        '- 识别是否有 Agent 工作边界重叠、等待依赖、任务过大或职责不清。',
        '- 给出新的 owner 分配、文件边界和并行/串行顺序。',
        '- 保留已经完成的工作，不要要求重做已有成果。',
      ],
    },
    unblock: {
      title: '请优先处理当前多 Agent 工作板里的阻塞。',
      focus: [
        '- 找出失败、取消、等待确认、验证缺口或交付门禁阻塞。',
        '- 给出最小解阻塞动作，明确谁处理、需要看哪些证据、完成后如何验证。',
        '- 如果阻塞不影响交付，请说明依据和保留风险。',
      ],
    },
    validate: {
      title: '请为当前多 Agent 工作生成验证计划。',
      focus: [
        '- 按工作流列出每个 Agent 产出的最小验证命令或人工检查证据。',
        '- 优先覆盖改动文件、失败门禁、最近命令和交付风险。',
        '- 输出可直接执行的验证顺序，并说明失败时的修复归属。',
      ],
    },
    mergeReadiness: {
      title: '请生成当前多 Agent 工作的合并就绪检查。',
      focus: [
        '- 按 Ownership Matrix 检查每个 owner 的文件边界、验证责任、阻塞项和最近命令。',
        '- 标出可合并、需观察、缺验证、阻塞四类状态，并给出最小补齐动作。',
        '- 输出推荐合并顺序；如存在共享目录、重叠文件或未验证改动，必须先说明处理方式。',
      ],
    },
    merge: {
      title: '请生成当前多 Agent 工作的合并与交付摘要。',
      focus: [
        '- 汇总每个 Agent 的职责、产出、风险、验证证据和剩余事项。',
        '- 检查是否存在重复所有权、未验证改动或阻塞门禁。',
        '- 输出合并顺序、最终交付说明和用户下一步。',
      ],
    },
  }[mode]

  return [
    buildSupervisorDispatchPrompt(snapshot),
    '',
    '## 本次动作',
    modeConfig.title,
    '',
    '## 重点要求',
    modeConfig.focus.join('\n'),
  ].join('\n')
}

function unwrapIpcData<T = any>(result: any): T | undefined {
  if (!result) return undefined
  if (result.success === false) return undefined
  return (result.data || result) as T
}

function truncateShipOutput(text: string | undefined, max = 1800): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}\n...已截断...` : text
}

function getFailedShipResults(run: ShipRunResult): ShipCommandRunResult[] {
  return (run.results || []).filter(result => result.status === 'failed' || result.status === 'timed-out')
}

function buildShipRepairTask(run: ShipRunResult, workingDirectory: string, sessionId: string): ShipRepairTaskDraft {
  const failedResults = getFailedShipResults(run)
  const failedNames = failedResults
    .map(result => result.label || result.id || result.command || '交付检查')
    .slice(0, 3)
    .join('、')

  const failureDetails = failedResults.map(result => [
    `### ${result.label || result.id || '交付检查命令'}`,
    `命令：${result.command || '未知命令'}`,
    result.exitCode !== undefined && result.exitCode !== null ? `退出码：${result.exitCode}` : '',
    result.errorMessage ? `错误：${result.errorMessage}` : '',
    result.outputTail ? '输出摘要：' : '',
    result.outputTail ? '```text' : '',
    truncateShipOutput(result.outputTail),
    result.outputTail ? '```' : '',
  ].filter(Boolean).join('\n')).join('\n\n')

  const projectPath = run.plan?.projectPath || workingDirectory
  const changedFiles = run.plan?.changedFiles?.length
    ? run.plan.changedFiles.map(file => `- ${file}`).join('\n')
    : '- 未识别到改动文件或无需列出'

  return {
    title: `修复 QA/SHIP 失败：${failedNames || '交付检查'}`,
    description: [
      'QA/SHIP 自动检查失败。请根据下面的失败命令和输出摘要定位根因，做最小修复后重跑失败命令。',
      '',
      `项目路径：${projectPath}`,
      `检查摘要：${run.summary || '暂无摘要'}`,
      '',
      '## 失败命令',
      failureDetails || '- 暂无失败详情',
      '',
      '## 改动文件',
      changedFiles,
      '',
      '## 验收条件',
      '- 定位并修复失败根因，不绕过失败检查。',
      '- 优先只重跑失败命令，确认通过。',
      '- 最后再次运行 QA/SHIP 交付检查。',
    ].join('\n'),
    status: 'todo',
    priority: 'high',
    tags: ['qa-ship', 'repair', 'auto-generated'],
    gitRepoPath: projectPath,
    metadata: {
      source: 'qa-ship',
      sessionId,
      projectPath,
      summary: run.summary,
      failedCommands: failedResults.map(result => ({
        id: result.id,
        label: result.label,
        command: result.command,
        status: result.status,
        exitCode: result.exitCode,
      })),
    },
  }
}

interface ConversationViewProps {
  sessionId: string
}

interface ProjectMemorySuggestionDraft {
  title: string
  content: string
}

type ProjectMemorySuggestionReviewMap = Record<string, ProjectMemorySuggestionReview>
type ProjectMemorySuggestionDraftMap = Record<string, ProjectMemorySuggestionDraft>
type StaleMemoryResolutionAction = 'refresh' | 'archive'

interface OpsBriefProps {
  snapshot: OpsBriefSnapshot
  onInsertPrompt: (text: string) => void
  onInsertPlaybook: (template: TeamPlaybookTemplate) => void
  onExportTrustReport: (snapshot: OpsBriefSnapshot) => void
  onExtractProjectKnowledge: (snapshot: OpsBriefSnapshot) => void
  onPromoteMemorySuggestion: (suggestion: ProjectMemorySuggestion, snapshot: OpsBriefSnapshot) => void
  onRejectMemorySuggestion: (suggestion: ProjectMemorySuggestion) => void
  onStartEditMemorySuggestion: (suggestion: ProjectMemorySuggestion) => void
  onCancelEditMemorySuggestion: () => void
  onChangeMemorySuggestionDraft: (suggestionId: string, draft: ProjectMemorySuggestionDraft) => void
  onResolveStaleMemoryCandidate: (candidate: ProjectMemoryStaleCandidate, action: StaleMemoryResolutionAction, snapshot: OpsBriefSnapshot) => void
  onResolveStaleMemoryCandidates: (candidates: ProjectMemoryStaleCandidate[], action: StaleMemoryResolutionAction, snapshot: OpsBriefSnapshot) => void
  onChangeTrustPolicyPreset: (presetId: TrustPolicyPresetId) => void
  onOpenKnowledge: () => void
  onRunShipPlan: () => void
  onGenerateShipSummary: () => void
  canOpenKnowledge: boolean
  shipActionLoading: 'run' | 'summary' | null
  playbookActionLoading: string | null
  trustKnowledgeLoading: boolean
  memorySuggestionReviews: ProjectMemorySuggestionReviewMap
  memorySuggestionDrafts: ProjectMemorySuggestionDraftMap
  memorySuggestionEditingId: string | null
  memorySuggestionSavingId: string | null
  staleMemorySavingId: string | null
  expanded: boolean
  onToggleExpanded: () => void
}

interface CompletionFileChange {
  filePath: string
  displayPath: string
  fileName: string
  changeType: 'edit' | 'create' | 'write' | 'delete'
  additions: number
  deletions: number
}

interface CompletionSummary {
  elapsedLabel: string
  headline: string
  files: CompletionFileChange[]
  totalAdditions: number
  totalDeletions: number
}

interface CompletionHandoffProps {
  summary: CompletionSummary
  sessionId: string
  sessionName: string
  workingDirectory?: string
  onInsertPrompt: (text: string) => void
}

const MissionLaunchpad = React.memo(function MissionLaunchpad({ providerId, sessionId, workingDirectory, canSend, onInsertPrompt }: MissionLaunchpadProps) {
  const projectName = getProjectName(workingDirectory)
  const providerColor = getProviderColor(providerId)

  return (
    <div className="mx-auto flex min-h-[420px] max-w-[920px] flex-col justify-center py-8 text-sm">
      <section className="pb-4 shadow-[0_1px_0_rgba(255,255,255,0.035)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-accent-blue/10 px-2 py-1 text-xs font-semibold text-accent-blue">
              <Target size={13} />
              Mission Launchpad
            </div>
            <h2 className="text-xl font-semibold leading-7 text-text-primary">
              把这次 AI 工作推进到可交付
            </h2>
            <p className="mt-1 max-w-[620px] text-xs leading-5 text-text-muted">
              目标、上下文、执行、验证、交付，保持同一条任务线。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span
              className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: providerColor }}
            >
              {providerId ?? '未知'}
            </span>
            <span className="rounded-md bg-bg-elevated/80 px-2 py-1 font-mono text-xs text-text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
              #{sessionId.slice(0, 8)}
            </span>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.35fr]">
        <section className="rounded-lg bg-bg-elevated/75 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <FolderOpen size={15} className="text-accent-blue" />
            当前上下文
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <div className="mb-1 text-text-muted">项目</div>
              <div className="truncate font-medium text-text-primary" title={projectName}>
                {projectName}
              </div>
            </div>
            <div>
              <div className="mb-1 text-text-muted">目录</div>
              <div className="line-clamp-2 break-all font-mono leading-5 text-text-secondary" title={workingDirectory || '未绑定项目目录'}>
                {workingDirectory || '未绑定项目目录'}
              </div>
            </div>
          </div>
          <div className="mt-4 pt-3 shadow-[0_-1px_0_rgba(255,255,255,0.035)]">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
              <BookMarked size={13} className="text-accent-purple" />
              项目记忆
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['决策', '证据', '风险', '交付结果'].map(item => (
                <span key={item} className="rounded-md bg-bg-primary px-2 py-1 text-[11px] font-medium text-text-muted">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2">
          {MISSION_TEMPLATES.map(template => (
            <button
              key={template.id}
              type="button"
              onClick={() => onInsertPrompt(template.prompt)}
              disabled={!canSend}
              className={`min-h-[116px] rounded-lg p-3 text-left shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${MISSION_TONE_CLASS[template.tone]}`}
              title={template.prompt}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-text-primary">{template.label}</div>
                  <div className="mt-1 text-xs text-text-muted">{template.subtitle}</div>
                </div>
                <span className="rounded-md bg-bg-primary/70 px-2 py-0.5 text-[11px] font-medium">
                  Mission
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs font-medium">
                <Activity size={13} />
                <span className="min-w-0 truncate">{template.signal}</span>
              </div>
            </button>
          ))}
        </section>
      </div>

      <section className="mt-5 grid gap-2 rounded-md bg-bg-elevated/40 px-2 py-3 sm:grid-cols-4">
        {MISSION_DELIVERY_STEPS.map((step, index) => (
          <div key={step.label} className="flex min-w-0 items-center gap-2">
            <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-elevated text-xs font-semibold ${MISSION_STEP_TONE_CLASS[index]}`}>
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-text-secondary">{step.label}</div>
              <div className="truncate text-[11px] text-text-muted">{step.detail}</div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
})

const OpsBrief = React.memo(function OpsBrief({
  snapshot,
  onInsertPrompt,
  onInsertPlaybook,
  onExportTrustReport,
  onExtractProjectKnowledge,
  onPromoteMemorySuggestion,
  onRejectMemorySuggestion,
  onStartEditMemorySuggestion,
  onCancelEditMemorySuggestion,
  onChangeMemorySuggestionDraft,
  onResolveStaleMemoryCandidate,
  onResolveStaleMemoryCandidates,
  onChangeTrustPolicyPreset,
  onOpenKnowledge,
  onRunShipPlan,
  onGenerateShipSummary,
  canOpenKnowledge,
  shipActionLoading,
  playbookActionLoading,
  trustKnowledgeLoading,
  memorySuggestionReviews,
  memorySuggestionDrafts,
  memorySuggestionEditingId,
  memorySuggestionSavingId,
  staleMemorySavingId,
  expanded,
  onToggleExpanded,
}: OpsBriefProps) {
  const statusClass = {
    neutral: 'bg-bg-tertiary text-text-secondary',
    active: 'bg-accent-blue/10 text-accent-blue',
    blocked: 'bg-accent-yellow/10 text-accent-yellow',
    done: 'bg-accent-green/10 text-accent-green',
  }[snapshot.statusTone]
  const healthClass = {
    good: 'border-accent-green/25 bg-accent-green/10 text-accent-green',
    warn: 'border-accent-yellow/25 bg-accent-yellow/10 text-accent-yellow',
    bad: 'border-accent-red/25 bg-accent-red/10 text-accent-red',
    neutral: 'border-border-subtle bg-bg-tertiary text-text-secondary',
  }[snapshot.missionHealthTone]
  const healthBarClass = {
    good: 'bg-accent-green',
    warn: 'bg-accent-yellow',
    bad: 'bg-accent-red',
    neutral: 'bg-accent-blue',
  }[snapshot.missionHealthTone]
  const accentRailClass = {
    good: 'bg-accent-green',
    warn: 'bg-accent-yellow',
    bad: 'bg-accent-red',
    neutral: 'bg-accent-blue',
  }[snapshot.missionHealthTone]
  const hasRisk = snapshot.risks.some(risk => !risk.includes('暂无明显'))
  const openGateCount = snapshot.readinessGates.filter(gate => gate.status !== 'passed').length
  const visibleEvidenceTimeline = snapshot.evidenceTimeline.slice(-6).reverse()
  const memoryReviewStats = snapshot.projectMemorySuggestions.reduce(
    (acc, suggestion) => {
      const status = memorySuggestionReviews[suggestion.id]?.status
      if (status === 'accepted') acc.accepted += 1
      if (status === 'rejected') acc.rejected += 1
      if (status === 'edited') acc.edited += 1
      return acc
    },
    { accepted: 0, rejected: 0, edited: 0 },
  )
  const HealthIcon = snapshot.missionHealthTone === 'bad'
    ? AlertTriangle
    : snapshot.missionHealthTone === 'good'
      ? ShieldCheck
      : Activity
  const deliverySteps = [
    { label: '理解', done: snapshot.messageCount > 0, active: snapshot.messageCount > 0 && snapshot.changedFileCount === 0 && snapshot.toolCount === 0 },
    { label: '执行', done: snapshot.toolCount > 0 || snapshot.changedFileCount > 0, active: snapshot.toolCount > 0 && snapshot.changedFileCount === 0 },
    { label: '改动', done: snapshot.changedFileCount > 0, active: snapshot.changedFileCount > 0 && snapshot.validationCount === 0 },
    { label: '验证', done: snapshot.validationCount > 0, active: snapshot.validationCount > 0 && snapshot.failedToolCount === 0 },
    { label: '交付', done: snapshot.validationCount > 0 && snapshot.changedFileCount > 0 && snapshot.failedToolCount === 0, active: false },
  ]
  const policyPreset = getTrustPolicyPreset(snapshot)
  const trustSignals = [
    {
      id: 'audit',
      label: '审计线索',
      value: `${snapshot.messageCount} 对话 / ${snapshot.toolCount} 工具`,
      detail: `${snapshot.changedFileCount} 文件，${snapshot.validationCount} 验证`,
      tone: snapshot.messageCount > 0 || snapshot.toolCount > 0 ? 'good' : 'neutral',
      icon: FileText,
    },
    {
      id: 'policy',
      label: '权限策略',
      value: policyPreset.label,
      detail: policyPreset.detail,
      tone: policyPreset.tone,
      icon: Settings2,
    },
    {
      id: 'knowledge',
      label: '项目知识',
      value: canOpenKnowledge ? '已绑定' : '未绑定',
      detail: canOpenKnowledge ? '可沉淀共享记忆' : '需要项目目录',
      tone: canOpenKnowledge ? 'good' : 'warn',
      icon: BookMarked,
    },
    {
      id: 'model',
      label: '模型治理',
      value: snapshot.providerId || '未知',
      detail: snapshot.modelId || '默认/未上报',
      tone: snapshot.providerId ? 'good' : 'warn',
      icon: Activity,
    },
    {
      id: 'report',
      label: '交付报告',
      value: snapshot.validationCount > 0 && snapshot.changedFileCount > 0 && snapshot.failedToolCount === 0 ? '可生成' : '待补齐',
      detail: snapshot.validationCount > 0 ? '已有验证证据' : '缺少验证证据',
      tone: snapshot.validationCount > 0 && snapshot.failedToolCount === 0 ? 'good' : snapshot.changedFileCount > 0 ? 'warn' : 'neutral',
      icon: ShieldCheck,
    },
  ] as Array<{
    id: string
    label: string
    value: string
    detail: string
    tone: TrustSignalTone
    icon: typeof FileText
  }>

  return (
    <section className="ops-brief mb-3 overflow-hidden rounded-lg bg-bg-elevated/72 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_12px_26px_rgba(0,0,0,0.16)]">
      <div className="flex min-w-0">
        <div className={`w-1.5 shrink-0 ${accentRailClass}`} />
        <div className={`min-w-0 flex-1 ${expanded ? 'px-3 py-2.5' : 'px-3 py-2'}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-blue/10 text-accent-blue">
                  <Target size={15} />
                </span>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-text-muted">任务驾驶舱</div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-text-primary" title={snapshot.projectName}>
                      {snapshot.projectName}
                    </span>
                    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${statusClass}`}>
                      {snapshot.statusLabel}
                    </span>
                    <span className="inline-flex items-center rounded-md bg-bg-tertiary px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                      {snapshot.phaseLabel}
                    </span>
                  </div>
                </div>
                {expanded && snapshot.projectPath && (
                  <span className="min-w-0 truncate font-mono text-[11px] text-text-muted" title={snapshot.projectPath}>
                    {snapshot.projectPath}
                  </span>
                )}
              </div>

              <div className={`font-medium text-text-primary ${expanded ? 'text-sm leading-6' : 'truncate text-xs leading-5'}`} title={snapshot.goal}>
                {snapshot.goal}
              </div>
              <div className={`mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${expanded ? 'text-text-secondary' : 'text-text-muted'}`}>
                <span className="min-w-0 truncate" title={snapshot.deliveryReadiness}>
                  交付状态：{snapshot.deliveryReadiness}
                </span>
                <span className="min-w-0 truncate" title={snapshot.primarySignal}>
                  主信号：{snapshot.primarySignal}
                </span>
              </div>
              {expanded && snapshot.liveProgressText && (
                <div className="mt-1 truncate text-xs text-text-muted" title={snapshot.liveProgressText}>
                  {snapshot.liveProgressText}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <div className={`flex h-8 min-w-[120px] items-center gap-2 rounded-md border px-2 ${healthClass}`}>
                <HealthIcon size={13} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
                    <span className="truncate">{snapshot.missionHealthLabel}</span>
                    <span className="font-mono">{snapshot.missionHealthScore}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-primary/70">
                    <div
                      className={`h-full rounded-full ${healthBarClass}`}
                      style={{ width: `${snapshot.missionHealthScore}%` }}
                    />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onInsertPrompt('继续推进当前 Mission。先总结当前状态，再执行下一步；如果涉及代码改动，完成后运行必要验证。')}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-accent-blue/10 px-2 text-xs font-medium text-accent-blue transition-colors hover:bg-accent-blue/15"
              >
                <Activity size={13} />
                推进
              </button>
              <button
                type="button"
                onClick={() => onInsertPrompt(buildDeliveryPackPrompt(snapshot))}
                className={`h-8 items-center gap-1 rounded-md bg-accent-green/10 px-2 text-xs font-medium text-accent-green transition-colors hover:bg-accent-green/15 ${expanded ? 'inline-flex' : 'hidden'}`}
              >
                <ShieldCheck size={13} />
                交付
              </button>
              <button
                type="button"
                onClick={() => onInsertPrompt(buildSupervisorDispatchPrompt(snapshot))}
                className={`h-8 items-center gap-1 rounded-md bg-accent-purple/10 px-2 text-xs font-medium text-accent-purple transition-colors hover:bg-accent-purple/15 ${expanded ? 'inline-flex' : 'hidden'}`}
              >
                <Users size={13} />
                分派
              </button>
              <button
                type="button"
                onClick={onOpenKnowledge}
                disabled={!canOpenKnowledge}
                className={`h-8 items-center gap-1 rounded-md bg-bg-tertiary px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45 ${expanded ? 'inline-flex' : 'hidden'}`}
              >
                <BookMarked size={13} />
                记忆
              </button>
              <button
                type="button"
                onClick={onToggleExpanded}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-bg-tertiary px-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover"
                title={expanded ? '收起任务驾驶舱' : '展开任务驾驶舱'}
              >
                <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                {expanded ? '收起' : '展开'}
              </button>
            </div>
          </div>

          {expanded && (
            <div className="mt-2 flex items-center gap-1.5">
              {deliverySteps.map((step, index) => {
                const active = step.active || (!step.done && deliverySteps.slice(0, index).every(s => s.done))
                return (
                  <div key={step.label} className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span
                      title={step.label}
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        step.done
                          ? 'bg-accent-green'
                          : active
                            ? 'bg-accent-blue'
                            : 'bg-border-subtle'
                      }`}
                    />
                    <span className={`hidden truncate text-[11px] sm:block ${step.done || active ? 'text-text-secondary' : 'text-text-muted'}`}>
                      {step.label}
                    </span>
                    {index < deliverySteps.length - 1 && (
                      <span
                        className={`h-px min-w-4 flex-1 ${
                          step.done
                            ? 'bg-accent-green/50'
                            : active
                              ? 'bg-accent-blue/45'
                              : 'bg-border-subtle'
                        }`}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!expanded && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[11px] text-text-muted shadow-[0_-1px_0_rgba(255,255,255,0.035)]">
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
              <span className={openGateCount > 0 ? 'text-accent-yellow' : 'text-accent-green'}>
                {openGateCount > 0 ? `${openGateCount} 个门禁待处理` : '交付门禁通过'}
              </span>
            </div>
          )}

          {expanded && (
            <div className="mt-3 max-h-[44vh] overflow-y-auto pr-1 [scrollbar-width:thin]">
              <div className="grid gap-x-4 gap-y-2 rounded-md bg-bg-primary/24 px-2 py-2 sm:grid-cols-2 lg:grid-cols-[auto_auto_auto_auto_1fr]">
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
                  <span className="min-w-0 truncate font-mono text-[11px] text-text-muted" title={snapshot.lastCommand}>
                    {snapshot.lastCommand}
                  </span>
                )}
              </div>

              <div className="mt-3 rounded-md bg-bg-primary/28 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookMarked size={14} className="text-accent-blue" />
                    <span className="text-xs font-semibold text-text-secondary">团队模板</span>
                    <span className="rounded-md bg-accent-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-blue">
                      {TEAM_PLAYBOOK_TEMPLATES.length} 个 playbook
                    </span>
                    <span className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                      带入项目记忆
                    </span>
                  </div>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {TEAM_PLAYBOOK_TEMPLATES.map(template => {
                    const isLoading = playbookActionLoading === template.id
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => onInsertPlaybook(template)}
                        disabled={playbookActionLoading !== null}
                        className="min-w-0 rounded-md bg-bg-primary/58 px-2 py-2 text-left transition-colors hover:bg-bg-hover disabled:cursor-wait disabled:opacity-60"
                        title={template.description}
                      >
                        <div className="truncate text-[11px] font-semibold text-text-primary">{isLoading ? '读取记忆中...' : template.label}</div>
                        <div className="mt-0.5 truncate text-[10px] text-text-muted">{template.description}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mt-3 rounded-md bg-bg-primary/28 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-accent-blue" />
                    <span className="text-xs font-semibold text-text-secondary">证据时间线</span>
                    <span className="rounded-md bg-bg-primary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                      {snapshot.evidenceTimeline.length} 条
                    </span>
                  </div>
                </div>
                {visibleEvidenceTimeline.length > 0 ? (
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {visibleEvidenceTimeline.map(item => {
                      const time = formatTimelineTimestamp(item.timestamp)
                      return (
                        <div key={item.id} className={`min-w-0 rounded-md border px-2 py-1.5 ${getEvidenceTimelineClass(item.tone)}`}>
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="shrink-0 rounded bg-bg-primary/70 px-1.5 py-0.5 text-[10px] font-medium">
                                {getEvidenceTimelineLabel(item.type)}
                              </span>
                              <span className="truncate text-[11px] font-semibold text-text-primary" title={item.label}>
                                {item.label}
                              </span>
                            </div>
                            {time && <span className="shrink-0 text-[10px] text-text-muted">{time}</span>}
                          </div>
                          <div className="mt-0.5 truncate text-[10px] leading-4 text-text-secondary" title={item.detail}>
                            {item.detail}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-md bg-bg-primary/45 px-3 py-2 text-[11px] leading-5 text-text-muted">
                    暂无可展示的证据事件。继续执行工具、验证或文件改动后会自动生成。
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-md bg-bg-primary/28 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users size={14} className={snapshot.agentConflictCount > 0 ? 'text-accent-yellow' : snapshot.activeAgentCount > 0 ? 'text-accent-purple' : 'text-text-muted'} />
                    <span className="text-xs font-semibold text-text-secondary">协作看板</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${snapshot.agentConflictCount > 0 ? 'bg-accent-yellow/10 text-accent-yellow' : snapshot.blockedAgentCount > 0 ? 'bg-accent-red/10 text-accent-red' : snapshot.activeAgentCount > 0 ? 'bg-accent-purple/10 text-accent-purple' : 'bg-bg-tertiary text-text-muted'}`}>
                      {snapshot.agentCount > 0 ? `${snapshot.activeAgentCount} 执行中 / ${snapshot.agentCount} 总数` : '未启用'}
                    </span>
                    {snapshot.agentConflictCount > 0 && (
                      <span className="rounded-md bg-accent-yellow/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-yellow">
                        {snapshot.agentConflictCount} 个冲突信号
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onInsertPrompt(buildSupervisorDispatchPrompt(snapshot))}
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/10"
                  >
                    生成分派
                  </button>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {([
                    ['rebalance', '再平衡'],
                    ['unblock', '解阻塞'],
                    ['validate', '验证'],
                    ['merge', '合并摘要'],
                  ] as Array<[SupervisorPromptMode, string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onInsertPrompt(buildSupervisorActionPrompt(snapshot, mode))}
                      className="rounded-md bg-bg-primary/70 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-purple"
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onInsertPrompt(buildSupervisorActionPrompt(snapshot, 'mergeReadiness'))}
                    className="rounded-md bg-bg-primary/70 px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-purple"
                  >
                    合并就绪
                  </button>
                </div>
                {snapshot.agentCoordinationRisks.length > 0 && (
                  <div className="mb-2 space-y-1 rounded-md bg-accent-yellow/5 px-3 py-2">
                    {snapshot.agentCoordinationRisks.slice(0, 3).map(risk => (
                      <div key={risk} className="flex min-w-0 items-start gap-2 text-[11px] leading-5 text-text-secondary">
                        <AlertTriangle size={12} className="mt-1 shrink-0 text-accent-yellow" />
                        <span className="min-w-0">{risk}</span>
                      </div>
                    ))}
                  </div>
                )}
                {snapshot.agentOwnershipLanes.length > 0 && (
                  <div className="mb-2 rounded-md border border-border-subtle/70 bg-bg-primary/45 p-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                      <span>Ownership Matrix</span>
                      <span>{snapshot.agentOwnershipLanes.length} owners</span>
                    </div>
                    <div className="grid gap-1.5 lg:grid-cols-2">
                      {snapshot.agentOwnershipLanes.slice(0, 4).map(lane => (
                        <div key={lane.id} className="min-w-0 rounded-md bg-bg-elevated/60 px-2 py-1.5">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span className="truncate text-[11px] font-semibold text-text-primary" title={lane.owner}>
                              {lane.owner}
                            </span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getAgentMergeReadinessClass(lane.mergeReadiness)}`}>
                              {getAgentMergeReadinessLabel(lane.mergeReadiness)}
                            </span>
                          </div>
                          <div className="mt-1 truncate font-mono text-[10px] text-text-muted" title={lane.workDir || lane.lastCommand || lane.id}>
                            {lane.workDir || lane.lastCommand || lane.id}
                          </div>
                          <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                            {lane.ownedFiles.length > 0 ? lane.ownedFiles.slice(0, 3).map(file => (
                              <span key={file} className="max-w-full truncate rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted" title={file}>
                                {file}
                              </span>
                            )) : (
                              <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted">未识别文件边界</span>
                            )}
                          </div>
                          <div className="mt-1 truncate text-[10px] text-text-secondary" title={lane.validationLabel}>
                            {lane.validationLabel}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {snapshot.agents.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {snapshot.agents.slice(0, 4).map(agent => (
                      <div key={agent.agentId} className="min-w-0 rounded-md bg-bg-primary/55 p-2">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-text-primary" title={agent.name || agent.agentId}>
                            {agent.name || agent.agentId}
                          </span>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            agent.status === 'running' || agent.status === 'pending'
                              ? 'bg-accent-purple/10 text-accent-purple'
                              : agent.status === 'completed'
                                ? 'bg-accent-green/10 text-accent-green'
                                : 'bg-accent-red/10 text-accent-red'
                          }`}>
                            {getAgentStatusLabel(agent.status)}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-[11px] text-text-muted" title={agent.workDir || agent.childSessionId || agent.agentId}>
                          {agent.workDir || agent.childSessionId || agent.agentId}
                        </div>
                        {(agent.lastFiles.length > 0 || agent.lastCommand || agent.risk) && (
                          <div className="mt-2 space-y-1 pt-2 shadow-[0_-1px_0_rgba(255,255,255,0.035)]">
                            {agent.lastFiles.length > 0 && (
                              <div className="flex min-w-0 flex-wrap gap-1">
                                {agent.lastFiles.map(file => (
                                  <span key={file} className="max-w-full truncate rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-text-muted" title={file}>
                                    {file}
                                  </span>
                                ))}
                              </div>
                            )}
                            {agent.lastCommand && (
                              <div className="truncate font-mono text-[10px] text-text-muted" title={agent.lastCommand}>
                                {agent.lastCommand}
                              </div>
                            )}
                            {agent.risk && (
                              <div className="flex min-w-0 items-start gap-1.5 text-[10px] leading-4 text-accent-yellow">
                                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                <span className="min-w-0">{agent.risk}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-bg-primary/45 px-3 py-2 text-[11px] leading-5 text-text-muted">
                    当前会话还没有可见子 Agent。可以先生成分派提示，把剩余工作拆成明确 owner、文件边界和验收条件，再决定是否并行执行。
                  </div>
                )}
              </div>

              <div className="mt-3 rounded-md bg-bg-primary/28 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className={openGateCount > 0 ? 'text-accent-yellow' : 'text-accent-green'} />
                    <span className="text-xs font-semibold text-text-secondary">交付门禁</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${openGateCount > 0 ? 'bg-accent-yellow/10 text-accent-yellow' : 'bg-accent-green/10 text-accent-green'}`}>
                      {openGateCount > 0 ? `${openGateCount} 项待处理` : '全部通过'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onGenerateShipSummary}
                    disabled={shipActionLoading !== null}
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-green transition-colors hover:bg-accent-green/10"
                  >
                    {shipActionLoading === 'summary' ? '生成中...' : '生成交付包'}
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {snapshot.readinessGates.map(gate => {
                    const gateClass = gate.status === 'passed'
                      ? 'border-transparent bg-accent-green/5 text-accent-green'
                      : gate.status === 'blocked'
                        ? 'border-transparent bg-accent-red/10 text-accent-red'
                        : 'border-transparent bg-accent-yellow/10 text-accent-yellow'
                    const GateIcon = gate.status === 'passed'
                      ? CheckCircle2
                      : gate.status === 'blocked'
                        ? AlertTriangle
                        : Activity
                    return (
                      <div key={gate.id} className={`min-w-0 rounded-md border p-2 ${gateClass}`}>
                        <div className="flex min-w-0 items-start gap-2">
                          <GateIcon size={13} className="mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <span className="truncate text-xs font-semibold text-text-primary">{gate.label}</span>
                              <span className="shrink-0 text-[10px] font-medium">
                                {gate.status === 'passed' ? '通过' : gate.status === 'blocked' ? '阻塞' : '待补齐'}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-text-secondary">
                              {gate.detail}
                            </div>
                            {gate.status !== 'passed' && (() => {
                              const isValidationGate = gate.id === 'validation'
                              const isHandoffGate = gate.id === 'handoff'
                              const action = isValidationGate ? onRunShipPlan : isHandoffGate ? onGenerateShipSummary : () => onInsertPrompt(buildGatePrompt(gate, snapshot))
                              const loading = (isValidationGate && shipActionLoading === 'run') || (isHandoffGate && shipActionLoading === 'summary')
                              const label = isValidationGate
                                ? (loading ? '检查中...' : '运行检查')
                                : isHandoffGate
                                  ? (loading ? '生成中...' : '生成说明')
                                  : '处理'
                              return (
                                <button
                                  type="button"
                                  onClick={action}
                                  disabled={shipActionLoading !== null}
                                  className="mt-2 rounded-md bg-bg-primary/70 px-2 py-0.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-blue disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {label}
                                </button>
                              )
                            })()}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="mt-3 rounded-md bg-bg-primary/28 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className={policyPreset.tone === 'good' ? 'text-accent-green' : policyPreset.tone === 'warn' ? 'text-accent-yellow' : 'text-text-muted'} />
                    <span className="text-xs font-semibold text-text-secondary">组织可信层</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getTrustSignalClass(policyPreset.tone)}`}>
                      {policyPreset.label}
                    </span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${snapshot.deliveryMetricScore >= 80 ? getTrustSignalClass('good') : snapshot.deliveryMetricScore >= 60 ? getTrustSignalClass('warn') : getTrustSignalClass('bad')}`}>
                      指标 {snapshot.deliveryMetricScore}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <select
                      value={snapshot.trustPolicyPresetId}
                      onChange={event => onChangeTrustPolicyPreset(normalizeTrustPolicyPresetId(event.target.value))}
                      className="h-7 rounded-md bg-bg-primary/65 px-2 text-[11px] font-medium text-text-secondary outline-none transition-colors hover:bg-bg-hover focus:ring-1 focus:ring-accent-blue/45"
                      title="权限策略预设"
                    >
                      {TRUST_POLICY_OPTIONS.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onInsertPrompt(buildTrustAuditPrompt(snapshot))}
                      className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-green transition-colors hover:bg-accent-green/10"
                    >
                      审计摘要
                    </button>
                    <button
                      type="button"
                      onClick={() => onExtractProjectKnowledge(snapshot)}
                      disabled={!canOpenKnowledge || trustKnowledgeLoading}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <BookMarked size={12} />
                      {trustKnowledgeLoading ? '沉淀中' : '沉淀知识'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onInsertPrompt(buildProjectMemorySuggestionPrompt(snapshot))}
                      disabled={!canOpenKnowledge || snapshot.projectMemorySuggestions.length === 0}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <BookMarked size={12} />
                      建议记忆
                    </button>
                    <button
                      type="button"
                      onClick={() => onExportTrustReport(snapshot)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/10"
                    >
                      <Download size={12} />
                      导出报告
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {trustSignals.map(signal => {
                    const SignalIcon = signal.icon
                    return (
                      <div key={signal.id} className={`min-w-0 rounded-md border p-2 ${getTrustSignalClass(signal.tone)}`}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <SignalIcon size={13} className="shrink-0" />
                          <span className="truncate text-[11px] font-semibold text-text-primary">{signal.label}</span>
                        </div>
                        <div className="mt-1 truncate text-xs font-semibold" title={signal.value}>{signal.value}</div>
                        <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-text-secondary">{signal.detail}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
                  {snapshot.deliveryMetrics.map(metric => (
                    <div key={metric.id} className={`min-w-0 rounded-md border px-2 py-1.5 ${getDeliveryMetricClass(metric.status)}`}>
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-[10px] font-semibold text-text-primary">{metric.label}</span>
                        <span className="shrink-0 text-[10px] font-medium">{metric.value}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] leading-4 text-text-secondary" title={metric.detail}>
                        {metric.detail}
                      </div>
                    </div>
                  ))}
                </div>
                {expanded && snapshot.projectMemorySuggestions.length > 0 && (
                  <div className="mt-3 border-t border-border-subtle/70 pt-2.5">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <BookMarked size={13} className="text-accent-purple" />
                        <span className="text-xs font-semibold text-text-secondary">建议记忆审核</span>
                        <span className="rounded-md bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                          {snapshot.projectMemorySuggestions.length} 条
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                        <span className="rounded-md bg-accent-green/10 px-1.5 py-0.5 text-accent-green">
                          已沉淀 {memoryReviewStats.accepted + memoryReviewStats.edited}
                        </span>
                        <span className="rounded-md bg-accent-red/10 px-1.5 py-0.5 text-accent-red">
                          已拒绝 {memoryReviewStats.rejected}
                        </span>
                      </div>
                    </div>
                    {snapshot.staleMemoryCandidates.length > 0 && (
                      <div className="mb-2 rounded-md border border-accent-yellow/20 bg-accent-yellow/5 p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-accent-yellow">
                            <AlertTriangle size={13} className="shrink-0" />
                            <span className="truncate">发现 {snapshot.staleMemoryCandidates.length} 条可能陈旧的项目记忆</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onInsertPrompt(buildStaleMemoryReviewPrompt(snapshot))}
                            className="rounded-md px-2 py-0.5 text-[11px] font-medium text-accent-yellow transition-colors hover:bg-accent-yellow/10"
                          >
                            生成复核
                          </button>
                          <button
                            type="button"
                            onClick={() => onResolveStaleMemoryCandidates(snapshot.staleMemoryCandidates, 'refresh', snapshot)}
                            disabled={!!staleMemorySavingId}
                            className="rounded-md px-2 py-0.5 text-[11px] font-medium text-accent-green transition-colors hover:bg-accent-green/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            批量更新
                          </button>
                          <button
                            type="button"
                            onClick={() => onResolveStaleMemoryCandidates(snapshot.staleMemoryCandidates, 'archive', snapshot)}
                            disabled={!!staleMemorySavingId}
                            className="rounded-md px-2 py-0.5 text-[11px] font-medium text-accent-yellow transition-colors hover:bg-accent-yellow/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            批量归档
                          </button>
                        </div>
                        <div className="mt-1.5 grid gap-1 lg:grid-cols-2">
                          {snapshot.staleMemoryCandidates.slice(0, 4).map(candidate => (
                            <div key={`${candidate.entryId}-${candidate.suggestionId}`} className="min-w-0 rounded bg-bg-primary/45 px-2 py-1.5 text-[10px] leading-4 text-text-secondary">
                              <div className="truncate font-semibold text-text-primary" title={candidate.entryTitle}>{candidate.entryTitle}</div>
                              <div className="truncate" title={candidate.reason}>{candidate.reason}</div>
                              <div className="mt-1 flex flex-wrap justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => onResolveStaleMemoryCandidate(candidate, 'refresh', snapshot)}
                                  disabled={!!staleMemorySavingId}
                                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-accent-green transition-colors hover:bg-accent-green/10 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {staleMemorySavingId === candidate.entryId ? '处理中' : '用新证据更新'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onResolveStaleMemoryCandidate(candidate, 'archive', snapshot)}
                                  disabled={!!staleMemorySavingId}
                                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-accent-yellow transition-colors hover:bg-accent-yellow/10 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  归档旧知识
                                </button>
                              </div>
                            </div>
                          ))}
                          {snapshot.staleMemoryCandidates.length > 4 && (
                            <div className="min-w-0 rounded bg-bg-primary/30 px-2 py-1.5 text-[10px] leading-4 text-text-muted">
                              还有 {snapshot.staleMemoryCandidates.length - 4} 条候选已折叠，可使用批量更新或批量归档统一处理。
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="grid gap-2 lg:grid-cols-2">
                      {snapshot.projectMemorySuggestions.map(suggestion => {
                        const review = memorySuggestionReviews[suggestion.id]
                        const draft = memorySuggestionDrafts[suggestion.id] || { title: suggestion.title, content: suggestion.content }
                        const isEditing = memorySuggestionEditingId === suggestion.id
                        const isSaving = memorySuggestionSavingId === suggestion.id
                        const isFinal = !!review
                        return (
                          <div key={suggestion.id} className="min-w-0 rounded-md border border-border-subtle/70 bg-bg-primary/30 p-2">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0">
                                {isEditing ? (
                                  <input
                                    value={draft.title}
                                    onChange={event => onChangeMemorySuggestionDraft(suggestion.id, { ...draft, title: event.target.value })}
                                    className="w-full rounded-md bg-bg-primary/70 px-2 py-1 text-xs font-semibold text-text-primary outline-none focus:ring-1 focus:ring-accent-blue/45"
                                  />
                                ) : (
                                  <div className="truncate text-xs font-semibold text-text-primary" title={suggestion.title}>{suggestion.title}</div>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                                  <span className="rounded bg-bg-primary px-1.5 py-0.5">{suggestion.knowledgeCategory}</span>
                                  <span>{Math.round(suggestion.confidence * 100)}%</span>
                                  <span className="truncate" title={suggestion.sourceReference}>{suggestion.sourceReference}</span>
                                </div>
                              </div>
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getMemorySuggestionReviewClass(review, isEditing)}`}>
                                {getMemorySuggestionReviewLabel(review, isEditing)}
                              </span>
                            </div>
                            {isEditing ? (
                              <textarea
                                value={draft.content}
                                onChange={event => onChangeMemorySuggestionDraft(suggestion.id, { ...draft, content: event.target.value })}
                                rows={3}
                                className="mt-2 w-full resize-none rounded-md bg-bg-primary/70 px-2 py-1.5 text-[11px] leading-4 text-text-primary outline-none focus:ring-1 focus:ring-accent-blue/45"
                              />
                            ) : (
                              <div className="mt-2 line-clamp-3 text-[11px] leading-4 text-text-secondary" title={suggestion.content}>
                                {suggestion.content}
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onPromoteMemorySuggestion(suggestion, snapshot)}
                                    disabled={!canOpenKnowledge || isSaving || !draft.title.trim() || !draft.content.trim()}
                                    className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-green transition-colors hover:bg-accent-green/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isSaving ? '保存中' : '保存为知识'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={onCancelEditMemorySuggestion}
                                    disabled={isSaving}
                                    className="rounded-md px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onPromoteMemorySuggestion(suggestion, snapshot)}
                                    disabled={!canOpenKnowledge || isSaving || isFinal}
                                    className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-green transition-colors hover:bg-accent-green/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isSaving ? '沉淀中' : '接受'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onStartEditMemorySuggestion(suggestion)}
                                    disabled={isSaving || isFinal}
                                    className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-purple transition-colors hover:bg-accent-purple/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    编辑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onRejectMemorySuggestion(suggestion)}
                                    disabled={isSaving || isFinal}
                                    className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-red transition-colors hover:bg-accent-red/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    拒绝
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 grid gap-4 text-xs md:grid-cols-3">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-semibold text-text-secondary">下一步</span>
                    <button
                      type="button"
                      onClick={() => onInsertPrompt(`按当前 Mission 状态继续推进：${snapshot.nextActions.join('；')}。执行前先说明计划，完成后给出验证结果。`)}
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

                <div className="min-w-0 md:pl-4">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="font-semibold text-text-secondary">风险雷达</span>
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

                <div className="min-w-0 md:pl-4">
                  <div className="mb-2 font-semibold text-text-secondary">证据链</div>
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
            </div>
          )}
        </div>
      </div>
    </section>
  )
})

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function getDisplayPath(filePath: string, projectPath?: string): string {
  const normalizedFile = normalizeFsPath(filePath)
  const normalizedProject = projectPath ? normalizeFsPath(projectPath) : ''
  if (normalizedProject && normalizedFile.toLowerCase().startsWith(`${normalizedProject.toLowerCase()}/`)) {
    return normalizedFile.slice(normalizedProject.length + 1)
  }
  return normalizedFile
}

function getReviewTargetPath(filePath: string, repoPath?: string): string {
  const displayPath = getDisplayPath(filePath, repoPath)
  return displayPath.replace(/\//g, '\\')
}

function formatCompletionElapsed(ms: number): string {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

function extractCompletionHeadline(messages: ConversationMessage[]): string {
  const lastAssistant = [...messages].reverse().find(message => message.role === 'assistant' && message.content?.trim())
  const text = (lastAssistant?.content || '')
    .split('\n')
    .map(line => line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
    .find(Boolean)
  if (!text) return 'AI 已完成本轮处理，下面是本次改动交付信息。'
  return compactText(text, 120)
}

function buildCompletionSummary(messages: ConversationMessage[], projectPath?: string): CompletionSummary | null {
  const lastFileChangeIndex = messages.reduce((latest, message, index) => (
    message.fileChange ? index : latest
  ), -1)
  if (lastFileChangeIndex < 0) return null

  let turnStartIndex = 0
  for (let index = lastFileChangeIndex; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && !message.content?.startsWith('\u25B6 /')) {
      turnStartIndex = index
      break
    }
  }

  let turnEndIndex = messages.length
  for (let index = lastFileChangeIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user' && !message.content?.startsWith('\u25B6 /')) {
      turnEndIndex = index
      break
    }
  }

  const turnMessages = messages.slice(turnStartIndex, turnEndIndex)
  const fileMap = new Map<string, CompletionFileChange>()
  let startAt = Number.POSITIVE_INFINITY
  let endAt = 0

  for (const message of turnMessages) {
    const timestamp = Date.parse(message.timestamp)
    if (Number.isFinite(timestamp)) {
      startAt = Math.min(startAt, timestamp)
      endAt = Math.max(endAt, timestamp)
    }

    const change = message.fileChange
    if (!change?.filePath) continue

    const existing = fileMap.get(change.filePath)
    const fileName = getShortFileName(change.filePath)
    if (existing) {
      existing.changeType = change.changeType
      existing.additions += change.additions || 0
      existing.deletions += change.deletions || 0
    } else {
      fileMap.set(change.filePath, {
        filePath: change.filePath,
        displayPath: getDisplayPath(change.filePath, projectPath),
        fileName,
        changeType: change.changeType,
        additions: change.additions || 0,
        deletions: change.deletions || 0,
      })
    }
  }

  const files = Array.from(fileMap.values())
  if (files.length === 0) return null
  const elapsedMs = Number.isFinite(startAt) && endAt > startAt ? endAt - startAt : 1000
  return {
    elapsedLabel: formatCompletionElapsed(elapsedMs),
    headline: extractCompletionHeadline(turnMessages),
    files,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

const CHANGE_TYPE_LABEL: Record<CompletionFileChange['changeType'], string> = {
  edit: '编辑',
  create: '创建',
  write: '写入',
  delete: '删除',
}

const CompletionHandoff = React.memo(function CompletionHandoff({
  summary,
  sessionId,
  sessionName,
  workingDirectory,
  onInsertPrompt,
}: CompletionHandoffProps) {
  const openFileInTab = useFileManagerStore(state => state.openFileInTab)
  const [expanded, setExpanded] = useState(true)
  const [reviewState, setReviewState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const primaryFile = summary.files[0]

  const handleCopyPaths = async () => {
    await navigator.clipboard.writeText(summary.files.map(file => file.displayPath).join('\n'))
  }

  const handleUndoPrompt = () => {
    onInsertPrompt([
      '请撤销刚才这一轮 AI 对文件做出的改动，并在撤销后说明恢复了哪些文件：',
      ...summary.files.map(file => `- ${file.displayPath}`),
    ].join('\n'))
  }

  const handleReview = async () => {
    if (!workingDirectory || reviewState === 'running') return
    setReviewState('running')
    try {
      const repoRoot = await window.spectrAI?.git?.getRepoRoot?.(workingDirectory)
      const repoPath = repoRoot || workingDirectory
      const targetFiles = summary.files.map(file => getReviewTargetPath(file.filePath, repoPath))
      const result = await window.spectrAI?.codeReview?.start?.({
        sessionId,
        sessionName,
        repoPath,
        targetFiles,
      })
      setReviewState(result?.success ? 'done' : 'error')
    } catch {
      setReviewState('error')
    }
  }

  return (
    <section className="completion-handoff mb-5 ml-3 mr-2 max-w-[min(1040px,96%)] overflow-hidden rounded-lg md:ml-8 md:mr-12 md:max-w-[min(1040px,92%)]">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-bg-hover/35"
      >
        <CheckCircle2 size={14} className="text-accent-green" />
        <span className="font-medium text-text-secondary">已处理 {summary.elapsedLabel}</span>
        <ChevronDown size={13} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
        <span className="ml-auto font-mono text-[11px]">
          {summary.files.length} 个文件已更改
          <span className="ml-2 text-accent-green">+{summary.totalAdditions}</span>
          <span className="ml-1 text-accent-red">-{summary.totalDeletions}</span>
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-3">
          <p className="mb-3 text-sm leading-6 text-text-secondary">{summary.headline}</p>

          {primaryFile && (
            <div className="mb-3 flex items-center gap-3 rounded-md bg-bg-primary/35 px-3 py-2">
              <FileText size={17} className="flex-shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-text-primary">{primaryFile.fileName}</div>
                <div className="truncate text-[11px] text-text-muted">{primaryFile.displayPath}</div>
              </div>
              <button
                type="button"
                onClick={() => openFileInTab(primaryFile.filePath)}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-bg-tertiary/65 px-2 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-blue"
              >
                <FolderOpen size={12} />
                打开
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-md bg-bg-primary/28">
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-text-secondary shadow-[0_1px_0_rgba(255,255,255,0.035)]">
              <span>{summary.files.length} 个文件已更改</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleUndoPrompt}
                  className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-text-muted transition-colors hover:bg-bg-hover hover:text-accent-yellow"
                >
                  <RotateCcw size={12} />
                  撤销
                </button>
                <button
                  type="button"
                  onClick={handleReview}
                  disabled={!workingDirectory || reviewState === 'running'}
                  className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-text-muted transition-colors hover:bg-bg-hover hover:text-accent-purple disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShieldCheck size={12} />
                  {reviewState === 'running' ? '审核中' : reviewState === 'done' ? '已发起' : '审核'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyPaths}
                  className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-accent-blue"
                  title="复制文件路径"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>

            <div className="divide-y divide-white/[0.035]">
              {summary.files.map(file => (
                <button
                  key={file.filePath}
                  type="button"
                  onClick={() => openFileInTab(file.filePath)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-bg-hover/45"
                >
                  <span className="min-w-0 truncate font-mono text-text-secondary">{file.displayPath}</span>
                  <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted">
                    {CHANGE_TYPE_LABEL[file.changeType]}
                  </span>
                  <span className="flex min-w-[64px] justify-end gap-1.5 font-mono text-[11px]">
                    <span className="text-accent-green">+{file.additions}</span>
                    <span className="text-accent-red">-{file.deletions}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {reviewState === 'error' && (
            <div className="mt-2 text-[11px] text-accent-red">代码审核发起失败，请确认当前目录是 Git 仓库后重试。</div>
          )}
        </div>
      )}
    </section>
  )
})

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
  const [queueHintAction, setQueueHintAction] = useState<'kanban' | null>(null)
  const [shipActionLoading, setShipActionLoading] = useState<'run' | 'summary' | null>(null)
  const [playbookActionLoading, setPlaybookActionLoading] = useState<string | null>(null)
  const [trustKnowledgeLoading, setTrustKnowledgeLoading] = useState(false)
  const [memorySuggestionReviews, setMemorySuggestionReviews] = useState<ProjectMemorySuggestionReviewMap>(() => loadMemorySuggestionReviews(sessionId))
  const [memorySuggestionDrafts, setMemorySuggestionDrafts] = useState<ProjectMemorySuggestionDraftMap>({})
  const [memorySuggestionEditingId, setMemorySuggestionEditingId] = useState<string | null>(null)
  const [memorySuggestionSavingId, setMemorySuggestionSavingId] = useState<string | null>(null)
  const [staleMemorySavingId, setStaleMemorySavingId] = useState<string | null>(null)
  const [deliveryPackGenerated, setDeliveryPackGenerated] = useState(false)
  const [deliveryPackGeneratedAtMs, setDeliveryPackGeneratedAtMs] = useState(0)
  const [knowledgeExtractionCount, setKnowledgeExtractionCount] = useState(0)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [commonPrompts, setCommonPrompts] = useState<CommonPrompt[]>(() => loadCommonPrompts())
  const [trustPolicyOverrides, setTrustPolicyOverrides] = useState<Record<string, TrustPolicyPresetId>>(() => loadTrustPolicyOverrides())
  const [promptPickerOpen, setPromptPickerOpen] = useState(false)
  const [promptManagerOpen, setPromptManagerOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState({ label: '', text: '' })
  const [opsBriefExpanded, setOpsBriefExpanded] = useState(() => {
    try {
      return localStorage.getItem('prismops-ops-brief-expanded-v2') === 'true'
    } catch {
      return false
    }
  })
  // 记录是否已完成首次滚到底部（每次组件挂载重置）
  const hasScrolledInitially = useRef(false)
  const scrollFrameRef = useRef<number | null>(null)
  const activeDeliveryMetricActionRef = useRef<PendingDeliveryMetricAction | null>(null)

  // 思考计时器：streaming 开始时重置，每秒 +1
  const [thinkingSeconds, setThinkingSeconds] = useState(0)
  const thinkingStartRef = useRef<number>(0)

  useEffect(() => {
    setDeliveryPackGenerated(false)
    setDeliveryPackGeneratedAtMs(0)
    setKnowledgeExtractionCount(0)
    setMemorySuggestionReviews(loadMemorySuggestionReviews(sessionId))
    setMemorySuggestionDrafts({})
    setMemorySuggestionEditingId(null)
    setMemorySuggestionSavingId(null)
    setStaleMemorySavingId(null)
  }, [sessionId])

  useEffect(() => {
    const consumeQueuedAction = () => {
      const action = consumePendingDeliveryMetricAction(sessionId)
      if (!action) return
      activeDeliveryMetricActionRef.current = action
      setExternalInsert(action.prompt)
      setQueueHintText(`已带入改进队列建议：${action.reason}`)
      setQueueHintAction(null)
    }

    consumeQueuedAction()
    window.addEventListener(DELIVERY_ACTION_EVENT, consumeQueuedAction)
    return () => {
      window.removeEventListener(DELIVERY_ACTION_EVENT, consumeQueuedAction)
    }
  }, [sessionId])

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
      localStorage.setItem('prismops-ops-brief-expanded-v2', String(opsBriefExpanded))
    } catch {
      // ignore
    }
  }, [opsBriefExpanded])

  useEffect(() => {
    if (!knowledgePanelOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setKnowledgePanelOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [knowledgePanelOpen])

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
  const sessionInitData = useSessionStore(state => state.sessionInitData[sessionId])
  const sessionAgents = useSessionStore(state => state.agents[sessionId] || [])
  const agentConversations = useSessionStore(state => state.conversations)
  const agentActivities = useSessionStore(state => state.activities)
  const fetchAgents = useSessionStore(state => state.fetchAgents)
  const createTask = useTaskStore(state => state.createTask)
  const setViewMode = useUIStore(state => state.setViewMode)
  const setPaneContent = useUIStore(state => state.setPaneContent)
  const createKnowledgeEntry = useKnowledgeCenterStore(state => state.createEntry)
  const updateKnowledgeEntry = useKnowledgeCenterStore(state => state.updateEntry)
  const knowledgeEntries = useKnowledgeCenterStore(state => state.entries)
  const fetchKnowledgeEntries = useKnowledgeCenterStore(state => state.fetchEntries)

  useEffect(() => {
    void fetchAgents(sessionId)
  }, [fetchAgents, sessionId])

  useEffect(() => {
    if (!workingDirectory) return
    void fetchKnowledgeEntries({
      type: 'project-knowledge',
      projectPath: workingDirectory,
      pageSize: 50,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    })
  }, [fetchKnowledgeEntries, workingDirectory])

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
    if (scrollFrameRef.current !== null) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      const el = scrollRef.current
      if (!el) return
      const shouldShow = el.scrollHeight - el.scrollTop - el.clientHeight >= 180
      setShowScrollBottom(prev => prev === shouldShow ? prev : shouldShow)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    }
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
    const activeAction = activeDeliveryMetricActionRef.current
    if (activeAction && isDeliveryMetricActionPrompt(text, activeAction)) {
      markDeliveryMetricActionSent(activeAction.actionId)
      activeDeliveryMetricActionRef.current = null
    }
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
  const completionSummary = useMemo(
    () => buildCompletionSummary(messages, workingDirectory),
    [messages, workingDirectory],
  )

  const opsBrief = useMemo<OpsBriefSnapshot>(() => {
    let userGoal = ''
    let additions = 0
    let deletions = 0
    let failedToolCount = 0
    let messageCount = 0
    let firstMessageAtMs = 0
    let lastFileChangeAtMs = 0
    let lastValidationAtMs = 0
    const uniqueFiles: string[] = []
    const seenFiles = new Set<string>()
    const toolUseMessages: ConversationMessage[] = []
    const commands: string[] = []
    const validationCommands: string[] = []
    const timelineEntries: EvidenceTimelineEntry[] = []

    for (const message of messages) {
      const timestampMs = Date.parse(message.timestamp)
      const hasTimestamp = Number.isFinite(timestampMs)
      const timestamp = hasTimestamp ? new Date(timestampMs).toISOString() : message.timestamp

      if ((message.role === 'user' || message.role === 'assistant')) {
        messageCount += 1
        if (!firstMessageAtMs) {
          if (hasTimestamp) {
            firstMessageAtMs = timestampMs
          }
        }
      }

      if (message.role === 'user' && message.content && !message.content.startsWith('\u25B6 /')) {
        userGoal = message.content
        timelineEntries.push({
          id: `${message.id}-mission`,
          type: 'mission',
          label: 'Mission 更新',
          detail: compactText(message.content, 96),
          timestamp,
          tone: 'neutral',
        })
      }

      if (message.fileChange) {
        const filePath = message.fileChange.filePath
        if (filePath && !seenFiles.has(filePath)) {
          seenFiles.add(filePath)
          uniqueFiles.push(filePath)
        }
        additions += message.fileChange.additions || 0
        deletions += message.fileChange.deletions || 0
        if (hasTimestamp) {
          lastFileChangeAtMs = Math.max(lastFileChangeAtMs, timestampMs)
        }
        timelineEntries.push({
          id: `${message.id}-change`,
          type: 'change',
          label: `${message.fileChange.changeType} ${getShortFileName(filePath)}`,
          detail: `文件改动 +${message.fileChange.additions || 0} / -${message.fileChange.deletions || 0}`,
          timestamp,
          tone: 'warn',
        })
      }

      if (message.role === 'tool_use') {
        toolUseMessages.push(message)
        const command = getToolCommand(message)
        if (command) {
          commands.push(command)
          if (isValidationCommand(command)) {
            validationCommands.push(command)
            if (hasTimestamp) {
              lastValidationAtMs = Math.max(lastValidationAtMs, timestampMs)
            }
            timelineEntries.push({
              id: `${message.id}-validation`,
              type: 'validation',
              label: '验证命令',
              detail: compactText(command, 96),
              timestamp,
              tone: 'good',
            })
          } else {
            timelineEntries.push({
              id: `${message.id}-tool`,
              type: 'tool',
              label: message.toolName || '工具调用',
              detail: compactText(command, 96),
              timestamp,
              tone: 'neutral',
            })
          }
        } else {
          timelineEntries.push({
            id: `${message.id}-tool`,
            type: 'tool',
            label: message.toolName || '工具调用',
            detail: compactText(message.content || '工具调用', 96),
            timestamp,
            tone: 'neutral',
          })
        }
      } else if (message.role === 'tool_result' && message.isError) {
        failedToolCount += 1
        timelineEntries.push({
          id: `${message.id}-risk`,
          type: 'risk',
          label: '工具异常',
          detail: compactText(message.toolResult || message.content || '工具结果异常', 96),
          timestamp,
          tone: 'bad',
        })
      }
    }

    const validationStale = uniqueFiles.length > 0 &&
      validationCommands.length > 0 &&
      lastFileChangeAtMs > 0 &&
      lastValidationAtMs > 0 &&
      lastFileChangeAtMs > lastValidationAtMs
    const hasFreshValidationEvidence = validationCommands.length > 0 && !validationStale
    const deliveryPackStale = deliveryPackGenerated &&
      lastFileChangeAtMs > 0 &&
      deliveryPackGeneratedAtMs > 0 &&
      lastFileChangeAtMs > deliveryPackGeneratedAtMs
    const deliveryPackCurrent = deliveryPackGenerated && !deliveryPackStale
    if (deliveryPackGeneratedAtMs > 0) {
      timelineEntries.push({
        id: `delivery-pack-${deliveryPackGeneratedAtMs}`,
        type: 'handoff',
        label: deliveryPackStale ? '交付包已过期' : '交付包已生成',
        detail: deliveryPackStale ? '交付包生成后又发生文件改动，需要更新。' : '已导出 Markdown 交付包。',
        timestamp: new Date(deliveryPackGeneratedAtMs).toISOString(),
        tone: deliveryPackStale ? 'warn' : 'good',
      })
    }
    const hasWaitingAction = pendingPermission || pendingAskQuestion || pendingQuestion || pendingPlanApproval
    const phaseLabel = pendingPermission || pendingAskQuestion || pendingQuestion || pendingPlanApproval || status === 'error'
      ? '需要处理'
      : hasFreshValidationEvidence && uniqueFiles.length > 0 && failedToolCount === 0
        ? '待交付'
      : validationCommands.length > 0
          ? validationStale ? '待复验' : '验证中'
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
      validationStale ? '最新改动发生在最近验证之后，验证已过期' : '',
      deliveryPackStale ? '最新改动发生在交付包生成之后，交付包需要更新' : '',
      !workingDirectory ? '未绑定项目目录' : '',
    ].filter(Boolean)
    if (risks.length === 0) risks.push('暂无明显阻塞')

    const nextActions = (() => {
      if (hasWaitingAction) return ['先处理等待项，再继续执行', '回答后让 AI 复述当前决策']
      if (status === 'error') return ['定位会话错误并恢复上下文', '确认错误是否影响当前交付']
      if (failedToolCount > 0) return ['复盘失败工具输出', '必要时换一条验证路径']
      if (uniqueFiles.length > 0 && validationCommands.length === 0) return ['运行类型检查、构建或关键测试', '确认改动范围是否符合预期']
      if (validationStale) return ['最新改动发生在验证之后，重新运行最小必要验证', '复验通过后再更新交付包']
      if (deliveryPackStale) return ['最新改动发生在交付包之后，重新生成交付包', '确认交付说明覆盖最新变更']
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

    let missionHealthScore = 52
    if (messageCount > 0) missionHealthScore += 6
    if (toolUseMessages.length > 0) missionHealthScore += 10
    if (uniqueFiles.length > 0) missionHealthScore += 10
    if (validationCommands.length > 0) missionHealthScore += 18
    if (validationCommands.length > 0 && uniqueFiles.length > 0) missionHealthScore += 6
    if (failedToolCount > 0) missionHealthScore -= Math.min(34, 18 + failedToolCount * 8)
    if (hasWaitingAction) missionHealthScore -= 18
    if (status === 'error') missionHealthScore -= 24
    if (!workingDirectory) missionHealthScore -= 8
    if (uniqueFiles.length > 0 && validationCommands.length === 0) missionHealthScore -= 10
    if (validationStale) missionHealthScore -= 12
    if (deliveryPackStale) missionHealthScore -= 8
    missionHealthScore = Math.max(5, Math.min(100, Math.round(missionHealthScore)))

    const missionHealthTone: OpsBriefSnapshot['missionHealthTone'] =
      status === 'error' || failedToolCount > 0 || missionHealthScore < 42
        ? 'bad'
        : hasWaitingAction || validationStale || deliveryPackStale || (uniqueFiles.length > 0 && validationCommands.length === 0) || missionHealthScore < 74
          ? 'warn'
          : validationCommands.length > 0 && failedToolCount === 0
            ? 'good'
            : 'neutral'

    const missionHealthLabel = missionHealthTone === 'bad'
      ? '需要处理'
      : missionHealthTone === 'warn'
        ? '待收敛'
        : missionHealthTone === 'good'
          ? '可交付'
          : '推进中'

    const deliveryReadiness = hasWaitingAction
      ? '先处理等待项'
      : status === 'error'
        ? '先恢复会话'
        : failedToolCount > 0
          ? '先修复异常工具'
          : uniqueFiles.length > 0 && validationCommands.length === 0
            ? '已有改动，建议验证'
            : validationStale
              ? '验证已过期，建议复验'
              : deliveryPackStale
                ? '交付包已过期，建议更新'
                : hasFreshValidationEvidence && uniqueFiles.length > 0
              ? '可整理交付包'
              : toolUseMessages.length > 0
                ? '继续收敛方案'
                : '先完成项目扫描'

    const readinessGates: DeliveryReadinessGate[] = [
      {
        id: 'scope',
        label: '目标清晰',
        detail: userGoal || session?.config?.initialPrompt || session?.name
          ? '已识别当前 Mission 的目标或会话上下文。'
          : '还没有明确目标，建议先让 AI 复述任务边界和验收标准。',
        status: userGoal || session?.config?.initialPrompt || session?.name ? 'passed' : 'warning',
        prompt: '请先复述当前任务目标、范围、约束和验收标准。如果信息不足，请列出需要用户补充的问题。',
      },
      {
        id: 'changes',
        label: '改动可追踪',
        detail: uniqueFiles.length > 0
          ? `已记录 ${uniqueFiles.length} 个改动文件。`
          : toolUseMessages.length > 0
            ? '已有工具活动，但暂未识别到文件改动。'
            : '还没有工具活动或文件改动记录。',
        status: uniqueFiles.length > 0 || toolUseMessages.length === 0 ? 'passed' : 'warning',
        prompt: '请检查当前会话是否产生文件改动，并总结改动范围；如果没有改动，请说明当前仍处于分析阶段。',
      },
      {
        id: 'validation',
        label: '验证证据',
        detail: validationStale
          ? '最新文件改动发生在最近验证命令之后，需要重新运行最小必要验证。'
          : validationCommands.length > 0
            ? `已看到 ${validationCommands.length} 条验证命令。`
            : uniqueFiles.length > 0
              ? '已有代码改动，但还没有看到 test/typecheck/build/lint 等验证命令。'
              : '还没有需要验证的代码改动。',
        status: validationStale ? 'warning' : validationCommands.length > 0 || uniqueFiles.length === 0 ? 'passed' : 'warning',
        prompt: validationStale
          ? '最新改动发生在最近验证之后。请重新运行最小必要验证，优先选择 typecheck、相关测试或 build；完成后说明验证是否覆盖最新改动。'
          : '请为当前改动运行最小必要验证，优先选择 typecheck、相关测试或 build；如果无法运行，请说明原因和替代验证方式。',
      },
      {
        id: 'failures',
        label: '异常清零',
        detail: failedToolCount > 0
          ? `发现 ${failedToolCount} 个异常工具结果，需要先定位或解释。`
          : '暂未发现失败的工具结果。',
        status: failedToolCount > 0 ? 'blocked' : 'passed',
        prompt: '请复盘失败的工具调用，定位原因，必要时做最小修复并重跑失败命令；如果失败不影响交付，请解释依据。',
      },
      {
        id: 'handoff',
        label: '交付说明',
        detail: deliveryPackStale
          ? '最新改动发生在交付包生成之后，需要更新交付说明。'
          : hasFreshValidationEvidence && uniqueFiles.length > 0 && failedToolCount === 0
          ? '已具备生成交付包的基础证据。'
          : '交付说明需要包含变更、验证、风险和下一步，当前证据仍需补齐。',
        status: hasFreshValidationEvidence && uniqueFiles.length > 0 && failedToolCount === 0 && !deliveryPackStale
          ? 'passed'
          : hasWaitingAction || failedToolCount > 0 || validationStale
            ? 'blocked'
            : 'warning',
        prompt: validationStale
          ? '请先重新运行最小必要验证，再生成交付说明。交付说明需要包含最新变更、验证结果、剩余风险、建议提交说明和用户下一步。'
          : '请生成交付说明：变更摘要、验证结果、剩余风险、建议提交说明和用户下一步。若证据不足，请先补齐最小缺口。',
      },
    ]

    const hasMissionRisk = risks.some(risk => !risk.includes('暂无明显'))
    const primarySignal = compactText(hasMissionRisk ? risks[0] : nextActions[0], 54)
    const agents: OpsBriefAgent[] = sessionAgents.map(agent => summarizeOpsBriefAgent(
      {
        agentId: agent.agentId,
        name: agent.name,
        status: agent.status,
        childSessionId: agent.childSessionId,
        workDir: agent.workDir,
        prompt: agent.prompt,
      },
      agent.childSessionId ? agentConversations[agent.childSessionId] : [],
      agent.childSessionId ? agentActivities[agent.childSessionId] : [],
    ))
    const activeAgents = agents.filter(agent => agent.status === 'pending' || agent.status === 'running')
    const activeAgentCount = activeAgents.length
    const blockedAgentCount = agents.filter(agent => agent.status === 'failed' || agent.status === 'cancelled').length
    const workDirOwners = new Map<string, OpsBriefAgent[]>()
    for (const agent of activeAgents) {
      const key = (agent.workDir || '').trim().toLowerCase()
      if (!key) continue
      workDirOwners.set(key, [...(workDirOwners.get(key) || []), agent])
    }
    const overlappingWorkDirs = Array.from(workDirOwners.entries())
      .filter(([, owners]) => owners.length > 1)
    const fileOwners = new Map<string, OpsBriefAgent[]>()
    for (const agent of activeAgents) {
      for (const file of agent.lastFiles) {
        const key = file.toLowerCase()
        fileOwners.set(key, [...(fileOwners.get(key) || []), agent])
      }
    }
    const overlappingFiles = Array.from(fileOwners.entries())
      .filter(([, owners]) => owners.length > 1)
    const agentCoordinationRisks = [
      ...overlappingWorkDirs.map(([workDir, owners]) => `多个执行中的 Agent 共享工作目录：${owners.map(agent => agent.name || agent.agentId).join('、')} -> ${workDir}`),
      ...overlappingFiles.map(([file, owners]) => `多个执行中的 Agent 最近触达同一文件：${owners.map(agent => agent.name || agent.agentId).join('、')} -> ${file}`),
      blockedAgentCount > 0 ? `${blockedAgentCount} 个 Agent 处于失败或取消状态，需要确认是否影响交付` : '',
      activeAgentCount > 3 ? `${activeAgentCount} 个 Agent 正在并行，建议确认 owner 边界和合并顺序` : '',
    ].filter(Boolean)
    const agentConflictCount = overlappingWorkDirs.length + overlappingFiles.length + blockedAgentCount
    const agentOwnershipLanes: AgentOwnershipLane[] = agents.map(agent => {
      const workDirKey = (agent.workDir || '').trim().toLowerCase()
      const hasWorkDirOverlap = !!workDirKey && (workDirOwners.get(workDirKey)?.length || 0) > 1
      const hasFileOverlap = agent.lastFiles.some(file => (fileOwners.get(file.toLowerCase())?.length || 0) > 1)
      const hasChanges = agent.lastFiles.length > 0
      const hasValidation = agent.validationCount > 0
      const mergeReadiness: AgentMergeReadiness = agent.status === 'failed' || agent.status === 'cancelled' || agent.failedToolCount > 0
        ? 'blocked'
        : hasWorkDirOverlap || hasFileOverlap || agent.status === 'running' || agent.status === 'pending'
          ? 'watch'
          : hasChanges && !hasValidation
            ? 'needs-validation'
            : 'ready'
      const validationLabel = hasValidation
        ? `${agent.validationCount} 条验证证据`
        : hasChanges
          ? '有文件改动，缺少验证证据'
          : '暂无文件改动，按交付说明确认'
      const risk = agent.risk || (hasWorkDirOverlap
        ? '工作目录与其他执行中的 Agent 重叠'
        : hasFileOverlap
          ? '最近触达文件与其他执行中的 Agent 重叠'
          : undefined)

      return {
        id: agent.agentId,
        owner: agent.name || agent.agentId,
        status: agent.status,
        workDir: agent.workDir,
        ownedFiles: agent.lastFiles,
        lastCommand: agent.lastCommand,
        validationLabel,
        mergeReadiness,
        risk,
      }
    })

    const hasCodeChanges = uniqueFiles.length > 0
    const hasValidationEvidence = validationCommands.length > 0
    const hasDeliveryEvidence = deliveryPackCurrent || (hasCodeChanges && hasFreshValidationEvidence && failedToolCount === 0)
    const elapsedMinutes = firstMessageAtMs > 0
      ? Math.max(0, Math.round((Date.now() - firstMessageAtMs) / 60000))
      : 0
    const deliveryMetrics: DeliveryMetric[] = [
      {
        id: 'delivery-pack',
        label: '交付包',
        value: deliveryPackCurrent ? '已导出' : deliveryPackStale ? '已过期' : hasDeliveryEvidence ? '可生成' : '待补齐',
        detail: deliveryPackCurrent
          ? '本会话已生成 Markdown 交付包'
          : deliveryPackStale
            ? '最新改动晚于交付包，需要重新生成'
            : hasDeliveryEvidence
              ? '已有改动与验证，可生成交付包'
              : '需要改动、验证和风险说明',
        status: deliveryPackCurrent || hasDeliveryEvidence ? 'passed' : hasCodeChanges || deliveryPackStale ? 'warning' : 'blocked',
      },
      {
        id: 'validation-coverage',
        label: '验证覆盖',
        value: hasCodeChanges ? (validationStale ? '已过期' : hasValidationEvidence ? `${validationCommands.length} 条` : '缺少') : '无需',
        detail: hasCodeChanges
          ? validationStale
            ? '最新改动发生在验证之后，需要复验'
            : hasValidationEvidence
            ? '代码改动已有验证证据'
            : '代码改动后应补齐测试、构建或类型检查'
          : '当前未识别到代码改动',
        status: hasCodeChanges && (!hasValidationEvidence || validationStale) ? 'warning' : 'passed',
      },
      {
        id: 'handoff-time',
        label: '交付耗时',
        value: hasDeliveryEvidence ? formatElapsedMinutes(elapsedMinutes) : firstMessageAtMs > 0 ? '进行中' : '未开始',
        detail: hasDeliveryEvidence
          ? '从首条任务到可交付证据'
          : '等待验证和交付说明闭环',
        status: hasDeliveryEvidence ? 'passed' : firstMessageAtMs > 0 ? 'warning' : 'blocked',
      },
      {
        id: 'project-memory',
        label: '项目记忆',
        value: knowledgeExtractionCount > 0 ? `${knowledgeExtractionCount} 条` : workingDirectory ? '待沉淀' : '未绑定',
        detail: knowledgeExtractionCount > 0
          ? '本会话已沉淀复用知识'
          : workingDirectory
            ? '可从会话一键沉淀团队记忆'
            : '需要绑定项目目录后沉淀',
        status: knowledgeExtractionCount > 0 ? 'passed' : workingDirectory ? 'warning' : 'blocked',
      },
      {
        id: 'safety',
        label: '安全状态',
        value: failedToolCount > 0 ? `${failedToolCount} 异常` : hasWaitingAction ? '待处理' : '清爽',
        detail: failedToolCount > 0
          ? '需要复盘失败工具结果'
          : hasWaitingAction
            ? '有权限、问题或计划审批等待处理'
            : '未发现失败工具或等待项',
        status: failedToolCount > 0 || status === 'error' ? 'blocked' : hasWaitingAction ? 'warning' : 'passed',
      },
    ]
    const deliveryMetricScore = Math.round((deliveryMetrics.filter(metric => metric.status === 'passed').length / deliveryMetrics.length) * 100)
    const evidenceTimeline = timelineEntries
      .sort((a, b) => new Date(a.timestamp || '').getTime() - new Date(b.timestamp || '').getTime())
      .slice(-18)
    const projectName = getProjectName(workingDirectory, session?.name || session?.config?.name)
    const goal = compactText(userGoal || session?.config?.initialPrompt || session?.name || session?.config?.name || '还没有明确目标，先发送一条任务描述开始推进。', 120)
    const lastFiles = uniqueFiles.slice(-3).map(getShortFileName)
    const lastCommand = compactText(commands[commands.length - 1] || validationCommands[validationCommands.length - 1] || '', 92)
    const projectMemorySuggestions = buildProjectMemorySuggestions({
      projectName,
      projectPath: workingDirectory,
      goal,
      phaseLabel,
      deliveryReadiness,
      lastCommand,
      risks,
      evidence,
      evidenceTimeline,
      lastFiles,
      validationCount: validationCommands.length,
      changedFileCount: uniqueFiles.length,
    })
    const projectKnowledgeEntries = knowledgeEntries.filter(entry =>
      entry.type === 'project-knowledge' &&
      (!workingDirectory || entry.projectPath === workingDirectory)
    )
    const staleMemoryCandidates = findStaleProjectMemoryCandidates(projectMemorySuggestions, projectKnowledgeEntries)

    return {
      projectName,
      projectPath: workingDirectory,
      providerId: providerId || session?.config?.providerId,
      modelId: session?.config?.modelOverride || sessionInitData?.model,
      trustPolicyPresetId: normalizeTrustPolicyPresetId(trustPolicyOverrides[getTrustPolicyScopeKey(workingDirectory, sessionId)]),
      goal,
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
      missionHealthLabel,
      missionHealthTone,
      missionHealthScore,
      deliveryReadiness,
      primarySignal,
      changedFileCount: uniqueFiles.length,
      additions,
      deletions,
      toolCount: toolUseMessages.length,
      failedToolCount,
      validationCount: validationCommands.length,
      messageCount,
      lastFiles,
      lastCommand,
      phaseLabel,
      liveProgressText,
      nextActions,
      risks,
      evidence,
      evidenceTimeline,
      projectMemorySuggestions,
      staleMemoryCandidates,
      readinessGates,
      deliveryMetrics,
      deliveryMetricScore,
      deliveryPackGenerated: deliveryPackCurrent,
      validationStale,
      verifiedHandoffMinutes: hasDeliveryEvidence ? elapsedMinutes : undefined,
      projectMemoryCount: knowledgeExtractionCount,
      agents,
      agentCount: agents.length,
      activeAgentCount,
      blockedAgentCount,
      agentConflictCount,
      agentCoordinationRisks,
      agentOwnershipLanes,
    }
  }, [
    messages,
    sessionAgents,
    agentConversations,
    agentActivities,
    workingDirectory,
    session?.name,
    session?.config?.name,
    session?.config?.providerId,
    session?.config?.initialPrompt,
    session?.config?.modelOverride,
    sessionInitData?.model,
    providerId,
    trustPolicyOverrides,
    sessionId,
    pendingPermission,
    pendingAskQuestion,
    pendingQuestion,
    pendingPlanApproval,
    status,
    isStreaming,
    liveProgressText,
    deliveryPackGenerated,
    deliveryPackGeneratedAtMs,
    knowledgeExtractionCount,
    knowledgeEntries,
  ])

  useEffect(() => {
    if (opsBrief.messageCount === 0 && opsBrief.toolCount === 0) return
    const safetyMetric = opsBrief.deliveryMetrics.find(metric => metric.id === 'safety')
    recordDeliveryMetricSnapshot({
      sessionId,
      projectName: opsBrief.projectName,
      projectPath: opsBrief.projectPath,
      updatedAt: new Date().toISOString(),
      score: opsBrief.deliveryMetricScore,
      deliveryPackGenerated: opsBrief.deliveryPackGenerated,
      changedFileCount: opsBrief.changedFileCount,
      validationCount: opsBrief.validationCount,
      validationStale: opsBrief.validationStale,
      verifiedHandoffMinutes: opsBrief.verifiedHandoffMinutes,
      projectMemoryCount: opsBrief.projectMemoryCount,
      safetyStatus: safetyMetric?.status || 'warning',
      statusLabel: opsBrief.statusLabel,
      phaseLabel: opsBrief.phaseLabel,
      deliveryReadiness: opsBrief.deliveryReadiness,
      messageCount: opsBrief.messageCount,
      toolCount: opsBrief.toolCount,
    })
  }, [
    sessionId,
    opsBrief.projectName,
    opsBrief.projectPath,
    opsBrief.deliveryMetricScore,
    opsBrief.deliveryPackGenerated,
    opsBrief.changedFileCount,
    opsBrief.validationCount,
    opsBrief.validationStale,
    opsBrief.verifiedHandoffMinutes,
    opsBrief.projectMemoryCount,
    opsBrief.statusLabel,
    opsBrief.phaseLabel,
    opsBrief.deliveryReadiness,
    opsBrief.messageCount,
    opsBrief.toolCount,
    opsBrief.deliveryMetrics,
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
      setQueueHintAction(null)
    }
  }, [])

  const handleOpenTaskBoard = useCallback(() => {
    setPaneContent('primary', 'sessions')
    setViewMode('kanban')
    setQueueHintAction(null)
  }, [setPaneContent, setViewMode])

  const handleRunShipPlan = useCallback(async () => {
    if (!workingDirectory || shipActionLoading) {
      setQueueHintText('当前会话没有绑定项目目录，无法运行交付检查')
      setQueueHintAction(null)
      return
    }
    setShipActionLoading('run')
    setQueueHintText('正在运行 QA/SHIP 交付检查...')
    setQueueHintAction(null)
    try {
      const result = await window.spectrAI.ship.runPlan(workingDirectory, {
        includeOptional: false,
        stopOnFailure: true,
      })
      if (!result?.success) {
        setQueueHintText(result?.error?.userMessage || result?.error?.message || result?.error || '交付检查运行失败')
        return
      }
      const run = unwrapIpcData<ShipRunResult>(result)
      const prompt = run?.suggestedPrompt || [
        'QA/SHIP 交付检查已完成，请根据结果继续处理。',
        '',
        `结果摘要：${run?.summary || '暂无摘要'}`,
        '',
        '请输出：验证结果、失败项处理建议、剩余风险，以及是否可以交付。',
      ].join('\n')
      const failedResults = run ? getFailedShipResults(run) : []
      let repairTaskCreated = false
      let repairTaskError = ''
      if (run && !run.passed && failedResults.length > 0) {
        try {
          await createTask(buildShipRepairTask(run, workingDirectory, sessionId))
          repairTaskCreated = true
        } catch (taskError: any) {
          repairTaskError = taskError?.message || '修复任务创建失败'
        }
        try {
          await window.spectrAI.workingContext.addProblem(
            sessionId,
            `QA/SHIP 交付检查失败：${run.summary || '请查看失败命令和输出摘要'}`,
          )
          await window.spectrAI.workingContext.addTodo(
            sessionId,
            `修复并复验失败命令：${failedResults.map(item => item.command || item.label || item.id).filter(Boolean).join('；')}`,
          )
          await window.spectrAI.workingContext.createSnapshot(sessionId, 'ship-check-failed')
        } catch (contextError) {
          console.warn('[ConversationView] Failed to persist failed ship check context', contextError)
        }
      } else if (run?.passed) {
        try {
          await window.spectrAI.workingContext.addDecision(
            sessionId,
            `QA/SHIP 交付检查通过：${run.summary || '所有必要检查已通过'}`,
          )
          await window.spectrAI.workingContext.createSnapshot(sessionId, 'ship-check-passed')
        } catch (contextError) {
          console.warn('[ConversationView] Failed to persist passed ship check context', contextError)
        }
      }
      setExternalInsert(prompt)
      setQueueHintText(`${run?.summary || '交付检查已完成'}，结果已插入输入框并沉淀到工作上下文${repairTaskCreated ? '，已创建修复任务' : ''}${repairTaskError ? `，${repairTaskError}` : ''}`)
      setQueueHintAction(repairTaskCreated ? 'kanban' : null)
    } catch (error: any) {
      setQueueHintText(error?.message || '交付检查运行失败')
    } finally {
      setShipActionLoading(null)
    }
  }, [workingDirectory, shipActionLoading, createTask, sessionId])

  const handleGenerateShipSummary = useCallback(async () => {
    if (!workingDirectory || shipActionLoading) {
      setQueueHintText('当前会话没有绑定项目目录，无法生成交付说明')
      setQueueHintAction(null)
      return
    }
    setShipActionLoading('summary')
    setQueueHintText('正在生成交付包...')
    setQueueHintAction(null)
    try {
      const result = await window.spectrAI.ship.generateChangeSummary(workingDirectory)
      if (!result?.success) {
        setQueueHintText(result?.error?.userMessage || result?.error?.message || result?.error || '交付包生成失败')
        return
      }
      const summary = unwrapIpcData<any>(result)
      const deliveryPackSnapshot = markDeliveryPackGenerated(opsBrief)
      const deliveryPackMarkdown = buildDeliveryPackMarkdown(deliveryPackSnapshot, summary)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      downloadMarkdownFile(
        deliveryPackMarkdown,
        `prismops-delivery-pack-${getSafeReportFileName(deliveryPackSnapshot.projectName)}-${timestamp}.md`,
      )
      const prompt = summary?.suggestedPrompt || summary?.markdown || [
        '请基于当前会话生成交付包。',
        '',
        `变更摘要：${summary?.summary || '暂无摘要'}`,
        '',
        '请输出：变更摘要、验证结果、剩余风险、建议提交说明和用户下一步。',
      ].join('\n')
      try {
        await window.spectrAI.workingContext.addDecision(
          sessionId,
          `已生成并导出交付包：${summary?.summary || summary?.suggestedCommitMessage || deliveryPackSnapshot.deliveryReadiness}`,
        )
        if (Array.isArray(summary?.warnings) && summary.warnings.length > 0) {
          await window.spectrAI.workingContext.addTodo(
            sessionId,
            `交付前确认注意事项：${summary.warnings.slice(0, 3).join('；')}`,
          )
        }
        await window.spectrAI.workingContext.createSnapshot(sessionId, 'delivery-pack-generated')
      } catch (contextError) {
        console.warn('[ConversationView] Failed to persist delivery pack context', contextError)
      }
      setDeliveryPackGenerated(true)
      setDeliveryPackGeneratedAtMs(Date.now())
      setExternalInsert(prompt)
      setQueueHintText('交付包已导出为 Markdown，交付说明已插入输入框并沉淀到工作上下文')
      setQueueHintAction(null)
    } catch (error: any) {
      setQueueHintText(error?.message || '交付包生成失败')
    } finally {
      setShipActionLoading(null)
    }
  }, [workingDirectory, shipActionLoading, sessionId, opsBrief])

  const handleInsertTeamPlaybook = useCallback(async (template: TeamPlaybookTemplate) => {
    if (playbookActionLoading) return
    setPlaybookActionLoading(template.id)
    setQueueHintText(`正在读取项目记忆并生成「${template.label}」模板...`)
    setQueueHintAction(null)
    try {
      const memoryParts: string[] = []
      try {
        const result = await window.spectrAI.workingContext.getPrompt(sessionId)
        const workingMemoryPrompt = extractWorkingContextPrompt(result)
        if (workingMemoryPrompt) memoryParts.push(workingMemoryPrompt)
      } catch (contextError) {
        console.warn('[ConversationView] Failed to load working context prompt for team playbook', contextError)
      }
      if (workingDirectory) {
        try {
          const result = await (window as any).spectrAI?.projectKnowledge?.getPrompt(workingDirectory)
          const projectMemoryPrompt = typeof result?.prompt === 'string' ? result.prompt.trim() : ''
          if (projectMemoryPrompt) memoryParts.push(projectMemoryPrompt)
        } catch (contextError) {
          console.warn('[ConversationView] Failed to load project knowledge prompt for team playbook', contextError)
        }
      }
      const suggestionMemory = formatProjectMemorySuggestionsForMarkdown(opsBrief.projectMemorySuggestions, '')
      if (opsBrief.projectMemorySuggestions.length > 0) memoryParts.push(`## 当前会话建议记忆\n${suggestionMemory}`)
      const memoryPrompt = filterProjectMemoryForPlaybook(memoryParts.join('\n\n'), template)
      recordProjectMemoryTelemetryEvent({
        sessionId,
        projectPath: workingDirectory,
        kind: 'playbook-memory-injected',
        playbookId: template.id,
        filteredLength: memoryPrompt.length,
        suggestionCount: opsBrief.projectMemorySuggestions.length,
      })
      setPendingInsert(buildTeamPlaybookPrompt(template, opsBrief, memoryPrompt))
      setQueueHintText(memoryPrompt
        ? `已筛选相关项目记忆，生成「${template.label}」团队模板`
        : `已生成「${template.label}」团队模板；当前没有可用项目记忆`)
      setQueueHintAction(null)
    } finally {
      setPlaybookActionLoading(null)
    }
  }, [opsBrief, playbookActionLoading, sessionId, workingDirectory])

  const handleExportTrustReport = useCallback((snapshot: OpsBriefSnapshot) => {
    const markdown = buildTrustReportMarkdown(snapshot)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadMarkdownFile(markdown, `prismops-trust-report-${getSafeReportFileName(snapshot.projectName)}-${timestamp}.md`)
    setQueueHintText('可信交付报告已导出为 Markdown')
    setQueueHintAction(null)
    void window.spectrAI.workingContext.addDecision(
      sessionId,
      `已导出可信交付报告：${snapshot.projectName}，${snapshot.deliveryReadiness}`,
    ).catch(error => {
      console.warn('[ConversationView] Failed to persist trust report export context', error)
    })
  }, [sessionId])

  const handleExtractProjectKnowledge = useCallback(async (snapshot: OpsBriefSnapshot) => {
    if (!snapshot.projectPath) {
      setQueueHintText('当前会话没有绑定项目目录，无法沉淀项目知识')
      setQueueHintAction(null)
      return
    }
    setTrustKnowledgeLoading(true)
    setQueueHintText('正在从当前会话沉淀项目知识...')
    setQueueHintAction(null)
    try {
      const result = await (window as any).spectrAI?.projectKnowledge?.extractFromSession(sessionId, snapshot.projectPath)
      if (!result?.success) {
        setQueueHintText(result?.error?.userMessage || result?.error?.message || result?.error || '项目知识沉淀失败')
        return
      }
      const count = result.count || 0
      const extracted = Array.isArray(result.extracted) ? result.extracted : []
      if (count > 0) {
        setKnowledgeExtractionCount(prev => prev + count)
      }
      setQueueHintText(count > 0
        ? `已沉淀 ${count} 条项目知识：${extracted.slice(0, 3).join('、') || '可在知识库查看'}`
        : snapshot.projectMemorySuggestions.length > 0
          ? `当前会话暂未自动提取到新知识；可先审核 ${snapshot.projectMemorySuggestions.length} 条建议记忆`
          : '当前会话暂未提取到新的项目知识')
      void window.spectrAI.workingContext.addDecision(
        sessionId,
        count > 0
          ? `已从当前会话沉淀 ${count} 条项目知识：${extracted.slice(0, 3).join('、') || snapshot.projectName}`
          : '已尝试从当前会话沉淀项目知识，暂未发现新增条目',
      ).catch(error => {
        console.warn('[ConversationView] Failed to persist project knowledge extraction context', error)
      })
    } catch (error: any) {
      setQueueHintText(error?.message || '项目知识沉淀失败')
    } finally {
      setTrustKnowledgeLoading(false)
    }
  }, [sessionId])

  const handleChangeMemorySuggestionDraft = useCallback((suggestionId: string, draft: ProjectMemorySuggestionDraft) => {
    setMemorySuggestionDrafts(prev => ({
      ...prev,
      [suggestionId]: draft,
    }))
  }, [])

  const handleStartEditMemorySuggestion = useCallback((suggestion: ProjectMemorySuggestion) => {
    setMemorySuggestionDrafts(prev => ({
      ...prev,
      [suggestion.id]: prev[suggestion.id] || {
        title: suggestion.title,
        content: suggestion.content,
      },
    }))
    setMemorySuggestionEditingId(suggestion.id)
  }, [])

  const handleCancelEditMemorySuggestion = useCallback(() => {
    setMemorySuggestionEditingId(null)
  }, [])

  const handleRejectMemorySuggestion = useCallback((suggestion: ProjectMemorySuggestion) => {
    const reviewedAt = new Date().toISOString()
    setMemorySuggestionReviews(prev => {
      const review: ProjectMemorySuggestionReview = {
        suggestionId: suggestion.id,
        status: 'rejected',
        reviewedAt,
        title: suggestion.title,
        content: suggestion.content,
      }
      const next = {
        ...prev,
        [suggestion.id]: review,
      }
      saveMemorySuggestionReviews(sessionId, next)
      return next
    })
    setMemorySuggestionEditingId(current => current === suggestion.id ? null : current)
    setQueueHintText(`已拒绝建议记忆：${suggestion.title}`)
    setQueueHintAction(null)
    recordProjectMemoryTelemetryEvent({
      sessionId,
      kind: 'suggestion-rejected',
      suggestionId: suggestion.id,
      confidence: suggestion.confidence,
    })
    void window.spectrAI.workingContext.addDecision(
      sessionId,
      `已拒绝建议记忆：${suggestion.title}；来源：${suggestion.sourceReference}`,
    ).catch(error => {
      console.warn('[ConversationView] Failed to persist rejected memory suggestion context', error)
    })
  }, [sessionId])

  const handlePromoteMemorySuggestion = useCallback(async (suggestion: ProjectMemorySuggestion, snapshot: OpsBriefSnapshot) => {
    if (!snapshot.projectPath) {
      setQueueHintText('当前会话没有绑定项目目录，无法保存建议记忆')
      setQueueHintAction(null)
      return
    }

    const draft = memorySuggestionDrafts[suggestion.id]
    const title = (draft?.title || suggestion.title).trim()
    const content = (draft?.content || suggestion.content).trim()
    if (!title || !content) {
      setQueueHintText('建议记忆需要标题和内容后才能保存')
      setQueueHintAction(null)
      return
    }

    const edited = Boolean(draft && (draft.title.trim() !== suggestion.title || draft.content.trim() !== suggestion.content))
    const status = edited ? 'edited' : 'accepted'
    const reviewedAt = new Date().toISOString()

    setMemorySuggestionSavingId(suggestion.id)
    setQueueHintText('正在将建议记忆保存到项目知识...')
    setQueueHintAction(null)
    try {
      const entry = await createKnowledgeEntry(buildProjectMemorySuggestionKnowledgeParams(suggestion, {
        projectPath: snapshot.projectPath,
        sessionId,
        title,
        content,
        status,
        reviewedAt,
      }))

      if (!entry) {
        setQueueHintText('建议记忆保存失败，请打开知识中心检查后重试')
        return
      }

      setMemorySuggestionReviews(prev => {
        const review: ProjectMemorySuggestionReview = {
          suggestionId: suggestion.id,
          status,
          reviewedAt,
          promotedKnowledgeId: entry.id,
          title,
          content,
        }
        const next = {
          ...prev,
          [suggestion.id]: review,
        }
        saveMemorySuggestionReviews(sessionId, next)
        return next
      })
      setMemorySuggestionEditingId(current => current === suggestion.id ? null : current)
      setKnowledgeExtractionCount(prev => prev + 1)
      setQueueHintText(`${status === 'edited' ? '已编辑并沉淀' : '已沉淀'}建议记忆：${title}`)
      recordProjectMemoryTelemetryEvent({
        sessionId,
        projectPath: snapshot.projectPath,
        kind: status === 'edited' ? 'suggestion-edited' : 'suggestion-accepted',
        suggestionId: suggestion.id,
        confidence: suggestion.confidence,
      })
      void window.spectrAI.workingContext.addDecision(
        sessionId,
        `${status === 'edited' ? '已编辑并沉淀' : '已沉淀'}建议记忆到项目知识：${title}；来源：${suggestion.sourceReference}`,
      ).catch(error => {
        console.warn('[ConversationView] Failed to persist promoted memory suggestion context', error)
      })
    } catch (error: any) {
      setQueueHintText(error?.message || '建议记忆保存失败')
    } finally {
      setMemorySuggestionSavingId(null)
    }
  }, [createKnowledgeEntry, memorySuggestionDrafts, sessionId])

  const handleResolveStaleMemoryCandidate = useCallback(async (
    candidate: ProjectMemoryStaleCandidate,
    action: StaleMemoryResolutionAction,
    snapshot: OpsBriefSnapshot,
  ) => {
    const entry = knowledgeEntries.find(item => item.id === candidate.entryId)
    const suggestion = snapshot.projectMemorySuggestions.find(item => item.id === candidate.suggestionId)
    if (!entry || !suggestion) {
      setQueueHintText('未找到要处理的项目知识或新证据，请刷新后重试')
      setQueueHintAction(null)
      return
    }

    const reviewedAt = new Date().toISOString()
    setStaleMemorySavingId(candidate.entryId)
    setQueueHintText(action === 'refresh' ? '正在用新证据更新旧项目知识...' : '正在归档旧项目知识...')
    setQueueHintAction(null)

    try {
      const ok = action === 'refresh'
        ? await updateKnowledgeEntry(candidate.entryId, {
          category: suggestion.knowledgeCategory,
          title: suggestion.title,
          content: suggestion.content,
          tags: [...new Set([...entry.tags, ...suggestion.tags, 'stale-reviewed', 'refreshed-memory'])],
          priority: suggestion.priority,
          autoInject: suggestion.priority === 'high',
          metadata: {
            ...(entry.metadata || {}),
            staleReview: {
              action: 'refresh',
              reviewedAt,
              sourceSuggestionId: suggestion.id,
              sourceReference: suggestion.sourceReference,
              reason: candidate.reason,
              score: candidate.score,
            },
          },
        })
        : await updateKnowledgeEntry(candidate.entryId, {
          autoInject: false,
          tags: [...new Set([...entry.tags, 'stale-reviewed', 'archived-memory'])],
          metadata: {
            ...(entry.metadata || {}),
            staleReview: {
              action: 'archive',
              reviewedAt,
              sourceSuggestionId: suggestion.id,
              sourceReference: suggestion.sourceReference,
              reason: candidate.reason,
              score: candidate.score,
            },
            archivedAt: reviewedAt,
            archivedReason: candidate.reason,
          },
        })

      if (!ok) {
        setQueueHintText('陈旧记忆处理失败，请打开知识中心检查后重试')
        return
      }

      recordProjectMemoryTelemetryEvent({
        sessionId,
        projectPath: snapshot.projectPath,
        kind: action === 'refresh' ? 'stale-memory-updated' : 'stale-memory-archived',
        suggestionId: suggestion.id,
        confidence: suggestion.confidence,
      })
      setQueueHintText(action === 'refresh'
        ? `已用新证据更新项目知识：${suggestion.title}`
        : `已归档旧项目知识并关闭自动注入：${entry.title}`)
      void window.spectrAI.workingContext.addDecision(
        sessionId,
        action === 'refresh'
          ? `已用新证据更新陈旧项目知识：${entry.title} -> ${suggestion.title}；原因：${candidate.reason}`
          : `已归档陈旧项目知识并关闭自动注入：${entry.title}；原因：${candidate.reason}`,
      ).catch(error => {
        console.warn('[ConversationView] Failed to persist stale memory review context', error)
      })
    } catch (error: any) {
      setQueueHintText(error?.message || '陈旧记忆处理失败')
    } finally {
      setStaleMemorySavingId(null)
    }
  }, [knowledgeEntries, sessionId, updateKnowledgeEntry])

  const handleResolveStaleMemoryCandidates = useCallback(async (
    candidates: ProjectMemoryStaleCandidate[],
    action: StaleMemoryResolutionAction,
    snapshot: OpsBriefSnapshot,
  ) => {
    const uniqueCandidates = [...new Map(candidates.map(candidate => [candidate.entryId, candidate])).values()]
    if (uniqueCandidates.length === 0) return

    setStaleMemorySavingId(`bulk-${action}`)
    setQueueHintText(action === 'refresh' ? '正在批量更新旧项目知识...' : '正在批量归档旧项目知识...')
    setQueueHintAction(null)

    let completed = 0
    let skipped = 0

    try {
      for (const candidate of uniqueCandidates) {
        const entry = knowledgeEntries.find(item => item.id === candidate.entryId)
        const suggestion = snapshot.projectMemorySuggestions.find(item => item.id === candidate.suggestionId)
        if (!entry || !suggestion) {
          skipped += 1
          continue
        }

        const reviewedAt = new Date().toISOString()
        const ok = action === 'refresh'
          ? await updateKnowledgeEntry(candidate.entryId, {
            category: suggestion.knowledgeCategory,
            title: suggestion.title,
            content: suggestion.content,
            tags: [...new Set([...entry.tags, ...suggestion.tags, 'stale-reviewed', 'refreshed-memory', 'bulk-reviewed'])],
            priority: suggestion.priority,
            autoInject: suggestion.priority === 'high',
            metadata: {
              ...(entry.metadata || {}),
              staleReview: {
                action: 'refresh',
                reviewedAt,
                sourceSuggestionId: suggestion.id,
                sourceReference: suggestion.sourceReference,
                reason: candidate.reason,
                score: candidate.score,
                mode: 'bulk',
              },
            },
          })
          : await updateKnowledgeEntry(candidate.entryId, {
            autoInject: false,
            tags: [...new Set([...entry.tags, 'stale-reviewed', 'archived-memory', 'bulk-reviewed'])],
            metadata: {
              ...(entry.metadata || {}),
              staleReview: {
                action: 'archive',
                reviewedAt,
                sourceSuggestionId: suggestion.id,
                sourceReference: suggestion.sourceReference,
                reason: candidate.reason,
                score: candidate.score,
                mode: 'bulk',
              },
              archivedAt: reviewedAt,
              archivedReason: candidate.reason,
            },
          })

        if (!ok) {
          skipped += 1
          continue
        }

        completed += 1
        recordProjectMemoryTelemetryEvent({
          sessionId,
          projectPath: snapshot.projectPath,
          kind: action === 'refresh' ? 'stale-memory-updated' : 'stale-memory-archived',
          suggestionId: suggestion.id,
          confidence: suggestion.confidence,
        })
      }

      setQueueHintText(action === 'refresh'
        ? `已批量用新证据更新 ${completed} 条旧项目知识${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`
        : `已批量归档 ${completed} 条旧项目知识${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`)
      void window.spectrAI.workingContext.addDecision(
        sessionId,
        action === 'refresh'
          ? `已批量用新证据更新陈旧项目知识：${completed} 条；跳过：${skipped} 条`
          : `已批量归档陈旧项目知识并关闭自动注入：${completed} 条；跳过：${skipped} 条`,
      ).catch(error => {
        console.warn('[ConversationView] Failed to persist bulk stale memory review context', error)
      })
    } catch (error: any) {
      setQueueHintText(error?.message || '批量陈旧记忆处理失败')
    } finally {
      setStaleMemorySavingId(null)
    }
  }, [knowledgeEntries, sessionId, updateKnowledgeEntry])

  const handleChangeTrustPolicyPreset = useCallback((presetId: TrustPolicyPresetId) => {
    const normalized = normalizeTrustPolicyPresetId(presetId)
    const scopeKey = getTrustPolicyScopeKey(workingDirectory, sessionId)
    setTrustPolicyOverrides(prev => {
      const next = { ...prev }
      if (normalized === 'auto') {
        delete next[scopeKey]
      } else {
        next[scopeKey] = normalized
      }
      saveTrustPolicyOverrides(next)
      return next
    })
    setQueueHintText(`权限策略预设已切换为：${getTrustPolicyOptionLabel(normalized)}`)
    setQueueHintAction(null)
    void window.spectrAI.workingContext.addDecision(
      sessionId,
      `权限策略预设切换为：${getTrustPolicyOptionLabel(normalized)}`,
    ).catch(error => {
      console.warn('[ConversationView] Failed to persist trust policy context', error)
    })
  }, [sessionId, workingDirectory])

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
    <div className="conversation-shell relative flex flex-row flex-1 min-h-0 overflow-hidden">
      {/* 左侧：消息区域 */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        {/* 消息列表 */}
        <div
          ref={scrollRef}
          className="conversation-canvas flex-1 overflow-y-auto px-4 py-4 pb-8 smooth-scroll scroll-optimized md:px-7 lg:px-10"
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
              className="absolute top-3 right-4 z-10 flex items-center gap-1.5 rounded-md bg-bg-elevated/90 px-2.5 py-1.5 text-xs text-text-secondary shadow-sm transition-colors hover:bg-bg-hover hover:text-accent-purple"
            >
              <BookMarked className="w-3.5 h-3.5 transition-all duration-300 hover:rotate-12" />
              <span>知识库</span>
            </button>
          )}
          <div className="mx-auto max-w-[1040px]">
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
              <MissionLaunchpad
                providerId={providerId}
                sessionId={sessionId}
                workingDirectory={workingDirectory}
                canSend={canSend}
                onInsertPrompt={setPendingInsert}
              />
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
                      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border-subtle/70 to-border-subtle/25" />
                      <span className="text-[10px] text-text-muted">{timeLabel}</span>
                      <div className="h-px flex-1 bg-gradient-to-r from-border-subtle/25 via-border-subtle/70 to-transparent" />
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

        {completionSummary && !isStreaming && (
          <CompletionHandoff
            summary={completionSummary}
            sessionId={sessionId}
            sessionName={session?.name || session?.config?.name || '当前会话'}
            workingDirectory={workingDirectory}
            onInsertPrompt={setPendingInsert}
          />
        )}

        {messages.length > 0 && (
          <OpsBrief
            snapshot={opsBrief}
            onInsertPrompt={setPendingInsert}
            onInsertPlaybook={handleInsertTeamPlaybook}
            onExportTrustReport={handleExportTrustReport}
            onExtractProjectKnowledge={handleExtractProjectKnowledge}
            onPromoteMemorySuggestion={handlePromoteMemorySuggestion}
            onRejectMemorySuggestion={handleRejectMemorySuggestion}
            onStartEditMemorySuggestion={handleStartEditMemorySuggestion}
            onCancelEditMemorySuggestion={handleCancelEditMemorySuggestion}
            onChangeMemorySuggestionDraft={handleChangeMemorySuggestionDraft}
            onResolveStaleMemoryCandidate={handleResolveStaleMemoryCandidate}
            onResolveStaleMemoryCandidates={handleResolveStaleMemoryCandidates}
            onChangeTrustPolicyPreset={handleChangeTrustPolicyPreset}
            onOpenKnowledge={() => setKnowledgePanelOpen(true)}
            onRunShipPlan={handleRunShipPlan}
            onGenerateShipSummary={handleGenerateShipSummary}
            canOpenKnowledge={!!workingDirectory}
            shipActionLoading={shipActionLoading}
            playbookActionLoading={playbookActionLoading}
            trustKnowledgeLoading={trustKnowledgeLoading}
            memorySuggestionReviews={memorySuggestionReviews}
            memorySuggestionDrafts={memorySuggestionDrafts}
            memorySuggestionEditingId={memorySuggestionEditingId}
            memorySuggestionSavingId={memorySuggestionSavingId}
            staleMemorySavingId={staleMemorySavingId}
            expanded={opsBriefExpanded}
            onToggleExpanded={() => setOpsBriefExpanded(expanded => !expanded)}
          />
        )}

        {/* 流式响应指示器 - 带实时计时器 + 渐变扫光动画 */}
        {isStreaming && (
          <div className="mb-6 flex justify-start animate-fade-in">
            <div className="relative max-w-[min(980px,92%)] py-2 pl-6 pr-3 text-sm text-text-muted">
              <span className="absolute bottom-0 left-0 top-0 w-px bg-accent-blue/25" aria-hidden="true" />
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
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary shadow-sm transition-colors hover:text-accent-blue"
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
              className="flex items-center gap-1.5 rounded-full bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary shadow-sm transition-all hover:bg-accent-red/10 hover:text-accent-red"
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
        <div className="input-dock relative px-3 pt-1.5 pb-2.5 shadow-sm md:px-4">
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
            <div className="mx-auto mb-2 flex w-full max-w-[1080px] items-center gap-1.5 overflow-x-auto rounded-lg bg-bg-elevated/75 px-2.5 py-2 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                className="ml-auto flex h-6 flex-shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-bg-hover hover:text-accent-blue"
                title="管理常用提示词"
              >
                <Settings2 size={12} />
                管理
              </button>
            </div>
          )}

          {promptManagerOpen && (
            <div className="mx-auto mb-2 w-full max-w-[1080px] rounded-lg bg-bg-elevated/75 p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-secondary">管理常用提示词</span>
                <button
                  type="button"
                  onClick={resetCommonPrompts}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-hover hover:text-accent-blue"
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
                  className="rounded-lg bg-bg-primary/70 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue/45"
                />
                <input
                  value={promptDraft.text}
                  onChange={event => setPromptDraft(draft => ({ ...draft, text: event.target.value }))}
                  onKeyDown={event => {
                    if (event.key === 'Enter') addCommonPrompt()
                  }}
                  placeholder="提示词内容"
                  className="rounded-lg bg-bg-primary/70 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue/45"
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
                        setQueueHintAction(null)
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

          {queueHintText && queuedMessages.length === 0 && (
            <div className="px-4 pb-1">
              <div className="flex items-center justify-between gap-2 rounded-md bg-bg-elevated/75 px-2.5 py-1.5 text-xs text-text-secondary">
                <span className="min-w-0 flex-1 truncate">{queueHintText}</span>
                {queueHintAction === 'kanban' && (
                  <button
                    type="button"
                    onClick={handleOpenTaskBoard}
                    className="shrink-0 rounded-md bg-accent-blue/10 px-2 py-0.5 text-[11px] font-medium text-accent-blue transition-colors hover:bg-accent-blue/15"
                  >
                    查看任务
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setQueueHintText('')
                    setQueueHintAction(null)
                  }}
                  className="rounded p-0.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title="关闭提示"
                >
                  <X size={12} />
                </button>
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
        <div className="bg-bg-primary px-4 py-3 animate-fade-in shadow-[0_-1px_0_rgba(255,255,255,0.03)]">
          <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 rounded-lg bg-bg-elevated/75 px-3 py-2.5">
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
        <div className="absolute inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label="关闭知识中心"
            onClick={() => setKnowledgePanelOpen(false)}
            className="h-full flex-1 cursor-default bg-bg-primary/20"
          />
          <div className="h-full w-[min(440px,100%)] min-w-0 bg-bg-primary shadow-[-1px_0_0_rgba(255,255,255,0.035)] sm:min-w-[340px]">
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
