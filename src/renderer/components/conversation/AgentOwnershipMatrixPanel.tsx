import React from 'react'
import {
  getAgentMergeReadinessClass,
  getAgentMergeReadinessLabel,
} from '../../utils/agentLabels'
import type { AgentOwnershipLane } from './ConversationView'

interface AgentOwnershipMatrixPanelProps {
  lanes: AgentOwnershipLane[]
}

const AgentOwnershipMatrixPanel = React.memo(function AgentOwnershipMatrixPanel({
  lanes,
}: AgentOwnershipMatrixPanelProps) {
  if (lanes.length === 0) return null

  return (
    <div className="mb-2 rounded-md border border-border-subtle/70 bg-bg-primary/45 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-text-muted">
        <span>Ownership Matrix</span>
        <span>{lanes.length} owners</span>
      </div>
      <div className="grid gap-1.5 lg:grid-cols-2">
        {lanes.slice(0, 4).map(lane => (
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
              {lane.ownedFiles.length > 0 ? lane.ownedFiles.slice(0, 3).map((file: string) => (
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
            {lane.conflictDetail && (
              <div className="mt-1 truncate text-[10px] text-accent-yellow" title={lane.conflictDetail}>
                {lane.conflictDetail}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

export default AgentOwnershipMatrixPanel
