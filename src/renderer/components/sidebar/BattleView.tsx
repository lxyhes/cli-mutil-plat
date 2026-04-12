/**
 * AI 对决模式面板 - 同一任务发给两个 AI 对比结果
 * 支持：创建对决、投票、统计、结果对比
 */
import { useState, useEffect } from 'react'
import { Swords, Play, BarChart3, Trophy, RefreshCw, Trash2, Clock, Zap, Loader2 } from 'lucide-react'
import { useBattleStore, type Battle } from '../../stores/battleStore'

const PROVIDERS = [
  { id: 'claude', name: 'Claude Code', color: 'text-accent-orange' },
  { id: 'codex', name: 'Codex CLI', color: 'text-accent-green' },
  { id: 'gemini', name: 'Gemini CLI', color: 'text-accent-blue' },
  { id: 'qwen', name: 'Qwen Coder', color: 'text-accent-purple' },
  { id: 'opencode', name: 'OpenCode', color: 'text-accent-cyan' },
]

function getProviderName(id: string): string {
  return PROVIDERS.find(p => p.id === id)?.name || id
}

function getProviderColor(id: string): string {
  return PROVIDERS.find(p => p.id === id)?.color || 'text-text-primary'
}

function formatDuration(ms: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ── 对决卡片 ──
function BattleCard({ battle, onVote, onDelete }: { battle: Battle; onVote: (id: string, choice: 'A' | 'B' | 'tie') => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const pA = getProviderName(battle.providerAId)
  const pB = getProviderName(battle.providerBId)
  const cA = getProviderColor(battle.providerAId)
  const cB = getProviderColor(battle.providerBId)

  return (
    <div className="px-3 py-2.5 hover:bg-bg-hover transition-colors">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={battle.winner === 'A' ? `${cA} font-semibold` : 'text-text-primary'}>{pA}</span>
          <span className="text-accent-yellow font-bold text-[10px]">VS</span>
          <span className={battle.winner === 'B' ? `${cB} font-semibold` : 'text-text-primary'}>{pB}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`px-1.5 py-0.5 rounded text-[9px] ${
            battle.status === 'completed' ? 'bg-accent-green/10 text-accent-green' :
            battle.status === 'running' ? 'bg-accent-yellow/10 text-accent-yellow animate-pulse' :
            battle.status === 'failed' ? 'bg-accent-red/10 text-accent-red' :
            'bg-bg-tertiary text-text-muted'
          }`}>
            {battle.status === 'completed' ? '完成' : battle.status === 'running' ? '进行中' : battle.status === 'failed' ? '失败' : '待执行'}
          </span>
          <button onClick={() => onDelete(battle.id)} className="p-0.5 text-text-muted hover:text-accent-red transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <p className="text-[10px] text-text-muted line-clamp-2 mb-1">{battle.prompt}</p>

      {/* 胜者显示 */}
      {battle.winner && (
        <div className="flex items-center gap-1.5 text-[10px] mb-1">
          <Trophy className="w-3 h-3 text-accent-yellow" />
          <span className="text-text-secondary">
            {battle.winner === 'tie' ? '平局' : `${battle.winner === 'A' ? pA : pB} 获胜`}
          </span>
        </div>
      )}

      {/* 结果概览 */}
      {battle.result && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] text-accent-blue hover:text-accent-blue/80 mb-1"
        >
          {expanded ? '收起结果' : '查看结果'}
        </button>
      )}

      {expanded && battle.result && (
        <div className="grid grid-cols-2 gap-2 mt-1 mb-1">
          {/* Provider A */}
          <div className="px-2 py-1.5 rounded bg-bg-secondary border border-border">
            <div className={`text-[10px] font-medium ${cA} mb-1`}>{pA}</div>
            <div className="text-[9px] text-text-muted space-y-0.5">
              <div>Token: {battle.result.providerA?.tokenCount?.toLocaleString() || '-'}</div>
              <div>耗时: {formatDuration(battle.result.providerA?.duration)}</div>
            </div>
            {battle.result.providerA?.response && (
              <p className="text-[9px] text-text-secondary mt-1 line-clamp-3">
                {battle.result.providerA.response}
              </p>
            )}
          </div>
          {/* Provider B */}
          <div className="px-2 py-1.5 rounded bg-bg-secondary border border-border">
            <div className={`text-[10px] font-medium ${cB} mb-1`}>{pB}</div>
            <div className="text-[9px] text-text-muted space-y-0.5">
              <div>Token: {battle.result.providerB?.tokenCount?.toLocaleString() || '-'}</div>
              <div>耗时: {formatDuration(battle.result.providerB?.duration)}</div>
            </div>
            {battle.result.providerB?.response && (
              <p className="text-[9px] text-text-secondary mt-1 line-clamp-3">
                {battle.result.providerB.response}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 投票按钮 */}
      {battle.status === 'completed' && !battle.winner && (
        <div className="flex gap-1 mt-1">
          <button onClick={() => onVote(battle.id, 'A')}
            className="px-2 py-0.5 text-[10px] rounded bg-accent-green/10 text-accent-green hover:bg-accent-green/20">{pA} 胜</button>
          <button onClick={() => onVote(battle.id, 'tie')}
            className="px-2 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-muted hover:bg-bg-hover">平局</button>
          <button onClick={() => onVote(battle.id, 'B')}
            className="px-2 py-0.5 text-[10px] rounded bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20">{pB} 胜</button>
        </div>
      )}

      {/* 已投票信息 */}
      {battle.votes && battle.votes.length > 0 && (
        <div className="flex items-center gap-2 text-[9px] text-text-muted mt-1">
          <span>{battle.votes.length} 票</span>
          <span>A: {battle.votes.filter((v: any) => v.choice === 'A').length}</span>
          <span>B: {battle.votes.filter((v: any) => v.choice === 'B').length}</span>
          <span>平: {battle.votes.filter((v: any) => v.choice === 'tie').length}</span>
        </div>
      )}
    </div>
  )
}

// ── 统计卡片 ──
function StatsBar({ stats }: { stats: any }) {
  if (!stats || stats.totalBattles === 0) return null

  return (
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
  )
}

// ── 主组件 ──
export default function BattleView() {
  const { battles, stats, loading, fetchList, create, vote, deleteBattle, fetchStats } = useBattleStore()
  const [prompt, setPrompt] = useState('')
  const [providerA, setProviderA] = useState('claude')
  const [providerB, setProviderB] = useState('gemini')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    fetchList()
    fetchStats()
  }, [])

  const handleCreate = async () => {
    if (!prompt.trim()) return
    await create(prompt, providerA, providerB)
    setPrompt('')
    setShowCreate(false)
  }

  const handleVote = async (battleId: string, choice: 'A' | 'B' | 'tie') => {
    await vote(battleId, choice)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Swords className="w-4 h-4 text-accent-yellow" />
          AI 对决
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-yellow/15 text-accent-yellow text-xs hover:bg-accent-yellow/25 transition-colors">
            <Play className="w-3 h-3" /> 对决
          </button>
          <button onClick={() => { fetchList(); fetchStats() }}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="px-3 py-2 border-b border-border bg-bg-tertiary/50 space-y-2">
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="输入对决 Prompt..."
            className="w-full px-2 py-1 bg-bg-secondary border border-border rounded text-xs text-text-primary resize-y min-h-[60px] focus:outline-none focus:border-accent-blue" />
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
      <StatsBar stats={stats} />

      {/* Provider 排行 */}
      {stats?.providerWins && Object.keys(stats.providerWins).length > 0 && (
        <div className="px-3 py-2 border-b border-border">
          <div className="text-[10px] text-text-muted mb-1">Provider 胜场</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(stats.providerWins)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([id, wins]) => (
                <span key={id} className={`px-1.5 py-0.5 rounded text-[9px] bg-bg-secondary ${getProviderColor(id)}`}>
                  {getProviderName(id)}: {wins as number}胜
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Battles */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
          </div>
        ) : battles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <Swords className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm mb-1">暂无对决记录</p>
            <p className="text-[10px]">点击"对决"按钮让两个 AI 比拼</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {battles.map(battle => (
              <BattleCard key={battle.id} battle={battle} onVote={handleVote} onDelete={deleteBattle} />
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        同一 Prompt 发给两个 AI，投票选出最佳结果
      </div>
    </div>
  )
}
