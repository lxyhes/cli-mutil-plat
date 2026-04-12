/**
 * 技能竞技场面板 - 社区技能评分排行
 * @author spectrai
 */
import { useState, useEffect } from 'react'
import { Trophy, ThumbsUp, Star, RefreshCw, Loader2, Crown, Medal } from 'lucide-react'

interface ArenaSkill {
  id: string; name: string; author: string; description: string; category: string
  overallScore: number; voteCount: number; upVotes: number
}

const RANK_ICONS = [
  { icon: Crown, color: 'text-yellow-400' },
  { icon: Medal, color: 'text-gray-300' },
  { icon: Medal, color: 'text-orange-400' },
]

export default function ArenaView() {
  const [skills, setSkills] = useState<ArenaSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState<string | null>(null)

  const api = () => (window as any).spectrAI?.skillArena

  useEffect(() => { fetchList() }, [category])

  const fetchList = async () => {
    setLoading(true)
    try {
      const r = await api()?.list(category)
      setSkills(r?.success ? r.skills || [] : [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  const handleVote = async (skillId: string, up: boolean) => {
    await api()?.vote(skillId, up)
    fetchList()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Trophy className="w-4 h-4 text-accent-yellow" />
          技能竞技场
        </div>
        <button onClick={fetchList} title="刷新"
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto">
        <button onClick={() => setCategory(null)}
          className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${!category ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-muted hover:text-text-primary'}`}>
          全部
        </button>
        {['代码生成', '代码审查', '文档', '测试', '重构'].map(c => (
          <button key={c} onClick={() => setCategory(c)}
            className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${category === c ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-muted hover:text-text-primary'}`}>
            {c}
          </button>
        ))}
      </div>

      {/* Leaderboard */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <Trophy className="w-7 h-7 mb-3 opacity-30" />
            <p className="text-sm">暂无技能参赛</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {skills.map((skill, idx) => {
              const RankIcon = idx < 3 ? RANK_ICONS[idx] : null
              return (
                <div key={skill.id} className="px-3 py-2.5 hover:bg-bg-hover transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    {RankIcon ? (
                      <RankIcon.icon className={`w-4 h-4 ${RankIcon.color}`} />
                    ) : (
                      <span className="w-4 text-center text-[10px] text-text-muted">{idx + 1}</span>
                    )}
                    <span className="text-xs font-medium text-text-primary">{skill.name}</span>
                    <span className="text-[9px] text-text-muted">by {skill.author}</span>
                  </div>
                  <p className="text-[10px] text-text-muted line-clamp-1 ml-6 mb-1">{skill.description}</p>
                  <div className="flex items-center gap-3 ml-6 text-[10px]">
                    <span className="flex items-center gap-0.5 text-accent-yellow">
                      <Star className="w-3 h-3" /> {skill.overallScore.toFixed(0)}
                    </span>
                    <span className="text-text-muted">{skill.voteCount} 票</span>
                    <button onClick={() => handleVote(skill.id, true)}
                      className="flex items-center gap-0.5 text-text-muted hover:text-accent-green transition-colors">
                      <ThumbsUp className="w-3 h-3" /> 赞
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted text-center">
        社区驱动的技能评分排行榜
      </div>
    </div>
  )
}
