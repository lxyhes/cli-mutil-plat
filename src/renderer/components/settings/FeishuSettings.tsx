/**
 * 飞书设置面板 - 飞书集成配置
 */
import { useState, useEffect } from 'react'
import { Send, Loader2, Check, X, Plus, Zap, MessageSquare } from 'lucide-react'
import { useFeishuStore } from '../../stores/feishuStore'
import { useSessionStore } from '../../stores/sessionStore'

export default function FeishuSettings() {
  const {
    config, status, mappings, loading,
    fetchConfig, setConfig, deleteConfig, testConnection,
    fetchMappings, addMapping, removeMapping,
    initListeners, cleanup,
  } = useFeishuStore()

  const { sessions } = useSessionStore()

  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [notifyOnStart, setNotifyOnStart] = useState(true)
  const [notifyOnEnd, setNotifyOnEnd] = useState(true)
  const [notifyOnError, setNotifyOnError] = useState(true)
  const [enabled, setEnabled] = useState(false)

  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const [newChatId, setNewChatId] = useState('')
  const [newChatName, setNewChatName] = useState('')
  const [newSessionId, setNewSessionId] = useState('')

  useEffect(() => {
    fetchConfig()
    fetchMappings()
    initListeners()
    return () => cleanup()
  }, [])

  useEffect(() => {
    if (config) {
      setAppId(config.appId || '')
      setWebhookUrl(config.webhookUrl || '')
      setNotifyOnStart(config.notifyOnStart)
      setNotifyOnEnd(config.notifyOnEnd)
      setNotifyOnError(config.notifyOnError)
      setEnabled(config.enabled)
    }
  }, [config])

  const handleTest = async (testType: 'webhook' | 'bot') => {
    setTestResult(null)
    let result
    if (testType === 'webhook') {
      if (!webhookUrl.trim()) return
      result = await testConnection({ webhookUrl: webhookUrl.trim() })
    } else {
      if (!appId.trim() || !appSecret.trim()) return
      result = await testConnection({ appId: appId.trim(), appSecret: appSecret.trim() })
    }
    if (result.success) {
      setTestResult({ success: true, msg: testType === 'webhook' ? 'Webhook 连接成功！' : 'Bot API 连接成功！' })
    } else {
      setTestResult({ success: false, msg: result.error?.message || '连接失败' })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await setConfig({
        appId: appId.trim() || undefined,
        appSecret: appSecret.trim() || undefined,
        webhookUrl: webhookUrl.trim() || undefined,
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
    if (!confirm('确定删除飞书配置？')) return
    await deleteConfig()
    setAppId('')
    setAppSecret('')
    setWebhookUrl('')
    setEnabled(false)
  }

  const handleAddMapping = async () => {
    if (!newChatId.trim() || !newSessionId) return
    const result = await addMapping({
      chatId: newChatId.trim(),
      chatName: newChatName.trim() || undefined,
      sessionId: newSessionId,
    })
    if (result.success) {
      setNewChatId('')
      setNewChatName('')
      setNewSessionId('')
    }
  }

  const statusColors: Record<string, string> = {
    stopped: 'text-text-muted',
    connected: 'text-accent-green',
    error: 'text-accent-red',
  }

  const statusLabels: Record<string, string> = {
    stopped: '未连接',
    connected: '已连接',
    error: '错误',
  }

  return (
    <div className="space-y-6">
      {/* 连接方式选择提示 */}
      <div className="p-3 bg-bg-tertiary rounded-lg text-xs text-text-muted">
        <p className="mb-1.5 font-medium text-text-secondary">连接方式：</p>
        <ul className="space-y-1 list-disc list-inside">
          <li><span className="font-mono text-text-secondary">Webhook</span> — 简单推送通知，无需企业自建应用</li>
          <li><span className="font-mono text-text-secondary">Bot API</span> — 使用飞书自建应用，支持主动发送消息</li>
        </ul>
      </div>

      {/* Webhook URL */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">Webhook URL</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => { setWebhookUrl(e.target.value); setTestResult(null) }}
            placeholder="飞书机器人 Webhook 地址"
            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
          />
          <button
            onClick={() => handleTest('webhook')}
            disabled={!webhookUrl.trim()}
            className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary hover:bg-bg-hover btn-transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <Zap className="w-4 h-4" />测试
          </button>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-border" />
        <span className="text-xs text-text-muted">或使用 Bot API</span>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* App ID */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">App ID</label>
        <input
          type="text"
          value={appId}
          onChange={(e) => { setAppId(e.target.value); setTestResult(null) }}
          placeholder="cli_xxxxxxxxxxxxxx"
          className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue font-mono"
        />
      </div>

      {/* App Secret */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-1.5">App Secret</label>
        <input
          type="password"
          value={appSecret}
          onChange={(e) => { setAppSecret(e.target.value); setTestResult(null) }}
          placeholder="飞书自建应用的 App Secret"
          className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
        />
      </div>

      {/* 测试连接 */}
      <button
        onClick={() => handleTest('bot')}
        disabled={!appId.trim() || !appSecret.trim()}
        className="px-4 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary hover:bg-bg-hover btn-transition disabled:opacity-50 flex items-center gap-1.5"
      >
        <Zap className="w-4 h-4" />测试 Bot API 连接
      </button>

      {testResult && (
        <p className={`text-xs ${testResult.success ? 'text-accent-green' : 'text-accent-red'}`}>
          {testResult.success ? '✓' : '✗'} {testResult.msg}
        </p>
      )}

      {/* 启用开关 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-primary">启用飞书集成</p>
          <p className="text-xs text-text-muted">开启后会话事件将推送到飞书</p>
        </div>
        <button
          onClick={() => setEnabled(!enabled)}
          className={[
            'relative w-11 h-6 rounded-full transition-colors',
            enabled ? 'bg-accent-blue' : 'bg-bg-tertiary',
          ].join(' ')}
        >
          <span className={[
            'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
            enabled ? 'translate-x-6' : 'translate-x-1',
          ].join(' ')} />
        </button>
      </div>

      {/* 通知设置 */}
      <div>
        <p className="text-sm font-medium text-text-primary mb-3">通知设置</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={notifyOnStart} onChange={(e) => setNotifyOnStart(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-blue" />
            <span className="text-sm text-text-secondary">会话启动时通知</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={notifyOnEnd} onChange={(e) => setNotifyOnEnd(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-blue" />
            <span className="text-sm text-text-secondary">会话完成时通知</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={notifyOnError} onChange={(e) => setNotifyOnError(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-blue" />
            <span className="text-sm text-text-secondary">会话错误时通知</span>
          </label>
        </div>
      </div>

      {/* 状态指示 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg">
        <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-accent-green' : status === 'error' ? 'bg-accent-red' : 'bg-text-muted'}`} />
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
        {config?.hasAppId && (
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-bg-tertiary text-accent-red rounded-lg text-sm font-medium hover:bg-bg-hover btn-transition flex items-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" />删除配置
          </button>
        )}
      </div>

      <div className="border-t border-border" />

      {/* 会话映射 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">会话映射</p>
        </div>

        {mappings.length > 0 ? (
          <div className="space-y-2 mb-4">
            {mappings.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-bg-tertiary rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{m.chatName || m.chatId}</p>
                  <p className="text-xs text-text-muted">→ {m.sessionName || m.sessionId.slice(0, 12)}</p>
                </div>
                <button onClick={() => removeMapping(m.id)} className="p-1.5 text-text-muted hover:text-accent-red btn-transition">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted mb-4">暂无映射关联。使用飞书机器人的 chat_id 进行关联。</p>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newChatId}
            onChange={(e) => setNewChatId(e.target.value)}
            placeholder="chat_id"
            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
          />
          <input
            type="text"
            value={newChatName}
            onChange={(e) => setNewChatName(e.target.value)}
            placeholder="群名称（可选）"
            className="flex-1 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
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
        <p className="text-xs font-medium text-text-secondary mb-2">配置说明</p>
        <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside">
          <li><strong>Webhook 方式</strong>：在飞书群中添加"自定义机器人"，复制 Webhook URL 填入上方即可推送</li>
          <li><strong>Bot API 方式</strong>：在飞书开放平台创建自建应用，获取 App ID 和 App Secret，并开启机器人能力</li>
          <li>使用 Bot API 可主动向飞书会话发送消息，Webhook 仅支持推送</li>
          <li>配置后请开启"启用飞书集成"开关</li>
        </ol>
      </div>
    </div>
  )
}
