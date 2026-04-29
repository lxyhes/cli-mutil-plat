/**
 * 字符串/文本格式化纯工具函数
 */

export function getProjectName(workingDirectory?: string, fallback?: string): string {
  const normalized = (workingDirectory || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || fallback || '未绑定项目'
}

export function getShortFileName(filePath: string): string {
  const normalized = (filePath || '').replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || filePath
}

export function compactText(value: string, max = 110): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

export function truncateLongText(value: string, max = 1800): string {
  const text = value.trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...已截断...`
}

export function formatMarkdownList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join('\n') : `- ${fallback}`
}

export function formatTimelineTimestamp(timestamp?: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function formatElapsedMinutes(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}

export function formatThinkingTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}
