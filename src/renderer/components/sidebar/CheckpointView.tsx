/**
 * 智能回溯面板 - 创建/恢复/对比代码快照
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import { History, Plus, RotateCcw, GitCommit, Trash2, ArrowRight, Camera, Loader2 } from 'lucide-react'
import { useCheckpointStore, type Checkpoint } from '../../stores/checkpointStore'
import { useSessionStore } from '../../stores/sessionStore'

const TRIGGER_LABELS: Record<string, string> = {
  manual: '手动',
  'auto-file-change': '文件变更',
  'auto-tool-use': '工具调用',
  'auto-interval': '定时',
}

export default function CheckpointView() {
  const store = useCheckpointStore()
  const checkpoints = useCheckpointStore(s => s.checkpoints)
  const loading = useCheckpointStore(s => s.loading)
  const diffResult = useCheckpointStore(s => s.diffResult)
  const selectedId = useCheckpointStore(s => s.selectedId)
  const activeSessionId = useSessionStore(s => s.currentSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const [diffFrom, setDiffFrom] = useState<string | null>(null)

  useEffect(() => {
    if (activeSessionId) store.fetchList(activeSessionId)
  }, [activeSessionId])

  const session = sessions.find(s => s.id === activeSessionId)
  const handleCreate = async () => {
    if (!activeSessionId || !session) return
    await store.create({
      sessionId: activeSessionId,
      sessionName: session.name,
      repoPath: session.workDir || '',
      label: `手动快照 #${checkpoints.length + 1}`,
      trigger: 'manual',
    })
  }

  const handleRestore = async (id: string) => {
    const result = await store.restore(id)
    if (result?.success) alert(`✅ ${result.message}`)
    else alert(`❌ ${result?.message || '恢复失败'}`)
  }

  const handleDiff = (fromId: string, toId: string) => {
    store.diff(fromId, toId)
  }

  if (!activeSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted p-6">
        <History className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">请先选择一个会话</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <History className="w-4 h-4 text-accent-blue" />
          智能回溯
        </div>
        <button onClick={handleCreate} title="创建快照"
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-blue/15 text-accent-blue text-xs hover:bg-accent-blue/25 transition-colors">
          <Camera className="w-3 h-3" />
          快照
        </button>
      </div>

      {/* Diff Result */}
      {diffResult && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50">
          <div className="text-xs font-medium text-text-primary mb-1">对比结果: {diffResult.summary}</div>
          <div className="space-y-0.5">
            {diffResult.files.map(f => (
              <div key={f} className="text-[10px] text-text-muted flex items-center gap-1">
                <GitCommit className="w-2.5 h-2.5" /> {f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checkpoint List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <History className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">暂无回溯点</p>
            <p className="text-[10px]">点击上方"快照"按钮创建第一个回溯点</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {checkpoints.map((cp, idx) => (
              <div key={cp.id}
                className={`px-3 py-2.5 hover:bg-bg-hover transition-colors cursor-pointer ${selectedId === cp.id ? 'bg-accent-blue/5' : ''}`}
                onClick={() => store.setSelected(cp.id)}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-text-primary">{cp.label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                      cp.trigger === 'manual' ? 'bg-accent-blue/10 text-accent-blue' : 'bg-accent-green/10 text-accent-green'
                    }`}>
                      {TRIGGER_LABELS[cp.trigger] || cp.trigger}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {diffFrom ? (
                      <button onClick={(e) => { e.stopPropagation(); handleDiff(diffFrom, cp.id) }}
                        className="p-0.5 rounded text-accent-blue hover:bg-accent-blue/10" title="对比">
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setDiffFrom(cp.id) }}
                        className="p-0.5 rounded text-text-muted hover:text-text-primary" title="设为对比基准">
                        <GitCommit className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleRestore(cp.id) }}
                      className="p-0.5 rounded text-text-muted hover:text-accent-yellow" title="回滚到此版本">
                      <RotateCcw className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); store.delete(cp.id) }}
                      className="p-0.5 rounded text-text-muted hover:text-accent-red" title="删除">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-text-muted">
                  <span>{new Date(cp.createdAt).toLocaleString()}</span>
                  {cp.fileCount > 0 && <span>{cp.fileCount} 文件</span>}
                  {cp.commitHash && <span className="font-mono">{cp.commitHash.slice(0, 7)}</span>}
                </div>
                {diffFrom === cp.id && (
                  <div className="text-[10px] text-accent-blue mt-1">已设为对比基准，点击另一个快照的 → 按钮进行对比</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        代码修改时自动创建快照，可随时回滚到任意版本
      </div>
    </div>
  )
}
