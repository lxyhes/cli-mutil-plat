/**
 * 参考项目服务 - 搜索 GitHub 公开项目，获取参考代码
 * 功能：搜索相似技术栈项目 → 浏览目录树 → 查看文件内容 → 保存到知识库
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'
import type { KnowledgeCategory } from '../../shared/types'

export interface GithubRepo {
  id: number
  name: string
  fullName: string
  description: string
  htmlUrl: string
  stars: number
  language: string
  topics: string[]
  updatedAt: string
}

export interface RepoFile {
  path: string
  type: 'file' | 'dir'
  size?: number
  sha: string
  downloadUrl?: string
}

export interface SavedReference {
  id: string
  projectPath: string
  repoFullName: string
  repoUrl: string
  filePath: string
  codeContent: string
  summary: string
  createdAt: string
}

export class ReferenceProjectService {
  private rawDb: any
  private githubToken: string | null = null

  constructor(db: DatabaseManager) {
    this.rawDb = (db as any).db || db
    this.ensureTable()
    this.loadGithubToken()
  }

  private ensureTable(): void {
    try {
      // 保存的参考项目引用记录
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS reference_projects (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          repo_full_name TEXT NOT NULL,
          repo_url TEXT NOT NULL,
          file_path TEXT NOT NULL,
          code_content TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
      `)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_ref_project ON reference_projects(project_path)`)
    } catch (err) {
      console.error('[ReferenceProjectService] ensureTable failed:', err)
    }
  }

  private loadGithubToken(): void {
    try {
      // 尝试从数据库 settings 获取 GitHub token
      const row = this.rawDb.prepare("SELECT value FROM app_settings WHERE key = 'github_token'").get() as any
      if (row?.value) {
        try {
          const settings = JSON.parse(row.value)
          this.githubToken = settings.token || null
        } catch {
          this.githubToken = row.value || null
        }
      }
    } catch {
      // ignore
    }
  }

  private async githubFetch(url: string): Promise<any> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SpectrAI-Desktop/1.0',
    }
    if (this.githubToken) {
      headers['Authorization'] = `Bearer ${this.githubToken}`
    }
    const res = await fetch(url, { headers })
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining')
      if (remaining === '0') {
        throw new Error('GitHub API rate limit exceeded. Please add a GitHub token in settings.')
      }
    }
    if (res.status === 429) {
      throw new Error('GitHub API rate limited. Please try again later.')
    }
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`)
    }
    return res.json()
  }

  /**
   * 搜索 GitHub 仓库
   * @param query 搜索关键词（如 "electron react vite", "claude code api", "multi-agent framework"）
   * @param language 可选：限定语言
   * @param limit 返回数量上限
   */
  async searchRepos(query: string, language?: string, limit = 10): Promise<{ success: boolean; repos: GithubRepo[]; error?: string }> {
    if (!query.trim()) return { success: true, repos: [] }

    try {
      // 构建搜索查询
      let searchQ = encodeURIComponent(query)
      if (language) searchQ += `+language:${encodeURIComponent(language)}`
      // 优先显示最近活跃、star 多的项目
      const url = `https://api.github.com/search/repositories?q=${searchQ}&sort=stars&order=desc&per_page=${Math.min(limit, 30)}`
      const data = await this.githubFetch(url)

      if (!data.items) return { success: true, repos: [] }

      const repos: GithubRepo[] = data.items.slice(0, limit).map((item: any) => ({
        id: item.id,
        name: item.name,
        fullName: item.full_name,
        description: item.description || '',
        htmlUrl: item.html_url,
        stars: item.stargazers_count,
        language: item.language || '',
        topics: (item.topics || []).slice(0, 8),
        updatedAt: item.pushed_at,
      }))

      return { success: true, repos }
    } catch (err: any) {
      console.error('[ReferenceProjectService] searchRepos failed:', err)
      return { success: false, repos: [], error: err.message }
    }
  }

  /**
   * 获取仓库默认分支（用于后续请求）
   */
  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    try {
      const data = await this.githubFetch(`https://api.github.com/repos/${owner}/${repo}`)
      return data.default_branch || 'main'
    } catch {
      return 'main'
    }
  }

  /**
   * 获取仓库目录树
   */
  async getRepoTree(owner: string, repo: string, branch?: string, path = ''): Promise<{ success: boolean; files: RepoFile[]; error?: string }> {
    try {
      const b = branch || await this.getDefaultBranch(owner, repo)
      // GitHub Contents API 获取目录
      const url = path
        ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${b}`
        : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${b}`
      const data = await this.githubFetch(url)
      const items: any[] = Array.isArray(data) ? data : [data]

      const files: RepoFile[] = items
        .filter((f: any) => !f.name.startsWith('.') || f.name === '.gitignore')
        .map((f: any) => ({
          path: f.path,
          type: (f.type === 'dir' ? 'dir' : 'file') as 'file' | 'dir',
          size: f.size,
          sha: f.sha,
          downloadUrl: f.download_url,
        }))
        .sort((a: RepoFile, b: RepoFile) => {
          // 目录在前，文件在后
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.path.localeCompare(b.path)
        })

      return { success: true, files }
    } catch (err: any) {
      return { success: false, files: [], error: err.message }
    }
  }

  /**
   * 获取文件原始内容
   */
  async getFileContent(owner: string, repo: string, filePath: string, branch?: string): Promise<{ success: boolean; content: string; error?: string }> {
    try {
      const b = branch || await this.getDefaultBranch(owner, repo)
      // 使用 raw.githubusercontent.com 获取原始内容（绕过 size limit）
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${filePath}`
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SpectrAI-Desktop/1.0',
          ...(this.githubToken ? { 'Authorization': `Bearer ${this.githubToken}` } : {}),
        },
      })
      if (!res.ok) {
        // 回退到 Contents API（支持大文件）
        const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${b}`
        const contents = await this.githubFetch(contentsUrl)
        if (contents.content) {
          const content = Buffer.from(contents.content, 'base64').toString('utf-8')
          return { success: true, content }
        }
        return { success: false, content: '', error: `Failed to fetch file: ${res.status}` }
      }
      const content = await res.text()
      // 限制内容大小（超过 500KB 不返回）
      if (content.length > 512 * 1024) {
        return { success: true, content: content.slice(0, 512 * 1024) + '\n\n// ... (内容过长已截断)' }
      }
      return { success: true, content }
    } catch (err: any) {
      return { success: false, content: '', error: err.message }
    }
  }

  /**
   * 检测文件语言（按扩展名）
   */
  detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const map: Record<string, string> = {
      ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
      py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin',
      cs: 'C#', cpp: 'C++', c: 'C', h: 'C/C++ Header',
      rb: 'Ruby', php: 'PHP', swift: 'Swift', md: 'Markdown',
      json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
      sh: 'Shell', bash: 'Bash', zsh: 'Zsh',
      css: 'CSS', scss: 'SCSS', less: 'Less', html: 'HTML', vue: 'Vue',
      sql: 'SQL', graphql: 'GraphQL', proto: 'Protocol Buffers',
    }
    return map[ext] || 'Text'
  }

  /**
   * 判断文件是否值得展示（代码文件，排除大文件、二进制等）
   */
  isViewableFile(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const skipExts = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'svg', 'pdf',
      'zip', 'tar', 'gz', 'rar', '7z',
      'exe', 'dll', 'so', 'dylib',
      'mp3', 'mp4', 'wav', 'avi', 'mov',
      'ttf', 'otf', 'woff', 'woff2', 'eot',
      'lock', 'sum',
    ])
    if (skipExts.has(ext)) return false
    const skipNames = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
      'bun.lockb', '.DS_Store', 'Thumbs.db']
    if (skipNames.includes(filePath.split('/').pop() || '')) return false
    return true
  }

  /**
   * 保存参考代码片段到项目知识库
   */
  saveToKnowledge(params: {
    projectPath: string
    repoFullName: string
    repoUrl: string
    filePath: string
    codeContent: string
    category?: KnowledgeCategory
    title?: string
  }): { success: boolean; knowledgeId?: string } {
    try {
      const id = uuid()
      // 直接写入 project_knowledge 表
      this.rawDb.prepare(`
        INSERT INTO project_knowledge (id, project_path, category, title, content, tags, priority, auto_inject, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.projectPath,
        params.category || 'custom',
        params.title || `[${params.repoFullName}] ${params.filePath}`,
        params.codeContent,
        JSON.stringify(['reference', params.repoFullName.split('/')[0], this.detectLanguage(params.filePath).toLowerCase()]),
        'medium',
        0,
        'manual',
        new Date().toISOString(),
        new Date().toISOString()
      )
      return { success: true, knowledgeId: id }
    } catch (err) {
      console.error('[ReferenceProjectService] saveToKnowledge failed:', err)
      return { success: false }
    }
  }

  /**
   * 保存参考项目记录
   */
  saveReference(params: {
    projectPath: string
    repoFullName: string
    repoUrl: string
    filePath: string
    codeContent: string
    summary: string
  }): { success: boolean; id: string } {
    try {
      const id = uuid()
      this.rawDb.prepare(`
        INSERT INTO reference_projects (id, project_path, repo_full_name, repo_url, file_path, code_content, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.projectPath,
        params.repoFullName,
        params.repoUrl,
        params.filePath,
        params.codeContent.slice(0, 50000),
        params.summary,
        new Date().toISOString()
      )
      return { success: true, id }
    } catch (err) {
      console.error('[ReferenceProjectService] saveReference failed:', err)
      return { success: false, id: '' }
    }
  }

  /**
   * 获取当前项目的已保存参考记录
   */
  listReferences(projectPath: string): { success: boolean; references: SavedReference[] } {
    try {
      const rows = this.rawDb.prepare(
        'SELECT * FROM reference_projects WHERE project_path = ? ORDER BY created_at DESC'
      ).all(projectPath) as any[]
      return {
        success: true,
        references: rows.map(r => ({
          id: r.id,
          projectPath: r.project_path,
          repoFullName: r.repo_full_name,
          repoUrl: r.repo_url,
          filePath: r.file_path,
          codeContent: r.code_content,
          summary: r.summary,
          createdAt: r.created_at,
        })),
      }
    } catch {
      return { success: true, references: [] }
    }
  }

  /**
   * 删除参考记录
   */
  deleteReference(id: string): { success: boolean } {
    try {
      this.rawDb.prepare('DELETE FROM reference_projects WHERE id = ?').run(id)
      return { success: true }
    } catch {
      return { success: false }
    }
  }

  /**
   * 获取仓库的 README 内容（用于显示项目描述）
   */
  async getRepoReadme(owner: string, repo: string): Promise<string> {
    try {
      const data = await this.githubFetch(`https://api.github.com/repos/${owner}/${repo}/readme`)
      if (data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8').slice(0, 3000)
      }
    } catch { /* ignore */ }
    return ''
  }

  /**
   * 智能推荐：根据当前项目 package.json 中的依赖，推荐相似明星项目
   */
  async suggestSimilarProjects(projectPath: string, limit = 6): Promise<{ success: boolean; repos: GithubRepo[] }> {
    try {
      const pkgPath = `${projectPath}/package.json`
      // 动态 import fs（避免顶层依赖）
      const fs = await import('fs')
      if (!fs.existsSync(pkgPath)) return { success: true, repos: [] }
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const deps = Object.keys(pkg.dependencies || {})
      if (deps.length === 0) return { success: true, repos: [] }

      // 取最重要的几个依赖作为搜索词
      const keyDeps = deps.filter(d =>
        !d.startsWith('@types') &&
        !d.startsWith('@babel') &&
        !d.startsWith('eslint') &&
        !d.startsWith('jest')
      ).slice(0, 4)

      if (keyDeps.length === 0) return { success: true, repos: [] }

      const query = keyDeps.join(' ')
      const result = await this.searchRepos(query, pkg.language || undefined, limit)
      return result
    } catch {
      return { success: true, repos: [] }
    }
  }
}
