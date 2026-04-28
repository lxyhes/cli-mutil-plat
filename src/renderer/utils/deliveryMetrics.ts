export const DELIVERY_METRICS_EVENT = 'prismops-delivery-metrics-updated'

const STORAGE_KEY = 'prismops-delivery-metrics-v1'
const MAX_RECORDS = 120

export interface DeliveryMetricSnapshotRecord {
  sessionId: string
  projectName: string
  projectPath?: string
  updatedAt: string
  score: number
  deliveryPackGenerated: boolean
  changedFileCount: number
  validationCount: number
  verifiedHandoffMinutes?: number
  projectMemoryCount: number
  safetyStatus: 'passed' | 'warning' | 'blocked'
  statusLabel: string
  phaseLabel: string
  deliveryReadiness: string
  messageCount: number
  toolCount: number
}

export interface DeliveryMetricSummary {
  sessionCount: number
  averageScore: number
  deliveryPackRate: number
  validationCoverageRate: number
  safeSessionRate: number
  averageHandoffMinutes?: number
  projectMemoryCount: number
  blockedCount: number
}

function isRecord(value: unknown): value is DeliveryMetricSnapshotRecord {
  const record = value as DeliveryMetricSnapshotRecord
  return Boolean(
    record &&
    typeof record.sessionId === 'string' &&
    typeof record.projectName === 'string' &&
    typeof record.updatedAt === 'string' &&
    typeof record.score === 'number',
  )
}

export function loadDeliveryMetricSnapshots(): DeliveryMetricSnapshotRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(isRecord).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      : []
  } catch {
    return []
  }
}

export function recordDeliveryMetricSnapshot(snapshot: DeliveryMetricSnapshotRecord): void {
  if (typeof window === 'undefined') return
  try {
    const next = [
      snapshot,
      ...loadDeliveryMetricSnapshots().filter(item => item.sessionId !== snapshot.sessionId),
    ]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_RECORDS)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(DELIVERY_METRICS_EVENT))
  } catch {
    // Metrics are an enhancement; never block the conversation surface.
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0
}

export function summarizeDeliveryMetrics(records: DeliveryMetricSnapshotRecord[]): DeliveryMetricSummary {
  const meaningful = records.filter(record => record.messageCount > 0 || record.toolCount > 0)
  const codeChanging = meaningful.filter(record => record.changedFileCount > 0)
  const verifiedHandoffs = meaningful
    .map(record => record.verifiedHandoffMinutes)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const averageHandoffMinutes = verifiedHandoffs.length > 0
    ? Math.round(verifiedHandoffs.reduce((sum, value) => sum + value, 0) / verifiedHandoffs.length)
    : undefined

  return {
    sessionCount: meaningful.length,
    averageScore: meaningful.length > 0
      ? Math.round(meaningful.reduce((sum, record) => sum + record.score, 0) / meaningful.length)
      : 0,
    deliveryPackRate: ratio(meaningful.filter(record => record.deliveryPackGenerated).length, meaningful.length),
    validationCoverageRate: ratio(codeChanging.filter(record => record.validationCount > 0).length, codeChanging.length),
    safeSessionRate: ratio(meaningful.filter(record => record.safetyStatus === 'passed').length, meaningful.length),
    averageHandoffMinutes,
    projectMemoryCount: meaningful.reduce((sum, record) => sum + record.projectMemoryCount, 0),
    blockedCount: meaningful.filter(record => record.safetyStatus === 'blocked').length,
  }
}

export function formatMetricPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`
}

export function formatMetricDuration(minutes?: number): string {
  if (typeof minutes !== 'number') return '暂无'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}
