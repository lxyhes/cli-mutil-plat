/**
 * Agent Teams - 创建团队对话框
 *
 * @author weibin
 */

import { useEffect, useState } from 'react'
import { X, Users, Send, Check, GitBranch, Settings } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'
import { useSessionStore } from '../../stores/sessionStore'
import TemplateManagerDialog from './TemplateManagerDialog'

interface CreateTeamDialogProps {
  onClose: () => void
  onSuccess: () => void
  parentTeamId?: string
}

export default function CreateTeamDialog({ onClose, onSuccess, parentTeamId }: CreateTeamDialogProps) {
  const { teams, templates, createTeam, fetchTemplates } = useTeamStore()
  const sessions = useSessionStore(s => s.sessions)

  const [name, setName] = useState(`开发团队-${new Date().toISOString().slice(0, 10)}`)
  const [objective, setObjective] = useState('')
  const [templateId, setTemplateId] = useState(templates[0]?.id || '')
  const [providerId, setProviderId] = useState('claude-code')
  const [worktreeIsolation, setWorktreeIsolation] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTemplateManager, setShowTemplateManager] = useState(false)

  useEffect(() => {
    void fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    if (!templateId && templates.length > 0) {
      setTemplateId(templates[0].id)
    }
  }, [templateId, templates])

  const selectedTemplate = templates.find(t => t.id === templateId)
  const parentTeam = teams.find(t => t.id === parentTeamId)

  const handleCreate = async () => {
    if (!name.trim() || !objective.trim()) {
      setError('请填写团队名称和目标')
      return
    }
    
    setCreating(true)
    setError(null)
    try {
      // 使用当前会话的工作目录
      const workDir = parentTeam?.workDir || sessions[0]?.config?.workingDirectory || ''
      
      const result = await createTeam({
        name: name.trim(),
        objective: objective.trim(),
        workDir,
        templateId,
        providerId,
        worktreeIsolation,
        parentTeamId,
      })
      
      if (result) {
        onSuccess()
        onClose()
      } else {
        setError('创建失败，请查看控制台日志')
      }
    } catch (err) {
      setError(`创建失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleCreate()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-accent-blue" />
            <h3 className="text-sm font-semibold text-text-primary">创建新团队</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover text-text-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 表单内容 - 可滚动 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 团队名称 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              团队名称 <span className="text-accent-red">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：开发团队-2026-04-09"
              className="w-full px-3 py-2 text-xs rounded-lg bg-bg-primary border border-border 
                text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* 团队目标 */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              团队目标 <span className="text-accent-red">*</span>
            </label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="描述团队要完成的任务，例如：开发一个任务管理系统..."
              rows={4}
              className="w-full px-3 py-2 text-xs rounded-lg bg-bg-primary border border-border 
                text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue
                resize-none leading-relaxed"
            />
          </div>

          {/* 选择模板 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-secondary">团队模板</label>
              <button
                onClick={() => setShowTemplateManager(true)}
                className="text-[10px] text-accent-blue hover:underline flex items-center gap-1"
              >
                <Settings className="w-3 h-3" /> 管理模板
              </button>
            </div>
            <div className="space-y-2">
              {templates.map(template => (
                <button
                  key={template.id}
                  onClick={() => setTemplateId(template.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all text-xs
                    ${templateId === template.id
                      ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/20'
                      : 'border-border bg-bg-primary hover:border-accent-blue/40'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-text-primary">{template.name}</span>
                    {templateId === template.id && <Check size={14} className="text-accent-blue" />}
                  </div>
                  <div className="text-text-muted mb-2 leading-relaxed">{template.description}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {template.roles?.map(role => (
                      <span
                        key={role.id}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-muted"
                      >
                        <span>{role.icon}</span>
                        <span>{role.name}</span>
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 选择 Provider */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              AI Provider
            </label>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg bg-bg-primary border border-border 
                text-text-primary focus:outline-none focus:border-accent-blue appearance-none cursor-pointer"
            >
              <option value="claude-code">🤖 Claude Code（推荐）</option>
              <option value="iflow">⚡ iFlow</option>
              <option value="opencode">🔓 OpenCode</option>
              <option value="gemini-cli">💎 Gemini CLI</option>
              <option value="qwen-coder">🔮 Qwen Coder</option>
              <option value="codex">📝 Codex</option>
            </select>
          </div>

          {/* Worktree 隔离 */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-bg-primary border border-border">
            <input
              type="checkbox"
              id="worktree-isolation"
              checked={worktreeIsolation}
              onChange={e => setWorktreeIsolation(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-accent-blue flex-shrink-0"
            />
            <label htmlFor="worktree-isolation" className="cursor-pointer">
              <div className="text-xs font-medium text-text-primary flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-accent-purple" />
                启用 Worktree 隔离
              </div>
              <div className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                为每个成员创建独立 Git Worktree（需工作目录为 Git 仓库），避免文件冲突，支持并行开发
              </div>
            </label>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/30 text-xs text-accent-red">
              {error}
            </div>
          )}

          {/* 提示 */}
          <div className="px-3 py-2 rounded-lg bg-bg-primary border border-border text-[10px] text-text-muted leading-relaxed">
            💡 提示：创建团队后，系统将为每个角色启动独立的 AI Agent。
            使用 <kbd className="px-1 py-0.5 rounded bg-bg-secondary text-text-secondary">Ctrl+Enter</kbd> 快速创建。
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
          <div className="text-[10px] text-text-muted">
            将创建 {selectedTemplate?.roles?.length || 0} 个 AI Agent
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs rounded-lg border border-border text-text-secondary 
                hover:bg-bg-hover transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim() || !objective.trim()}
              className="px-4 py-1.5 text-xs rounded-lg bg-accent-blue text-white font-medium
                hover:bg-accent-blue/80 disabled:opacity-30 disabled:cursor-not-allowed 
                transition-colors flex items-center gap-1.5"
            >
              {creating ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  创建中...
                </>
              ) : (
                <>
                  <Send size={12} />
                  创建团队
                </>
              )}
            </button>
          </div>
        </div>

        {/* 模板管理弹窗 */}
        {showTemplateManager && (
          <TemplateManagerDialog onClose={() => { setShowTemplateManager(false); fetchTemplates() }} />
        )}
      </div>
    </div>
  )
}
