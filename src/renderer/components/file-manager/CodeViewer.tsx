/**
 * Monaco Editor 封装组件
 * 展示文件内容，支持编辑和 Ctrl+S 保存
 * 主题动态跟随应用主题，读取 CSS 变量实现多主题适配
 * Markdown 文件支持编辑/预览切换
 * @author weibin
 */

import React, { useCallback, useEffect, useState, useMemo } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useFileTabStore } from '../../stores/fileTabStore'
import { useUIStore } from '../../stores/uiStore'
import { THEMES } from '../../../shared/constants'
import { Eye, Pencil, Sparkles } from 'lucide-react'
import type { Components } from 'react-markdown'

interface CodeViewerProps {
  /** 对应 FileTab 的 id */
  tabId: string
}

/** Markdown 预览的自定义组件 */
const mdComponents: Components = {
  h1: ({ children, ...rest }) => (
    <h1 id={(children as string)?.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')} {...rest}>
      {children}
    </h1>
  ),
  h2: ({ children, ...rest }) => (
    <h2 id={(children as string)?.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')} {...rest}>
      {children}
    </h2>
  ),
  h3: ({ children, ...rest }) => (
    <h3 id={(children as string)?.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')} {...rest}>
      {children}
    </h3>
  ),
  h4: ({ children, ...rest }) => (
    <h4 id={(children as string)?.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')} {...rest}>
      {children}
    </h4>
  ),
  h5: ({ children, ...rest }) => (
    <h5 id={(children as string)?.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')} {...rest}>
      {children}
    </h5>
  ),
  h6: ({ children, ...rest }) => (
    <h6 id={(children as string)?.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')} {...rest}>
      {children}
    </h6>
  ),
  code: ({ children, ...rest }) => (
    <code className="markdown-inline-code" {...rest}>
      {children}
    </code>
  ),
  pre: ({ children, ...rest }) => (
    <pre className="markdown-code-block" {...rest}>
      {children}
    </pre>
  ),
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      onClick={e => {
        e.preventDefault()
        window.spectrAI?.shell?.openExternal?.(href)
      }}
      className="markdown-link"
      {...rest}
    >
      {children}
    </a>
  ),
  table: ({ children, ...rest }) => (
    <div className="markdown-table-wrapper">
      <table className="markdown-table" {...rest}>
        {children}
      </table>
    </div>
  ),
}

/**
 * 自定义 rehype-highlight 配置
 * 避免 hljs 默认样式与自定义代码块样式冲突
 */
function highlightPlugin() {
  return (tree: any) => {
    // 移除 rehype-highlight 添加的 className，使用自定义样式
    const visit = (node: any, parent?: any) => {
      if (node.tagName === 'code' && parent?.tagName === 'pre') {
        // 移除 hljs 相关 class
        if (node.properties?.className) {
          node.properties.className = node.properties.className.filter((c: string) => !c.startsWith('hljs'))
        }
      }
      if (node.children) {
        for (const child of node.children) {
          visit(child, node)
        }
      }
    }
    visit(tree)
  }
}

/**
 * 规范化非标准 Markdown 表格语法
 * 将 || 双竖线表格转换为标准 GFM 单竖线格式
 * 例如: || 任务类型 | 推荐 Provider | 原因 ||
 * 转换: | 任务类型 | 推荐 Provider | 原因 |
 */
function normalizeMdTables(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 检测非标准表格行：以 || 开头（可能以 | 或 || 结尾）
    if (/^\s*\|\|/.test(line)) {
      // 收集表格所有行
      const tableLines: string[] = []
      while (i < lines.length && /^\s*\|\|/.test(lines[i])) {
        tableLines.push(lines[i])
        i++
      }

      // 转换：将开头的 || 替换为单个 |，结尾的 || 也替换为单个 |
      for (const tline of tableLines) {
        let normalized = tline.replace(/^\s*\|\|/, '|')
        // 处理结尾可能是 || 的情况
        if (/\|\|\s*$/.test(normalized)) {
          normalized = normalized.replace(/\|\|\s*$/, '|')
        }
        result.push(normalized)
      }
    } else {
      result.push(line)
      i++
    }
  }

  return result.join('\n')
}

/** 大纲条目 */
interface TocItem {
  id: string
  text: string
  level: number
}

/**
 * 从 Markdown 内容中提取标题，生成大纲（TOC）
 */
function extractToc(content: string): TocItem[] {
  const lines = content.split('\n')
  const toc: TocItem[] = []
  const idMap = new Map<string, number>()

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const rawText = match[2].trim()
      // 生成锚点 ID（与 react-markdown 默认行为一致）
      const baseId = rawText
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '')

      // 处理重复 ID
      const count = idMap.get(baseId) || 0
      const id = count === 0 ? baseId : `${baseId}-${count}`
      idMap.set(baseId, count + 1)

      toc.push({ id, text: rawText, level })
    }
  }

  return toc
}

/**
 * Markdown 大纲侧边栏组件
 */
function TocSidebar({ content }: { content: string }) {
  const toc = useMemo(() => extractToc(content), [content])
  const [activeId, setActiveId] = useState<string>('')

  // 点击大纲项滚动到对应标题
  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveId(id)
    }
  }

  // 监听滚动，高亮当前可见的标题
  useEffect(() => {
    const container = document.querySelector('.markdown-body')?.parentElement
    if (!container) return

    const handleScroll = () => {
      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
      let currentId = ''

      for (const heading of headings) {
        const rect = heading.getBoundingClientRect()
        if (rect.top <= 80) {
          currentId = heading.id
        }
      }

      if (currentId) {
        setActiveId(currentId)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  if (toc.length === 0) return null

  return (
    <div className="w-48 flex-shrink-0 border-l border-border bg-bg-secondary overflow-y-auto">
      <div className="p-3">
        <div className="text-xs font-medium text-text-muted mb-2">大纲</div>
        <nav className="space-y-0.5">
          {toc.map(item => (
            <button
              key={item.id}
              onClick={() => scrollToHeading(item.id)}
              className={`block w-full text-left text-xs py-1 px-2 rounded transition-colors truncate ${
                activeId === item.id
                  ? 'bg-accent-blue/20 text-accent-blue font-medium'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
              }`}
              style={{ paddingLeft: `${(item.level - 1) * 8 + 8}px` }}
              title={item.text}
            >
              {item.text}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

export default function CodeViewer({ tabId }: CodeViewerProps) {
  const { tabs, updateContent, saveTab } = useFileTabStore()
  const tab = tabs.find(t => t.id === tabId)
  const monaco = useMonaco()
  const currentTheme = useUIStore(s => s.theme)
  const isMd = tab?.language === 'markdown'
  const [isPreview, setIsPreview] = useState(false)

  // 每次 Monaco 实例就绪或应用主题变化时，重新注册并应用 Monaco 主题
  useEffect(() => {
    if (!monaco) return

    const style = getComputedStyle(document.documentElement)
    const get = (v: string) => style.getPropertyValue(v).trim()

    const themeConfig = THEMES[currentTheme]
    const isLight = themeConfig?.type === 'light'

    monaco.editor.defineTheme('spectrai-dynamic', {
      base: isLight ? 'vs' : 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background':                  get('--color-bg-primary'),
        'editor.foreground':                  get('--color-text-primary'),
        'editor.lineHighlightBackground':     get('--color-bg-secondary') + '80',
        'editorGutter.background':            get('--color-bg-primary'),
        'editorLineNumber.foreground':        get('--color-text-muted'),
        'editorLineNumber.activeForeground':  get('--color-text-secondary'),
        'editorCursor.foreground':            get('--color-accent-blue'),
        'minimap.background':                 get('--color-bg-primary'),
        'editorOverviewRuler.background':     get('--color-bg-primary'),
        'editorOverviewRuler.border':         get('--color-bg-primary'),
        'scrollbar.shadow':                   '#00000000',
        'scrollbarSlider.background':         get('--color-border') + '50',
        'scrollbarSlider.hoverBackground':    get('--color-border'),
        'scrollbarSlider.activeBackground':   get('--color-bg-hover'),
        'editor.selectionBackground':         get('--color-accent-blue') + '40',
        'editor.inactiveSelectionBackground': get('--color-accent-blue') + '20',
        'editorWidget.background':            get('--color-bg-secondary'),
        'editorWidget.border':                get('--color-border'),
        'input.background':                   get('--color-bg-primary'),
        'input.border':                       get('--color-border'),
        'focusBorder':                        get('--color-accent-blue'),
      },
    })
    monaco.editor.setTheme('spectrai-dynamic')
  }, [monaco, currentTheme])

  // 编辑器内容变化
  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) updateContent(tabId, value)
  }, [tabId, updateContent])

  // 捕获 Ctrl+S / Cmd+S 保存
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveTab(tabId)
    }
  }, [tabId, saveTab])

  // Markdown 切换预览：Ctrl/Cmd + Shift + P
  useEffect(() => {
    if (!isMd) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setIsPreview(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMd])

  if (!tab) return null

  // ── 加载中 ────────────────────────────────────────────
  if (tab.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary text-sm">
        加载中...
      </div>
    )
  }

  // ── 加载失败 ──────────────────────────────────────────
  if (tab.error) {
    return (
      <div className="h-full flex items-center justify-center text-accent-red text-sm px-8 text-center">
        加载失败：{tab.error}
      </div>
    )
  }

  // ── Monaco Editor ────────────────────────────────────
  return (
    <div className="h-full flex flex-col" onKeyDown={handleKeyDown}>
      {/* 工具栏：Markdown 文件显示预览切换按钮 + AI 上下文注入 */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-bg-primary">
        {isMd && (
          <button
            onClick={() => setIsPreview(v => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              isPreview
                ? 'bg-accent-blue/20 text-accent-blue'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-secondary'
            }`}
            title="Ctrl+Shift+P 切换预览"
          >
            {isPreview ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {isPreview ? '编辑' : '预览'}
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={async () => {
            if (!tab) return
            const result = await window.spectrAI?.codeContext?.getModes()
            if (result?.success && result.modes) {
              const modeNames = result.modes.map((m: any) => `${m.id}: ${m.name}`).join('\n')
              const selected = prompt(`选择注入模式:\n${modeNames}\n\n输入模式 ID:`)
              if (selected) {
                const activeSessionId = (window as any).__activeSessionId || ''
                if (!activeSessionId) {
                  alert('请先选择一个活跃会话')
                  return
                }
                const injectResult = await window.spectrAI?.codeContext?.inject({
                  sessionId: activeSessionId,
                  mode: selected.trim(),
                  code: tab.content,
                  fileName: tab.path?.split('/').pop() || '',
                  language: tab.language || '',
                  filePath: tab.path || '',
                })
                if (injectResult?.success) {
                  alert('代码上下文已注入到当前会话')
                }
              }
            }
          }}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-accent-purple hover:bg-accent-purple/10 transition-colors"
          title="将当前文件注入到 AI 会话上下文"
        >
          <Sparkles className="w-3 h-3" />
          AI 注入
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 relative">
        {isMd && isPreview ? (
          /* Markdown 预览 + 大纲 */
          <div className="h-full flex">
            <div className="flex-1 min-w-0 overflow-auto">
              <div className="markdown-body text-[13px] leading-relaxed px-6 py-4">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={mdComponents}
                >
                  {normalizeMdTables(tab.content)}
                </Markdown>
              </div>
            </div>
            <TocSidebar content={tab.content} />
          </div>
        ) : (
          /* Monaco Editor */
          <div className="absolute inset-0">
            <Editor
              height="100%"
              language={tab.language}
              value={tab.content}
              onChange={handleChange}
              theme="spectrai-dynamic"
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                renderWhitespace: 'none',
                smoothScrolling: true,
                cursorSmoothCaretAnimation: 'on',
                padding: { top: 8, bottom: 8 },
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                contextmenu: true,
                automaticLayout: true,
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
