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
import { Eye, Pencil } from 'lucide-react'
import type { Components } from 'react-markdown'

interface CodeViewerProps {
  /** 对应 FileTab 的 id */
  tabId: string
}

/** Markdown 预览的自定义组件 */
const mdComponents: Components = {
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
        'editor.lineHighlightBackground':     get('--color-bg-secondary') + '80',
        'editorGutter.background':            get('--color-bg-primary'),
        'editorLineNumber.foreground':        get('--color-text-muted'),
        'editorLineNumber.activeForeground':  get('--color-text-secondary'),
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
      {/* 工具栏：Markdown 文件显示预览切换按钮 */}
      {isMd && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-bg-primary">
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
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {isMd && isPreview ? (
          /* Markdown 预览 */
          <div className="markdown-body text-[13px] leading-relaxed px-6 py-4">
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={mdComponents}
            >
              {normalizeMdTables(tab.content)}
            </Markdown>
          </div>
        ) : (
          /* Monaco Editor */
          <div className="h-full">
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
