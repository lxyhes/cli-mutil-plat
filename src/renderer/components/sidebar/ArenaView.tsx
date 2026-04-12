/**
 * 技能竞技场面板 - 社区技能评分排行
 * 三个标签页：排行榜 / 技能详情 / 提交技能
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import {
  Trophy, ThumbsUp, ThumbsDown, Star, RefreshCw, Crown, Medal,
  Plus, ChevronRight, ChevronDown, Trash2, Code, Zap, Clock,
  BarChart3, Filter, Send
} from 'lucide-react'
import { useArenaStore } from '../../stores/arenaStore'
import type { ArenaSkill } from '../../stores/arenaStore'

type Tab = 'leaderboard' | 'detail' | 'submit'

// ── 排名图标 ──
const RANK_STYLES = [
  { icon: Crown, color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  { icon: Medal, color: 'text-gray-300', bg: 'bg-gray-300/10' },
  { icon: Medal, color: 'text-orange-400', bg: 'bg-orange-400/10' },
]

// ── 分数颜色 ──
function scoreColor(score: number): string {
  if (score >= 80) return 'text-accent-green'
  if (score >= 60) return 'text-accent-yellow'
  return 'text-accent-red'
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-accent-green/10'
  if (score >= 60) return 'bg-accent-yellow/10'
  return 'bg-accent-red/10'
}

// ── 分数条 ──
function ScoreBar({ label, score, icon }: { label: string; score: number; icon: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1 text-text-secondary">
          {icon}
          {label}
        </div>
        <span className={`font-medium ${scoreColor(score)}`}>{score}</span>
      </div>
      <div className="h-1.5 bg-bg-primary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            score >= 80 ? 'bg-accent-green' : score >= 60 ? 'bg-accent-yellow' : 'bg-accent-red'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  )
}

// ── 技能卡片 ──
function SkillCard({
  skill, rank, isSelected, onClick
}: { skill: ArenaSkill; rank: number; isSelected: boolean; onClick: () => void }) {
  const { vote } = useArenaStore()
  const RankStyle = rank <= 3 ? RANK_STYLES[rank - 1] : null
  const upRate = skill.voteCount > 0 ? Math.round((skill.upVotes / skill.voteCount) * 100) : 0

  return (
    <div
      className={`p-3 rounded-lg border transition-all cursor-pointer ${
        isSelected
          ? 'bg-accent-blue/10 border-accent-blue/30'
          : 'bg-bg-hover/50 border-border hover:bg-bg-hover'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {/* 排名 */}
        {RankStyle ? (
          <div className={`w-6 h-6 rounded-full ${RankStyle.bg} flex items-center justify-center flex-shrink-0`}>
            <RankStyle.icon className={`w-3.5 h-3.5 ${RankStyle.color}`} />
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] text-text-muted">{rank}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-text-primary truncate">{skill.name}</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-bg-primary text-text-muted flex-shrink-0">
              {skill.category}
            </span>
          </div>
          <span className="text-[10px] text-text-muted">by {skill.author}</span>
        </div>
        {/* 综合分 */}
        <div className={`px-2 py-1 rounded text-xs font-bold ${scoreBg(skill.overallScore)} ${scoreColor(skill.overallScore)}`}>
          {skill.overallScore}
        </div>
      </div>

      {/* 描述 */}
      {skill.description && (
        <p className="text-[10px] text-text-muted line-clamp-1 mb-1.5 ml-8">{skill.description}</p>
      )}

      {/* 操作行 */}
      <div className="flex items-center gap-3 ml-8 text-[10px]">
        <span className="flex items-center gap-0.5 text-accent-yellow">
          <Star className="w-3 h-3" /> {skill.overallScore}
        </span>
        <span className="text-text-muted">{skill.voteCount} 票 · {upRate}% 赞同</span>
        <button
          onClick={(e) => { e.stopPropagation(); vote(skill.id, true) }}
          className="flex items-center gap-0.5 text-text-muted hover:text-accent-green transition-colors"
        >
          <ThumbsUp className="w-3 h-3" /> 赞
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); vote(skill.id, false) }}
          className="flex items-center gap-0.5 text-text-muted hover:text-accent-red transition-colors"
        >
          <ThumbsDown className="w-3 h-3" /> 踩
        </button>
      </div>
    </div>
  )
}

// ── 技能详情 ──
function SkillDetail({ skill, onDelete }: { skill: ArenaSkill; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">{skill.name}</h3>
        <button onClick={onDelete} title="删除技能" className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-red transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 基本信息 */}
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>by {skill.author}</span>
        <span>·</span>
        <span className="px-1.5 py-0.5 rounded bg-bg-hover text-text-secondary">{skill.category}</span>
        <span>·</span>
        <span>{new Date(skill.submittedAt).toLocaleDateString('zh-CN')}</span>
      </div>

      {/* 描述 */}
      {skill.description && (
        <div className="p-3 rounded-lg bg-bg-hover/50 border border-border">
          <p className="text-xs text-text-secondary leading-relaxed">{skill.description}</p>
        </div>
      )}

      {/* 综合分数 */}
      <div className="p-3 rounded-lg bg-bg-hover/50 border border-border text-center">
        <div className="text-2xl font-bold text-text-primary">{skill.overallScore}</div>
        <div className="text-[10px] text-text-muted mt-0.5">综合评分</div>
        <div className="flex items-center justify-center gap-2 mt-1 text-[10px] text-text-muted">
          <span>{skill.voteCount} 票</span>
          <span>·</span>
          <span>{skill.upVotes} 赞同</span>
          <span>·</span>
          <span>{skill.voteCount > 0 ? Math.round((skill.upVotes / skill.voteCount) * 100) : 0}% 好评率</span>
        </div>
      </div>

      {/* 分项评分 */}
      <div className="space-y-2.5">
        <h4 className="text-xs font-medium text-text-primary">分项评分</h4>
        <ScoreBar label="代码质量" score={skill.codeQualityScore} icon={<Code className="w-3 h-3" />} />
        <ScoreBar label="执行速度" score={skill.executionSpeedScore} icon={<Zap className="w-3 h-3" />} />
        <ScoreBar label="Token 效率" score={skill.tokenEfficiencyScore} icon={<Clock className="w-3 h-3" />} />
      </div>

      {/* Prompt 模板 */}
      {skill.promptTemplate && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs font-medium text-text-primary hover:text-accent-blue transition-colors"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Prompt 模板
          </button>
          {expanded && (
            <pre className="mt-1.5 p-3 rounded-lg bg-bg-primary border border-border text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap">
              {skill.promptTemplate}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── 提交技能表单 ──
function SubmitForm() {
  const { submit, categories, fetchCategories } = useArenaStore()
  const [name, setName] = useState('')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ArenaSkill | null>(null)

  useEffect(() => { fetchCategories() }, [fetchCategories])

  const handleSubmit = async () => {
    if (!name.trim() || !author.trim() || !category) return
    setSubmitting(true)
    const skill = await submit({ name, author, description, category, promptTemplate })
    setSubmitting(false)
    if (skill) {
      setResult(skill)
      setName(''); setAuthor(''); setDescription(''); setCategory(''); setPromptTemplate('')
    }
  }

  if (result) {
    return (
      <div className="space-y-3">
        <div className="text-center py-4">
          <div className="w-12 h-12 rounded-full bg-accent-green/15 flex items-center justify-center mx-auto mb-2">
            <Trophy className="w-6 h-6 text-accent-green" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary">提交成功!</h3>
          <p className="text-xs text-text-muted mt-1">
            「{result.name}」已加入竞技场，综合评分 {result.overallScore}
          </p>
        </div>
        <button
          onClick={() => setResult(null)}
          className="w-full py-2 text-xs bg-accent-blue text-white rounded hover:bg-accent-blue/90 transition-colors"
        >
          继续提交
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">提交技能</h3>

      <div>
        <label className="block text-xs text-text-secondary mb-1">技能名称 *</label>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="例如：React 组件生成器"
          className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
        />
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">作者 *</label>
        <input
          type="text" value={author} onChange={e => setAuthor(e.target.value)}
          placeholder="你的名字"
          className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
        />
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">分类 *</label>
        <div className="flex flex-wrap gap-1.5">
          {(categories.length > 0 ? categories : ['代码生成', '代码审查', '文档', '测试', '重构', '调试', '架构']).map(c => (
            <button
              key={c} onClick={() => setCategory(c)}
              className={`px-2 py-1 rounded text-[11px] transition-colors ${
                category === c
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
                  : 'bg-bg-hover text-text-muted border border-border hover:text-text-primary'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">描述</label>
        <textarea
          value={description} onChange={e => setDescription(e.target.value)}
          placeholder="简要描述这个技能的功能和用途..."
          className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue resize-none"
          rows={3}
        />
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">Prompt 模板</label>
        <textarea
          value={promptTemplate} onChange={e => setPromptTemplate(e.target.value)}
          placeholder="输入 Prompt 模板，支持 {variable} 占位符..."
          className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-blue resize-none font-mono"
          rows={5}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || !name.trim() || !author.trim() || !category}
        className="w-full py-2 text-xs bg-accent-blue text-white rounded hover:bg-accent-blue/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        {submitting ? (
          <><span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />提交中...</>
        ) : (
          <><Send className="w-3 h-3" />提交到竞技场</>
        )}
      </button>
    </div>
  )
}

// ── 主视图 ──
export default function ArenaView() {
  const { skills, selectedSkill, stats, loading, fetchList, fetchStats, fetchCategories, getScores, deleteSkill } = useArenaStore()
  const [activeTab, setActiveTab] = useState<Tab>('leaderboard')
  const [category, setCategory] = useState<string | null>(null)

  useEffect(() => {
    fetchList(category || undefined)
    fetchStats()
    fetchCategories()
  }, [category, fetchList, fetchStats, fetchCategories])

  const handleSelectSkill = (skill: ArenaSkill) => {
    getScores(skill.id)
    setActiveTab('detail')
  }

  const handleDeleteSkill = async () => {
    if (selectedSkill) {
      await deleteSkill(selectedSkill.id)
      setActiveTab('leaderboard')
    }
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'leaderboard', label: '排行榜', icon: Trophy },
    { key: 'detail', label: '技能详情', icon: BarChart3 },
    { key: 'submit', label: '提交技能', icon: Plus },
  ]

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      {/* 标题 */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-accent-yellow" />
          <h2 className="text-sm font-semibold text-text-primary">技能竞技场</h2>
        </div>
        <button
          onClick={() => fetchList(category || undefined)}
          className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 统计概览 */}
      {stats && stats.totalSkills > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border text-[10px] text-text-muted">
          <span className="flex items-center gap-0.5"><Trophy className="w-3 h-3" />{stats.totalSkills} 技能</span>
          <span className="flex items-center gap-0.5"><ThumbsUp className="w-3 h-3" />{stats.totalVotes} 票</span>
          <span className="flex items-center gap-0.5"><Filter className="w-3 h-3" />{stats.categories} 分类</span>
        </div>
      )}

      {/* 分类过滤 */}
      <div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto">
        <button
          onClick={() => setCategory(null)}
          className={`px-2 py-0.5 rounded text-[10px] shrink-0 transition-colors ${
            !category ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          全部
        </button>
        {['代码生成', '代码审查', '文档', '测试', '重构'].map(c => (
          <button
            key={c} onClick={() => setCategory(c)}
            className={`px-2 py-0.5 rounded text-[10px] shrink-0 transition-colors ${
              category === c ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 标签页切换 */}
      <div className="flex border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs transition-colors ${
              activeTab === tab.key
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'leaderboard' && (
          <>
            {loading && skills.length === 0 ? (
              <div className="text-center py-8 text-xs text-text-muted">加载中...</div>
            ) : skills.length === 0 ? (
              <div className="text-center py-8">
                <Trophy className="w-8 h-8 mx-auto text-text-muted/30 mb-2" />
                <p className="text-xs text-text-muted">暂无技能参赛</p>
                <p className="text-[10px] text-text-muted mt-1">点击"提交技能"参与竞技</p>
              </div>
            ) : (
              <div className="space-y-2">
                {skills.map((skill, idx) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    rank={idx + 1}
                    isSelected={selectedSkill?.id === skill.id}
                    onClick={() => handleSelectSkill(skill)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'detail' && (
          <>
            {selectedSkill ? (
              <SkillDetail skill={selectedSkill} onDelete={handleDeleteSkill} />
            ) : (
              <div className="text-center py-8">
                <BarChart3 className="w-8 h-8 mx-auto text-text-muted/30 mb-2" />
                <p className="text-xs text-text-muted">请从排行榜中选择一个技能</p>
              </div>
            )}
          </>
        )}

        {activeTab === 'submit' && <SubmitForm />}
      </div>

      {/* 底部 */}
      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        社区驱动的技能评分排行榜
      </div>
    </div>
  )
}
