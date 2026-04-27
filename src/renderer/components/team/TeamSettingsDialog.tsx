/**
 * Agent Teams settings dialog.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Save, X } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'
import type { AIProvider, TeamInstance, TeamMember } from '../../../shared/types'

interface TeamSettingsDialogProps {
  team: TeamInstance
  onClose: () => void
}

interface MemberDraft {
  providerId: string
  modelOverride: string
  promptOverride: string
}

const FALLBACK_PROVIDERS: AIProvider[] = [
  { id: 'codex', name: 'Codex CLI', command: 'codex', isBuiltin: true },
  { id: 'claude-code', name: 'Claude Code', command: 'claude', isBuiltin: true },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini', isBuiltin: true },
  { id: 'qwen-coder', name: 'Qwen Coder CLI', command: 'qwen', isBuiltin: true },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', isBuiltin: true },
  { id: 'iflow', name: 'iFlow CLI', command: 'iflow', isBuiltin: true },
]

function buildMemberDrafts(members: TeamMember[]): Record<string, MemberDraft> {
  return Object.fromEntries(members.map(member => [
    member.id,
    {
      providerId: member.providerId || 'codex',
      modelOverride: member.modelOverride || '',
      promptOverride: member.promptOverride ?? member.role?.systemPrompt ?? '',
    },
  ]))
}

export default function TeamSettingsDialog({ team, onClose }: TeamSettingsDialogProps) {
  const { updateTeam, updateMember, exportTeam, mergeWorktrees } = useTeamStore()
  const [name, setName] = useState(team.name)
  const [objective, setObjective] = useState(team.objective || '')
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [memberDrafts, setMemberDrafts] = useState<Record<string, MemberDraft>>(() => buildMemberDrafts(team.members || []))
  const [saving, setSaving] = useState(false)
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeResults, setMergeResults] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMemberDrafts(buildMemberDrafts(team.members || []))
  }, [team.id, team.members])

  useEffect(() => {
    let cancelled = false
    window.spectrAI.provider.getAll()
      .then(list => {
        if (!cancelled) setProviders(Array.isArray(list) && list.length > 0 ? list : FALLBACK_PROVIDERS)
      })
      .catch(() => {
        if (!cancelled) setProviders(FALLBACK_PROVIDERS)
      })
    return () => { cancelled = true }
  }, [])

  const providerOptions = useMemo(() => (
    providers.length > 0 ? providers : FALLBACK_PROVIDERS
  ), [providers])

  const updateDraft = (memberId: string, updates: Partial<MemberDraft>) => {
    setMemberDrafts(prev => ({
      ...prev,
      [memberId]: {
        providerId: prev[memberId]?.providerId || 'codex',
        modelOverride: prev[memberId]?.modelOverride || '',
        promptOverride: prev[memberId]?.promptOverride || '',
        ...updates,
      },
    }))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('团队名称不能为空')
      return
    }
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

  const handleSaveMember = async (member: TeamMember) => {
    const draft = memberDrafts[member.id]
    if (!draft?.providerId) {
      setError('请选择成员厂商')
      return
    }

    setSavingMemberId(member.id)
    setError(null)
    try {
      const saved = await updateMember(team.id, member.id, {
        providerId: draft.providerId,
        modelOverride: draft.modelOverride.trim() || null,
        promptOverride: draft.promptOverride.trim() || null,
      })
      if (!saved) throw new Error('成员配置保存失败')
    } catch (err: any) {
      setError(err.message || '成员配置保存失败')
    } finally {
      setSavingMemberId(null)
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
      if (results.length === 0) setError('没有可合并的 worktree')
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
      <div className="relative z-10 w-[760px] max-w-[calc(100vw-32px)] max-h-[86vh] bg-bg-secondary border border-border rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">团队设置</h3>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div>
            <label className="block text-[10px] text-text-muted mb-1">团队 ID</label>
            <div className="px-2 py-1.5 text-xs bg-bg-tertiary border border-border rounded text-text-muted font-mono truncate">
              {team.id}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">团队名称 *</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={!isEditable}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-blue disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">当前状态</label>
              <div className="px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary">
                {team.status}
              </div>
            </div>
          </div>

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

          {team.members && team.members.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs text-text-secondary">成员配置 ({team.members.length})</label>
                <span className="text-[10px] text-text-muted">运行中的成员保存后对下次启动生效</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {team.members.map((member) => {
                  const draft = memberDrafts[member.id] || {
                    providerId: member.providerId || 'codex',
                    modelOverride: member.modelOverride || '',
                    promptOverride: member.promptOverride ?? member.role?.systemPrompt ?? '',
                  }
                  const selectedProvider = providerOptions.find(provider => provider.id === draft.providerId)
                  return (
                    <div key={member.id} className="rounded-lg bg-bg-tertiary border border-border p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{member.role?.icon || 'AI'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-text-primary truncate">
                            {member.role?.name || member.roleId}
                          </div>
                          <div className="text-[10px] text-text-muted font-mono truncate">{member.id}</div>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                          member.status === 'running' ? 'bg-accent-green/20 text-accent-green' :
                          member.status === 'completed' ? 'bg-accent-blue/20 text-accent-blue' :
                          member.status === 'failed' ? 'bg-accent-red/20 text-accent-red' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {member.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-text-muted mb-1">厂商</label>
                          <select
                            value={draft.providerId}
                            onChange={e => updateDraft(member.id, { providerId: e.target.value })}
                            className="w-full px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent-blue"
                          >
                            {providerOptions.map(provider => (
                              <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-text-muted mb-1">模型</label>
                          <input
                            value={draft.modelOverride}
                            onChange={e => updateDraft(member.id, { modelOverride: e.target.value })}
                            placeholder={selectedProvider?.defaultModel || '使用厂商默认模型'}
                            className="w-full px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] text-text-muted mb-1">提示词</label>
                        <textarea
                          value={draft.promptOverride}
                          onChange={e => updateDraft(member.id, { promptOverride: e.target.value })}
                          rows={4}
                          placeholder="为空时使用角色默认提示词"
                          className="w-full px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
                        />
                      </div>

                      <button
                        onClick={() => handleSaveMember(member)}
                        disabled={savingMemberId === member.id}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 disabled:opacity-60 transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingMemberId === member.id ? '保存中...' : '保存成员'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-bg-tertiary border border-border text-center">
              <div className="text-lg font-bold text-text-primary">{team.members?.length || 0}</div>
              <div className="text-[10px] text-text-muted">成员数</div>
            </div>
            <div className="p-3 rounded-lg bg-bg-tertiary border border-border text-center">
              <div className="text-lg font-bold text-text-primary">
                {team.members?.filter(member => member.status === 'running').length || 0}
              </div>
              <div className="text-[10px] text-text-muted">运行中</div>
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
                        {result.reason || `${result.branch} -> ${result.mainBranch || 'main'}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

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
                {saving ? '保存中...' : '保存团队'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
