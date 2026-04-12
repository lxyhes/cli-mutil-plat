/**
 * Qwen Coder CLI ACP Adapter
 *
 * 通过 Qwen CLI 的 --acp 模式与 Qwen Coder 进行结构化交互。
 * 协议：JSON-RPC 2.0 over NDJSON on stdin/stdout
 *
 * ★ 进程复用：同一个 Qwen adapter 只维护一个 qwen --acp 进程，
 *   所有 session 通过 session/new 共享该进程，认证只做一次。
 *   Resume 时不需要重新 spawn 进程和重新认证。
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

// ---- 共享进程状态 ----

interface SharedProcess {
  process: ChildProcess
  requestId: number
  pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>
  /** 认证是否已完成 */
  authenticated: boolean
  /** 认证 Promise，后续 session 等待它完成 */
  authPromise?: Promise<void>
  /** 进程是否还活着 */
  alive: boolean
  /** 按 requestId → sessionId 映射，用于将 RPC 响应路由到正确的 session */
  requestSessionMap: Map<number, string>
  /** readline 接口 */
  readline: ReturnType<typeof createInterface>
}

// ---- 内部会话状态 ----

interface QwenSession {
  adapter: AdapterSession
  config: AdapterSessionConfig
  qwenSessionId?: string
  currentText: string
  activeToolCalls: Map<string, string>
  pendingPermissionId?: number
}

export class QwenSdkAdapter extends BaseProviderAdapter {
  readonly providerId = 'qwen-coder' as const
  readonly displayName = 'Qwen Coder CLI'

  private sessions: Map<string, QwenSession> = new Map()
  /** 共享的 qwen --acp 进程 */
  private sharedProcess: SharedProcess | null = null
  /** 用于首次 spawn 的 config（复用相同参数） */
  private spawnConfig: AdapterSessionConfig | null = null

  // ---- 共享进程管理 ----

  /**
   * 获取或创建共享的 qwen --acp 进程。
   * 如果进程已认证完成，直接返回；否则等待认证完成。
   */
  private async ensureProcess(config: AdapterSessionConfig): Promise<SharedProcess> {
    // 如果共享进程还活着且已认证，直接复用
    if (this.sharedProcess?.alive && this.sharedProcess.authenticated) {
      return this.sharedProcess
    }

    // 如果共享进程正在启动/认证中，等待它完成
    if (this.sharedProcess?.authPromise && this.sharedProcess.alive) {
      await this.sharedProcess.authPromise
      return this.sharedProcess
    }

    // 需要创建新进程
    this.spawnConfig = config
    return this.spawnNewProcess(config)
  }

  /**
   * Spawn 一个新的 qwen --acp 进程并完成 initialize + authenticate
   */
  private async spawnNewProcess(config: AdapterSessionConfig): Promise<SharedProcess> {
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

    console.log(`[QwenAcpAdapter] Spawning shared qwen process:`, qwenCmd, args, { shell: qwenShell, cwd: config.workingDirectory })

    const proc = spawn(qwenCmd, args, {
      cwd: config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: qwenShell,
      env,
    })

    const sp: SharedProcess = {
      process: proc,
      requestId: 0,
      pendingRequests: new Map(),
      authenticated: false,
      alive: true,
      requestSessionMap: new Map(),
      readline: createInterface({ input: proc.stdout! }),
    }

    this.sharedProcess = sp

    // ---- 监听 stdout ----
    sp.readline.on('line', (line) => this.handleLine(line.trim()))

    // ---- stderr 转日志 + 自动打开 OAuth URL ----
    let stderrBuffer = ''
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (!text) return
      stderrBuffer += text + '\n'
      if (stderrBuffer.length > 2048) stderrBuffer = stderrBuffer.slice(-2048)
      if (text.includes('[ERROR]') || text.includes('Error:') || text.includes('FATAL') || text.includes('error:')) {
        console.error(`[QwenAcpAdapter] stderr:`, text)
      } else {
        console.log(`[QwenAcpAdapter] stderr:`, text)
      }

      // 自动检测 OAuth URL 并在浏览器中打开
      const urlMatch = text.match(/https:\/\/[^\s|]+authorize[^\s|]*/i)
      if (urlMatch) {
        const authUrl = urlMatch[0]
        console.log(`[QwenAcpAdapter] Detected OAuth URL, opening browser: ${authUrl}`)
        const cmd = process.platform === 'darwin'
          ? `open "${authUrl}"`
          : process.platform === 'win32'
            ? `start "" "${authUrl}"`
            : `xdg-open "${authUrl}"`
        spawn(cmd, [], { shell: true, stdio: 'ignore' }).on('error', (err) => {
          console.warn(`[QwenAcpAdapter] Failed to open browser:`, err.message)
        })
      }
    })

    // ---- 进程退出 ----
    proc.on('exit', (code) => {
      sp.alive = false
      sp.authenticated = false
      sp.readline.close()

      // 通知所有活跃会话
      for (const [sessionId, session] of this.sessions) {
        if (code !== 0) {
          const errSnippet = stderrBuffer.trim().slice(0, 800)
          const content = errSnippet
            ? `⚠️ Qwen 进程异常退出 (exit ${code}):\n${errSnippet}`
            : `⚠️ Qwen 进程异常退出 (exit ${code})，无详细错误信息。`
          const errMsg: ConversationMessage = {
            id: uuidv4(),
            sessionId,
            role: 'system',
            content,
            timestamp: new Date().toISOString(),
          }
          session.adapter.messages.push(errMsg)
          this.emit('conversation-message', sessionId, errMsg)
        }

        session.adapter.status = 'completed'
        this.emit('status-change', sessionId, 'completed')
        this.emitEvent(sessionId, {
          type: 'session_complete',
          sessionId,
          timestamp: new Date().toISOString(),
          data: { exitCode: code ?? 0 },
        })
      }

      // reject 所有 pending requests
      for (const [, p] of sp.pendingRequests) {
        p.reject(new Error(`Qwen process exited with code ${code}`))
      }
      sp.pendingRequests.clear()
      sp.requestSessionMap.clear()
    })

    proc.on('error', (err) => {
      sp.alive = false
      sp.authenticated = false
      console.error(`[QwenAcpAdapter] Process error:`, err)

      // 通知所有活跃会话
      for (const [sessionId, session] of this.sessions) {
        session.adapter.status = 'error'
        this.emit('status-change', sessionId, 'error')
        this.emitEvent(sessionId, {
          type: 'error',
          sessionId,
          timestamp: new Date().toISOString(),
          data: { text: `Qwen 启动失败: ${err.message}` },
        })
      }

      for (const [, p] of sp.pendingRequests) {
        p.reject(err)
      }
      sp.pendingRequests.clear()
      sp.requestSessionMap.clear()
    })

    // ---- ACP 握手（initialize + authenticate）----
    let authMethods: Array<{ id: string; name: string; _meta?: any }> = []
    const authPromise = (async () => {
      try {
        // 1. initialize
        const initResult = await this.rpcOnProcess(sp, ACP_METHOD.initialize, {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
          },
        })

        // 2. authenticate
        authMethods = initResult?.authMethods || []
        const oauthMethod = authMethods.find(m => m.id === 'qwen-oauth' || m.id === 'qwen')
        const methodId = oauthMethod?.id ?? authMethods[0]?.id ?? 'qwen-oauth'
        console.log(`[QwenAcpAdapter] authMethods:`, JSON.stringify(authMethods), `→ selected: ${methodId}`)
        await this.rpcOnProcess(sp, ACP_METHOD.authenticate, { methodId })

        sp.authenticated = true
        console.log(`[QwenAcpAdapter] Shared process authenticated successfully`)
      } catch (err: any) {
        console.error(`[QwenAcpAdapter] Auth failed:`, err)

        // 检测认证错误
        const isAuthError = err.message?.includes('Authentication required') ||
          err.message?.includes('Missing API key') ||
          err.message?.includes('Authentication failed')

        if (isAuthError) {
          const envKeyMatch = err.message?.match(/environment variable '([^']+)'/)
          const requiredEnvKey = envKeyMatch?.[1] || ''

          const oauthMethod = authMethods.find(m => m.id === 'qwen-oauth')
          const authCommand = oauthMethod?._meta?.args?.length
            ? `qwen ${oauthMethod._meta.args.join(' ')}`
            : 'qwen auth'

          // 找到当前正在等待的 session 发出 auth-required
          for (const [sessionId, session] of this.sessions) {
            if (session.adapter.status === 'starting') {
              this.emit('auth-required', sessionId, {
                providerId: this.providerId,
                message: 'Qwen Coder CLI 需要认证才能使用。推荐使用 Qwen OAuth 方式（免费每日请求）。',
                authCommand,
                requiredEnvKey,
              })
            }
          }
        }

        // 通知所有等待中的 session
        for (const [sessionId, session] of this.sessions) {
          if (session.adapter.status === 'starting') {
            session.adapter.status = 'error'
            this.emit('status-change', sessionId, 'error')
            this.emitEvent(sessionId, {
              type: 'error',
              sessionId,
              timestamp: new Date().toISOString(),
              data: {
                text: isAuthError
                  ? 'Qwen Coder CLI 需要认证。请点击授权按钮或在终端运行 `qwen auth` 完成登录。'
                  : `Qwen initialization failed: ${err.message}`
              },
            })
          }
        }

        throw err
      }
    })()

    sp.authPromise = authPromise
    await authPromise
    return sp
  }

  // ---- 会话生命周期 ----

  async startSession(sessionId: string, config: AdapterSessionConfig): Promise<void> {
    const session: QwenSession = {
      adapter: {
        sessionId,
        status: 'starting',
        messages: [],
        createdAt: new Date().toISOString(),
        totalUsage: { inputTokens: 0, outputTokens: 0 },
      },
      config,
      currentText: '',
      activeToolCalls: new Map(),
    }

    this.sessions.set(sessionId, session)
    this.emit('status-change', sessionId, 'starting')

    try {
      const sp = await this.ensureProcess(config)

      // session/new
      const sessionNewParams = {
        cwd: config.workingDirectory,
        mcpServers: this.loadMcpServersForAcp(config),
        ...(config.systemPrompt ? { settings: { systemPrompt: config.systemPrompt } } : {}),
      }
      console.log(`[QwenAcpAdapter][${sessionId}] session/new params:`, JSON.stringify(sessionNewParams, null, 2).slice(0, 500))

      const sessionResult = await this.rpcOnProcess(sp, ACP_METHOD.session_new, sessionNewParams, sessionId)
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

      // 如果有初始 prompt，立即发送
      if (config.initialPrompt) {
        await this.sendMessage(sessionId, config.initialPrompt)
      }
    } catch (err: any) {
      console.error(`[QwenAcpAdapter] startSession failed for ${sessionId}:`, err)
      // 错误已在 ensureProcess 中处理过，这里只确保状态正确
      if (session.adapter.status !== 'error') {
        session.adapter.status = 'error'
        this.emit('status-change', sessionId, 'error')
        this.emitEvent(sessionId, {
          type: 'error',
          sessionId,
          timestamp: new Date().toISOString(),
          data: { text: `Qwen session failed: ${err.message}` },
        })
      }
    }
  }

  async resumeSession(
    sessionId: string,
    providerSessionId: string,
    config: AdapterSessionConfig
  ): Promise<void> {
    const session: QwenSession = {
      adapter: {
        sessionId,
        status: 'starting',
        messages: [],
        createdAt: new Date().toISOString(),
        totalUsage: { inputTokens: 0, outputTokens: 0 },
      },
      config,
      currentText: '',
      activeToolCalls: new Map(),
    }

    this.sessions.set(sessionId, session)
    this.emit('status-change', sessionId, 'starting')

    try {
      const sp = await this.ensureProcess(config)

      // session/new（恢复模式：传入之前的 qwenSessionId）
      const sessionNewParams = {
        cwd: config.workingDirectory,
        mcpServers: this.loadMcpServersForAcp(config),
        ...(providerSessionId ? { sessionId: providerSessionId } : {}),
        ...(config.systemPrompt ? { settings: { systemPrompt: config.systemPrompt } } : {}),
      }
      console.log(`[QwenAcpAdapter][${sessionId}] resume session/new params:`, JSON.stringify(sessionNewParams, null, 2).slice(0, 500))

      const sessionResult = await this.rpcOnProcess(sp, ACP_METHOD.session_new, sessionNewParams, sessionId)
      console.log(`[QwenAcpAdapter][${sessionId}] resume session/new response:`, JSON.stringify(sessionResult, null, 2).slice(0, 500))

      session.qwenSessionId = sessionResult?.sessionId || providerSessionId
      session.adapter.status = 'waiting_input'
      session.adapter.providerSessionId = session.qwenSessionId
      this.emit('status-change', sessionId, 'waiting_input')

      if (session.qwenSessionId) {
        this.emit('provider-session-id', sessionId, session.qwenSessionId)
        console.log(`[QwenAcpAdapter] Emitted provider-session-id for resume ${sessionId}: ${session.qwenSessionId}`)
      }

      this.emit('session-init-data', sessionId, {
        model: config.model || 'default',
        tools: [],
        mcpServers: [],
        skills: [],
        plugins: [],
        availableModels: this.getAvailableModels(),
      })

      // 如果有初始 prompt，立即发送
      if (config.initialPrompt) {
        await this.sendMessage(sessionId, config.initialPrompt)
      }
    } catch (err: any) {
      console.error(`[QwenAcpAdapter] resumeSession failed for ${sessionId}:`, err)
      if (session.adapter.status !== 'error') {
        session.adapter.status = 'error'
        this.emit('status-change', sessionId, 'error')
        this.emitEvent(sessionId, {
          type: 'error',
          sessionId,
          timestamp: new Date().toISOString(),
          data: { text: `Qwen resume failed: ${err.message}` },
        })
      }
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

    const sp = this.sharedProcess
    if (!sp?.alive) throw new Error(`Qwen shared process is not alive`)

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
      await this.rpcOnProcess(sp, ACP_METHOD.session_prompt, {
        sessionId: session.qwenSessionId,
        prompt: [{ type: 'text', text: message }],
      }, sessionId)

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

    const sp = this.sharedProcess
    if (!sp?.process.stdin?.writable) return

    const response = {
      jsonrpc: '2.0',
      id: permId,
      result: { allow: accept ? 'allow_once' : 'deny' },
    }
    sp.process.stdin.write(JSON.stringify(response) + '\n', 'utf8')
  }

  async abortCurrentTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session?.qwenSessionId) return
    const sp = this.sharedProcess
    if (!sp?.alive) return
    try {
      await this.rpcOnProcess(sp, ACP_METHOD.session_cancel, {
        sessionId: session.qwenSessionId,
      }, sessionId)
    } catch (_) { /* ignore */ }
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.adapter.status = 'completed'
    this.emit('status-change', sessionId, 'completed')
    this.sessions.delete(sessionId)

    // ★ 不再杀掉共享进程！保持进程存活以避免重复认证。
    // 只有在 cleanup() 或进程自身退出时才会关闭共享进程。
    // 这样下次创建/恢复 session 时可以直接复用已认证的进程。
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
    if (this.sharedProcess) {
      try { this.sharedProcess.process.kill() } catch (_) { /* ignore */ }
      this.sharedProcess.readline.close()
      for (const [, p] of this.sharedProcess.pendingRequests) {
        p.reject(new Error('Adapter cleanup'))
      }
      this.sharedProcess.pendingRequests.clear()
      this.sharedProcess = null
    }
    this.sessions.clear()
  }

  private getAvailableModels(): Array<{ id: string; name: string; description?: string }> {
    return [
      { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', description: '最强代码模型' },
      { id: 'qwen-coder-turbo', name: 'Qwen Coder Turbo', description: '快速响应' },
      { id: 'qwen2.5-coder-32b', name: 'Qwen2.5 Coder 32B', description: '开源模型' },
    ]
  }

  // ---- ACP NDJSON 行处理 ----

  private handleLine(line: string): void {
    const sp = this.sharedProcess
    if (!sp || !line) return

    // ★ 增强调试：打印所有收到的行（前 300 字符），便于排查认证卡住问题
    if (!line.startsWith('{')) {
      console.log(`[QwenAcpAdapter] stdout non-JSON: ${line.slice(0, 300)}`)
    }

    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      console.debug(`[QwenAcpAdapter] skip non-JSON line: ${line.slice(0, 120)}`)
      return
    }

    const msgId = msg.id
    const hasResult = msg.result !== undefined
    const hasError = msg.error !== undefined
    const hasMethod = msg.method !== undefined

    if (msgId !== undefined || hasMethod) {
      console.log(
        `[QwenAcpAdapter] RPC message received:`
        + ` id=${msgId ?? '(notification)'}`
        + ` method=${hasMethod ? msg.method : '(response)'}`
        + ` hasResult=${hasResult}`
        + ` hasError=${hasError}`
      )
      // ★ 详细调试：打印完整的 JSON 消息（截断到 500 字符），排查 authenticate 卡住问题
      if (hasResult || hasError) {
        console.log(`[QwenAcpAdapter] RPC response detail (id=${msgId}):`, JSON.stringify(msg).slice(0, 500))
      }
    }

    // JSON-RPC 响应
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = sp.pendingRequests.get(msg.id)
      if (pending) {
        sp.pendingRequests.delete(msg.id)
        // 同时清理 requestSessionMap
        sp.requestSessionMap.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // JSON-RPC 通知或 Server→Client 请求
    // 需要路由到正确的 session
    if (msg.method) {
      // 对于 server request（有 id），尝试通过 requestSessionMap 找到对应 session
      // 对于 notification，通过 params 中的 sessionId 路由
      if (msg.id !== undefined) {
        // 尝试从 notification 内容中找到对应的 session
        const targetSessionId = this.findSessionForNotification(msg.method, msg.params || {})
        if (targetSessionId) {
          this.handleServerRequest(targetSessionId, msg.id, msg.method, msg.params || {})
        }
      } else {
        const targetSessionId = this.findSessionForNotification(msg.method, msg.params || {})
        if (targetSessionId) {
          this.handleNotification(targetSessionId, msg.method, msg.params || {})
        }
      }
    }
  }

  /**
   * 根据通知内容找到对应的 session ID
   */
  private findSessionForNotification(method: string, params: any): string | undefined {
    // session/update 通知中包含 sessionId 字段（qwen 的内部 session ID）
    if (method === ACP_NOTIFICATION.session_update) {
      const qwenSid = params.update?.sessionId || params.sessionId
      if (qwenSid) {
        for (const [sid, session] of this.sessions) {
          if (session.qwenSessionId === qwenSid) return sid
        }
      }
    }

    // permission request 等通知：如果没有明确的 session 标识，
    // 检查哪个 session 有 pendingPermissionId
    if (method === ACP_NOTIFICATION.session_request_permission || method === ACP_NOTIFICATION.ask_user_questions) {
      // 从 params 中提取 qwenSessionId
      const qwenSid = params.sessionId
      if (qwenSid) {
        for (const [sid, session] of this.sessions) {
          if (session.qwenSessionId === qwenSid) return sid
        }
      }
    }

    // 兜底：如果有活跃 session，尝试找最近活跃的那个
    // 但这不太可靠，优先通过 qwenSessionId 匹配
    for (const [sid, session] of this.sessions) {
      if (session.adapter.status === 'running' || session.adapter.status === 'waiting_input') {
        return sid
      }
    }

    // 最后兜底：返回第一个 session
    for (const [sid] of this.sessions) {
      return sid
    }

    return undefined
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
        const sp = this.sharedProcess
        if (sp?.process.stdin?.writable) {
          const autoReply = { jsonrpc: '2.0', id: reqId, result: {} }
          sp.process.stdin.write(JSON.stringify(autoReply) + '\n', 'utf8')
        }
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

  // ---- JSON-RPC over stdio（共享进程版本）----

  /**
   * 在共享进程上发送 RPC 请求
   * @param sp 共享进程
   * @param method RPC 方法名
   * @param params 参数
   * @param sessionId 关联的 session ID（用于路由响应/通知）
   */
  private rpcOnProcess(
    sp: SharedProcess,
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): Promise<any> {
    if (!sp.alive) return Promise.reject(new Error('Qwen shared process is not alive'))

    const id = ++sp.requestId
    const req = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })

    console.log(`[QwenAcpAdapter] RPC request sent: id=${id} method=${method}${sessionId ? ` session=${sessionId}` : ''}`)

    return new Promise((resolve, reject) => {
      sp.pendingRequests.set(id, { resolve, reject })
      if (sessionId) {
        sp.requestSessionMap.set(id, sessionId)
      }

      if (!sp.process.stdin?.writable) {
        sp.pendingRequests.delete(id)
        sp.requestSessionMap.delete(id)
        return reject(new Error('Qwen process stdin not writable'))
      }
      sp.process.stdin.write(req + '\n', 'utf8')

      const isPrompt = method === ACP_METHOD.session_prompt
      const isSessionNew = method === ACP_METHOD.session_new
      const isAuth = method === ACP_METHOD.authenticate
      // authenticate 可能需要 OAuth 设备授权（用户需在浏览器操作），给 5 分钟
      const timeoutMs = isPrompt ? 10 * 60 * 1000 : isAuth ? 5 * 60 * 1000 : isSessionNew ? 120_000 : 30_000
      const timer = setTimeout(() => {
        if (sp.pendingRequests.has(id)) {
          sp.pendingRequests.delete(id)
          sp.requestSessionMap.delete(id)
          console.error(`[QwenAcpAdapter] RPC timeout: id=${id} method=${method}`)
          reject(new Error(`ACP RPC timeout (${timeoutMs / 1000}s): ${method}`))
        }
      }, timeoutMs)

      const original = sp.pendingRequests.get(id)!
      sp.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); original.resolve(v) },
        reject:  (e) => { clearTimeout(timer); original.reject(e) },
      })
    })
  }

  private emitEvent(sessionId: string, event: ProviderEvent): void {
    this.emit('event', event)
  }
}
