/**
 * SpectrAI API 统一访问层
 * 解决 window.spectrAI 未定义的竞态问题
 * @author weibin
 */

type SpectrAIAPI = typeof window.spectrAI

export class APIAccessor {
  private static instance: APIAccessor
  private api: SpectrAIAPI | null = null
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private isReady = false

  private constructor() {
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.waitForAPI()
  }

  static getInstance(): APIAccessor {
    if (!APIAccessor.instance) {
      APIAccessor.instance = new APIAccessor()
    }
    return APIAccessor.instance
  }

  private async waitForAPI(): Promise<void> {
    const MAX_RETRIES = 100 // 5秒超时（100 * 50ms）
    let retries = 0

    const check = () => {
      if (window.spectrAI) {
        this.api = window.spectrAI
        this.isReady = true
        this.resolveReady()
        console.log('[APIAccessor] SpectrAI API ready')
        return
      }

      retries++
      if (retries >= MAX_RETRIES) {
        const error = new Error(
          'SpectrAI API not available after 5 seconds. ' +
          'This may indicate a preload script loading issue.'
        )
        console.error('[APIAccessor]', error.message)
        console.error('[APIAccessor] Available window keys:', Object.keys(window).filter(k =>
          k.toLowerCase().includes('spectr') || k.toLowerCase().includes('electron')
        ))
        this.rejectReady(error)
        return
      }

      if (retries % 20 === 0) {
        console.log(`[APIAccessor] Waiting for SpectrAI API... (${retries}/${MAX_RETRIES})`)
      }

      setTimeout(check, 50)
    }

    check()
  }

  /**
   * 等待 API 就绪
   * @throws {Error} 如果 API 在超时时间内未就绪
   */
  async ready(): Promise<void> {
    return this.readyPromise
  }

  /**
   * 检查 API 是否已就绪（同步）
   */
  isAPIReady(): boolean {
    return this.isReady
  }

  /**
   * 安全地获取 API（如果未就绪则抛出错误）
   */
  private getAPI(): SpectrAIAPI {
    if (!this.api) {
      throw new Error('SpectrAI API not ready. Call await api.ready() first.')
    }
    return this.api
  }

  // ==================== Session API ====================
  get session() {
    return this.getAPI().session
  }

  // ==================== Task API ====================
  get task() {
    return this.getAPI().task
  }

  // ==================== Provider API ====================
  get provider() {
    return this.getAPI().provider
  }

  // ==================== Agent API ====================
  get agent() {
    return this.getAPI().agent
  }

  // ==================== Settings API ====================
  get settings() {
    return this.getAPI().settings
  }

  // ==================== Theme API ====================
  get theme() {
    return this.getAPI().theme
  }

  // ==================== Clipboard API ====================
  get clipboard() {
    return this.getAPI().clipboard
  }

  // ==================== File System API ====================
  get fs() {
    return this.getAPI().fs
  }

  // ==================== Log API ====================
  get log() {
    return this.getAPI().log
  }

  // ==================== App API ====================
  get app() {
    return this.getAPI().app
  }

  // ==================== Update API ====================
  get update() {
    return this.getAPI().update
  }

  // ==================== NVM API ====================
  get nvm() {
    return this.getAPI().nvm
  }

  // ==================== Search API ====================
  get search() {
    return this.getAPI().search
  }

  // ==================== Usage API ====================
  get usage() {
    return this.getAPI().usage
  }

  // ==================== Summary API ====================
  get summary() {
    return this.getAPI().summary
  }

  // ==================== Git API ====================
  get git() {
    return this.getAPI().git
  }

  // ==================== Worktree API ====================
  get worktree() {
    return this.getAPI().worktree
  }

  // ==================== Workspace API ====================
  get workspace() {
    return this.getAPI().workspace
  }

  // ==================== Shortcut API ====================
  get shortcut() {
    return this.getAPI().shortcut
  }

  // ==================== File Manager API ====================
  get fileManager() {
    return this.getAPI().fileManager
  }

  // ==================== MCP API ====================
  get mcp() {
    return this.getAPI().mcp
  }

  // ==================== Skill API ====================
  get skill() {
    return this.getAPI().skill
  }

  // ==================== Registry API ====================
  get registry() {
    return this.getAPI().registry
  }

  // ==================== Legacy API ====================
  get getUsageSummary() {
    return this.getAPI().getUsageSummary
  }
}

// 导出单例实例
export const api = APIAccessor.getInstance()

// 导出便捷函数
export const waitForAPI = () => api.ready()
export const isAPIReady = () => api.isAPIReady()
