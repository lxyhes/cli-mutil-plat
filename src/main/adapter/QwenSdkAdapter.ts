/**
 * Qwen Coder CLI ACP Adapter
 *
 * 通过 Qwen CLI 的 --acp 模式与 Qwen Coder 进行结构化交互。
 * 协议：JSON-RPC 2.0 over NDJSON on stdin/stdout
 *
 * @author weibin
 */

import { spawn, type ChildProcess } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { createInterface } from 'readline'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ConversationMessage } from '../../shared/types'
import {
  BaseProviderAdapter,
  type AdapterSessionConfig,
  type AdapterSession,
  type ProviderEvent,
} from './types'
import { prependNodeVersionToEnvPath } from '../node/NodeVersionResolver'

// ---- Qwen CLI 可执行文件查找 ----

function findQwenExecutable(configCommand?: string): { command: string; useShell: boolean } {
  const normalizedCommand = (configCommand || 'qwen').trim() || 'qwen'

  // 如果是绝对路径，直接使用
  if (path.isAbsolute(normalizedCommand)) {
    return { command: normalizedCommand, useShell: false }
  }

  // Windows 下尝试查找 npm 全局安装的 qwen
  if (process.platform === 'win32') {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir()
    const npmGlobalDirs = [path.join(home, 'AppData', 'Roaming', 'npm')]
    const npmPrefix = process.env.NPM_PREFIX
    if (npmPrefix) npmGlobalDirs.push(npmPrefix)

    for (const dir of npmGlobalDirs) {
      for (const name of ['qwen.cmd', 'qwen.exe', 'qwen']) {
        const candidate = path.join(dir, name)
        if (fs.existsSync(candidate)) {
          return { command: candidate, useShell: candidate.endsWith('.cmd') }
        }
      }
    }
  }

  // Fallback: shell 模式
  return {
    command: normalizedCommand,
    useShell: process.platform === 'win32' && !path.isAbsolute(normalizedCommand),
  }
}

// ---- ACP 方法名常量 ----

const ACP_METHOD = {
  initialize:        'initialize',
  authenticate:      'authenticate',
  session_new:       'session/new',
  session_prompt:    'session/prompt',
  session_cancel:    'session/cancel',
  session_set_mode:  'session/set_mode',
} as const

const ACP_NOTIFICATION = {
  session_update:             'session/update',
  session_request_permission: 'session/request_permission',
  ask_user_questions:         '_qwen/user/questions',
  exit_plan_mode:             '_qwen/plan/exit',
} as const

const SESSION_UPDATE_TYPE = {
  agent_message_chunk: 'agent_message_chunk',
  tool_call:           'tool_call',
  tool_call_update:    'tool_call_update',
} as const

// ---- 内部会话状态 ----

interface QwenSession {
  adapter: AdapterSession
  config: AdapterSessionConfig
  process: ChildProcess
  qwenSessionId?: string
  requestId: number
  pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>
  currentText: string
  activeToolCalls: Map<string, string>
  pendingPermissionId?: number
}

export class QwenSdkAdapter extends BaseProviderAdapter {
  readonly providerId = 'qwen-coder' as const
  readonly displayName = 'Qwen Coder CLI'

  private sessions: Map<string, QwenSession> = new Map()
  private pendingResumeIds: Map<string, string> = new Map()

  // ---- 会话生命周期 ----

  async startSession(sessionId: string, config: AdapterSessionConfig): Promise<void> {
    // 启动 qwen --acp（stdio ACP 模式）
    const args = ['--acp']

    // yolo 模式
    if (config.autoAccept) {
      args.push('--yolo')
    }

    // 模型
    if (config.model) {
      args.push('--model', config.model)
    }

    const { command: qwenCmd, useShell: qwenShell } = findQwenExecutable(config.command)
    const env = prependNodeVersionToEnvPath(
      { ...process.env, ...config.envOverrides },
      config.nodeVersion
    )

    console.log(`[QwenAcpAdapter] Spawning qwen:`, qwenCmd, args, { shell: qwenShell, cwd: config.workingDirectory })

    const proc = spawn(qwenCmd, args, {
      cwd: config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: qwenShell,
      env,
    })

    const session: QwenSession = {
      adapter: {
        sessionId,
        status: 'starting',
        messages: [],
        createdAt: new Date().toISOString(),
        totalUsage: { inputTokens: 0, outputTokens: 0 },
      },
      config,
      process: proc,
      requestId: 0,
      pendingRequests: new Map(),
      currentText: '',
      activeToolCalls: new Map(),
    }

    this.sessions.set(sessionId, session)

    // ---- 监听 stdout ----
    const rl = createInterface({ input: proc.stdout! })
    rl.on('line', (line) => this.handleLine(sessionId, line.trim()))

    // ---- stderr 转日志 ----
    let stderrBuffer = ''
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (!text) return
      stderrBuffer += text + '\n'
      if (stderrBuffer.length > 2048) stderrBuffer = stderrBuffer.slice(-2048)
      if (text.includes('[ERROR]') || text.includes('Error:') || text.includes('FATAL') || text.includes('error:')) {
        console.error(`[QwenAcpAdapter][${sessionId}] stderr:`, text)
      } else {
        console.log(`[QwenAcpAdapter][${sessionId}] stderr:`, text)
      }
    })

    // ---- 进程退出 ----
    proc.on('exit', (code) => {
      const s = this.sessions.get(sessionId)
      if (!s) return
      rl.close()

      if (code !== 0) {
        const errSnippet = stderrBuffer.trim().slice(0, 800)
        const content = errSnippet
          ? `⚠️ Qwen 进程异常退出 (exit ${code}):\n${errSnippet}`
          : `⚠️ Qwen 进程异常退出 (exit ${code})，无详细错误信息。`
        const errMsg = {
          id: uuidv4(),
          sessionId,
          role: 'system' as const,
          content,
          timestamp: new Date().toISOString(),
        }
        s.adapter.messages.push(errMsg)
        this.emit('conversation-message', sessionId, errMsg)
      }

      s.adapter.status = 'completed'
      this.emit('status-change', sessionId, 'completed')
      this.emitEvent(sessionId, {
        type: 'session_complete',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { exitCode: code ?? 0 },
      })
      for (const [, p] of s.pendingRequests) {
        p.reject(new Error(`Qwen process exited with code ${code}`))
      }
      s.pendingRequests.clear()
    })

    proc.on('error', (err) => {
      const s = this.sessions.get(sessionId)
      if (!s) return
      console.error(`[QwenAcpAdapter] Process error for ${sessionId}:`, err)
      s.adapter.status = 'error'
      this.emit('status-change', sessionId, 'error')
      this.emitEvent(sessionId, {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { text: `Qwen 启动失败: ${err.message}` },
      })
      for (const [, p] of s.pendingRequests) {
        p.reject(err)
      }
      s.pendingRequests.clear()
    })

    this.emit('status-change', sessionId, 'starting')

    // ---- ACP 握手 ----
    try {
      // 1. initialize
      const initResult = await this.rpc(sessionId, ACP_METHOD.initialize, {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      })

      // 2. authenticate
      const authMethods: Array<{ id: string; name: string }> = initResult?.authMethods || []
      const methodId = authMethods[0]?.id ?? 'qwen'
      await this.rpc(sessionId, ACP_METHOD.authenticate, { methodId })

      // 3. session/new
      const resumeSessionId = this.pendingResumeIds.get(sessionId)
      if (resumeSessionId) this.pendingResumeIds.delete(sessionId)

      const sessionNewParams = {
        cwd: config.workingDirectory,
        mcpServers: this.loadMcpServersForAcp(config),
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
        ...(config.systemPrompt ? { settings: { systemPrompt: config.systemPrompt } } : {}),
      }
      console.log(`[QwenAcpAdapter][${sessionId}] session/new params:`, JSON.stringify(sessionNewParams, null, 2).slice(0, 500))

      const sessionResult = await this.rpc(sessionId, ACP_METHOD.session_new, sessionNewParams)
      console.log(`[QwenAcpAdapter][${sessionId}] session/new response:`, JSON.stringify(sessionResult, null, 2).slice(0, 500))

      session.qwenSessionId = sessionResult?.sessionId
      session.adapter.status = 'waiting_input'
      session.adapter.providerSessionId = session.qwenSessionId
      this.emit('status-change', sessionId, 'waiting_input')

      if (session.qwenSessionId) {
        this.emit('provider-session-id', sessionId, session.qwenSessionId)
        console.log(`[QwenAcpAdapter] Emitted provider-session-id for ${sessionId}: ${session.qwenSessionId}`)
      }

      this.emit('session-init-data', sessionId, {
        model: config.model || 'default',
        tools: [],
        mcpServers: [],
        skills: [],
        plugins: [],
        availableModels: this.getAvailableModels(),
      })

      // 4. 如果有初始 prompt，立即发送
      if (config.initialPrompt) {
        await this.sendMessage(sessionId, config.initialPrompt)
      }
    } catch (err: any) {
      console.error(`[QwenAcpAdapter] Init failed for ${sessionId}:`, err)

      // 检测认证错误
      const isAuthError = err.message?.includes('Authentication required') ||
        err.message?.includes('Missing API key') ||
        err.message?.includes('Authentication failed')

      if (isAuthError) {
        // 发出认证需要事件
        this.emit('auth-required', sessionId, {
          providerId: this.providerId,
          message: 'Qwen Coder CLI 需要认证。请在终端运行 `qwen auth` 完成授权，或配置 API Key。',
          authCommand: 'qwen auth',
        })
      }

      session.adapter.status = 'error'
      this.emit('status-change', sessionId, 'error')
      this.emitEvent(sessionId, {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        data: {
          text: isAuthError
            ? 'Qwen Coder CLI 需要认证。请运行 `qwen auth` 完成授权。'
            : `Qwen initialization failed: ${err.message}`
        },
      })
    }
  }

  private loadMcpServersForAcp(config: AdapterSessionConfig): any[] {
    if (!config.mcpConfigPath) return []
    try {
      const raw = fs.readFileSync(config.mcpConfigPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const mcpServers: Record<string, any> = parsed.mcpServers || {}
      return Object.entries(mcpServers).map(([name, cfg]) => {
        const server: any = { name, ...cfg }
        if (cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)) {
          server.env = Object.entries(cfg.env as Record<string, string>)
            .map(([k, v]) => ({ name: k, value: v }))
        }
        return server
      })
    } catch (err) {
      console.warn(`[QwenAcpAdapter] Failed to load MCP config:`, err)
      return []
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (!session.qwenSessionId) throw new Error(`Qwen session not initialized for ${sessionId}`)

    const userMsg: ConversationMessage = {
      id: uuidv4(),
      sessionId,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    }
    session.adapter.messages.push(userMsg)
    this.emit('conversation-message', sessionId, userMsg)

    session.adapter.status = 'running'
    session.currentText = ''
    this.emit('status-change', sessionId, 'running')

    try {
      await this.rpc(sessionId, ACP_METHOD.session_prompt, {
        sessionId: session.qwenSessionId,
        prompt: [{ type: 'text', text: message }],
      })

      const fullText = session.currentText.trim()
      if (fullText) {
        const assistantMsg: ConversationMessage = {
          id: uuidv4(),
          sessionId,
          role: 'assistant',
          content: fullText,
          timestamp: new Date().toISOString(),
        }
        session.adapter.messages.push(assistantMsg)
        this.emit('conversation-message', sessionId, assistantMsg)
      }

      this.emitEvent(sessionId, {
        type: 'turn_complete',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { usage: session.adapter.totalUsage },
      })
      session.adapter.status = 'waiting_input'
      this.emit('status-change', sessionId, 'waiting_input')
    } catch (err: any) {
      console.error(`[QwenAcpAdapter] Prompt failed for ${sessionId}:`, err)
      this.emitEvent(sessionId, {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { text: err.message },
      })
    }
  }

  async sendConfirmation(sessionId: string, accept: boolean): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const permId = session.pendingPermissionId
    if (permId == null) return
    session.pendingPermissionId = undefined

    const response = {
      jsonrpc: '2.0',
      id: permId,
      result: { allow: accept ? 'allow_once' : 'deny' },
    }
    this.writeLine(sessionId, JSON.stringify(response))
  }

  async abortCurrentTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session?.qwenSessionId) return
    try {
      await this.rpc(sessionId, ACP_METHOD.session_cancel, {
        sessionId: session.qwenSessionId,
      })
    } catch (_) { /* ignore */ }
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    for (const [, p] of session.pendingRequests) {
      p.reject(new Error('Session terminated'))
    }
    session.pendingRequests.clear()

    try { session.process.kill() } catch (_) { /* ignore */ }

    session.adapter.status = 'completed'
    this.emit('status-change', sessionId, 'completed')
    this.sessions.delete(sessionId)
  }

  async resumeSession(
    sessionId: string,
    providerSessionId: string,
    config: AdapterSessionConfig
  ): Promise<void> {
    if (providerSessionId) {
      this.pendingResumeIds.set(sessionId, providerSessionId)
    }
    await this.startSession(sessionId, config)
  }

  getConversation(sessionId: string): ConversationMessage[] {
    return this.sessions.get(sessionId)?.adapter.messages || []
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getProviderSessionId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.qwenSessionId
  }

  cleanup(): void {
    for (const [sid] of this.sessions) {
      try { this.terminateSession(sid) } catch (_) { /* ignore */ }
    }
    this.sessions.clear()
    this.pendingResumeIds.clear()
  }

  private getAvailableModels(): Array<{ id: string; name: string; description?: string }> {
    return [
      { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', description: '最强代码模型' },
      { id: 'qwen-coder-turbo', name: 'Qwen Coder Turbo', description: '快速响应' },
      { id: 'qwen2.5-coder-32b', name: 'Qwen2.5 Coder 32B', description: '开源模型' },
    ]
  }

  // ---- ACP NDJSON 行处理 ----

  private handleLine(sessionId: string, line: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || !line) return

    if (!line.startsWith('{')) {
      console.log(`[QwenAcpAdapter][${sessionId}] stdout non-JSON: ${line.slice(0, 200)}`)
    }

    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      console.debug(`[QwenAcpAdapter][${sessionId}] skip non-JSON line: ${line.slice(0, 120)}`)
      return
    }

    const msgId = msg.id
    const hasResult = msg.result !== undefined
    const hasError = msg.error !== undefined
    const hasMethod = msg.method !== undefined

    if (msgId !== undefined || hasMethod) {
      console.log(
        `[QwenAcpAdapter][${sessionId}] RPC message received:`
        + ` id=${msgId ?? '(notification)'}`
        + ` method=${hasMethod ? msg.method : '(response)'}`
        + ` hasResult=${hasResult}`
        + ` hasError=${hasError}`
      )
    }

    // JSON-RPC 响应
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = session.pendingRequests.get(msg.id)
      if (pending) {
        session.pendingRequests.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // JSON-RPC 通知或 Server→Client 请求
    if (msg.method) {
      if (msg.id !== undefined) {
        this.handleServerRequest(sessionId, msg.id, msg.method, msg.params || {})
      } else {
        this.handleNotification(sessionId, msg.method, msg.params || {})
      }
    }
  }

  private handleServerRequest(sessionId: string, reqId: number, method: string, params: any): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const ts = new Date().toISOString()

    switch (method) {
      case ACP_NOTIFICATION.session_request_permission: {
        const description = params.permission?.description || params.description || params.message || 'Qwen requires approval'
        const toolName = params.permission?.toolName || params.toolName || 'unknown'
        session.pendingPermissionId = reqId
        this.emitEvent(sessionId, {
          type: 'permission_request',
          sessionId,
          timestamp: ts,
          data: { permissionPrompt: description, toolName, toolInput: params.permission?.input || {} },
        })
        break
      }

      case ACP_NOTIFICATION.ask_user_questions: {
        const question = params.questions?.[0]?.text || params.question || 'Qwen has a question'
        session.pendingPermissionId = reqId
        this.emitEvent(sessionId, {
          type: 'permission_request',
          sessionId,
          timestamp: ts,
          data: { permissionPrompt: question, toolName: 'ask_user_questions' },
        })
        break
      }

      default: {
        const autoReply = { jsonrpc: '2.0', id: reqId, result: {} }
        this.writeLine(sessionId, JSON.stringify(autoReply))
        break
      }
    }
  }

  private handleNotification(sessionId: string, method: string, params: any): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const ts = new Date().toISOString()

    switch (method) {
      case ACP_NOTIFICATION.session_update: {
        const update = params.update || {}
        const updateType = update.sessionUpdate

        switch (updateType) {
          case SESSION_UPDATE_TYPE.agent_message_chunk: {
            const text = update.content?.text || update.content || ''
            if (!text) break
            session.currentText += text
            const deltaMsg: ConversationMessage = {
              id: uuidv4(),
              sessionId,
              role: 'assistant',
              content: text,
              timestamp: ts,
              isDelta: true,
            }
            this.emit('conversation-message', sessionId, deltaMsg)
            this.emitEvent(sessionId, { type: 'text_delta', sessionId, timestamp: ts, data: { text } })
            break
          }

          case SESSION_UPDATE_TYPE.tool_call: {
            const toolName = update.toolName || 'unknown'
            const toolCallId = update.toolCallId || uuidv4()
            session.activeToolCalls.set(toolCallId, toolName)
            const toolInput: Record<string, unknown> = {}
            if (update.title) toolInput.title = update.title
            const toolMsg: ConversationMessage = {
              id: uuidv4(),
              sessionId,
              role: 'tool_use',
              content: `${toolName}: ${update.title || ''}`,
              timestamp: ts,
              toolName,
              toolInput,
            }
            session.adapter.messages.push(toolMsg)
            this.emit('conversation-message', sessionId, toolMsg)
            this.emitEvent(sessionId, { type: 'tool_use_start', sessionId, timestamp: ts, data: { toolName, toolInput, toolUseId: toolCallId } })
            break
          }

          case SESSION_UPDATE_TYPE.tool_call_update: {
            const toolCallId = update.toolCallId
            const toolName = update.toolName || session.activeToolCalls.get(toolCallId) || 'unknown'
            const status = update.status
            if (status !== 'completed' && status !== 'failed') break

            const resultContent = update.content || []
            const resultText = Array.isArray(resultContent)
              ? resultContent.map((c: any) => c?.content?.text || c?.text || '').join('\n')
              : String(resultContent)
            const isError = status === 'failed'

            const resultMsg: ConversationMessage = {
              id: uuidv4(),
              sessionId,
              role: 'tool_result',
              content: resultText.slice(0, 2000),
              timestamp: ts,
              toolResult: resultText,
              isError,
            }
            session.adapter.messages.push(resultMsg)
            this.emit('conversation-message', sessionId, resultMsg)
            this.emitEvent(sessionId, { type: 'tool_use_end', sessionId, timestamp: ts, data: { toolResult: resultText, isError, toolUseId: toolCallId, toolName } })

            if (status === 'completed' || status === 'failed') {
              session.activeToolCalls.delete(toolCallId)
            }
            break
          }

          default: {
            const text = update.content?.text || update.text || ''
            if (text) {
              session.currentText += text
              this.emitEvent(sessionId, { type: 'text_delta', sessionId, timestamp: ts, data: { text } })
            }
            break
          }
        }
        break
      }

      default:
        break
    }
  }

  // ---- JSON-RPC over stdio ----

  private rpc(sessionId: string, method: string, params?: Record<string, unknown>): Promise<any> {
    const session = this.sessions.get(sessionId)
    if (!session) return Promise.reject(new Error(`Session ${sessionId} not found`))

    const id = ++session.requestId
    const req = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })

    console.log(`[QwenAcpAdapter][${sessionId}] RPC request sent: id=${id} method=${method}`)

    return new Promise((resolve, reject) => {
      session.pendingRequests.set(id, { resolve, reject })
      this.writeLine(sessionId, req)

      const isPrompt = method === ACP_METHOD.session_prompt
      const isSessionNew = method === ACP_METHOD.session_new
      const timeoutMs = isPrompt ? 10 * 60 * 1000 : isSessionNew ? 120_000 : 30_000
      const timer = setTimeout(() => {
        if (session.pendingRequests.has(id)) {
          session.pendingRequests.delete(id)
          console.error(`[QwenAcpAdapter][${sessionId}] RPC timeout: id=${id} method=${method}`)
          reject(new Error(`ACP RPC timeout (${timeoutMs / 1000}s): ${method}`))
        }
      }, timeoutMs)

      const original = session.pendingRequests.get(id)!
      session.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); original.resolve(v) },
        reject:  (e) => { clearTimeout(timer); original.reject(e) },
      })
    })
  }

  private writeLine(sessionId: string, line: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.process.stdin?.writable) return
    session.process.stdin.write(line + '\n', 'utf8')
  }

  private emitEvent(sessionId: string, event: ProviderEvent): void {
    this.emit('event', event)
  }
}
