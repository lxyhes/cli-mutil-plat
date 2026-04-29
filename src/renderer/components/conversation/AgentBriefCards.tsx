import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { getAgentStatusLabel } from '../../utils/agentLabels'
import type { OpsBriefAgent } from './ConversationView'

interface AgentBriefCardsProps {
  agents: OpsBriefAgent[]
}

const AgentBriefCards = React.memo(function AgentBriefCards({ agents }: AgentBriefCardsProps) {
  if (agents.length === 0) {
    return (
      <div className="rounded-md bg-bg-primary/45 px-3 py-2 text-[11px] leading-5 text-text-muted">
        当前会话还没有可见子 Agent。可以先生成分派提示，把剩余工作拆成明确 owner、文件边界和验收条件，再决定是否并行执行。
      </div>
    )
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {agents.slice(0, 4).map(agent => (
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
                  {agent.lastFiles.map((file: string) => (
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
  )
})

export default AgentBriefCards
