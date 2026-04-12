/**
 * AI 对决模式面板 - 同一任务发给两个 AI 对比结果
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import { Swords, Play, Vote, BarChart3, Trophy, RefreshCw, X } from 'lucide-react'
import { useBattleStore, type Battle } from '../../stores/battleStore'

export default function BattleView() {
  const store = useBattleStore()
  const battles = useBattleStore(s => s.battles)
  const stats = useBattleStore(s => s.stats)
  const loading = useBattleStore(s => s.loading)
  const [prompt, setPrompt] = useState('')
  const [providerA, setProviderA] = useState('claude')
  const [providerB, setProviderB] = useState('gemini')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    store.fetchList()
    store.fetchStats()
  }, [])

  const handleCreate = async () => {
    if (!prompt.trim()) return
    await store.create(prompt, providerA, providerB)
    setPrompt(''); setShowCreate(false)
  }

  const PROVIDERS = [
    { id: 'claude', name: 'Claude Code' },
    { id: 'codex', name: 'Codex CLI' },
    { id: 'gemini', name: 'Gemini CLI' },
    { id: 'qwen', name: 'Qwen Coder' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Swords className="w-4 h-4 text-accent-yellow" />
          AI 对决
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowCreate(!showCreate)} title="创建对决"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-yellow/15 text-accent-yellow text-xs hover:bg-accent-yellow/25 transition-colors">
            <Play className="w-3 h-3" />
            对决
          </button>
          <button onClick={() => { store.fetchList(); store.fetchStats() }} title="刷新"
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2">
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="输入对决 Prompt..." className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary resize-y min-h-[60px] focus:outline-none focus:border-accent-blue" />
          <div className="flex items-center gap-2">
            <select value={providerA} onChange={e => setProviderA(e.target.value)}
              className="flex-1 px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue">
              {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="text-accent-yellow text-xs font-bold">VS</span>
            <select value={providerB} onChange={e => setProviderB(e.target.value)}
              className="flex-1 px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent-blue">
              {PROVIDERS.filter(p => p.id !== providerA).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-1">
            <button onClick={() => setShowCreate(false)} className="px-2 py-1 text-xs text-text-muted hover:text-text-primary">取消</button>
            <button onClick={handleCreate} className="px-2 py-1 bg-accent-yellow/15 text-accent-yellow rounded text-xs hover:bg-accent-yellow/25">开始对决</button>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && stats.totalBattles > 0 && (
        <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b border-border bg-bg-tertiary/30">
          <div className="text-center">
            <div className="text-sm font-semibold text-text-primary">{stats.totalBattles}</div>
            <div className="text-[9px] text-text-muted">总对决</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-accent-green">{Math.round((1 - stats.tieRate) * 100)}%</div>
            <div className="text-[9px] text-text-muted">决出胜负</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-accent-yellow">{stats.tieRate ? Math.round(stats.tieRate * 100) : 0}%</div>
            <div className="text-[9px] text-text-muted">平局率</div>
          </div>
        </div>
      )}

      {/* Battles */}
      <div className="flex-1 overflow-y-auto">
        {battles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <Swords className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">暂无对决记录</p>
            <p className="text-[10px]">点击"对决"按钮让两个 AI 比拼</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {battles.map(battle => {
              const pA = PROVIDERS.find(p => p.id === battle.providerAId)?.name || battle.providerAId
              const pB = PROVIDERS.find(p => p.id === battle.providerBId)?.name || battle.providerBId
              return (
                <div key={battle.id} className="px-3 py-2.5 hover:bg-bg-hover transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className={battle.winner === 'A' ? 'text-accent-green font-semibold' : 'text-text-primary'}>{pA}</span>
                      <span className="text-accent-yellow font-bold">VS</span>
                      <span className={battle.winner === 'B' ? 'text-accent-green font-semibold' : 'text-text-primary'}>{pB}</span>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                      battle.status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
                      battle.status === 'running' ? 'bg-accent-yellow/10 text-accent-yellow' : 'bg-bg-tertiary text-text-muted'
                    }`}>{battle.status === 'completed' ? '完成' : battle.status === 'running' ? '进行中' : '待执行'}</span>
                  </div>
                  <p className="text-[10px] text-text-muted line-clamp-2 mb-1">{battle.prompt}</p>
                  {battle.winner && (
                    <div className="flex items-center gap-2 text-[10px]">
                      <Trophy className="w-3 h-3 text-accent-yellow" />
                      <span className="text-text-secondary">
                        {battle.winner === 'tie' ? '平局' : `${battle.winner === 'A' ? pA : pB} 获胜`}
                      </span>
                    </div>
                  )}
                  {battle.status === 'completed' && !battle.winner && (
                    <div className="flex gap-1 mt-1">
                      <button onClick={() => store.vote(battle.id, 'A')} className="px-2 py-0.5 text-[10px] rounded bg-accent-green/10 text-accent-green hover:bg-accent-green/20">A 胜</button>
                      <button onClick={() => store.vote(battle.id, 'tie')} className="px-2 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-muted hover:bg-bg-hover">平局</button>
                      <button onClick={() => store.vote(battle.id, 'B')} className="px-2 py-0.5 text-[10px] rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20">B 胜</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        同一 Prompt 发给两个 AI，投票选出最佳结果
      </div>
    </div>
  )
}
