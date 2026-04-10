/**
 * Telegram 设置面板 - Telegram 远程控制配置
 */
import { useState, useEffect } from 'react'
import { Send, Loader2, Check, X, Plus, Trash2, Zap, MessageSquare } from 'lucide-react'
import { useTelegramStore } from '../../stores/telegramStore'
import { useSessionStore } from '../../stores/sessionStore'

export default function TelegramSettings() {
  const {
    config,
    status,
    mappings,
    loading,
    fetchConfig,
    setConfig,
    deleteConfig,
    testConnection,
    fetchMappings,
    addMapping,
    removeMapping,
    initListeners,
    cleanup,
  } = useTelegramStore()

  const { sessions } = useSessionStore()

  const [botToken, setBotToken] = useState('')
  const [commandPrefix, setCommandPrefix] = useState('/')
  const [notifyOnStart, setNotifyOnStart] = useState(true)
  const [notifyOnEnd, setNotifyOnEnd] = useState(true)
  const [notifyOnError, setNotifyOnError] = useState(true)
  const [enabled, setEnabled] = useState(false)

  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const [newChatId, setNewChatId] = useState('')
  const [newSessionId, setNewSessionId] = useState('')

  useEffect(() => {
    fetchConfig()
    fetchMappings()
    initListeners()
    return () => cleanup()
  }, [])

  useEffect(() => {
    if (config) {
      setCommandPrefix(config.commandPrefix)
      setNotifyOnStart(config.notifyOnStart)
      setNotifyOnEnd(config.notifyOnEnd)
      setNotifyOnError(config.notifyOnError)
      setEnabled(config.enabled)
    }
  }, [config])

  const handleTestConnection = async () => {
    if (!botToken.trim()) return
    setTestResult(null)
    const result = await testConnection(botToken.trim())
    if (result.success) {
      setTestResult({ success: true, msg: `连接成功！Bot: @${result.username}` })
    } else {
      setTestResult({ success: false, msg: result.error?.message || '连接失败' })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await setConfig({
        botToken: botToken.trim() || undefined,
        commandPrefix,
        notifyOnStart,
        notifyOnEnd,
        notifyOnError,
        enabled,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('确定删除 Telegram 配置？')) return
    await deleteConfig()
    setBotToken('')
    setEnabled(false)
  }

  const handleAddMapping = async () => {
    if (!newChatId.trim() || !newSessionId.trim()) return
    const result = await addMapping({
      chatId: newChatId.trim(),
      sessionId: newSessionId.trim(),
    })
    if (result.success) {
      setNewChatId('')
      setNewSessionId('')
    }
  }

  const statusColors: Record<string, string> = {
    stopped: 'text-text-muted',
    starting: 'text-accent-yellow',
    running: 'text-accent-green',
    error: 'text-accent-red',
  }

  const statusLabels: Record<string, string> = {
    stopped: '已停止',
    starting: '启动中...',
    running: '运行中',
    error: '错误',
  }

  return (
    <div className="space-y-6">
      {/* Bot Token */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">
          Bot Token
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={botToken}
            onChange={(e) => {
              setBotToken(e.target.value)
              setTestResult(null)
            }}
            placeholder="从 @BotFather 获取的 Token"
            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
          />
          <button
            onClick={handleTestConnection}
            disabled={!botToken.trim() || loading}
            className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary hover:bg-bg-hover btn-transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <Zap className="w-4 h-4" />
            测试
          </button>
        </div>
        {testResult && (
          <p className={`mt-1.5 text-xs ${testResult.success ? 'text-accent-green' : 'text-accent-red'}`}>
            {testResult.success ? '✓' : '✗'} {testResult.msg}
          </p>
        )}
      </div>

      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-primary">启用 Bot</p>
          <p className="text-xs text-text-muted">开启后 Bot 开始接收消息</p>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={[
            'relative w-11 h-6 rounded-full transition-colors',
            enabled ? 'bg-accent-blue' : 'bg-bg-tertiary',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
              enabled ? 'translate-x-6' : 'translate-x-1',
            ].join(' ')}
          />
        </button>
      </div>

      {/* 通知设置 */}
      <div>
        <p className="text-sm font-medium text-text-primary mb-3">通知设置</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyOnStart}
              onChange={(e) => setNotifyOnStart(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-blue"
            />
            <span className="text-sm text-text-secondary">会话启动时通知</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyOnEnd}
              onChange={(e) => setNotifyOnEnd(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-blue"
            />
            <span className="text-sm text-text-secondary">会话完成时通知</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={notifyOnError}
              onChange={(e) => setNotifyOnError(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-blue"
            />
            <span className="text-sm text-text-secondary">会话错误时通知</span>
          </label>
        </div>
      </div>

      {/* 状态指示 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
        <span className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-accent-green' : status === 'error' ? 'bg-accent-red' : 'bg-text-muted'}`} />
        <span className={`text-sm ${statusColors[status] || 'text-text-muted'}`}>
          {statusLabels[status] || status}
        </span>
      </div>

      {/* 保存按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/80 btn-transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          保存配置
        </button>
        {config?.hasToken && (
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-bg-tertiary text-accent-red rounded-lg text-sm font-medium hover:bg-bg-hover btn-transition flex items-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" />
            删除配置
          </button>
        )}
      </div>

      {/* 分隔线 */}
      <div className="border-t border-border" />

      {/* 会话映射 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">会话映射</p>
          <span className="text-xs text-text-muted">（chat_id → session_id）</span>
        </div>

        {/* 映射列表 */}
        {mappings.length > 0 ? (
          <div className="space-y-2 mb-4">
            {mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-bg-tertiary rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{m.sessionName || m.sessionId}</p>
                  <p className="text-xs text-text-muted font-mono">chat: {m.chatId}</p>
                </div>
                <button
                  onClick={() => removeMapping(m.id)}
                  className="p-1.5 text-text-muted hover:text-accent-red btn-transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted mb-4">暂无映射关联。在 Telegram 中使用 /add &lt;session_id&gt; 命令关联会话。</p>
        )}

        {/* 添加映射 */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newChatId}
            onChange={(e) => setNewChatId(e.target.value)}
            placeholder="chat_id"
            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
          />
          <select
            value={newSessionId}
            onChange={(e) => setNewSessionId(e.target.value)}
            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent-blue"
          >
            <option value="">选择会话...</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.id.slice(0, 12)}</option>
            ))}
          </select>
          <button
            onClick={handleAddMapping}
            disabled={!newChatId.trim() || !newSessionId}
            className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary hover:bg-bg-hover btn-transition disabled:opacity-50 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 帮助信息 */}
      <div className="mt-4 p-3 bg-bg-tertiary rounded-lg">
        <p className="text-xs font-medium text-text-secondary mb-2">使用说明</p>
        <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside">
          <li>在 Telegram 中搜索 <span className="font-mono text-text-secondary">@BotFather</span> 创建 Bot，获取 Token</li>
          <li>将 Token 填入上方配置并保存</li>
          <li>在手机 Telegram 中向 Bot 发送 <span className="font-mono">/help</span> 查看所有命令</li>
          <li>使用 <span className="font-mono">/add &lt;session_id&gt;</span> 关联会话后，即可远程操控</li>
        </ol>
      </div>
    </div>
  )
}
