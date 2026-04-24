/**
 * Codex CLI App Server Adapter
 *
 * 閫氳繃 JSON-RPC over stdio 鍗忚涓?Codex CLI 鐨?app-server 妯″紡浜や簰銆?
 * 鍗忚娴佺▼: initialize 鈫?initialized 鈫?thread/start 鈫?turn/start 鈫?events 鈫?turn/end
 *
 * @author weibin
 */

import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { createInterface, type Interface as ReadlineInterface } from 'readline'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ConversationMessage } from '../../shared/types'
import {
  BaseProviderAdapter,
  type AdapterSessionConfig,
  type AdapterSession,
  type ProviderEvent,
} from './types'
import { extractToolDetail } from './toolMapping'
import { prependNodeVersionToEnvPath } from '../node/NodeVersionResolver'

function isExecutable(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile()) return false
    if (process.platform === 'win32') return true
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function preferredCodexBinDirs(): string[] {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  if (process.platform === 'win32') return [`windows-${arch}`]
  if (process.platform === 'darwin') return [`darwin-${arch}`]
  if (process.platform === 'linux') return [`linux-${arch}`, `linux-${process.arch}`]
  return []
}

function scanCodexBinaryInBinDir(binDir: string): string | null {
  const names = process.platform === 'win32' ? ['codex.exe', 'codex'] : ['codex', 'codex.exe']
  for (const subDir of preferredCodexBinDirs()) {
    for (const name of names) {
      const candidate = path.join(binDir, subDir, name)
      if (isExecutable(candidate)) return candidate
    }
  }

  // fallback: 鍦?bin 鐩綍鍐呴€掑綊鎼滅储 codex/codex.exe
  const queue = [binDir]
  while (queue.length > 0) {
    const current = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
        continue
      }
      if (names.includes(entry.name) && isExecutable(full)) {
        return full
      }
    }
  }
  return null
}

/**
 * 鍦?Cursor/Trae 鎵╁睍鐩綍涓悳绱?codex 鍙墽琛屾枃浠躲€?
 * 鎵句笉鍒版椂鍥為€€鍒伴厤缃?command锛堟敮鎸?PATH 瑙ｆ瀽锛夈€?
 */
function findCodexExecutable(configCommand?: string): string {
  if (configCommand && path.isAbsolute(configCommand) && isExecutable(configCommand)) {
    return configCommand
  }

  const fallback = configCommand?.trim() || 'codex'
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir()
  const searchBases = [
    path.join(home, '.trae', 'extensions'),
    path.join(home, '.cursor', 'extensions'),
  ]

  for (const base of searchBases) {
    try {
      if (!fs.existsSync(base)) continue
      const entries = fs.readdirSync(base, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!entry.name.startsWith('openai.chatgpt-')) continue
        const binDir = path.join(base, entry.name, 'bin')
        if (!fs.existsSync(binDir)) continue
        const resolved = scanCodexBinaryInBinDir(binDir)
        if (resolved) return resolved
      }
    } catch {
      // ignore and continue scanning other bases
    }
  }

  // Windows 涓?npm 鍏ㄥ眬瀹夎鐨?codex 鏄?.cmd 鍖呰鍣紝涓嶅湪 Cursor/Trae 鎵╁睍鐩綍涓?
  // 闇€瑕侀澶栨悳绱?npm 鍏ㄥ眬 bin 鐩綍锛?APPDATA%\npm锛?
  if (process.platform === 'win32') {
    const npmGlobalDirs: string[] = [
      path.join(home, 'AppData', 'Roaming', 'npm'),
    ]

    // nvm4w 璁剧疆鐨?NVM_SYMLINK 鐜鍙橀噺鎸囧悜褰撳墠婵€娲荤殑 Node.js 鐩綍
    // 璇ョ洰褰曞悓鏃朵篃鏄?npm 鍏ㄥ眬 bin 鐩綍锛坣pm prefix -g 杩斿洖姝よ矾寰勶級
    const nvmSymlink = process.env.NVM_SYMLINK
    if (nvmSymlink && !npmGlobalDirs.includes(nvmSymlink)) {
      npmGlobalDirs.push(nvmSymlink)
    }

    // 涔熷皾璇曢€氳繃 NPM_PREFIX 鐜鍙橀噺锛堢敤鎴疯嚜瀹氫箟鍦烘櫙锛?
    const npmPrefixEnv = process.env.NPM_PREFIX
    if (npmPrefixEnv && !npmGlobalDirs.includes(npmPrefixEnv)) {
      npmGlobalDirs.push(npmPrefixEnv)
    }

    // 鍔ㄦ€佹墽琛?npm prefix -g 鑾峰彇鐪熷疄鐨勫叏灞€瀹夎璺緞
    // 閫傜敤浜?nvm / volta / fnm 绛?Node 鐗堟湰绠＄悊宸ュ叿
    try {
      const { execFileSync } = require('child_process') as typeof import('child_process')
      const result = execFileSync('npm', ['prefix', '-g'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      }).trim()
      if (result && !npmGlobalDirs.includes(result)) {
        npmGlobalDirs.push(result)
      }
    } catch {
      // npm 涓嶅湪 PATH 鎴栨墽琛屽け璐ワ紝璺宠繃鍔ㄦ€佹煡鎵?
    }

    for (const dir of npmGlobalDirs) {
      for (const name of ['codex.cmd', 'codex.exe', 'codex']) {
        const candidate = path.join(dir, name)
        if (isExecutable(candidate)) return candidate
      }
    }
  }

  // 鏈€缁堝洖閫€锛氫娇鐢?where(Windows) / which(Unix) 鑾峰彇绯荤粺 PATH 涓殑瀹為檯璺緞
  // 瑙ｅ喅 codex 瀹夎鍦ㄩ潪鏍囧噯鐩綍锛堝 .covs/node/...锛変絾宸插姞鍏?PATH 鐨勫満鏅?
  try {
    const checker = process.platform === 'win32' ? 'where' : 'which'
    const resolved = execFileSync(checker, [fallback], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim()
    // where 鍙兘杩斿洖澶氳锛堝涓尮閰嶈矾寰勶級锛屽锛?
    //   C:\Users\xxx\.covs\node\node-v24.12.0-win-x64\codex.cmd
    //   C:\Users\xxx\.covs\node\node-v24.12.0-win-x64\codex
    // 鏃犳墿灞曞悕鐨勬枃浠讹紙npm shim 鑴氭湰锛夋棤娉曡 spawn 鐩存帴鎵ц锛圗NOENT锛夛紝
    // 蹇呴』浼樺厛閫夋嫨 .cmd/.exe 鍚庣紑鐨勮矾寰?
    const lines = resolved.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (process.platform === 'win32') {
      // 浼樺厛閫?.cmd 鈫?.exe 鈫?鍏朵粬
      const cmdLine = lines.find(l => /\.cmd$/i.test(l))
      const exeLine = lines.find(l => /\.exe$/i.test(l))
      const preferred = cmdLine || exeLine || lines[0]
      if (preferred && fs.existsSync(preferred)) {
        return preferred
      }
    } else {
      const firstLine = lines[0]
      if (firstLine && fs.existsSync(firstLine)) {
        return firstLine
      }
    }
  } catch {
    // where/which 鏈壘鍒帮紝浣跨敤鍘熷 fallback
  }

  return fallback
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface CodexSession {
  adapter: AdapterSession
  process: ChildProcess
  readline: ReadlineInterface
  config: AdapterSessionConfig
  threadId?: string
  model?: string
  baseInstructions?: string
  requestId: number
  pendingRequests: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>
  autoAccept: boolean
  /** 宸插彂鍑?tool_use 娑堟伅鐨勫伐鍏?ID 闆嗗悎锛岀敤浜?created/completed 鍘婚噸 */
  activeToolUseIds: Set<string>
  /** 寰呭鐞嗙殑 commandExecution 瀹℃壒 itemId锛堥潪 autoAccept 妯″紡涓嬬敤浜?sendConfirmation锛?*/
  pendingApprovalItemId?: string
  /** 鏈€杩戜竴娆℃敹鍒?app-server 浠绘剰 JSON 浜嬩欢/鍝嶅簲鐨勬椂闂?*/
  lastServerEventAt: number
  /** 褰撳墠 turn 宸叉帹閫佽繃鐨勫績璺虫彁绀烘鏁帮紙鐢ㄤ簬闄愰锛?*/
  turnHeartbeatHints: number
  /**
   * agentMessage delta 鏂囨湰缂撳瓨銆?
   * Codex extended reasoning 妯″紡涓嬶紝item/completed 鐨?item.text 鍙兘涓虹┖锛?
   * 鐪熸鐨勬枃鏈叏鍦ㄥ墠闈㈢殑 item/agentMessage/delta 浜嬩欢閲屻€?
   * 鐢ㄦ瀛楁鍦ㄤ富杩涚▼渚хН绱紝item/completed 鏃朵綔涓哄厹搴曞唴瀹广€?
   */
  agentMessageBuffer: string
}

const CODEX_MODEL_FALLBACKS = [
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
  { id: 'codex-mini-latest', name: 'Codex Mini Latest' },
]

export class CodexAppServerAdapter extends BaseProviderAdapter {
  readonly providerId = 'codex'
  readonly displayName = 'Codex CLI'

  private sessions: Map<string, CodexSession> = new Map()
  /** 蹇冭烦瀹氭椂鍣細闀挎椂闂存棤鍝嶅簲鏃跺悜瀵硅瘽鎺ㄩ潤榛樻彁绀?*/
  private heartbeatTimers: Map<string, ReturnType<typeof setInterval>> = new Map()
  /** 姣忔 turn 寮€濮嬫椂璁板綍鏃堕棿锛屽績璺崇敤浜庤绠楃瓑寰呮椂闀?*/
  private turnStartTimes: Map<string, number> = new Map()

  private async resolveSystemPrompt(
    systemPrompt: AdapterSessionConfig['systemPrompt'] | Promise<AdapterSessionConfig['systemPrompt']>
  ): Promise<string | undefined> {
    const resolved = await Promise.resolve(systemPrompt)
    if (!resolved) return undefined
    if (typeof resolved === 'string') return resolved
    if (typeof resolved === 'object' && typeof resolved.append === 'string') {
      return resolved.append
    }
    console.warn('[CodexAdapter] Ignoring non-string systemPrompt for baseInstructions')
    return undefined
  }

  private buildAvailableModels(currentModel?: string): Array<{ id: string; name: string }> {
    if (!currentModel || CODEX_MODEL_FALLBACKS.some(model => model.id === currentModel)) {
      return CODEX_MODEL_FALLBACKS
    }
    return [{ id: currentModel, name: currentModel }, ...CODEX_MODEL_FALLBACKS]
  }

  async startSession(sessionId: string, config: AdapterSessionConfig): Promise<void> {
    const startTime = Date.now()
    // 鍚姩 codex app-server 杩涚▼
    // Windows 涓?codex 閫氬父鎹嗙粦鍦?Cursor/Trae 鎵╁睍鐩綍涓紝涓嶅湪鍏ㄥ眬 PATH 閲?
    // 浣跨敤 findCodexExecutable() 鎼滅储缁濆璺緞锛?
    // 鑻ユ壘鍒扮殑鏄?.cmd 鍖呰鍣紙npm 鍏ㄥ眬瀹夎鍦烘櫙锛夛紝闇€瑕?shell:true 鎵嶈兘姝ｅ父鎵ц
    const codexCommand = findCodexExecutable(config.command)
    const env = prependNodeVersionToEnvPath(
      { ...process.env, ...config.envOverrides },
      config.nodeVersion
    )
    // Windows 涓嬮潪 .exe 鏂囦欢锛?cmd 鍖呰鍣ㄣ€佹棤鎵╁睍鍚嶇殑 npm shim 鑴氭湰绛夛級
    // 蹇呴』閫氳繃 shell 鎵ц锛屽惁鍒?Node.js spawn 浼氭姤 ENOENT
    const useShell = process.platform === 'win32' && !codexCommand.endsWith('.exe')

    console.log(`[CodexAdapter] Starting session ${sessionId}:`)
    console.log(`[CodexAdapter]   command: ${codexCommand}`)
    console.log(`[CodexAdapter]   shell: ${useShell}`)
    console.log(`[CodexAdapter]   cwd: ${config.workingDirectory}`)
    console.log(`[CodexAdapter]   model: ${config.model || '(default)'}`)
    console.log(`[CodexAdapter]   CODEX_HOME: ${env.CODEX_HOME || '(not set)'}`)
    console.log(`[CodexAdapter]   configCommand: ${config.command || '(not set)'}`)

    // 鈹€鈹€ 鍓嶇疆妫€娴嬶細codex 鍛戒护鏄惁鐪熷疄瀛樺湪 鈹€鈹€
    // findCodexExecutable 鍦ㄦ悳绱㈡墍鏈夊凡鐭ヨ矾寰勫悗鎵句笉鍒版椂浼?fallback 鍒拌８鍛戒护鍚嶏紙濡?"codex"锛夛紝
    // 姝ゆ椂 spawn 浼氭姤 ENOENT锛屽悗缁?rpc 鍐?stdin 鍙堜細鎶?EPIPE锛屾棩蹇楅毦浠ユ帓鏌ャ€?
    // 鎻愬墠妫€娴嬪苟缁欏嚭娓呮櫚鐨勫畨瑁呮寚寮曪紝閬垮厤绾ц仈閿欒銆?
    if (!path.isAbsolute(codexCommand)) {
      // 闈炵粷瀵硅矾寰?鈫?findCodexExecutable 娌℃湁鎵惧埌鏈湴浜岃繘鍒讹紝闇€瑕侀獙璇?PATH 涓槸鍚﹀瓨鍦?
      const checker = process.platform === 'win32' ? 'where' : 'which'
      let foundInPath = false
      try {
        execFileSync(checker, [codexCommand], { timeout: 5000, windowsHide: true, env })
        foundInPath = true
      } catch {
        // not found in PATH
      }
      if (!foundInPath) {
        const installHint = process.platform === 'win32'
          ? '璇烽€氳繃浠ヤ笅鏂瑰紡涔嬩竴瀹夎 Codex CLI:\n' +
            '  1. npm install -g @openai/codex\n' +
            '  2. 瀹夎 Cursor 鎴?Trae 缂栬緫鍣紙鍐呯疆 Codex锛塡n' +
            '  3. 鍦?Provider 绠＄悊涓皢 command 閰嶇疆涓?codex 鍙墽琛屾枃浠剁殑缁濆璺緞'
          : '璇烽€氳繃浠ヤ笅鏂瑰紡涔嬩竴瀹夎 Codex CLI:\n' +
            '  1. npm install -g @openai/codex\n' +
            '  2. 鍦?Provider 绠＄悊涓皢 command 閰嶇疆涓?codex 鍙墽琛屾枃浠剁殑缁濆璺緞'
        const errMessage = `Codex CLI 鏈畨瑁呮垨涓嶅湪 PATH 涓紙鏌ユ壘鍛戒护: ${codexCommand}锛夈€俓n${installHint}`
        console.error(`[CodexAdapter] ${errMessage}`)
        this.emitEvent(sessionId, {
          type: 'error',
          sessionId,
          timestamp: new Date().toISOString(),
          data: { text: errMessage },
        })
        throw new Error(errMessage)
      }
    } else if (!isExecutable(codexCommand)) {
      // 缁濆璺緞浣嗘枃浠朵笉瀛樺湪鎴栦笉鍙墽琛?
      const errMessage = `Codex CLI 路径无效: ${codexCommand}\n该文件不存在或无执行权限。请在 Provider 管理中检查 command 配置。`
      console.error(`[CodexAdapter] ${errMessage}`)
      this.emitEvent(sessionId, {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { text: errMessage },
      })
      throw new Error(errMessage)
    }

    const proc = spawn(codexCommand, ['app-server'], {
      cwd: config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      shell: useShell,
    })
    console.log(`[CodexAdapter] Process spawned for ${sessionId}, pid=${proc.pid}`)

    const rl = createInterface({ input: proc.stdout! })

    const session: CodexSession = {
      adapter: {
        sessionId,
        status: 'running',
        messages: [],
        createdAt: new Date().toISOString(),
        totalUsage: { inputTokens: 0, outputTokens: 0 },
      },
      process: proc,
      readline: rl,
      config,
      requestId: 0,
      pendingRequests: new Map(),
      autoAccept: config.autoAccept ?? false,
      activeToolUseIds: new Set(),
      lastServerEventAt: Date.now(),
      turnHeartbeatHints: 0,
      agentMessageBuffer: '',
    }

    this.sessions.set(sessionId, session)

    // 鐩戝惉 NDJSON 琛?
    rl.on('line', (line) => {
      this.handleLine(sessionId, line)
    })

    // 娑堣垂 stderr锛堥槻姝㈢閬撶紦鍐插尯闃诲锛涘皢鍏抽敭閿欒淇℃伅鎺ㄩ€佸埌瀵硅瘽瑙嗗浘鏂逛究鎺掓煡锛?
    let stderrBuffer = ''
    proc.stderr?.on('data', (data) => {
      const text: string = data.toString()
      if (!text.trim()) return
      console.debug(`[CodexAdapter] stderr for ${sessionId}: ${text.slice(0, 300)}`)
      stderrBuffer += text
      // 瓒呰繃 2KB 鎴柇锛屽彧淇濈暀鏈€鏂板唴瀹?
      if (stderrBuffer.length > 2048) stderrBuffer = stderrBuffer.slice(-2048)
    })

    // 杩涚▼閫€鍑烘椂锛岃嫢寮傚父閫€鍑猴紙code !== 0锛夛紝灏嗛敊璇俊鎭帹閫佸埌瀵硅瘽瑙嗗浘
    // 鏈?stderr 鍐呭鍒欏睍绀猴紝鍚﹀垯缁欏嚭閫氱敤鎻愮ず锛岀‘淇濈敤鎴蜂笉浼氱湅鍒扮┖鐧?
    proc.once('exit', (code) => {
      if (code !== 0) {
        const errSnippet = stderrBuffer.trim().slice(0, 800)
        const content = errSnippet
          ? `鈿狅笍 Codex 寮傚父閫€鍑?(exit ${code}):\n${errSnippet}`
          : `Codex 异常退出 (exit ${code})，没有详细错误信息。\n请检查 Codex CLI 是否正确安装，或尝试重新发送消息。`
        const errMsg = {
          id: uuidv4(),
          sessionId,
          role: 'system' as const,
          content,
          timestamp: new Date().toISOString(),
        }
        session.adapter.messages.push(errMsg)
        this.emit('conversation-message', sessionId, errMsg)
      }
    })

    // 杩涚▼閫€鍑?
    proc.on('exit', (code) => {
      this.stopHeartbeat(sessionId)
      session.adapter.status = 'completed'
      this.emit('status-change', sessionId, 'completed')
      this.emitEvent(sessionId, {
        type: 'session_complete',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { exitCode: code ?? 0 },
      })
    })

    proc.on('error', (err: NodeJS.ErrnoException) => {
      console.error(`[CodexAdapter] Process error for ${sessionId}:`, err)
      session.adapter.status = 'error'
      this.emit('status-change', sessionId, 'error')

      let text: string
      if (err.code === 'ENOENT') {
        text = `Codex CLI 未找到 (${codexCommand})。\n` +
          '请通过以下方式安装:\n' +
          '  1. npm install -g @openai/codex\n' +
          '  2. 安装 Cursor 或 Trae 编辑器（内置 Codex）\n' +
          '  3. 在 Provider 管理中将 command 配置为绝对路径'
      } else {
        text = `Codex 启动失败: ${err.message}\n请确认 codex 已安装，或在 Provider 管理中将 command 配置为绝对路径。`
      }

      this.emitEvent(sessionId, {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { text },
      })
    })

    // JSON-RPC 鍒濆鍖栨彙鎵?
    try {
      console.log(`[CodexAdapter] Sending initialize for ${sessionId} (+${Date.now() - startTime}ms)`)
      const initResult = await this.rpc(sessionId, 'initialize', {
        clientInfo: { name: 'spectrai', version: '2.0.0' },
      })
      console.log(`[CodexAdapter] initialize OK for ${sessionId} (+${Date.now() - startTime}ms):`, JSON.stringify(initResult).slice(0, 300))
      // 鈿狅笍 娉ㄦ剰锛欳odex v0.98+ 涓嶆敮鎸?initialized 閫氱煡锛堜細瀵艰嚧 serde untagged enum 閿欒锛?
      // 鍥犳杩欓噷涓嶅彂閫?initialized 閫氱煡

      // 鍒涘缓 Thread
      // 娉ㄦ剰锛歮odel 鐢?adapterConfig.model 浼犲叆锛堟潵鑷?provider.defaultModel 鎴栫敤鎴烽厤缃級
      // Codex CLI 鏀寔鐨勬ā鍨嬶細codex-mini-latest, o4-mini 绛夛紱涓嶄紶鍒欑敱 codex 浣跨敤鍏堕粯璁ゆā鍨?
      const baseInstructions = await this.resolveSystemPrompt(config.systemPrompt as any)
      session.baseInstructions = baseInstructions
      console.log(`[CodexAdapter] Sending thread/start for ${sessionId} (+${Date.now() - startTime}ms)`)
      const threadResult = await this.rpc(sessionId, 'thread/start', {
        ...(config.model ? { model: config.model } : {}),
        cwd: config.workingDirectory,
        // Supervisor 妯″紡涓嬫敞鍏ョ郴缁熸寚浠わ紙鏉ヨ嚜 SessionManagerV2.getSupervisorPrompt锛?
        ...(baseInstructions ? { baseInstructions } : {}),
        // 鏈夋晥鍊硷細'untrusted' | 'on-failure' | 'on-request' | 'never'
        // autoAccept=true  鈫?'never'锛欳odex 鐩存帴鎵ц鎵€鏈夋搷浣滐紝瀹屽叏涓嶅彂 requestApproval 浜嬩欢
        //   鈿狅笍 娉ㄦ剰锛?on-failure' 鏂囨。璇村け璐ユ椂鎵嶉棶锛屼絾瀹炴祴浠嶄細鍙?requestApproval锛?
        //            涓?approval/respond RPC 鍦ㄩ儴鍒嗙増鏈腑涓嶅瓨鍦紝浼氬鑷?turn 姘镐箙闃诲銆?
        //            鏀圭敤 'never' 褰诲簳閬垮厤瀹℃壒璇锋眰銆?
        // autoAccept=false 鈫?'on-request'锛氭瘡娆″啓鏂囦欢/鎵ц鍛戒护鍓嶅彂 requestApproval锛屽墠绔脊绐楃‘璁?
        approvalPolicy: config.autoAccept ? 'never' : 'on-request',
        // 鈿狅笍 娌欑绛栫暐锛氬繀椤绘樉寮忎紶鍏ワ紝鍚﹀垯 Codex 榛樿鐢?read-only 娌欑锛?
        // 瀵艰嚧 git pull/fetch銆乶pm install 绛夌綉缁滃懡浠ゅ強鍐欐搷浣滃叏閮ㄨ鎷︽埅銆?
        // 瀛楁鍚嶆槸 sandbox锛堥潪 sandboxPolicy锛夛紝鍊间负瀛楃涓叉灇涓撅細
        //   'workspace-write'   鈥?鍙鍐欏伐浣滅洰褰曪紝鏃犵綉缁滐紙榛樿锛?
        //   'danger-full-access' 鈥?瀹屽叏鏀惧紑锛堟枃浠剁郴缁?+ 缃戠粶锛夛紝閫傚悎鏈湴寮€鍙戝伐鍏?
        sandbox: 'danger-full-access',
      })
      console.log(`[CodexAdapter] thread/start OK for ${sessionId} (+${Date.now() - startTime}ms):`, JSON.stringify(threadResult).slice(0, 300))
      // 鍏煎涓嶅悓 app-server 杩斿洖缁撴瀯锛岀‘淇?threadId 鍙敤鍚庡啀鍏佽 turn/start
      const threadId = (threadResult as any)?.thread?.id || (threadResult as any)?.id
      if (!threadId) {
        throw new Error('Codex thread/start did not return thread id')
      }
      session.threadId = threadId
      session.model = (threadResult as any)?.model || config.model
      this.emit('provider-session-id', sessionId, threadId)
      this.emit('session-init-data', sessionId, {
        model: session.model || '',
        tools: [],
        skills: [],
        mcpServers: [],
        availableModels: this.buildAvailableModels(session.model),
      })
      console.log(`[CodexAdapter] Session ${sessionId} ready, threadId=${threadId}, total startup: ${Date.now() - startTime}ms`)

      // 鍙戦€侀杞秷鎭?
      if (config.initialPrompt) {
        console.log(`[CodexAdapter] Sending initial prompt for ${sessionId} (${config.initialPrompt.length} chars)`)
        await this.sendMessage(sessionId, config.initialPrompt)
      } else {
        session.adapter.status = 'waiting_input'
        this.emit('status-change', sessionId, 'waiting_input')
      }
    } catch (err: any) {
      console.error(`[CodexAdapter] Init failed for ${sessionId} (+${Date.now() - startTime}ms):`, err)
      session.adapter.status = 'error'
      this.emit('status-change', sessionId, 'error')

      // EPIPE 閫氬父鏄?ENOENT 鐨勮繛閿佸弽搴旓紙杩涚▼娌″惎鍔紝鍐?stdin 澶辫触锛?
      const isEpipe = err.code === 'EPIPE' || err.message?.includes('EPIPE')
      const text = isEpipe
        ? `Codex 进程未能启动（写入管道失败）。\n请确认 Codex CLI 已正确安装，或在 Provider 管理中配置 command 为绝对路径。`
        : `Initialization failed: ${err.message}`

      this.emitEvent(sessionId, {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { text },
      })
    }
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (!session.threadId) {
      throw new Error(`Session ${sessionId} is not ready: missing threadId`)
    }

    // 璁板綍鐢ㄦ埛娑堟伅
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
    this.emit('status-change', sessionId, 'running')
    session.lastServerEventAt = Date.now()
    session.turnHeartbeatHints = 0

    // 鍚姩蹇冭烦锛氭瘡 30 绉掓鏌ユ槸鍚︿粛鍦ㄧ瓑寰咃紝鑻ユ槸鍒欐帹涓€鏉￠潤榛樿繘搴︽彁绀?
    this.startHeartbeat(sessionId)

    // 鍙戦€?turn
    // 瀹為檯鏍煎紡锛歩nput 鏁扮粍锛宼ype='text'锛堥潪 userMessage 瀛楁锛?
    try {
      console.log(`[CodexAdapter] Sending turn/start for ${sessionId}, threadId=${session.threadId}, msgLen=${message.length}`)
      const turnResult = await this.rpc(sessionId, 'turn/start', {
        threadId: session.threadId,
        input: [{ type: 'text', text: message }],
      })
      console.log(`[CodexAdapter] turn/start OK for ${sessionId}:`, JSON.stringify(turnResult).slice(0, 200))
      // turn/start 绔嬪嵆杩斿洖 {turn: {status:'inProgress'}}锛屾祦寮忎簨浠跺紓姝ユ帹閫?
    } catch (err: any) {
      this.stopHeartbeat(sessionId)
      console.error(`[CodexAdapter] Turn failed for ${sessionId}:`, err)
      this.emitEvent(sessionId, {
        type: 'error',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { text: err.message },
      })
      // 澶辫触鏃跺繀椤婚€€鍑?running锛屽惁鍒欏墠绔細姘镐箙鏄剧ず鈥滃鐞嗕腑鈥?
      session.adapter.status = 'waiting_input'
      this.emit('status-change', sessionId, 'waiting_input')
    }
  }

  async sendConfirmation(sessionId: string, accept: boolean): Promise<void> {
    const session = this.sessions.get(sessionId)
    // 鍙栧嚭骞舵竻闄ゅ緟澶勭悊 itemId锛堜竴娆℃€ф秷璐癸級
    const itemId = session?.pendingApprovalItemId
    if (session) delete session.pendingApprovalItemId

    try {
      await this.rpc(sessionId, 'approval/respond', {
        ...(itemId ? { itemId } : {}),
        approved: accept,
      })
    } catch (err: any) {
      console.warn(`[CodexAdapter] Confirmation failed for ${sessionId}:`, err)
    }
  }

  async abortCurrentTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // 鈿狅笍 Codex app-server 鐨?JsonRpcMessage 鏋氫妇鍙湁 Request锛堝甫 id锛夊拰 Response 涓ょ鍙樹綋锛?
    // 涓嶆帴鍙椾笉甯?id 鐨?Notification锛坣otify 璋冪敤浼氬鑷?serde untagged enum 鍙嶅簭鍒楀寲澶辫触锛夈€?
    // 鐩墠鏃犲彲鐢ㄧ殑鍙栨秷 RPC锛屽彧鍋?UI 鐘舵€佸己鍒跺垏鎹紝璁╂寜閽秷澶便€佽緭鍏ユ鎭㈠鍙敤銆?
    // Codex 搴曞眰浼氱户缁窇瀹屽綋鍓嶈疆娆★紝turn/completed 浜嬩欢鍒拌揪鏃剁姸鎬佹洿鏂版槸骞傜瓑鐨勶紝涓嶅奖鍝嶆纭€с€?
    const ts = new Date().toISOString()
    session.adapter.status = 'waiting_input'
    this.emit('status-change', sessionId, 'waiting_input')
    this.emitEvent(sessionId, {
      type: 'turn_complete',
      sessionId,
      timestamp: ts,
      data: { usage: session.adapter.totalUsage },
    })
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    session.adapter.status = 'completed'
    this.emit('status-change', sessionId, 'completed')

    // 娓呯悊 pending requests
    for (const [, pending] of session.pendingRequests) {
      pending.reject(new Error('Session terminated'))
    }
    session.pendingRequests.clear()

    // 鍏抽棴杩涚▼
    this.stopHeartbeat(sessionId)
    try {
      session.readline.close()
      session.process.kill()
    } catch (_) { /* ignore */ }

    this.sessions.delete(sessionId)
  }

  async resumeSession(
    sessionId: string,
    providerSessionId: string,
    config: AdapterSessionConfig
  ): Promise<void> {
    // Codex 鏆備笉鏀寔浼氳瘽鎭㈠锛屽垱寤烘柊浼氳瘽
    await this.startSession(sessionId, config)
  }

  async switchModel(sessionId: string, model: string): Promise<{ model: string; providerSessionId?: string; effectiveNow: boolean }> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (session.adapter.status === 'running') {
      throw new Error('褰撳墠杞浠嶅湪鎵ц锛岃绛夊緟瀹屾垚鍚庡啀鍒囨崲妯″瀷')
    }

    const baseInstructions = session.baseInstructions ?? await this.resolveSystemPrompt(session.config.systemPrompt as any)
    session.baseInstructions = baseInstructions

    console.log(`[CodexAdapter] Switching model for ${sessionId}: ${session.model || '(default)'} -> ${model}`)
    const threadResult = await this.rpc(sessionId, 'thread/start', {
      model,
      cwd: session.config.workingDirectory,
      ...(baseInstructions ? { baseInstructions } : {}),
      approvalPolicy: session.autoAccept ? 'never' : 'on-request',
      sandbox: 'danger-full-access',
    })

    const threadId = (threadResult as any)?.thread?.id || (threadResult as any)?.id
    if (!threadId) {
      throw new Error('Codex thread/start did not return thread id')
    }

    session.threadId = threadId
    const effectiveModel = String((threadResult as any)?.model || model)
    session.model = effectiveModel
    session.adapter.status = 'waiting_input'
    session.agentMessageBuffer = ''
    session.activeToolUseIds.clear()
    this.stopHeartbeat(sessionId)

    this.emit('provider-session-id', sessionId, threadId)
    this.emit('session-init-data', sessionId, {
      model: session.model,
      availableModels: this.buildAvailableModels(session.model),
    })
    this.emit('status-change', sessionId, 'waiting_input')

    const msg = {
      id: uuidv4(),
      sessionId,
      role: 'system' as const,
      content: `模型已切换为 ${effectiveModel}，后续消息将使用新模型。`,
      timestamp: new Date().toISOString(),
    }
    session.adapter.messages.push(msg)
    this.emit('conversation-message', sessionId, msg)

    return { model: effectiveModel, providerSessionId: threadId, effectiveNow: true }
  }

  getConversation(sessionId: string): ConversationMessage[] {
    return this.sessions.get(sessionId)?.adapter.messages || []
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getProviderSessionId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.threadId
  }

  cleanup(): void {
    for (const [sessionId] of this.sessions) {
      try {
        this.terminateSession(sessionId)
      } catch (_) { /* ignore */ }
    }
    this.sessions.clear()
  }

  // ---- 鍏叡鍘婚噸鏂规硶 ----

  /**
   * 缁熶竴 turn 缁撴潫澶勭悊锛坱urn/completed銆乧odex/event/task_complete銆佽８浜嬩欢 event_msg.task_complete 鍏辩敤锛夈€?
   *
   * 鑱岃矗锛歠lush agentMessageBuffer 鈫?娓呯悊 activeToolUseIds 鈫?鍋滄蹇冭烦 鈫?鍙戝皠 turn_complete 鈫?鍒囨崲鐘舵€?
   */
  private finalizeTurn(sessionId: string, session: CodexSession, ts: string): void {
    // 鑻?buffer 杩樻湁鏈彁浜ょ殑鏂囨湰锛岀珛鍗充綔涓?assistant 娑堟伅鎻愪氦
    if (session.agentMessageBuffer) {
      const fallbackMsg = {
        id: uuidv4(),
        sessionId,
        role: 'assistant' as const,
        content: session.agentMessageBuffer,
        timestamp: ts,
      }
      session.adapter.messages.push(fallbackMsg)
      this.emit('conversation-message', sessionId, fallbackMsg)
    }
    session.agentMessageBuffer = ''
    session.activeToolUseIds.clear()
    session.turnHeartbeatHints = 0
    this.stopHeartbeat(sessionId)
    this.emitEvent(sessionId, {
      type: 'turn_complete',
      sessionId,
      timestamp: ts,
      data: { usage: session.adapter.totalUsage },
    })
    session.adapter.status = 'waiting_input'
    this.emit('status-change', sessionId, 'waiting_input')
  }

  /**
   * 缁熶竴瀹℃壒璇锋眰澶勭悊锛堥€氱敤 requestApproval銆乮tem/commandExecution/requestApproval銆?
   * 鏃х増 approval/request 鍏辩敤锛夈€?
   *
   * autoAccept 鈫?RPC 鑷姩鎵瑰噯锛堝け璐ュ彲蹇界暐锛?
   * 闈?autoAccept 鈫?瀛樺偍 itemId 骞跺彂灏?permission_request 浜嬩欢绛夊緟鐢ㄦ埛纭
   */
  private handleApprovalRequest(
    sessionId: string,
    session: CodexSession,
    ts: string,
    opts: { itemId: string; prompt: string; toolName: string; toolInput: Record<string, unknown> },
  ): void {
    if (session.autoAccept) {
      this.rpc(sessionId, 'approval/respond', {
        ...(opts.itemId ? { itemId: opts.itemId } : {}),
        approved: true,
      }).catch(err => {
        console.debug(`[CodexAdapter][${sessionId}] approval/respond not supported (ignored): ${err.message}`)
      })
    } else {
      if (opts.itemId) session.pendingApprovalItemId = opts.itemId
      this.emitEvent(sessionId, {
        type: 'permission_request',
        sessionId,
        timestamp: ts,
        data: {
          permissionPrompt: opts.prompt,
          toolName: opts.toolName,
          toolInput: opts.toolInput,
        },
      })
    }
  }

  // ---- 蹇冭烦鏈哄埗 ----

  /**
   * 鍚姩杩愯蹇冭烦锛氭瘡 30 绉掓鏌ユ槸鍚︿粛鍦ㄧ瓑寰呫€?
   * 鑻?AI 瓒呰繃 60 绉掓棤浠讳綍宸ュ叿璋冪敤鎴栨枃鏈緭鍑猴紝鎺ㄤ竴鏉￠潤榛樿繘搴︽秷鎭紝
   * 璁╃敤鎴风煡閬?AI 杩樺湪杩愯鑰岄潪鍗℃銆?
   */
  private startHeartbeat(sessionId: string): void {
    this.stopHeartbeat(sessionId) // 鍏堟竻鐞嗘棫瀹氭椂鍣?
    const startAt = Date.now()
    this.turnStartTimes.set(sessionId, startAt)

    const timer = setInterval(() => {
      const session = this.sessions.get(sessionId)
      if (!session || session.adapter.status !== 'running') {
        this.stopHeartbeat(sessionId)
        return
      }

      const now = Date.now()
      const elapsed = Math.round((now - (this.turnStartTimes.get(sessionId) || now)) / 1000)
      const silentSeconds = Math.round((now - (session.lastServerEventAt || startAt)) / 1000)

      // watchdog: 闀挎椂闂存湭鏀跺埌鏈嶅姟绔簨浠舵椂锛岃嚜鍔ㄦ妸鐘舵€佹敹鏁涘埌 waiting_input锛岄伩鍏?UI 鍋囨€у崱姝?
      // 鑻ユ湁 MCP 宸ュ叿璋冪敤姝ｅ湪杩涜锛坅ctiveToolUseIds 闈炵┖锛夛紝缂╃煭瓒呮椂鍒?90s 骞剁粰鍑烘槑纭彁绀?
      const hasPendingTool = session.activeToolUseIds.size > 0
      const watchdogSeconds = hasPendingTool ? 90 : 240
      if (silentSeconds >= watchdogSeconds) {
        this.stopHeartbeat(sessionId)
        session.adapter.status = 'waiting_input'
        this.emit('status-change', sessionId, 'waiting_input')
        const pendingTools = Array.from(session.activeToolUseIds).join(', ')
        const hint = hasPendingTool
          ? `MCP/工具调用超过 ${silentSeconds}s 未响应（工具 ID: ${pendingTools || '未知'}）。\n请检查 MCP 服务配置和程序路径是否正确。`
          : `Codex ${silentSeconds}s 无事件响应，当前轮次可能已中断。`
        this.emitEvent(sessionId, {
          type: 'error',
          sessionId,
          timestamp: new Date().toISOString(),
          data: { text: hint },
        })
        session.activeToolUseIds.clear()
        return
      }

      // 浠呭湪鎸佺画闈欓粯 >= 60s 鍚庢彁绀猴紝骞堕檺棰戝埌绾︽瘡 60s 涓€鏉★紝鍑忓皯娑堟伅姹℃煋
      if (silentSeconds < 60) return
      session.turnHeartbeatHints += 1
      if (session.turnHeartbeatHints % 2 === 0) return

      const minutes = Math.floor(elapsed / 60)
      const seconds = elapsed % 60
      const timeStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`

      const heartbeatMsg = {
        id: uuidv4(),
        sessionId,
        role: 'system' as const,
        content: `鈴?Codex 浠嶅湪澶勭悊涓?.. (宸茬瓑寰?${timeStr}, 闈欓粯 ${silentSeconds}s)`,
        timestamp: new Date().toISOString(),
      }
      session.adapter.messages.push(heartbeatMsg)
      this.emit('conversation-message', sessionId, heartbeatMsg)
    }, 30_000)

    this.heartbeatTimers.set(sessionId, timer)
  }

  /** 鍋滄骞舵竻鐞嗗績璺冲畾鏃跺櫒 */
  private stopHeartbeat(sessionId: string): void {
    const timer = this.heartbeatTimers.get(sessionId)
    if (timer) {
      clearInterval(timer)
      this.heartbeatTimers.delete(sessionId)
    }
    this.turnStartTimes.delete(sessionId)
  }

  // ---- JSON-RPC 閫氫俊 ----

  /**
   * 鍙戦€?JSON-RPC 璇锋眰骞剁瓑寰呭搷搴?
   */
  private rpc(sessionId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const id = ++session.requestId
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      session.pendingRequests.set(id, { resolve, reject })

      const line = JSON.stringify(request) + '\n'
      session.process.stdin!.write(line, (err) => {
        if (err) {
          session.pendingRequests.delete(id)
          reject(err)
        }
      })

      // 瓒呮椂
      setTimeout(() => {
        if (session.pendingRequests.has(id)) {
          session.pendingRequests.delete(id)
          reject(new Error(`RPC timeout: ${method}`))
        }
      }, 30000)
    })
  }

  /**
   * 鍙戦€?JSON-RPC 閫氱煡锛堟棤 id锛屼笉绛夊緟鍝嶅簲锛?
   */
  private notify(sessionId: string, method: string, params?: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
    }

    session.process.stdin!.write(JSON.stringify(request) + '\n')
  }

  /**
   * 澶勭悊鏉ヨ嚜 Codex app-server 鐨?NDJSON 琛?
   */
  private handleLine(sessionId: string, line: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    let data: any
    try {
      data = JSON.parse(line)
    } catch {
      // 闈?JSON 琛岋紙杩涘害淇℃伅銆佹帶鍒跺瓧绗︾瓑锛夛紝璁板綍鍓?120 瀛楃渚夸簬鎺掓煡
      console.debug(`[CodexAdapter][${sessionId}] skip non-JSON line: ${line.slice(0, 120)}`)
      return
    }

    // 浠绘剰鏈夋晥 JSON 閮借涓衡€滄湇鍔＄浠嶆湁鍝嶅簲鈥濓紝鐢ㄤ簬蹇冭烦 watchdog 璁＄畻
    session.lastServerEventAt = Date.now()

    // JSON-RPC 鍝嶅簲锛堟湁 id锛?
    if (data.id !== undefined && (data.result !== undefined || data.error !== undefined)) {
      const pending = session.pendingRequests.get(data.id)
      if (pending) {
        session.pendingRequests.delete(data.id)
        if (data.error) {
          pending.reject(new Error(data.error.message || JSON.stringify(data.error)))
        } else {
          pending.resolve(data.result)
        }
      }
      return
    }

    // JSON-RPC 閫氱煡锛堟棤 id锛夆€?浜嬩欢娴?
    if (data.method) {
      this.handleNotification(sessionId, data.method, data.params || {})
      return
    }

    // 瑁镐簨浠讹紙闈炴爣鍑?JSON-RPC锛屼竴浜?app-server 鐗堟湰鍙兘浣跨敤锛?
    if (data.type) {
      this.handleCodexItem(sessionId, data)
    }
  }

  // 鈹€鈹€ Notification Handler Map 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 灏?handleNotification 鐨?switch 鍒嗘敮鎷嗕负鐙珛瀛愭柟娉曪紝閫氳繃 Record 鍒嗘淳銆?
  // key = JSON-RPC method锛寁alue = handler(sid, session, ts, params)

  private readonly notificationHandlers: Record<
    string,
    (sid: string, s: CodexSession, ts: string, p: any) => void
  > = {
    'item/agentMessage/delta': (sid, s, ts, p) => this.onAgentMessageDelta(sid, s, ts, p),
    'item/reasoning/summaryTextDelta': (sid, _s, ts, p) => this.onReasoningDelta(sid, ts, p),
    'item/reasoning/summaryPartAdded': () => {},
    'item/reasoning/summaryPartCompleted': () => {},
    'item/reasoning/created': () => {},
    'item/reasoning/completed': () => {},
    'item/started': (sid, s, ts, p) => this.onItemStarted(sid, s, ts, p),
    'item/completed': (sid, s, ts, p) => this.onItemCompleted(sid, s, ts, p),
    'item/commandExecution/requestApproval': (sid, s, ts, p) => {
      const command: string = p.command || ''
      this.handleApprovalRequest(sid, s, ts, {
        itemId: String(p.itemId || ''), prompt: `鎵ц鍛戒护闇€瑕佹巿鏉?\n${command.slice(0, 300)}`,
        toolName: 'commandExecution', toolInput: { command },
      })
    },
    'turn/completed': (sid, s, ts) => this.finalizeTurn(sid, s, ts),
    'thread/tokenUsage/updated': (_sid, s, _ts, p) => {
      const total = p.tokenUsage?.total
      if (total) {
        s.adapter.totalUsage.inputTokens  = total.inputTokens  || 0
        s.adapter.totalUsage.outputTokens = total.outputTokens || 0
      }
    },
    'approval/request': (sid, s, ts, p) => {
      this.handleApprovalRequest(sid, s, ts, {
        itemId: String(p.itemId || ''), prompt: p.description || 'Codex requires approval',
        toolName: p.tool || 'unknown', toolInput: p.input || {},
      })
    },
    'codex/event/error': (sid, s, ts, p) => this.onCodexError(sid, s, ts, p),
    'codex/event/stream_error': (sid, s, ts, p) => this.onCodexStreamError(sid, s, ts, p),
    'codex/event/task_complete': (sid, s, ts, p) => {
      const msg = p.msg || p
      console.log(`[CodexAdapter][${sid}] codex/event/task_complete, turnId=${msg.turn_id || ''}`)
      this.finalizeTurn(sid, s, ts)
    },
    'codex/event/task_started': () => {},
    'codex/event/mcp_startup_update': (sid, _s, _ts, p) => {
      console.log(`[CodexAdapter][${sid}] MCP startup: ${p.server || p.serverId || ''} 鈫?${p.status || ''}`)
    },
    'codex/event/mcp_startup_complete': (sid, _s, _ts, p) => {
      const ready: string[] = p.ready || []; const failed: string[] = p.failed || []
      console.log(`[CodexAdapter][${sid}] MCP startup complete: ready=[${ready.join(',')}], failed=[${failed.join(',')}]`)
      if (failed.length > 0) console.warn(`[CodexAdapter][${sid}] MCP servers failed to start: ${failed.join(', ')}`)
    },
    'codex/event/item_started': (sid, _s, _ts, p) => {
      const msg = p.msg || p; const item = msg.item || {}
      if (item.id && item.type) this.handleNotification(sid, 'item/started', { item })
    },
    'codex/event/item_completed': (sid, _s, _ts, p) => {
      const msg = p.msg || p; const item = msg.item || {}
      if (item.id && item.type) this.handleNotification(sid, 'item/completed', { item })
    },
    'codex/event/user_message': () => {},
    'codex/event/skills_update_available': () => {},
  }

  /**
   * 澶勭悊 Codex 浜嬩欢閫氱煡锛堝熀浜庡疄娴?app-server v0.104.0 鍗忚锛?
   *
   * 浜嬩欢鍒嗕袱濂楋細item/* 鏄簿绠€楂樺眰浜嬩欢锛沜odex/event/* 鏄缁嗕綆灞備簨浠躲€?
   * 浼樺厛澶勭悊 item/* 楂樺眰浜嬩欢锛涘 codex/event/* 鍋氬疄鏃惰繘搴﹀厹搴曘€?
   * 鍒嗘淳閫昏緫閫氳繃 notificationHandlers map 瀹炵幇锛屽悇浜嬩欢澶勭悊鎷嗕负瀛愭柟娉曘€?
   */
  private handleNotification(sessionId: string, method: string, params: any): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const ts = new Date().toISOString()

    // 鍏煎 Codex 涓嶅悓鐗堟湰鐨勫鎵逛簨浠跺懡鍚嶏紙渚嬪 turn/requestApproval锛?
    if (method.endsWith('/requestApproval') && method !== 'item/commandExecution/requestApproval') {
      const command = String(params.command || params?.input?.command || params?.toolInput?.command || '')
      const approvalItemId = String(params.itemId || params.id || params.approvalId || '')
      this.handleApprovalRequest(sessionId, session, ts, {
        itemId: approvalItemId, prompt: `鎵ц鍛戒护闇€瑕佹巿鏉僜n${command.slice(0, 300)}`,
        toolName: 'commandExecution', toolInput: { command },
      })
      return
    }

    const handler = this.notificationHandlers[method]
    if (handler) { handler(sessionId, session, ts, params); return }

    // 璁板綍鏈煡浜嬩欢渚涜皟璇曪紙杩囨护鍣煶锛?
    if (method.startsWith('item/') || method.startsWith('codex/') || method.startsWith('thread/') || method.startsWith('turn/')) {
      console.debug(`[CodexAdapter][${sessionId}] Unhandled notification: ${method}`, JSON.stringify(params).slice(0, 300))
    }
  }

  // 鈹€鈹€ 瀛愭柟娉曪細娴佸閲?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  private onAgentMessageDelta(sessionId: string, session: CodexSession, ts: string, params: any): void {
    const text: string = params.delta || ''
    if (!text) return
    session.agentMessageBuffer += text
    this.emitEvent(sessionId, { type: 'text_delta', sessionId, timestamp: ts, data: { text } })
  }

  private onReasoningDelta(sessionId: string, ts: string, params: any): void {
    const text: string = params.delta || ''
    if (!text) return
    this.emitEvent(sessionId, { type: 'thinking', sessionId, timestamp: ts, data: { text } })
  }

  // 鈹€鈹€ 瀛愭柟娉曪細item 寮€濮?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  private onItemStarted(sessionId: string, session: CodexSession, ts: string, params: any): void {
    const item = params.item || {}
    if (!item.id) return
    const toolUseId: string = item.id

    if (item.type === 'commandExecution' && item.command) {
      const command: string = String(item.command).slice(0, 160)
      session.activeToolUseIds.add(toolUseId)
      const toolMsg = {
        id: uuidv4(), sessionId, role: 'tool_use' as const,
        content: `鎵ц: ${command.slice(0, 120)}`, timestamp: ts,
        toolName: 'shell', toolInput: { command } as Record<string, unknown>, toolUseId,
      }
      session.adapter.messages.push(toolMsg)
      this.emit('conversation-message', sessionId, toolMsg)
    } else if (item.type === 'mcpToolCall' && item.tool) {
      const toolName: string = item.tool || 'mcp'
      const serverLabel: string = item.server ? `[${item.server}] ` : ''
      const toolInput: Record<string, unknown> = item.arguments || {}
      session.activeToolUseIds.add(toolUseId)
      const toolMsg = {
        id: uuidv4(), sessionId, role: 'tool_use' as const,
        content: `${serverLabel}${toolName}${Object.keys(toolInput).length ? ': ' + JSON.stringify(toolInput).slice(0, 80) : ''}`,
        timestamp: ts, toolName, toolInput, toolUseId,
      }
      session.adapter.messages.push(toolMsg)
      this.emit('conversation-message', sessionId, toolMsg)
    }
  }

  // 鈹€鈹€ 瀛愭柟娉曪細item 瀹屾垚锛堟寜 item.type 浜屾鍒嗘淳锛夆攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  private onItemCompleted(sessionId: string, session: CodexSession, ts: string, params: any): void {
    const item = params.item || {}
    if (item.type === 'agentMessage') { this.onAgentMessageCompleted(sessionId, session, ts, item) }
    else if (item.type === 'commandExecution') { this.onCommandExecutionCompleted(sessionId, session, ts, item) }
    else if (item.type === 'mcpToolCall') { this.onMcpToolCallCompleted(sessionId, session, ts, item) }
  }

  /** agentMessage 瀹屾垚 鈫?鍥哄寲 AI 鍥炲 */
  private onAgentMessageCompleted(sessionId: string, session: CodexSession, ts: string, item: any): void {
    let finalText: string = item.text || ''
    if (!finalText && Array.isArray(item.content)) {
      finalText = item.content
        .filter((c: any) => c.type === 'output_text' || c.type === 'text')
        .map((c: any) => c.text || '').join('')
    }
    if (!finalText) finalText = session.agentMessageBuffer
    session.agentMessageBuffer = ''
    if (!finalText) {
      console.warn(`[CodexAdapter][${sessionId}] agentMessage completed with empty text, skipping emit`)
      return
    }
    const assistantMsg = { id: uuidv4(), sessionId, role: 'assistant' as const, content: finalText, timestamp: ts }
    session.adapter.messages.push(assistantMsg)
    this.emit('conversation-message', sessionId, assistantMsg)
  }

  /** commandExecution 瀹屾垚 鈫?Shell 鍛戒护缁撴灉 */
  private onCommandExecutionCompleted(sessionId: string, session: CodexSession, ts: string, item: any): void {
    const toolUseId: string = item.id || uuidv4()
    const alreadyShown = session.activeToolUseIds.has(toolUseId)
    session.activeToolUseIds.delete(toolUseId)

    if (!alreadyShown) {
      const command: string = String(item.command || 'shell command').slice(0, 160)
      const toolMsg = {
        id: uuidv4(), sessionId, role: 'tool_use' as const,
        content: `鎵ц: ${command.slice(0, 120)}`, timestamp: ts,
        toolName: 'shell', toolInput: { command } as Record<string, unknown>, toolUseId,
      }
      session.adapter.messages.push(toolMsg)
      this.emit('conversation-message', sessionId, toolMsg)
    }

    const rawOut = item.output
    const resultText = typeof rawOut === 'string' ? rawOut : (rawOut?.stdout || rawOut?.output || '')
    if (resultText) {
      const exitCode: number = item.exitCode ?? rawOut?.exitCode ?? 0
      const resultMsg = {
        id: uuidv4(), sessionId, role: 'tool_result' as const,
        content: resultText.slice(0, 500), timestamp: ts,
        toolResult: resultText, isError: exitCode !== 0, toolUseId,
      }
      session.adapter.messages.push(resultMsg)
      this.emit('conversation-message', sessionId, resultMsg)
    }
  }

  /** mcpToolCall 瀹屾垚 鈫?MCP 宸ュ叿缁撴灉 */
  private onMcpToolCallCompleted(sessionId: string, session: CodexSession, ts: string, item: any): void {
    const toolUseId: string = item.id || uuidv4()
    const alreadyShown = session.activeToolUseIds.has(toolUseId)
    session.activeToolUseIds.delete(toolUseId)

    if (!alreadyShown) {
      const toolName: string = item.tool || 'mcp'
      const serverLabel: string = item.server ? `[${item.server}] ` : ''
      const toolInput: Record<string, unknown> = item.arguments || {}
      const toolMsg = {
        id: uuidv4(), sessionId, role: 'tool_use' as const,
        content: `${serverLabel}${toolName}`, timestamp: ts, toolName, toolInput, toolUseId,
      }
      session.adapter.messages.push(toolMsg)
      this.emit('conversation-message', sessionId, toolMsg)
    }

    const mcpResult = item.result
    if (mcpResult !== null && mcpResult !== undefined) {
      const resultText = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult)
      const resultMsg = {
        id: uuidv4(), sessionId, role: 'tool_result' as const,
        content: resultText.slice(0, 500), timestamp: ts,
        toolResult: resultText, isError: !!item.error, toolUseId,
      }
      session.adapter.messages.push(resultMsg)
      this.emit('conversation-message', sessionId, resultMsg)
    } else if (item.error) {
      const errorStr = typeof item.error === 'string' ? item.error : (item.error?.message || JSON.stringify(item.error))
      const errMsg = {
        id: uuidv4(), sessionId, role: 'tool_result' as const,
        content: errorStr.slice(0, 500), timestamp: ts,
        toolResult: errorStr, isError: true, toolUseId,
      }
      session.adapter.messages.push(errMsg)
      this.emit('conversation-message', sessionId, errMsg)
    }
  }

  // 鈹€鈹€ 瀛愭柟娉曪細codex/event 閿欒澶勭悊 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  private onCodexError(sessionId: string, session: CodexSession, ts: string, params: any): void {
    const msg = params.msg || params
    const errorMessage: string = msg.message || msg.error || JSON.stringify(msg)
    console.error(`[CodexAdapter][${sessionId}] codex/event/error: ${errorMessage.slice(0, 500)}`)
    const errMsg = {
      id: uuidv4(), sessionId, role: 'system' as const,
      content: `Codex 閿欒: ${errorMessage.slice(0, 500)}`, timestamp: ts,
    }
    session.adapter.messages.push(errMsg)
    this.emit('conversation-message', sessionId, errMsg)
  }

  private onCodexStreamError(sessionId: string, session: CodexSession, ts: string, params: any): void {
    const msg = params.msg || params
    const reconnectMsg: string = msg.message || ''
    const details: string = msg.additional_details || ''
    console.warn(`[CodexAdapter][${sessionId}] stream_error: ${reconnectMsg} ${details.slice(0, 200)}`)
    if (reconnectMsg.includes('1/')) {
      const errMsg = {
        id: uuidv4(), sessionId, role: 'system' as const,
        content: `鈿狅笍 ${reconnectMsg}\n${details.slice(0, 300)}`, timestamp: ts,
      }
      session.adapter.messages.push(errMsg)
      this.emit('conversation-message', sessionId, errMsg)
    }
  }

  /**
   * 澶勭悊瑁镐簨浠讹紙闈炴爣鍑?JSON-RPC锛宒ata.type 褰㈠紡锛?
   *
   * Trae 鎵╁睍鍐呯疆鐨?codex锛坴0.104.x锛変娇鐢ㄦ鏍煎紡鎺ㄩ€佷簨浠讹紝姣忚涓€涓?JSON 瀵硅薄锛?
   *   { type: "event_msg",      payload: { type: "task_started"|"task_complete"|"user_message"|... } }
   *   { type: "response_item",  payload: { type: "message", role: "assistant"|"user"|"developer", content: [...] } }
   *   { type: "turn_context",   payload: { ... } }  鈫?鍏冧俊鎭紝蹇界暐
   *
   * npm 瀹夎鐨?codex锛坴0.98+锛変娇鐢ㄦ爣鍑?JSON-RPC 閫氱煡锛岀敱 handleNotification 澶勭悊銆?
   */
  private handleCodexItem(sessionId: string, data: any): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const ts = new Date().toISOString()

    const topType: string = data.type || ''

    // 鈹€鈹€ response_item锛氬寘鍚璇濇秷鎭紙assistant 鍥炲銆佺敤鎴锋秷鎭瓑锛夆攢鈹€鈹€鈹€鈹€鈹€
    if (topType === 'response_item') {
      const payload = data.payload || {}
      // 鍙鐞?assistant 瑙掕壊鐨勬秷鎭?
      if (payload.type === 'message' && payload.role === 'assistant') {
        // content 鏄暟缁勶紝姣忎釜鍏冪礌鍙兘鏄?{ type: 'output_text', text: '...' }
        const content: any[] = Array.isArray(payload.content) ? payload.content : []
        const text = content
          .filter((c: any) => c.type === 'output_text' || c.type === 'text')
          .map((c: any) => c.text || '')
          .join('')
        if (text) {
          // 鍚屾椂鍐欏叆 buffer 渚?task_complete 鍏滃簳
          session.agentMessageBuffer += text
          // 瀹炴椂 delta 鎺ㄩ€侊紝璁╁墠绔€愬瓧鏄剧ず
          this.emitEvent(sessionId, {
            type: 'text_delta',
            sessionId,
            timestamp: ts,
            data: { text },
          })
        }
      }
      return
    }

    // 鈹€鈹€ event_msg锛歵ask 鐢熷懡鍛ㄦ湡浜嬩欢 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    if (topType === 'event_msg') {
      const payload = data.payload || {}
      const eventType: string = payload.type || ''

      if (eventType === 'task_complete') {
        this.finalizeTurn(sessionId, session, ts)
        return
      }

      if (eventType === 'task_started') {
        // turn 寮€濮嬶紝鏃犻渶鐗规畩澶勭悊
        return
      }

      console.debug(`[CodexAdapter][${sessionId}] event_msg unhandled: ${eventType}`)
      return
    }

    // 鈹€鈹€ turn_context锛氬厓淇℃伅锛屽拷鐣?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    if (topType === 'turn_context' || topType === 'session_meta') {
      return
    }

    // 鈹€鈹€ 鍏滃簳锛氬皾璇曚綔涓?JSON-RPC method 澶勭悊锛堟棫璺緞鍏煎锛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    const method = topType
    const params = data.params || data.data || {}
    this.handleNotification(sessionId, method, params)
  }

  private emitEvent(sessionId: string, event: ProviderEvent): void {
    this.emit('event', event)
  }
}
