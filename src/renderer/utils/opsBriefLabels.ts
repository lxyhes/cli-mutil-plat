import type {
  ProjectMemorySuggestionReview,
} from './projectMemorySuggestions'

export type TrustSignalTone = 'good' | 'warn' | 'bad' | 'neutral'

export interface DeliveryMetric {
  status: 'passed' | 'warning' | 'blocked'
  label: string
  detail?: string
}

export function getTrustSignalClass(tone: TrustSignalTone): string {
  return {
    good: 'border-transparent bg-accent-green/5 text-accent-green',
    warn: 'border-transparent bg-accent-yellow/10 text-accent-yellow',
    bad: 'border-transparent bg-accent-red/10 text-accent-red',
    neutral: 'border-transparent bg-bg-primary/55 text-text-secondary',
  }[tone]
}

export function getDeliveryMetricClass(status: DeliveryMetric['status']): string {
  return {
    passed: 'border-transparent bg-accent-green/5 text-accent-green',
    warning: 'border-transparent bg-accent-yellow/10 text-accent-yellow',
    blocked: 'border-transparent bg-accent-red/10 text-accent-red',
  }[status]
}

export function getDeliveryMetricLabel(status: DeliveryMetric['status']): string {
  return {
    passed: '通过',
    warning: '待补齐',
    blocked: '阻塞',
  }[status]
}

export function getMemorySuggestionReviewLabel(review?: ProjectMemorySuggestionReview, editing = false): string {
  if (editing) return '编辑中'
  if (!review) return '待审核'
  return {
    accepted: '已沉淀',
    rejected: '已拒绝',
    edited: '已编辑沉淀',
  }[review.status]
}

export function getMemorySuggestionReviewClass(review?: ProjectMemorySuggestionReview, editing = false): string {
  if (editing) return 'bg-accent-blue/10 text-accent-blue'
  if (!review) return 'bg-bg-tertiary text-text-muted'
  return {
    accepted: 'bg-accent-green/10 text-accent-green',
    rejected: 'bg-accent-red/10 text-accent-red',
    edited: 'bg-accent-purple/10 text-accent-purple',
  }[review.status]
}
