/**
 * 语音交互视图
 */
import React, { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { voiceStore } from '../../stores/voiceStore'
import { Mic, MicOff, Volume2, VolumeX, Settings, History, Play, Trash2, Send, ChevronDown, ChevronRight } from 'lucide-react'

type Tab = 'control' | 'history' | 'settings'

const VoiceView = observer(() => {
  const [tab, setTab] = useState<Tab>('control')
  const [speakText, setSpeakText] = useState('')
  const [inputText, setInputText] = useState('')

  useEffect(() => {
    voiceStore.loadConfig()
    voiceStore.loadStatus()
    voiceStore.loadHistory()
  }, [])

  const { status, config, history, loading, error } = voiceStore

  // ── 控制面板 ──
  const ControlPanel = () => (
    <div className="space-y-4">
      {/* 状态指示 */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
        <div className={`w-3 h-3 rounded-full ${status.isListening ? 'bg-red-500 animate-pulse' : status.isSpeaking ? 'bg-blue-500 animate-pulse' : 'bg-gray-500'}`} />
        <span className="text-sm text-gray-300">
          {status.isListening ? '正在监听...' : status.isSpeaking ? '正在播报...' : '就绪'}
        </span>
      </div>

      {/* 监听控制 */}
      <div className="flex gap-2">
        <button
          onClick={() => status.isListening ? voiceStore.stopListening() : voiceStore.startListening()}
          disabled={loading}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
            status.isListening
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          } disabled:opacity-50`}
        >
          {status.isListening ? <MicOff size={18} /> : <Mic size={18} />}
          {status.isListening ? '停止监听' : '开始监听'}
        </button>
      </div>

      {/* 语音播报 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-400 font-medium">语音播报</label>
        <div className="flex gap-2">
          <input
            value={speakText}
            onChange={e => setSpeakText(e.target.value)}
            placeholder="输入要播报的文字..."
            className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => { voiceStore.speak(speakText); setSpeakText('') }}
            disabled={!speakText.trim() || status.isSpeaking}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            <Volume2 size={16} />
          </button>
        </div>
      </div>

      {/* 模拟语音输入 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-400 font-medium">模拟语音输入</label>
        <div className="flex gap-2">
          <input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="输入模拟语音指令..."
            className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => { voiceStore.simulateInput(inputText); setInputText('') }}
            disabled={!inputText.trim()}
            className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* 最后转录 */}
      {status.lastTranscript && (
        <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">最近转录</div>
          <div className="text-sm text-gray-200">{status.lastTranscript}</div>
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/30 border border-red-800">
          <div className="text-xs text-red-400">{error}</div>
        </div>
      )}

      {/* 快捷提示 */}
      <div className="text-xs text-gray-500 space-y-1">
        <div>💡 macOS: 使用系统 say 命令播报</div>
        <div>💡 唤醒词: {config?.wakeWord || '小 Spectr'}</div>
        <div>💡 语速: {config?.speechRate || 1.0}x</div>
      </div>
    </div>
  )

  // ── 历史记录 ──
  const HistoryPanel = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">共 {history.length} 条记录</span>
        <button
          onClick={() => voiceStore.clearHistory()}
          className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
        >
          <Trash2 size={12} /> 清除
        </button>
      </div>
      {history.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-8">暂无历史记录</div>
      ) : (
        <div className="space-y-2">
          {[...history].reverse().map(entry => (
            <HistoryItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )

  const HistoryItem = ({ entry }: { entry: typeof history[0] }) => {
    const [expanded, setExpanded] = useState(false)
    const isLong = entry.text.length > 60
    return (
      <div className="p-2 rounded-lg bg-gray-800/50 border border-gray-700/50">
        <div className="flex items-start gap-2">
          <div className={`mt-0.5 ${entry.type === 'input' ? 'text-green-400' : 'text-blue-400'}`}>
            {entry.type === 'input' ? <Mic size={14} /> : <Volume2 size={14} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">
              {new Date(entry.timestamp).toLocaleTimeString('zh-CN')}
              <span className="ml-2">{entry.type === 'input' ? '输入' : '播报'}</span>
            </div>
            <div className="text-sm text-gray-200 mt-0.5">
              {isLong && !expanded ? entry.text.slice(0, 60) + '...' : entry.text}
            </div>
            {isLong && (
              <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-400 mt-1 flex items-center gap-0.5">
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {expanded ? '收起' : '展开'}
              </button>
            )}
          </div>
          {entry.type === 'output' && (
            <button
              onClick={() => voiceStore.speak(entry.text)}
              className="text-gray-500 hover:text-blue-400"
              title="重新播报"
            >
              <Play size={12} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── 设置面板 ──
  const SettingsPanel = () => {
    if (!config) return <div className="text-sm text-gray-500">加载中...</div>
    return (
      <div className="space-y-4">
        {/* 启用开关 */}
        <ToggleRow label="启用语音" checked={config.enabled} onChange={v => voiceStore.updateConfig({ enabled: v })} />

        {/* 自动播报 */}
        <ToggleRow label="AI 回复自动播报" checked={config.autoSpeak} onChange={v => voiceStore.updateConfig({ autoSpeak: v })} />

        {/* 语言 */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">识别语言</label>
          <select
            value={config.language}
            onChange={e => voiceStore.updateConfig({ language: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="zh-CN">中文 (zh-CN)</option>
            <option value="en-US">English (en-US)</option>
            <option value="ja-JP">日本語 (ja-JP)</option>
          </select>
        </div>

        {/* 语速 */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">播报语速: {config.speechRate.toFixed(1)}x</label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={config.speechRate}
            onChange={e => voiceStore.updateConfig({ speechRate: parseFloat(e.target.value) })}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>0.5x 慢速</span>
            <span>2.0x 快速</span>
          </div>
        </div>

        {/* 唤醒词 */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">唤醒词</label>
          <input
            value={config.wakeWord}
            onChange={e => voiceStore.updateConfig({ wakeWord: e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* 转录引擎 */}
        <div className="space-y-1">
          <label className="text-xs text-gray-400 font-medium">转录引擎</label>
          <select
            value={config.transcriptionProvider}
            onChange={e => voiceStore.updateConfig({ transcriptionProvider: e.target.value as any })}
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="local">本地引擎</option>
            <option value="whisper-api">Whisper API</option>
          </select>
        </div>

        {/* Whisper API 配置 */}
        {config.transcriptionProvider === 'whisper-api' && (
          <div className="space-y-2 pl-3 border-l-2 border-blue-500/30">
            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-medium">API Key</label>
              <input
                type="password"
                value={config.whisperApiKey || ''}
                onChange={e => voiceStore.updateConfig({ whisperApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400 font-medium">API URL</label>
              <input
                value={config.whisperApiUrl || ''}
                onChange={e => voiceStore.updateConfig({ whisperApiUrl: e.target.value })}
                placeholder="https://api.openai.com/v1/audio/transcriptions"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  const ToggleRow = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-300">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-600'}`}
      >
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'control', icon: <Mic size={14} />, label: '控制' },
    { id: 'history', icon: <History size={14} />, label: '历史' },
    { id: 'settings', icon: <Settings size={14} />, label: '设置' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-gray-200">语音交互</h2>
          {status.isListening && <span className="text-xs text-red-400 animate-pulse">● 监听中</span>}
          {status.isSpeaking && <span className="text-xs text-blue-400 animate-pulse">● 播报中</span>}
        </div>
      </div>

      {/* 标签栏 */}
      <div className="flex border-b border-gray-800">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
              tab === t.id ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'control' && <ControlPanel />}
        {tab === 'history' && <HistoryPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  )
})

export default VoiceView
