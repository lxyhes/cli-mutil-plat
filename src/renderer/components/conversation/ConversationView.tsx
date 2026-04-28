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
import { isPrimaryModifierPressed } from '../../utils/shortcut'


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
  readinessGates: DeliveryReadinessGate[]
}

interface DeliveryReadinessGate {
  id: string
  label: string
  detail: string
  status: 'passed' | 'warning' | 'blocked'
  prompt: string
}

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

interface MissionLaunchpadProps {
  providerId?: string
  sessionId: string
  workingDirectory?: string
  canSend: boolean
  onInsertPrompt: (text: string) => void
}

const COMMON_PROMPTS_STORAGE_KEY = 'prismops-common-prompts'

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
  blue: 'border-accent-blue/25 bg-accent-blue/5 text-accent-blue hover:border-accent-blue/45 hover:bg-accent-blue/10',
  green: 'border-accent-green/25 bg-accent-green/5 text-accent-green hover:border-accent-green/45 hover:bg-accent-green/10',
  yellow: 'border-accent-yellow/25 bg-accent-yellow/5 text-accent-yellow hover:border-accent-yellow/45 hover:bg-accent-yellow/10',
  purple: 'border-accent-purple/25 bg-accent-purple/5 text-accent-purple hover:border-accent-purple/45 hover:bg-accent-purple/10',
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

function buildDeliveryPackPrompt(snapshot: OpsBriefSnapshot): string {
  const changedFiles = snapshot.lastFiles.length > 0
    ? snapshot.lastFiles.map(file => `- ${file}`).join('\n')
    : '- 暂未识别到文件改动'
  const risks = snapshot.risks.map(risk => `- ${risk}`).join('\n')
  const evidence = snapshot.evidence.map(item => `- ${item}`).join('\n')
  const nextActions = snapshot.nextActions.map(action => `- ${action}`).join('\n')

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
    '## 输出要求',
    '- 先判断当前是否可以交付；如果不能，列出最小补齐动作并执行。',
    '- 如果涉及代码改动，运行必要的 typecheck/test/build 或说明为什么无法运行。',
    '- 最后输出：变更摘要、验证结果、剩余风险、建议提交说明、用户下一步。',
  ].filter(Boolean).join('\n')
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

function unwrapIpcData<T = any>(result: any): T | undefined {
  if (!result) return undefined
  if (result.success === false) return undefined
  return (result.data || result) as T
}

interface ConversationViewProps {
  sessionId: string
}

interface OpsBriefProps {
  snapshot: OpsBriefSnapshot
  onInsertPrompt: (text: string) => void
  onOpenKnowledge: () => void
  onRunShipPlan: () => void
  onGenerateShipSummary: () => void
  canOpenKnowledge: boolean
  shipActionLoading: 'run' | 'summary' | null
  expanded: boolean
  onToggleExpanded: () => void
}

const MissionLaunchpad = React.memo(function MissionLaunchpad({ providerId, sessionId, workingDirectory, canSend, onInsertPrompt }: MissionLaunchpadProps) {
  const projectName = getProjectName(workingDirectory)
  const providerColor = getProviderColor(providerId)

  return (
    <div className="mx-auto flex min-h-[420px] max-w-[920px] flex-col justify-center py-8 text-sm">
      <section className="border-b border-border-subtle pb-4">
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
            <span className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 font-mono text-xs text-text-muted">
              #{sessionId.slice(0, 8)}
            </span>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.35fr]">
        <section className="rounded-lg border border-border-subtle bg-bg-elevated p-4 shadow-sm">
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
          <div className="mt-4 border-t border-border-subtle pt-3">
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
              className={`min-h-[116px] rounded-lg border p-3 text-left shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${MISSION_TONE_CLASS[template.tone]}`}
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

      <section className="mt-5 grid gap-2 border-y border-border-subtle py-3 sm:grid-cols-4">
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
  onOpenKnowledge,
  onRunShipPlan,
  onGenerateShipSummary,
  canOpenKnowledge,
  shipActionLoading,
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

  return (
    <section className={`mb-4 overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated shadow-sm ${expanded ? 'mb-5' : ''}`}>
      <div className="flex min-w-0">
        <div className={`w-1.5 shrink-0 ${accentRailClass}`} />
        <div className={`min-w-0 flex-1 ${expanded ? 'px-4 py-3' : 'px-3 py-2.5'}`}>
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

          <div className="mt-3 flex items-center gap-1.5">
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
              <span className={openGateCount > 0 ? 'text-accent-yellow' : 'text-accent-green'}>
                {openGateCount > 0 ? `${openGateCount} 个门禁待处理` : '交付门禁通过'}
              </span>
            </div>
          )}

          {expanded && (
            <>
              <div className="mt-3 grid gap-x-4 gap-y-2 border-y border-border-subtle py-2 sm:grid-cols-2 lg:grid-cols-[auto_auto_auto_auto_1fr]">
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

              <div className="mt-3 rounded-lg border border-border-subtle bg-bg-primary/45 p-3">
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
                    onClick={() => onInsertPrompt(buildDeliveryPackPrompt(snapshot))}
                    className="rounded-md px-2 py-1 text-[11px] font-medium text-accent-green transition-colors hover:bg-accent-green/10"
                  >
                    生成交付包
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {snapshot.readinessGates.map(gate => {
                    const gateClass = gate.status === 'passed'
                      ? 'border-accent-green/20 bg-accent-green/5 text-accent-green'
                      : gate.status === 'blocked'
                        ? 'border-accent-red/25 bg-accent-red/10 text-accent-red'
                        : 'border-accent-yellow/25 bg-accent-yellow/10 text-accent-yellow'
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
                            {gate.status !== 'passed' && (
                              <button
                                type="button"
                                onClick={() => onInsertPrompt(buildGatePrompt(gate, snapshot))}
                                className="mt-2 rounded-md bg-bg-primary/70 px-2 py-0.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent-blue"
                              >
                                处理
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
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

                <div className="min-w-0 md:border-l md:border-border-subtle md:pl-4">
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

                <div className="min-w-0 md:border-l md:border-border-subtle md:pl-4">
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
            </>
          )}
        </div>
      </div>
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
  const scrollFrameRef = useRef<number | null>(null)

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
    let userGoal = ''
    let additions = 0
    let deletions = 0
    let failedToolCount = 0
    let messageCount = 0
    const uniqueFiles: string[] = []
    const seenFiles = new Set<string>()
    const toolUseMessages: ConversationMessage[] = []
    const commands: string[] = []
    const validationCommands: string[] = []

    for (const message of messages) {
      if ((message.role === 'user' || message.role === 'assistant')) {
        messageCount += 1
      }

      if (message.role === 'user' && message.content && !message.content.startsWith('\u25B6 /')) {
        userGoal = message.content
      }

      if (message.fileChange) {
        const filePath = message.fileChange.filePath
        if (filePath && !seenFiles.has(filePath)) {
          seenFiles.add(filePath)
          uniqueFiles.push(filePath)
        }
        additions += message.fileChange.additions || 0
        deletions += message.fileChange.deletions || 0
      }

      if (message.role === 'tool_use') {
        toolUseMessages.push(message)
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
    missionHealthScore = Math.max(5, Math.min(100, Math.round(missionHealthScore)))

    const missionHealthTone: OpsBriefSnapshot['missionHealthTone'] =
      status === 'error' || failedToolCount > 0 || missionHealthScore < 42
        ? 'bad'
        : hasWaitingAction || (uniqueFiles.length > 0 && validationCommands.length === 0) || missionHealthScore < 74
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
            : validationCommands.length > 0 && uniqueFiles.length > 0
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
        detail: validationCommands.length > 0
          ? `已看到 ${validationCommands.length} 条验证命令。`
          : uniqueFiles.length > 0
            ? '已有代码改动，但还没有看到 test/typecheck/build/lint 等验证命令。'
            : '还没有需要验证的代码改动。',
        status: validationCommands.length > 0 || uniqueFiles.length === 0 ? 'passed' : 'warning',
        prompt: '请为当前改动运行最小必要验证，优先选择 typecheck、相关测试或 build；如果无法运行，请说明原因和替代验证方式。',
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
        detail: validationCommands.length > 0 && uniqueFiles.length > 0 && failedToolCount === 0
          ? '已具备生成交付包的基础证据。'
          : '交付说明需要包含变更、验证、风险和下一步，当前证据仍需补齐。',
        status: validationCommands.length > 0 && uniqueFiles.length > 0 && failedToolCount === 0
          ? 'passed'
          : hasWaitingAction || failedToolCount > 0
            ? 'blocked'
            : 'warning',
        prompt: '请生成交付说明：变更摘要、验证结果、剩余风险、建议提交说明和用户下一步。若证据不足，请先补齐最小缺口。',
      },
    ]

    const hasMissionRisk = risks.some(risk => !risk.includes('暂无明显'))
    const primarySignal = compactText(hasMissionRisk ? risks[0] : nextActions[0], 54)

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
      lastFiles: uniqueFiles.slice(-3).map(getShortFileName),
      lastCommand: compactText(commands[commands.length - 1] || validationCommands[validationCommands.length - 1] || '', 92),
      phaseLabel,
      liveProgressText,
      nextActions,
      risks,
      evidence,
      readinessGates,
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
              className="absolute top-3 right-4 z-10 flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-elevated/95 px-2.5 py-1.5 text-xs text-text-secondary shadow-sm transition-colors hover:border-accent-purple/40 hover:bg-bg-hover hover:text-accent-purple"
            >
              <BookMarked className="w-3.5 h-3.5 transition-all duration-300 hover:rotate-12" />
              <span>知识库</span>
            </button>
          )}
          <div className="mx-auto max-w-[1040px]">
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
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary shadow-sm transition-colors hover:border-accent-blue/40 hover:text-accent-blue"
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
        <div className="input-dock relative border-t border-border-subtle px-3 pt-1.5 pb-2.5 shadow-sm md:px-4">
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
        <div className="absolute inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label="关闭知识中心"
            onClick={() => setKnowledgePanelOpen(false)}
            className="h-full flex-1 cursor-default bg-bg-primary/20"
          />
          <div className="h-full w-[min(440px,100%)] min-w-0 border-l border-border-subtle bg-bg-primary shadow-sm sm:min-w-[340px]">
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
