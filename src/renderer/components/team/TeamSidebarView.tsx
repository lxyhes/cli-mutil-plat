/**
 * Agent Teams - 侧边栏视图
 * 
 * 显示团队列表、运行状态、模板
 * 
 * @author weibin
 */

import { useState, useEffect } from 'react'
import { Users, Plus, Play, History, LayoutTemplate, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'

export default function TeamSidebarView() {
  const { teams, activeTeamId, templates, loading, fetchTeams, fetchTemplates, setActiveTeam } = useTeamStore()
  const [showTemplates, setShowTemplates] = useState(false)

  useEffect(() => {
    fetchTeams()
    fetchTemplates()
  }, [fetchTeams, fetchTemplates])

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Play size={12} className="text-accent-green" />
      case 'completed': return <CheckCircle size={12} className="text-accent-blue" />
      case 'failed': return <XCircle size={12} className="text-accent-red" />
      default: return <AlertTriangle size={12} className="text-text-muted" />
    }
  }

  const handleCreateTeam = () => {
    // TODO: 打开创建团队对话框
    console.log('Create team clicked')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden select-none bg-bg-primary">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Agent Teams
          </span>
        </div>
        <button
          onClick={handleCreateTeam}
          title="创建新团队"
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 列表区域 */}
      <div className="flex-1 overflow-y-auto">
        {/* 运行中 */}
        <div className="px-2 py-1">
          <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] text-text-muted uppercase">
            <Play size={10} />
            <span>运行中</span>
            <span className="ml-auto">{teams.filter(t => t.status === 'running').length}</span>
          </div>
          {teams.filter(t => t.status === 'running').map(team => (
            <button
              key={team.id}
              onClick={() => setActiveTeam(team.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left
                transition-colors text-xs
                ${activeTeamId === team.id
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'hover:bg-bg-hover text-text-secondary'}`}
            >
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {statusIcon(team.status)}
                <span className="truncate">{team.name}</span>
              </div>
              <div className="flex items-center gap-0.5 text-[10px] text-text-muted">
                <Users size={10} />
                <span>{team.members?.length || 0}</span>
              </div>
            </button>
          ))}
        </div>

        {/* 历史记录 */}
        <div className="px-2 py-1">
          <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] text-text-muted uppercase">
            <History size={10} />
            <span>历史记录</span>
          </div>
          {teams.filter(t => t.status !== 'running').map(team => (
            <button
              key={team.id}
              onClick={() => setActiveTeam(team.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left
                transition-colors text-xs
                ${activeTeamId === team.id
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'hover:bg-bg-hover text-text-secondary'}`}
            >
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {statusIcon(team.status)}
                <span className="truncate">{team.name}</span>
              </div>
            </button>
          ))}
        </div>

        {/* 模板 */}
        <div className="px-2 py-1">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full flex items-center gap-1.5 px-1 py-1 text-[10px] text-text-muted uppercase hover:text-text-secondary"
          >
            <LayoutTemplate size={10} />
            <span>模板</span>
            <span className="ml-auto">{showTemplates ? '▲' : '▼'}</span>
          </button>
          {showTemplates && templates.map(template => (
            <div key={template.id} className="px-2 py-1.5 text-xs text-text-secondary">
              <div className="font-medium">{template.name}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {template.roles?.map(role => (
                  <span
                    key={role.id}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary text-text-muted"
                  >
                    {role.icon} {role.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
