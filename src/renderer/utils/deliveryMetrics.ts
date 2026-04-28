export const DELIVERY_METRICS_EVENT = 'prismops-delivery-metrics-updated'
export const DELIVERY_ACTION_EVENT = 'prismops-delivery-action-queued'

const STORAGE_KEY = 'prismops-delivery-metrics-v1'
const ACTION_STORAGE_KEY = 'prismops-delivery-actions-v1'
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
  sessionId: string
  prompt: string
  reason: string
  createdAt: string
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
    .filter(record => record.messageCount > 0 || record.toolCount > 0)
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
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(ACTION_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function savePendingActions(actions: Record<string, PendingDeliveryMetricAction>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTION_STORAGE_KEY, JSON.stringify(actions))
    window.dispatchEvent(new Event(DELIVERY_ACTION_EVENT))
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
  actions[item.sessionId] = {
    sessionId: item.sessionId,
    prompt: buildDeliveryMetricActionPrompt(item),
    reason: item.reason,
    createdAt: new Date().toISOString(),
  }
  savePendingActions(actions)
}

export function consumePendingDeliveryMetricAction(sessionId: string): PendingDeliveryMetricAction | null {
  const actions = loadPendingActions()
  const action = actions[sessionId]
  if (!action) return null
  delete actions[sessionId]
  savePendingActions(actions)
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
