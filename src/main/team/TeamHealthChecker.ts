/**
 * Agent Teams 健康检查和恢复机制
 * 监控团队成员状态、任务进度，自动处理异常情况
 * @author weibin
 */

import { EventEmitter } from 'events'
import type { DatabaseManager } from '../storage/Database'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { AgentManagerV2 } from '../agent/AgentManagerV2'

export interface TeamHealthStatus {
  instanceId: string
  healthy: boolean
  issues: TeamHealthIssue[]
  lastCheckTime: string
  stats: {
    totalMembers: number
    activeMembers: number
    failedMembers: number
    totalTasks: number
    completedTasks: number
    stuckTasks: number
  }
}

export interface TeamHealthIssue {
  type: 'member_dead' | 'task_stuck' | 'no_progress' | 'communication_failure'
  severity: 'warning' | 'error' | 'critical'
  message: string
  affectedEntity: string // memberId or taskId
  timestamp: string
  autoFixed?: boolean
}

export interface HealthCheckConfig {
  /** 健康检查间隔（毫秒） */
  checkInterval: number
  /** 任务卡住阈值（毫秒） */
  taskStuckThreshold: number
  /** 团队无进展阈值（毫秒） */
  noProgressThreshold: number
  /** 自动修复开关 */
  autoFix: boolean
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  checkInterval: 30000, // 30秒
  taskStuckThreshold: 600000, // 10分钟
  noProgressThreshold: 1800000, // 30分钟
  autoFix: true
}

/**
 * Agent Teams 健康检查器
 *
 * 事件:
 * - 'health-issue' (instanceId, issue) - 发现健康问题
 * - 'health-recovered' (instanceId, issue) - 问题已恢复
 * - 'member-failed' (instanceId, memberId) - 成员失败
 * - 'task-stuck' (instanceId, taskId) - 任务卡住
 */
export class TeamHealthChecker extends EventEmitter {
  private database: DatabaseManager
  private sessionManager: SessionManagerV2
  private agentManager: AgentManagerV2
  private config: HealthCheckConfig
  private checkTimers = new Map<string, NodeJS.Timeout>()
  private lastProgressTime = new Map<string, number>()

  constructor(
    database: DatabaseManager,
    sessionManager: SessionManagerV2,
    agentManager: AgentManagerV2,
    config: Partial<HealthCheckConfig> = {}
  ) {
    super()
    this.database = database
    this.sessionManager = sessionManager
    this.agentManager = agentManager
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 开始监控团队实例
   */
  startMonitoring(instanceId: string): void {
    if (this.checkTimers.has(instanceId)) {
      console.warn(`[TeamHealthChecker] Already monitoring instance ${instanceId}`)
      return
    }

    console.log(`[TeamHealthChecker] Starting health checks for instance ${instanceId}`)
    this.lastProgressTime.set(instanceId, Date.now())

    const timer = setInterval(async () => {
      try {
        await this.performHealthCheck(instanceId)
      } catch (error) {
        console.error(
          `[TeamHealthChecker] Error during health check for ${instanceId}:`,
          error
        )
      }
    }, this.config.checkInterval)

    this.checkTimers.set(instanceId, timer)
  }

  /**
   * 停止监控团队实例
   */
  stopMonitoring(instanceId: string): void {
    const timer = this.checkTimers.get(instanceId)
    if (timer) {
      clearInterval(timer)
      this.checkTimers.delete(instanceId)
      this.lastProgressTime.delete(instanceId)
      console.log(`[TeamHealthChecker] Stopped health checks for instance ${instanceId}`)
    }
  }

  /**
   * 执行健康检查
   */
  private async performHealthCheck(instanceId: string): Promise<TeamHealthStatus> {
    const issues: TeamHealthIssue[] = []
    const now = Date.now()

    // 检查团队实例是否存在
    const instance = await this.database.team.getInstance(instanceId)
    if (!instance) {
      console.warn(`[TeamHealthChecker] Instance ${instanceId} not found, stopping monitoring`)
      this.stopMonitoring(instanceId)
      return {
        instanceId,
        healthy: false,
        issues: [{
          type: 'communication_failure',
          severity: 'critical',
          message: 'Team instance not found',
          affectedEntity: instanceId,
          timestamp: new Date().toISOString()
        }],
        lastCheckTime: new Date().toISOString(),
        stats: {
          totalMembers: 0,
          activeMembers: 0,
          failedMembers: 0,
          totalTasks: 0,
          completedTasks: 0,
          stuckTasks: 0
        }
      }
    }

    // 如果团队已完成或失败，停止监控
    if (instance.status === 'completed' || instance.status === 'failed') {
      this.stopMonitoring(instanceId)
      return {
        instanceId,
        healthy: true,
        issues: [],
        lastCheckTime: new Date().toISOString(),
        stats: {
          totalMembers: 0,
          activeMembers: 0,
          failedMembers: 0,
          totalTasks: 0,
          completedTasks: 0,
          stuckTasks: 0
        }
      }
    }

    // 检查成员状态
    const members = await this.database.team.getMembers(instanceId)
    let activeMembers = 0
    let failedMembers = 0

    for (const member of members) {
      const session = this.sessionManager.getSession(member.sessionId)

      if (!session || session.status === 'error' || session.status === 'terminated') {
        failedMembers++
        const issue: TeamHealthIssue = {
          type: 'member_dead',
          severity: 'error',
          message: `Member ${member.roleId} session is dead or terminated`,
          affectedEntity: member.id,
          timestamp: new Date().toISOString()
        }
        issues.push(issue)
        this.emit('health-issue', instanceId, issue)

        // 自动修复：标记成员为失败
        if (this.config.autoFix && member.status !== 'failed') {
          await this.database.team.updateMember(member.id, { status: 'failed' })
          issue.autoFixed = true
          this.emit('member-failed', instanceId, member.id)
          console.log(`[TeamHealthChecker] Auto-fixed: marked member ${member.roleId} as failed`)
        }
      } else if (session.status === 'running' || session.status === 'idle') {
        activeMembers++
      }
    }

    // 检查任务状态
    const allTasks = await this.database.team.getTasks(instanceId)
    const inProgressTasks = allTasks.filter(t => t.status === 'in_progress')
    const completedTasks = allTasks.filter(t => t.status === 'completed')
    let stuckTasks = 0

    for (const task of inProgressTasks) {
      if (!task.claimedAt) continue

      const claimedAt = new Date(task.claimedAt).getTime()
      const elapsed = now - claimedAt

      if (elapsed > this.config.taskStuckThreshold) {
        stuckTasks++
        const issue: TeamHealthIssue = {
          type: 'task_stuck',
          severity: 'warning',
          message: `Task ${task.id} stuck for ${Math.round(elapsed / 60000)} minutes`,
          affectedEntity: task.id,
          timestamp: new Date().toISOString()
        }
        issues.push(issue)
        this.emit('health-issue', instanceId, issue)

        // 自动修复：释放卡住的任务
        if (this.config.autoFix) {
          await this.database.team.updateTask(task.id, {
            status: 'pending',
            claimedBy: null,
            claimedAt: null
          })
          issue.autoFixed = true
          this.emit('task-stuck', instanceId, task.id)
          console.log(`[TeamHealthChecker] Auto-fixed: released stuck task ${task.id}`)
        }
      }
    }

    // 检查团队整体进展
    const lastProgress = this.lastProgressTime.get(instanceId) || now
    const noProgressDuration = now - lastProgress

    if (completedTasks.length > 0) {
      // 有任务完成，更新进展时间
      this.lastProgressTime.set(instanceId, now)
    } else if (noProgressDuration > this.config.noProgressThreshold) {
      const issue: TeamHealthIssue = {
        type: 'no_progress',
        severity: 'warning',
        message: `No progress for ${Math.round(noProgressDuration / 60000)} minutes`,
        affectedEntity: instanceId,
        timestamp: new Date().toISOString()
      }
      issues.push(issue)
      this.emit('health-issue', instanceId, issue)
    }

    const status: TeamHealthStatus = {
      instanceId,
      healthy: issues.length === 0,
      issues,
      lastCheckTime: new Date().toISOString(),
      stats: {
        totalMembers: members.length,
        activeMembers,
        failedMembers,
        totalTasks: allTasks.length,
        completedTasks: completedTasks.length,
        stuckTasks
      }
    }

    // 如果有严重问题，记录日志
    if (issues.some(i => i.severity === 'critical' || i.severity === 'error')) {
      console.warn(
        `[TeamHealthChecker] Health issues detected for ${instanceId}:`,
        issues.map(i => `${i.type}(${i.severity})`).join(', ')
      )
    }

    return status
  }

  /**
   * 获取团队健康状态（立即执行检查）
   */
  async getHealthStatus(instanceId: string): Promise<TeamHealthStatus> {
    return this.performHealthCheck(instanceId)
  }

  /**
   * 停止所有监控
   */
  stopAll(): void {
    for (const instanceId of this.checkTimers.keys()) {
      this.stopMonitoring(instanceId)
    }
  }

  /**
   * 获取监控统计
   */
  getStats(): {
    monitoredInstances: number
    activeChecks: number
  } {
    return {
      monitoredInstances: this.checkTimers.size,
      activeChecks: this.checkTimers.size
    }
  }
}
