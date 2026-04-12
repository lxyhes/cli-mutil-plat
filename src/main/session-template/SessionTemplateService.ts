/**
 * SessionTemplateService - 会话模板
 *
 * 预设会话配置（代码审查、文档生成、Bug 修复等）
 * 一键创建带 System Prompt + MCP 配置 + Provider 选择的会话
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'
import type { DatabaseManager } from '../storage/Database'

// ─── 类型定义 ─────────────────────────────────────────────

export interface SessionTemplate {
  /** 唯一 ID */
  id: string
  /** 模板名称 */
  name: string
  /** 模板描述 */
  description: string
  /** 图标（emoji 或 icon name） */
  icon: string
  /** 分类标签 */
  category: TemplateCategory
  /** 默认 Provider ID */
  defaultProviderId: string
  /** 默认工作目录（空=使用当前项目） */
  defaultWorkingDir: string
  /** 系统提示词 */
  systemPrompt: string
  /** 初始消息（创建后自动发送） */
  initialPrompt: string
  /** MCP 服务器配置（名称列表，创建时自动关联） */
  mcpServers: string[]
  /** 是否启用 Agent 模式 */
  enableAgent: boolean
  /** 是否启用 Supervisor 模式 */
  supervisorMode: boolean
  /** 自定义环境变量 */
  envOverrides: Record<string, string>
  /** 排序权重 */
  sortOrder: number
  /** 是否内置（不可删除） */
  isBuiltin: boolean
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

export type TemplateCategory = 'coding' | 'review' | 'docs' | 'testing' | 'debug' | 'architecture' | 'custom'

// ─── 内置模板 ─────────────────────────────────────────────

const BUILTIN_TEMPLATES: SessionTemplate[] = [
  {
    id: 'builtin-code-review',
    name: '代码审查',
    description: '深入审查代码质量、安全性和最佳实践',
    icon: '🔍',
    category: 'review',
    defaultProviderId: 'claude-code',
    defaultWorkingDir: '',
    systemPrompt: '你是一个资深代码审查专家。请从以下维度审查代码：1. 代码质量和可读性 2. 潜在 Bug 和边界条件 3. 性能问题 4. 安全漏洞 5. 架构设计合理性。给出具体改进建议和代码示例。',
    initialPrompt: '请审查当前项目中的代码，重点关注最近修改的文件，给出改进建议。',
    mcpServers: [],
    enableAgent: false,
    supervisorMode: false,
    envOverrides: {},
    sortOrder: 1,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'builtin-doc-gen',
    name: '文档生成',
    description: '为项目生成 API 文档、README、注释等',
    icon: '📝',
    category: 'docs',
    defaultProviderId: 'claude-code',
    defaultWorkingDir: '',
    systemPrompt: '你是一个技术文档专家。请根据代码自动生成清晰、专业的文档。遵循以下原则：1. 使用 Markdown 格式 2. 包含代码示例 3. 说明参数和返回值 4. 提供使用场景说明。',
    initialPrompt: '请为当前项目生成文档，包括 API 文档和 README。',
    mcpServers: [],
    enableAgent: false,
    supervisorMode: false,
    envOverrides: {},
    sortOrder: 2,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'builtin-bug-fix',
    name: 'Bug 修复',
    description: '诊断和修复代码中的 Bug',
    icon: '🐛',
    category: 'debug',
    defaultProviderId: 'claude-code',
    defaultWorkingDir: '',
    systemPrompt: '你是一个 Bug 修复专家。请遵循以下流程：1. 复现问题 2. 定位根因 3. 提出修复方案 4. 实施修复 5. 验证修复。修复时保持最小改动原则，避免引入新问题。',
    initialPrompt: '请帮我分析并修复当前遇到的 Bug。',
    mcpServers: [],
    enableAgent: true,
    supervisorMode: false,
    envOverrides: {},
    sortOrder: 3,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'builtin-arch-design',
    name: '架构设计',
    description: '系统架构设计和技术选型',
    icon: '🏗️',
    category: 'architecture',
    defaultProviderId: 'claude-code',
    defaultWorkingDir: '',
    systemPrompt: '你是一个系统架构师。请从全局视角分析项目，给出架构设计建议：1. 模块划分 2. 接口设计 3. 数据流设计 4. 技术选型 5. 扩展性考虑。输出包含架构图描述和代码骨架。',
    initialPrompt: '请分析当前项目的架构，给出优化建议或新功能的设计方案。',
    mcpServers: [],
    enableAgent: true,
    supervisorMode: true,
    envOverrides: {},
    sortOrder: 4,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'builtin-test-gen',
    name: '测试生成',
    description: '为代码自动生成单元测试和集成测试',
    icon: '🧪',
    category: 'testing',
    defaultProviderId: 'claude-code',
    defaultWorkingDir: '',
    systemPrompt: '你是一个测试工程师。请为代码生成全面的测试用例：1. 单元测试（覆盖正常和异常路径）2. 边界条件测试 3. 集成测试 4. Mock 外部依赖。使用项目现有的测试框架。',
    initialPrompt: '请为当前项目的关键模块生成测试用例。',
    mcpServers: [],
    enableAgent: false,
    supervisorMode: false,
    envOverrides: {},
    sortOrder: 5,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'builtin-refactor',
    name: '代码重构',
    description: '重构代码提升质量和可维护性',
    icon: '♻️',
    category: 'coding',
    defaultProviderId: 'claude-code',
    defaultWorkingDir: '',
    systemPrompt: '你是一个代码重构专家。请遵循以下原则：1. 保持行为不变 2. 小步重构 3. 每步可验证 4. 优先消除重复代码 5. 改善命名和结构。每次重构后说明改动原因。',
    initialPrompt: '请分析当前项目的代码质量，找出需要重构的部分并实施改进。',
    mcpServers: [],
    enableAgent: false,
    supervisorMode: false,
    envOverrides: {},
    sortOrder: 6,
    isBuiltin: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

// ─── 服务 ─────────────────────────────────────────────────

export class SessionTemplateService extends EventEmitter {
  private templates: Map<string, SessionTemplate> = new Map()
  private sqliteDb: any = null

  constructor(db: DatabaseManager) {
    super()
    this.sqliteDb = (db as any).db || null
    this.ensureSchema()
    this.loadBuiltinTemplates()
    this.loadCustomTemplates()
  }

  // ── Schema ──────────────────────────────────────────────

  private ensureSchema(): void {
    if (!this.sqliteDb) return
    try {
      this.sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS session_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT DEFAULT '',
          icon TEXT DEFAULT '📋',
          category TEXT NOT NULL DEFAULT 'custom',
          default_provider_id TEXT DEFAULT 'claude-code',
          default_working_dir TEXT DEFAULT '',
          system_prompt TEXT DEFAULT '',
          initial_prompt TEXT DEFAULT '',
          mcp_servers TEXT DEFAULT '[]',
          enable_agent INTEGER DEFAULT 0,
          supervisor_mode INTEGER DEFAULT 0,
          env_overrides TEXT DEFAULT '{}',
          sort_order INTEGER DEFAULT 0,
          is_builtin INTEGER DEFAULT 0,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
    } catch (err) {
      console.warn('[SessionTemplate] Schema creation failed:', err)
    }
  }

  private loadBuiltinTemplates(): void {
    for (const tpl of BUILTIN_TEMPLATES) {
      this.templates.set(tpl.id, tpl)
    }
  }

  private loadCustomTemplates(): void {
    if (!this.sqliteDb) return
    try {
      const rows = this.sqliteDb.prepare('SELECT * FROM session_templates WHERE is_builtin = 0 ORDER BY sort_order').all() as any[]
      for (const row of rows) {
        this.templates.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          icon: row.icon,
          category: row.category,
          defaultProviderId: row.default_provider_id,
          defaultWorkingDir: row.default_working_dir,
          systemPrompt: row.system_prompt,
          initialPrompt: row.initial_prompt,
          mcpServers: JSON.parse(row.mcp_servers || '[]'),
          enableAgent: !!row.enable_agent,
          supervisorMode: !!row.supervisor_mode,
          envOverrides: JSON.parse(row.env_overrides || '{}'),
          sortOrder: row.sort_order,
          isBuiltin: !!row.is_builtin,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })
      }
    } catch (err) {
      console.warn('[SessionTemplate] Load custom templates failed:', err)
    }
  }

  // ── CRUD ────────────────────────────────────────────────

  /** 获取所有模板 */
  listTemplates(category?: TemplateCategory): SessionTemplate[] {
    const all = [...this.templates.values()]
    if (category) return all.filter(t => t.category === category)
    return all.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  /** 获取模板 */
  getTemplate(id: string): SessionTemplate | null {
    return this.templates.get(id) || null
  }

  /** 创建自定义模板 */
  createTemplate(data: Omit<SessionTemplate, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltin'>): SessionTemplate {
    const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    const template: SessionTemplate = {
      ...data,
      id,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now,
    }

    this.templates.set(id, template)
    this.persistTemplate(template)
    this.emitChange('template-created', template)
    return template
  }

  /** 更新模板 */
  updateTemplate(id: string, updates: Partial<SessionTemplate>): SessionTemplate | null {
    const existing = this.templates.get(id)
    if (!existing || existing.isBuiltin) return null

    const updated: SessionTemplate = {
      ...existing,
      ...updates,
      id: existing.id,  // 不允许修改 ID
      updatedAt: new Date().toISOString(),
    }

    this.templates.set(id, updated)
    this.persistTemplate(updated)
    this.emitChange('template-updated', updated)
    return updated
  }

  /** 删除模板 */
  deleteTemplate(id: string): boolean {
    const existing = this.templates.get(id)
    if (!existing || existing.isBuiltin) return false

    this.templates.delete(id)
    if (this.sqliteDb) {
      try {
        this.sqliteDb.prepare('DELETE FROM session_templates WHERE id = ?').run(id)
      } catch { /* ignore */ }
    }
    this.emitChange('template-deleted', id)
    return true
  }

  /** 获取分类列表 */
  getCategories(): { id: TemplateCategory; name: string; icon: string }[] {
    return [
      { id: 'coding', name: '编码', icon: '💻' },
      { id: 'review', name: '审查', icon: '🔍' },
      { id: 'docs', name: '文档', icon: '📝' },
      { id: 'testing', name: '测试', icon: '🧪' },
      { id: 'debug', name: '调试', icon: '🐛' },
      { id: 'architecture', name: '架构', icon: '🏗️' },
      { id: 'custom', name: '自定义', icon: '⭐' },
    ]
  }

  // ── Private ─────────────────────────────────────────────

  private persistTemplate(template: SessionTemplate): void {
    if (!this.sqliteDb) return
    try {
      this.sqliteDb.prepare(`
        INSERT OR REPLACE INTO session_templates (
          id, name, description, icon, category, default_provider_id,
          default_working_dir, system_prompt, initial_prompt, mcp_servers,
          enable_agent, supervisor_mode, env_overrides, sort_order,
          is_builtin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        template.id, template.name, template.description, template.icon,
        template.category, template.defaultProviderId, template.defaultWorkingDir,
        template.systemPrompt, template.initialPrompt,
        JSON.stringify(template.mcpServers),
        template.enableAgent ? 1 : 0, template.supervisorMode ? 1 : 0,
        JSON.stringify(template.envOverrides), template.sortOrder,
        template.isBuiltin ? 1 : 0, template.createdAt, template.updatedAt,
      )
    } catch (err) {
      console.warn('[SessionTemplate] Persist failed:', err)
    }
  }

  private emitChange(eventType: string, data: any): void {
    this.emit('template-changed', { type: eventType, data })
    try {
      sendToRenderer(IPC.SESSION_TEMPLATE_STATUS, { type: eventType, data })
    } catch { /* ignore */ }
  }

  cleanup(): void {
    this.templates.clear()
    this.removeAllListeners()
  }
}
