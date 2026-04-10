/**
 * Agent Teams - 团队设置弹窗
 * 支持编辑团队名称、目标，执行策略
 * @author weibin
 */

import { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'
import type { TeamInstance } from '../../../shared/types'

interface TeamSettingsDialogProps {
  team: TeamInstance
  onClose: () => void
}

export default function TeamSettingsDialog({ team, onClose }: TeamSettingsDialogProps) {
  const { updateTeam, exportTeam, mergeWorktrees } = useTeamStore()
  const [name, setName] = useState(team.name)
  const [objective, setObjective] = useState(team.objective || '')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeResults, setMergeResults] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) { setError('团队名称不能为空'); return }
    setSaving(true)
    setError(null)
    try {
      await updateTeam(team.id, { name: name.trim(), objective: objective.trim() })
      onClose()
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const snapshot = await exportTeam(team.id)
      if (snapshot) {
        const json = JSON.stringify(snapshot, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `team-${team.name}-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err: any) {
      setError(err.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const handleMergeWorktrees = async () => {
    setMerging(true)
    setError(null)
    setMergeResults([])
    try {
      const results = await mergeWorktrees(team.id, { cleanup: true, squash: true })
      setMergeResults(results)
      if (results.length === 0) {
        setError('没有可合并的 worktree')
      }
    } catch (err: any) {
      setError(err.message || '合并失败')
    } finally {
      setMerging(false)
    }
  }

  const isEditable = team.status !== 'completed' && team.status !== 'failed' && team.status !== 'cancelled'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[480px] bg-bg-secondary border border-border rounded-xl shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">团队设置</h3>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 错误 */}
        {error && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        {/* 内容 */}
        <div className="flex-1 p-4 space-y-4">
          {/* 团队 ID */}
          <div>
            <label className="block text-[10px] text-text-muted mb-1">团队 ID</label>
            <div className="px-2 py-1.5 text-xs bg-bg-tertiary border border-border rounded text-text-muted font-mono truncate">
              {team.id}
            </div>
          </div>

          {/* 名称 */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">团队名称 *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={!isEditable}
              className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-blue disabled:opacity-60"
            />
          </div>

          {/* 目标 */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">团队目标</label>
            <textarea
              value={objective}
              onChange={e => setObjective(e.target.value)}
              disabled={!isEditable}
              rows={3}
              placeholder="描述团队的总体目标和职责..."
              className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none disabled:opacity-60"
            />
          </div>

          {/* 成员信息 */}
          {team.members && team.members.length > 0 && (
            <div>
              <label className="block text-xs text-text-secondary mb-2">团队成员 ({team.members.length})</label>
              <div className="space-y-1.5">
                {team.members.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-tertiary border border-border">
                    <span className="text-base">{m.role?.icon || '👤'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-text-primary flex items-center gap-1.5">
                        {m.role?.name || m.roleId}
                        {m.role?.isLeader && <span className="text-[9px] text-orange-400 bg-orange-500/15 px-1 rounded">👑</span>}
                      </div>
                      <div className="text-[10px] text-text-muted font-mono truncate">{m.id}</div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                      m.status === 'running' ? 'bg-accent-green/20 text-accent-green' :
                      m.status === 'completed' ? 'bg-accent-blue/20 text-accent-blue' :
                      m.status === 'failed' ? 'bg-accent-red/20 text-accent-red' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {m.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 统计 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-bg-tertiary border border-border text-center">
              <div className="text-lg font-bold text-text-primary">{team.members?.length || 0}</div>
              <div className="text-[10px] text-text-muted">成员数</div>
            </div>
            <div className="p-3 rounded-lg bg-bg-tertiary border border-border text-center">
              <div className="text-lg font-bold text-text-primary">{team.status}</div>
              <div className="text-[10px] text-text-muted">当前状态</div>
            </div>
          </div>

          {team.worktreeIsolation && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs text-text-secondary">Worktree 合并</label>
                <button
                  onClick={handleMergeWorktrees}
                  disabled={merging || team.status === 'running'}
                  className="px-3 py-1.5 text-xs bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 disabled:opacity-60 transition-colors"
                >
                  {merging ? '合并中...' : '合并并清理'}
                </button>
              </div>
              <div className="text-[10px] text-text-muted">
                仅对启用 Worktree 隔离的成员生效。运行中的团队建议先暂停或完成后再合并。
              </div>

              {mergeResults.length > 0 && (
                <div className="space-y-1.5">
                  {mergeResults.map((result, index) => (
                    <div key={`${result.memberId}-${index}`} className="p-2 rounded-lg bg-bg-tertiary border border-border text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-text-primary">{result.roleId || result.memberId}</span>
                        <span className={result.merged ? 'text-accent-green' : result.skipped ? 'text-text-muted' : 'text-accent-red'}>
                          {result.merged ? '已合并' : result.skipped ? '已跳过' : '失败'}
                        </span>
                      </div>
                      <div className="text-[10px] text-text-muted mt-1 break-all">
                        {result.reason || `${result.branch} → ${result.mainBranch || 'main'}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-3 py-1.5 text-xs text-text-secondary border border-border rounded-lg hover:bg-bg-hover disabled:opacity-60 transition-colors"
          >
            {exporting ? '导出中...' : '导出 JSON'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border rounded-lg hover:bg-bg-hover transition-colors"
            >
              取消
            </button>
            {isEditable && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 text-xs bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 disabled:opacity-60 transition-colors"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
