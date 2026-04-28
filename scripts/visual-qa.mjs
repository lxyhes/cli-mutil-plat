import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUTPUT_DIR = resolve(process.cwd(), 'docs', 'visual-qa')
const VIEWPORT = { width: 1440, height: 960 }

const palette = {
  shell: '#ffffff',
  page: '#f7f8fb',
  line: '#dfe5ee',
  subtle: '#edf2f7',
  text: '#26313f',
  muted: '#758293',
  blue: '#2f81f7',
  blueBg: '#f2f8ff',
  green: '#76b900',
  greenBg: '#f5fbef',
  yellow: '#d29922',
  yellowBg: '#fff8e8',
  red: '#d73a31',
  redBg: '#fff4f3',
  purple: '#8b5cf6',
  purpleBg: '#f7f2ff',
}

const scenarios = [
  buildDashboardEmpty(),
  buildDashboardActive(),
  buildCockpitCollapsed(),
  buildCockpitExpanded(),
]

await mkdir(OUTPUT_DIR, { recursive: true })

const results = []
for (const scenario of scenarios) {
  const svg = renderScenario(scenario)
  const output = resolve(OUTPUT_DIR, `${scenario.id}.svg`)
  await writeFile(output, svg, 'utf8')

  const checks = checkScenario(scenario)
  const passed = Object.values(checks).every(Boolean)
  results.push({
    id: scenario.id,
    title: scenario.title,
    output: `docs/visual-qa/${scenario.id}.svg`,
    passed,
    checks,
    metrics: scenario.metrics,
  })
  console.log(`[visual-qa] ${passed ? 'PASS' : 'FAIL'} ${scenario.id} -> docs/visual-qa/${scenario.id}.svg`)
  if (!passed) console.log(JSON.stringify({ checks, metrics: scenario.metrics }, null, 2))
}

await writeFile(resolve(OUTPUT_DIR, 'report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  viewport: VIEWPORT,
  mode: 'svg-fixture',
  passed: results.every(result => result.passed),
  results,
}, null, 2), 'utf8')

process.exit(results.every(result => result.passed) ? 0 : 1)

function buildDashboardEmpty() {
  const blocks = baseShell('Dashboard 空指标态')
  addTopbar(blocks, 'PrismOps Dashboard', '等待会话产生指标')
  addStats(blocks, 74, [
    ['总会话', '0', 'blue'],
    ['正在处理', '0', 'green'],
    ['等你继续', '0', 'yellow'],
    ['需要处理', '0', 'red'],
    ['已完成', '0', 'neutral'],
  ])
  addNotice(blocks, 176, '还没有可用交付指标。打开会话并产生工具、验证或交付包后，这里会开始统计。', 'blue')
  addMetrics(blocks, 236, [
    ['综合得分', '--', '安全会话 0%', 'neutral'],
    ['交付包率', '0%', '已导出交付包的会话占比', 'neutral'],
    ['验证覆盖', '0%', '代码改动会话中的验证占比', 'neutral'],
    ['平均交付', '暂无', '从任务开始到可交付证据', 'neutral'],
    ['项目记忆', '0', '已沉淀的复用知识条目', 'neutral'],
    ['阻塞会话', '0', '存在异常工具或错误状态', 'neutral'],
  ])
  addPanel(blocks, 32, 348, 820, 230, '活跃会话 (0)', ['暂无活跃会话'], 'neutral')
  addPanel(blocks, 876, 348, 412, 230, '用量统计', ['今日请求 0', 'Token 0', '平均耗时 暂无'], 'blue')
  addPanel(blocks, 32, 604, 1256, 260, '最近活动', ['暂无活动事件', '等待会话运行后生成可审计证据'], 'neutral')
  return finalizeScenario('dashboard-empty', 'Dashboard Empty Metrics', blocks)
}

function buildDashboardActive() {
  const blocks = baseShell('Dashboard 活跃指标态')
  addTopbar(blocks, 'PrismOps Dashboard', '3 个会话样本')
  addStats(blocks, 74, [
    ['总会话', '8', 'blue'],
    ['正在处理', '2', 'green'],
    ['等你继续', '3', 'yellow'],
    ['需要处理', '1', 'red'],
    ['已完成', '2', 'neutral'],
  ])
  addNotice(blocks, 176, '最近指标已更新，另有 1 个旧样本仅用于趋势参考。', 'blue')
  addMetrics(blocks, 236, [
    ['综合得分', '84', '安全会话 67%', 'green'],
    ['交付包率', '67%', '已导出交付包的会话占比', 'yellow'],
    ['验证覆盖', '100%', '代码改动会话中的验证占比', 'green'],
    ['平均交付', '18m', '从任务开始到可交付证据', 'green'],
    ['项目记忆', '6', '已沉淀的复用知识条目', 'green'],
    ['阻塞会话', '1', '存在异常工具或错误状态', 'red'],
  ])
  addPanel(blocks, 32, 348, 1256, 190, '改进队列 · 2 项处理中', [
    'spectrai-community · 验证已过期 / 缺交付包 · 分数 76',
    'go-debug-pro · 安全状态待确认 · 分数 64',
  ], 'yellow')
  addPanel(blocks, 32, 566, 820, 292, '活跃会话 (5)', [
    '团队模式 11:07 · 正在处理',
    '会话 15:28 · 等你继续',
    '会话 10:27 · 等你继续',
    '代码审查 · 已完成',
  ], 'blue')
  addPanel(blocks, 876, 566, 412, 292, '最近活动', [
    '17:58 Dashboard 生成改进动作',
    '17:59 会话插入修复提示',
    '18:02 构建验证通过',
  ], 'green')
  return finalizeScenario('dashboard-active', 'Dashboard Active Metrics And Action Queue', blocks)
}

function buildCockpitCollapsed() {
  const blocks = baseShell('Cockpit 折叠态')
  addTopbar(blocks, '会话 15:28 · spectrai-community', 'codex · 正在处理')
  addChatBubble(blocks, 48, 82, 250, '用户：继续', 'blue')
  addCockpitFrame(blocks, 184, '继续完成核心竞争力增强计划', '交付状态：继续收敛方案 · 主信号：可靠性与证据闭环', false)
  addProgress(blocks, 266, ['理解', '执行', '改动', '验证', '交付'])
  addMetrics(blocks, 330, [
    ['目标清晰', '通过', '已识别当前 Mission 的目标上下文', 'green'],
    ['验证证据', '通过', '已看到 3 条验证命令', 'green'],
    ['交付说明', '待补齐', '需要包含变更、验证、风险和下一步', 'yellow'],
  ], 3, 90)
  addChatBubble(blocks, 48, 520, 520, 'Codex：我会继续推进剩余的视觉 QA 检查。', 'neutral')
  addInputDock(blocks)
  return finalizeScenario('cockpit-collapsed', 'Conversation Cockpit Collapsed', blocks)
}

function buildCockpitExpanded() {
  const blocks = baseShell('Cockpit 展开态')
  addTopbar(blocks, '会话 15:28 · spectrai-community', 'codex · 验证中')
  addCockpitFrame(blocks, 74, '继续完成核心竞争力增强计划', '交付状态：正在验证 · 主信号：截图检查和报告可复用', true)
  addProgress(blocks, 156, ['理解', '执行', '改动', '验证', '交付'])
  addPanel(blocks, 104, 218, 380, 172, '团队模板', [
    'Bug 修复 · 复现根因',
    '功能交付 · 验收证据',
    'UI 打磨 · 层级效率',
    '发布检查 · 变更风险',
  ], 'blue')
  addPanel(blocks, 508, 218, 380, 172, '协作看板', [
    'Agent roadmap-risk · 已完成',
    'Agent technical-assets · 已完成',
    'Agent product-analysis · 已完成',
  ], 'purple')
  addPanel(blocks, 912, 218, 300, 172, '交付门禁', [
    '目标清晰 · 通过',
    '验证证据 · 通过',
    '异常清零 · 通过',
    '交付说明 · 待补齐',
  ], 'green')
  addPanel(blocks, 104, 420, 548, 200, '证据时间线', [
    '18:00 用户要求继续',
    '18:02 新增视觉 QA 脚本',
    '18:04 生成 Dashboard 快照',
    '18:05 生成 Cockpit 快照',
  ], 'yellow')
  addPanel(blocks, 676, 420, 536, 200, '组织可信层', [
    '审计线索 13 对话 / 27 工具',
    '权限策略：探索模式',
    '交付报告：待补齐',
  ], 'green')
  addInputDock(blocks)
  return finalizeScenario('cockpit-expanded', 'Conversation Cockpit Expanded', blocks)
}

function baseShell(label) {
  return [
    { kind: 'rect', x: 18, y: 18, w: 1404, h: 924, r: 10, fill: palette.shell, stroke: palette.line },
    { kind: 'text', x: 40, y: 918, text: label, size: 11, color: palette.muted, maxWidth: 260 },
  ]
}

function addTopbar(blocks, title, detail) {
  blocks.push({ kind: 'rect', x: 18, y: 18, w: 1404, h: 44, r: 10, fill: '#fbfcfe', stroke: palette.line })
  blocks.push({ kind: 'circle', x: 44, y: 40, radius: 5, fill: palette.green })
  blocks.push({ kind: 'text', x: 62, y: 44, text: title, size: 13, weight: 700, color: palette.text, maxWidth: 460 })
  blocks.push({ kind: 'text', x: 1110, y: 44, text: detail, size: 12, color: palette.muted, maxWidth: 260 })
}

function addStats(blocks, y, items) {
  addGrid(blocks, 32, y, 1256, 82, items, 5, ([label, value, tone], box) => {
    addCard(blocks, box.x, box.y, box.w, box.h, tone)
    blocks.push({ kind: 'text', x: box.x + 14, y: box.y + 34, text: value, size: 24, weight: 800, color: palette.text, maxWidth: box.w - 28 })
    blocks.push({ kind: 'text', x: box.x + 14, y: box.y + 58, text: label, size: 11, color: palette.muted, maxWidth: box.w - 28 })
  })
}

function addNotice(blocks, y, textValue, tone) {
  const toneColors = toneFor(tone)
  blocks.push({ kind: 'rect', x: 32, y, w: 1256, h: 42, r: 8, fill: toneColors.bg, stroke: toneColors.stroke })
  blocks.push({ kind: 'text', x: 48, y: y + 26, text: textValue, size: 12, color: palette.muted, maxWidth: 1180 })
}

function addMetrics(blocks, y, items, columns = 6, height = 92) {
  addGrid(blocks, 32, y, 1256, height, items, columns, ([label, value, detail, tone], box) => {
    addCard(blocks, box.x, box.y, box.w, box.h, tone)
    blocks.push({ kind: 'text', x: box.x + 12, y: box.y + 22, text: label, size: 11, color: palette.muted, maxWidth: box.w - 24 })
    blocks.push({ kind: 'text', x: box.x + 12, y: box.y + 50, text: value, size: 22, weight: 800, color: palette.text, maxWidth: box.w - 24 })
    blocks.push({ kind: 'text', x: box.x + 12, y: box.y + 73, text: detail, size: 10.5, color: palette.muted, maxWidth: box.w - 24 })
  })
}

function addPanel(blocks, x, y, w, h, title, items, tone) {
  addCard(blocks, x, y, w, h, tone)
  blocks.push({ kind: 'text', x: x + 14, y: y + 25, text: title, size: 13, weight: 700, color: palette.text, maxWidth: w - 28 })
  const itemTop = y + 44
  const rowHeight = Math.min(36, Math.max(28, (h - 58) / Math.max(items.length, 1)))
  for (const [index, item] of items.entries()) {
    const itemY = itemTop + index * rowHeight
    blocks.push({ kind: 'rect', x: x + 12, y: itemY, w: w - 24, h: rowHeight - 6, r: 6, fill: '#ffffff', stroke: palette.subtle })
    blocks.push({ kind: 'text', x: x + 24, y: itemY + 19, text: item, size: 11.5, color: palette.muted, maxWidth: w - 48 })
  }
}

function addCockpitFrame(blocks, y, title, detail, expanded) {
  blocks.push({ kind: 'rect', x: 96, y, w: 1136, h: expanded ? 600 : 300, r: 9, fill: '#ffffff', stroke: palette.line })
  blocks.push({ kind: 'rect', x: 96, y, w: 7, h: expanded ? 600 : 300, r: 4, fill: palette.green, stroke: palette.green })
  blocks.push({ kind: 'text', x: 126, y: y + 34, text: '任务驾驶舱 · spectrai-community', size: 11, color: palette.muted, maxWidth: 340 })
  blocks.push({ kind: 'text', x: 126, y: y + 58, text: title, size: 16, weight: 800, color: palette.text, maxWidth: 520 })
  blocks.push({ kind: 'text', x: 126, y: y + 80, text: detail, size: 11.5, color: palette.muted, maxWidth: 760 })
  blocks.push({ kind: 'pill', x: 1026, y: y + 24, w: 78, h: 26, text: expanded ? '可交付 91' : '可交付 88', tone: 'green' })
  blocks.push({ kind: 'pill', x: 1112, y: y + 24, w: 50, h: 26, text: expanded ? '展开' : '收起', tone: 'blue' })
}

function addProgress(blocks, y, items) {
  const startX = 126
  const gap = 8
  const width = 206
  for (const [index, item] of items.entries()) {
    const x = startX + index * (width + gap)
    blocks.push({ kind: 'circle', x: x + 8, y: y + 7, radius: 4, fill: index < 4 ? palette.green : '#cfd7e2' })
    blocks.push({ kind: 'line', x1: x + 18, y1: y + 7, x2: x + width, y2: y + 7, stroke: index < 4 ? '#cfe8bd' : palette.line })
    blocks.push({ kind: 'text', x: x + 2, y: y + 28, text: item, size: 11, color: palette.muted, maxWidth: width - 4 })
  }
}

function addChatBubble(blocks, x, y, w, textValue, tone) {
  const toneColors = toneFor(tone)
  blocks.push({ kind: 'rect', x, y, w, h: 42, r: 8, fill: toneColors.bg, stroke: toneColors.stroke })
  blocks.push({ kind: 'text', x: x + 14, y: y + 26, text: textValue, size: 12, color: palette.text, maxWidth: w - 28 })
}

function addInputDock(blocks) {
  blocks.push({ kind: 'rect', x: 18, y: 874, w: 1404, h: 68, r: 0, fill: '#fbfcfe', stroke: palette.line })
  blocks.push({ kind: 'rect', x: 76, y: 890, w: 1180, h: 36, r: 8, fill: '#ffffff', stroke: palette.line })
  blocks.push({ kind: 'text', x: 94, y: 913, text: '输入消息，Enter 发送，/ 查看命令，拖拽文件引用', size: 12, color: palette.muted, maxWidth: 720 })
  blocks.push({ kind: 'rect', x: 1272, y: 890, w: 36, h: 36, r: 8, fill: palette.blue, stroke: palette.blue })
  blocks.push({ kind: 'text', x: 1284, y: 914, text: '↑', size: 18, weight: 800, color: '#ffffff', maxWidth: 20 })
}

function addGrid(blocks, x, y, w, h, items, columns, renderItem) {
  const gap = 10
  const colWidth = (w - gap * (columns - 1)) / columns
  for (const [index, item] of items.entries()) {
    const col = index % columns
    const row = Math.floor(index / columns)
    renderItem(item, {
      x: x + col * (colWidth + gap),
      y: y + row * (h + gap),
      w: colWidth,
      h,
    })
  }
}

function addCard(blocks, x, y, w, h, tone = 'neutral') {
  const toneColors = toneFor(tone)
  blocks.push({ kind: 'rect', x, y, w, h, r: 8, fill: toneColors.bg, stroke: toneColors.stroke })
}

function toneFor(tone) {
  if (tone === 'blue') return { bg: palette.blueBg, stroke: '#bdd9fb', text: palette.blue }
  if (tone === 'green') return { bg: palette.greenBg, stroke: '#c8e4b6', text: palette.green }
  if (tone === 'yellow') return { bg: palette.yellowBg, stroke: '#f0d18e', text: palette.yellow }
  if (tone === 'red') return { bg: palette.redBg, stroke: '#f2b8b5', text: palette.red }
  if (tone === 'purple') return { bg: palette.purpleBg, stroke: '#d6c5fb', text: palette.purple }
  return { bg: '#fbfcfe', stroke: palette.line, text: palette.text }
}

function finalizeScenario(id, title, blocks) {
  const textBlocks = blocks.filter(block => block.kind === 'text' || block.kind === 'pill')
  const maxY = Math.max(...blocks.map(block => block.y ?? block.y1 ?? 0))
  const worstTextRatio = textBlocks.reduce((max, block) => {
    const width = block.kind === 'pill' ? block.w - 12 : block.maxWidth
    if (!width) return max
    return Math.max(max, estimateTextWidth(block.text, block.size || 12, block.weight) / width)
  }, 0)
  const colors = new Set(blocks.flatMap(block => [block.fill, block.stroke, block.color].filter(Boolean)))

  return {
    id,
    title,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    blocks,
    metrics: {
      blockCount: blocks.length,
      textCount: textBlocks.length,
      colorCount: colors.size,
      maxY,
      worstTextRatio: Number(worstTextRatio.toFixed(3)),
    },
  }
}

function checkScenario(scenario) {
  return {
    viewport: scenario.width === VIEWPORT.width && scenario.height === VIEWPORT.height,
    fitsOneScreen: scenario.metrics.maxY <= VIEWPORT.height - 28,
    textFits: scenario.metrics.worstTextRatio <= 1,
    visualDensity: scenario.metrics.blockCount >= 24,
    colorVariety: scenario.metrics.colorCount >= 8,
  }
}

function renderScenario(scenario) {
  const body = scenario.blocks.map(renderBlock).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scenario.width}" height="${scenario.height}" viewBox="0 0 ${scenario.width} ${scenario.height}" role="img" aria-label="${escapeXml(scenario.title)}">
  <rect width="100%" height="100%" fill="${palette.page}" />
${body}
</svg>
`
}

function renderBlock(block) {
  if (block.kind === 'rect') {
    return `  <rect x="${round(block.x)}" y="${round(block.y)}" width="${round(block.w)}" height="${round(block.h)}" rx="${block.r ?? 0}" fill="${block.fill}" stroke="${block.stroke || 'none'}" />`
  }
  if (block.kind === 'circle') {
    return `  <circle cx="${round(block.x)}" cy="${round(block.y)}" r="${block.radius}" fill="${block.fill}" />`
  }
  if (block.kind === 'line') {
    return `  <line x1="${round(block.x1)}" y1="${round(block.y1)}" x2="${round(block.x2)}" y2="${round(block.y2)}" stroke="${block.stroke}" stroke-width="1" />`
  }
  if (block.kind === 'pill') {
    const toneColors = toneFor(block.tone)
    return `  <rect x="${round(block.x)}" y="${round(block.y)}" width="${round(block.w)}" height="${round(block.h)}" rx="7" fill="${toneColors.bg}" stroke="${toneColors.stroke}" />
  <text x="${round(block.x + 10)}" y="${round(block.y + 17)}" font-size="11" font-weight="700" fill="${toneColors.text}">${escapeXml(fitText(block.text, block.w - 16, 11, 700))}</text>`
  }
  return `  <text x="${round(block.x)}" y="${round(block.y)}" font-size="${block.size || 12}" font-weight="${block.weight || 500}" fill="${block.color || palette.text}">${escapeXml(fitText(block.text, block.maxWidth || 200, block.size || 12, block.weight))}</text>`
}

function fitText(value, maxWidth, size, weight = 500) {
  const text = String(value)
  if (estimateTextWidth(text, size, weight) <= maxWidth) return text
  let next = text
  while (next.length > 1 && estimateTextWidth(`${next}...`, size, weight) > maxWidth) {
    next = next.slice(0, -1)
  }
  return `${next}...`
}

function estimateTextWidth(value, size = 12, weight = 500) {
  const weightFactor = Number(weight) >= 700 ? 1.06 : 1
  return Array.from(String(value)).reduce((sum, char) => {
    const code = char.codePointAt(0) || 0
    const unit = code > 255 ? 1.04 : /[A-Z0-9]/.test(char) ? 0.64 : 0.54
    return sum + unit * size * weightFactor
  }, 0)
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function round(value) {
  return Number(value).toFixed(1).replace(/\.0$/, '')
}
