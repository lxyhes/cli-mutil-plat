export const DELIVERY_METRICS_EVENT = 'prismops-delivery-metrics-updated'
export const DELIVERY_ACTION_EVENT = 'prismops-delivery-action-queued'

const STORAGE_KEY = 'prismops-delivery-metrics-v1'
const ACTION_STORAGE_KEY = 'prismops-delivery-actions-v1'
const ACTION_LIFECYCLE_STORAGE_KEY = 'prismops-delivery-action-lifecycle-v1'
const STORAGE_SCHEMA = 'prismops.delivery-metrics'
const STORAGE_SCHEMA_VERSION = 1
const MAX_RECORDS = 120
const MAX_ACTION_LIFECYCLES = 160
const STALE_METRIC_HOURS = 24

export interface DeliveryMetricStorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface VersionedStorageEnvelope<T> {
  schema: typeof STORAGE_SCHEMA
  version: number
  updatedAt: string
  data: T
}

let storageAdapterOverride: DeliveryMetricStorageAdapter | null = null

export function configureDeliveryMetricStorageAdapter(adapter: DeliveryMetricStorageAdapter | null): void {
  storageAdapterOverride = adapter
}

export interface DeliveryMetricSnapshotRecord {
  sessionId: string
  projectName: string
  projectPath?: string
  updatedAt: string
  score: number
  deliveryPackGenerated: boolean
  changedFileCount: number
  validationCount: number
  validationStale?: boolean
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

export interface DeliveryMetricFreshness {
  state: 'empty' | 'fresh' | 'stale'
  meaningfulCount: number
  staleCount: number
  latestUpdatedAt?: string
  ageHours?: number
}

export interface DeliveryMetricActionItem {
  sessionId: string
  projectName: string
  score: number
  reason: string
  detail: string
  suggestedAction: string
  priority: 'high' | 'medium' | 'low'
  updatedAt: string
}

export interface PendingDeliveryMetricAction {
  actionId?: string
  sessionId: string
  prompt: string
  reason: string
  createdAt: string
}

export type DeliveryMetricActionLifecycleStatus = 'queued' | 'inserted' | 'sent' | 'completed' | 'abandoned'

export interface DeliveryMetricActionLifecycleRecord {
  id: string
  sessionId: string
  projectName: string
  reason: string
  suggestedAction: string
  priority: DeliveryMetricActionItem['priority']
  score: number
  status: DeliveryMetricActionLifecycleStatus
  createdAt: string
  updatedAt: string
  insertedAt?: string
  sentAt?: string
  completedAt?: string
  abandonedAt?: string
  clickCount: number
}

export interface DeliveryMetricActionLifecycleSummary {
  queued: number
  inserted: number
  sent: number
  completed: number
  abandoned: number
  active: number
}

function getDeliveryMetricStorageAdapter(): DeliveryMetricStorageAdapter | null {
  if (storageAdapterOverride) return storageAdapterOverride
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function dispatchDeliveryMetricEvent(eventName: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(eventName))
}

function isVersionedStorageEnvelope<T>(value: unknown): value is VersionedStorageEnvelope<T> {
  const envelope = value as VersionedStorageEnvelope<T>
  return Boolean(
    envelope &&
    envelope.schema === STORAGE_SCHEMA &&
    typeof envelope.version === 'number' &&
    'data' in envelope,
  )
}

function readStorageValue<T>(
  key: string,
  fallback: T,
  normalize: (value: unknown) => T,
): T {
  const adapter = getDeliveryMetricStorageAdapter()
  if (!adapter) return fallback

  try {
    const raw = adapter.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return normalize(isVersionedStorageEnvelope<T>(parsed) ? parsed.data : parsed)
  } catch {
    return fallback
  }
}

function writeStorageValue<T>(key: string, data: T): void {
  const adapter = getDeliveryMetricStorageAdapter()
  if (!adapter) return

  const envelope: VersionedStorageEnvelope<T> = {
    schema: STORAGE_SCHEMA,
    version: STORAGE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    data,
  }
  adapter.setItem(key, JSON.stringify(envelope))
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
  return readStorageValue(STORAGE_KEY, [], value => (
    Array.isArray(value)
      ? value.filter(isRecord).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      : []
  ))
}

export function recordDeliveryMetricSnapshot(snapshot: DeliveryMetricSnapshotRecord): void {
  try {
    const next = [
      snapshot,
      ...loadDeliveryMetricSnapshots().filter(item => item.sessionId !== snapshot.sessionId),
    ]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_RECORDS)
    writeStorageValue(STORAGE_KEY, next)
    completeResolvedDeliveryMetricActions(snapshot)
    dispatchDeliveryMetricEvent(DELIVERY_METRICS_EVENT)
  } catch {
    // Metrics are an enhancement; never block the conversation surface.
  }
}

function isLifecycleRecord(value: unknown): value is DeliveryMetricActionLifecycleRecord {
  const record = value as DeliveryMetricActionLifecycleRecord
  return Boolean(
    record &&
    typeof record.id === 'string' &&
    typeof record.sessionId === 'string' &&
    typeof record.reason === 'string' &&
    typeof record.status === 'string' &&
    typeof record.createdAt === 'string',
  )
}

function makeDeliveryActionFingerprint(sessionId: string, reason: string, suggestedAction: string): string {
  return `${sessionId}\n${reason}\n${suggestedAction}`
}

function makeDeliveryActionId(item: DeliveryMetricActionItem, createdAt: string): string {
  const source = makeDeliveryActionFingerprint(item.sessionId, item.reason, item.suggestedAction)
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0
  }
  return `delivery-action-${Math.abs(hash)}-${new Date(createdAt).getTime()}`
}

function isActiveLifecycleStatus(status: DeliveryMetricActionLifecycleStatus): boolean {
  return status === 'queued' || status === 'inserted' || status === 'sent'
}

export function loadDeliveryMetricActionLifecycles(): DeliveryMetricActionLifecycleRecord[] {
  return readStorageValue(ACTION_LIFECYCLE_STORAGE_KEY, [], value => (
    Array.isArray(value)
      ? value.filter(isLifecycleRecord).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      : []
  ))
}

function saveDeliveryMetricActionLifecycles(records: DeliveryMetricActionLifecycleRecord[]): void {
  try {
    const next = records
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_ACTION_LIFECYCLES)
    writeStorageValue(ACTION_LIFECYCLE_STORAGE_KEY, next)
    dispatchDeliveryMetricEvent(DELIVERY_ACTION_EVENT)
  } catch {
    // Action lifecycle tracking is best-effort only.
  }
}

export function summarizeDeliveryMetricActionLifecycles(
  records: DeliveryMetricActionLifecycleRecord[],
): DeliveryMetricActionLifecycleSummary {
  const summary: DeliveryMetricActionLifecycleSummary = {
    queued: 0,
    inserted: 0,
    sent: 0,
    completed: 0,
    abandoned: 0,
    active: 0,
  }

  for (const record of records) {
    if (record.status in summary) {
      summary[record.status as DeliveryMetricActionLifecycleStatus] += 1
    }
    if (isActiveLifecycleStatus(record.status)) summary.active += 1
  }

  return summary
}

function updateLifecycleRecord(
  actionId: string | undefined,
  updater: (record: DeliveryMetricActionLifecycleRecord, now: string) => DeliveryMetricActionLifecycleRecord,
): void {
  if (!actionId) return
  const records = loadDeliveryMetricActionLifecycles()
  const now = new Date().toISOString()
  const next = records.map(record => record.id === actionId ? updater(record, now) : record)
  saveDeliveryMetricActionLifecycles(next)
}

export function markDeliveryMetricActionSent(actionId: string | undefined): void {
  updateLifecycleRecord(actionId, (record, now) => {
    if (!isActiveLifecycleStatus(record.status)) return record
    return {
      ...record,
      status: 'sent',
      sentAt: record.sentAt || now,
      updatedAt: now,
    }
  })
}

export function markDeliveryMetricActionAbandoned(actionId: string | undefined): void {
  updateLifecycleRecord(actionId, (record, now) => {
    if (!isActiveLifecycleStatus(record.status)) return record
    return {
      ...record,
      status: 'abandoned',
      abandonedAt: record.abandonedAt || now,
      updatedAt: now,
    }
  })
}

function completeResolvedDeliveryMetricActions(snapshot: DeliveryMetricSnapshotRecord): void {
  const records = loadDeliveryMetricActionLifecycles()
  const activeRecords = records.filter(record => record.sessionId === snapshot.sessionId && isActiveLifecycleStatus(record.status))
  if (activeRecords.length === 0) return
  if (buildActionItem(snapshot)) return

  const now = snapshot.updatedAt || new Date().toISOString()
  const next = records.map(record => {
    if (record.sessionId !== snapshot.sessionId || !isActiveLifecycleStatus(record.status)) return record
    return {
      ...record,
      status: 'completed' as const,
      completedAt: record.completedAt || now,
      updatedAt: now,
    }
  })
  saveDeliveryMetricActionLifecycles(next)
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0
}

function isMeaningfulMetricRecord(record: DeliveryMetricSnapshotRecord): boolean {
  return record.messageCount > 0 || record.toolCount > 0
}

export function getDeliveryMetricFreshness(
  records: DeliveryMetricSnapshotRecord[],
  nowMs = Date.now(),
  staleHours = STALE_METRIC_HOURS,
): DeliveryMetricFreshness {
  const meaningful = records.filter(isMeaningfulMetricRecord)
  if (meaningful.length === 0) {
    return {
      state: 'empty',
      meaningfulCount: 0,
      staleCount: 0,
    }
  }

  const staleCutoffMs = nowMs - staleHours * 60 * 60 * 1000
  let staleCount = 0
  let latest: { record: DeliveryMetricSnapshotRecord; timeMs: number } | undefined

  for (const record of meaningful) {
    const timeMs = new Date(record.updatedAt).getTime()
    if (!Number.isFinite(timeMs)) {
      staleCount += 1
      continue
    }

    if (timeMs < staleCutoffMs) staleCount += 1
    if (!latest || timeMs > latest.timeMs) latest = { record, timeMs }
  }

  const ageHours = latest
    ? Math.max(0, Math.round((nowMs - latest.timeMs) / (60 * 60 * 1000)))
    : undefined

  return {
    state: staleCount === meaningful.length ? 'stale' : 'fresh',
    meaningfulCount: meaningful.length,
    staleCount,
    latestUpdatedAt: latest?.record.updatedAt,
    ageHours,
  }
}

export function summarizeDeliveryMetrics(records: DeliveryMetricSnapshotRecord[]): DeliveryMetricSummary {
  const meaningful = records.filter(isMeaningfulMetricRecord)
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

function buildActionItem(record: DeliveryMetricSnapshotRecord): DeliveryMetricActionItem | null {
  const reasons: string[] = []
  const actions: string[] = []

  if (record.safetyStatus === 'blocked') {
    reasons.push('存在阻塞')
    actions.push('先复盘异常工具或错误状态')
  } else if (record.safetyStatus === 'warning') {
    reasons.push('安全状态待确认')
    actions.push('处理等待项并补齐风险说明')
  }

  if (record.changedFileCount > 0 && record.validationCount === 0) {
    reasons.push('缺少验证')
    actions.push('运行 typecheck、build 或相关测试')
  } else if (record.validationStale) {
    reasons.push('验证已过期')
    actions.push('对最新改动重新运行验证')
  }

  if (!record.deliveryPackGenerated && (record.changedFileCount > 0 || record.validationCount > 0)) {
    reasons.push('缺交付包')
    actions.push('生成 Markdown 交付包')
  }

  if (record.projectPath && record.projectMemoryCount === 0 && record.score >= 60) {
    reasons.push('未沉淀记忆')
    actions.push('把本次结论沉淀为项目知识')
  }

  if (record.score < 60 && reasons.length === 0) {
    reasons.push('综合分偏低')
    actions.push('补齐目标、证据、风险和下一步')
  }

  if (reasons.length === 0) return null

  const priority: DeliveryMetricActionItem['priority'] =
    record.safetyStatus === 'blocked' || (record.changedFileCount > 0 && record.validationCount === 0)
      ? 'high'
      : !record.deliveryPackGenerated || record.score < 75
        ? 'medium'
        : 'low'

  return {
    sessionId: record.sessionId,
    projectName: record.projectName,
    score: record.score,
    reason: reasons.slice(0, 2).join(' / '),
    detail: record.deliveryReadiness || record.phaseLabel || record.statusLabel,
    suggestedAction: actions.slice(0, 2).join('；'),
    priority,
    updatedAt: record.updatedAt,
  }
}

export function getDeliveryMetricActionItems(records: DeliveryMetricSnapshotRecord[], limit = 5): DeliveryMetricActionItem[] {
  const priorityWeight: Record<DeliveryMetricActionItem['priority'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  }

  return records
    .filter(isMeaningfulMetricRecord)
    .map(buildActionItem)
    .filter((item): item is DeliveryMetricActionItem => Boolean(item))
    .sort((a, b) => {
      const priorityDelta = priorityWeight[a.priority] - priorityWeight[b.priority]
      if (priorityDelta !== 0) return priorityDelta
      const scoreDelta = a.score - b.score
      if (scoreDelta !== 0) return scoreDelta
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
    .slice(0, limit)
}

function loadPendingActions(): Record<string, PendingDeliveryMetricAction> {
  return readStorageValue(ACTION_STORAGE_KEY, {}, value => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, PendingDeliveryMetricAction>
      : {}
  ))
}

function savePendingActions(actions: Record<string, PendingDeliveryMetricAction>): void {
  try {
    writeStorageValue(ACTION_STORAGE_KEY, actions)
    dispatchDeliveryMetricEvent(DELIVERY_ACTION_EVENT)
  } catch {
    // Action handoff is best-effort only.
  }
}

export function buildDeliveryMetricActionPrompt(item: DeliveryMetricActionItem): string {
  return [
    '请根据 Dashboard 改进队列处理当前会话的交付缺口。',
    '',
    `项目：${item.projectName}`,
    `当前分数：${item.score}`,
    `问题：${item.reason}`,
    `状态：${item.detail}`,
    `建议动作：${item.suggestedAction}`,
    '',
    '请按下面顺序执行：',
    '1. 先复述需要补齐的交付缺口。',
    '2. 如果缺少验证，运行最小必要的 typecheck/build/test；如果无法运行，说明原因和替代验证。',
    '3. 如果缺少交付包，整理变更、验证、风险和下一步，并生成可交付摘要。',
    '4. 如果缺少项目记忆，提炼可复用决策、风险或验证经验。',
    '5. 完成后给出验证结果、剩余风险和下一步。',
  ].join('\n')
}

export function queueDeliveryMetricAction(item: DeliveryMetricActionItem): void {
  const actions = loadPendingActions()
  const lifecycles = loadDeliveryMetricActionLifecycles()
  const now = new Date().toISOString()
  const fingerprint = makeDeliveryActionFingerprint(item.sessionId, item.reason, item.suggestedAction)
  const reusableLifecycle = lifecycles.find(record =>
    isActiveLifecycleStatus(record.status) &&
    makeDeliveryActionFingerprint(record.sessionId, record.reason, record.suggestedAction) === fingerprint,
  )
  const lifecycle: DeliveryMetricActionLifecycleRecord = reusableLifecycle
    ? {
        ...reusableLifecycle,
        projectName: item.projectName,
        priority: item.priority,
        score: item.score,
        status: 'queued',
        updatedAt: now,
        clickCount: reusableLifecycle.clickCount + 1,
      }
    : {
        id: makeDeliveryActionId(item, now),
        sessionId: item.sessionId,
        projectName: item.projectName,
        reason: item.reason,
        suggestedAction: item.suggestedAction,
        priority: item.priority,
        score: item.score,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        clickCount: 1,
      }

  saveDeliveryMetricActionLifecycles([
    lifecycle,
    ...lifecycles.filter(record => record.id !== lifecycle.id),
  ])

  actions[item.sessionId] = {
    actionId: lifecycle.id,
    sessionId: item.sessionId,
    prompt: buildDeliveryMetricActionPrompt(item),
    reason: item.reason,
    createdAt: now,
  }
  savePendingActions(actions)
}

export function consumePendingDeliveryMetricAction(sessionId: string): PendingDeliveryMetricAction | null {
  const actions = loadPendingActions()
  const action = actions[sessionId]
  if (!action) return null
  delete actions[sessionId]
  savePendingActions(actions)
  updateLifecycleRecord(action.actionId, (record, now) => {
    if (!isActiveLifecycleStatus(record.status)) return record
    return {
      ...record,
      status: 'inserted',
      insertedAt: record.insertedAt || now,
      updatedAt: now,
    }
  })
  return action
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

export function formatMetricAge(hours?: number): string {
  if (typeof hours !== 'number') return '未知'
  if (hours < 1) return '<1h'
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

const DM_DAY_MS = 24 * 60 * 60 * 1000

function dmClampHistoryDayCount(dayCount?: number): number {
  if (!dayCount || !Number.isFinite(dayCount)) return 14
  return Math.max(1, Math.min(30, Math.round(dayCount)))
}

function dmUtcDayStart(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
}

function dmDateKeyFromMs(value: number): string {
  return new Date(value).toISOString().slice(0, 10)
}

function dmShortDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${month}/${day}`
}

function dmProjectLabelFromPath(projectPath?: string): string {
  if (!projectPath) return 'Unscoped'
  const parts = projectPath.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || projectPath
}

export interface DeliveryMetricHistoryTrendPoint extends DeliveryMetricSummary {
  date: string
  label: string
}

export interface DeliveryMetricHistoryProjectReport extends DeliveryMetricSummary {
  projectPath?: string
  projectLabel: string
  lastActivityAt?: string
}

export interface DeliveryMetricHistoryReport {
  generatedAt: string
  dayCount: number
  total: DeliveryMetricSummary
  trend: DeliveryMetricHistoryTrendPoint[]
  projects: DeliveryMetricHistoryProjectReport[]
}

export interface DeliveryMetricHistoryOptions {
  dayCount?: number
  now?: Date | number
  projectLimit?: number
}

export function summarizeDeliveryMetricsHistory(
  records: DeliveryMetricSnapshotRecord[],
  options: DeliveryMetricHistoryOptions = {},
): DeliveryMetricHistoryReport {
  const dayCount = dmClampHistoryDayCount(options.dayCount)
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now())
  const endDayMs = dmUtcDayStart(Number.isFinite(now.getTime()) ? now : new Date())
  const startDayMs = endDayMs - (dayCount - 1) * DM_DAY_MS
  const endExclusiveMs = endDayMs + DM_DAY_MS
  const projectLimit = options.projectLimit ?? 5

  const meaningful = records.filter(isMeaningfulMetricRecord)
  const recentRecords = meaningful.filter(record => {
    const time = new Date(record.updatedAt).getTime()
    return Number.isFinite(time) && time >= startDayMs && time < endExclusiveMs
  })

  const trend = Array.from({ length: dayCount }, (_, index) => {
    const date = dmDateKeyFromMs(startDayMs + index * DM_DAY_MS)
    const dayRecords = recentRecords.filter(record => {
      const recordTime = new Date(record.updatedAt).getTime()
      return dmDateKeyFromMs(recordTime) === date
    })
    return {
      date,
      label: dmShortDateLabel(date),
      ...summarizeDeliveryMetrics(dayRecords),
    }
  })

  const projectGroups = new Map<string, DeliveryMetricSnapshotRecord[]>()
  for (const record of recentRecords) {
    const key = record.projectPath || 'unscoped'
    projectGroups.set(key, [...(projectGroups.get(key) || []), record])
  }

  const projects = [...projectGroups.entries()]
    .map(([key, projectRecords]) => {
      const latest = projectRecords
        .map(record => record.updatedAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      return {
        projectPath: key === 'unscoped' ? undefined : key,
        projectLabel: dmProjectLabelFromPath(key === 'unscoped' ? undefined : key),
        lastActivityAt: latest,
        ...summarizeDeliveryMetrics(projectRecords),
      }
    })
    .sort((a, b) => {
      if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
      return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
    })
    .slice(0, projectLimit)

  return {
    generatedAt: new Date(endDayMs).toISOString(),
    dayCount,
    total: summarizeDeliveryMetrics(recentRecords),
    trend,
    projects,
  }
}
