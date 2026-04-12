/**
 * 项目级知识库服务 - 持久化项目上下文，新会话自动注入
 * 支持：CRUD 知识条目、搜索、自动从代码提取知识、新会话自动注入
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import fs from 'fs'
import path from 'path'

export interface KnowledgeEntry {
  id: string
  projectPath: string
  category: 'architecture' | 'tech-stack' | 'convention' | 'api' | 'decision' | 'custom'
  title: string
  content: string
  tags: string[]
  priority: 'high' | 'medium' | 'low'
  autoInject: boolean  // 是否在新会话中自动注入
  source: 'manual' | 'auto-extract' | 'ai-generated'
  createdAt: string
  updatedAt: string
}

export interface ProjectKnowledge {
  projectPath: string
  projectName: string
  description: string
  entries: KnowledgeEntry[]
  updatedAt: string
}

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
    return {
      id: row.id,
      projectPath: row.project_path,
      category: row.category,
      title: row.title,
      content: row.content,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []),
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
  async list(projectPath: string): Promise<{ success: boolean; entries: KnowledgeEntry[] }> {
    try {
      const rows = this.rawDb.prepare(`
        SELECT * FROM project_knowledge WHERE project_path = ? ORDER BY priority DESC, updated_at DESC
      `).all(projectPath) as any[]
      return { success: true, entries: rows.map(r => this.mapRow(r)) }
    } catch {
      return { success: true, entries: [] }
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
        const existing = await this.search(projectPath, 'README 摘要')
        if (existing.entries.length === 0) {
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
          const existing = await this.search(projectPath, '技术栈')
          if (existing.entries.length === 0 && allDeps.length > 0) {
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
          const existing = await this.search(projectPath, 'TypeScript 配置')
          if (existing.entries.length === 0) {
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
        const existing = await this.search(projectPath, '环境变量')
        if (existing.entries.length === 0) {
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
        const existing = await this.search(projectPath, '项目结构')
        if (existing.entries.length === 0 && dirs.length > 0) {
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
        const basename = path.basename(aiConfigPath)
        const existing = await this.search(projectPath, basename)
        if (existing.entries.length === 0) {
          await this.createEntry({
            projectPath, category: 'convention', title: `AI 配置 (${basename})`,
            content, tags: ['ai-config', 'auto'], priority: 'high', autoInject: true, source: 'auto-extract',
          })
          count++; extracted.push(`AI 配置 (${basename})`)
        }
      }

    } catch (err) {
      console.error('[KnowledgeService] autoExtract failed:', err)
    }

    return { success: true, count, extracted }
  }
}
