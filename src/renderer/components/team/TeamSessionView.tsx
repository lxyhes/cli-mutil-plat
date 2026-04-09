/**
 * Agent Teams - 团队主视图
 * 
 * 显示团队成员、任务、消息流
 * 
 * @author weibin
 */

import { useState, useEffect } from 'react'
import { Users, MessageSquare, ListChecks, BarChart, Eye, FileText, ChevronDown, Send } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'

type TabType = 'conversation' | 'tasks' | 'messages' | 'status' | 'review' | 'office'

export default function TeamSessionView() {
  const { activeTeamId, teams, fetchTeamTasks, fetchTeamMessages } = useTeamStore()
  const [activeTab, setActiveTab] = useState<TabType>('conversation')
  const [tasks, setTasks] = useState<any[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [selectedMember, setSelectedMember] = useState<any>(null)

  const team = teams.find(t => t.id === activeTeamId)

  useEffect(() => {
    if (activeTeamId) {
      fetchTeamTasks(activeTeamId).then(setTasks)
      fetchTeamMessages(activeTeamId, 50).then(setMessages)
    }
  }, [activeTeamId])

  if (!team) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <Users className="w-16 h-16 mb-4 opacity-30" />
        <p className="text-sm">选择一个团队查看或创建新团队</p>
      </div>
    )
  }

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'conversation', label: '对话', icon: <MessageSquare size={14} /> },
    { key: 'tasks', label: '任务', icon: <ListChecks size={14} /> },
    { key: 'messages', label: '消息', icon: <MessageSquare size={14} /> },
    { key: 'status', label: '状态总览', icon: <BarChart size={14} /> },
    { key: 'review', label: '评审', icon: <Eye size={14} /> },
    { key: 'office', label: '办公室', icon: <FileText size={14} /> },
  ]

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 团队头部 */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">{team.name}</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent-green/20 text-accent-green">
              运行中
            </span>
            <span className="text-xs text-text-muted">
              {team.members?.length || 0} 成员
            </span>
          </div>
        </div>

        {/* 成员卡片 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {team.members?.map((member: any) => (
            <button
              key={member.id}
              onClick={() => setSelectedMember(selectedMember?.id === member.id ? null : member)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs whitespace-nowrap
                transition-colors
                ${selectedMember?.id === member.id
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover'}`}
            >
              <span>{member.role?.icon || '👤'}</span>
              <span>{member.role?.name || member.roleId}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${
                member.status === 'running' ? 'bg-accent-green' :
                member.status === 'completed' ? 'bg-accent-blue' :
                member.status === 'failed' ? 'bg-accent-red' :
                'bg-text-muted'
              }`} />
            </button>
          ))}
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs
              transition-colors
              ${activeTab === tab.key
                ? 'bg-accent-blue/15 text-accent-blue'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'conversation' && (
          <div className="p-4">
            {selectedMember ? (
              <div className="bg-bg-secondary rounded-lg border border-border p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{selectedMember.role?.icon}</span>
                  <div>
                    <h3 className="text-sm font-medium text-text-primary">
                      你的角色：{selectedMember.role?.name}
                    </h3>
                    <span className="text-xs text-text-muted">
                      {selectedMember.role?.identifier}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                  {selectedMember.role?.systemPrompt || '暂无角色描述'}
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <button className="flex items-center gap-1 text-xs text-accent-blue hover:text-accent-blue/70">
                    <ChevronDown size={12} />
                    <span>展开全部 ({selectedMember.role?.systemPrompt?.length || 0} 字)</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center text-text-muted py-8">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">选择一个成员查看对话</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="p-4">
            {tasks.length === 0 ? (
              <div className="text-center text-text-muted py-8">
                <ListChecks className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无任务</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map(task => (
                  <div key={task.id} className="p-3 bg-bg-secondary rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text-primary">{task.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        task.priority === 'critical' ? 'bg-red-500/20 text-red-500' :
                        task.priority === 'high' ? 'bg-orange-500/20 text-orange-500' :
                        task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-500' :
                        'bg-green-500/20 text-green-500'
                      }`}>
                        {task.priority}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted">{task.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="text-center text-text-muted py-8">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">暂无消息</p>
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className="flex gap-2">
                    <div className="flex-1 bg-bg-secondary rounded-lg p-3">
                      <p className="text-xs text-text-secondary whitespace-pre-wrap">{msg.content}</p>
                      <span className="text-[10px] text-text-muted mt-1 block">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-4 border-t border-border">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="输入消息..."
                  className="flex-1 px-3 py-2 text-xs rounded-lg bg-bg-secondary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                />
                <button className="p-2 bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 transition-colors">
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'status' && (
          <div className="p-4">
            <div className="text-center text-text-muted py-8">
              <BarChart className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">状态总览开发中...</p>
            </div>
          </div>
        )}

        {activeTab === 'review' && (
          <div className="p-4">
            <div className="text-center text-text-muted py-8">
              <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">评审功能开发中...</p>
            </div>
          </div>
        )}

        {activeTab === 'office' && (
          <div className="p-4">
            <div className="text-center text-text-muted py-8">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">办公室功能开发中...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
