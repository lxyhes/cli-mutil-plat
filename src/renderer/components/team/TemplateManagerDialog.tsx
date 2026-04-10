/**
 * Agent Teams - 模板管理弹窗
 * 创建/编辑/删除自定义团队模板
 * @author weibin
 */

import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Edit2, Lock, ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'
import { v4 as uuidv4 } from 'uuid'
import type { TeamTemplate, TeamRole } from '../../../shared/types'

/** 预设角色模板 */
const PRESET_ROLES: Omit<TeamRole, 'id'>[] = [
  {
    name: '项目经理', identifier: 'pm', icon: '📋', color: 'text-orange-500',
    description: '负责整体项目管理和协调', isLeader: false,
    systemPrompt: '你是项目经理，负责项目的整体规划、任务分配和进度跟踪。你需要与团队成员保持沟通，确保项目按计划推进。',
  },
  {
    name: '架构师', identifier: 'architect', icon: '🏗️', color: 'text-purple-500',
    description: '负责系统架构设计', isLeader: false,
    systemPrompt: '你是技术架构师，负责系统架构设计和技术选型。你需要设计可扩展、高性能的系统架构，并指导团队遵循架构规范。',
  },
  {
    name: '后端工程师', identifier: 'backend', icon: '🔧', color: 'text-blue-500',
    description: '负责后端服务开发', isLeader: false,
    systemPrompt: '你是后端工程师，负责后端服务和 API 开发。你需要根据架构设计实现高质量的后端代码。',
  },
  {
    name: '前端工程师', identifier: 'frontend', icon: '🎨', color: 'text-green-500',
    description: '负责前端界面开发', isLeader: false,
    systemPrompt: '你是前端工程师，负责用户界面和交互开发。你需要实现美观的 UI 并确保良好的用户体验。',
  },
  {
    name: '测试工程师', identifier: 'tester', icon: '🧪', color: 'text-red-500',
    description: '负责质量保证和测试', isLeader: false,
    systemPrompt: '你是测试工程师，负责编写和执行测试用例，确保产品质量。你需要发现并报告 Bug。',
  },
  {
    name: 'DevOps 工程师', identifier: 'devops', icon: '🚀', color: 'text-cyan-500',
    description: '负责运维和部署', isLeader: false,
    systemPrompt: '你是 DevOps 工程师，负责 CI/CD 流程、容器化部署和系统监控。',
  },
]

const EMOJI_OPTIONS = ['👑', '📋', '🏗️', '🔧', '🎨', '🧪', '🚀', '📡', '🔍', '⚡', '🌐', '💾', '🎯', '🤖', '📊', '🔒']

function RoleCard({ role, index, onChange, onDelete, canDelete }: {
  role: TeamRole
  index: number
  onChange: (role: TeamRole) => void
  onDelete: () => void
  canDelete: boolean
}) {
  const [expanded, setExpanded] = useState(index === 0)

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary hover:bg-bg-hover btn-transition cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
        <span className="text-lg">{role.icon}</span>
        <span className="text-xs font-medium text-text-primary flex-1">{role.name}</span>
        {role.isLeader && <span className="text-[10px] text-orange-400 bg-orange-500/15 px-1.5 py-0.5 rounded">Leader</span>}
        <span className="text-[10px] text-text-muted">{role.identifier}</span>
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1 text-text-muted hover:text-red-400 rounded transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="p-3 space-y-3 border-t border-border">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-text-muted mb-1">角色名称</label>
              <input
                value={role.name}
                onChange={e => onChange({ ...role, name: e.target.value, identifier: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                className="w-full px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent-blue"
              />
            </div>
            <div>
              <label className="block text-[10px] text-text-muted mb-1">标识符</label>
              <input
                value={role.identifier}
                onChange={e => onChange({ ...role, identifier: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                className="w-full px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary font-mono focus:outline-none focus:border-accent-blue"
              />
            </div>
          </div>

          {/* 图标选择 */}
          <div>
            <label className="block text-[10px] text-text-muted mb-1">图标</label>
            <div className="flex flex-wrap gap-1">
              {EMOJI_OPTIONS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => onChange({ ...role, icon: emoji })}
                  className={`w-7 h-7 rounded text-sm flex items-center justify-center transition-colors ${
                    role.icon === emoji ? 'bg-accent-blue/20 ring-1 ring-accent-blue/50' : 'hover:bg-bg-hover'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-[10px] text-text-muted mb-1">角色描述</label>
            <input
              value={role.description}
              onChange={e => onChange({ ...role, description: e.target.value })}
              className="w-full px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent-blue"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-[10px] text-text-muted mb-1">System Prompt</label>
            <textarea
              value={role.systemPrompt}
              onChange={e => onChange({ ...role, systemPrompt: e.target.value })}
              rows={4}
              className="w-full px-2 py-1.5 text-xs bg-bg-secondary border border-border rounded text-text-primary focus:outline-none focus:border-accent-blue resize-none font-mono"
            />
          </div>

          {/* 预设 Prompt */}
          <div>
            <label className="block text-[10px] text-text-muted mb-1">快速填充 Prompt</label>
            <div className="flex flex-wrap gap-1">
              {PRESET_ROLES.filter(p => p.identifier !== role.identifier).map(preset => (
                <button
                  key={preset.identifier}
                  onClick={() => onChange({ ...role, systemPrompt: preset.systemPrompt })}
                  className="text-[10px] px-2 py-1 rounded bg-bg-tertiary text-text-muted hover:text-text-secondary hover:bg-bg-hover border border-border transition-colors"
                >
                  {preset.icon} {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* 是否为 Leader */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={role.isLeader}
              onChange={e => onChange({ ...role, isLeader: e.target.checked })}
              className="w-3 h-3 rounded accent-orange-500"
            />
            <span className="text-xs text-text-secondary">设为团队 Leader（唯一）</span>
          </label>
        </div>
      )}
    </div>
  )
}

interface TemplateManagerDialogProps {
  onClose: () => void
}

export default function TemplateManagerDialog({ onClose }: TemplateManagerDialogProps) {
  const { templates, createTemplate, updateTemplate, deleteTemplate, fetchTemplates } = useTeamStore()
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
  const [editingTemplate, setEditingTemplate] = useState<TeamTemplate | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [roles, setRoles] = useState<TeamRole[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const isBuiltin = (t: TeamTemplate) => t.id.startsWith('dev-') || t.id === 'dev-team'

  const startCreate = () => {
    setName('')
    setDescription('')
    setRoles([{
      id: uuidv4(), name: '团队负责人', identifier: 'leader', icon: '👑',
      color: 'text-orange-500', description: '团队总指挥', isLeader: true,
      systemPrompt: '你是团队负责人，负责整体协调和任务分配...',
    }])
    setMode('create')
    setError(null)
  }

  const startEdit = (t: TeamTemplate) => {
    setEditingTemplate(t)
    setName(t.name)
    setDescription(t.description)
    setRoles([...t.roles])
    setMode('edit')
    setError(null)
  }

  const handleDelete = async (templateId: string) => {
    if (isBuiltin(templates.find(t => t.id === templateId)!)) return
    await deleteTemplate(templateId)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('模板名称不能为空'); return }
    if (roles.length === 0) { setError('至少需要 1 个角色'); return }
    if (!roles.some(r => r.isLeader)) { setError('必须指定一个 Leader 角色'); return }

    setSaving(true)
    setError(null)
    try {
      if (mode === 'create') {
        const template: any = {
          id: uuidv4(),
          name: name.trim(),
          description: description.trim(),
          roles,
        }
        await createTemplate(template)
      } else if (mode === 'edit' && editingTemplate) {
        await updateTemplate(editingTemplate.id, { name: name.trim(), description: description.trim(), roles })
      }
      setMode('list')
      setEditingTemplate(null)
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const addRole = (preset?: Omit<TeamRole, 'id'>) => {
    const newRole: TeamRole = {
      id: uuidv4(),
      name: preset?.name || '新角色',
      identifier: preset?.identifier || 'new-role',
      icon: preset?.icon || '👤',
      color: preset?.color || 'text-gray-400',
      description: preset?.description || '',
      isLeader: false,
      systemPrompt: preset?.systemPrompt || '',
    }
    setRoles([...roles, newRole])
  }

  const updateRole = (index: number, role: TeamRole) => {
    const next = [...roles]
    // 如果设为 Leader，取消其他人的 Leader 状态
    if (role.isLeader) {
      for (let i = 0; i < next.length; i++) {
        if (i !== index) next[i] = { ...next[i], isLeader: false }
      }
    }
    next[index] = role
    setRoles(next)
  }

  const deleteRole = (index: number) => {
    setRoles(roles.filter((_, i) => i !== index))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[680px] max-h-[85vh] bg-bg-secondary border border-border rounded-xl shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">
            {mode === 'list' ? '团队模板管理' : mode === 'create' ? '创建模板' : '编辑模板'}
          </h3>
          <button onClick={mode === 'list' ? onClose : () => setMode('list')} className="p-1 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'list' ? (
            <>
              {/* 创建按钮 */}
              <button
                onClick={startCreate}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-accent-blue/50 text-accent-blue text-xs hover:bg-accent-blue/10 btn-transition mb-4"
              >
                <Plus className="w-3.5 h-3.5" />
                创建自定义模板
              </button>

              {/* 模板列表 */}
              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-bg-primary hover:border-accent-blue/30 btn-transition">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-text-primary">{t.name}</span>
                        {isBuiltin(t) && (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-400">
                            <Lock className="w-2.5 h-2.5" /> 内置
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-text-muted truncate">{t.description || '暂无描述'}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {t.roles.map(r => (
                          <span key={r.id} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">
                            {r.icon} {r.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    {!isBuiltin(t) && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(t)}
                          className="p-1.5 text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 rounded transition-colors"
                          title="编辑"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5">模板名称 *</label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1.5">描述</label>
                  <input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                </div>
              </div>

              {/* 角色列表 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-text-secondary">角色 ({roles.length})</label>
                  <div className="flex gap-2">
                    <button onClick={() => addRole()} className="text-[10px] px-2 py-1 rounded border border-border text-text-muted hover:text-text-secondary btn-transition">
                      + 空角色
                    </button>
                    <div className="relative group">
                      <button className="text-[10px] px-2 py-1 rounded border border-border text-text-muted hover:text-text-secondary btn-transition">
                        + 预设角色 ▾
                      </button>
                      <div className="absolute right-0 top-7 z-10 hidden group-hover:block w-44 bg-bg-secondary border border-border rounded-lg shadow-lg py-1">
                        {PRESET_ROLES.map(p => (
                          <button
                            key={p.identifier}
                            onClick={() => addRole(p)}
                            className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover flex items-center gap-2"
                          >
                            <span>{p.icon}</span>{p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {roles.map((role, i) => (
                    <RoleCard
                      key={role.id}
                      role={role}
                      index={i}
                      onChange={r => updateRole(i, r)}
                      onDelete={() => deleteRole(i)}
                      canDelete={roles.length > 1}
                    />
                  ))}
                </div>
                {roles.length === 0 && (
                  <div className="text-center py-6 text-text-muted text-xs">暂无角色，请添加</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        {mode !== 'list' && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            <button
              onClick={() => setMode('list')}
              className="px-4 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border rounded-lg hover:bg-bg-hover transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 disabled:opacity-60 transition-colors"
            >
              {saving ? '保存中...' : '保存模板'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
