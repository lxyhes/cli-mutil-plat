/**
 * 会话录像面板 - 录制和回放 AI 会话过程
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import { Video, Play, Circle, Square, Download, Trash2, Clock, Loader2 } from 'lucide-react'

interface Replay {
  id: string; sessionId: string; sessionName: string; duration: number
  eventCount: number; status: string; createdAt: string
}

export default function ReplayView() {
  const [replays, setReplays] = useState<Replay[]>([])
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState<string | null>(null)

  const api = () => (window as any).spectrAI?.replay

  useEffect(() => { fetchList() }, [])

  const fetchList = async () => {
    setLoading(true)
    try {
      const r = await api()?.list()
      setReplays(r?.success ? r.replays || [] : [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  const startRecording = async (sessionId: string, sessionName: string) => {
    await api()?.startRecording(sessionId, sessionName)
    setRecording(sessionId)
  }

  const stopRecording = async (sessionId: string) => {
    await api()?.stopRecording(sessionId)
    setRecording(null)
    fetchList()
  }

  const handleExport = async (id: string) => {
    const r = await api()?.export(id)
    if (r?.json) {
      const blob = new Blob([r.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `replay-${id}.json`; a.click()
      URL.revokeObjectURL(url)
    }
  }

  const handleDelete = async (id: string) => {
    await api()?.delete(id)
    setReplays(prev => prev.filter(r => r.id !== id))
  }

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60); const sec = s % 60
    return m > 0 ? `${m}分${sec}秒` : `${sec}秒`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Video className="w-4 h-4 text-accent-purple" />
          会话录像
        </div>
      </div>

      {/* Replay List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
          </div>
        ) : replays.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <Video className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">暂无录像</p>
            <p className="text-[10px]">开启会话录制后，AI 操作过程将被完整记录</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {replays.map(r => (
              <div key={r.id} className="px-3 py-2.5 hover:bg-bg-hover transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-text-primary">{r.sessionName}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                    r.status === 'completed' ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-yellow/10 text-accent-yellow'
                  }`}>{r.status === 'completed' ? '已完成' : '录制中'}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-text-muted">
                  <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> {formatDuration(r.duration)}</span>
                  <span>{r.eventCount} 个事件</span>
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-1 mt-1.5">
                  <button className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20">
                    <Play className="w-3 h-3" /> 回放
                  </button>
                  <button onClick={() => handleExport(r.id)}
                    className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] bg-bg-tertiary text-text-muted hover:text-text-primary">
                    <Download className="w-3 h-3" /> 导出
                  </button>
                  <button onClick={() => handleDelete(r.id)}
                    className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] text-text-muted hover:text-accent-red">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        录制 AI 会话的完整操作过程，支持回放和分享
      </div>
    </div>
  )
}
