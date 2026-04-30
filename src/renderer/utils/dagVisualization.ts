/**
 * Agent DAG 可视化增强工具
 * 
 * 提供以下功能:
 * 1. DAG 布局优化算法
 * 2. 关键路径分析
 * 3. 并行度计算
 * 4. 执行时间估算
 * 5. 依赖关系导出
 */

import type { TaskDAGNode, TeamTask } from '../../shared/types'

export interface EnhancedDAGNode extends TaskDAGNode {
  // 扩展字段
  criticalPath?: boolean          // 是否在关键路径上
  estimatedDuration?: number      // 预估执行时长（分钟）
  parallelismLevel?: number       // 并行层级
  resourceRequirements?: {        // 资源需求
    cpu?: number
    memory?: number
    provider?: string
  }
}

export interface DAGAnalysis {
  totalTasks: number
  completedTasks: number
  pendingTasks: number
  blockedTasks: number
  maxParallelism: number          // 最大并行度
  criticalPath: string[]          // 关键路径任务ID列表
  criticalPathLength: number      // 关键路径长度
  estimatedTotalDuration: number  // 预估总时长（分钟）
  averageParallelism: number      // 平均并行度
  dependencyDepth: number         // 依赖深度
  rootTasks: string[]             // 根任务（无依赖）
  leafTasks: string[]             // 叶任务（无后续依赖）
}

export interface LayoutConfig {
  nodeWidth: number
  nodeHeight: number
  horizontalGap: number
  verticalGap: number
  padding: number
}

/**
 * 分析 DAG 并生成详细报告
 */
export function analyzeDAG(dag: TaskDAGNode[], tasks: TeamTask[]): DAGAnalysis {
  const taskMap = new Map(tasks.map(t => [t.id, t]))
  
  // 基本统计
  const totalTasks = dag.length
  const completedTasks = dag.filter(n => n.status === 'completed').length
  const pendingTasks = dag.filter(n => n.status === 'pending').length
  const blockedTasks = dag.filter(n => n.isBlocked).length

  // 计算最大并行度（同一波次的最大任务数）
  const waveMap = new Map<number, number>()
  for (const node of dag) {
    waveMap.set(node.executionWave, (waveMap.get(node.executionWave) || 0) + 1)
  }
  const maxParallelism = Math.max(...Array.from(waveMap.values()), 0)

  // 计算关键路径
  const criticalPath = findCriticalPath(dag, taskMap)
  const criticalPathLength = criticalPath.length

  // 计算依赖深度
  const dependencyDepth = Math.max(...dag.map(n => n.executionWave), 0) + 1

  // 识别根任务和叶任务
  const rootTasks = dag.filter(n => n.dependsOn.length === 0).map(n => n.taskId)
  const leafTasks = dag.filter(n => n.dependents.length === 0).map(n => n.taskId)

  // 计算平均并行度
  const averageParallelism = totalTasks / dependencyDepth

  // 估算总时长（假设每个任务平均需要 10 分钟）
  const avgTaskDuration = 10 // 分钟
  const estimatedTotalDuration = criticalPathLength * avgTaskDuration

  return {
    totalTasks,
    completedTasks,
    pendingTasks,
    blockedTasks,
    maxParallelism,
    criticalPath,
    criticalPathLength,
    estimatedTotalDuration,
    averageParallelism,
    dependencyDepth,
    rootTasks,
    leafTasks,
  }
}

/**
 * 查找关键路径（最长路径）
 */
function findCriticalPath(dag: TaskDAGNode[], taskMap: Map<string, TeamTask>): string[] {
  if (dag.length === 0) return []

  // 找到所有叶节点（没有后续依赖的任务）
  const leafNodes = dag.filter(n => n.dependents.length === 0)
  
  let longestPath: string[] = []
  
  // 对每个叶节点，回溯找到最长路径
  for (const leaf of leafNodes) {
    const path = findLongestPathToRoot(leaf, dag, new Map())
    if (path.length > longestPath.length) {
      longestPath = path
    }
  }
  
  return longestPath.reverse()
}

/**
 * 从节点回溯到根节点的最长路径
 */
function findLongestPathToRoot(
  node: TaskDAGNode,
  dag: TaskDAGNode[],
  memo: Map<string, string[]>
): string[] {
  if (memo.has(node.taskId)) {
    return memo.get(node.taskId)!
  }

  if (node.dependsOn.length === 0) {
    // 根节点
    memo.set(node.taskId, [node.taskId])
    return [node.taskId]
  }

  let longestPath: string[] = []
  
  for (const depId of node.dependsOn) {
    const depNode = dag.find(n => n.taskId === depId)
    if (depNode) {
      const path = findLongestPathToRoot(depNode, dag, memo)
      if (path.length > longestPath.length) {
        longestPath = path
      }
    }
  }
  
  const result = [...longestPath, node.taskId]
  memo.set(node.taskId, result)
  return result
}

/**
 * 为 DAG 节点添加增强信息
 */
export function enhanceDAGNodes(
  dag: TaskDAGNode[],
  tasks: TeamTask[],
  analysis: DAGAnalysis
): EnhancedDAGNode[] {
  const criticalPathSet = new Set(analysis.criticalPath)
  
  return dag.map(node => ({
    ...node,
    criticalPath: criticalPathSet.has(node.taskId),
    estimatedDuration: 10, // 默认 10 分钟，可根据历史数据调整
    parallelismLevel: node.executionWave + 1,
    resourceRequirements: {
      cpu: 1,
      memory: 512, // MB
      provider: 'auto',
    },
  }))
}

/**
 * 计算最优布局
 */
export function calculateOptimalLayout(
  dag: TaskDAGNode[],
  config: LayoutConfig = {
    nodeWidth: 160,
    nodeHeight: 90,
    horizontalGap: 60,
    verticalGap: 8,
    padding: 24,
  }
): {
  width: number
  height: number
  nodePositions: Map<string, { x: number; y: number }>
} {
  // 按波次分组
  const waveMap = new Map<number, TaskDAGNode[]>()
  for (const node of dag) {
    if (!waveMap.has(node.executionWave)) {
      waveMap.set(node.executionWave, [])
    }
    waveMap.get(node.executionWave)!.push(node)
  }

  const waves = Array.from(waveMap.entries()).sort((a, b) => a[0] - b[0])
  const maxWaveHeight = Math.max(...waves.map(([, nodes]) => nodes.length), 1)

  const width = (waves.length * config.nodeWidth) + ((waves.length - 1) * config.horizontalGap) + (config.padding * 2)
  const height = (maxWaveHeight * config.nodeHeight) + (maxWaveHeight * config.verticalGap) + (config.padding * 2)

  // 计算每个节点的位置
  const nodePositions = new Map<string, { x: number; y: number }>()
  
  for (const [wave, nodes] of waves) {
    nodes.forEach((node, idx) => {
      const x = config.padding + wave * (config.nodeWidth + config.horizontalGap)
      const y = config.padding + idx * (config.nodeHeight + config.verticalGap)
      nodePositions.set(node.taskId, { x, y })
    })
  }

  return { width, height, nodePositions }
}

/**
 * 导出 DAG 为 Graphviz DOT 格式
 */
export function exportToDOT(dag: TaskDAGNode[], title: string = 'Task DAG'): string {
  const lines: string[] = [
    `digraph "${title}" {`,
    '  rankdir=LR;',
    '  node [shape=box, style=filled, fontname="Arial"];',
    '  edge [fontname="Arial", fontsize=10];',
    '',
  ]

  // 定义节点样式
  for (const node of dag) {
    const color = getNodeColor(node)
    const label = escapeLabel(node.title)
    lines.push(`  "${node.taskId}" [label="${label}", fillcolor="${color}"];`)
  }

  lines.push('')

  // 定义边
  for (const node of dag) {
    for (const depId of node.dependsOn) {
      lines.push(`  "${depId}" -> "${node.taskId}";`)
    }
  }

  lines.push('}')
  return lines.join('\n')
}

/**
 * 导出 DAG 为 Mermaid 格式
 */
export function exportToMermaid(dag: TaskDAGNode[], title: string = 'Task DAG'): string {
  const lines: string[] = [
    `---`,
    `title: ${title}`,
    `---`,
    'graph LR',
  ]

  // 定义节点
  for (const node of dag) {
    const status = getStatusEmoji(node.status)
    const label = `${status} ${escapeMermaidLabel(node.title)}`
    lines.push(`  ${node.taskId}["${label}"]`)
  }

  lines.push('')

  // 定义边
  for (const node of dag) {
    for (const depId of node.dependsOn) {
      lines.push(`  ${depId} --> ${node.taskId}`)
    }
  }

  return lines.join('\n')
}

/**
 * 获取节点颜色（基于状态）
 */
function getNodeColor(node: TaskDAGNode): string {
  switch (node.status) {
    case 'completed': return '#3FB95040'  // 绿色
    case 'in_progress': return '#58A6FF40' // 蓝色
    case 'failed': return '#F8514940'     // 红色
    case 'cancelled': return '#D2992240'  // 黄色
    default: return node.isBlocked ? '#F8514920' : '#6B728020' // 灰色或红色
  }
}

/**
 * 获取状态 Emoji
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'completed': return '✅'
    case 'in_progress': return '🔄'
    case 'failed': return '❌'
    case 'cancelled': return '⚠️'
    default: return '⏸️'
  }
}

/**
 * 转义 DOT 标签
 */
function escapeLabel(label: string): string {
  return label.replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * 转义 Mermaid 标签
 */
function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, '&quot;').replace(/\n/g, '<br/>')
}

/**
 * 计算任务的可达性矩阵
 */
export function calculateReachabilityMatrix(dag: TaskDAGNode[]): Map<string, Set<string>> {
  const matrix = new Map<string, Set<string>>()
  
  // 初始化
  for (const node of dag) {
    matrix.set(node.taskId, new Set([node.taskId]))
  }
  
  // 使用 Floyd-Warshall 算法计算传递闭包
  for (const node of dag) {
    for (const depId of node.dependsOn) {
      const depReachable = matrix.get(depId)
      if (depReachable) {
        const nodeReachable = matrix.get(node.taskId)!
        for (const reachable of depReachable) {
          nodeReachable.add(reachable)
        }
      }
    }
  }
  
  return matrix
}

/**
 * 找出可以并行执行的任务组
 */
export function findParallelGroups(dag: TaskDAGNode[]): TaskDAGNode[][] {
  const waveMap = new Map<number, TaskDAGNode[]>()
  
  for (const node of dag) {
    if (!waveMap.has(node.executionWave)) {
      waveMap.set(node.executionWave, [])
    }
    waveMap.get(node.executionWave)!.push(node)
  }
  
  return Array.from(waveMap.values()).sort((a, b) => {
    const waveA = a[0]?.executionWave ?? 0
    const waveB = b[0]?.executionWave ?? 0
    return waveA - waveB
  })
}

/**
 * 检测潜在的瓶颈任务
 */
export function detectBottlenecks(dag: TaskDAGNode[]): Array<{
  taskId: string
  title: string
  dependentCount: number
  reason: string
}> {
  const bottlenecks: Array<{
    taskId: string
    title: string
    dependentCount: number
    reason: string
  }> = []
  
  for (const node of dag) {
    // 如果有很多任务依赖于此任务，可能是瓶颈
    if (node.dependents.length >= 3) {
      bottlenecks.push({
        taskId: node.taskId,
        title: node.title,
        dependentCount: node.dependents.length,
        reason: `${node.dependents.length} 个任务依赖此任务`,
      })
    }
    
    // 如果被阻塞且有很多依赖者，是严重瓶颈
    if (node.isBlocked && node.dependents.length > 0) {
      bottlenecks.push({
        taskId: node.taskId,
        title: node.title,
        dependentCount: node.dependents.length,
        reason: `被阻塞且影响 ${node.dependents.length} 个后续任务`,
      })
    }
  }
  
  return bottlenecks.sort((a, b) => b.dependentCount - a.dependentCount)
}

/**
 * 生成 DAG 摘要报告
 */
export function generateDAGSummary(
  dag: TaskDAGNode[],
  tasks: TeamTask[],
  analysis: DAGAnalysis
): string {
  const lines: string[] = [
    '# Agent 任务 DAG 分析报告',
    '',
    '## 📊 概览',
    `- **总任务数**: ${analysis.totalTasks}`,
    `- **已完成**: ${analysis.completedTasks} (${Math.round(analysis.completedTasks / analysis.totalTasks * 100)}%)`,
    `- **待执行**: ${analysis.pendingTasks}`,
    `- **被阻塞**: ${analysis.blockedTasks}`,
    '',
    '## 🔍 结构分析',
    `- **依赖深度**: ${analysis.dependencyDepth} 层`,
    `- **最大并行度**: ${analysis.maxParallelism} 个任务`,
    `- **平均并行度**: ${analysis.averageParallelism.toFixed(1)}`,
    `- **关键路径长度**: ${analysis.criticalPathLength} 个任务`,
    '',
    '## ⏱️ 时间估算',
    `- **预估总时长**: ${analysis.estimatedTotalDuration} 分钟`,
    `- **关键路径**: ${analysis.criticalPath.join(' → ')}`,
    '',
  ]
  
  // 瓶颈分析
  const bottlenecks = detectBottlenecks(dag)
  if (bottlenecks.length > 0) {
    lines.push('## ⚠️ 瓶颈任务')
    bottlenecks.slice(0, 5).forEach(bottleneck => {
      lines.push(`- **${bottleneck.title}**: ${bottleneck.reason}`)
    })
    lines.push('')
  }
  
  // 并行组
  const parallelGroups = findParallelGroups(dag)
  if (parallelGroups.length > 0) {
    lines.push('## 🚀 并行执行组')
    parallelGroups.forEach((group, idx) => {
      lines.push(`### 波次 ${idx + 1} (${group.length} 个任务)`)
      group.forEach(task => {
        const status = task.status === 'completed' ? '✅' : task.status === 'in_progress' ? '🔄' : '⏸️'
        lines.push(`- ${status} ${task.title}`)
      })
      lines.push('')
    })
  }
  
  return lines.join('\n')
}
