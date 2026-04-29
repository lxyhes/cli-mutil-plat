import React from 'react'
import { FileText } from 'lucide-react'
import { formatTimelineTimestamp } from '../../utils/stringFormatters'
import {
  getEvidenceTimelineClass,
  getEvidenceTimelineLabel,
} from '../../utils/evidenceTimeline'
import type { EvidenceTimelineEntry } from './ConversationView'

interface EvidenceTimelinePanelProps {
  entries: EvidenceTimelineEntry[]
  totalCount: number
}

const EvidenceTimelinePanel = React.memo(function EvidenceTimelinePanel({
  entries,
  totalCount,
}: EvidenceTimelinePanelProps) {
  return (
    <div className="mt-3 rounded-md bg-bg-primary/28 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-accent-blue" />
          <span className="text-xs font-semibold text-text-secondary">证据时间线</span>
          <span className="rounded-md bg-bg-primary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            {totalCount} 条
          </span>
        </div>
      </div>
      {entries.length > 0 ? (
        <div className="grid gap-1.5 md:grid-cols-2">
          {entries.map(item => {
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
  )
})

export default EvidenceTimelinePanel
