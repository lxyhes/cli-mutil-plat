/**
 * 会话内嵌知识中心抽屉面板
 * 复用 KnowledgeView 组件，提供统一的知识中心体验
 * @author spectrai
 */
import { useState } from 'react'
import { PanelRightClose, Globe, BookMarked } from 'lucide-react'
import KnowledgeView from '../sidebar/KnowledgeView'
import ReferenceProjectPanel from './ReferenceProjectPanel'

interface Props {
  sessionId: string
  projectPath: string
  onClose: () => void
}

/**
 * 会话知识面板
 * 提供三 Tab 切换：知识中心 / 参考项目
 */
export default function SessionKnowledgePanel({ sessionId, projectPath, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'knowledge' | 'reference'>('knowledge')

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-bg-primary">
      {/* ===== Tab 切换 ===== */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-bg-elevated px-3 py-2">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              activeTab === 'knowledge'
                ? 'bg-accent-purple/15 text-accent-purple font-medium'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            <BookMarked className="w-3 h-3" />
            知识中心
          </button>
          <button
            onClick={() => setActiveTab('reference')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              activeTab === 'reference'
                ? 'bg-accent-blue/15 text-accent-blue font-medium'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            <Globe className="w-3 h-3" />
            参考项目
          </button>
        </div>
        <button
          onClick={onClose}
          title="关闭面板"
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ===== 内容区域 ===== */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'reference' ? (
          <ReferenceProjectPanel sessionId={sessionId} projectPath={projectPath} />
        ) : (
          <KnowledgeView />
        )}
      </div>
    </div>
  )
}
