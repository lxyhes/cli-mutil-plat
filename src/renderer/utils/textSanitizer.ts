/**
 * 清洗终端/日志文本中的控制序列，避免 UI 出现乱码或异常空白。
 */
const KNOWN_MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u9234.?Codex .*?\(.*?\)/g, 'Codex 仍在处理中...'],
  [/\u6d60\u5d9d\u6e6a\u6f6a\u52d8\u608a/g, '仍在处理中'],
  [/\u5b38\u832c\u74d1\u5be4/g, '已等待'],
  [/\u95c8\u6b19\u9eef/g, '静默'],
  [/\u93b5\u0446[\uE000-\uF8FF]?/g, '执行'],
  [/Codex \u95bf\u6b12[\uE000-\uF8FF]?/g, 'Codex 错误'],
  [/\u93b5\u0446[\uE000-\uF8FF]?\u935b\u4ecb\u62a4\u95c7\u20ac\u7476\u4f7a\u5dff\u93c9.?/g, '执行命令需要授权'],
  [/\u6d7c\u6c33\u762d\u935a[\uE000-\uF8FF]?\u59e9\u6fca\u8fa9\u89e6/g, '会话启动失败'],
  [/\u935a\u5db6\u7d94\u6d93\u5d85\u5158\u6d93\u8679\u2536/g, '名称不能为空'],
  [/SDK V2 SessionManager \u93c8[\uE000-\uF8FF]?\u5d85\u6fee\u5b2a\u5be4/g, 'SDK V2 SessionManager 未初始化'],
  [/\u59af[\uE000-\uF8FF]?\u701b ID \u6d93\u5d85\u5158\u6d93\u8679\u2536/g, '模型 ID 不能为空'],
]

export function repairKnownMojibake(input: string): string {
  if (!input) return ''
  return KNOWN_MOJIBAKE_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    input,
  )
}

export function sanitizeDisplayText(input: string): string {
  if (!input) return ''

  return repairKnownMojibake(input
    // OSC: ESC ] ... BEL 或 ESC ] ... ST
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    // CSI: ESC [ ... finalByte
    .replace(/\x1B\[[\x20-\x3F]*[\x40-\x7E]/g, '')
    // 8-bit CSI
    .replace(/\x9B[\x20-\x3F]*[\x40-\x7E]/g, '')
    // DCS / APC / PM: ESC P/^/_ ... ST
    .replace(/\x1B(?:P|\^|_)[\s\S]*?\x1B\\/g, '')
    // 残留 ESC
    .replace(/\x1B/g, '')
    // 回车覆写：保留最后一次覆盖内容
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line
      const parts = line.split('\r').filter(Boolean)
      return parts[parts.length - 1] || ''
    })
    .join('\n')
    // 控制字符（保留 \n 与 \t）
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // 零宽字符
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // 压缩过量空行，避免出现超长“空白滚动区”
    .replace(/\n{3,}/g, '\n\n')
    .trim())
}
