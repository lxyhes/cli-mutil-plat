/**
 * 中间区域布局切换按钮组
 * @author weibin
 */

import { Square, PanelsLeftRight, PanelsTopBottom, ArrowLeftRight, ArrowUpDown } from 'lucide-react'
import type { ElementType } from 'react'
import { useUIStore } from '../../stores/uiStore'
import type { LayoutMode } from '../../../shared/types'

export default function LayoutControls() {
  const { layoutMode, setLayoutMode, swapPanes } = useUIStore()

  const buttons: Array<{ mode: LayoutMode; icon: ElementType; title: string }> = [
    { mode: 'single',  icon: Square,          title: '单窗格' },
    { mode: 'split-h', icon: PanelsLeftRight,  title: '左右分栏' },
    { mode: 'split-v', icon: PanelsTopBottom,  title: '上下分栏' },
  ]

  const isSplit = layoutMode !== 'single'
  const SwapIcon = layoutMode === 'split-v' ? ArrowUpDown : ArrowLeftRight

  return (
    <div className="inline-flex items-center gap-1">
      {isSplit && (
        <button
          onClick={swapPanes}
          title={layoutMode === 'split-v' ? '交换上下内容' : '交换左右内容'}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border-subtle bg-bg-tertiary text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <SwapIcon size={13} />
        </button>
      )}
      <div className="inline-flex items-center gap-0.5 rounded-lg border border-border-subtle bg-bg-tertiary p-0.5">
        {buttons.map(({ mode, icon: Icon, title }) => (
          <button
            key={mode}
            onClick={() => setLayoutMode(mode)}
            title={title}
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
              layoutMode === mode
                ? 'bg-bg-elevated text-accent-blue shadow-sm'
                : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary'
            }`}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}
