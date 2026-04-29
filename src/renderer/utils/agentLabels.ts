export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type AgentMergeReadiness = 'ready' | 'watch' | 'needs-validation' | 'blocked'

export function getAgentStatusLabel(status: AgentStatus): string {
  return {
    pending: '待启动',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status]
}

export function getAgentMergeReadinessLabel(status: AgentMergeReadiness): string {
  return {
    ready: '可合并',
    watch: '需观察',
    'needs-validation': '缺验证',
    blocked: '阻塞',
  }[status]
}

export function getAgentMergeReadinessClass(status: AgentMergeReadiness): string {
  return {
    ready: 'bg-accent-green/10 text-accent-green',
    watch: 'bg-accent-blue/10 text-accent-blue',
    'needs-validation': 'bg-accent-yellow/10 text-accent-yellow',
    blocked: 'bg-accent-red/10 text-accent-red',
  }[status]
}
