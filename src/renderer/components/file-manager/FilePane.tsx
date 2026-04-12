/**
 * 文件窗格主容器
 * 包含 FileTabs + CodeViewer，在中间区域展示文件内容
 * @author weibin
 */

import React, { useState, useEffect } from 'react'
import FileTabs from './FileTabs'
import CodeViewer from './CodeViewer'
import { useFileTabStore } from '../../stores/fileTabStore'
import { toPlatformShortcutLabel } from '../../utils/shortcut'

export default function FilePane() {
  const { tabs, activeTabId } = useFileTabStore()
  // 追踪哪些 Tab 已经被渲染过（一旦渲染过就保持，以保留滚动位置）
  const [renderedTabIds, setRenderedTabIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (activeTabId && !renderedTabIds.has(activeTabId)) {
      setRenderedTabIds(prev => new Set([...prev, activeTabId]))
    }
  }, [activeTabId, renderedTabIds])

  // 当 Tab 被关闭时，从已渲染列表中移除
  useEffect(() => {
    const tabIdSet = new Set(tabs.map(t => t.id))
    setRenderedTabIds(prev => {
      const next = new Set(Array.from(prev).filter(id => tabIdSet.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [tabs])

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Tab 栏 */}
      <FileTabs />

      {/* 编辑器区域 */}
      <div className="flex-1 min-h-0 relative">
        {tabs.length === 0 ? (
          /* 空状态：引导用户从文件树打开文件 */
          <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted select-none">
            <div className="text-5xl opacity-30">📄</div>
            <div className="text-sm">从左侧文件树单击文件打开</div>
            <div className="text-xs opacity-60">支持查看和编辑，{toPlatformShortcutLabel('Ctrl+S')} 保存</div>
          </div>
        ) : (
          /*
           * 按需渲染 Tab 内容。只有当前激活或曾经激活过的 Tab 才会挂载 DOM。
           * 这样既能提升初始打开性能，又能保留已打开 Tab 的状态（滚动位置、撤销栈）。
           */
          tabs.map(tab => {
            const isRendered = renderedTabIds.has(tab.id)
            if (!isRendered) return null

            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
              >
                <CodeViewer tabId={tab.id} />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
