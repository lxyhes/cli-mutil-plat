/**
 * Agent Teams - 交互式消息面板
 * 支持从 UI 向团队成员发送消息和广播
 * @author weibin
 */

import { useState, useEffect, useRef } from 'react'
import { Send, Users, Radio, ChevronDown } from 'lucide-react'
import { useTeamStore } from '../../stores/teamStore'
import type { TeamMessage } from '../../../shared/types'

const MESSAGE_TYPE_COLORS: Record<string, string> = {
  role_message: 'bg-accent-blue/10 border-accent-blue/30',
  broadcast: 'bg-accent-purple/10 border-accent-purple/30',
  system: 'bg-gray-500/10 border-gray-500/30',
  task_update: 'bg-accent-green/10 border-accent-green/30',
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  role_message: '私信',
  broadcast: '广播',
  system: '系统',
  task_update: '任务',
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '--:--'
  }
}

interface MessageItemProps {
  message: TeamMessage
  members: any[]
}

function MessageItem({ message, members }: MessageItemProps) {
  const sender = members.find((m: any) => m.id === message.from)
  const isFromUI = message.from === 'ui-user'
  const colors = MESSAGE_TYPE_COLORS[message.type] || MESSAGE_TYPE_COLORS.system

  return (
    <div className={`flex gap-2 p-2 rounded-lg border ${colors} ${isFromUI ? 'ml-4' : ''}`}>
      {/* 头像 */}
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-tertiary flex items-center justify-center text-xs mt-0.5">
        {isFromUI ? '👤' : (sender?.role?.icon || '🤖')}
      </div>
      <div className="flex-1 min-w-0">
        {/* 发送者 */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-[10px] font-medium ${
            isFromUI ? 'text-accent-blue' : 'text-text-secondary'
          }`}>
            {isFromUI ? '你' : (sender?.role?.name || sender?.roleId || message.from.slice(0, 8))}
          </span>
          <span className={`text-[9px] px-1 py-0.5 rounded ${
            MESSAGE_TYPE_LABELS[message.type] ? 'bg-bg-tertiary text-text-muted' : ''
          }`}>
            {MESSAGE_TYPE_LABELS[message.type] || message.type}
          </span>
          <span className="text-[9px] text-text-muted ml-auto">{formatTime(message.timestamp)}</span>
        </div>
        {/* 内容 */}
        <div className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    </div>
  )
}

interface MessagePanelProps {
  teamId: string
  messages: TeamMessage[]
  members: any[]
}

export default function MessagePanel({ teamId, messages, members }: MessagePanelProps) {
  const { sendMessage, broadcastMessage } = useTeamStore()
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [recipientId, setRecipientId] = useState<string>('broadcast')
  const [showMemberPicker, setShowMemberPicker] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = async () => {
    if (!content.trim()) return
    setSending(true)
    setError(null)
    try {
      if (recipientId === 'broadcast') {
        await broadcastMessage(teamId, content.trim())
      } else {
        await sendMessage(teamId, recipientId, content.trim())
      }
      setContent('')
    } catch (err: any) {
      setError(err.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const selectedMember = recipientId !== 'broadcast' ? members.find((m: any) => m.id === recipientId) : null

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto space-y-2 p-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center mb-2">
              <Users className="w-4 h-4 opacity-50" />
            </div>
            <p className="text-xs">暂无消息</p>
            <p className="text-[10px] opacity-50 mt-1">向成员发送消息开始对话</p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <MessageItem key={msg.id} message={msg} members={members} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 错误 */}
      {error && (
        <div className="mx-3 mb-2 px-2 py-1.5 rounded bg-red-500/15 border border-red-500/30 text-red-400 text-[10px]">
          {error}
        </div>
      )}

      {/* 输入区 */}
      <div className="flex-shrink-0 border-t border-border p-3 space-y-2">
        {/* 接收者选择 */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted flex-shrink-0">发送给:</span>
          <div className="relative">
                  <button
                  onClick={() => setShowMemberPicker(!showMemberPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-bg-tertiary text-xs text-text-secondary hover:border-text-muted/50 btn-transition"
            >
              {recipientId === 'broadcast' ? (
                <>
                  <Radio className="w-3 h-3 text-accent-purple" />
                  <span>所有成员</span>
                </>
              ) : (
                <>
                  <span>{selectedMember?.role?.icon || '👤'}</span>
                  <span>{selectedMember?.role?.name || recipientId.slice(0, 8)}</span>
                </>
              )}
              <ChevronDown className="w-3 h-3 text-text-muted" />
            </button>

            {showMemberPicker && (
              <div className="absolute bottom-full left-0 mb-1 z-10 w-44 bg-bg-secondary border border-border rounded-lg shadow-lg py-1">
                <button
                  onClick={() => { setRecipientId('broadcast'); setShowMemberPicker(false) }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover ${recipientId === 'broadcast' ? 'text-accent-purple' : 'text-text-secondary'}`}
                >
                  <Radio className="w-3 h-3" /> 所有成员（广播）
                </button>
                <div className="border-t border-border my-1" />
                {members.map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => { setRecipientId(m.id); setShowMemberPicker(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-bg-hover ${recipientId === m.id ? 'text-accent-blue' : 'text-text-secondary'}`}
                  >
                    <span>{m.role?.icon || '👤'}</span>
                    <span>{m.role?.name || m.roleId}</span>
                    {m.role?.isLeader && <span className="text-[9px] text-orange-400 ml-auto">👑</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 消息输入 */}
        <div className="flex items-end gap-2">
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={recipientId === 'broadcast' ? '向所有成员广播消息...' : `向 ${selectedMember?.role?.name || '成员'} 发送私信...`}
            rows={2}
            className="flex-1 px-3 py-2 text-xs bg-bg-tertiary border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue resize-none"
          />
          <button
            onClick={handleSend}
            disabled={sending || !content.trim()}
            className="flex-shrink-0 p-2.5 rounded-lg bg-accent-blue text-white hover:bg-accent-blue/80 disabled:opacity-40 disabled:cursor-not-allowed btn-transition"
            title="发送"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="text-[9px] text-text-muted">
          Enter 发送 · Shift+Enter 换行
        </div>
      </div>
    </div>
  )
}
