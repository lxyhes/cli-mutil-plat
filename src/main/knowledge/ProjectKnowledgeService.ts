/**
 * 项目级知识库服务 - 持久化项目上下文，新会话自动注入
 * 支持：CRUD 知识条目、搜索、自动从代码提取知识、新会话自动注入
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import fs from 'fs'
import path from 'path'
import type { KnowledgeEntry, CreateKnowledgeEntryParams, UpdateKnowledgeEntryParams, ListKnowledgeOptions } from '../../shared/types'

const CATEGORIES = ['architecture', 'tech-stack', 'convention', 'api', 'decision', 'custom'] as const

export class ProjectKnowledgeService {
  private rawDb: any  // better-sqlite3 底层实例

  constructor(db: DatabaseManager) {
    this.rawDb = (db as any).db || db
    this.ensureTable()
  }

  /** 创建 project_knowledge 表 */
  private ensureTable(): void {
    try {
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS project_knowledge (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'custom',
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          priority TEXT NOT NULL DEFAULT 'medium',
          auto_inject INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
      `)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_project ON project_knowledge(project_path, priority DESC, updated_at DESC)`)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_auto_inject ON project_knowledge(project_path, auto_inject) WHERE auto_inject = 1`)
    } catch (err) {
      console.error('[KnowledgeService] ensureTable failed:', err)
    }
  }

  /** 行 → KnowledgeEntry 映射 */
  private mapRow(row: any): KnowledgeEntry {
    let tags: string[] = []
    if (typeof row.tags === 'string') {
      try {
        tags = JSON.parse(row.tags || '[]')
      } catch {
        tags = []
      }
    } else if (Array.isArray(row.tags)) {
      tags = row.tags
    }
    return {
      id: row.id,
      projectPath: row.project_path,
      category: row.category,
      title: row.title,
      content: row.content,
      tags,
      priority: row.priority,
      autoInject: !!row.auto_inject,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /** 创建知识条目 */
  async createEntry(params: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ success: boolean; entry: KnowledgeEntry }> {
    const entry: KnowledgeEntry = {
      ...params,
      id: uuid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    try {
      this.rawDb.prepare(`
        INSERT INTO project_knowledge (id, project_path, category, title, content, tags, priority, auto_inject, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id, entry.projectPath, entry.category, entry.title, entry.content,
        JSON.stringify(entry.tags), entry.priority, entry.autoInject ? 1 : 0, entry.source,
        entry.createdAt, entry.updatedAt
      )
      return { success: true, entry }
    } catch (err) {
      console.error('[KnowledgeService] createEntry failed:', err)
      return { success: false, entry }
    }
  }

  /** 获取项目的所有知识条目 */
  async list(projectPath: string, options?: { page?: number; pageSize?: number }): Promise<{ success: boolean; entries: KnowledgeEntry[]; total: number }> {
    try {
      const page = options?.page || 1
      const pageSize = options?.pageSize || 50
      const offset = (page - 1) * pageSize

      // 获取总数
      const countRow = this.rawDb.prepare(
        'SELECT COUNT(*) as total FROM project_knowledge WHERE project_path = ?'
      ).get(projectPath) as { total: number }

      const rows = this.rawDb.prepare(`
        SELECT * FROM project_knowledge WHERE project_path = ? ORDER BY priority DESC, updated_at DESC LIMIT ? OFFSET ?
      `).all(projectPath, pageSize, offset) as any[]

      return { success: true, entries: rows.map(r => this.mapRow(r)), total: countRow.total }
    } catch {
      return { success: true, entries: [], total: 0 }
    }
  }

  /** 获取单个条目 */
  async get(id: string): Promise<{ success: boolean; entry: KnowledgeEntry | null }> {
    try {
      const row = this.rawDb.prepare('SELECT * FROM project_knowledge WHERE id = ?').get(id) as any
      return { success: true, entry: row ? this.mapRow(row) : null }
    } catch {
      return { success: true, entry: null }
    }
  }

  /** 更新条目 */
  async update(id: string, updates: Partial<KnowledgeEntry>): Promise<{ success: boolean; entry: KnowledgeEntry | null }> {
    try {
      const existing = await this.get(id)
      if (!existing.entry) return { success: false, entry: null }
      const merged = { ...existing.entry, ...updates, updatedAt: new Date().toISOString() }
      this.rawDb.prepare(`
        UPDATE project_knowledge SET category=?, title=?, content=?, tags=?, priority=?, auto_inject=?, source=?, updated_at=?
        WHERE id=?
      `).run(
        merged.category, merged.title, merged.content, JSON.stringify(merged.tags),
        merged.priority, merged.autoInject ? 1 : 0, merged.source, merged.updatedAt, id
      )
      return { success: true, entry: merged }
    } catch (err) {
      console.error('[KnowledgeService] update failed:', err)
      return { success: false, entry: null }
    }
  }

  /** 删除条目 */
  async delete(id: string): Promise<{ success: boolean }> {
    try {
      this.rawDb.prepare('DELETE FROM project_knowledge WHERE id = ?').run(id)
      return { success: true }
    } catch {
      return { success: false }
    }
  }

  /** 批量删除 */
  async deleteBatch(ids: string[]): Promise<{ success: boolean; count: number }> {
    if (!ids.length) return { success: true, count: 0 }
    try {
      const placeholders = ids.map(() => '?').join(',')
      const result = this.rawDb.prepare(`DELETE FROM project_knowledge WHERE id IN (${placeholders})`).run(...ids)
      return { success: true, count: result.changes }
    } catch {
      return { success: false, count: 0 }
    }
  }

  /** 批量更新（修改分类或优先级） */
  async updateBatch(ids: string[], updates: { category?: string; priority?: string; autoInject?: boolean }): Promise<{ success: boolean; count: number }> {
    if (!ids.length) return { success: true, count: 0 }
    try {
      const fields: string[] = []
      const values: any[] = []

      if (updates.category !== undefined) {
        fields.push('category = ?')
        values.push(updates.category)
      }
      if (updates.priority !== undefined) {
        fields.push('priority = ?')
        values.push(updates.priority)
      }
      if (updates.autoInject !== undefined) {
        fields.push('auto_inject = ?')
        values.push(updates.autoInject ? 1 : 0)
      }

      if (fields.length === 0) return { success: true, count: 0 }

      fields.push('updated_at = ?')
      values.push(new Date().toISOString())

      const placeholders = ids.map(() => '?').join(',')
      const sql = `UPDATE project_knowledge SET ${fields.join(', ')} WHERE id IN (${placeholders})`
      const result = this.rawDb.prepare(sql).run(...values, ...ids)

      return { success: true, count: result.changes }
    } catch (err) {
      console.error('[KnowledgeService] updateBatch failed:', err)
      return { success: false, count: 0 }
    }
  }

  /** 搜索知识 */
  async search(projectPath: string, query: string, limit?: number): Promise<{ success: boolean; entries: KnowledgeEntry[] }> {
    try {
      const q = `%${query}%`
      const rows = this.rawDb.prepare(`
        SELECT * FROM project_knowledge
        WHERE project_path = ? AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
        ORDER BY priority DESC LIMIT ?
      `).all(projectPath, q, q, q, limit || 20) as any[]
      return { success: true, entries: rows.map(r => this.mapRow(r)) }
    } catch {
      return { success: true, entries: [] }
    }
  }

  /** 获取自动注入的知识 Prompt（新会话创建时调用） */
  async getPrompt(projectPath: string): Promise<{ success: boolean; prompt: string }> {
    try {
      const rows = this.rawDb.prepare(`
        SELECT * FROM project_knowledge WHERE project_path = ? AND auto_inject = 1 ORDER BY priority DESC
      `).all(projectPath) as any[]

      if (rows.length === 0) return { success: true, prompt: '' }

      const entries = rows.map(r => this.mapRow(r))
      const lines = entries.map(e => `### ${e.title} [${e.category}]\n${e.content}`)
      const prompt = `[Project Knowledge]\n以下是项目 ${projectPath} 的关键知识，请在后续操作中参考：\n\n${lines.join('\n\n')}`
      return { success: true, prompt }
    } catch {
      return { success: true, prompt: '' }
    }
  }

  /** 检查指定 title 是否已存在（精确匹配） */
  private async checkExistsByTitle(projectPath: string, title: string): Promise<boolean> {
    try {
      const row = this.rawDb.prepare(
        'SELECT id FROM project_knowledge WHERE project_path = ? AND title = ? LIMIT 1'
      ).get(projectPath, title)
      return !!row
    } catch {
      return false
    }
  }

  /** 自动从项目提取知识（README、package.json、tsconfig、.env.example 等） */
  async autoExtract(projectPath: string): Promise<{ success: boolean; count: number; extracted: string[] }> {
    let count = 0
    const extracted: string[] = []

    try {
      if (!fs.existsSync(projectPath)) return { success: false, count: 0, extracted: [] }

      // 1. Extract from README
      const readmePath = ['README.md', 'readme.md', 'README.MD'].map(f => path.join(projectPath, f)).find(p => fs.existsSync(p))
      if (readmePath) {
        const content = fs.readFileSync(readmePath, 'utf-8').slice(0, 5000)
        if (!(await this.checkExistsByTitle(projectPath, 'README 摘要'))) {
          await this.createEntry({
            projectPath, category: 'architecture', title: 'README 摘要',
            content, tags: ['readme', 'auto'], priority: 'high', autoInject: true, source: 'auto-extract',
          })
          count++; extracted.push('README 摘要')
        }
      }

      // 2. Extract tech stack from package.json
      const pkgPath = path.join(projectPath, 'package.json')
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
          const deps = Object.keys(pkg.dependencies || {})
          const devDeps = Object.keys(pkg.devDependencies || {})
          const allDeps = [...deps, ...devDeps]
          if (!(await this.checkExistsByTitle(projectPath, '技术栈')) && allDeps.length > 0) {
            await this.createEntry({
              projectPath, category: 'tech-stack', title: '技术栈',
              content: `项目名称: ${pkg.name || 'unknown'}\n版本: ${pkg.version || ''}\n描述: ${pkg.description || ''}\n依赖: ${deps.join(', ')}\n开发依赖: ${devDeps.join(', ')}`,
              tags: ['tech-stack', 'auto'], priority: 'high', autoInject: true, source: 'auto-extract',
            })
            count++; extracted.push('技术栈')
          }
        } catch { /* invalid json */ }
      }

      // 3. Extract from tsconfig.json
      const tsconfigPath = path.join(projectPath, 'tsconfig.json')
      if (fs.existsSync(tsconfigPath)) {
        try {
          const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8').replace(/\/\*.*?\*\//g, '').replace(/,\s*}/g, '}'))
          if (!(await this.checkExistsByTitle(projectPath, 'TypeScript 配置'))) {
            await this.createEntry({
              projectPath, category: 'convention', title: 'TypeScript 配置',
              content: `编译选项: ${JSON.stringify(tsconfig.compilerOptions || {}, null, 2)}\n包含: ${JSON.stringify(tsconfig.include || [])}\n排除: ${JSON.stringify(tsconfig.exclude || [])}`,
              tags: ['typescript', 'auto'], priority: 'medium', autoInject: true, source: 'auto-extract',
            })
            count++; extracted.push('TypeScript 配置')
          }
        } catch { /* invalid json */ }
      }

      // 4. Extract from .env.example
      const envPath = path.join(projectPath, '.env.example')
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8').slice(0, 3000)
        if (!(await this.checkExistsByTitle(projectPath, '环境变量'))) {
          await this.createEntry({
            projectPath, category: 'api', title: '环境变量',
            content: `项目需要以下环境变量：\n${content}`,
            tags: ['env', 'auto'], priority: 'high', autoInject: true, source: 'auto-extract',
          })
          count++; extracted.push('环境变量')
        }
      }

      // 5. Extract project structure (top-level dirs)
      try {
        const entries = fs.readdirSync(projectPath, { withFileTypes: true })
        const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'out').map(e => e.name)
        const files = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name)
        if (!(await this.checkExistsByTitle(projectPath, '项目结构')) && dirs.length > 0) {
          await this.createEntry({
            projectPath, category: 'architecture', title: '项目结构',
            content: `顶层目录: ${dirs.join(', ')}\n顶层文件: ${files.join(', ')}`,
            tags: ['structure', 'auto'], priority: 'medium', autoInject: true, source: 'auto-extract',
          })
          count++; extracted.push('项目结构')
        }
      } catch { /* permission error */ }

      // 6. Extract from AGENTS.md or CLAUDE.md (AI config files)
      const aiConfigPath = ['AGENTS.md', 'CLAUDE.md'].map(f => path.join(projectPath, f)).find(p => fs.existsSync(p))
      if (aiConfigPath) {
        const content = fs.readFileSync(aiConfigPath, 'utf-8').slice(0, 5000)
        const aiConfigTitle = `AI 配置 (${path.basename(aiConfigPath)})`
        if (!(await this.checkExistsByTitle(projectPath, aiConfigTitle))) {
          await this.createEntry({
            projectPath, category: 'convention', title: aiConfigTitle,
            content, tags: ['ai-config', 'auto'], priority: 'high', autoInject: true, source: 'auto-extract',
          })
          count++; extracted.push(aiConfigTitle)
        }
      }

    } catch (err) {
      console.error('[KnowledgeService] autoExtract failed:', err)
    }

    return { success: true, count, extracted }
  }

  /** 导出知识库为 JSON */
  async exportData(projectPath: string): Promise<{ success: boolean; data: any | null }> {
    try {
      const rows = this.rawDb.prepare(
        'SELECT * FROM project_knowledge WHERE project_path = ? ORDER BY priority DESC, updated_at DESC'
      ).all(projectPath) as any[]

      const entries = rows.map(r => this.mapRow(r))

      return {
        success: true,
        data: {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          projectPath,
          entries,
        },
      }
    } catch (err) {
      console.error('[KnowledgeService] exportData failed:', err)
      return { success: false, data: null }
    }
  }

  /** 导入知识库 JSON */
  async importData(projectPath: string, data: any): Promise<{ success: boolean; count: number }> {
    if (!data?.entries || !Array.isArray(data.entries)) {
      return { success: false, count: 0 }
    }

    let count = 0
    for (const entry of data.entries) {
      // 检查是否已存在同 title 的条目
      if (await this.checkExistsByTitle(projectPath, entry.title)) {
        continue
      }

      const result = await this.createEntry({
        projectPath,
        category: entry.category || 'custom',
        title: entry.title,
        content: entry.content || '',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        priority: entry.priority || 'medium',
        autoInject: entry.autoInject !== false,
        source: 'manual',
      })

      if (result.success) count++
    }

    return { success: true, count }
  }
}
