/**
 * 智能回溯面板 - 创建/恢复/对比代码快照
 * 
 * 功能：
 * - 手动创建快照
 * - 自动快照开关
 * - 回滚确认对话框
 * - 两个快照对比（变更文件列表）
 * - 时间线视觉效果
 * - 实时接收新快照通知
 * 
 * @author spectrai
 */
import { useState, useEffect, useCallback } from 'react'
import {
  History, Camera, RotateCcw, GitCommit, Trash2, ArrowRight,
  Loader2, AlertTriangle, Shield, ToggleLeft, ToggleRight, FileCode2, X
} from 'lucide-react'
import { useCheckpointStore, type Checkpoint } from '../../stores/checkpointStore'
import { useSessionStore } from '../../stores/sessionStore'

const TRIGGER_LABELS: Record<string, string> = {
  manual: '手动',
  'auto-file-change': '文件变更',
  'auto-tool-use': '工具调用',
  'auto-interval': '定时',
  'auto-turn-complete': 'AI回合',
}

const TRIGGER_COLORS: Record<string, string> = {
  manual: 'bg-accent-blue/10 text-accent-blue',
  'auto-file-change': 'bg-accent-green/10 text-accent-green',
  'auto-tool-use': 'bg-purple-500/10 text-purple-400',
  'auto-interval': 'bg-accent-yellow/10 text-accent-yellow',
  'auto-turn-complete': 'bg-accent-green/10 text-accent-green',
}

/** 确认回滚对话框 */
function RestoreConfirmDialog({
  checkpoint,
  onConfirm,
  onCancel,
}: {
  checkpoint: Checkpoint
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-[420px] max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-lg bg-accent-yellow/15 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-accent-yellow" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">确认回滚</h3>
            <p className="text-xs text-text-muted mt-0.5">此操作将重置代码到快照状态</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div className="bg-bg-tertiary/60 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">快照名称</span>
              <span className="text-text-primary font-medium">{checkpoint.label}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">创建时间</span>
              <span className="text-text-secondary">{new Date(checkpoint.createdAt).toLocaleString()}</span>
            </div>
            {checkpoint.commitHash && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">Commit</span>
                <span className="font-mono text-accent-blue">{checkpoint.commitHash.slice(0, 7)}</span>
              </div>
            )}
            {checkpoint.fileCount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">变更文件</span>
                <span className="text-text-secondary">{checkpoint.fileCount} 个</span>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 p-2.5 bg-accent-yellow/5 border border-accent-yellow/20 rounded-lg">
            <Shield className="w-4 h-4 text-accent-yellow shrink-0 mt-0.5" />
            <div className="text-xs text-text-secondary leading-relaxed">
              <p className="font-medium text-accent-yellow">安全保护已启用</p>
              <p className="mt-1">回滚前会自动 stash 保存未提交的改动，可随时恢复。</p>
              <p className="mt-1 text-text-muted">回滚后此快照之后的代码改动将丢失。</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-lg text-xs bg-accent-yellow text-black font-medium hover:bg-accent-yellow/80 transition-colors"
          >
            确认回滚
          </button>
        </div>
      </div>
    </div>
  )
}

/** Diff 详情面板 */
function DiffDetailPanel({
  files,
  summary,
  onClose,
}: {
  files: string[]
  summary: string
  onClose: () => void
}) {
  return (
    <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-medium text-text-primary">对比结果: {summary}</div>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-bg-hover text-text-muted">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
        {files.map(f => (
          <div key={f} className="text-[11px] text-text-secondary flex items-center gap-1.5 py-0.5">
            <FileCode2 className="w-3 h-3 text-text-muted shrink-0" />
            <span className="truncate">{f}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CheckpointView() {
  const store = useCheckpointStore()
  const checkpoints = useCheckpointStore(s => s.checkpoints)
  const loading = useCheckpointStore(s => s.loading)
  const diffResult = useCheckpointStore(s => s.diffResult)
  const selectedId = useCheckpointStore(s => s.selectedId)
  const autoEnabled = useCheckpointStore(s => s.autoEnabled)
  const lastCreated = useCheckpointStore(s => s.lastCreated)
  const activeSessionId = useSessionStore(s => s.currentSessionId)
  const sessions = useSessionStore(s => s.sessions)

  const [diffFrom, setDiffFrom] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<Checkpoint | null>(null)
  const [restoring, setRestoring] = useState(false)

  // 切换会话时加载 checkpoints
  useEffect(() => {
    if (activeSessionId) store.fetchList(activeSessionId)
    setDiffFrom(null)
    setRestoreTarget(null)
  }, [activeSessionId])

  // 加载设置
  useEffect(() => {
    store.loadSettings()
  }, [])

  // 监听主进程推送的新快照通知
  useEffect(() => {
    const api = (window as any).spectrAI?.checkpoint
    if (!api?.onCreated) return
    const unsubscribe = api.onCreated((sessionId: string, checkpoint: Checkpoint) => {
      store.onCheckpointCreated(sessionId, checkpoint)
    })
    return unsubscribe
  }, [])

  const session = sessions.find(s => s.id === activeSessionId)

  const handleCreate = async () => {
    if (!activeSessionId || !session) return
    const workingDir = session.workDir || (session as any).workingDirectory || ''
    if (!workingDir) return
    await store.create({
      sessionId: activeSessionId,
      sessionName: session.name,
      repoPath: workingDir,
      label: `手动快照 #${checkpoints.length + 1}`,
      trigger: 'manual',
    })
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    setRestoring(true)
    try {
      const result = await store.restore(restoreTarget.id)
      if (result.success) {
        setRestoreTarget(null)
      }
    } finally {
      setRestoring(false)
    }
  }

  const handleDiff = (fromId: string, toId: string) => {
    store.diff(fromId, toId)
  }

  // 统计信息
  const autoCount = checkpoints.filter(c => c.trigger !== 'manual').length
  const manualCount = checkpoints.filter(c => c.trigger === 'manual').length

  if (!activeSessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted p-6">
        <History className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm">请先选择一个会话</p>
        <p className="text-[10px] mt-1">AI 对话时自动创建代码快照</p>
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
        <button
          onClick={handleCreate}
          title="创建快照"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-blue/15 text-accent-blue text-xs hover:bg-accent-blue/25 transition-colors"
        >
          <Camera className="w-3 h-3" />
          快照
        </button>
      </div>

      {/* 自动快照开关 + 统计 */}
      <div className="px-3 py-2 border-b border-border bg-bg-tertiary/30">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-text-secondary">自动快照</span>
          <button
            onClick={() => store.setAutoEnabled(!autoEnabled)}
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary transition-colors"
          >
            {autoEnabled ? (
              <ToggleRight className="w-5 h-5 text-accent-green" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-text-muted" />
            )}
            {autoEnabled ? '已开启' : '已关闭'}
          </button>
        </div>
        {checkpoints.length > 0 && (
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <span>{manualCount} 手动</span>
            <span>{autoCount} 自动</span>
            <span>共 {checkpoints.length} 个快照</span>
          </div>
        )}
      </div>

      {/* 新快照通知 */}
      {lastCreated && (
        <div className="px-3 py-1.5 bg-accent-green/5 border-b border-accent-green/10 flex items-center gap-2 text-[11px] text-accent-green">
          <Camera className="w-3 h-3" />
          新快照: {lastCreated.label}
          <button
            onClick={() => useCheckpointStore.setState({ lastCreated: null })}
            className="ml-auto text-text-muted hover:text-text-primary"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Diff Result */}
      {diffResult && (
        <DiffDetailPanel
          files={diffResult.files}
          summary={diffResult.summary}
          onClose={() => useCheckpointStore.setState({ diffResult: null })}
        />
      )}

      {/* Checkpoint Timeline */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <History className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">暂无回溯点</p>
            <p className="text-[10px]">AI 修改代码时将自动创建快照</p>
            <p className="text-[10px] mt-0.5">或点击上方"快照"按钮手动创建</p>
          </div>
        ) : (
          <div className="py-1">
            {checkpoints.map((cp, idx) => (
              <div
                key={cp.id}
                className={`group relative px-3 py-2.5 hover:bg-bg-hover transition-colors cursor-pointer ${
                  selectedId === cp.id ? 'bg-accent-blue/5' : ''
                }`}
                onClick={() => store.setSelected(cp.id)}
              >
                {/* 时间线竖条 */}
                <div className="absolute left-[18px] top-0 bottom-0 w-px bg-border" />
                {idx === 0 && <div className="absolute left-[15px] top-0 bottom-1/2 w-[7px] bg-bg-primary" />}

                {/* 时间线圆点 */}
                <div className="relative flex items-start gap-3">
                  <div className={`w-[7px] h-[7px] rounded-full mt-1.5 shrink-0 z-[1] ${
                    cp.trigger === 'manual' ? 'bg-accent-blue' : 'bg-accent-green'
                  }`} />

                  <div className="flex-1 min-w-0">
                    {/* 标签行 */}
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-medium text-text-primary truncate">{cp.label}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] shrink-0 ${TRIGGER_COLORS[cp.trigger] || 'bg-bg-tertiary text-text-muted'}`}>
                          {TRIGGER_LABELS[cp.trigger] || cp.trigger}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {diffFrom ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDiff(diffFrom, cp.id) }}
                            className="p-1 rounded text-accent-blue hover:bg-accent-blue/10"
                            title="对比"
                          >
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDiffFrom(cp.id) }}
                            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                            title="设为对比基准"
                          >
                            <GitCommit className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setRestoreTarget(cp) }}
                          className="p-1 rounded text-text-muted hover:text-accent-yellow hover:bg-accent-yellow/10"
                          title="回滚到此版本"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); store.delete(cp.id) }}
                          className="p-1 rounded text-text-muted hover:text-accent-red hover:bg-accent-red/10"
                          title="删除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* 元信息行 */}
                    <div className="flex items-center gap-3 text-[10px] text-text-muted">
                      <span>{new Date(cp.createdAt).toLocaleString()}</span>
                      {cp.fileCount > 0 && <span>{cp.fileCount} 文件</span>}
                      {cp.commitHash && (
                        <span className="font-mono text-accent-blue/70">{cp.commitHash.slice(0, 7)}</span>
                      )}
                    </div>

                    {/* 描述 */}
                    {cp.description && (
                      <div className="text-[10px] text-text-muted mt-0.5 truncate">{cp.description}</div>
                    )}

                    {/* 对比基准提示 */}
                    {diffFrom === cp.id && (
                      <div className="text-[10px] text-accent-blue mt-1 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" />
                        已设为对比基准，点击另一快照的 → 进行对比
                        <button
                          onClick={(e) => { e.stopPropagation(); setDiffFrom(null) }}
                          className="ml-1 text-text-muted hover:text-text-primary"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        {autoEnabled ? 'AI 修改代码时自动创建快照' : '自动快照已关闭'}
        {' · '}可随时回滚到任意版本
      </div>

      {/* 确认回滚对话框 */}
      {restoreTarget && (
        <RestoreConfirmDialog
          checkpoint={restoreTarget}
          onConfirm={handleRestore}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </div>
  )
}
