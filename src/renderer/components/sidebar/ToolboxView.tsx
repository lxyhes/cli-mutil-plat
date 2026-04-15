/**
 * 工具箱侧边栏视图 - 双层导航：首页网格 + 钻入详情
 *
 * 第一层：9 宫格功能卡片，点击进入详情
 * 第二层：全功能 Manager 组件，顶部返回按钮
 * @author weibin
 */

import { useState, useEffect } from 'react'
import {
  ArrowLeft, Plug, Zap, Layers, Sparkles, Clock,
  FileText, Brain, Workflow, Target, BarChart2, Wrench, Flame,
  History, DollarSign, BookMarked, ShieldCheck, Swords, Video, Trophy,
  Mic, Calendar, Gauge,
} from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useMcpStore } from '../../stores/mcpStore'
import { useSkillStore } from '../../stores/skillStore'
import { usePromptOptimizerStore } from '../../stores/promptOptimizerStore'
import type { LucideIcon } from 'lucide-react'

// ── 功能模块定义 ──
interface FeatureDef {
  id: string
  label: string
  description: string
  icon: LucideIcon
  color: string
}

const FEATURES: FeatureDef[] = [
  // === 开发工具 ===
  { id: 'mcp',              label: 'MCP 工具',    description: '管理和配置 MCP 服务器',    icon: Plug,     color: 'text-accent-blue' },
  { id: 'skills',           label: '技能库',      description: '浏览和启用技能模板',       icon: Zap,      color: 'text-accent-purple' },
  { id: 'workspace',        label: '工作区',      description: '管理工作区和代码仓库',      icon: Layers,   color: 'text-accent-green' },
  { id: 'prompt-optimizer', label: '提示词优化',   description: 'AI 驱动的提示词工程',      icon: Sparkles, color: 'text-accent-yellow' },
  // === 任务与工作流 ===
  { id: 'scheduler',        label: '定时任务',     description: '调度定时执行任务',         icon: Clock,    color: 'text-accent-blue' },
  { id: 'summary',          label: '会话摘要',     description: '自动生成会话总结',         icon: FileText, color: 'text-accent-green' },
  { id: 'planner',          label: '规划引擎',     description: '任务规划和分解策略',       icon: Brain,    color: 'text-accent-purple' },
  { id: 'workflow',         label: '工作流',      description: '自动化工作流编排',         icon: Workflow, color: 'text-accent-blue' },
  { id: 'goal',             label: '目标锚点',     description: '设定和跟踪目标',          icon: BarChart2, color: 'text-accent-green' },
  { id: 'evaluation',       label: '任务评估',     description: '评估任务质量和效果',       icon: Target,   color: 'text-accent-yellow' },
  // === 知识与记忆（三合一） ===
  { id: 'knowledge',        label: '知识中心',     description: '知识库+记忆+工作上下文',    icon: BookMarked, color: 'text-accent-purple' },
  // === 高级工具 ===
  { id: 'checkpoint',       label: '智能回溯',     description: '代码快照与一键回滚',       icon: History,  color: 'text-accent-blue' },
  { id: 'cost',             label: '成本仪表盘',   description: 'Token 消耗换算实际金额',   icon: DollarSign, color: 'text-accent-green' },
  { id: 'context-budget',   label: '上下文预算',   description: '管理和优化上下文用量',     icon: Gauge,    color: 'text-accent-yellow' },
  { id: 'review',           label: '代码审查',     description: 'AI 自动代码审查',         icon: ShieldCheck, color: 'text-accent-green' },
  // === AI 竞技 ===
  { id: 'battle',           label: 'AI 对决',     description: '同任务两 AI 对比',        icon: Swords,   color: 'text-accent-yellow' },
  { id: 'arena',            label: '技能竞技场',   description: '社区技能评分排行',        icon: Trophy,   color: 'text-accent-yellow' },
  { id: 'replay',           label: '会话录像',     description: '录制和回放 AI 操作',       icon: Video,    color: 'text-accent-purple' },
  // === 实用工具 ===
  { id: 'daily-report',     label: '每日日报',     description: 'AI 日报生成与订阅',       icon: Calendar, color: 'text-accent-blue' },
  { id: 'voice',            label: '语音交互',     description: '语音输入与 TTS 播报',       icon: Mic,      color: 'text-accent-green' },
  { id: 'trending',         label: '热门项目',     description: '发现热门 AI 开源项目',     icon: Flame,    color: 'text-orange-400' },
]

// ── 懒加载功能组件映射 ──
// 使用动态 import 避免首屏加载所有 Manager
import McpManager from '../settings/McpManager'
import SkillManager from '../settings/SkillManager'
import { WorkspaceTab } from '../settings/WorkspaceManager'
import PromptOptimizer from '../settings/PromptOptimizer'
import SchedulerSettings from '../settings/SchedulerSettings'
import SummarySettings from '../settings/SummarySettings'
import PlannerSettings from '../settings/PlannerSettings'
import WorkflowSettings from '../settings/WorkflowSettings'
import EvaluationSettings from '../settings/EvaluationSettings'
import GoalSettings from '../settings/GoalSettings'
import TrendingView from './TrendingView'
import CheckpointView from './CheckpointView'
import CostDashboardView from './CostDashboardView'
import KnowledgeView from './KnowledgeView'
import CodeReviewView from './CodeReviewView'
import BattleView from './BattleView'
import ReplayView from './ReplayView'
import ArenaView from './ArenaView'
import VoiceView from './VoiceView'
import DailyReportView from './DailyReportView'
import ContextBudgetView from './ContextBudgetView'

function FeatureComponent({ featureId }: { featureId: string }) {
  switch (featureId) {
    case 'mcp':              return <McpManager />
    case 'skills':           return <SkillManager />
    case 'trending':         return <TrendingView />
    case 'workspace':        return <WorkspaceTab />
    case 'prompt-optimizer': return <PromptOptimizer />
    case 'scheduler':        return <SchedulerSettings />
    case 'summary':          return <SummarySettings />
    case 'planner':          return <PlannerSettings />
    case 'workflow':         return <WorkflowSettings />
    case 'evaluation':       return <EvaluationSettings />
    case 'goal':             return <GoalSettings />
    case 'checkpoint':       return <CheckpointView />
    case 'cost':             return <CostDashboardView />
    case 'knowledge':        return <KnowledgeView />
    case 'review':           return <CodeReviewView />
    case 'battle':           return <BattleView />
    case 'replay':           return <ReplayView />
    case 'arena':            return <ArenaView />
    case 'daily-report':     return <DailyReportView />
    case 'voice':            return <VoiceView />
    case 'context-budget':   return <ContextBudgetView />
    default:                 return <div className="p-4 text-text-muted text-sm">未知功能</div>
  }
}

// ── 功能卡片徽章数据 Hook ──
function useFeatureBadges(): Record<string, string | number | null> {
  const mcpServers = useMcpStore(s => s.servers)
  const skills = useSkillStore(s => s.skills)
  const templates = usePromptOptimizerStore(s => s.templates)

  return {
    mcp: mcpServers.length || null,
    skills: skills.length || null,
    'prompt-optimizer': templates.length || null,
  }
}

// ── 首页网格 ──
function FeatureGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const badges = useFeatureBadges()

  // 确保数据已加载
  useEffect(() => {
    useMcpStore.getState().fetchAll()
    useSkillStore.getState().fetchAll()
    usePromptOptimizerStore.getState().fetchTemplates()
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* 标题 */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <Wrench className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          工具箱
        </span>
      </div>

      {/* 网格 */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          {FEATURES.map((f) => {
            const Icon = f.icon
            const badge = badges[f.id]
            return (
              <button
                key={f.id}
                onClick={() => onOpen(f.id)}
                className="group relative flex flex-col items-start gap-1.5 p-3 rounded-lg border border-border bg-bg-primary/40 hover:bg-bg-hover/60 hover:border-text-muted/30 transition-all text-left"
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${f.color}`} />
                  {badge != null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue font-medium">
                      {badge}
                    </span>
                  )}
                </div>
                <div className="text-xs font-medium text-text-primary leading-tight">{f.label}</div>
                <div className="text-[10px] text-text-muted leading-snug line-clamp-2">{f.description}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── 功能详情视图 ──
function FeatureDetail({ featureId, onBack }: { featureId: string; onBack: () => void }) {
  const feature = FEATURES.find(f => f.id === featureId)
  const Icon = feature?.icon ?? Wrench

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏：返回 + 标题 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="返回工具箱"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <Icon className={`w-3.5 h-3.5 ${feature?.color ?? 'text-text-muted'}`} />
        <span className="text-xs font-semibold text-text-secondary">
          {feature?.label ?? featureId}
        </span>
      </div>

      {/* 功能内容 */}
      <div className="flex-1 overflow-y-auto">
        <FeatureComponent featureId={featureId} />
      </div>
    </div>
  )
}

// ── 主入口 ──
export default function ToolboxView() {
  const toolboxFeature = useUIStore(s => s.toolboxFeature)
  const setToolboxFeature = useUIStore(s => s.setToolboxFeature)
  const activePanelLeft = useUIStore(s => s.activePanelLeft)
  const [localFeature, setLocalFeature] = useState<string | null>(null)

  // 当从 ActivityBar 点击 mcp/skills/trending 时，自动跳转到对应功能
  useEffect(() => {
    if (activePanelLeft === 'mcp') {
      setLocalFeature('mcp')
      setToolboxFeature(null)
    } else if (activePanelLeft === 'skills') {
      setLocalFeature('skills')
      setToolboxFeature(null)
    } else if (activePanelLeft === 'trending') {
      setLocalFeature('trending')
      setToolboxFeature(null)
    }
  }, [activePanelLeft])

  // toolboxFeature（深层链接）优先于本地状态
  const currentFeature = toolboxFeature ?? localFeature

  const handleOpen = (id: string) => {
    setLocalFeature(id)
    setToolboxFeature(null)
  }

  const handleBack = () => {
    setLocalFeature(null)
    setToolboxFeature(null)
  }

  // 当 toolboxFeature 变化时同步到本地
  useEffect(() => {
    if (toolboxFeature) {
      setLocalFeature(toolboxFeature)
    }
  }, [toolboxFeature])

  if (!currentFeature) {
    return <FeatureGrid onOpen={handleOpen} />
  }
  return <FeatureDetail featureId={currentFeature} onBack={handleBack} />
}
