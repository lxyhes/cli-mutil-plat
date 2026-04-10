/**
 * Agent Teams - 团队主视图
 *
 * 显示团队成员、任务、消息流，支持实时更新
 *
 * @author weibin
 */

import { useState, useEffect } from 'react'
import {
  Users, MessageSquare, ListChecks, BarChart, Send, Plus, Play,
  CheckCircle, AlertTriangle, Clock, Activity, X, RefreshCw
} from 'lucide-react'
import { useTeamStore, initTeamEventListeners } from '../../stores/teamStore'

type TabType = 'conversation' | 'tasks' | 'messages' | 'status'

export default function TeamSessionView() {
  const {
    activeTeamId, teams, teamTasks, teamMessages, teamHealth,
    fetchTeamTasks, fetchTeamMessages, fetchTeamHealth,
    createTask, setActiveTeam
  } = useTeamStore()
  const [activeTab, setActiveTab] = useState<TabType>('status')
  const [selectedMember, setSelectedMember] = useState<any>(null)
  const [showNewTaskDialog, setShowNewTaskDialog] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [isCreatingTask, setIsCreatingTask] = useState(false)

  const team = teams.find(t => t.id === activeTeamId)
  const tasks = teamTasks[activeTeamId || ''] || []
  const messages = teamMessages[activeTeamId || ''] || []
  const health = teamHealth[activeTeamId || '']

  // 初始化事件监听
  useEffect(() => {
    initTeamEventListeners()
  }, [])

  // 加载数据
  useEffect(() => {
    if (activeTeamId) {
      fetchTeamTasks(activeTeamId)
      fetchTeamMessages(activeTeamId, 100)
      fetchTeamHealth(activeTeamId)
      // 定期刷新健康状态
      const interval = setInterval(() => fetchTeamHealth(activeTeamId), 30000)
      return () => clearInterval(interval)
    }
  }, [activeTeamId])

  // 创建任务
  const handleCreateTask = async () => {
    if (!activeTeamId || !newTaskTitle.trim()) return
    setIsCreatingTask(true)
    try {
      await createTask(activeTeamId, {
        title: newTaskTitle,
        description: newTaskDesc,
        priority: newTaskPriority,
        status: 'pending',
        dependencies: []
      })
      setShowNewTaskDialog(false)
      setNewTaskTitle('')
      setNewTaskDesc('')
      setNewTaskPriority('medium')
    } finally {
      setIsCreatingTask(false)
    }
  }

  const completedTasks = tasks.filter(t => t.status === 'completed').length
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length
  const pendingTasks = tasks.filter(t => t.status === 'pending').length
  const progressPercent = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0

  const tabs: { key: TabType; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'conversation', label: '角色', icon: <Users size={14} /> },
    { key: 'tasks', label: '任务', icon: <ListChecks size={14} />, badge: pendingTasks },
    { key: 'messages', label: '消息', icon: <MessageSquare size={14} />, badge: messages.length },
    { key: 'status', label: '状态', icon: <BarChart size={14} /> },
  ]

  if (!team) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <Users className="w-16 h-16 mb-4 opacity-30" />
        <p className="text-sm">选择一个团队查看或创建新团队</p>
        <p className="text-xs mt-2 opacity-50">从左侧边栏选择团队</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* 团队头部 */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">{team.name}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${
              team.status === 'running' ? 'bg-accent-green/20 text-accent-green' :
              team.status === 'completed' ? 'bg-accent-blue/20 text-accent-blue' :
              team.status === 'failed' ? 'bg-accent-red/20 text-accent-red' :
              'bg-text-muted/20 text-text-muted'
            }`}>
              {team.status === 'running' && <Activity size={10} />}
              {team.status === 'running' ? '运行中' :
               team.status === 'completed' ? '已完成' :
               team.status === 'failed' ? '已失败' : '已停止'}
            </span>
          </div>
          <button
            onClick={() => fetchTeamHealth(activeTeamId!)}
            className="p-1.5 text-text-muted hover:text-text-secondary hover:bg-bg-hover rounded transition-colors"
            title="刷新状态"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {/* 进度条 */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-text-muted">任务进度</span>
            <span className="text-text-secondary">{completedTasks}/{tasks.length} ({progressPercent}%)</span>
          </div>
          <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-green transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
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
                  ? 'bg-accent-blue/15 text-accent-blue ring-1 ring-accent-blue/30'
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
              transition-colors relative
              ${activeTab === tab.key
                ? 'bg-accent-blue/15 text-accent-blue'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-accent-red text-white text-[10px] rounded-full flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'conversation' && (
          <div className="p-4">
            {selectedMember ? (
              <div className="bg-bg-secondary rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{selectedMember.role?.icon}</span>
                    <div>
                      <h3 className="text-sm font-medium text-text-primary">
                        {selectedMember.role?.name}
                      </h3>
                      <span className="text-xs text-text-muted">
                        {selectedMember.role?.identifier}
                        {selectedMember.role?.isLeader && ' 👑'}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    selectedMember.status === 'running' ? 'bg-accent-green/20 text-accent-green' :
                    selectedMember.status === 'completed' ? 'bg-accent-blue/20 text-accent-blue' :
                    selectedMember.status === 'failed' ? 'bg-accent-red/20 text-accent-red' :
                    'bg-text-muted/20 text-text-muted'
                  }`}>
                    {selectedMember.status}
                  </span>
                </div>
                {selectedMember.currentTaskId && (
                  <div className="mb-3 p-2 bg-accent-blue/10 rounded text-xs text-accent-blue">
                    当前任务: {selectedMember.currentTaskId}
                  </div>
                )}
                <div className="text-xs text-text-muted mb-2">
                  加入时间: {new Date(selectedMember.joinedAt).toLocaleString()}
                </div>
                <details className="mt-3">
                  <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
                    查看系统 Prompt
                  </summary>
                  <pre className="mt-2 text-xs text-text-secondary whitespace-pre-wrap max-h-[300px] overflow-y-auto p-2 bg-bg-tertiary rounded">
                    {selectedMember.role?.systemPrompt || '无'}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="text-center text-text-muted py-8">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">点击顶部成员卡片查看角色详情</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-text-primary">任务列表</h3>
                <span className="text-xs text-text-muted">({pendingTasks} 待办, {inProgressTasks} 进行中)</span>
              </div>
              <button
                onClick={() => setShowNewTaskDialog(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-accent-blue text-white rounded hover:bg-accent-blue/80 transition-colors"
              >
                <Plus size={12} />
                新建任务
              </button>
            </div>

            {/* 新建任务对话框 */}
            {showNewTaskDialog && (
              <div className="mb-4 p-4 bg-bg-secondary rounded-lg border border-accent-blue/30">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-text-primary">新建任务</span>
                  <button onClick={() => setShowNewTaskDialog(false)} className="text-text-muted hover:text-text-secondary">
                    <X size={14} />
                  </button>
                </div>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    placeholder="任务标题"
                    className="w-full px-3 py-2 text-xs rounded bg-bg-tertiary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                  />
                  <textarea
                    value={newTaskDesc}
                    onChange={e => setNewTaskDesc(e.target.value)}
                    placeholder="任务描述（可选）"
                    rows={2}
                    className="w-full px-3 py-2 text-xs rounded bg-bg-tertiary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">优先级:</span>
                    {(['low', 'medium', 'high', 'critical'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setNewTaskPriority(p)}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${
                          newTaskPriority === p
                            ? p === 'critical' ? 'bg-red-500/20 text-red-500 ring-1 ring-red-500/50' :
                              p === 'high' ? 'bg-orange-500/20 text-orange-500 ring-1 ring-orange-500/50' :
                              p === 'medium' ? 'bg-yellow-500/20 text-yellow-500 ring-1 ring-yellow-500/50' :
                              'bg-green-500/20 text-green-500 ring-1 ring-green-500/50'
                            : 'bg-bg-tertiary text-text-muted hover:text-text-secondary'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleCreateTask}
                    disabled={isCreatingTask || !newTaskTitle.trim()}
                    className="w-full px-3 py-2 text-xs bg-accent-blue text-white rounded hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isCreatingTask ? '创建中...' : '创建任务'}
                  </button>
                </div>
              </div>
            )}

            {tasks.length === 0 ? (
              <div className="text-center text-text-muted py-8">
                <ListChecks className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无任务</p>
                <button
                  onClick={() => setShowNewTaskDialog(true)}
                  className="mt-2 text-xs text-accent-blue hover:underline"
                >
                  创建第一个任务
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map(task => {
                  const assignee = team.members?.find(m => m.id === task.claimedBy)
                  return (
                    <div key={task.id} className={`p-3 bg-bg-secondary rounded-lg border ${
                      task.status === 'completed' ? 'border-accent-green/30 opacity-75' :
                      task.status === 'in_progress' ? 'border-accent-blue/30' :
                      'border-border'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {task.status === 'completed' && <CheckCircle size={14} className="text-accent-green" />}
                          {task.status === 'in_progress' && <Play size={14} className="text-accent-blue" />}
                          {task.status === 'pending' && <Clock size={14} className="text-text-muted" />}
                          <span className={`text-sm font-medium ${
                            task.status === 'completed' ? 'text-text-muted line-through' : 'text-text-primary'
                          }`}>
                            {task.title}
                          </span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          task.priority === 'critical' ? 'bg-red-500/20 text-red-500' :
                          task.priority === 'high' ? 'bg-orange-500/20 text-orange-500' :
                          task.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-500' :
                          'bg-green-500/20 text-green-500'
                        }`}>
                          {task.priority}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-xs text-text-muted mb-2">{task.description}</p>
                      )}
                      {assignee && (
                        <div className="flex items-center gap-2 text-[10px] text-text-muted">
                          <span>{assignee.role?.icon}</span>
                          <span>{assignee.role?.name}</span>
                          {task.claimedAt && (
                            <span>• {new Date(task.claimedAt).toLocaleTimeString()}</span>
                          )}
                        </div>
                      )}
                      {task.result && (
                        <div className="mt-2 p-2 bg-bg-tertiary rounded text-xs text-text-secondary">
                          结果: {task.result}
                        </div>
                      )}
                    </div>
                  )
                })}
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
                  <p className="text-xs mt-1 opacity-70">团队成员之间的通信消息会显示在这里</p>
                </div>
              ) : (
                messages.map(msg => {
                  const sender = team.members?.find(m => m.id === msg.from)
                  return (
                    <div key={msg.id} className={`flex gap-2 ${msg.type === 'broadcast' ? 'flex-col' : ''}`}>
                      {msg.type !== 'broadcast' && sender && (
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center text-sm">
                          {sender.role?.icon || '👤'}
                        </div>
                      )}
                      <div className={`flex-1 ${msg.type === 'broadcast' ? '' : ''}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-text-primary">
                            {msg.type === 'broadcast' ? '📢 广播' : sender?.role?.name || '未知'}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className={`p-3 rounded-lg ${
                          msg.type === 'broadcast'
                            ? 'bg-accent-purple/10 border border-accent-purple/30'
                            : 'bg-bg-secondary'
                        }`}>
                          <p className="text-xs text-text-secondary whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="p-4 border-t border-border">
              <div className="text-center text-[10px] text-text-muted">
                消息由团队成员通过 team_message_role / team_broadcast 工具发送
              </div>
            </div>
          </div>
        )}

        {activeTab === 'status' && (
          <div className="p-4">
            {/* 健康状态 */}
            {health && (
              <div className={`mb-4 p-3 rounded-lg border ${
                health.healthy ? 'border-accent-green/30 bg-accent-green/5' :
                'border-accent-red/30 bg-accent-red/5'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {health.healthy ? (
                    <CheckCircle size={16} className="text-accent-green" />
                  ) : (
                    <AlertTriangle size={16} className="text-accent-red" />
                  )}
                  <span className={`text-sm font-medium ${
                    health.healthy ? 'text-accent-green' : 'text-accent-red'
                  }`}>
                    {health.healthy ? '团队健康' : '存在问题'}
                  </span>
                </div>
                {health.issues.length > 0 && (
                  <div className="space-y-1">
                    {health.issues.map((issue: TeamHealthIssue, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                        <span className={`${
                          issue.severity === 'critical' ? 'text-accent-red' :
                          issue.severity === 'error' ? 'text-orange-500' :
                          'text-yellow-500'
                        }`}>•</span>
                        <span>{issue.message}</span>
                        {issue.autoFixed && (
                          <span className="text-[10px] text-accent-green">(已自动修复)</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <h3 className="text-sm font-medium text-text-primary mb-4">团队状态总览</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-bg-secondary rounded-lg border border-border">
                <div className="text-xs text-text-muted mb-1">总任务数</div>
                <div className="text-2xl font-bold text-text-primary">{tasks.length}</div>
              </div>
              <div className="p-4 bg-bg-secondary rounded-lg border border-border">
                <div className="text-xs text-text-muted mb-1">已完成</div>
                <div className="text-2xl font-bold text-accent-green">{completedTasks}</div>
              </div>
              <div className="p-4 bg-bg-secondary rounded-lg border border-border">
                <div className="text-xs text-text-muted mb-1">进行中</div>
                <div className="text-2xl font-bold text-accent-blue">{inProgressTasks}</div>
              </div>
              <div className="p-4 bg-bg-secondary rounded-lg border border-border">
                <div className="text-xs text-text-muted mb-1">待处理</div>
                <div className="text-2xl font-bold text-yellow-500">{pendingTasks}</div>
              </div>
            </div>

            {/* 成员状态 */}
            <h3 className="text-sm font-medium text-text-primary mt-6 mb-3">成员状态</h3>
            <div className="space-y-2">
              {team.members?.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between p-3 bg-bg-secondary rounded-lg border border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{member.role?.icon || '👤'}</span>
                    <div>
                      <div className="text-sm text-text-primary">{member.role?.name}</div>
                      <div className="text-xs text-text-muted">{member.role?.identifier}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                      member.status === 'running' ? 'bg-accent-green/20 text-accent-green' :
                      member.status === 'completed' ? 'bg-accent-blue/20 text-accent-blue' :
                      member.status === 'failed' ? 'bg-accent-red/20 text-accent-red' :
                      'bg-text-muted/20 text-text-muted'
                    }`}>
                      {member.status === 'running' && <Activity size={10} />}
                      {member.status}
                    </div>
                    {member.lastActiveAt && (
                      <div className="text-[10px] text-text-muted mt-1">
                        最后活跃: {new Date(member.lastActiveAt).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 团队信息 */}
            <h3 className="text-sm font-medium text-text-primary mt-6 mb-3">团队信息</h3>
            <div className="bg-bg-secondary rounded-lg border border-border p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-text-muted">团队名称</span>
                <span className="text-text-primary">{team.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">目标</span>
                <span className="text-text-primary max-w-[200px] truncate" title={team.objective}>
                  {team.objective || '无'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">工作目录</span>
                <span className="text-text-primary max-w-[200px] truncate" title={team.workDir}>
                  {team.workDir}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">创建时间</span>
                <span className="text-text-primary">{new Date(team.createdAt).toLocaleString()}</span>
              </div>
              {team.startedAt && (
                <div className="flex justify-between">
                  <span className="text-text-muted">启动时间</span>
                  <span className="text-text-primary">{new Date(team.startedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
