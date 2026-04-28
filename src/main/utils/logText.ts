let iconvLite: { encode: (value: string, encoding: string) => Buffer } | null = null

try {
  // iconv-lite is already present transitively and lets us recover UTF-8 text
  // that was accidentally decoded as GBK before it reached the logger.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  iconvLite = require('iconv-lite')
} catch {
  iconvLite = null
}

const MOJIBAKE_HINTS = [
  '浼氳瘽',
  '杩滅',
  '閮ㄧ讲',
  '鑷',
  '閰嶇疆',
  '绋',
  '涓存椂',
  '鐢熸垚',
  '缁ф壙',
  '鈥',
  '鈫',
  '锛',
  '銆',
  '€',
]

function mojibakeScore(text: string): number {
  return MOJIBAKE_HINTS.reduce((score, hint) => score + (text.includes(hint) ? 1 : 0), 0)
}

export function repairGbkMojibake(value: unknown): string {
  const text = String(value ?? '')
  if (!text || !iconvLite || mojibakeScore(text) === 0) return text

  try {
    const repaired = Buffer.from(iconvLite.encode(text, 'gbk')).toString('utf8')
    if (!repaired || repaired.includes('\uFFFD')) return text
    return mojibakeScore(repaired) < mojibakeScore(text) ? repaired : text
  } catch {
    return text
  }
}

export function toAsciiLogText(value: unknown): string {
  return repairGbkMojibake(value).replace(/[^\x20-\x7E]/g, (char) => {
    const codePoint = char.codePointAt(0) ?? 0
    return codePoint <= 0xffff
      ? `\\u${codePoint.toString(16).padStart(4, '0')}`
      : `\\u{${codePoint.toString(16)}}`
  })
}
