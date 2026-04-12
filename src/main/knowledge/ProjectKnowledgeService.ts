/**
 * 项目级知识库服务 - 持久化项目上下文，新会话自动注入
 * 支持：CRUD 知识条目、语义搜索、自动从代码提取知识
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'

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

export class ProjectKnowledgeService {
  private db: DatabaseManager

  constructor(db: DatabaseManager) { this.db = db }

  /** 创建知识条目 */
  async createEntry(params: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<KnowledgeEntry> {
    const entry: KnowledgeEntry = {
      ...params,
      id: uuid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.db.run(`
      INSERT INTO project_knowledge (id, project_path, category, title, content, tags, priority, auto_inject, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [entry.id, entry.projectPath, entry.category, entry.title, entry.content,
        JSON.stringify(entry.tags), entry.priority, entry.autoInject ? 1 : 0, entry.source,
        entry.createdAt, entry.updatedAt])
    return entry
  }

  /** 获取项目的所有知识条目 */
  async list(projectPath: string): Promise<KnowledgeEntry[]> {
    return this.db.all<KnowledgeEntry>(`
      SELECT * FROM project_knowledge WHERE project_path = ? ORDER BY priority DESC, updated_at DESC
    `, [projectPath]) || []
  }

  /** 获取单个条目 */
  async get(id: string): Promise<KnowledgeEntry | null> {
    return this.db.get<KnowledgeEntry>('SELECT * FROM project_knowledge WHERE id = ?', [id])
  }

  /** 更新条目 */
  async update(id: string, updates: Partial<KnowledgeEntry>): Promise<KnowledgeEntry | null> {
    const existing = await this.get(id)
    if (!existing) return null
    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() }
    this.db.run(`
      UPDATE project_knowledge SET category=?, title=?, content=?, tags=?, priority=?, auto_inject=?, source=?, updated_at=?
      WHERE id=?
    `, [merged.category, merged.title, merged.content, JSON.stringify(merged.tags),
        merged.priority, merged.autoInject ? 1 : 0, merged.source, merged.updatedAt, id])
    return merged
  }

  /** 删除条目 */
  async delete(id: string): Promise<void> {
    this.db.run('DELETE FROM project_knowledge WHERE id = ?', [id])
  }

  /** 搜索知识 */
  async search(projectPath: string, query: string, limit?: number): Promise<KnowledgeEntry[]> {
    const q = `%${query}%`
    return this.db.all<KnowledgeEntry>(`
      SELECT * FROM project_knowledge
      WHERE project_path = ? AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
      ORDER BY priority DESC LIMIT ?
    `, [projectPath, q, q, q, limit || 20]) || []
  }

  /** 获取自动注入的知识 Prompt */
  async getPrompt(projectPath: string): Promise<string> {
    const entries = await this.list(projectPath)
    const autoEntries = entries.filter(e => e.autoInject)
    if (autoEntries.length === 0) return ''

    const lines = autoEntries.map(e => `### ${e.title} [${e.category}]\n${e.content}`)
    return `[Project Knowledge]\n以下是项目 ${projectPath} 的关键知识，请在后续操作中参考：\n\n${lines.join('\n\n')}`
  }

  /** 自动从项目提取知识（README、package.json 等） */
  async autoExtract(projectPath: string): Promise<number> {
    let count = 0
    try {
      const fs = require('fs')
      const path = require('path')

      // Extract from README
      const readmePath = [path.join(projectPath, 'README.md'), path.join(projectPath, 'readme.md')].find(p => fs.existsSync(p))
      if (readmePath) {
        const content = fs.readFileSync(readmePath, 'utf-8').slice(0, 5000)
        const existing = await this.search(projectPath, 'README')
        if (existing.length === 0) {
          await this.createEntry({
            projectPath, category: 'architecture', title: 'README 摘要',
            content, tags: ['readme', 'auto'], priority: 'high', autoInject: true, source: 'auto-extract',
          })
          count++
        }
      }

      // Extract tech stack from package.json
      const pkgPath = path.join(projectPath, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        const deps = Object.keys(pkg.dependencies || {})
        const devDeps = Object.keys(pkg.devDependencies || {})
        const allDeps = [...deps, ...devDeps]
        const existing = await this.search(projectPath, '技术栈')
        if (existing.length === 0 && allDeps.length > 0) {
          await this.createEntry({
            projectPath, category: 'tech-stack', title: '技术栈',
            content: `项目名称: ${pkg.name || 'unknown'}\n描述: ${pkg.description || ''}\n依赖: ${allDeps.join(', ')}`,
            tags: ['tech-stack', 'auto'], priority: 'high', autoInject: true, source: 'auto-extract',
          })
          count++
        }
      }
    } catch { /* ignore */ }
    return count
  }
}
