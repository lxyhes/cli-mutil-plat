/**
 * AgentBridge - WebSocket 服务端，运行在 Electron 主进程
 * MCP Server (stdio 子进程) 通过 WS 连接此桥接器，转发请求到 AgentManager
 * @author weibin
 */

import { EventEmitter } from 'events'
import { WebSocketServer, WebSocket } from 'ws'
import type { BridgeRequest, BridgeResponse } from './types'

export class AgentBridge extends EventEmitter {
  private wss: WebSocketServer | null = null
  private connections: Map<string, WebSocket> = new Map() // sessionId → ws
  private port: number = 0
  private teamBridgeHandler?: (request: BridgeRequest) => Promise<{ result?: any; error?: string }>
  
  // ★ 心跳检测配置
  private heartbeatInterval: NodeJS.Timeout | null = null
  private readonly HEARTBEAT_INTERVAL_MS = 30000 // 30 秒
  private readonly HEARTBEAT_TIMEOUT_MS = 10000 // 10 秒超时

  /**
   * 启动 WebSocket 服务
   */
  start(port: number): void {
    this.port = port
    this.wss = new WebSocketServer({ host: '127.0.0.1', port })

    this.wss.on('connection', (ws: WebSocket) => {
      let registeredSessionId: string | null = null

      ws.on('message', (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(raw.toString())

          // 注册消息：MCP Server 连接后先注册 sessionId
          if (msg.type === 'register') {
            registeredSessionId = msg.sessionId
            this.connections.set(msg.sessionId, ws)
            console.log(`[AgentBridge] MCP Server registered for session: ${msg.sessionId}`)
            ws.send(JSON.stringify({ type: 'registered', sessionId: msg.sessionId }))
            return
          }

          // 文件变更事件：MCP Server 本地执行文件操作后通知
          if (msg.type === 'file-change') {
            this.emit('file-change', {
              sessionId: registeredSessionId || msg.sessionId,
              data: msg.data,
            })
            return
          }

          // 请求消息：转发到 AgentManager 处理（team_* 方法由 TeamBridge 处理）
          if (msg.type === 'request') {
            const request: BridgeRequest = {
              id: msg.id,
              sessionId: registeredSessionId || msg.sessionId,
              method: msg.method,
              params: msg.params || {}
            }

            // ★ team_* 方法由 TeamBridge 处理
            if (
              this.teamBridgeHandler &&
              (request.method === 'team_message_role' ||
                request.method === 'team_broadcast' ||
                request.method === 'team_claim_task' ||
                request.method === 'team_complete_task' ||
                request.method === 'team_get_tasks' ||
                request.method === 'team_get_members')
            ) {
              this.teamBridgeHandler(request).then(result => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'response', id: request.id, result: result.result, error: result.error }))
                }
              }).catch(err => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'response', id: request.id, error: err.message }))
                }
              })
              return
            }

            this.emit('request', request, (response: BridgeResponse) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'response', ...response }))
              }
            })
          }
        } catch (err) {
          console.error('[AgentBridge] Failed to parse message:', err)
        }
      })

      ws.on('close', () => {
        if (registeredSessionId) {
          this.connections.delete(registeredSessionId)
          console.log(`[AgentBridge] MCP Server disconnected: ${registeredSessionId}`)
        }
      })

      ws.on('error', (err) => {
        console.error('[AgentBridge] WebSocket error:', err)
      })
      
      // ★ 初始化心跳标记
      ;(ws as any).isAlive = true
      ws.on('pong', () => {
        ;(ws as any).isAlive = true
      })
    })

    this.wss.on('error', (err) => {
      console.error(`[AgentBridge] Server error on port ${port}:`, err)
    })

    // ★ 启动心跳检测定时器
    this.startHeartbeat()

    console.log(`[AgentBridge] WebSocket server started on 127.0.0.1:${port}`)
  }

  /**
   * 注册团队通信处理器（TeamManager 初始化后调用）
   */
  setTeamBridgeHandler(
    handler: (request: BridgeRequest) => Promise<{ result?: any; error?: string }>
  ): void {
    this.teamBridgeHandler = handler
  }

  /**
   * ★ 启动心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }

    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return

      this.wss.clients.forEach((ws: WebSocket) => {
        // 如果客户端上次没有响应 ping，则断开连接
        if ((ws as any).isAlive === false) {
          console.warn('[AgentBridge] Client failed heartbeat, terminating connection')
          return ws.terminate()
        }

        // 标记为未响应，发送 ping
        ;(ws as any).isAlive = false
        ws.ping()
      })
    }, this.HEARTBEAT_INTERVAL_MS)
  }

  /**
   * ★ 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * 获取当前端口
   */
  getPort(): number {
    return this.port
  }

  /**
   * 关闭服务
   */
  close(): void {
    // ★ 停止心跳检测
    this.stopHeartbeat()
    
    if (this.wss) {
      // 关闭所有连接
      for (const ws of this.connections.values()) {
        try { ws.close() } catch (_) { /* ignore */ }
      }
      this.connections.clear()
      this.wss.close()
      this.wss = null
      console.log('[AgentBridge] Server closed')
    }
  }
}
