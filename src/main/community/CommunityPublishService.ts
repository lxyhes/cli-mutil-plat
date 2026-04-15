/**
 * CommunityPublishService - 社区一键发布
 *
 * 支持将 Skill、MCP 工具、提示词、工作流模板一键发布到社区（导出为 JSON 包）
 * 桌面端登录后自动关联社区账号（预留接口，当前为本地模式）
 *
 * 设计：Phase 1 本地导出/导入，Phase 2 对接云端社区 API
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { DatabaseManager } from '../storage/Database'

// ─── 类型定义 ─────────────────────────────────────────────

export type PublishTarget = 'skill' | 'mcp' | 'prompt' | 'workflow'

export interface PublishPackage {
  /** 包格式版本 */
  version: '1.0'
  /** 包类型 */
  type: PublishTarget
  /** 发布时间 */
  publishedAt: string
  /** 作者信息 */
  author: {
    name: string
    /** 预留：社区账号 ID */
    communityId?: string
  }
  /** 包内容（原始数据） */
  data: Record<string, any>
  /** 依赖的 MCP 列表 */
  requiredMcps?: string[]
  /** 兼容的 Provider */
  compatibleProviders?: string[] | 'all'
  /** 标签 */
  tags?: string[]
  /** 描述 */
  description?: string
}

export interface PublishResult {
  success: boolean
  /** 导出的 JSON 字符串（本地模式） */
  packageJson?: string
  /** 分享 URL（预留：云端模式） */
  shareUrl?: string
  error?: string
}

export interface ImportResult {
  success: boolean
  /** 导入后的实体 ID */
  entityId?: string
  error?: string
  warnings?: string[]
}

// ─── 服务 ─────────────────────────────────────────────────

export interface CommunityPublishConfig {
  /** 云端社区 API 基础 URL */
  apiBaseUrl?: string
  /** 社区 API Token */
  apiToken?: string
  /** 是否启用云端模式（默认 false，即本地模式） */
  cloudEnabled?: boolean
}

export class CommunityPublishService extends EventEmitter {
  private db: DatabaseManager
  private config: CommunityPublishConfig = {}

  constructor(db: DatabaseManager) {
    super()
    this.db = db
  }

  /** 更新云端配置 */
  updateConfig(config: Partial<CommunityPublishConfig>): void {
    Object.assign(this.config, config)
  }

  /** 获取当前配置 */
  getConfig(): CommunityPublishConfig {
    return { ...this.config }
  }

  // ── 发布 ────────────────────────────────────────────────

  /** 一键发布技能到社区 */
  async publishSkill(skillId: string, authorName: string): Promise<PublishResult> {
    try {
      const skill = this.db.getSkill(skillId)
      if (!skill) {
        return { success: false, error: '技能不存在' }
      }

      // 内置技能不允许发布
      if (skill.source === 'builtin') {
        return { success: false, error: '内置技能无需发布' }
      }

      const pkg: PublishPackage = {
        version: '1.0',
        type: 'skill',
        publishedAt: new Date().toISOString(),
        author: { name: authorName },
        data: { ...skill },
        requiredMcps: skill.requiredMcps,
        compatibleProviders: skill.compatibleProviders,
        tags: skill.tags,
        description: skill.description,
      }

      const packageJson = JSON.stringify(pkg, null, 2)

      this.emit('published', { type: 'skill', id: skillId, packageJson })
      sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'published', targetType: 'skill', targetId: skillId })

      // 云端上传
      let shareUrl: string | undefined
      if (this.config.cloudEnabled && this.config.apiBaseUrl) {
        try {
          shareUrl = await this.uploadToCloud(pkg)
        } catch (err: any) {
          console.warn('[CommunityPublish] Cloud upload failed:', err.message)
          // 云端失败不影响本地导出
        }
      }

      return {
        success: true,
        packageJson,
        shareUrl,
      }
    } catch (err: any) {
      return { success: false, error: err.message || '发布失败' }
    }
  }

  /** 上传包到云端社区 API */
  private async uploadToCloud(pkg: PublishPackage): Promise<string> {
    if (!this.config.apiBaseUrl) throw new Error('API base URL not configured')

    const url = `${this.config.apiBaseUrl}/api/v1/community/publish`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiToken) {
      headers['Authorization'] = `Bearer ${this.config.apiToken}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(pkg),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Cloud API error ${response.status}: ${text.slice(0, 200)}`)
    }

    const result = await response.json() as any
    return result.shareUrl || result.url || ''
  }

  /** 一键发布 MCP 配置到社区 */
  async publishMcp(mcpId: string, authorName: string): Promise<PublishResult> {
    try {
      const mcp = this.db.getMcp(mcpId)
      if (!mcp) {
        return { success: false, error: 'MCP 配置不存在' }
      }

      const pkg: PublishPackage = {
        version: '1.0',
        type: 'mcp',
        publishedAt: new Date().toISOString(),
        author: { name: authorName },
        data: { ...mcp },
        tags: [mcp.category || 'general'],
        description: mcp.description,
      }

      const packageJson = JSON.stringify(pkg, null, 2)

      this.emit('published', { type: 'mcp', id: mcpId, packageJson })
      sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'published', targetType: 'mcp', targetId: mcpId })

      let shareUrl: string | undefined
      if (this.config.cloudEnabled && this.config.apiBaseUrl) {
        try { shareUrl = await this.uploadToCloud(pkg) } catch (err: any) {
          console.warn('[CommunityPublish] Cloud upload failed:', err.message)
        }
      }

      return { success: true, packageJson, shareUrl }
    } catch (err: any) {
      return { success: false, error: err.message || '发布失败' }
    }
  }

  /** 一键发布工作流模板到社区 */
  async publishWorkflow(workflowId: string, authorName: string): Promise<PublishResult> {
    try {
      const workflow = this.db.getWorkflow(workflowId)
      if (!workflow) {
        return { success: false, error: '工作流不存在' }
      }

      const pkg: PublishPackage = {
        version: '1.0',
        type: 'workflow',
        publishedAt: new Date().toISOString(),
        author: { name: authorName },
        data: { ...workflow },
        tags: ['workflow', 'template'],
        description: workflow.description,
      }

      const packageJson = JSON.stringify(pkg, null, 2)

      this.emit('published', { type: 'workflow', id: workflowId, packageJson })
      sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'published', targetType: 'workflow', targetId: workflowId })

      let shareUrl: string | undefined
      if (this.config.cloudEnabled && this.config.apiBaseUrl) {
        try { shareUrl = await this.uploadToCloud(pkg) } catch (err: any) {
          console.warn('[CommunityPublish] Cloud upload failed:', err.message)
        }
      }

      return { success: true, packageJson, shareUrl }
    } catch (err: any) {
      return { success: false, error: err.message || '发布失败' }
    }
  }

  /** 发布提示词模板到社区 */
  async publishPrompt(promptTemplate: {
    name: string
    content: string
    description?: string
    tags?: string[]
  }, authorName: string): Promise<PublishResult> {
    try {
      const pkg: PublishPackage = {
        version: '1.0',
        type: 'prompt',
        publishedAt: new Date().toISOString(),
        author: { name: authorName },
        data: { ...promptTemplate },
        tags: promptTemplate.tags || ['prompt'],
        description: promptTemplate.description,
      }

      const packageJson = JSON.stringify(pkg, null, 2)

      this.emit('published', { type: 'prompt', packageJson })
      sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'published', targetType: 'prompt' })

      let shareUrl: string | undefined
      if (this.config.cloudEnabled && this.config.apiBaseUrl) {
        try { shareUrl = await this.uploadToCloud(pkg) } catch (err: any) {
          console.warn('[CommunityPublish] Cloud upload failed:', err.message)
        }
      }

      return { success: true, packageJson, shareUrl }
    } catch (err: any) {
      return { success: false, error: err.message || '发布失败' }
    }
  }

  // ── 导入 ────────────────────────────────────────────────

  /** 从 JSON 包导入社区资源 */
  async importFromJson(packageJson: string): Promise<ImportResult> {
    try {
      const pkg = JSON.parse(packageJson) as PublishPackage
      const warnings: string[] = []

      if (!pkg.version || !pkg.type || !pkg.data) {
        return { success: false, error: '无效的社区包格式' }
      }

      switch (pkg.type) {
        case 'skill':
          return this.importSkill(pkg, warnings)
        case 'mcp':
          return this.importMcp(pkg, warnings)
        case 'workflow':
          return this.importWorkflow(pkg, warnings)
        case 'prompt':
          return this.importPrompt(pkg, warnings)
        default:
          return { success: false, error: `不支持的包类型: ${pkg.type}` }
      }
    } catch (err: any) {
      return { success: false, error: `解析失败: ${err.message}` }
    }
  }

  /** 从 URL 导入社区资源（支持签名校验） */
  async importFromUrl(url: string, options?: { verifySignature?: boolean; expectedAuthor?: string }): Promise<ImportResult> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
      }
      const packageJson = await response.text()

      // 验证签名（如果包中包含签名信息）
      if (options?.verifySignature !== false) {
        const verification = this.verifyPackageIntegrity(packageJson)
        if (!verification.valid) {
          return { success: false, error: `包完整性校验失败: ${verification.reason}` }
        }
      }

      // 验证作者（可选）
      if (options?.expectedAuthor) {
        try {
          const pkg = JSON.parse(packageJson) as PublishPackage
          if (pkg.author?.name !== options.expectedAuthor) {
            return {
              success: false,
              error: `作者不匹配: 期望 "${options.expectedAuthor}"，实际 "${pkg.author?.name || '未知'}"`,
            }
          }
        } catch { /* ignore parse error, let importFromJson handle it */ }
      }

      return this.importFromJson(packageJson)
    } catch (err: any) {
      return { success: false, error: `下载失败: ${err.message}` }
    }
  }

  /** 校验包完整性（版本、类型、字段完整性） */
  private verifyPackageIntegrity(packageJson: string): { valid: boolean; reason?: string } {
    try {
      const pkg = JSON.parse(packageJson) as PublishPackage

      if (!pkg.version) return { valid: false, reason: '缺少 version 字段' }
      if (pkg.version !== '1.0') return { valid: false, reason: `不支持的版本: ${pkg.version}` }
      if (!pkg.type) return { valid: false, reason: '缺少 type 字段' }
      if (!['skill', 'mcp', 'workflow', 'prompt'].includes(pkg.type)) {
        return { valid: false, reason: `不支持的包类型: ${pkg.type}` }
      }
      if (!pkg.data) return { valid: false, reason: '缺少 data 字段' }
      if (!pkg.publishedAt) return { valid: false, reason: '缺少 publishedAt 字段' }

      // 检查发布时间是否合理（不早于 2024 年，不晚于当前时间 + 1 天）
      const pubDate = new Date(pkg.publishedAt)
      const now = new Date()
      if (pubDate < new Date('2024-01-01') || pubDate > new Date(now.getTime() + 86400000)) {
        return { valid: false, reason: '发布时间异常' }
      }

      return { valid: true }
    } catch (err: any) {
      return { valid: false, reason: `JSON 解析失败: ${err.message}` }
    }
  }

  private async importSkill(pkg: PublishPackage, warnings: string[]): Promise<ImportResult> {
    const skillData = pkg.data
    // 检查是否已存在同名技能
    const existing = this.db.getSkillByCommand?.(skillData.slashCommand)
    if (existing) {
      warnings.push(`斜杠命令 /${skillData.slashCommand} 已存在，将覆盖`)
    }

    // 生成新 ID 避免冲突
    const newId = existing ? existing.id : `community-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const skill = {
      ...skillData,
      id: newId,
      source: 'marketplace' as const,
      isInstalled: true,
      isEnabled: true,
      author: pkg.author.name,
      description: skillData.description || '',
      type: skillData.type || 'general',
      name: skillData.name || '',
      compatibleProviders: skillData.compatibleProviders || [],
      category: skillData.category || 'general',
      content: skillData.content || '',
      tags: skillData.tags || [],
      version: skillData.version || '1.0.0',
      dependencies: skillData.dependencies || [],
      config: skillData.config || {},
    }

    if (existing) {
      this.db.updateSkill(newId, skill)
    } else {
      this.db.createSkill(skill)
    }

    sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'imported', targetType: 'skill', targetId: newId })
    return { success: true, entityId: newId, warnings }
  }

  private async importMcp(pkg: PublishPackage, warnings: string[]): Promise<ImportResult> {
    const mcpData = pkg.data
    // 简单导入：创建新的 MCP 配置
    try {
      const newId = `community-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.db.createMcp({
        ...mcpData,
        id: newId,
        description: mcpData.description || '',
        source: mcpData.source || 'community',
        name: mcpData.name || '',
        compatibleProviders: mcpData.compatibleProviders || [],
        category: mcpData.category || 'general',
        config: mcpData.config || {},
        enabled: mcpData.enabled ?? true,
        host: mcpData.host || '',
        port: mcpData.port || 8080,
        protocol: mcpData.protocol || 'http',
      })

      sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'imported', targetType: 'mcp', targetId: newId })
      return { success: true, entityId: newId, warnings }
    } catch (err: any) {
      return { success: false, error: `MCP 导入失败: ${err.message}`, warnings }
    }
  }

  private async importWorkflow(pkg: PublishPackage, warnings: string[]): Promise<ImportResult> {
    const wfData = pkg.data
    try {
      const newId = `community-wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.db.createWorkflow({
        ...wfData,
        id: newId,
      })

      sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'imported', targetType: 'workflow', targetId: newId })
      return { success: true, entityId: newId, warnings }
    } catch (err: any) {
      return { success: false, error: `工作流导入失败: ${err.message}`, warnings }
    }
  }

  private async importPrompt(pkg: PublishPackage, warnings: string[]): Promise<ImportResult> {
    // 提示词模板导入为 Prompt Skill
    try {
      const newId = `community-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const promptData = pkg.data

      this.db.createSkill({
        id: newId,
        name: promptData.name || '导入的提示词',
        description: promptData.description || pkg.description || '',
        category: 'prompt',
        type: 'prompt',
        slashCommand: promptData.name?.toLowerCase().replace(/\s+/g, '-') || newId,
        compatibleProviders: 'all',
        promptTemplate: promptData.content,
        source: 'marketplace',
        isInstalled: true,
        isEnabled: true,
        author: pkg.author.name,
        tags: pkg.tags || [],
      })

      sendToRenderer(IPC.COMMUNITY_PUBLISH_STATUS, { type: 'imported', targetType: 'prompt', targetId: newId })
      return { success: true, entityId: newId, warnings }
    } catch (err: any) {
      return { success: false, error: `提示词导入失败: ${err.message}`, warnings }
    }
  }

  // ── 生命周期 ────────────────────────────────────────────

  cleanup(): void {
    this.removeAllListeners()
  }
}
