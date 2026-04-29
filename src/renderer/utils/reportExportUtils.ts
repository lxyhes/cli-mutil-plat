/**
 * 报告导出通用工具：下载、哈希、脱敏、文件名安全
 */

/** 触发 Markdown 文件下载 */
export function downloadMarkdownFile(markdown: string, fileName: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/** Compute a simple content hash for report signing / integrity verification */
export function computeReportHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/** Redact sensitive patterns from exported report content */
export function redactSensitiveContent(
  content: string,
  options?: { redactPaths?: boolean; redactCommands?: boolean; redactKeys?: boolean },
): string {
  let result = content
  if (options?.redactPaths) {
    // Redact absolute file system paths (keep file names)
    result = result.replace(/(?:[A-Za-z]:\\|\/)(?:[^\s\"'`<>`\n]*\\\/)+([^\s\"'`<>`\n]+)/g, (_match, filename) => `[REDACTED_PATH]/${filename}`)
  }
  if (options?.redactCommands) {
    // Redact command outputs that look like tokens/keys (base64-like strings > 24 chars)
    result = result.replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, '[REDACTED_TOKEN]')
    // Redact potential API keys
    result = result.replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, '[REDACTED_KEY]')
    result = result.replace(
      /\b([a-zA-Z0-9_-]*api[_-]?key[a-zA-Z0-9_-]*[:=]\s*)[^\s\n]+/gi,
      '$1[REDACTED_VALUE]',
    )
  }
  if (options?.redactKeys) {
    // Redact bearer/auth headers
    result = result.replace(/(Authorization[:\s]+Bearer\s+)[^\s\n]+/gi, '$1[REDACTED_BEARER]')
    result = result.replace(/(password[:=]\s*)[^\s\n]+/gi, '$1[REDACTED_PASSWORD]')
  }
  return result
}

/** 生成安全的文件报告文件名 */
export function getSafeReportFileName(value: string): string {
  return (
    value
      .replace(/[<>:\"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 72) || 'prismops'
  )
}
