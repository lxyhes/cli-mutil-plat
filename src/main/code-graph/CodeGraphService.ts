/**
 * CodeGraphService - file-level dependency graph for JS/TS projects.
 *
 * Phase 1 intentionally stays lightweight: it indexes files and import edges.
 * Symbol-level and Tree-sitter parsing can sit on top of this later.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { DatabaseManager } from '../storage/Database'

export interface CodeGraphFile {
  projectPath: string
  filePath: string
  language: string
  contentHash: string
  updatedAt: string
}

export interface CodeGraphImport {
  projectPath: string
  filePath: string
  importedPath: string
  resolvedFilePath?: string
  importKind: 'static' | 'dynamic' | 'require'
}

export interface CodeGraphStats {
  projectPath: string
  fileCount: number
  importCount: number
  internalImportCount: number
  lastIndexedAt?: string
}

export interface BlastRadiusFile {
  filePath: string
  distance: number
  relation: 'root' | 'dependency' | 'dependent'
}

export interface BlastRadiusResult {
  projectPath: string
  rootFile: string
  affectedFiles: BlastRadiusFile[]
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.spectrai-worktrees',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
])

export class CodeGraphService {
  private rawDb: any
  private readonly usingSqlite: boolean
  private readonly memoryFiles = new Map<string, CodeGraphFile>()
  private memoryImports: CodeGraphImport[] = []

  constructor(db: DatabaseManager) {
    this.rawDb = (db as any).db || db
    this.usingSqlite = Boolean(this.rawDb?.exec && this.rawDb?.prepare && this.rawDb?.transaction)
    if (this.usingSqlite) {
      this.ensureTables()
    }
  }

  indexProject(projectPath: string): CodeGraphStats {
    const root = path.resolve(projectPath)
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Project path is not a directory: ${projectPath}`)
    }

    const files = this.scanSourceFiles(root)
    const seen = new Set<string>()
    const now = new Date().toISOString()

    if (!this.usingSqlite) {
      for (const absFile of files) {
        const relFile = this.toProjectRelative(root, absFile)
        seen.add(relFile)
        const content = fs.readFileSync(absFile, 'utf8')
        this.memoryFiles.set(this.memoryKey(root, relFile), {
          projectPath: root,
          filePath: relFile,
          language: this.languageFor(absFile),
          contentHash: this.hash(content),
          updatedAt: now,
        })

        this.memoryImports = this.memoryImports.filter(edge => !(edge.projectPath === root && edge.filePath === relFile))
        for (const edge of this.extractImports(content)) {
          this.memoryImports.push({
            projectPath: root,
            filePath: relFile,
            importedPath: edge.importedPath,
            resolvedFilePath: this.resolveImport(root, absFile, edge.importedPath) || undefined,
            importKind: edge.importKind,
          })
        }
      }

      for (const [key, file] of this.memoryFiles.entries()) {
        if (file.projectPath === root && !seen.has(file.filePath)) {
          this.memoryFiles.delete(key)
        }
      }
      this.memoryImports = this.memoryImports.filter(edge => edge.projectPath !== root || seen.has(edge.filePath))
      return this.getStats(root)
    }

    const upsertFile = this.rawDb.prepare(`
      INSERT INTO code_graph_files (project_path, file_path, language, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_path, file_path)
      DO UPDATE SET language = excluded.language, content_hash = excluded.content_hash, updated_at = excluded.updated_at
    `)
    const deleteImports = this.rawDb.prepare('DELETE FROM code_graph_imports WHERE project_path = ? AND file_path = ?')
    const insertImport = this.rawDb.prepare(`
      INSERT INTO code_graph_imports (project_path, file_path, imported_path, resolved_file_path, import_kind)
      VALUES (?, ?, ?, ?, ?)
    `)

    const tx = this.rawDb.transaction(() => {
      for (const absFile of files) {
        const relFile = this.toProjectRelative(root, absFile)
        seen.add(relFile)
        const content = fs.readFileSync(absFile, 'utf8')
        upsertFile.run(root, relFile, this.languageFor(absFile), this.hash(content), now)
        deleteImports.run(root, relFile)

        for (const edge of this.extractImports(content)) {
          const resolved = this.resolveImport(root, absFile, edge.importedPath)
          insertImport.run(root, relFile, edge.importedPath, resolved, edge.importKind)
        }
      }

      const existing = this.rawDb.prepare('SELECT file_path FROM code_graph_files WHERE project_path = ?').all(root) as Array<{ file_path: string }>
      const deleteFile = this.rawDb.prepare('DELETE FROM code_graph_files WHERE project_path = ? AND file_path = ?')
      for (const row of existing) {
        if (!seen.has(row.file_path)) {
          deleteFile.run(root, row.file_path)
          deleteImports.run(root, row.file_path)
        }
      }
    })

    tx()
    return this.getStats(root)
  }

  indexFile(projectPath: string, filePath: string): CodeGraphFile | null {
    const root = path.resolve(projectPath)
    const absFile = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath)
    if (!this.isPathInside(root, absFile) || !this.isSourceFile(absFile)) return null

    if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
      this.removeFile(root, absFile)
      return null
    }

    const relFile = this.toProjectRelative(root, absFile)
    const content = fs.readFileSync(absFile, 'utf8')
    const now = new Date().toISOString()
    const file: CodeGraphFile = {
      projectPath: root,
      filePath: relFile,
      language: this.languageFor(absFile),
      contentHash: this.hash(content),
      updatedAt: now,
    }

    if (!this.usingSqlite) {
      this.memoryFiles.set(this.memoryKey(root, relFile), file)
      this.memoryImports = this.memoryImports.filter(edge => !(edge.projectPath === root && edge.filePath === relFile))
      for (const edge of this.extractImports(content)) {
        this.memoryImports.push({
          projectPath: root,
          filePath: relFile,
          importedPath: edge.importedPath,
          resolvedFilePath: this.resolveImport(root, absFile, edge.importedPath) || undefined,
          importKind: edge.importKind,
        })
      }
      return file
    }

    const upsertFile = this.rawDb.prepare(`
      INSERT INTO code_graph_files (project_path, file_path, language, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_path, file_path)
      DO UPDATE SET language = excluded.language, content_hash = excluded.content_hash, updated_at = excluded.updated_at
    `)
    const deleteImports = this.rawDb.prepare('DELETE FROM code_graph_imports WHERE project_path = ? AND file_path = ?')
    const insertImport = this.rawDb.prepare(`
      INSERT INTO code_graph_imports (project_path, file_path, imported_path, resolved_file_path, import_kind)
      VALUES (?, ?, ?, ?, ?)
    `)

    const tx = this.rawDb.transaction(() => {
      upsertFile.run(root, relFile, file.language, file.contentHash, file.updatedAt)
      deleteImports.run(root, relFile)
      for (const edge of this.extractImports(content)) {
        const resolved = this.resolveImport(root, absFile, edge.importedPath)
        insertImport.run(root, relFile, edge.importedPath, resolved, edge.importKind)
      }
    })
    tx()
    return file
  }

  removeFile(projectPath: string, filePath: string): void {
    const root = path.resolve(projectPath)
    const absFile = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath)
    if (!this.isPathInside(root, absFile)) return
    const relFile = this.toProjectRelative(root, absFile)

    if (!this.usingSqlite) {
      this.memoryFiles.delete(this.memoryKey(root, relFile))
      this.memoryImports = this.memoryImports.filter(edge =>
        !(edge.projectPath === root && (edge.filePath === relFile || edge.resolvedFilePath === relFile))
      )
      return
    }

    const tx = this.rawDb.transaction(() => {
      this.rawDb.prepare('DELETE FROM code_graph_files WHERE project_path = ? AND file_path = ?').run(root, relFile)
      this.rawDb.prepare('DELETE FROM code_graph_imports WHERE project_path = ? AND (file_path = ? OR resolved_file_path = ?)').run(root, relFile, relFile)
    })
    tx()
  }

  getStats(projectPath: string): CodeGraphStats {
    const root = path.resolve(projectPath)
    if (!this.usingSqlite) {
      const files = Array.from(this.memoryFiles.values()).filter(file => file.projectPath === root)
      const imports = this.memoryImports.filter(edge => edge.projectPath === root)
      const lastIndexedAt = files.reduce<string | undefined>((latest, file) => {
        if (!latest || file.updatedAt > latest) return file.updatedAt
        return latest
      }, undefined)
      return {
        projectPath: root,
        fileCount: files.length,
        importCount: imports.length,
        internalImportCount: imports.filter(edge => edge.resolvedFilePath).length,
        lastIndexedAt,
      }
    }

    const fileRow = this.rawDb.prepare('SELECT COUNT(*) AS count, MAX(updated_at) AS lastIndexedAt FROM code_graph_files WHERE project_path = ?').get(root) as any
    const importRow = this.rawDb.prepare('SELECT COUNT(*) AS count FROM code_graph_imports WHERE project_path = ?').get(root) as any
    const internalRow = this.rawDb.prepare('SELECT COUNT(*) AS count FROM code_graph_imports WHERE project_path = ? AND resolved_file_path IS NOT NULL').get(root) as any
    return {
      projectPath: root,
      fileCount: Number(fileRow?.count || 0),
      importCount: Number(importRow?.count || 0),
      internalImportCount: Number(internalRow?.count || 0),
      lastIndexedAt: fileRow?.lastIndexedAt || undefined,
    }
  }

  getDependencies(projectPath: string, filePath: string): CodeGraphImport[] {
    const root = path.resolve(projectPath)
    const rel = this.normalizeInputFile(root, filePath)
    if (!this.usingSqlite) {
      return this.memoryImports
        .filter(edge => edge.projectPath === root && edge.filePath === rel)
        .sort((a, b) => a.importedPath.localeCompare(b.importedPath))
        .map(edge => ({ ...edge }))
    }

    const rows = this.rawDb.prepare(`
      SELECT project_path, file_path, imported_path, resolved_file_path, import_kind
      FROM code_graph_imports
      WHERE project_path = ? AND file_path = ?
      ORDER BY imported_path ASC
    `).all(root, rel) as any[]
    return rows.map(this.mapImport)
  }

  getDependents(projectPath: string, filePath: string): CodeGraphImport[] {
    const root = path.resolve(projectPath)
    const rel = this.normalizeInputFile(root, filePath)
    if (!this.usingSqlite) {
      return this.memoryImports
        .filter(edge => edge.projectPath === root && edge.resolvedFilePath === rel)
        .sort((a, b) => a.filePath.localeCompare(b.filePath))
        .map(edge => ({ ...edge }))
    }

    const rows = this.rawDb.prepare(`
      SELECT project_path, file_path, imported_path, resolved_file_path, import_kind
      FROM code_graph_imports
      WHERE project_path = ? AND resolved_file_path = ?
      ORDER BY file_path ASC
    `).all(root, rel) as any[]
    return rows.map(this.mapImport)
  }

  getBlastRadius(projectPath: string, filePath: string, depth = 2): BlastRadiusResult {
    const root = path.resolve(projectPath)
    const rootFile = this.normalizeInputFile(root, filePath)
    const maxDepth = Math.max(1, Math.min(5, Math.floor(depth || 2)))

    const allEdges = this.usingSqlite
      ? this.rawDb.prepare(`
        SELECT file_path, resolved_file_path
        FROM code_graph_imports
        WHERE project_path = ? AND resolved_file_path IS NOT NULL
      `).all(root) as Array<{ file_path: string; resolved_file_path: string }>
      : this.memoryImports
        .filter(edge => edge.projectPath === root && edge.resolvedFilePath)
        .map(edge => ({ file_path: edge.filePath, resolved_file_path: edge.resolvedFilePath! }))

    const forward = new Map<string, Set<string>>()
    const reverse = new Map<string, Set<string>>()
    for (const edge of allEdges) {
      if (!forward.has(edge.file_path)) forward.set(edge.file_path, new Set())
      forward.get(edge.file_path)!.add(edge.resolved_file_path)
      if (!reverse.has(edge.resolved_file_path)) reverse.set(edge.resolved_file_path, new Set())
      reverse.get(edge.resolved_file_path)!.add(edge.file_path)
    }

    const result = new Map<string, BlastRadiusFile>()
    result.set(rootFile, { filePath: rootFile, distance: 0, relation: 'root' })

    for (const dependency of forward.get(rootFile) || []) {
      if (!result.has(dependency)) {
        result.set(dependency, { filePath: dependency, distance: 1, relation: 'dependency' })
      }
    }

    const queue: Array<{ filePath: string; distance: number }> = [{ filePath: rootFile, distance: 0 }]
    const visited = new Set<string>([rootFile])
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.distance >= maxDepth) continue
      for (const dependent of reverse.get(current.filePath) || []) {
        if (visited.has(dependent)) continue
        visited.add(dependent)
        const distance = current.distance + 1
        result.set(dependent, { filePath: dependent, distance, relation: 'dependent' })
        queue.push({ filePath: dependent, distance })
      }
    }

    return {
      projectPath: root,
      rootFile,
      affectedFiles: Array.from(result.values()).sort((a, b) => a.distance - b.distance || a.filePath.localeCompare(b.filePath)),
    }
  }

  private ensureTables(): void {
    this.rawDb.exec(`
      CREATE TABLE IF NOT EXISTS code_graph_files (
        project_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        language TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_path, file_path)
      );
      CREATE TABLE IF NOT EXISTS code_graph_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        imported_path TEXT NOT NULL,
        resolved_file_path TEXT,
        import_kind TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_code_graph_imports_source ON code_graph_imports(project_path, file_path);
      CREATE INDEX IF NOT EXISTS idx_code_graph_imports_resolved ON code_graph_imports(project_path, resolved_file_path);
    `)
  }

  private scanSourceFiles(root: string): string[] {
    const files: string[] = []
    const stack = [root]
    while (stack.length > 0) {
      const dir = stack.pop()!
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name)) stack.push(path.join(dir, entry.name))
          continue
        }
        if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
          files.push(path.join(dir, entry.name))
        }
      }
    }
    return files
  }

  private isSourceFile(filePath: string): boolean {
    return SOURCE_EXTENSIONS.has(path.extname(filePath))
  }

  private isPathInside(root: string, filePath: string): boolean {
    const relative = path.relative(root, filePath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private extractImports(content: string): Array<{ importedPath: string; importKind: CodeGraphImport['importKind'] }> {
    const edges: Array<{ importedPath: string; importKind: CodeGraphImport['importKind'] }> = []
    const patterns: Array<{ regex: RegExp; importKind: CodeGraphImport['importKind'] }> = [
      { regex: /\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, importKind: 'static' },
      { regex: /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+['"]([^'"]+)['"]/g, importKind: 'static' },
      { regex: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, importKind: 'dynamic' },
      { regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, importKind: 'require' },
    ]
    for (const { regex, importKind } of patterns) {
      let match: RegExpExecArray | null
      while ((match = regex.exec(content)) !== null) {
        edges.push({ importedPath: match[1], importKind })
      }
    }
    return edges
  }

  private resolveImport(root: string, importerAbsPath: string, importedPath: string): string | null {
    if (!importedPath.startsWith('.')) return null
    const base = path.resolve(path.dirname(importerAbsPath), importedPath)
    const candidates = [
      base,
      ...Array.from(SOURCE_EXTENSIONS).map(ext => `${base}${ext}`),
      ...Array.from(SOURCE_EXTENSIONS).map(ext => path.join(base, `index${ext}`)),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return this.toProjectRelative(root, candidate)
      }
    }
    return null
  }

  private normalizeInputFile(root: string, filePath: string): string {
    const abs = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath)
    return this.toProjectRelative(root, abs)
  }

  private toProjectRelative(root: string, filePath: string): string {
    return path.relative(root, path.resolve(filePath)).replace(/\\/g, '/')
  }

  private languageFor(filePath: string): string {
    const ext = path.extname(filePath)
    if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return 'typescript'
    return 'javascript'
  }

  private hash(content: string): string {
    return crypto.createHash('sha1').update(content).digest('hex')
  }

  private memoryKey(projectPath: string, filePath: string): string {
    return `${projectPath}\0${filePath}`
  }

  private mapImport(row: any): CodeGraphImport {
    return {
      projectPath: row.project_path,
      filePath: row.file_path,
      importedPath: row.imported_path,
      resolvedFilePath: row.resolved_file_path || undefined,
      importKind: row.import_kind,
    }
  }
}
