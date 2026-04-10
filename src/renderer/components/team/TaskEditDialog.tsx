/**
 * Agent Teams - 任务编辑弹窗
 * 支持编辑任务标题、描述、优先级、依赖
 * @author weibin
 */

import { useState } from 'react'
import { X, Lock, AlertCircle } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'
import type { TeamTask } from '../../../shared/types'

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低', color: 'text-green-400' },
  { value: 'medium', label: '中', color: 'text-yellow-400' },
  { value: 'high', label: '高', color: 'text-orange-400' },
  { value: 'critical', label: '紧急', color: 'text-red-400' },
]

interface TaskEditDialogProps {
  task: TeamTask
  allTasks: TeamTask[]
  members: any[]
  teamId: string
  onClose: () => void
}

export default function TaskEditDialog({ task, allTasks, members, teamId, onClose }: TaskEditDialogProps) {
  const { updateTask, reassignTask } = useTeamStore()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>(task.priority)
  const [selectedDeps, setSelectedDeps] = useState<Set<string>>(new Set(task.dependencies || []))
  const [assignedMemberId, setAssignedMemberId] = useState(task.claimedBy || task.assignedTo || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 可选的依赖任务（排除自己，且已完成/待办状态可选）
  const availableTasks = allTasks.filter(t =>
    t.id !== task.id &&
    t.status !== 'in_progress' // 进行中的任务不能作为依赖（防止活锁）
  )

  const toggleDep = (taskId: string) => {
    const next = new Set(selectedDeps)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    setSelectedDeps(next)
  }

  const handleSave = async () => {
    if (!title.trim()) {
      setError('任务标题不能为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const updates: any = {
        title: title.trim(),
        description: description.trim(),
        priority,
        dependencies: Array.from(selectedDeps),
      }
      const result = await updateTask(teamId, task.id, updates)
      if (result) {
        if (assignedMemberId && assignedMemberId !== (task.claimedBy || task.assignedTo)) {
          await reassignTask(teamId, task.id, assignedMemberId)
        }
        onClose()
      } else {
        setError('保存失败')
      }
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const isEditable = task.status === 'pending'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* 弹窗 */}
      <div className="relative z-10 w-[520px] max-h-[80vh] bg-bg-secondary border border-border rounded-xl shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">编辑任务</h3>
            {!isEditable && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" />
                仅查看
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 标题 */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">任务标题 *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={!isEditable}
              maxLength={100}
              placeholder="输入任务标题..."
              className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue disabled:opacity-60"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">任务描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={!isEditable}
              rows={3}
              placeholder="详细描述任务内容（可选）..."
              className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none disabled:opacity-60"
            />
          </div>

          {/* 优先级 */}
          <div>
            <label className="block text-xs text-text-secondary mb-2">优先级</label>
            <div className="flex gap-2">
              {PRIORITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => isEditable && setPriority(opt.value as any)}
                  disabled={!isEditable}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    priority === opt.value
                      ? opt.value === 'critical' ? 'bg-red-500/20 text-red-400 border-red-500/50' :
                        opt.value === 'high' ? 'bg-orange-500/20 text-orange-400 border-orange-500/50' :
                        opt.value === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50' :
                        'bg-green-500/20 text-green-400 border-green-500/50'
                      : 'bg-bg-tertiary text-text-muted border-border hover:border-text-muted/50 disabled:opacity-60'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1.5">指派成员</label>
            <select
              value={assignedMemberId}
              onChange={e => setAssignedMemberId(e.target.value)}
              disabled={!isEditable}
              className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-blue disabled:opacity-60"
            >
              <option value="">未指派</option>
              {members.map((member: any) => (
                <option key={member.id} value={member.id}>
                  {member.role?.icon || '👤'} {member.role?.name || member.roleId}
                </option>
              ))}
            </select>
          </div>

          {/* 依赖任务 */}
          {isEditable && (
            <div>
              <label className="block text-xs text-text-secondary mb-2">
                依赖任务
                <span className="ml-1.5 text-[10px] text-text-muted">
                  （需等待所选任务完成后，当前任务才可执行）
                </span>
              </label>
              {availableTasks.length === 0 ? (
                <p className="text-xs text-text-muted py-2">暂无可选依赖任务</p>
              ) : (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {availableTasks.map(t => {
                    const isSelected = selectedDeps.has(t.id)
                    return (
                      <label
                        key={t.id}
                        className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-accent-blue/10 border-accent-blue/40'
                            : 'bg-bg-tertiary border-border hover:border-text-muted/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDep(t.id)}
                          className="w-3.5 h-3.5 rounded accent-accent-blue"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-text-primary truncate">{t.title}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] px-1 py-0.5 rounded ${
                              t.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {t.status === 'completed' ? '已完成' : '待办'}
                            </span>
                            <span className={`text-[10px] ${
                              t.priority === 'critical' ? 'text-red-400' :
                              t.priority === 'high' ? 'text-orange-400' :
                              t.priority === 'medium' ? 'text-yellow-400' : 'text-green-400'
                            }`}>
                              {t.priority === 'critical' ? '紧急' : t.priority === 'high' ? '高' : t.priority === 'medium' ? '中' : '低'}
                            </span>
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 依赖提示（非编辑模式） */}
          {!isEditable && task.dependencies && task.dependencies.length > 0 && (
            <div>
              <label className="block text-xs text-text-secondary mb-2">依赖任务</label>
              <div className="flex flex-wrap gap-1.5">
                {task.dependencies.map(depId => {
                  const dep = allTasks.find(t => t.id === depId)
                  return (
                    <span key={depId} className="text-[10px] px-2 py-1 rounded bg-bg-tertiary border border-border text-text-secondary">
                      {dep?.title || depId.slice(0, 8)}...
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* 结果 */}
          {task.result && (
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">执行结果</label>
              <div className="p-3 rounded-lg bg-bg-tertiary border border-border text-xs text-text-secondary whitespace-pre-wrap">
                {task.result}
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
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
  )
}
