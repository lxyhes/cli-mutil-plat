/**
 * Agent DAG 增强可视化组件
 * 
 * 功能:
 * 1. 关键路径高亮显示
 * 2. 瓶颈任务标记
 * 3. 并行度可视化
 * 4. 执行时间估算
 * 5. 导出为多种格式（DOT, Mermaid, JSON）
 */

import { useState, useMemo } from 'react'
import {
  GitBranch, Download, FileText, BarChart3, AlertTriangle,
  Clock, Layers, Zap, Info
} from 'lucide-react'
import type { TaskDAGNode, TeamTask, DAGValidation } from '../../../shared/types'
import {
  analyzeDAG,
  enhanceDAGNodes,
  calculateOptimalLayout,
  exportToDOT,
  exportToMermaid,
  generateDAGSummary,
  detectBottlenecks,
  findParallelGroups,
} from '../../utils/dagVisualization'

interface EnhancedDAGViewProps {
  tasks: TeamTask[]
  dag: TaskDAGNode[]
  validation: DAGValidation
  onEdit?: (task: TeamTask) => void
}

export default function EnhancedDAGView({ tasks, dag, validation, onEdit }: EnhancedDAGViewProps) {
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [exportFormat, setExportFormat] = useState<'dot' | 'mermaid' | 'json' | null>(null)

  // 计算分析数据
  const analysis = useMemo(() => {
    if (dag.length === 0) return null
    return analyzeDAG(dag, tasks)
  }, [dag, tasks])

  // 增强节点信息
  const enhancedNodes = useMemo(() => {
    if (!analysis) return []
    return enhanceDAGNodes(dag, tasks, analysis)
  }, [dag, tasks, analysis])

  // 检测瓶颈
  const bottlenecks = useMemo(() => {
    return detectBottlenecks(dag)
  }, [dag])

  // 并行组
  const parallelGroups = useMemo(() => {
    return findParallelGroups(dag)
  }, [dag])

  // 布局计算
  const layout = useMemo(() => {
    if (dag.length === 0) return null
    return calculateOptimalLayout(dag)
  }, [dag])

  // 生成摘要报告
  const summaryReport = useMemo(() => {
    if (!analysis) return ''
    return generateDAGSummary(dag, tasks, analysis)
  }, [dag, tasks, analysis])

  // 导出功能
  const handleExport = () => {
    if (!exportFormat || !analysis) return

    let content = ''
    let filename = ''
    let mimeType = ''

    switch (exportFormat) {
      case 'dot':
        content = exportToDOT(dag, `Agent Tasks - ${new Date().toLocaleDateString()}`)
        filename = 'dag-export.dot'
        mimeType = 'text/vnd.graphviz'
        break
      case 'mermaid':
        content = exportToMermaid(dag, `Agent Tasks - ${new Date().toLocaleDateString()}`)
        filename = 'dag-export.md'
        mimeType = 'text/markdown'
        break
      case 'json':
        content = JSON.stringify({
          analysis,
          nodes: enhancedNodes,
          bottlenecks,
          parallelGroups: parallelGroups.map(group => group.map(n => n.taskId)),
        }, null, 2)
        filename = 'dag-analysis.json'
        mimeType = 'application/json'
        break
    }

    // 下载文件
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setExportFormat(null)
  }

  if (dag.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-text-muted">
        <GitBranch className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">暂无任务，无法绘制依赖图</p>
      </div>
    )
  }

  // 验证提示
  if (!validation.valid) {
    return (
      <div className="p-3 mb-3 rounded-lg bg-red-500/10 border border-red-500/30">
        <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          检测到循环依赖
        </div>
        {validation.cycles.map((cycle, i) => (
          <div key={i} className="text-[10px] text-red-300 ml-5">{cycle.join(' → ')}</div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
              showAnalysis
                ? 'bg-accent-blue/20 text-accent-blue'
                : 'bg-bg-hover text-text-muted hover:text-text-secondary'
            }`}
          >
            <BarChart3 className="w-3 h-3" />
            分析报告
          </button>

          <div className="relative">
            <button
              onClick={() => setExportFormat(exportFormat ? null : 'dot')}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-bg-hover text-text-muted hover:text-text-secondary transition-colors"
            >
              <Download className="w-3 h-3" />
              导出
            </button>

            {exportFormat && (
              <div className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded shadow-lg z-10 min-w-[120px]">
                {(['dot', 'mermaid', 'json'] as const).map(format => (
                  <button
                    key={format}
                    onClick={() => {
                      setExportFormat(format)
                      setTimeout(handleExport, 100)
                    }}
                    className="w-full px-3 py-1.5 text-left text-[10px] text-text-secondary hover:bg-bg-hover first:rounded-t last:rounded-b"
                  >
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 统计信息 */}
        {analysis && (
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              {analysis.totalTasks} 任务
            </span>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              并行度 {analysis.maxParallelism}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              ~{analysis.estimatedTotalDuration} 分钟
            </span>
          </div>
        )}
      </div>

      {/* 分析报告面板 */}
      {showAnalysis && analysis && (
        <div className="p-3 rounded-lg bg-bg-secondary border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-text-primary">DAG 分析报告</h3>
            <button
              onClick={() => setShowAnalysis(false)}
              className="text-text-muted hover:text-text-secondary"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="space-y-1">
              <div className="text-text-muted">总任务数</div>
              <div className="text-text-primary font-medium">{analysis.totalTasks}</div>
            </div>
            <div className="space-y-1">
              <div className="text-text-muted">已完成</div>
              <div className="text-green-400 font-medium">{analysis.completedTasks}</div>
            </div>
            <div className="space-y-1">
              <div className="text-text-muted">待执行</div>
              <div className="text-text-primary font-medium">{analysis.pendingTasks}</div>
            </div>
            <div className="space-y-1">
              <div className="text-text-muted">被阻塞</div>
              <div className="text-red-400 font-medium">{analysis.blockedTasks}</div>
            </div>
            <div className="space-y-1">
              <div className="text-text-muted">依赖深度</div>
              <div className="text-text-primary font-medium">{analysis.dependencyDepth} 层</div>
            </div>
            <div className="space-y-1">
              <div className="text-text-muted">最大并行度</div>
              <div className="text-accent-blue font-medium">{analysis.maxParallelism}</div>
            </div>
          </div>

          {/* 瓶颈任务 */}
          {bottlenecks.length > 0 && (
            <div className="pt-2 border-t border-border">
              <div className="flex items-center gap-1 text-[10px] text-yellow-400 mb-1">
                <AlertTriangle className="w-3 h-3" />
                瓶颈任务 ({bottlenecks.length})
              </div>
              <div className="space-y-1 max-h-20 overflow-y-auto">
                {bottlenecks.slice(0, 3).map(bottleneck => (
                  <div key={bottleneck.taskId} className="text-[9px] text-text-muted">
                    • {bottleneck.title}: {bottleneck.reason}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关键路径 */}
          <div className="pt-2 border-t border-border">
            <div className="text-[10px] text-text-muted mb-1">关键路径</div>
            <div className="text-[9px] text-accent-blue">
              {analysis.criticalPath.slice(0, 5).join(' → ')}
              {analysis.criticalPath.length > 5 && '...'}
            </div>
          </div>
        </div>
      )}

      {/* DAG 可视化 */}
      <div className="overflow-auto">
        {/* 图例 */}
        <div className="flex items-center gap-4 mb-3 flex-wrap text-[10px] text-text-muted">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border-2 border-dashed border-green-400/50" />
            <span>就绪可执行</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border-2 border-dashed border-red-400/50" />
            <span>被阻塞</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-blue-400/20 rounded" />
            <span>进行中</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-green-400/20 rounded" />
            <span>已完成</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-purple-400/20 rounded border border-purple-400/50" />
            <span>关键路径</span>
          </div>
          <span className="ml-auto">悬停节点可查看上下游依赖链</span>
        </div>

        <svg
          width={layout?.width ?? 400}
          height={layout?.height ?? 200}
          className="overflow-visible"
        >
          {/* 箭头标记 */}
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M 0 0 L 6 3 L 0 6 Z" fill="#6B7280" />
            </marker>
          </defs>

          {/* 绘制边 */}
          {layout && dag.map(node => {
            const nodePos = layout.nodePositions.get(node.taskId)
            if (!nodePos) return null

            return node.dependsOn.map(depId => {
              const depNode = dag.find(n => n.taskId === depId)
              const depPos = depNode ? layout.nodePositions.get(depId) : null
              if (!depPos) return null

              const isHighlighted = hoveredNode === node.taskId || hoveredNode === depId
              const isCriticalPath = enhancedNodes.find(n => n.taskId === node.taskId)?.criticalPath &&
                                    enhancedNodes.find(n => n.taskId === depId)?.criticalPath

              const stroke = isHighlighted ? '#58A6FF' : isCriticalPath ? '#A855F7' : '#6B728040'
              const strokeWidth = isHighlighted || isCriticalPath ? 2 : 1

              const sx = nodePos.x
              const sy = nodePos.y + 45
              const ex = depPos.x + 160
              const ey = depPos.y + 45
              const mx = (sx + ex) / 2

              return (
                <path
                  key={`${depId}-${node.taskId}`}
                  d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  fill="none"
                  markerEnd="url(#arrowhead)"
                />
              )
            })
          })}

          {/* 绘制节点 */}
          {layout && dag.map(node => {
            const task = tasks.find(t => t.id === node.taskId)
            if (!task) return null

            const pos = layout.nodePositions.get(node.taskId)
            if (!pos) return null

            const enhanced = enhancedNodes.find(n => n.taskId === node.taskId)
            const isHighlighted = hoveredNode === node.taskId
            const colors = getStatusColors(task.status)

            let borderColor = 'var(--color-border)'
            let bgColor = colors.bg
            if (isHighlighted) {
              borderColor = '#58A6FF'
              bgColor = '#58A6FF10'
            } else if (enhanced?.criticalPath) {
              borderColor = '#A855F7'
              bgColor = '#A855F710'
            } else if (node.isBlocked) {
              borderColor = '#F8514960'
            }

            return (
              <g
                key={node.taskId}
                transform={`translate(${pos.x}, ${pos.y})`}
                className="cursor-pointer"
                onClick={() => onEdit?.(task)}
                onMouseEnter={() => setHoveredNode(node.taskId)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* 背景 */}
                <rect
                  width={160}
                  height={90}
                  rx={6}
                  fill={bgColor}
                  stroke={borderColor}
                  strokeWidth={isHighlighted ? 2 : 1}
                  strokeDasharray={node.isBlocked && !isHighlighted ? '4,2' : undefined}
                />

                {/* 优先级条 */}
                <rect
                  width={4}
                  height={90}
                  rx={2}
                  fill={getPriorityColor(task.priority)}
                />

                {/* 标题 */}
                <text x={12} y={20} className="fill-[var(--color-text-primary)]" style={{ fontSize: '11px', fontWeight: 500 }}>
                  {task.title.length > 18 ? task.title.slice(0, 18) + '…' : task.title}
                </text>

                {/* 状态 + 波次 */}
                <text x={12} y={36} className="fill-[var(--color-text-muted)]" style={{ fontSize: '9px' }}>
                  {getStatusEmoji(task.status)} · 波次 {node.executionWave + 1}
                </text>

                {/* 依赖信息 */}
                {node.dependsOn.length > 0 && (
                  <text x={12} y={52} className="fill-[var(--color-text-muted)]" style={{ fontSize: '9px' }}>
                    ← {node.dependsOn.length} 个依赖
                  </text>
                )}

                {/* 阻塞标记 */}
                {node.isBlocked && (
                  <g transform="translate(12, 60)">
                    <rect width={10} height={10} rx={2} fill="#F8514920" />
                    <text x={12} y={9} className="fill-red-400" style={{ fontSize: '9px' }}>🔒</text>
                  </g>
                )}

                {/* 关键路径标记 */}
                {enhanced?.criticalPath && (
                  <g transform="translate(140, 5)">
                    <circle cx={5} cy={5} r={5} fill="#A855F7" />
                    <text x={5} y={8} textAnchor="middle" className="fill-white" style={{ fontSize: '8px' }}>★</text>
                  </g>
                )}

                {/* 悬停提示 */}
                {isHighlighted && (
                  <text
                    x={80}
                    y={82}
                    textAnchor="middle"
                    className="fill-accent-blue"
                    style={{ fontSize: '9px' }}
                  >
                    点击编辑
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// 辅助函数
function getStatusColors(status: string): { bg: string; text: string } {
  switch (status) {
    case 'completed': return { bg: 'bg-green-500/10', text: 'text-green-400' }
    case 'in_progress': return { bg: 'bg-blue-500/10', text: 'text-blue-400' }
    case 'failed': return { bg: 'bg-red-500/10', text: 'text-red-400' }
    case 'cancelled': return { bg: 'bg-yellow-500/10', text: 'text-yellow-400' }
    default: return { bg: 'bg-gray-500/10', text: 'text-gray-400' }
  }
}

function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'critical': return '#F85149'
    case 'high': return '#D29922'
    case 'medium': return '#E3B341'
    default: return '#3FB950'
  }
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'completed': return '✅'
    case 'in_progress': return '🔄'
    case 'failed': return '❌'
    case 'cancelled': return '⚠️'
    default: return '⏸️'
  }
}
