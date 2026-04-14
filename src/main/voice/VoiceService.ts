/**
 * 语音交互服务 - 语音输入指令、AI 语音播报
 *
 * 完整实现：
 * - 麦克风录音采集（node-record-lpcm16，跨平台）
 * - Whisper API 转录（OpenAI / 兼容接口）
 * - 语音合成播报（macOS say / Windows SAPI / Linux espeak）
 * - VAD 静音检测自动停止
 * - 流式录音 → 转录流水线
 *
 * @author spectrai
 */
import { exec } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'

const execAsync = promisify(exec)

// ─── 录音库动态导入（可选依赖）────────────────────────────
let recording: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  recording = require('node-record-lpcm16')
} catch {
  console.warn('[VoiceService] node-record-lpcm16 未安装，录音功能不可用')
}

// ─── 类型 ─────────────────────────────────────────────────

export interface VoiceConfig {
  enabled: boolean
  language: string                         // 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR'
  autoSpeak: boolean                       // AI 回复自动播报
  speechRate: number                       // 0.5 - 2.0
  wakeWord: string                         // 唤醒词（预留）
  transcriptionProvider: 'local' | 'whisper-api'
  whisperApiKey?: string
  whisperApiUrl?: string
  whisperModel?: string                    // whisper-1 | large-v3 等
  silenceThreshold?: number                // 静音阈值（秒），超时自动停止
  maxRecordingDuration?: number            // 最大录音时长（秒）
  sampleRate?: number                      // 采样率
}

export interface VoiceStatus {
  isListening: boolean
  isSpeaking: boolean
  isRecording: boolean
  lastTranscript: string | null
  error: string | null
  recordingDuration: number                // 当前录音时长（秒）
}

export interface VoiceHistoryEntry {
  id: string
  timestamp: string
  type: 'input' | 'output'
  text: string
  confidence?: number
  duration?: number                        // 录音时长
}

type VoiceEvent =
  | { type: 'recording-started' }
  | { type: 'recording-stopped'; duration: number }
  | { type: 'transcription-result'; text: string; confidence: number }
  | { type: 'transcription-error'; error: string }
  | { type: 'speaking-started'; text: string }
  | { type: 'speaking-completed' }

// ─── 服务 ─────────────────────────────────────────────────

export class VoiceService extends EventEmitter {
  private config: VoiceConfig = {
    enabled: false,
    language: 'zh-CN',
    autoSpeak: false,
    speechRate: 1.0,
    wakeWord: '小 Spectr',
    transcriptionProvider: 'local',
    whisperModel: 'whisper-1',
    silenceThreshold: 3,                   // 3秒静音自动停止
    maxRecordingDuration: 60,              // 最长60秒
    sampleRate: 16000,
  }
  private status: VoiceStatus = {
    isListening: false,
    isSpeaking: false,
    isRecording: false,
    lastTranscript: null,
    error: null,
    recordingDuration: 0,
  }
  private history: VoiceHistoryEntry[] = []
  private idCounter = 0
  private mainWindow: BrowserWindow | null = null

  // 录音相关
  private micRecorder: any = null
  private audioChunks: Buffer[] = []
  private recordingStartTime: number = 0
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    super()
  }

  /** 设置主窗口引用（用于发送 IPC 事件） */
  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win
  }

  // ─── 录音控制 ──────────────────────────────────────────

  /** 开始监听（录音） */
  async startListening(): Promise<{ success: boolean; message: string }> {
    if (this.status.isRecording) {
      return { success: false, message: '已在录音中' }
    }
    if (!recording) {
      return { success: false, message: '录音模块未安装，请确认 node-record-lpcm16 已安装' }
    }

    try {
      // 重置状态
      this.audioChunks = []
      this.recordingStartTime = Date.now()
      this.status.isListening = true
      this.status.isRecording = true
      this.status.error = null
      this.status.recordingDuration = 0

      // 启动麦克风录音
      this.micRecorder = recording.record({
        sampleRate: this.config.sampleRate,
        channels: 1,                        // 单声道，Whisper 要求
        audioType: 'wav',                   // 输出 WAV 格式
        recorder: this.detectRecorder(),    // 自动检测可用录音后端
        threshold: 0.5,                     // 音量阈值（0-1）
        silence: this.config.silenceThreshold!,  // 静音超时自动停止
        endOnSilence: true,                 // 静音后自动结束
      })

      // 收集音频数据
      this.micRecorder.stream().on('data', (chunk: Buffer) => {
        this.audioChunks.push(chunk)
      })

      // 录音自动结束（静音检测触发）
      this.micRecorder.stream().on('end', () => {
        this.handleRecordingEnd()
      })

      // 录音错误
      this.micRecorder.stream().on('error', (err: Error) => {
        console.error('[VoiceService] 录音错误:', err)
        this.status.error = `录音错误: ${err.message}`
        this.stopRecordingCleanup()
        this.sendToRenderer('voice:error', { error: err.message })
      })

      // 最大录音时长保护
      this.maxDurationTimer = setTimeout(() => {
        console.log('[VoiceService] 达到最大录音时长，自动停止')
        this.stopListening()
      }, this.config.maxRecordingDuration! * 1000)

      this.emitEvent({ type: 'recording-started' })
      this.sendToRenderer('voice:recording-started', {})

      return { success: true, message: '录音已开始，请说话...' }
    } catch (err: any) {
      this.status.isRecording = false
      this.status.isListening = false
      this.status.error = `启动录音失败: ${err.message}`
      return { success: false, message: `启动录音失败: ${err.message}` }
    }
  }

  /** 停止监听（停止录音 + 自动转录） */
  async stopListening(): Promise<{ success: boolean; transcript: string | null }> {
    if (!this.status.isRecording) {
      return { success: false, transcript: null }
    }

    try {
      // 停止麦克风
      if (this.micRecorder) {
        this.micRecorder.stop()
        this.micRecorder = null
      }

      // 清理定时器
      if (this.maxDurationTimer) {
        clearTimeout(this.maxDurationTimer)
        this.maxDurationTimer = null
      }
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer)
        this.silenceTimer = null
      }

      // 合并音频数据
      const audioBuffer = Buffer.concat(this.audioChunks)
      const duration = (Date.now() - this.recordingStartTime) / 1000

      this.status.isRecording = false
      this.status.isListening = false
      this.status.recordingDuration = duration

      this.emitEvent({ type: 'recording-stopped', duration })
      this.sendToRenderer('voice:recording-stopped', { duration })

      // 录音时长太短（<0.5秒），可能是误触发
      if (audioBuffer.length < 8000 || duration < 0.5) {
        return { success: true, transcript: '' }
      }

      // 自动转录
      const result = await this.transcribe(audioBuffer)
      if (result.success && result.text) {
        this.status.lastTranscript = result.text
        this.emitEvent({ type: 'transcription-result', text: result.text, confidence: result.confidence })
        this.sendToRenderer('voice:transcription', { text: result.text, confidence: result.confidence })
        return { success: true, transcript: result.text }
      } else {
        const errorMsg = result.text || '转录失败'
        this.emitEvent({ type: 'transcription-error', error: errorMsg })
        this.sendToRenderer('voice:transcription-error', { error: errorMsg })
        return { success: true, transcript: null }
      }
    } catch (err: any) {
      this.stopRecordingCleanup()
      return { success: false, transcript: null }
    }
  }

  /** 录音自动结束回调（由静音检测触发） */
  private handleRecordingEnd(): void {
    if (!this.status.isRecording) return

    const audioBuffer = Buffer.concat(this.audioChunks)
    const duration = (Date.now() - this.recordingStartTime) / 1000

    this.status.isRecording = false
    this.status.isListening = false
    this.status.recordingDuration = duration

    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer)
      this.maxDurationTimer = null
    }

    this.emitEvent({ type: 'recording-stopped', duration })
    this.sendToRenderer('voice:recording-stopped', { duration })

    // 录音太短则忽略
    if (audioBuffer.length < 8000 || duration < 0.5) {
      this.sendToRenderer('voice:transcription', { text: '', confidence: 0 })
      return
    }

    // 异步转录
    this.transcribe(audioBuffer).then(result => {
      if (result.success && result.text) {
        this.status.lastTranscript = result.text
        this.emitEvent({ type: 'transcription-result', text: result.text, confidence: result.confidence })
        this.sendToRenderer('voice:transcription', { text: result.text, confidence: result.confidence })
      } else {
        this.emitEvent({ type: 'transcription-error', error: '转录失败' })
        this.sendToRenderer('voice:transcription-error', { error: '转录失败' })
      }
    }).catch(err => {
      console.error('[VoiceService] 转录异常:', err)
      this.sendToRenderer('voice:transcription-error', { error: err.message })
    })
  }

  /** 清理录音状态 */
  private stopRecordingCleanup(): void {
    this.status.isRecording = false
    this.status.isListening = false
    if (this.micRecorder) {
      try { this.micRecorder.stop() } catch { /* ignore */ }
      this.micRecorder = null
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer)
      this.maxDurationTimer = null
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer)
      this.silenceTimer = null
    }
    this.audioChunks = []
  }

  /** 检测当前平台可用的录音后端 */
  private detectRecorder(): string {
    const platform = process.platform
    if (platform === 'win32') return 'sox'        // Windows 需要 sox
    if (platform === 'darwin') return 'sox'        // macOS 用 sox（rec 命令）
    return 'arecord'                                // Linux 用 arecord
  }

  // ─── 语音合成（播报）──────────────────────────────────

  /** 语音合成（播报） */
  async speak(text: string): Promise<{ success: boolean; message: string }> {
    if (this.status.isSpeaking) return { success: false, message: '正在播报中，请等待' }
    if (!text.trim()) return { success: false, message: '文本为空' }

    this.status.isSpeaking = true
    this.emitEvent({ type: 'speaking-started', text })
    this.sendToRenderer('voice:speaking-started', { text })

    try {
      const platform = process.platform
      const rate = this.config.speechRate

      if (platform === 'darwin') {
        // macOS: say 命令，支持中文（Ting-Ting）和英文
        const voice = this.config.language === 'zh-CN' ? 'Ting-Ting' : 'Samantha'
        const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`')
        await execAsync(`say -v ${voice} -r ${Math.round(rate * 200)} "${escaped}"`, { timeout: 60000 })
      } else if (platform === 'win32') {
        // Windows: PowerShell SAPI，支持中文（Huihui）和英文（Zira）
        const voice = this.config.language === 'zh-CN' ? 'Microsoft Huihui Desktop' : 'Microsoft Zira Desktop'
        const escaped = text.replace(/'/g, "''").replace(/"/g, '""')
        const psCmd = `
          Add-Type -AssemblyName System.Speech
          $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
          $synth.Rate = ${Math.round((rate - 1) * 5)}
          try { $synth.SelectVoice('${voice}') } catch {}
          $synth.Speak('${escaped}')
        `.trim()
        await execAsync(`powershell -Command "${psCmd.replace(/"/g, '\\"')}"`, { timeout: 60000 })
      } else {
        // Linux: espeak-ng 优先，回退 espeak
        const lang = this.config.language === 'zh-CN' ? 'zh' : 'en'
        const espeakCmd = `espeak-ng -v ${lang} -s ${Math.round(rate * 175)} "${text.replace(/"/g, '\\"')}" 2>/dev/null || espeak -v ${lang} -s ${Math.round(rate * 175)} "${text.replace(/"/g, '\\"')}"`
        await execAsync(espeakCmd, { timeout: 60000 })
      }

      this.addHistory('output', text)
      this.status.isSpeaking = false
      this.emitEvent({ type: 'speaking-completed' })
      this.sendToRenderer('voice:speaking-completed', {})
      return { success: true, message: '播报完成' }
    } catch (err: any) {
      this.status.isSpeaking = false
      const errorMsg = `播报失败: ${err.message}`
      this.status.error = errorMsg
      return { success: false, message: errorMsg }
    }
  }

  // ─── 转录 ─────────────────────────────────────────────

  /** 转录音频 Buffer */
  async transcribe(audioData: Buffer): Promise<{ success: boolean; text: string; confidence: number }> {
    // Whisper API 模式
    if (this.config.transcriptionProvider === 'whisper-api' && this.config.whisperApiKey) {
      return this.transcribeWithWhisper(audioData)
    }

    // 本地模式：检测本地 Whisper CLI
    return this.transcribeWithLocalWhisper(audioData)
  }

  /** 使用 Whisper API 转录 */
  private async transcribeWithWhisper(audioData: Buffer): Promise<{ success: boolean; text: string; confidence: number }> {
    try {
      const apiUrl = this.config.whisperApiUrl || 'https://api.openai.com/v1/audio/transcriptions'

      // 构建 multipart/form-data
      const boundary = `----FormBoundary${randomUUID().replace(/-/g, '')}`
      const langCode = this.config.language.split('-')[0] // zh-CN → zh
      const model = this.config.whisperModel || 'whisper-1'

      // 构建 form-data body
      const parts: Buffer[] = []

      // model 字段
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
      ))

      // language 字段
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${langCode}\r\n`
      ))

      // response_format 字段
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
      ))

      // file 字段（音频数据）
      const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      parts.push(Buffer.from(fileHeader))
      parts.push(audioData)
      parts.push(Buffer.from('\r\n'))

      // 结束标记
      parts.push(Buffer.from(`--${boundary}--\r\n`))

      const body = Buffer.concat(parts)

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.whisperApiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any
        throw new Error(errorData.error?.message || `API error: ${response.status}`)
      }

      const data = await response.json() as any
      const transcript = data.text || ''

      if (transcript) {
        this.addHistory('input', transcript, 0.9, data.duration)
      }

      return {
        success: true,
        text: transcript,
        confidence: data.segments ? this.calculateConfidence(data.segments) : 0.9,
      }
    } catch (err: any) {
      console.error('[VoiceService] Whisper API error:', err)
      return { success: false, text: err.message, confidence: 0 }
    }
  }

  /** 使用本地 Whisper CLI 转录 */
  private async transcribeWithLocalWhisper(audioData: Buffer): Promise<{ success: boolean; text: string; confidence: number }> {
    const { tmpdir } = require('os')
    const { join } = require('path')
    const { writeFileSync, unlinkSync } = require('fs')

    const tmpPath = join(tmpdir(), `voice-${Date.now()}.wav`)

    try {
      // 写入临时文件
      writeFileSync(tmpPath, audioData)

      // 尝试 whisper CLI（Python whisper 包）
      const langCode = this.config.language.split('-')[0]
      const { stdout } = await execAsync(
        `whisper "${tmpPath}" --language ${langCode} --model base --output_format txt --output_dir "${tmpdir()}" 2>&1`,
        { timeout: 120000 }
      )

      // 读取转录结果文件
      const txtPath = tmpPath.replace('.wav', '.txt')
      const { readFileSync } = require('fs')
      let transcript = ''
      try {
        transcript = readFileSync(txtPath, 'utf-8').trim()
        // 清理 whisper 输出格式：去除 [时间戳] 标记
        transcript = transcript.replace(/\[\d+:\d+:\d+\.\d+\s*-->\s*\d+:\d+:\d+\.\d+\]\s*/g, '').trim()
        // 清理临时 txt 文件
        try { unlinkSync(txtPath) } catch { /* ignore */ }
      } catch {
        // 如果 txt 文件不存在，尝试从 stdout 解析
        const match = stdout.match(/Transcribing.*?\n([\s\S]*?)(?:\n\n|$)/)
        transcript = match ? match[1].trim() : ''
      }

      if (transcript) {
        this.addHistory('input', transcript, 0.8)
      }

      return { success: true, text: transcript, confidence: 0.8 }
    } catch (err: any) {
      // 本地 whisper 未安装
      const msg = err.message || ''
      if (msg.includes('not found') || msg.includes('不是') || msg.includes('command not found')) {
        return {
          success: false,
          text: '本地 Whisper 未安装。请执行 pip install openai-whisper 或在设置中配置 Whisper API Key',
          confidence: 0,
        }
      }
      return { success: false, text: `本地转录失败: ${msg}`, confidence: 0 }
    } finally {
      // 清理临时 wav 文件
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
    }
  }

  /** 从 segments 计算平均置信度 */
  private calculateConfidence(segments: Array<{ avg_logprob?: number }>): number {
    if (!segments || segments.length === 0) return 0.9
    const avgLogprob = segments.reduce((sum, s) => sum + (s.avg_logprob || 0), 0) / segments.length
    // logprob → 概率：e^avgLogprob，clamp 到 0-1
    return Math.min(1, Math.max(0, Math.exp(avgLogprob)))
  }

  // ─── 状态 & 配置 ──────────────────────────────────────

  /** 获取状态 */
  getStatus(): { success: boolean; status: VoiceStatus } {
    // 更新录音时长
    if (this.status.isRecording) {
      this.status.recordingDuration = Math.round((Date.now() - this.recordingStartTime) / 1000 * 10) / 10
    }
    return { success: true, status: { ...this.status } }
  }

  /** 获取配置 */
  getConfig(): { success: boolean; config: VoiceConfig } {
    return { success: true, config: { ...this.config } }
  }

  /** 更新配置 */
  updateConfig(updates: Partial<VoiceConfig>): { success: boolean; config: VoiceConfig } {
    // 验证配置值
    if (updates.speechRate !== undefined) {
      updates.speechRate = Math.max(0.5, Math.min(2.0, updates.speechRate))
    }
    if (updates.silenceThreshold !== undefined) {
      updates.silenceThreshold = Math.max(1, Math.min(10, updates.silenceThreshold))
    }
    if (updates.maxRecordingDuration !== undefined) {
      updates.maxRecordingDuration = Math.max(5, Math.min(300, updates.maxRecordingDuration))
    }
    Object.assign(this.config, updates)
    return { success: true, config: { ...this.config } }
  }

  /** 获取历史记录 */
  getHistory(limit = 50): { success: boolean; history: VoiceHistoryEntry[] } {
    return { success: true, history: this.history.slice(-limit) }
  }

  /** 清除历史 */
  clearHistory(): { success: boolean; message: string } {
    this.history = []
    return { success: true, message: '历史已清除' }
  }

  /** 模拟语音输入（用于测试/调试） */
  simulateInput(text: string): { success: boolean; message: string } {
    this.status.lastTranscript = text
    this.addHistory('input', text)
    this.emitEvent({ type: 'transcription-result', text, confidence: 1.0 })
    this.sendToRenderer('voice:transcription', { text, confidence: 1.0 })
    return { success: true, message: '语音输入已记录' }
  }

  /** 检查录音依赖是否可用 */
  checkDependencies(): { recording: boolean; localWhisper: boolean; sox: boolean; message: string } {
    const hasRecording = !!recording
    // 这些检查是异步的，此处只报告录音库
    return {
      recording: hasRecording,
      localWhisper: false,  // 需要异步检查
      sox: false,            // 需要异步检查
      message: hasRecording
        ? '录音模块已就绪'
        : 'node-record-lpcm16 未安装，录音功能不可用',
    }
  }

  /** 异步检查系统依赖 */
  async checkSystemDependencies(): Promise<{
    recording: boolean
    sox: boolean
    localWhisper: boolean
    messages: string[]
  }> {
    const messages: string[] = []
    const hasRecording = !!recording

    // 检查 sox（Windows/macOS 录音需要）
    let hasSox = false
    try {
      if (process.platform === 'win32') {
        await execAsync('sox --version', { timeout: 5000 })
        hasSox = true
      } else if (process.platform === 'darwin') {
        await execAsync('rec --version', { timeout: 5000 })
        hasSox = true
      } else {
        // Linux 检查 arecord
        await execAsync('arecord --version', { timeout: 5000 })
        hasSox = true
      }
    } catch {
      if (process.platform === 'win32') {
        messages.push('未检测到 SoX，Windows 录音需要安装 SoX: https://sourceforge.net/projects/sox/')
      } else if (process.platform === 'darwin') {
        messages.push('未检测到 SoX，macOS 录音需要安装: brew install sox')
      } else {
        messages.push('未检测到 arecord，Linux 录音需要安装: sudo apt install alsa-utils')
      }
    }

    // 检查本地 whisper
    let hasLocalWhisper = false
    try {
      await execAsync('whisper --help', { timeout: 5000 })
      hasLocalWhisper = true
    } catch {
      // 不强制要求
    }

    if (!hasRecording) {
      messages.push('node-record-lpcm16 未安装，录音功能不可用')
    }
    if (!hasLocalWhisper && this.config.transcriptionProvider === 'local') {
      messages.push('本地 Whisper 未安装，建议执行 pip install openai-whisper 或配置 Whisper API Key')
    }

    return {
      recording: hasRecording,
      sox: hasSox,
      localWhisper: hasLocalWhisper,
      messages,
    }
  }

  /** 取消当前操作 */
  cancel(): { success: boolean; message: string } {
    if (this.status.isRecording) {
      this.stopRecordingCleanup()
      return { success: true, message: '录音已取消' }
    }
    if (this.status.isSpeaking) {
      // 尝试终止播报进程
      this.status.isSpeaking = false
      try {
        if (process.platform === 'win32') {
          exec('powershell -Command "Stop-Process -Name SAPI*" 2>nul')
        } else {
          exec('pkill -f "say\\|espeak\\|espeak-ng" 2>/dev/null')
        }
      } catch { /* ignore */ }
      return { success: true, message: '播报已取消' }
    }
    return { success: false, message: '无进行中的操作' }
  }

  // ─── 内部工具方法 ──────────────────────────────────────

  private addHistory(type: 'input' | 'output', text: string, confidence?: number, duration?: number): void {
    this.history.push({
      id: `vh-${++this.idCounter}`,
      timestamp: new Date().toISOString(),
      type,
      text,
      confidence,
      duration,
    })
    // 保留最近 200 条
    if (this.history.length > 200) {
      this.history = this.history.slice(-200)
    }
  }

  private emitEvent(event: VoiceEvent): void {
    this.emit('voice-event', event)
  }

  private sendToRenderer(channel: string, data: any): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }
}
