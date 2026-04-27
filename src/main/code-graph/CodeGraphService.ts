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

export interface CodeGraphSymbol {
  filePath: string
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'let' | 'var' | 'default' | 'unknown'
  exported: boolean
  line: number
}

export interface SymbolBlastRadiusItem {
  filePath: string
  symbolName: string
  kind: CodeGraphSymbol['kind']
  distance: number
  relation: 'root' | 'dependent'
  rootSymbol?: string
  viaFile?: string
  viaSymbol?: string
}

export interface SymbolBlastRadiusResult {
  projectPath: string
  rootFile: string
  rootSymbols: CodeGraphSymbol[]
  affectedSymbols: SymbolBlastRadiusItem[]
}

export type CodeGraphQuestionIntent =
  | 'overview'
  | 'dependencies'
  | 'dependents'
  | 'impact'
  | 'symbols'
  | 'entry'

export interface CodeGraphQuestionOptions {
  filePath?: string
  symbols?: string[]
  depth?: number
  autoIndex?: boolean
}

export interface CodeGraphQuestionSection {
  title: string
  items: string[]
}

export interface CodeGraphReference {
  type: 'file' | 'symbol'
  filePath: string
  symbolName?: string
  line?: number
  label: string
  reason: string
}

export interface CodeGraphQuestionAnswer {
  projectPath: string
  question: string
  intent: CodeGraphQuestionIntent
  targetFile?: string
  targetSymbols?: string[]
  summary: string
  sections: CodeGraphQuestionSection[]
  references: CodeGraphReference[]
  stats: CodeGraphStats
  suggestedPrompt: string
}

interface ImportBinding {
  importedPath: string
  importedSymbol: string
  localName: string
  importKind: CodeGraphImport['importKind']
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

  getSymbols(projectPath: string, filePath: string): CodeGraphSymbol[] {
    const root = path.resolve(projectPath)
    const rel = this.normalizeInputFile(root, filePath)
    const content = this.readProjectFile(root, rel)
    if (!content) return []
    return this.extractSymbols(content, rel)
  }

  getSymbolBlastRadius(projectPath: string, filePath: string, changedSymbols?: string[], depth = 2): SymbolBlastRadiusResult {
    const root = path.resolve(projectPath)
    const rootFile = this.normalizeInputFile(root, filePath)
    const maxDepth = Math.max(1, Math.min(5, Math.floor(depth || 2)))
    const rootContent = this.readProjectFile(root, rootFile)
    const rootSymbols = rootContent ? this.extractSymbols(rootContent, rootFile) : []
    const exportedRootSymbols = rootSymbols.filter(symbol => symbol.exported)
    const requested = new Set((changedSymbols || []).map(symbol => symbol.trim()).filter(Boolean))
    const selectedRootSymbols = requested.size > 0
      ? Array.from(requested).map(symbolName => (
        exportedRootSymbols.find(symbol => symbol.name === symbolName) || {
          filePath: rootFile,
          name: symbolName,
          kind: 'unknown' as const,
          exported: true,
          line: 0,
        }
      ))
      : (exportedRootSymbols.length > 0 ? exportedRootSymbols : rootSymbols)

    const reverse = this.getReverseImportMap(root)
    const result = new Map<string, SymbolBlastRadiusItem>()
    const queue: Array<{ filePath: string; symbols: Set<string>; distance: number; rootSymbolMap: Map<string, string> }> = []
    const visited = new Set<string>()
    const rootSymbolMap = new Map<string, string>()

    for (const symbol of selectedRootSymbols) {
      rootSymbolMap.set(symbol.name, symbol.name)
      result.set(this.symbolKey(rootFile, symbol.name), {
        filePath: rootFile,
        symbolName: symbol.name,
        kind: symbol.kind,
        distance: 0,
        relation: 'root',
        rootSymbol: symbol.name,
      })
    }

    queue.push({
      filePath: rootFile,
      symbols: new Set(selectedRootSymbols.map(symbol => symbol.name)),
      distance: 0,
      rootSymbolMap,
    })

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current.distance >= maxDepth || current.symbols.size === 0) continue

      for (const dependentFile of reverse.get(current.filePath) || []) {
        const dependentContent = this.readProjectFile(root, dependentFile)
        if (!dependentContent) continue

        const bindings = this.extractImportBindings(dependentContent)
          .filter(binding => {
            const resolved = this.resolveImport(root, path.resolve(root, dependentFile), binding.importedPath)
            return resolved === current.filePath
          })
          .filter(binding => binding.importedSymbol === '*' || current.symbols.has(binding.importedSymbol))

        if (bindings.length === 0) continue

        const localNames = bindings.map(binding => binding.localName).filter(name => name && name !== '*')
        const wildcard = bindings.some(binding => binding.importedSymbol === '*' || binding.localName === '*')
        const dependentSymbols = this.extractSymbols(dependentContent, dependentFile).filter(symbol => symbol.exported)
        const affected = dependentSymbols.filter(symbol =>
          wildcard || localNames.some(localName => this.symbolReferencesName(dependentContent, symbol, localName))
        )

        if (affected.length === 0) continue

        const nextSymbols = new Set<string>()
        const nextRootMap = new Map<string, string>()
        const distance = current.distance + 1
        for (const symbol of affected) {
          const matchedBinding = wildcard ? bindings[0] : bindings.find(binding =>
            this.symbolReferencesName(dependentContent, symbol, binding.localName)
          ) || bindings[0]
          const viaSymbol = matchedBinding.importedSymbol === '*' ? Array.from(current.symbols)[0] : matchedBinding.importedSymbol
          const rootSymbol = current.rootSymbolMap.get(viaSymbol) || Array.from(current.rootSymbolMap.values())[0] || viaSymbol
          const key = this.symbolKey(dependentFile, symbol.name)
          if (!result.has(key)) {
            result.set(key, {
              filePath: dependentFile,
              symbolName: symbol.name,
              kind: symbol.kind,
              distance,
              relation: 'dependent',
              rootSymbol,
              viaFile: current.filePath,
              viaSymbol,
            })
          }
          nextSymbols.add(symbol.name)
          nextRootMap.set(symbol.name, rootSymbol)
        }

        const visitKey = `${dependentFile}\0${Array.from(nextSymbols).sort().join(',')}\0${distance}`
        if (!visited.has(visitKey)) {
          visited.add(visitKey)
          queue.push({ filePath: dependentFile, symbols: nextSymbols, distance, rootSymbolMap: nextRootMap })
        }
      }
    }

    return {
      projectPath: root,
      rootFile,
      rootSymbols: selectedRootSymbols,
      affectedSymbols: Array.from(result.values()).sort((a, b) =>
        a.distance - b.distance || a.filePath.localeCompare(b.filePath) || a.symbolName.localeCompare(b.symbolName)
      ),
    }
  }

  answerQuestion(projectPath: string, question: string, options: CodeGraphQuestionOptions = {}): CodeGraphQuestionAnswer {
    const root = path.resolve(projectPath)
    const normalizedQuestion = question.trim()
    if (!normalizedQuestion) {
      throw new Error('Question is required')
    }

    const stats = this.ensureProjectIndexed(root, options.autoIndex !== false)
    const intent = this.detectQuestionIntent(normalizedQuestion)
    const files = this.getIndexedFiles(root)
    const targetFile = this.findTargetFile(root, files, normalizedQuestion, options.filePath)
    const depth = Math.max(1, Math.min(5, Math.floor(options.depth || 2)))
    const targetSymbols = this.resolveTargetSymbols(root, files, normalizedQuestion, targetFile, options.symbols)
    const sections: CodeGraphQuestionSection[] = []

    if (intent === 'overview') {
      sections.push({
        title: '索引概况',
        items: [
          `${stats.fileCount} 个源码文件`,
          `${stats.importCount} 条导入关系`,
          `${stats.internalImportCount} 条项目内依赖`,
          stats.lastIndexedAt ? `最近索引：${stats.lastIndexedAt}` : '还没有索引时间',
        ],
      })
      sections.push({ title: '可能的入口文件', items: this.getEntryCandidates(files) })
      sections.push({ title: '被引用最多的文件', items: this.getCentralFiles(root, files) })
    } else if (intent === 'entry') {
      sections.push({ title: '可能的入口文件', items: this.getEntryCandidates(files) })
      sections.push({ title: '建议追踪路径', items: ['从入口文件开始看 imports，再用“改这里影响哪里”查看反向依赖。'] })
    } else if (!targetFile) {
      sections.push({
        title: '需要更明确的目标',
        items: [
          '我没有从问题里识别到文件路径或唯一符号。',
          '可以用 src/main/index.ts、`AgentBridge`、`SessionManagerV2` 这类文件或符号再问一次。',
        ],
      })
      const symbolMatches = this.findSymbolCandidates(root, files, normalizedQuestion).slice(0, 8)
      if (symbolMatches.length > 0) {
        sections.push({
          title: '可能相关的符号',
          items: symbolMatches.map(symbol => `${symbol.name} (${symbol.kind}) - ${symbol.filePath}:${symbol.line}`),
        })
      }
    } else if (intent === 'dependencies') {
      const dependencies = this.getDependencies(root, targetFile)
      sections.push({
        title: `${targetFile} 直接依赖`,
        items: dependencies.length > 0
          ? dependencies.map(edge => `${edge.importedPath}${edge.resolvedFilePath ? ` -> ${edge.resolvedFilePath}` : ' (外部依赖)'}`)
          : ['未找到直接依赖。'],
      })
    } else if (intent === 'dependents') {
      if (targetSymbols.length > 0) {
        const radius = this.getSymbolBlastRadius(root, targetFile, targetSymbols, depth)
        sections.push({
          title: `${targetSymbols.join(', ')} 的符号级调用影响`,
          items: radius.affectedSymbols.length > 0
            ? radius.affectedSymbols.map(item => `${item.symbolName} (${item.kind}) - ${item.filePath}，距离 ${item.distance}${item.viaSymbol ? `，经由 ${item.viaSymbol}` : ''}`)
            : ['未找到符号级依赖。'],
        })
      } else {
        const dependents = this.getDependents(root, targetFile)
        sections.push({
          title: `谁依赖 ${targetFile}`,
          items: dependents.length > 0
            ? dependents.map(edge => `${edge.filePath} 通过 ${edge.importedPath} 引用`)
            : ['未找到直接依赖方。'],
        })
      }
    } else if (intent === 'symbols') {
      const symbols = this.getSymbols(root, targetFile)
      sections.push({
        title: `${targetFile} 中的符号`,
        items: symbols.length > 0
          ? symbols.slice(0, 40).map(symbol => `${symbol.exported ? 'export ' : ''}${symbol.name} (${symbol.kind}) - line ${symbol.line}`)
          : ['未识别到符号。'],
      })
    } else {
      if (targetSymbols.length > 0) {
        const radius = this.getSymbolBlastRadius(root, targetFile, targetSymbols, depth)
        sections.push({
          title: `${targetSymbols.join(', ')} 的影响范围`,
          items: radius.affectedSymbols.length > 0
            ? radius.affectedSymbols.map(item => `${item.symbolName} (${item.kind}) - ${item.filePath}，距离 ${item.distance}${item.viaFile ? `，来自 ${item.viaFile}` : ''}`)
            : ['未找到符号级影响范围。'],
        })
      }
      const radius = this.getBlastRadius(root, targetFile, depth)
      sections.push({
        title: `${targetFile} 的文件级影响范围`,
        items: radius.affectedFiles.map(file => `${file.filePath} - ${file.relation}，距离 ${file.distance}`),
      })
    }

    const summary = this.buildQuestionSummary(intent, targetFile, targetSymbols, sections, stats)
    const references = this.collectQuestionReferences(root, files, targetFile, targetSymbols, sections)
    return {
      projectPath: root,
      question: normalizedQuestion,
      intent,
      targetFile,
      targetSymbols: targetSymbols.length > 0 ? targetSymbols : undefined,
      summary,
      sections,
      references,
      stats,
      suggestedPrompt: this.buildSuggestedPrompt(root, normalizedQuestion, intent, targetFile, targetSymbols, summary, sections),
    }
  }

  private ensureProjectIndexed(root: string, autoIndex: boolean): CodeGraphStats {
    const stats = this.getStats(root)
    if (stats.fileCount > 0 || !autoIndex) return stats
    return this.indexProject(root)
  }

  private detectQuestionIntent(question: string): CodeGraphQuestionIntent {
    const q = question.toLowerCase()
    if (/(入口|启动|从哪|entry|main|bootstrap|start)/i.test(q)) return 'entry'
    if (/(影响|爆炸|改.*影响|修改.*影响|blast|impact|affect|change)/i.test(q)) return 'impact'
    if (/(谁.*(调用|引用|依赖)|被.*(调用|引用|依赖)|callers|used by|dependents|references)/i.test(q)) return 'dependents'
    if (/(依赖.*(什么|哪些)|引用.*(什么|哪些)|imports|dependencies|uses)/i.test(q)) return 'dependencies'
    if (/(导出|符号|函数|类|接口|exports|symbols)/i.test(q)) return 'symbols'
    return 'overview'
  }

  private getIndexedFiles(root: string): CodeGraphFile[] {
    if (!this.usingSqlite) {
      return Array.from(this.memoryFiles.values())
        .filter(file => file.projectPath === root)
        .sort((a, b) => a.filePath.localeCompare(b.filePath))
    }

    const rows = this.rawDb.prepare(`
      SELECT project_path, file_path, language, content_hash, updated_at
      FROM code_graph_files
      WHERE project_path = ?
      ORDER BY file_path ASC
    `).all(root) as any[]
    return rows.map(row => ({
      projectPath: row.project_path,
      filePath: row.file_path,
      language: row.language,
      contentHash: row.content_hash,
      updatedAt: row.updated_at,
    }))
  }

  private findTargetFile(root: string, files: CodeGraphFile[], question: string, explicitFilePath?: string): string | undefined {
    const byRelPath = (candidate: string) => {
      const normalized = this.normalizeInputFile(root, candidate)
      return files.find(file => file.filePath === normalized)?.filePath
    }

    if (explicitFilePath) {
      const explicit = byRelPath(explicitFilePath)
      if (explicit) return explicit
    }

    for (const mention of this.extractQuestionMentions(question)) {
      const exact = byRelPath(mention)
      if (exact) return exact
    }

    const pathMatch = question.match(/[A-Za-z0-9_@./\\:-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)\b/)
    if (pathMatch) {
      const raw = pathMatch[0].replace(/\\/g, '/')
      const exact = files.find(file => file.filePath === raw || file.filePath.endsWith(`/${raw}`))
      if (exact) return exact.filePath
    }

    const basenameMatches = files.filter(file => {
      const parsed = path.parse(file.filePath)
      return question.includes(parsed.base) || question.includes(parsed.name)
    })
    if (basenameMatches.length === 1) return basenameMatches[0].filePath

    const symbolMatches = this.findSymbolCandidates(root, files, question)
    const uniqueFiles = Array.from(new Set(symbolMatches.map(symbol => symbol.filePath)))
    if (uniqueFiles.length === 1) return uniqueFiles[0]

    return undefined
  }

  private resolveTargetSymbols(
    root: string,
    files: CodeGraphFile[],
    question: string,
    targetFile?: string,
    explicitSymbols?: string[],
  ): string[] {
    const requested = new Set((explicitSymbols || []).map(symbol => symbol.trim()).filter(Boolean))
    const mentions = this.extractQuestionMentions(question)
    for (const mention of mentions) {
      if (/^[A-Za-z_$][\w$]*$/.test(mention)) requested.add(mention)
    }

    const candidates = this.findSymbolCandidates(root, files, question)
      .filter(symbol => !targetFile || symbol.filePath === targetFile)
    for (const symbol of candidates) {
      requested.add(symbol.name)
    }

    return Array.from(requested).slice(0, 8)
  }

  private extractQuestionMentions(question: string): string[] {
    const mentions: string[] = []
    const patterns = [
      /`([^`]+)`/g,
      /"([^"]+)"/g,
      /'([^']+)'/g,
      /「([^」]+)」/g,
      /“([^”]+)”/g,
    ]
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(question)) !== null) {
        const value = match[1]?.trim()
        if (value) mentions.push(value)
      }
    }
    return mentions
  }

  private findSymbolCandidates(root: string, files: CodeGraphFile[], question: string): CodeGraphSymbol[] {
    const tokens = new Set<string>()
    for (const mention of this.extractQuestionMentions(question)) {
      if (/^[A-Za-z_$][\w$]*$/.test(mention)) tokens.add(mention)
    }
    const identifierMatches = question.match(/\b[A-Za-z_$][\w$]{2,}\b/g) || []
    for (const token of identifierMatches) {
      if (!this.isCommonQuestionToken(token)) tokens.add(token)
    }
    if (tokens.size === 0) return []

    const results: CodeGraphSymbol[] = []
    for (const file of files) {
      const content = this.readProjectFile(root, file.filePath)
      if (!content) continue
      for (const symbol of this.extractSymbols(content, file.filePath)) {
        if (tokens.has(symbol.name)) results.push(symbol)
      }
    }
    return results.sort((a, b) => Number(b.exported) - Number(a.exported) || a.filePath.localeCompare(b.filePath))
  }

  private isCommonQuestionToken(token: string): boolean {
    return new Set([
      'what', 'where', 'which', 'who', 'how', 'does', 'this', 'that',
      'import', 'imports', 'export', 'exports', 'file', 'class', 'function',
      'const', 'type', 'interface', 'impact', 'change', 'used', 'uses',
    ]).has(token.toLowerCase())
  }

  private getEntryCandidates(files: CodeGraphFile[]): string[] {
    const scored = files
      .map(file => {
        const normalized = file.filePath.toLowerCase()
        let score = 0
        if (/(^|\/)(index|main|app|server|bootstrap|cli|electron)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(normalized)) score += 3
        if (/src\/(main|renderer|app|pages|routes)\//.test(normalized)) score += 2
        if (/\/main\.(ts|js)$/.test(normalized) || /\/index\.(ts|tsx|js|jsx)$/.test(normalized)) score += 2
        return { filePath: file.filePath, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
      .slice(0, 8)
      .map(item => item.filePath)

    return scored.length > 0 ? scored : ['未从当前索引中识别到明显入口文件。']
  }

  private getCentralFiles(root: string, files: CodeGraphFile[]): string[] {
    const ranked = files
      .map(file => ({
        filePath: file.filePath,
        dependents: this.getDependents(root, file.filePath).length,
      }))
      .filter(item => item.dependents > 0)
      .sort((a, b) => b.dependents - a.dependents || a.filePath.localeCompare(b.filePath))
      .slice(0, 8)
      .map(item => `${item.filePath} - ${item.dependents} 个直接依赖方`)

    return ranked.length > 0 ? ranked : ['当前图谱里还没有明显的高复用文件。']
  }

  private collectQuestionReferences(
    root: string,
    files: CodeGraphFile[],
    targetFile: string | undefined,
    targetSymbols: string[],
    sections: CodeGraphQuestionSection[],
  ): CodeGraphReference[] {
    const knownFiles = new Set(files.map(file => file.filePath))
    const references = new Map<string, CodeGraphReference>()
    const addFile = (filePath: string | undefined, reason: string) => {
      if (!filePath || !knownFiles.has(filePath)) return
      const key = `file:${filePath}`
      if (!references.has(key)) {
        references.set(key, {
          type: 'file',
          filePath,
          label: filePath,
          reason,
        })
      }
    }
    const addSymbol = (filePath: string | undefined, symbolName: string | undefined, reason: string, line?: number) => {
      if (!filePath || !symbolName || !knownFiles.has(filePath)) return
      const key = `symbol:${filePath}:${symbolName}`
      if (!references.has(key)) {
        references.set(key, {
          type: 'symbol',
          filePath,
          symbolName,
          line,
          label: `${symbolName} - ${filePath}${line ? `:${line}` : ''}`,
          reason,
        })
      }
    }

    addFile(targetFile, '目标文件')
    if (targetFile && targetSymbols.length > 0) {
      const symbols = this.getSymbols(root, targetFile)
      for (const symbolName of targetSymbols) {
        const symbol = symbols.find(item => item.name === symbolName)
        addSymbol(targetFile, symbolName, '目标符号', symbol?.line)
      }
    }

    for (const section of sections) {
      for (const item of section.items) {
        for (const file of files) {
          if (item.includes(file.filePath)) addFile(file.filePath, section.title)
        }

        const symbolWithFile = item.match(/^([A-Za-z_$][\w$]*)\s+\([^)]+\)\s+-\s+([^，,\s]+)(?:.*?line\s+(\d+))?/)
        if (symbolWithFile) {
          addSymbol(symbolWithFile[2], symbolWithFile[1], section.title, symbolWithFile[3] ? Number(symbolWithFile[3]) : undefined)
          continue
        }

        const symbolInTargetFile = item.match(/^(?:export\s+)?([A-Za-z_$][\w$]*)\s+\([^)]+\)\s+-\s+line\s+(\d+)/)
        if (symbolInTargetFile && targetFile) {
          addSymbol(targetFile, symbolInTargetFile[1], section.title, Number(symbolInTargetFile[2]))
        }
      }
    }

    return Array.from(references.values()).slice(0, 32)
  }

  private buildQuestionSummary(
    intent: CodeGraphQuestionIntent,
    targetFile: string | undefined,
    targetSymbols: string[],
    sections: CodeGraphQuestionSection[],
    stats: CodeGraphStats,
  ): string {
    if (!targetFile && intent !== 'overview' && intent !== 'entry') {
      return `已索引 ${stats.fileCount} 个源码文件，但还需要更明确的文件或符号目标。`
    }
    if (intent === 'overview') return `当前图谱包含 ${stats.fileCount} 个源码文件和 ${stats.internalImportCount} 条项目内依赖。`
    if (intent === 'entry') return '已根据文件名和目录位置推断可能入口。'
    const target = targetSymbols.length > 0 ? `${targetFile} 中的 ${targetSymbols.join(', ')}` : targetFile
    const count = sections.reduce((total, section) => total + section.items.length, 0)
    return `已基于 Code Graph 分析 ${target}，得到 ${count} 条结构化线索。`
  }

  private buildSuggestedPrompt(
    projectPath: string,
    question: string,
    intent: CodeGraphQuestionIntent,
    targetFile: string | undefined,
    targetSymbols: string[],
    summary: string,
    sections: CodeGraphQuestionSection[],
  ): string {
    const body = sections
      .map(section => {
        const items = section.items.map(item => `- ${item}`).join('\n')
        return `## ${section.title}\n${items}`
      })
      .join('\n\n')

    return [
      '请基于下面的 Code Graph 结果回答我的代码库问题，并在需要时继续查看相关文件验证。',
      '',
      `用户问题：${question}`,
      `项目路径：${projectPath}`,
      `识别意图：${intent}`,
      targetFile ? `目标文件：${targetFile}` : undefined,
      targetSymbols.length > 0 ? `目标符号：${targetSymbols.join(', ')}` : undefined,
      '',
      `图谱摘要：${summary}`,
      '',
      body,
      '',
      '请给出清晰结论、关键文件/符号引用，以及下一步建议。如果图谱信息不足，请说明还需要检查哪些文件。',
    ].filter(Boolean).join('\n')
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

  private extractSymbols(content: string, filePath: string): CodeGraphSymbol[] {
    const symbols = new Map<string, CodeGraphSymbol>()
    const lines = content.split(/\r?\n/)
    const add = (name: string, kind: CodeGraphSymbol['kind'], exported: boolean, index: number) => {
      if (!name) return
      const key = `${name}\0${exported ? 'exported' : 'local'}`
      if (!symbols.has(key)) {
        symbols.set(key, { filePath, name, kind, exported, line: index + 1 })
      }
    }

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('import ')) return

      let match = trimmed.match(/^export\s+default\s+(?:async\s+)?function(?:\s+([A-Za-z_$][\w$]*))?/)
      if (match) {
        add('default', 'default', true, index)
        if (match[1]) add(match[1], 'function', true, index)
        return
      }

      match = trimmed.match(/^export\s+default\s+class(?:\s+([A-Za-z_$][\w$]*))?/)
      if (match) {
        add('default', 'default', true, index)
        if (match[1]) add(match[1], 'class', true, index)
        return
      }

      match = trimmed.match(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'function', true, index)
      match = trimmed.match(/^export\s+class\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'class', true, index)
      match = trimmed.match(/^export\s+interface\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'interface', true, index)
      match = trimmed.match(/^export\s+type\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'type', true, index)
      match = trimmed.match(/^export\s+enum\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'enum', true, index)
      match = trimmed.match(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[2], match[1] as CodeGraphSymbol['kind'], true, index)

      match = trimmed.match(/^export\s*\{([^}]+)\}/)
      if (match) {
        for (const part of match[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/i).pop()?.trim()
          if (name) add(name, 'unknown', true, index)
        }
        return
      }

      match = trimmed.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'function', false, index)
      match = trimmed.match(/^class\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'class', false, index)
      match = trimmed.match(/^interface\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'interface', false, index)
      match = trimmed.match(/^type\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'type', false, index)
      match = trimmed.match(/^enum\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[1], 'enum', false, index)
      match = trimmed.match(/^(const|let|var)\s+([A-Za-z_$][\w$]*)/)
      if (match) return add(match[2], match[1] as CodeGraphSymbol['kind'], false, index)
    })

    return Array.from(symbols.values()).sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))
  }

  private extractImportBindings(content: string): ImportBinding[] {
    const bindings: ImportBinding[] = []
    const addNamedImports = (importedPath: string, namedBlock: string) => {
      for (const rawPart of namedBlock.split(',')) {
        const part = rawPart.trim()
        if (!part) continue
        const pieces = part.split(/\s+as\s+/i).map(item => item.trim()).filter(Boolean)
        bindings.push({
          importedPath,
          importedSymbol: pieces[0],
          localName: pieces[1] || pieces[0],
          importKind: 'static',
        })
      }
    }

    let match: RegExpExecArray | null
    const importRegex = /\bimport\s+(?:type\s+)?([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g
    while ((match = importRegex.exec(content)) !== null) {
      const clause = match[1].trim()
      const importedPath = match[2]
      const named = clause.match(/\{([^}]+)\}/)
      if (named) addNamedImports(importedPath, named[1])

      const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)
      if (namespace) {
        bindings.push({ importedPath, importedSymbol: '*', localName: namespace[1], importKind: 'static' })
      }

      const defaultPart = clause.replace(/\{[^}]*\}/g, '').replace(/\*\s+as\s+[A-Za-z_$][\w$]*/g, '').split(',')[0]?.trim()
      if (defaultPart && /^[A-Za-z_$][\w$]*$/.test(defaultPart)) {
        bindings.push({ importedPath, importedSymbol: 'default', localName: defaultPart, importKind: 'static' })
      }
    }

    const sideEffectRegex = /\bimport\s+['"]([^'"]+)['"]/g
    while ((match = sideEffectRegex.exec(content)) !== null) {
      bindings.push({ importedPath: match[1], importedSymbol: '*', localName: '*', importKind: 'static' })
    }

    const requireObjectRegex = /\b(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((match = requireObjectRegex.exec(content)) !== null) {
      addNamedImports(match[2], match[1])
    }

    const requireDefaultRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((match = requireDefaultRegex.exec(content)) !== null) {
      bindings.push({ importedPath: match[2], importedSymbol: '*', localName: match[1], importKind: 'require' })
    }

    return bindings
  }

  private getReverseImportMap(root: string): Map<string, Set<string>> {
    const allEdges = this.usingSqlite
      ? this.rawDb.prepare(`
        SELECT file_path, resolved_file_path
        FROM code_graph_imports
        WHERE project_path = ? AND resolved_file_path IS NOT NULL
      `).all(root) as Array<{ file_path: string; resolved_file_path: string }>
      : this.memoryImports
        .filter(edge => edge.projectPath === root && edge.resolvedFilePath)
        .map(edge => ({ file_path: edge.filePath, resolved_file_path: edge.resolvedFilePath! }))

    const reverse = new Map<string, Set<string>>()
    for (const edge of allEdges) {
      if (!reverse.has(edge.resolved_file_path)) reverse.set(edge.resolved_file_path, new Set())
      reverse.get(edge.resolved_file_path)!.add(edge.file_path)
    }
    return reverse
  }

  private readProjectFile(root: string, filePath: string): string | null {
    const abs = path.resolve(root, filePath)
    if (!this.isPathInside(root, abs) || !this.isSourceFile(abs) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return null
    }
    return fs.readFileSync(abs, 'utf8')
  }

  private symbolReferencesName(content: string, symbol: CodeGraphSymbol, name: string): boolean {
    const block = this.getSymbolBlock(content, symbol)
    return new RegExp(`\\b${this.escapeRegExp(name)}\\b`).test(block)
  }

  private getSymbolBlock(content: string, symbol: CodeGraphSymbol): string {
    const lines = content.split(/\r?\n/)
    const startIndex = Math.max(0, symbol.line - 1)
    const collected: string[] = []
    let balance = 0
    let startedBlock = false

    for (let index = startIndex; index < lines.length; index++) {
      const line = lines[index]
      collected.push(line)
      for (const char of line) {
        if (char === '{') {
          balance++
          startedBlock = true
        } else if (char === '}') {
          balance--
        }
      }
      if (!startedBlock && /[;,]\s*$/.test(line)) break
      if (startedBlock && balance <= 0) break
      if (index > startIndex && !startedBlock) break
    }

    return collected.join('\n')
  }

  private symbolKey(filePath: string, symbolName: string): string {
    return `${filePath}\0${symbolName}`
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
