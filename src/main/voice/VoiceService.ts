/**
 * 语音交互服务 - 语音输入指令、AI 语音播报
 * 支持：开始/停止监听、语音合成、转录
 * @author spectrai
 */
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface VoiceConfig {
  enabled: boolean
  language: string          // 'zh-CN' | 'en-US'
  autoSpeak: boolean       // AI 回复自动播报
  speechRate: number       // 0.5 - 2.0
  wakeWord: string         // 唤醒词
  transcriptionProvider: 'local' | 'whisper-api'
  whisperApiKey?: string
  whisperApiUrl?: string
}

export interface VoiceStatus {
  isListening: boolean
  isSpeaking: boolean
  lastTranscript: string | null
  error: string | null
}

export interface VoiceHistoryEntry {
  id: string
  timestamp: string
  type: 'input' | 'output'
  text: string
}

export class VoiceService {
  private config: VoiceConfig = {
    enabled: false,
    language: 'zh-CN',
    autoSpeak: false,
    speechRate: 1.0,
    wakeWord: '小 Spectr',
    transcriptionProvider: 'local',
  }
  private status: VoiceStatus = {
    isListening: false,
    isSpeaking: false,
    lastTranscript: null,
    error: null,
  }
  private history: VoiceHistoryEntry[] = []
  private idCounter = 0

  constructor() {}

  /** 开始监听 */
  async startListening(): Promise<{ success: boolean; message: string }> {
    if (this.status.isListening) return { success: false, message: '已在监听中' }
    this.status.isListening = true
    this.status.error = null
    return { success: true, message: '语音监听已开启，请说话...' }
  }

  /** 停止监听 */
  async stopListening(): Promise<{ success: boolean; transcript: string | null }> {
    if (!this.status.isListening) return { success: false, transcript: null }
    this.status.isListening = false
    // 模拟转录结果（实际接入 Whisper API 后替换）
    const simulatedText = this.status.lastTranscript || ''
    return { success: true, transcript: simulatedText }
  }

  /** 语音合成（播报） */
  async speak(text: string): Promise<{ success: boolean; message: string }> {
    if (this.status.isSpeaking) return { success: false, message: '正在播报中，请等待' }
    this.status.isSpeaking = true
    try {
      const platform = process.platform
      const rate = this.config.speechRate
      if (platform === 'darwin') {
        // macOS: say 命令支持 -r 速率参数
        const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`')
        await execAsync(`say -r ${Math.round(rate * 200)} "${escaped}"`)
      } else if (platform === 'win32') {
        // Windows: PowerShell SAPI
        const escaped = text.replace(/"/g, '""')
        await execAsync(`powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${escaped}')"`, { timeout: 30000 })
      } else {
        // Linux: espeak
        try {
          await execAsync(`espeak -v ${this.config.language === 'zh-CN' ? 'zh' : 'en'} -s ${Math.round(rate * 175)} "${text.replace(/"/g, '\\"')}"`, { timeout: 30000 })
        } catch {
          return { success: false, message: 'Linux 需要安装 espeak: sudo apt install espeak' }
        }
      }
      // 记录历史
      this.addHistory('output', text)
      this.status.isSpeaking = false
      return { success: true, message: '播报完成' }
    } catch (err: any) {
      this.status.isSpeaking = false
      return { success: false, message: `播报失败: ${err.message}` }
    }
  }

  /** 转录音频 */
  async transcribe(audioData: Buffer): Promise<{ success: boolean; text: string; confidence: number }> {
    // TODO: 接入 Whisper API
    if (this.config.transcriptionProvider === 'whisper-api' && this.config.whisperApiKey) {
      return { success: false, text: '', confidence: 0 }
    }
    // 本地模式暂不支持
    return { success: false, text: '', confidence: 0 }
  }

  /** 获取状态 */
  getStatus(): { success: boolean; status: VoiceStatus } {
    return { success: true, status: { ...this.status } }
  }

  /** 获取配置 */
  getConfig(): { success: boolean; config: VoiceConfig } {
    return { success: true, config: { ...this.config } }
  }

  /** 更新配置 */
  updateConfig(updates: Partial<VoiceConfig>): { success: boolean; config: VoiceConfig } {
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

  /** 模拟语音输入（用于测试） */
  simulateInput(text: string): { success: boolean; message: string } {
    this.status.lastTranscript = text
    this.addHistory('input', text)
    return { success: true, message: '语音输入已记录' }
  }

  private addHistory(type: 'input' | 'output', text: string) {
    this.history.push({
      id: `vh-${++this.idCounter}`,
      timestamp: new Date().toISOString(),
      type,
      text,
    })
    // 保留最近 200 条
    if (this.history.length > 200) {
      this.history = this.history.slice(-200)
    }
  }
}
