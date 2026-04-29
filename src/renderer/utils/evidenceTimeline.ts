export type EvidenceTimelineTone = 'good' | 'warn' | 'bad' | 'neutral'

export type EvidenceTimelineType = 'mission' | 'tool' | 'validation' | 'change' | 'risk' | 'handoff'

export function getEvidenceTimelineClass(tone: EvidenceTimelineTone): string {
  return {
    good: 'border-transparent bg-accent-green/5 text-accent-green',
    warn: 'border-transparent bg-accent-yellow/10 text-accent-yellow',
    bad: 'border-transparent bg-accent-red/10 text-accent-red',
    neutral: 'border-transparent bg-bg-tertiary text-text-secondary',
  }[tone]
}

export function getEvidenceTimelineLabel(type: EvidenceTimelineType): string {
  return {
    mission: '目标',
    tool: '工具',
    validation: '验证',
    change: '文件',
    risk: '风险',
    handoff: '交付',
  }[type]
}
