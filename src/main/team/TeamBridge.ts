/**
 * TeamBridge - 团队成员通信桥接器
 *
 * 作为 WebSocket 服务器运行，让团队成员 agents 能互相通信。
 * 成员 agents 通过 WebSocket 连接到此桥，接收到目标消息后转发给 SessionManagerV2。
 *
 * 架构：
 * - 主进程创建 TeamBridge（每个团队实例一个）
 * - TeamManager.startMember() 时告知成员 Bridge 的连接信息（环境变量/初始提示词）
 * - 成员 agent 通过发送 WebSocket 消息调用 team_message_role / team_broadcast / team_claim_task 等
 * - TeamBridge 处理消息并与 TeamManager 交互
 *
 * @author weibin
 */

import { createServer } from 'net'
import { WebSocketServer, WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import type { TeamManager } from './TeamManager'
import type { SessionManagerV2 } from '../session/SessionManagerV2'
import type { TeamRepository } from './TeamRepository'
import type { TeamMember, TeamTask } from './types'
import { TeamMessageDelivery } from './TeamMessageDelivery'

interface TeamBridgeMessage {
  type: 'register' | 'team_message_role' | 'team_broadcast' | 'team_claim_task' | 'team_complete_task' | 'team_get_tasks' | 'team_get_members'
  memberId?: string
  instanceId?: string
  id?: string
  // team_message_role
  toRole?: string
  content?: string
  // team_claim_task
  taskId?: string
  // team_complete_task
  result?: string
}

interface TeamBridgeConnection {
  ws: WebSocket
  memberId: string
  instanceId: string
  registered: boolean
}

/** 检测端口是否可用 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.unref()
    server.on('error', () => resolve(false))
    server.listen(port, () => {
      server.close(() => resolve(true))
    })
  })
}

/** 在给定范围内寻找可用端口 */
async function findAvailablePort(startPort: number, maxAttempts: number = 100): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + maxAttempts - 1}`)
}

export class TeamBridge {
  private wss: WebSocketServer | null = null
  private connections = new Map<string, TeamBridgeConnection>()
  private port: number
  private teamManager: TeamManager
  private sessionManager: SessionManagerV2
  private teamRepo: TeamRepository
  private requestCounter = 0
  private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private messageDelivery: TeamMessageDelivery | null = null

  constructor(
    port: number,
    teamManager: TeamManager,
    sessionManager: SessionManagerV2,
    teamRepo: TeamRepository
  ) {
    this.port = port
    this.teamManager = teamManager
    this.sessionManager = sessionManager
    this.teamRepo = teamRepo
  }

  /** 启动 WebSocket 服务器（带端口冲突检测） */
  async start(): Promise<void> {
    // 检测端口可用性，如果被占用则自动寻找可用端口
    if (!(await isPortAvailable(this.port))) {
      const newPort = await findAvailablePort(this.port + 1)
      console.warn(`[TeamBridge] Port ${this.port} is in use, switching to ${newPort}`)
      this.port = newPort
    }

    this.wss = new WebSocketServer({ port: this.port })
    console.log(`[TeamBridge] Listening on ws://127.0.0.1:${this.port}`)

    // 初始化消息投递器（带重试）
    this.messageDelivery = new TeamMessageDelivery(
      (this.teamManager as any).agentManager,
      this.sessionManager,
      this.teamRepo
    )

    this.wss.on('connection', (ws) => {
      let connId = uuidv4()
      this.connections.set(connId, { ws, memberId: '', instanceId: '', registered: false })

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as TeamBridgeMessage & { type: string; id?: string }
          this.handleMessage(connId, msg)
        } catch (err) {
          console.error('[TeamBridge] Failed to parse message:', err)
        }
      })

      ws.on('close', () => {
        const conn = this.connections.get(connId)
        if (conn) {
          console.log(`[TeamBridge] Member ${conn.memberId || connId} disconnected`)
          this.connections.delete(connId)
        }
      })

      ws.on('error', (err) => {
        console.error(`[TeamBridge] WebSocket error for ${connId}:`, err)
      })
    })

    this.wss.on('error', (err) => {
      console.error('[TeamBridge] Server error:', err)
    })
  }

  /** 停止服务器 */
  stop(): void {
    for (const conn of this.connections.values()) {
      conn.ws.close()
    }
    this.connections.clear()
    this.wss?.close()
    this.wss = null
  }

  /** 获取桥接端口（用于告知成员 agents） */
  getPort(): number {
    return this.port
  }

  /** 向特定成员发送消息（由 TeamManager 调用） */
  sendToMember(memberId: string, message: string): void {
    for (const conn of this.connections.values()) {
      if (conn.memberId === memberId && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify({
          type: 'incoming_message',
          content: message,
          timestamp: new Date().toISOString(),
        }))
        return
      }
    }
    console.warn(`[TeamBridge] Member ${memberId} not connected, message queued in DB`)
  }

  /** 向所有成员广播消息 */
  broadcastToAll(message: string, fromMemberId: string): void {
    const payload = JSON.stringify({
      type: 'broadcast',
      from: fromMemberId,
      content: message,
      timestamp: new Date().toISOString(),
    })
    for (const conn of this.connections.values()) {
      if (conn.memberId !== fromMemberId && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(payload)
      }
    }
  }

  private handleMessage(connId: string, msg: TeamBridgeMessage & { type: string; id?: string }): void {
    switch (msg.type) {
      case 'register': {
        const conn = this.connections.get(connId)
        if (!conn || !msg.memberId || !msg.instanceId) return
        conn.memberId = msg.memberId
        conn.instanceId = msg.instanceId
        conn.registered = true
        console.log(`[TeamBridge] Member ${msg.memberId} registered for instance ${msg.instanceId}`)
        conn.ws.send(JSON.stringify({ type: 'registered', memberId: msg.memberId }))
        break
      }

      case 'team_message_role': {
        this.handleTeamMessageRole(connId, msg)
        break
      }

      case 'team_broadcast': {
        this.handleTeamBroadcast(connId, msg)
        break
      }

      case 'team_claim_task': {
        this.handleTeamClaimTask(connId, msg)
        break
      }

      case 'team_complete_task': {
        this.handleTeamCompleteTask(connId, msg)
        break
      }

      case 'team_get_tasks': {
        this.handleTeamGetTasks(connId, msg)
        break
      }

      case 'team_get_members': {
        this.handleTeamGetMembers(connId, msg)
        break
      }

      default:
        console.warn(`[TeamBridge] Unknown message type: ${msg.type}`)
    }
  }

  private handleTeamMessageRole(connId: string, msg: TeamBridgeMessage): void {
    const conn = this.connections.get(connId)
    if (!conn?.registered || !msg.toRole || !msg.content) {
      this.sendError(conn?.ws, msg.id, 'Invalid team_message_role call')
      return
    }

    // 查找目标成员
    const targetMember = this.teamRepo.getMemberByRole(conn.instanceId!, msg.toRole)
    if (!targetMember) {
      this.sendError(conn.ws, msg.id, `Role ${msg.toRole} not found in team`)
      return
    }

    this.teamManager.recordMessage(conn.instanceId, {
      id: uuidv4(),
      instanceId: conn.instanceId,
      from: conn.memberId,
      to: targetMember.id,
      type: 'role_message',
      content: msg.content,
      timestamp: new Date().toISOString(),
    })

    // 发送到目标成员
    this.sendToMember(targetMember.id, `[来自 ${conn.memberId}] ${msg.content}`)

    // 通过 TeamMessageDelivery（带重试）投递消息
    if (this.messageDelivery) {
      this.messageDelivery.sendMessage(
        conn.instanceId!,
        conn.memberId!,
        msg.toRole,
        `[团队消息 - 来自 ${conn.memberId}]: ${msg.content}`
      ).catch(err => {
        console.error('[TeamBridge] MessageDelivery failed for role message:', err)
      })
    }

    this.sendSuccess(conn.ws, msg.id, { delivered: true, to: msg.toRole })
  }

  private handleTeamBroadcast(connId: string, msg: TeamBridgeMessage): void {
    const conn = this.connections.get(connId)
    if (!conn?.registered || !msg.content) {
      this.sendError(conn?.ws, msg.id, 'Invalid team_broadcast call')
      return
    }

    this.teamManager.recordMessage(conn.instanceId, {
      id: uuidv4(),
      instanceId: conn.instanceId,
      from: conn.memberId,
      type: 'broadcast',
      content: msg.content,
      timestamp: new Date().toISOString(),
    })

    // 广播给所有其他成员
    this.broadcastToAll(msg.content, conn.memberId)

    // 通过 TeamMessageDelivery（带重试）广播消息
    if (this.messageDelivery) {
      this.messageDelivery.broadcastMessage(
        conn.instanceId!,
        conn.memberId!,
        `[团队广播 - 来自 ${conn.memberId}]: ${msg.content}`
      ).catch(err => {
        console.error('[TeamBridge] MessageDelivery failed for broadcast:', err)
      })
    }

    const members = this.teamRepo.getTeamMembers(conn.instanceId!)
    this.sendSuccess(conn.ws, msg.id, { delivered: members.length - 1 })
  }

  private handleTeamClaimTask(connId: string, msg: TeamBridgeMessage): void {
    const conn = this.connections.get(connId)
    if (!conn?.registered || !msg.taskId) {
      this.sendError(conn?.ws, msg.id, 'Invalid team_claim_task call')
      return
    }

    const result = this.teamManager.claimTask(conn.instanceId, msg.taskId, conn.memberId!)
    if (result.success && result.task) {
      // 更新成员当前任务
      this.teamRepo.updateMemberTask(conn.memberId!, msg.taskId)
      this.teamRepo.updateMemberStatus(conn.memberId!, 'running')
    }

    this.sendSuccess(conn.ws, msg.id, result)
  }

  private handleTeamCompleteTask(connId: string, msg: TeamBridgeMessage): void {
    const conn = this.connections.get(connId)
    if (!conn?.registered || !msg.taskId) {
      this.sendError(conn?.ws, msg.id, 'Invalid team_complete_task call')
      return
    }

    const task = this.teamRepo.getTask(msg.taskId)
    if (!task) {
      this.sendError(conn.ws, msg.id, `Task ${msg.taskId} not found`)
      return
    }

    // 验证认领者
    if (task.claimedBy !== conn.memberId) {
      this.sendError(conn.ws, msg.id, 'You did not claim this task')
      return
    }

    this.teamManager.completeTask(conn.instanceId, msg.taskId, msg.result || '')

    // 通知其他成员
    if (this.messageDelivery) {
      this.messageDelivery.broadcastMessage(
        conn.instanceId!,
        conn.memberId!,
        `[团队通知]: ${conn.memberId} 完成了任务 "${task.title}"`
      ).catch(err => {
        console.error('[TeamBridge] MessageDelivery failed for task completion notification:', err)
      })
    }

    this.sendSuccess(conn.ws, msg.id, { completed: true, taskId: msg.taskId })
  }

  private handleTeamGetTasks(connId: string, msg: TeamBridgeMessage): void {
    const conn = this.connections.get(connId)
    if (!conn?.registered) {
      this.sendError(conn?.ws, msg.id, 'Not registered')
      return
    }

    const tasks = this.teamRepo.getTeamTasks(conn.instanceId!)
    this.sendSuccess(conn.ws, msg.id, { tasks })
  }

  private handleTeamGetMembers(connId: string, msg: TeamBridgeMessage): void {
    const conn = this.connections.get(connId)
    if (!conn?.registered) {
      this.sendError(conn?.ws, msg.id, 'Not registered')
      return
    }

    const members = this.teamRepo.getTeamMembers(conn.instanceId!)
    this.sendSuccess(conn.ws, msg.id, { members })
  }

  private sendSuccess(ws: WebSocket | undefined, id: string | undefined, data: any): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'response', id, success: true, data }))
  }

  private sendError(ws: WebSocket | undefined, id: string | undefined, error: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'response', id, success: false, error }))
  }
}
