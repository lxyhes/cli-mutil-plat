/**
 * Groups consecutive tool_use/tool_result messages into a calm, expandable row.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { ConversationMessage } from '../../../shared/types'
import ToolUseCard from './ToolUseCard'

interface ToolOperationGroupProps {
  messages: ConversationMessage[]
  isActive: boolean
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function summarizeTool(message?: ConversationMessage): string {
  if (!message) return ''
  const name = message.toolName || 'tool'
  const input = message.toolInput
  if (!input) return name
  if (input.file_path) return `${name} ${input.file_path}`
  if (input.command) return `${name} ${String(input.command).slice(0, 96)}`
  if (input.pattern) return `${name} pattern: ${input.pattern}`
  return `${name} ${message.content?.slice(0, 96) || ''}`.trim()
}

const ToolOperationGroup: React.FC<ToolOperationGroupProps> = ({ messages, isActive }) => {
  const [expanded, setExpanded] = useState(false)
  const [activeDurationSecs, setActiveDurationSecs] = useState(0)

  const { toolUseMessages, toolCounts, lastToolUse } = useMemo(() => {
    const toolUseMessages = messages.filter(m => m.role === 'tool_use')
    const toolCounts: Record<string, number> = {}
    for (const msg of toolUseMessages) {
      const name = msg.toolName || 'Tool'
      toolCounts[name] = (toolCounts[name] || 0) + 1
    }
    return {
      toolUseMessages,
      toolCounts,
      lastToolUse: toolUseMessages[toolUseMessages.length - 1],
    }
  }, [messages])

  const completedDuration = useMemo(() => {
    if (isActive || messages.length < 2) return null
    const start = new Date(messages[0].timestamp).getTime()
    const end = new Date(messages[messages.length - 1].timestamp).getTime()
    const ms = end - start
    return ms >= 100 ? formatDuration(ms) : null
  }, [messages, isActive])

  useEffect(() => {
    if (!isActive || messages.length === 0) return
    const start = new Date(messages[0].timestamp).getTime()
    const update = () => setActiveDurationSecs(Math.floor((Date.now() - start) / 1000))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [isActive, messages])

  const toolCount = toolUseMessages.length
  const hasError = messages.some(m => m.role === 'tool_result' && m.isError)
  const lastSummary = summarizeTool(lastToolUse)
  const statusLabel = hasError ? '执行异常' : isActive ? '正在执行' : '执行完成'

  return (
    <div
      className={`my-2 ml-8 mr-20 overflow-hidden rounded-lg border transition-colors ${
        isActive
          ? 'border-accent-purple/30 bg-bg-elevated shadow-[0_8px_22px_var(--color-shadow-sm)]'
          : hasError
            ? 'border-accent-red/35 bg-accent-red/10'
            : 'border-border-subtle bg-bg-elevated'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors hover:bg-bg-hover"
      >
        <span className="text-text-muted flex-shrink-0">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        {hasError ? (
          <AlertTriangle size={13} className="text-accent-red flex-shrink-0" />
        ) : isActive ? (
          <Loader2 size={13} className="text-accent-purple animate-spin flex-shrink-0" />
        ) : (
          <CheckCircle2 size={13} className="text-accent-green flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-text-primary flex-shrink-0">
          {statusLabel}
          <span className="text-text-muted font-normal">
            {` · ${toolCount} 个操作`}
            {isActive && activeDurationSecs > 0 ? ` · ${activeDurationSecs}s` : ''}
            {!isActive && completedDuration ? ` · ${completedDuration}` : ''}
          </span>
        </span>
        <span className="flex items-center gap-1.5 flex-shrink-0 overflow-hidden">
          {Object.entries(toolCounts).slice(0, 4).map(([name, count]) => (
            <span
              key={name}
              className="rounded border border-border-subtle bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
            >
              {name}({count})
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted/70 font-mono">
          {lastSummary}
        </span>
        {hasError && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-red/10 px-2 py-0.5 text-[10px] text-accent-red font-bold flex-shrink-0">
            <AlertTriangle size={11} /> ERROR
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border-subtle bg-bg-primary py-1.5">
          {messages.map(msg => (
            <ToolUseCard key={msg.id} message={msg} compact />
          ))}
        </div>
      )}
    </div>
  )
}

ToolOperationGroup.displayName = 'ToolOperationGroup'
export default React.memo(ToolOperationGroup)
