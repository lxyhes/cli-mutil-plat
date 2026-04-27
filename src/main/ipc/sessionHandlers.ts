/**
 * Session IPC 澶勭悊鍣?- Session 鐢熷懡鍛ㄦ湡鍙婂璇濈鐞?
 * 鈽?鏋舵瀯璇存槑锛氫粎鏀寔 SDK V2锛圫essionManagerV2 + Adapter 灞傦級
 *   V1 PTY 璺緞锛圫essionManager + node-pty锛夊凡寮冪敤
 */
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import { BUILTIN_CLAUDE_PROVIDER } from '../../shared/types'
import type { AIProvider, SessionConfig } from '../../shared/types'
import { extractImageTags, stripImageTags } from '../../shared/utils/messageContent'
import { MCPConfigGenerator } from '../agent/MCPConfigGenerator'
import {
  injectAwarenessPrompt,
  injectSupervisorPrompt,
  injectSupervisorPromptToAgentsMd,
  injectSupervisorPromptToGeminiMd,
  buildSupervisorPrompt,
  injectWorktreeRule,
  injectWorktreeRuleToAgentsMd,
  injectWorktreeRuleToGeminiMd,
  buildWorktreePrompt,
  detectBaseBranch,
  injectWorkspaceSessionSection,
  buildWorkspaceSessionSection,
  injectWorkspaceSessionSectionToAgentsMd,
  injectWorkspaceSessionSectionToGeminiMd,
  injectFileOpsRule,
  buildFileOpsPrompt,
  injectFileOpsRuleToAgentsMd,
  injectFileOpsRuleToGeminiMd,
} from '../agent/supervisorPrompt'
import { checkProviderAvailability } from '../agent/providerAvailability'
import type { IpcDependencies } from './index'
import type { ReasoningEffort } from '../adapter/types'
import { sendToRenderer, aiRenamingLocks, performAiRename } from './shared'
import { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'
// 鈽?杈撳叆楠岃瘉涓棿浠?
import { withValidation } from '../utils/inputValidation'

const RESUME_PROMPT_TOKEN_BUDGET = 7000
const RESUME_SUMMARY_TOKEN_BUDGET = 2400
const RESUME_RECENT_TOKEN_BUDGET = 3900
const RESUME_TOOL_ERROR_TOKEN_BUDGET = 700
const RESUME_MAX_RECENT_ROUNDS = 12

function normalizeText(text: string): string {
  return (text || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function estimateTokensApprox(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(/[\u4E00-\u9FFF]/g) || []).length
  const otherCount = Math.max(0, text.length - cjkCount)
  return Math.ceil(cjkCount / 1.6 + otherCount / 4)
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const normalized = normalizeText(text)
  if (!normalized) return ''
  if (tokenBudget <= 0) return ''
  if (estimateTokensApprox(normalized) <= tokenBudget) return normalized

  let lo = 0
  let hi = normalized.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const probe = normalized.slice(0, mid)
    if (estimateTokensApprox(probe) <= tokenBudget) lo = mid
    else hi = mid - 1
  }

  const clipped = normalized.slice(0, lo).trimEnd()
  return clipped ? `${clipped}...` : ''
}

function pickKeyLines(text: string, maxLines: number): string {
  const lines = normalizeText(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return ''

  const keyRe = /(error|failed|exception|warning|success|completed|created|updated|deleted|not found|found|exit code|timeout)/i
  const hits = lines.filter((l) => keyRe.test(l))
  const picked = (hits.length > 0 ? hits : [lines[lines.length - 1]]).slice(0, maxLines)
  return picked.join(' | ')
}

function collectImageNames(msg: any): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const add = (name: string | undefined) => {
    const value = (name || '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    names.push(value)
  }

  const fromTags = extractImageTags(String(msg?.content || ''))
  fromTags.forEach((tag) => add(tag.name))

  if (Array.isArray(msg?.attachments)) {
    for (const a of msg.attachments) {
      if (!a) continue
      add(String(a.name || ''))
      if (!a.name && typeof a.path === 'string') {
        const p = a.path.replace(/\\/g, '/')
        const last = p.split('/').filter(Boolean).pop()
        add(last || '')
      }
    }
  }
  return names
}

function formatDialogueMessageForResume(msg: any): string | undefined {
  const role = msg?.role

  const roleLabelMap: Record<string, string> = {
    user: 'User',
    assistant: 'Assistant',
  }
  if (!(role in roleLabelMap)) return undefined
  const label = roleLabelMap[role] || 'Message'
  const raw = String(msg?.content || '')
  const text = stripImageTags(raw)
  const imageNames = collectImageNames(msg)
  let body = text
  if (!body && imageNames.length > 0) {
    body = '[Sent image attachments]'
  }
  if (!body.trim()) return undefined

  const bodyBudget = role === 'assistant' ? 320 : role === 'user' ? 220 : 120
  const base = truncateToTokenBudget(body, bodyBudget)
  if (!base) return undefined
  if (imageNames.length === 0) return `[${label}] ${base}`

  const nameHint = imageNames.slice(0, 3).join(', ')
  const suffix = imageNames.length > 3
    ? ` [Images: ${nameHint}, +${imageNames.length - 3} more]`
    : ` [Images: ${nameHint}]`
  return truncateToTokenBudget(`[${label}] ${base}${suffix}`, bodyBudget + 60)
}

interface ResumeRound {
  lines: string[]
  tokens: number
}

function collectRecentRounds(messages: any[]): ResumeRound[] {
  const rounds: ResumeRound[] = []
  let current: ResumeRound | null = null

  for (const msg of messages || []) {
    const role = msg?.role
    const line = formatDialogueMessageForResume(msg)
    if (!line) continue
    const lineText = `- ${line}`
    const lineTokens = estimateTokensApprox(lineText)

    if (role === 'user') {
      if (current && current.lines.length > 0) {
        rounds.push(current)
      }
      current = { lines: [lineText], tokens: lineTokens }
      continue
    }

    if (!current) {
      current = { lines: [], tokens: 0 }
    }
    current.lines.push(lineText)
    current.tokens += lineTokens
  }

  if (current && current.lines.length > 0) {
    rounds.push(current)
  }
  return rounds
}

function buildRecentToolErrorSection(messages: any[], tokenBudget: number): string | undefined {
  if (!messages || messages.length === 0 || tokenBudget <= 0) return undefined

  const errors = (messages as any[])
    .filter((m) => m?.role === 'tool_result' && !!m?.isError)
    .slice(-10)

  if (errors.length === 0) return undefined

  const picked: string[] = []
  let used = 0
  for (let i = errors.length - 1; i >= 0; i--) {
    const e = errors[i]
    const tool = String(e?.toolName || 'tool')
    const key = pickKeyLines(String(e?.toolResult || e?.content || ''), 2) || 'Tool failed'
    const line = `- [ToolError:${tool}] ${truncateToTokenBudget(key, 110)}`
    const t = estimateTokensApprox(line)
    if (used + t > tokenBudget) break
    picked.push(line)
    used += t
  }

  if (picked.length === 0) return undefined
  return `Recent tool failures (only errors):\n${picked.join('\n')}`
}

function buildSummarySection(summaries: any[], tokenBudget: number): string | undefined {
  if (!summaries || summaries.length === 0 || tokenBudget <= 0) return undefined

  const picked: string[] = []
  let used = 0
  const latestFirst = summaries.slice(0, 24)
  for (const s of latestFirst) {
    const content = truncateToTokenBudget(String(s?.content || ''), 260)
    if (!content) continue
    const line = `- [${String(s?.type || 'summary')}] ${content}`
    const t = estimateTokensApprox(line)
    if (used + t > tokenBudget) {
      if (picked.length === 0) picked.push(truncateToTokenBudget(line, tokenBudget))
      break
    }
    picked.push(line)
    used += t
  }

  if (picked.length === 0) return undefined
  const omitted = Math.max(0, summaries.length - picked.length)
  const header = omitted > 0
    ? `Recent summaries (newest first, ${picked.length} used, ${omitted} omitted):`
    : 'Recent summaries (newest first):'
  return `${header}\n${picked.join('\n')}`
}

function buildRecentWindowSection(messages: any[], tokenBudget: number): string | undefined {
  if (!messages || messages.length === 0 || tokenBudget <= 0) return undefined

  const rounds = collectRecentRounds(messages)
  if (rounds.length === 0) return undefined

  const selected: ResumeRound[] = []
  let used = 0
  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i]
    if (selected.length >= RESUME_MAX_RECENT_ROUNDS) break
    const t = round.tokens
    if (used + t > tokenBudget) {
      if (selected.length === 0) {
        const clipped = round.lines
          .map((line) => truncateToTokenBudget(line, 180))
          .filter(Boolean) as string[]
        if (clipped.length > 0) {
          selected.push({
            lines: clipped,
            tokens: clipped.reduce((sum, line) => sum + estimateTokensApprox(line), 0),
          })
        }
      }
      break
    }
    selected.push(round)
    used += t
  }

  if (selected.length === 0) return undefined
  selected.reverse()
  const lines = selected.flatMap((round) => round.lines)
  const omitted = Math.max(0, rounds.length - selected.length)
  const header = omitted > 0
    ? `Recent conversation window (${selected.length} rounds used, ${omitted} older rounds omitted):`
    : 'Recent conversation window:'
  return `${header}\n${lines.join('\n')}`
}

function composeResumePrompt(summarySection?: string, recentSection?: string, toolErrorSection?: string): string {
  const parts: string[] = [
    'Session context recovery (generated by SpectrAI):',
    'You are continuing an existing conversation after app/runtime restart.',
    'Use the context below as authoritative history.',
    'Do not claim missing context unless the user request truly exceeds what is provided.',
    '',
  ]

  if (summarySection) {
    parts.push('=== Layer 1: Historical Summary ===')
    parts.push(summarySection)
    parts.push('')
  }

  if (recentSection) {
    parts.push('=== Layer 2: Recent Conversation Window ===')
    parts.push(recentSection)
    parts.push('')
  }

  if (toolErrorSection) {
    parts.push('=== Layer 3: Recent Tool Error Digest ===')
    parts.push(toolErrorSection)
    parts.push('')
  }

  parts.push('=== Instruction ===')
  parts.push('Continue naturally from this state and answer the next user message directly.')
  return parts.join('\n')
}

function buildResumeBootstrapPrompt(summaries: any[], messages: any[]): string | undefined {
  if ((!summaries || summaries.length === 0) && (!messages || messages.length === 0)) return undefined

  let summaryBudget = RESUME_SUMMARY_TOKEN_BUDGET
  let recentBudget = RESUME_RECENT_TOKEN_BUDGET
  let errorBudget = RESUME_TOOL_ERROR_TOKEN_BUDGET
  let summarySection = buildSummarySection(summaries, summaryBudget)
  let recentSection = buildRecentWindowSection(messages, recentBudget)
  let toolErrorSection = buildRecentToolErrorSection(messages, errorBudget)
  if (!summarySection && !recentSection) return undefined
  let prompt = composeResumePrompt(summarySection, recentSection, toolErrorSection)

  for (let i = 0; i < 8 && estimateTokensApprox(prompt) > RESUME_PROMPT_TOKEN_BUDGET; i++) {
    if (errorBudget > 300) errorBudget = Math.max(300, errorBudget - 120)
    else if (recentBudget > 900) recentBudget = Math.max(900, recentBudget - 450)
    else if (summaryBudget > 500) summaryBudget = Math.max(500, summaryBudget - 250)
    else break
    summarySection = buildSummarySection(summaries, summaryBudget)
    recentSection = buildRecentWindowSection(messages, recentBudget)
    toolErrorSection = buildRecentToolErrorSection(messages, errorBudget)
    prompt = composeResumePrompt(summarySection, recentSection, toolErrorSection)
  }

  if (estimateTokensApprox(prompt) > RESUME_PROMPT_TOKEN_BUDGET) {
    prompt = truncateToTokenBudget(prompt, RESUME_PROMPT_TOKEN_BUDGET)
  }
  return prompt
}

// 闃叉鍓嶇杩炵偣"鍒涘缓"閫犳垚閲嶅浼氳瘽锛堝悓鍙傛暟璇锋眰鍏变韩鍚屼竴 Promise锛?
const createSessionInFlight = new Map<string, Promise<any>>()

function buildCreateSessionDedupeKey(config: SessionConfig): string {
  return [
    config.workingDirectory || '',
    config.providerId || '',
    config.workspaceId || '',
    config.supervisorMode ? '1' : '0',
    (config.initialPrompt || '').trim(),
    (config.name || '').trim(),
  ].join('|')
}

export function registerSessionHandlers(deps: IpcDependencies): void {
  const {
    database, concurrencyGuard, notificationManager, trayManager,
    agentBridgePort,
  } = deps

  // ==================== Dialog 鐩稿叧 ====================

  ipcMain.handle('dialog:select-directory', async () => {
    const focusedWin = BrowserWindow.getFocusedWindow()
    if (!focusedWin) return null

    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog(focusedWin, {
      properties: ['openDirectory'],
      title: '閫夋嫨宸ヤ綔鐩綍'
    })

    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.DIALOG_SELECT_FILE, async () => {
    const focusedWin = BrowserWindow.getFocusedWindow()
    if (!focusedWin) return null

    const { dialog } = require('electron')
    const isWindows = process.platform === 'win32'
    const result = await dialog.showOpenDialog(focusedWin, {
      properties: ['openFile'],
      title: '选择 Claude Code CLI 可执行文件',
      filters: isWindows
        ? [
            { name: 'JavaScript 鏂囦欢', extensions: ['js'] },
            { name: '所有文件', extensions: ['*'] },
          ]
        : [{ name: '所有文件', extensions: ['*'] }],
    })

    return result.canceled ? null : result.filePaths[0]
  })

  // ==================== Session 鐩稿叧 ====================

  ipcMain.handle(IPC.SESSION_CREATE, async (_event, config: SessionConfig) => {
    const dedupeKey = buildCreateSessionDedupeKey(config)
    const existing = createSessionInFlight.get(dedupeKey)
    if (existing) return await existing

    const task = (async () => {
      try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 未初始化'
        })
      }

      // 妫€鏌ュ苟鍙戦檺鍒?
      const resourceCheck = concurrencyGuard.checkResources()
      if (!resourceCheck.canCreate) {
        throw new SpectrAIError({
          code: ErrorCode.RESOURCE_EXHAUSTED,
          message: `Resource limit reached: ${resourceCheck.reason}`,
          userMessage: resourceCheck.reason,
          recoverable: true
        })
      }

      // 鏌ヨ Provider锛堟暟鎹簱涓彲鑳藉瓨鍦ㄦ棤鏁?provider锛岄渶楠岃瘉 adapterType锛?
      const providerId = config.providerId || 'claude-code'
      let provider: AIProvider | undefined = database.getProvider(providerId)
      if (!provider || !provider.adapterType) {
        provider = BUILTIN_CLAUDE_PROVIDER
      }

      // 鈽?娉ㄥ叆寮曞鎻愮ず锛堟寜 provider 鍒嗘淳锛?
      if (config.supervisorMode) {
        config.enableAgent = true
        const allProviders = database.getAllProviders()
        const availability = await checkProviderAvailability(allProviders)
        const providerNames = availability.map(a =>
          a.available ? `${a.name}(${a.id})` : `${a.name}(${a.id}) [鏈畨瑁匽`
        )
        if (providerId === 'claude-code') {
          injectSupervisorPrompt(config.workingDirectory, providerNames)
        } else if (providerId === 'codex') {
          injectSupervisorPromptToAgentsMd(config.workingDirectory, providerNames)
        } else if (providerId === 'gemini-cli') {
          injectSupervisorPromptToGeminiMd(config.workingDirectory, providerNames)
        } else {
          // fallback锛坕flow / opencode 绛夛級锛氶€氳繃 initialPrompt 鍓嶇紑娉ㄥ叆
          const supervisorContent = buildSupervisorPrompt(providerNames)
          config.initialPrompt = config.initialPrompt
            ? `${supervisorContent}\n\n---\n\n${config.initialPrompt}`
            : supervisorContent
        }
      } else if (providerId === 'claude-code') {
        injectAwarenessPrompt(config.workingDirectory)
      }

      // 鈽?鑻ラ€夋嫨浜嗗伐浣滃尯锛屾敞鍏ュ浠撳簱涓婁笅鏂囷紙璁?AI 鐭ラ亾鎵€鏈変粨搴撹矾寰勶級
      // 娉ㄦ剰锛氭澶勪负鏅€?session锛寃orktree 鏈寤猴紝浣跨敤涓撶敤鐨?session 鏂囨锛堥潪 task 鏂囨锛?
      let workspaceRepos: Array<{ name: string; repoPath: string; isPrimary: boolean }> = []
      if (config.workspaceId) {
        try {
          const workspace = database.getWorkspace(config.workspaceId)
          if (workspace) {
            // 濡傛灉娌℃湁鎵嬪姩鎸囧畾 workingDirectory锛屼娇鐢ㄤ富浠撳簱璺緞
            const primaryRepo = workspace.repos.find((r: any) => r.isPrimary) ?? workspace.repos[0]
            if (primaryRepo && !config.workingDirectory) {
              config.workingDirectory = primaryRepo.repoPath
            }
            workspaceRepos = workspace.repos.map((r: any) => ({
              name: r.name,
              repoPath: r.repoPath,
              isPrimary: r.isPrimary,
            }))
            // 鈽?鏀堕泦闈炰富浠撳簱璺緞锛屼紶閫掔粰 SDK additionalDirectories锛岃 AI 鍙闂伐浣滃尯鍐呮墍鏈夌洰褰?
            const additionalDirs = workspaceRepos
              .filter(r => !r.isPrimary && r.repoPath !== config.workingDirectory)
              .map(r => r.repoPath)
            if (additionalDirs.length > 0) {
              config.additionalDirectories = additionalDirs
              console.log(`[IPC] Workspace additionalDirectories: ${additionalDirs.join(', ')}`)
            }
            // 鈽?娉ㄥ叆宸ヤ綔鍖哄浠撳簱涓婁笅鏂囷紙鎸?provider 鍒嗘淳锛?
            // 鍚?provider 鏈夎嚜宸辩殑瑙勫垯鏂囦欢鍙戠幇鏈哄埗锛?
            //   claude-code  鈫?.claude/rules/ 鏂囦欢锛堝惎鍔ㄦ椂鑷姩鍔犺浇锛? systemPromptAppend锛堝弻閲嶄繚闄╋級
            //   codex        鈫?AGENTS.md锛圕odex 鑷姩鍙戠幇锛學ORKSPACE 绠＄悊鍧楋級
            //   gemini-cli   鈫?GEMINI.md锛圙emini CLI 鑷姩鍔犺浇锛學ORKSPACE 绠＄悊鍧楋級
            //   鍏朵粬          鈫?systemPromptAppend / initialPrompt 鍓嶇紑
            if (providerId === 'claude-code') {
              injectWorkspaceSessionSection(config.workingDirectory, workspaceRepos)
              // 鍙岄噸淇濋櫓锛氶€氳繃 systemPromptAppend 娉ㄥ叆
              const wsSection = buildWorkspaceSessionSection(workspaceRepos)
              if (wsSection) {
                config.systemPromptAppend = config.systemPromptAppend
                  ? config.systemPromptAppend + '\n\n' + wsSection
                  : wsSection
              }
            } else if (providerId === 'codex') {
              injectWorkspaceSessionSectionToAgentsMd(config.workingDirectory, workspaceRepos)
            } else if (providerId === 'gemini-cli') {
              injectWorkspaceSessionSectionToGeminiMd(config.workingDirectory, workspaceRepos)
            } else {
              // fallback锛坕flow / opencode 绛夛級锛氶€氳繃 initialPrompt 鍓嶇紑娉ㄥ叆
              // OpenCode 鏃?systemPrompt 鏀寔锛宨nitialPrompt 鏄敮涓€鍙潬閫氶亾
              const wsSection = buildWorkspaceSessionSection(workspaceRepos)
              if (wsSection) {
                config.initialPrompt = config.initialPrompt
                  ? `${wsSection}\n\n---\n\n${config.initialPrompt}`
                  : wsSection
              }
            }
          }
        } catch (wsErr: any) {
          console.warn('[IPC] Failed to load workspace for session:', wsErr.message)
        }
      }

      // 鈽?autoWorktree 寮€鍚椂锛氬悜 AI 娉ㄥ叆 worktree 浣跨敤瑙勫垯
      // 宸ヤ綔鍖轰細璇濓細瀵瑰伐浣滃尯鍐呮瘡涓粨搴撻兘娉ㄥ叆瑙勫垯锛堣€岄潪浠呬富浠撳簱锛?
      // 鍚?provider 鏈夎嚜宸辩殑瑙勫垯鏂囦欢鍙戠幇鏈哄埗锛屽啓鏂囦欢姣斿彂娑堟伅鏇村共鍑€锛?
      //   claude-code  鈫?.claude/rules/spectrai-worktree.md锛堝惎鍔ㄦ椂鑷姩鍔犺浇锛?
      //              + systemPrompt.append锛堝弻閲嶄繚闄╋紝纭繚 SDK 妯″紡涓嬭鍒欑敓鏁堬級
      //   codex        鈫?AGENTS.md锛圕odex 鑷姩鍙戠幇锛岀ぞ鍖烘爣鍑嗭級
      //   gemini-cli   鈫?GEMINI.md锛圙emini CLI 鑷姩鍔犺浇锛?
      //   鍏朵粬鏈煡      鈫?fallback锛氫綔涓?initialPrompt 鍓嶇紑鍙戦€?
      const settings = database.getAppSettings()
      console.log(`[IPC] autoWorktree=${settings.autoWorktree}, providerId=${providerId}, workDir=${config.workingDirectory}`)
      if (settings.autoWorktree) {
        if (providerId === 'claude-code') {
          // 涓讳粨搴撴敞鍏ワ紙浼氳瘽宸ヤ綔鐩綍锛?
          injectWorktreeRule(config.workingDirectory)
          // 宸ヤ綔鍖哄唴鍏朵粬浠撳簱涔熸敞鍏?worktree 瑙勫垯锛岃 AI 瀵规瘡涓粨搴撻兘鏈夐殧绂绘剰璇?
          for (const repo of workspaceRepos) {
            if (!repo.isPrimary) {
              try {
                injectWorktreeRule(repo.repoPath)
              } catch (_) { /* 闈?git 浠撳簱鍒欏拷鐣?*/ }
            }
          }
          // 鈽?鍙岄噸淇濋櫓锛氬悓鏃堕€氳繃 systemPromptAppend 娉ㄥ叆瑙勫垯
          // 鍘熷洜锛欳laude Code SDK 鍦ㄦ煇浜涙儏鍐典笅鍙兘涓嶄細閲嶆柊鍔犺浇 .claude/rules/ 鏂囦欢锛?
          // 浣?systemPromptAppend 閫氳繃 SessionManagerV2 鐩存帴娉ㄥ叆 SDK systemPrompt锛?00% 鐢熸晥
          const worktreeRule = buildWorktreePrompt(detectBaseBranch(config.workingDirectory))
          config.systemPromptAppend = config.systemPromptAppend
            ? config.systemPromptAppend + '\n\n' + worktreeRule
            : worktreeRule
          console.log(`[IPC] worktree rule injected via systemPromptAppend, length=${config.systemPromptAppend.length}`)
        } else if (providerId === 'codex') {
          injectWorktreeRuleToAgentsMd(config.workingDirectory)
        } else if (providerId === 'gemini-cli') {
          injectWorktreeRuleToGeminiMd(config.workingDirectory)
        } else {
          const worktreeRule = buildWorktreePrompt(detectBaseBranch(config.workingDirectory))
          config.initialPrompt = config.initialPrompt
            ? `${worktreeRule}\n\n---\n\n${config.initialPrompt}`
            : worktreeRule
        }
      }

      // 鈽?娉ㄥ叆鏂囦欢鎿嶄綔瑙勫垯锛堣 AI 浣跨敤 SpectrAI MCP 宸ュ叿淇敼鏂囦欢锛屼互渚胯拷韪?diff锛?
      // 鍚?provider 鏈夎嚜宸辩殑瑙勫垯鏂囦欢鍙戠幇鏈哄埗锛?
      //   claude-code  鈫?.claude/rules/spectrai-fileops.md + systemPromptAppend锛堝弻閲嶄繚闄╋級
      //   codex        鈫?AGENTS.md 鐨?FILEOPS 绠＄悊鍧?
      //   gemini-cli   鈫?GEMINI.md 鐨?FILEOPS 绠＄悊鍧?
      //   鍏朵粬          鈫?initialPrompt 鍓嶇紑
      if (config.workingDirectory) {
        try {
          if (providerId === 'claude-code') {
            // Claude Code 浼氳嚜鍔ㄨ鍙?.claude/rules/ 鐩綍锛屾棤闇€杩藉姞鍒?systemPromptAppend锛堜細瀵艰嚧瀵硅瘽鍘嗗彶涓嚭鐜伴噸澶嶏級
            injectFileOpsRule(config.workingDirectory)
          } else if (providerId === 'codex') {
            injectFileOpsRuleToAgentsMd(config.workingDirectory)
          } else if (providerId === 'gemini-cli') {
            injectFileOpsRuleToGeminiMd(config.workingDirectory)
          } else {
            // fallback: 浣滀负 initialPrompt 鍓嶇紑娉ㄥ叆
            const fileOpsRule = buildFileOpsPrompt()
            config.initialPrompt = config.initialPrompt
              ? `${fileOpsRule}\n\n---\n\n${config.initialPrompt}`
              : fileOpsRule
          }
          console.log(`[IPC] file ops rule injected for session (provider: ${providerId})`)
        } catch (err: any) {
          console.warn('[IPC] Failed to inject file ops rule:', err.message)
        }
      }

      // 鈽?MCP 娉ㄥ叆绛栫暐锛堟敮鎸?claude-code / iflow / codex锛夛細
      //   - 鐢ㄦ埛閰嶇疆鐨?MCP锛氭墍鏈変細璇濆潎娉ㄥ叆锛屾棤璁烘槸鍚﹀紑鍚?Supervisor 妯″紡
      //   - spectrai-agent 绯荤粺 MCP锛氫粎 enableAgent锛圫upervisor锛夋ā寮忎笅娉ㄥ叆锛岀敤浜庤法浼氳瘽缂栨帓
      //   bridgePort = 0 鏃?generate* 鍐呴儴鑷姩璺宠繃 spectrai-agent 娈碉紝鍏朵綑閫昏緫涓嶅彉
      {
        const sessionMcpBridgePort = (agentBridgePort && config.enableAgent) ? agentBridgePort : 0
        const mcpSessionId = config.id || `session-${Date.now()}`
        // 纭畾 MCP 宸ュ叿鍒嗙骇妯″紡锛?
        // - supervisor: Supervisor 涓讳細璇濓紝鎷ユ湁瀹屾暣 Agent 璋冨害 + Leader 鍥㈤槦宸ュ叿
        // - awareness: 鏅€氫細璇濓紙闈?Supervisor锛夛紝浠呰法浼氳瘽鎰熺煡 + worktree + 鏂囦欢鎿嶄綔
        const mcpSessionMode = config.supervisorMode ? 'supervisor' : 'awareness'
        if (providerId === 'claude-code' || providerId === 'iflow') {
          // Claude Code / iFlow锛氶€氳繃 JSON 鏂囦欢娉ㄥ叆 MCP锛?-mcp-config / ACP loadMcpServersForAcp锛?
          const userMcps = database.getEnabledMcpsForProvider(providerId)
          if (userMcps.length > 0 || sessionMcpBridgePort > 0) {
            config.mcpConfigPath = MCPConfigGenerator.generate(
              mcpSessionId, sessionMcpBridgePort, config.workingDirectory, providerId, database, mcpSessionMode
            )
          }
        } else if (providerId === 'codex') {
          // Codex锛氶€氳繃 CODEX_HOME 鐜鍙橀噺閲嶅畾鍚戦厤缃洰褰曪紝瀹炵幇鎸変細璇?MCP 闅旂
          const userMcps = database.getEnabledMcpsForProvider(providerId)
          if (userMcps.length > 0 || sessionMcpBridgePort > 0) {
            const codexHomeDir = MCPConfigGenerator.generateForCodex(
              mcpSessionId, sessionMcpBridgePort, config.workingDirectory, providerId, database, mcpSessionMode
            )
            config.env = { ...config.env, CODEX_HOME: codexHomeDir }
          }
        }
      }

      config.providerId = provider.id
      config.adapterType = provider.adapterType

      // 鈽?iFlow 棰勭儹妯″紡锛氭彁鍓嶅畬鎴愭彙鎵嬶紝鍚庣画鍙戞秷鎭棤闇€绛夊緟 60 绉掑垵濮嬪寲
      if (config.prewarm && provider.id === 'iflow') {
        console.log(`[IPC] SESSION_CREATE: using prewarm mode for iFlow`)
        const prewarmResult = await smV2.prewarmSession(config, provider)
        concurrencyGuard.registerSession()
        database.recordDirectoryUsage(config.workingDirectory)
        // 绛夊緟棰勭儹瀹屾垚锛坧rewarmSession 鍐呴儴宸插畬鎴愭彙鎵嬶紝杩斿洖鏃跺凡鏄?waiting_input锛?
        return createSuccessResponse({
          sessionId: prewarmResult.sessionId,
          iflowSessionId: prewarmResult.iflowSessionId,
          ready: true,
          status: 'waiting_input',
          prewarmed: true,
        })
      }

      // 鈽?鍒涘缓 SDK V2 浼氳瘽
      // 鏁版嵁搴撹褰曠敱 systemHandlers.ts 涓殑 session_start 浜嬩欢缁熶竴鍐欏叆锛屾澶勪笉閲嶅鍐欙紙閬垮厤 UNIQUE constraint 鍐茬獊锛?
      const sessionId = smV2.createSession(config, provider)
      concurrencyGuard.registerSession()
      database.recordDirectoryUsage(config.workingDirectory)

      // 绛夊緟浼氳瘽鑴辩 starting锛堝彲浜や簰/澶辫触锛夊啀杩斿洖锛屽噺灏?鍒涘缓鎴愬姛浣嗕粛鍋囨€у鐞嗕腑"鐨勪綋楠岄棶棰?
      // 鈽?iFlow session/new 闇€鍒濆鍖?MCP servers锛屽疄娴嬮渶 ~60s锛岃秴鏃堕渶瑕嗙洊
      const readyTimeoutMs = provider.id === 'codex' ? 12000 : provider.id === 'iflow' ? 90000 : 6000
      const readyInfo = await smV2.waitForSessionReady(sessionId, readyTimeoutMs)

      if (readyInfo.status === 'error') {
        return {
          success: false,
          sessionId,
          ready: true,
          status: readyInfo.status,
          error: readyInfo.error || '浼氳瘽鍚姩澶辫触',
        }
      }

      return createSuccessResponse({
        sessionId,
        ready: readyInfo.ready,
        status: readyInfo.status
      })
      } catch (error: any) {
        console.error('[IPC] SESSION_CREATE error:', error)
        return createErrorResponse(error, { operation: 'session.create', config })
      }
    })()
    createSessionInFlight.set(dedupeKey, task)
    try {
      return await task
    } finally {
      createSessionInFlight.delete(dedupeKey)
    }
  })

  // 鈽?iFlow 棰勭儹锛氭彁鍓嶅畬鎴愭彙鎵嬶紝鍙戦€佹秷鎭椂鏃犻渶绛夊緟 60 绉掑垵濮嬪寲
  ipcMain.handle(IPC.SESSION_PREWARM, async (_event, config: SessionConfig) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }

      const providerId = config.providerId || 'claude-code'
      let provider: AIProvider | undefined = database.getProvider(providerId)
      if (!provider || !provider.adapterType) {
        provider = BUILTIN_CLAUDE_PROVIDER
      }

      const result = await smV2.prewarmSession(config, provider)
      concurrencyGuard.registerSession()
      database.recordDirectoryUsage(config.workingDirectory)

      return createSuccessResponse({
        sessionId: result.sessionId,
        iflowSessionId: result.iflowSessionId,
        status: result.status,
      })
    } catch (error: any) {
      console.error('[IPC] SESSION_PREWARM error:', error)
      return createErrorResponse(error, { operation: 'session.prewarm', config })
    }
  })

  ipcMain.handle(IPC.SESSION_TERMINATE, async (_event, sessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }
      if (smV2.getSession(sessionId)) {
        await smV2.terminateSession(sessionId)
        concurrencyGuard.unregisterSession()
      }
      database.updateSession(sessionId, { status: 'terminated' as any })
      return createSuccessResponse({ success: true })
    } catch (error: any) {
      console.error('[IPC] SESSION_TERMINATE error:', error)
      return createErrorResponse(error, { operation: 'session.terminate', sessionId })
    }
  })

  ipcMain.handle(IPC.SESSION_DELETE, async (_event, sessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      // 鑻ヤ細璇濅粛鍦ㄨ繍琛岋紝鍏堢粓姝?
      if (smV2?.getSession(sessionId)) {
        await smV2.terminateSession(sessionId)
        concurrencyGuard.unregisterSession()
      }
      database.deleteSession(sessionId)
      // 浠庡唴瀛?Map 涓Щ闄わ紝闃叉 SESSION_GET_ALL 杩斿洖宸插垹闄ょ殑"骞界伒浼氳瘽"
      // 瀵艰嚧 fetchSessions() 鍚堝苟鍚庡凡鍒犱細璇濋噸鏂板嚭鐜板湪鍓嶇鍒楄〃
      smV2?.removeSession(sessionId)
      return createSuccessResponse({ success: true })
    } catch (error: any) {
      console.error('[IPC] SESSION_DELETE error:', error)
      return createErrorResponse(error, { operation: 'session.delete', sessionId })
    }
  })

  ipcMain.handle(IPC.SESSION_TOGGLE_PIN, async (_event, sessionId: string) => {
    try {
      const isPinned = database.toggleSessionPin(sessionId)
      sendToRenderer(IPC.SESSION_REFRESH)
      return createSuccessResponse({ sessionId, isPinned })
    } catch (error: any) {
      console.error('[IPC] SESSION_TOGGLE_PIN error:', error)
      return createErrorResponse(error, { operation: 'session.togglePin', sessionId })
    }
  })

  ipcMain.handle(IPC.SESSION_SEND_INPUT, async (_event, sessionId: string, input: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }
      await smV2.sendMessage(sessionId, input)
      return createSuccessResponse({ success: true })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'session.sendInput', sessionId })
    }
  })

  ipcMain.handle(IPC.SESSION_CONFIRM, async (_event, sessionId: string, confirmed: boolean) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }
      await smV2.sendConfirmation(sessionId, confirmed)

      if (notificationManager.acknowledge(sessionId, 'confirmation')) {
        trayManager.decrementBadge()
      }

      return createSuccessResponse({ success: true })
    } catch (error: any) {
      return createErrorResponse(error, { operation: 'session.confirm', sessionId })
    }
  })

  ipcMain.handle(IPC.SESSION_GET_OUTPUT, async (_event, _sessionId: string) => {
    // V1 PTY 杈撳嚭缂撳啿鍖哄凡绉婚櫎锛孷2 閫氳繃 conversation-message 浜嬩欢鎺ㄦ祦锛屾 IPC 涓嶅啀浣跨敤
    return []
  })

  ipcMain.handle(IPC.SESSION_RESIZE, async (_event, _sessionId: string, _cols: number, _rows: number) => {
    // V2 Adapter 灞備笉闇€瑕佹墜鍔?resize
    return createSuccessResponse({ success: true })
  })

  ipcMain.handle(IPC.SESSION_GET_ALL, async () => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) return []
      const pinnedById = new Map(database.getAllSessions().map((s: any) => [s.id, !!s.isPinned]))

      return smV2.getAllSessions().map(s => ({
        config: s.config,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        exitCode: s.exitCode,
        estimatedTokens: s.totalUsage.inputTokens + s.totalUsage.outputTokens,
        id: s.id,
        name: s.name,
        claudeSessionId: s.claudeSessionId,
        providerId: s.config.providerId || 'claude-code',
        isPinned: pinnedById.get(s.id) || false
      }))
    } catch (error) {
      console.error('[IPC] SESSION_GET_ALL error:', error)
      return []
    }
  })

  ipcMain.handle(IPC.SESSION_GET_STATS, async (_event, sessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      const v2Session = smV2?.getSession(sessionId)
      if (v2Session) {
        const duration = v2Session.startedAt
          ? Math.floor((Date.now() - new Date(v2Session.startedAt).getTime()) / 1000)
          : 0
        return {
          tokenCount: v2Session.totalUsage.inputTokens + v2Session.totalUsage.outputTokens,
          duration,
          outputLines: 0
        }
      }
      return { tokenCount: 0, duration: 0 }
    } catch (error) {
      return { tokenCount: 0, duration: 0 }
    }
  })

  // ==================== Session 鍘嗗彶鏌ヨ ====================

  ipcMain.handle(IPC.SESSION_GET_HISTORY, async () => {
    try {
      const dbSessions = database.getAllSessions()
      return dbSessions.map((s: any) => ({
        id: s.id,
        name: s.name,
        config: s.config,
        status: s.status,
        startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt,
        endedAt: s.endedAt instanceof Date ? s.endedAt.toISOString() : s.endedAt,
        exitCode: s.exitCode,
        estimatedTokens: s.estimatedTokens || 0,
        claudeSessionId: s.claudeSessionId,
        providerId: s.providerId || 'claude-code',
        isPinned: !!s.isPinned
      }))
    } catch (error) {
      console.error('[IPC] SESSION_GET_HISTORY error:', error)
      return []
    }
  })

  ipcMain.handle(IPC.SESSION_GET_ACTIVITIES, async (_event, sessionId: string, limit?: number) => {
    try {
      return database.getSessionActivities(sessionId, limit || 500)
    } catch (error) {
      console.error('[IPC] SESSION_GET_ACTIVITIES error:', error)
      return []
    }
  })

  // ==================== Session 鏃ュ織 ====================

  ipcMain.handle(IPC.SESSION_GET_LOGS, async (_event, sessionId: string) => {
    try {
      return database.getSessionLogs(sessionId)
    } catch (error) {
      console.error('[IPC] SESSION_GET_LOGS error:', error)
      return []
    }
  })

  // ==================== Session 閲嶅懡鍚?====================

  ipcMain.handle(IPC.SESSION_RENAME, async (_event, sessionId: string, newName: string) => {
    try {
      const trimmed = newName.trim()
      if (!trimmed) {
        throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'Session name cannot be empty',
          userMessage: '鍚嶇О涓嶈兘涓虹┖'
        })
      }

      database.updateSession(sessionId, { name: trimmed, nameLocked: true })

      const smV2 = deps.sessionManagerV2
      const inMemory = smV2?.renameSession(sessionId, trimmed) ?? false

      if (!inMemory) {
        sendToRenderer(IPC.SESSION_NAME_CHANGE, sessionId, trimmed)
      }

      return createSuccessResponse({ success: true })
    } catch (error: any) {
      console.error('[IPC] SESSION_RENAME error:', error)
      return createErrorResponse(error, { operation: 'session.rename', sessionId })
    }
  })

  // ==================== Session AI 閲嶅懡鍚?====================

  ipcMain.handle(IPC.SESSION_AI_RENAME, async (_event, sessionId: string) => {
    if (aiRenamingLocks.has(sessionId)) {
      throw new SpectrAIError({
          code: ErrorCode.RESOURCE_BUSY,
          message: 'AI rename already in progress',
          userMessage: '正在 AI 重命名中，请稍候',
          recoverable: true
        })
    }
    aiRenamingLocks.add(sessionId)
    try {
      const result = await performAiRename(database, sessionId)
      if (!result.success) return result

      database.updateSession(sessionId, { name: result.name!, nameLocked: true })

      const smV2 = deps.sessionManagerV2
      const inMemory = smV2?.renameSession(sessionId, result.name!) ?? false
      if (!inMemory) {
        sendToRenderer(IPC.SESSION_NAME_CHANGE, sessionId, result.name!)
      }

      return createSuccessResponse({ name: result.name })
    } catch (error: any) {
      console.error('[IPC] SESSION_AI_RENAME error:', error)
      return createErrorResponse(error, { operation: 'session.aiRename', sessionId })
    } finally {
      aiRenamingLocks.delete(sessionId)
    }
  })

  // ==================== Session 妯″瀷鍒囨崲 ====================

  ipcMain.handle(IPC.SESSION_SET_MODEL, async (_event, sessionId: string, modelId: string, options?: { reasoningEffort?: string }) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }

      const trimmed = modelId?.trim()
      if (!trimmed) {
        throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'Model ID cannot be empty',
          userMessage: '妯″瀷 ID 涓嶈兘涓虹┖'
        })
      }
      const reasoningEffort = options?.reasoningEffort
      const allowedEfforts = new Set(['low', 'medium', 'high', 'xhigh'])
      if (reasoningEffort && !allowedEfforts.has(reasoningEffort)) {
        throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: `Invalid reasoning effort: ${reasoningEffort}`,
          userMessage: '无效的推理模式'
        })
      }

      const session = smV2.getSession(sessionId)
      if (!session) {
        throw new SpectrAIError({
          code: ErrorCode.SESSION_NOT_FOUND,
          message: 'Session not found',
          userMessage: '找不到指定会话'
        })
      }

      const updated = await smV2.setModelOverride(sessionId, trimmed, {
        reasoningEffort: reasoningEffort as ReasoningEffort | undefined
      })
      if (!updated) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'Failed to set model override',
          userMessage: '璁剧疆妯″瀷瑕嗙洊澶辫触'
        })
      }

      console.log(`[IPC] SESSION_SET_MODEL: ${sessionId} -> ${updated.model}, effectiveNow=${updated.effectiveNow}`)
      return createSuccessResponse({
        model: updated.model,
        effectiveNow: updated.effectiveNow,
        requiresRestart: updated.requiresRestart,
        providerSessionId: updated.providerSessionId,
        reasoningEffort: updated.reasoningEffort,
        message: updated.effectiveNow
          ? '模型/模式已切换，后续消息将使用新设置'
          : '模型偏好已保存，请重启会话使新模型生效'
      })
    } catch (error: any) {
      console.error('[IPC] SESSION_SET_MODEL error:', error)
      return createErrorResponse(error, { operation: 'session.setModel', sessionId })
    }
  })

  // ==================== Session 鎭㈠ ====================

  ipcMain.handle(IPC.SESSION_RESUME, async (_event, oldSessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }

      const dbSessions = database.getAllSessions()
      const oldSession = dbSessions.find((s: any) => s.id === oldSessionId)
      if (!oldSession) {
        throw new SpectrAIError({
          code: ErrorCode.SESSION_NOT_FOUND,
          message: 'Original session not found',
          userMessage: '找不到原会话记录'
        })
      }

      const providerId = oldSession.providerId || oldSession.config?.providerId || 'claude-code'
      const provider: AIProvider = database.getProvider(providerId) || BUILTIN_CLAUDE_PROVIDER

      if (!provider.resumeArg) {
        const resourceCheck = concurrencyGuard.checkResources();
        if (!resourceCheck.canCreate) {
          throw new SpectrAIError({
          code: ErrorCode.RESOURCE_EXHAUSTED,
          message: `Resource limit: ${resourceCheck.reason}`,
          userMessage: resourceCheck.reason,
          recoverable: true
        });
        }

        const history = database.getConversationMessages(oldSessionId, 260);
        const summaries = database.getSessionSummaries(oldSessionId, 24);
        const resumeInitialPrompt = buildResumeBootstrapPrompt(summaries, history);
        const continueSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const baseConfig = (oldSession.config || {}) as SessionConfig;
        const resumeName = oldSession.name || baseConfig.name || 'Session';

        const resumeConfig: SessionConfig = {
          ...baseConfig,
          id: continueSessionId,
          name: resumeName,
          workingDirectory: oldSession.workingDirectory || baseConfig.workingDirectory,
          providerId: provider.id,
          adapterType: provider.adapterType,
          initialPrompt: resumeInitialPrompt,
          initialPromptVisibility: resumeInitialPrompt ? 'hidden' : undefined,
        };
        delete (resumeConfig as any).claudeArgs;

        // Resume A锛氱敤鎴?MCP 濮嬬粓娉ㄥ叆锛泂pectrai-agent 浠?enableAgent 鏃舵敞鍏?
        {
          const resumeMcpBridgePort = (agentBridgePort && resumeConfig.enableAgent) ? agentBridgePort : 0
          const resumeMcpMode = resumeConfig.supervisorMode ? 'supervisor' : 'awareness'
          if (providerId === 'claude-code' || providerId === 'iflow') {
            const userMcps = database.getEnabledMcpsForProvider(providerId)
            if (userMcps.length > 0 || resumeMcpBridgePort > 0) {
              resumeConfig.mcpConfigPath = MCPConfigGenerator.generate(
                continueSessionId, resumeMcpBridgePort, oldSession.workingDirectory, providerId, database, resumeMcpMode
              );
            }
          } else if (providerId === 'codex') {
            const userMcps = database.getEnabledMcpsForProvider(providerId)
            if (userMcps.length > 0 || resumeMcpBridgePort > 0) {
              const codexHomeDir = MCPConfigGenerator.generateForCodex(
                continueSessionId, resumeMcpBridgePort, oldSession.workingDirectory, providerId, database, resumeMcpMode
              );
              resumeConfig.env = { ...resumeConfig.env, CODEX_HOME: codexHomeDir };
            }
          }
        }

        // 鈽?Resume A锛氶噸鏂版敞鍏?awareness/supervisor 鎻愮ず + worktree 瑙勫垯
        // 浼氳瘽缁撴潫鏃惰鍒欐枃浠跺凡琚竻鐞嗭紝resume 鍒涘缓鏂颁細璇濇椂蹇呴』閲嶆柊鍐欏叆
        if (resumeConfig.supervisorMode) {
          const allProviders = database.getAllProviders()
          const availability = await checkProviderAvailability(allProviders)
          const providerNames = availability.map((a: any) =>
            a.available ? `${a.name}(${a.id})` : `${a.name}(${a.id}) [鏈畨瑁匽`
          )
          if (providerId === 'claude-code') {
            injectSupervisorPrompt(resumeConfig.workingDirectory, providerNames)
          } else if (providerId === 'codex') {
            injectSupervisorPromptToAgentsMd(resumeConfig.workingDirectory, providerNames)
          } else if (providerId === 'gemini-cli') {
            injectSupervisorPromptToGeminiMd(resumeConfig.workingDirectory, providerNames)
          } else {
            const supervisorContent = buildSupervisorPrompt(providerNames)
            resumeConfig.initialPrompt = resumeConfig.initialPrompt
              ? `${supervisorContent}\n\n---\n\n${resumeConfig.initialPrompt}`
              : supervisorContent
          }
        } else if (providerId === 'claude-code') {
          injectAwarenessPrompt(resumeConfig.workingDirectory)
        }
        if (providerId === 'claude-code') {
          const resumeSettings = database.getAppSettings()
          if (resumeSettings.autoWorktree) {
            injectWorktreeRule(resumeConfig.workingDirectory)
            // 鈽?鍙岄噸淇濋櫓锛氶€氳繃 systemPromptAppend 娉ㄥ叆瑙勫垯
            const worktreeRule = buildWorktreePrompt(detectBaseBranch(resumeConfig.workingDirectory))
            resumeConfig.systemPromptAppend = resumeConfig.systemPromptAppend
              ? resumeConfig.systemPromptAppend + '\n\n' + worktreeRule
              : worktreeRule
          }
        } else if (providerId === 'codex') {
          const resumeSettings = database.getAppSettings()
          if (resumeSettings.autoWorktree) {
            injectWorktreeRuleToAgentsMd(resumeConfig.workingDirectory)
          }
        } else if (providerId === 'gemini-cli') {
          const resumeSettings = database.getAppSettings()
          if (resumeSettings.autoWorktree) {
            injectWorktreeRuleToGeminiMd(resumeConfig.workingDirectory)
          }
        } else {
          const resumeSettings = database.getAppSettings()
          if (resumeSettings.autoWorktree) {
            const worktreeRule = buildWorktreePrompt(detectBaseBranch(resumeConfig.workingDirectory))
            resumeConfig.initialPrompt = resumeConfig.initialPrompt
              ? `${worktreeRule}\n\n---\n\n${resumeConfig.initialPrompt}`
              : worktreeRule
          }
        }

        // 鈽?娉ㄥ叆鏂囦欢鎿嶄綔瑙勫垯锛坮esume 鏃朵篃闇€瑕侀噸鏂版敞鍏ワ級
        if (resumeConfig.workingDirectory) {
          try {
            if (providerId === 'claude-code') {
              injectFileOpsRule(resumeConfig.workingDirectory)
              const fileOpsRule = buildFileOpsPrompt()
              resumeConfig.systemPromptAppend = resumeConfig.systemPromptAppend
                ? resumeConfig.systemPromptAppend + '\n\n' + fileOpsRule
                : fileOpsRule
            } else if (providerId === 'codex') {
              injectFileOpsRuleToAgentsMd(resumeConfig.workingDirectory)
            } else if (providerId === 'gemini-cli') {
              injectFileOpsRuleToGeminiMd(resumeConfig.workingDirectory)
            } else {
              const fileOpsRule = buildFileOpsPrompt()
              resumeConfig.initialPrompt = resumeConfig.initialPrompt
                ? `${fileOpsRule}\n\n---\n\n${resumeConfig.initialPrompt}`
                : fileOpsRule
            }
          } catch (err) { /* ignore */ }
        }

        const newSessionId = smV2.createSession(resumeConfig, provider);
        concurrencyGuard.registerSession();
        database.recordDirectoryUsage(resumeConfig.workingDirectory);

        const readyTimeoutMs = provider.id === 'codex' ? 12000 : provider.id === 'iflow' ? 90000 : 6000;
        await smV2.waitForSessionReady(newSessionId, readyTimeoutMs);

        console.warn(`[IPC] ${provider.name} does not support native resume; created continuation session ${newSessionId} from ${oldSessionId}`);
        return createSuccessResponse({ sessionId: newSessionId, recreated: true });
      }

      const resourceCheck = concurrencyGuard.checkResources()
      if (!resourceCheck.canCreate) {
        throw new SpectrAIError({
          code: ErrorCode.RESOURCE_EXHAUSTED,
          message: `Resource limit: ${resourceCheck.reason}`,
          userMessage: resourceCheck.reason,
          recoverable: true
        })
      }

      const claudeSessionId = (oldSession as any).claudeSessionId
      const resumeArg = provider.resumeArg
      const isSubcommand = provider.resumeFormat === 'subcommand'

      const knownResumeArgs = new Set([resumeArg, '--resume', 'resume'])
      const baseArgs = (oldSession.config?.claudeArgs || []).filter((arg: string, idx: number, arr: string[]) => {
        if (knownResumeArgs.has(arg)) return false
        if (idx > 0 && knownResumeArgs.has(arr[idx - 1])) return false
        return true
      })

      let resumeArgs: string[]

      if (isSubcommand) {
        if (claudeSessionId) {
          resumeArgs = [resumeArg, claudeSessionId]
          console.log(`[IPC] Resuming with ${provider.name} subcommand: ${resumeArg} ${claudeSessionId}`)
        } else {
          resumeArgs = [resumeArg]
          console.warn(`[IPC] No session ID, falling back to ${provider.name}: ${resumeArg}`)
        }
      } else {
        resumeArgs = [...baseArgs]
        if (claudeSessionId) {
          resumeArgs.push(resumeArg, claudeSessionId)
          console.log(`[IPC] Resuming with ${provider.name} flag: ${resumeArg} ${claudeSessionId}`)
        } else {
          resumeArgs.push(resumeArg)
          console.warn(`[IPC] No claudeSessionId in DB, falling back to ${resumeArg} picker`)
        }
      }

      let resumeName = oldSession.name
      if (/\.exe\b/i.test(resumeName) || /^[A-Za-z]:\\Windows\\/i.test(resumeName)) {
        resumeName = oldSession.workingDirectory.split(/[\\\/]/).filter(Boolean).pop() || 'Session'
      }

      let resumeInitialPrompt: string | undefined
      if (provider.adapterType === 'codex-appserver') {
        const history = database.getConversationMessages(oldSessionId, 260)
        const summaries = database.getSessionSummaries(oldSessionId, 24)
        resumeInitialPrompt = buildResumeBootstrapPrompt(summaries, history)
        if (resumeInitialPrompt) {
          const promptTokens = estimateTokensApprox(resumeInitialPrompt)
          console.warn(
            `[IPC] ${provider.name} resume fallback: summaries=${summaries.length}, recentMessages=${history.length}, promptTokens~${promptTokens}`
          )
        }
      }

      const resumeConfig = {
        ...(oldSession.config || {}),
        name: resumeName,
        workingDirectory: oldSession.workingDirectory,
        claudeArgs: resumeArgs,
        providerId: provider.id,
        adapterType: provider.adapterType,
        initialPrompt: resumeInitialPrompt,
        initialPromptVisibility: resumeInitialPrompt ? 'hidden' : undefined,
      }

      // 鈽?閲嶆柊鐢熸垚 MCP 閰嶇疆鏂囦欢锛堟棫鏂囦欢鍦ㄤ笂娆″叧闂椂宸茶 cleanupAll 鍒犻櫎锛?
      // Resume B锛氶噸鏂扮敓鎴?MCP 閰嶇疆锛堟棫鏂囦欢鍦ㄤ笂娆″叧闂椂宸茶 cleanupAll 鍒犻櫎锛?
      // 鐢ㄦ埛 MCP 濮嬬粓娉ㄥ叆锛泂pectrai-agent 浠?enableAgent锛圫upervisor锛夋ā寮忔椂娉ㄥ叆
      {
        const resumeMcpBridgePort = (agentBridgePort && resumeConfig.enableAgent) ? agentBridgePort : 0
        const resumeMcpMode = resumeConfig.supervisorMode ? 'supervisor' : 'awareness'
        if (providerId === 'claude-code' || providerId === 'iflow') {
          const userMcps = database.getEnabledMcpsForProvider(providerId)
          if (userMcps.length > 0 || resumeMcpBridgePort > 0) {
            resumeConfig.mcpConfigPath = MCPConfigGenerator.generate(
              oldSessionId, resumeMcpBridgePort, oldSession.workingDirectory, providerId, database, resumeMcpMode
            )
          }
        } else if (providerId === 'codex') {
          const userMcps = database.getEnabledMcpsForProvider(providerId)
          if (userMcps.length > 0 || resumeMcpBridgePort > 0) {
            const codexHomeDir = MCPConfigGenerator.generateForCodex(
              oldSessionId, resumeMcpBridgePort, oldSession.workingDirectory, providerId, database, resumeMcpMode
            )
            resumeConfig.env = { ...resumeConfig.env, CODEX_HOME: codexHomeDir }
          }
        }
      }

      // 鈽?Resume B锛氶噸鏂版敞鍏?awareness/supervisor 鎻愮ず + worktree 瑙勫垯
      // 浼氳瘽缁撴潫鏃惰鍒欐枃浠跺凡琚竻鐞嗭紝resume 閲嶅惎浼氳瘽鏃跺繀椤婚噸鏂板啓鍏?
      if (resumeConfig.supervisorMode) {
        const allProviders = database.getAllProviders()
        const availability = await checkProviderAvailability(allProviders)
        const providerNames = availability.map((a: any) =>
          a.available ? `${a.name}(${a.id})` : `${a.name}(${a.id}) [鏈畨瑁匽`
        )
        if (providerId === 'claude-code') {
          injectSupervisorPrompt(resumeConfig.workingDirectory, providerNames)
        } else if (providerId === 'codex') {
          injectSupervisorPromptToAgentsMd(resumeConfig.workingDirectory, providerNames)
        } else if (providerId === 'gemini-cli') {
          injectSupervisorPromptToGeminiMd(resumeConfig.workingDirectory, providerNames)
        } else {
          const supervisorContent = buildSupervisorPrompt(providerNames)
          resumeConfig.initialPrompt = resumeConfig.initialPrompt
            ? `${supervisorContent}\n\n---\n\n${resumeConfig.initialPrompt}`
            : supervisorContent
        }
      } else if (providerId === 'claude-code') {
        injectAwarenessPrompt(resumeConfig.workingDirectory)
      }
      if (providerId === 'claude-code') {
        const resumeSettings = database.getAppSettings()
        if (resumeSettings.autoWorktree) {
          injectWorktreeRule(resumeConfig.workingDirectory)
          // 鈽?鍙岄噸淇濋櫓锛氶€氳繃 systemPromptAppend 娉ㄥ叆瑙勫垯
          const worktreeRule = buildWorktreePrompt(detectBaseBranch(resumeConfig.workingDirectory))
          resumeConfig.systemPromptAppend = resumeConfig.systemPromptAppend
            ? resumeConfig.systemPromptAppend + '\n\n' + worktreeRule
            : worktreeRule
        }
      } else if (providerId === 'codex') {
        const resumeSettings = database.getAppSettings()
        if (resumeSettings.autoWorktree) {
          injectWorktreeRuleToAgentsMd(resumeConfig.workingDirectory)
        }
      } else if (providerId === 'gemini-cli') {
        const resumeSettings = database.getAppSettings()
        if (resumeSettings.autoWorktree) {
          injectWorktreeRuleToGeminiMd(resumeConfig.workingDirectory)
        }
      }

      // 鈽?娉ㄥ叆鏂囦欢鎿嶄綔瑙勫垯锛坮esume 鏃朵篃闇€瑕侀噸鏂版敞鍏ワ級
      if (resumeConfig.workingDirectory) {
        try {
          if (providerId === 'claude-code') {
            injectFileOpsRule(resumeConfig.workingDirectory)
            const fileOpsRule = buildFileOpsPrompt()
            resumeConfig.systemPromptAppend = resumeConfig.systemPromptAppend
              ? resumeConfig.systemPromptAppend + '\n\n' + fileOpsRule
              : fileOpsRule
          } else if (providerId === 'codex') {
            injectFileOpsRuleToAgentsMd(resumeConfig.workingDirectory)
          } else if (providerId === 'gemini-cli') {
            injectFileOpsRuleToGeminiMd(resumeConfig.workingDirectory)
          } else {
            const fileOpsRule = buildFileOpsPrompt()
            resumeConfig.initialPrompt = resumeConfig.initialPrompt
              ? `${fileOpsRule}\n\n---\n\n${resumeConfig.initialPrompt}`
              : fileOpsRule
          }
        } catch (err) { /* ignore */ }
      }

      smV2.createSessionWithId(
        oldSessionId,
        resumeConfig,
        claudeSessionId || undefined,
        provider
      )
      concurrencyGuard.registerSession()
      console.log(`[IPC] SDK V2 resume: ${oldSessionId} via ${provider.name} adapter`)

      database.updateSession(oldSessionId, {
        status: 'running' as any,
        config: resumeConfig,
        name: resumeName
      })

      if (claudeSessionId) {
        const allSessions = database.getAllSessions()
        for (const s of allSessions) {
          if (s.id !== oldSessionId && (s as any).claudeSessionId === claudeSessionId && s.status === 'interrupted') {
            database.updateSession(s.id, { status: 'completed' as any })
            console.log(`[IPC] Cleaned up duplicate interrupted session: ${s.id}`)
          }
        }
      }

      return createSuccessResponse({ sessionId: oldSessionId })
    } catch (error: any) {
      console.error('[IPC] SESSION_RESUME error:', error)
      return createErrorResponse(error, { operation: 'session.resume', oldSessionId })
    }
  })

  // ==================== SDK V2: 瀵硅瘽 API ====================

  ipcMain.handle(IPC.SESSION_SEND_MESSAGE, async (_event, sessionId: string, message: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }
      const dispatch = await smV2.sendMessage(sessionId, message)
      return createSuccessResponse({ dispatch })
    } catch (error: any) {
      console.error('[IPC] SESSION_SEND_MESSAGE error:', error)
      return createErrorResponse(error, { operation: 'session.sendMessage', sessionId })
    }
  })

  ipcMain.handle(IPC.SESSION_ABORT, async (_event, sessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }
      await smV2.abortSession(sessionId)
      return createSuccessResponse({ success: true })
    } catch (error: any) {
      console.error('[IPC] SESSION_ABORT error:', error)
      return createErrorResponse(error, { operation: 'session.abort', sessionId })
    }
  })

  ipcMain.handle(IPC.SESSION_CONVERSATION_HISTORY, async (_event, sessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (smV2) {
        const liveMessages = smV2.getConversation(sessionId)
        if (liveMessages.length > 0) return liveMessages
      }
      return database.getConversationMessages(sessionId)
    } catch (error) {
      console.error('[IPC] SESSION_CONVERSATION_HISTORY error:', error)
      return []
    }
  })

  ipcMain.handle(IPC.SESSION_PERMISSION_RESPOND, async (_event, sessionId: string, accept: boolean) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) {
        throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      }
      await smV2.sendConfirmation(sessionId, accept)

      if (notificationManager.acknowledge(sessionId, 'confirmation')) {
        trayManager.decrementBadge()
      }

      return createSuccessResponse({ success: true })
    } catch (error: any) {
      console.error('[IPC] SESSION_PERMISSION_RESPOND error:', error)
      return createErrorResponse(error, { operation: 'session.permissionRespond', sessionId })
    }
  })

  // SDK V2: AskUserQuestion 绛旀鍝嶅簲
  ipcMain.handle(IPC.SESSION_ANSWER_QUESTION, async (_event, sessionId: string, answers: Record<string, string>) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      await smV2.sendQuestionAnswer(sessionId, answers)
      return createSuccessResponse({ success: true })
    } catch (error: any) {
      console.error('[IPC] SESSION_ANSWER_QUESTION error:', error)
      return createErrorResponse(error, { operation: 'session.answerQuestion', sessionId })
    }
  })

  // SDK V2: ExitPlanMode 瀹℃壒鍝嶅簲
  ipcMain.handle(IPC.SESSION_APPROVE_PLAN, async (_event, sessionId: string, approved: boolean) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      await smV2.sendPlanApproval(sessionId, approved)
      return createSuccessResponse({ success: true })
    } catch (error: any) {
      console.error('[IPC] SESSION_APPROVE_PLAN error:', error)
      return createErrorResponse(error, { operation: 'session.approvePlan', sessionId })
    }
  })

  // SDK V2: 鑾峰彇鎺掗槦涓殑娑堟伅鍒楄〃
  ipcMain.handle(IPC.SESSION_GET_QUEUE, async (_event, sessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      const messages = smV2.getScheduledMessages(sessionId)
      return createSuccessResponse({ messages })
    } catch (error: any) {
      console.error('[IPC] SESSION_GET_QUEUE error:', error)
      return createErrorResponse(error, { operation: 'session.getQueue', sessionId })
    }
  })

  // SDK V2: 娓呯┖鎺掗槦涓殑娑堟伅锛堢敤鎴蜂富鍔ㄥ彇娑堬級
  ipcMain.handle(IPC.SESSION_CLEAR_QUEUE, async (_event, sessionId: string) => {
    try {
      const smV2 = deps.sessionManagerV2
      if (!smV2) throw new SpectrAIError({
          code: ErrorCode.INTERNAL,
          message: 'SDK V2 SessionManager not initialized',
          userMessage: 'SDK V2 SessionManager 鏈垵濮嬪寲'
        })
      const cleared = smV2.clearScheduledMessages(sessionId)
      return createSuccessResponse({ cleared })
    } catch (error: any) {
      console.error('[IPC] SESSION_CLEAR_QUEUE error:', error)
      return createErrorResponse(error, { operation: 'session.clearQueue', sessionId })
    }
  })
}
