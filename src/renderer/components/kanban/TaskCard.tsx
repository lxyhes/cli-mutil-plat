/**
 * 任务卡片组件
 * 显示任务信息，支持拖拽、右键菜单、编辑弹窗、会话联动
 * @author weibin
 */

import React, { useState, useMemo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Play, Eye, Pencil, Trash2, Copy, Flag, ArrowRight, GitBranch, Users, Loader2,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { TaskCard as TaskCardType, Session } from '../../../shared/types'
import { useUIStore } from '../../stores/uiStore'
import { useTaskStore } from '../../stores/taskStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTeamStore } from '../../stores/teamStore'
import { PRIORITY_COLORS, KANBAN_COLUMNS } from '../../../shared/constants'
import { useContextMenu } from '../../hooks/useContextMenu'
import ContextMenu from '../common/ContextMenu'
import type { MenuItem } from '../common/ContextMenu'
import ConfirmDialog from '../common/ConfirmDialog'
import TaskEditDialog from './TaskEditDialog'

interface TaskCardProps {
  task: TaskCardType
  sessions?: Session[]
}

const TaskCard: React.FC<TaskCardProps> = ({ task, sessions = [] }) => {
  const { selectedTaskId, setSelectedTaskId } = useUIStore()
  const { updateTask, deleteTask, copyTask, startSessionForTask } = useTaskStore()
  const { selectSession } = useSessionStore()
  const {
    createTeam,
    createTask: createTeamTask,
    setActiveTeam,
  } = useTeamStore()

  // 右键菜单
  const { menuState, showMenu, hideMenu } = useContextMenu()

  // 弹窗状态
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [dispatchingTeam, setDispatchingTeam] = useState(false)

  // 菜单或弹窗打开时禁用拖拽
  const isDragDisabled = menuState.visible || editDialogOpen || confirmDeleteOpen

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: isDragDisabled })

  // 查找该任务的活跃会话
  const activeSession = sessions.find(
    (s) =>
      s.config?.taskId === task.id &&
      (s.status === 'running' || s.status === 'idle' || s.status === 'waiting_input' || s.status === 'starting')
  )
  const hasActiveSession = !!activeSession

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium
  const isSelected = selectedTaskId === task.id

  // 点击选中
  const handleClick = () => {
    setSelectedTaskId(task.id)
  }

  // 启动/聚焦会话
  const handleSessionAction = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (hasActiveSession && activeSession) {
      selectSession(activeSession.id)
      useUIStore.getState().setViewMode('tabs')
    } else {
      const result = await startSessionForTask(task.id)
      if (result.success && result.sessionId) {
        selectSession(result.sessionId)
        if (result.reused) {
          useUIStore.getState().setViewMode('tabs')
        }
      }
    }
  }

  // 复制任务
  const handleCopyTask = async () => {
    await copyTask(task.id)
  }

  const getTaskWorkDir = async (): Promise<string> => {
    if (task.worktreePath) return task.worktreePath
    if (task.gitRepoPath) return task.gitRepoPath

    const sessionWorkDir = activeSession?.config?.workingDirectory || sessions[0]?.config?.workingDirectory
    if (sessionWorkDir) return sessionWorkDir

    return window.spectrAI.app.getCwd()
  }

  const handleDispatchToTeam = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (dispatchingTeam) return

    setDispatchingTeam(true)
    try {
      const workDir = await getTaskWorkDir()
      const tags = Array.isArray(task.tags) ? task.tags : []
      const providerId = activeSession?.providerId || 'codex'
      const team = await createTeam({
        name: `执行任务：${task.title.slice(0, 32)}`,
        objective: [
          `完成看板任务：${task.title}`,
          task.description ? `任务描述：\n${task.description}` : '',
          tags.length > 0 ? `来源标签：${tags.join(', ')}` : '',
        ].filter(Boolean).join('\n\n'),
        workDir,
        templateId: 'dev-team',
        providerId,
        worktreeIsolation: !!task.worktreeEnabled,
      })

      if (!team) return

      await createTeamTask(team.id, {
        title: task.title,
        description: [
          task.description || '',
          `来源看板任务：${task.id}`,
          tags.length > 0 ? `来源标签：${tags.join(', ')}` : '',
        ].filter(Boolean).join('\n\n'),
        status: 'pending',
        priority: task.priority,
        dependencies: [],
      })

      await updateTask(task.id, {
        status: task.status === 'todo' ? 'in_progress' : task.status,
        tags: Array.from(new Set([...tags, 'team-dispatched', `team:${team.id}`])),
      })

      setActiveTeam(team.id)
      useUIStore.getState().setActivePanelLeft('team')
      useUIStore.getState().setPaneContent('primary', 'team')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      alert(`派发到 Agent Team 失败：${message}`)
    } finally {
      setDispatchingTeam(false)
    }
  }

  // 构建右键菜单项
  const contextMenuItems: MenuItem[] = useMemo(() => {
    const items: MenuItem[] = [
      {
        key: 'edit',
        label: '编辑任务',
        icon: <Pencil size={14} />,
        onClick: () => setEditDialogOpen(true),
      },
      { key: 'div-1', type: 'divider' as const },
      {
        key: 'move',
        label: '移动到',
        icon: <ArrowRight size={14} />,
        children: KANBAN_COLUMNS
          .filter((col) => col.id !== task.status)
          .map((col) => ({
            key: `move-${col.id}`,
            label: col.title,
            onClick: () => updateTask(task.id, { status: col.id }),
          })),
      },
      {
        key: 'priority',
        label: '设置优先级',
        icon: <Flag size={14} />,
        children: [
          { key: 'p-high', label: '高', onClick: () => updateTask(task.id, { priority: 'high' }) },
          { key: 'p-medium', label: '中', onClick: () => updateTask(task.id, { priority: 'medium' }) },
          { key: 'p-low', label: '低', onClick: () => updateTask(task.id, { priority: 'low' }) },
        ].filter((p) => p.key !== `p-${task.priority}`),
      },
      { key: 'div-2', type: 'divider' as const },
      {
        key: 'session',
        label: hasActiveSession ? '聚焦会话' : '启动会话',
        icon: hasActiveSession ? <Eye size={14} /> : <Play size={14} />,
        disabled: task.status === 'done',
        onClick: () => handleSessionAction(),
      },
      {
        key: 'team',
        label: dispatchingTeam ? '团队创建中...' : '派发到 Agent Team',
        icon: <Users size={14} />,
        disabled: task.status === 'done' || dispatchingTeam,
        onClick: () => handleDispatchToTeam(),
      },
      {
        key: 'copy',
        label: '复制任务',
        icon: <Copy size={14} />,
        onClick: handleCopyTask,
      },
      { key: 'div-3', type: 'divider' as const },
      {
        key: 'delete',
        label: '删除任务',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => setConfirmDeleteOpen(true),
      },
    ]
    return items
  }, [task.status, task.priority, task.id, hasActiveSession, dispatchingTeam])

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={handleClick}
        onContextMenu={showMenu}
        className={`
          group relative bg-bg-tertiary rounded-lg p-3 mb-2 cursor-pointer
          transition-all duration-200 shadow-sm
          hover:bg-bg-hover hover:shadow-md hover:-translate-y-px
          ${isSelected ? 'ring-2 ring-accent-blue' : ''}
          ${hasActiveSession ? 'ring-1 ring-green-500/50' : ''}
          ${isDragging ? 'shadow-lg' : ''}
        `}
      >
        {/* 左侧优先级色条 */}
        <div
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
          style={{ backgroundColor: priorityColor }}
        />

        {/* 任务标题 + 会话按钮 */}
        <div className="flex items-start gap-2 mb-1 pl-2">
          <h3 className="text-sm font-semibold text-text-primary flex-1 line-clamp-2 leading-snug [&>p]:mb-0">
            <Markdown remarkPlugins={[remarkGfm]}>{task.title}</Markdown>
          </h3>
          {/* 启动/聚焦会话按钮 - hover 才显示（有活跃会话时始终显示） */}
          {task.status !== 'done' && (
            <>
              <button
                onClick={handleDispatchToTeam}
                title="派发到 Agent Team"
                disabled={dispatchingTeam}
                className="flex-shrink-0 p-1 rounded text-text-muted opacity-0 group-hover:opacity-100 hover:text-accent-purple hover:bg-accent-purple/10 transition-all duration-150 disabled:opacity-50"
              >
                {dispatchingTeam ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              </button>
              <button
                onClick={handleSessionAction}
                title={hasActiveSession ? '聚焦会话' : '启动会话'}
                className={`
                  flex-shrink-0 p-1 rounded transition-all duration-150
                  ${hasActiveSession
                    ? 'text-accent-green hover:bg-green-500/20'
                    : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-hover'
                  }
                `}
              >
                {hasActiveSession ? <Eye size={14} /> : <Play size={14} />}
              </button>
            </>
          )}
        </div>

        {/* 任务描述 */}
        {task.description && (
          <p className="text-xs text-text-secondary mb-2 pl-2 line-clamp-2 leading-relaxed [&>p]:mb-0">
            <Markdown remarkPlugins={[remarkGfm]}>{task.description}</Markdown>
          </p>
        )}

        {/* 标签 */}
        {task.tags && task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 pl-2">
            {task.tags.map((tag, index) => (
              <span
                key={index}
                className="text-xs px-1.5 py-0.5 bg-bg-secondary text-text-muted rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Git 分支标识 */}
        {task.worktreeEnabled && task.gitBranch && (
          <div className="flex items-center gap-1 mt-1.5 pl-2">
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/15 text-accent-blue font-medium border border-accent-blue/20">
              <GitBranch size={10} />
              {task.gitBranch}
            </span>
          </div>
        )}

        {/* 底部：优先级 + 会话状态 + Provider */}
        <div className="flex items-center gap-2 mt-2 pl-2">
          <span
            className="text-xs px-1.5 py-0.5 rounded font-medium"
            style={{
              backgroundColor: `${priorityColor}15`,
              color: priorityColor,
            }}
          >
            {task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}
          </span>
          {hasActiveSession && (
            <>
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/15 text-accent-green font-medium">
                会话运行中
              </span>
              {activeSession.providerId && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-purple/15 text-accent-purple font-medium border border-accent-purple/20">
                  {activeSession.providerId === 'claude-code' ? 'Claude' :
                   activeSession.providerId === 'codex' ? 'Codex' :
                   activeSession.providerId === 'gemini-cli' ? 'Gemini' :
                   activeSession.providerId === 'qwen-coder' ? 'Qwen' :
                   activeSession.providerId}
                </span>
              )}
            </>
          )}
          {task.estimatedDuration && (
            <span className="text-xs text-text-muted ml-auto">
              {task.estimatedDuration}分钟
            </span>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      <ContextMenu
        visible={menuState.visible}
        x={menuState.x}
        y={menuState.y}
        items={contextMenuItems}
        onClose={hideMenu}
      />

      {/* 编辑弹窗 */}
      <TaskEditDialog
        open={editDialogOpen}
        mode="edit"
        task={task}
        onClose={() => setEditDialogOpen(false)}
        onSave={async (data) => {
          await updateTask(task.id, data)
          setEditDialogOpen(false)
        }}
      />

      {/* 删除确认 */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="删除任务"
        message={`确定要删除任务「${task.title}」吗？${task.worktreeEnabled ? '关联的 Git Worktree 和分支也将被清理。' : ''}此操作不可撤销。`}
        confirmText="删除"
        danger={true}
        onConfirm={async () => {
          await deleteTask(task.id)
          setConfirmDeleteOpen(false)
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )
}

TaskCard.displayName = 'TaskCard'

export default TaskCard
