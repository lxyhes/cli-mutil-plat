/**
 * 文件管理器 IPC 处理器
 * 提供目录列表、文件读取、系统打开、目录监听等能力
 * @author weibin
 */

import { ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { FileEntry, DirListing, FileWatchEvent } from '../../shared/fileManagerTypes'
import { sendToRenderer } from './shared'
import type { IpcDependencies } from './index'
import type { FileChangeTracker } from '../tracker/FileChangeTracker'
import { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'

/** 最大可读取文件大小：5MB */
const MAX_READ_SIZE = 5 * 1024 * 1024

/** 活跃的目录监听器，key 为规范化的目录绝对路径 */
const watchers = new Map<string, fs.FSWatcher>()

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function canonicalizePath(targetPath: string, allowMissing = false): Promise<string> {
  const absolutePath = path.resolve(targetPath)

  if (!allowMissing) {
    return fs.promises.realpath(absolutePath)
  }

  let probePath = absolutePath
  while (true) {
    try {
      const realProbePath = await fs.promises.realpath(probePath)
      const relative = path.relative(probePath, absolutePath)
      return path.resolve(realProbePath, relative)
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }

    const parentPath = path.dirname(probePath)
    if (parentPath === probePath) {
      throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'Path does not exist',
        userMessage: '路径不存在',
        context: { targetPath: absolutePath },
      })
    }
    probePath = parentPath
  }
}

async function getAuthorizedRoots(deps: IpcDependencies): Promise<string[]> {
  const rootCandidates = new Set<string>()
  const addRoot = (candidate?: string | null): void => {
    if (!candidate || typeof candidate !== 'string') return
    const trimmed = candidate.trim()
    if (!trimmed) return
    rootCandidates.add(path.resolve(trimmed))
  }

  try {
    const sessions = deps.database.getAllSessions()
    for (const session of sessions) {
      addRoot((session as any).workingDirectory)
      addRoot((session as any).config?.workingDirectory)
    }
  } catch {
    // ignore
  }

  try {
    const v1Sessions = deps.sessionManager?.getAllSessions?.() ?? []
    for (const session of v1Sessions) {
      addRoot((session as any).cwd)
      addRoot((session as any).workingDirectory)
      addRoot((session as any).config?.workingDirectory)
    }
  } catch {
    // ignore
  }

  try {
    const v2Sessions = deps.sessionManagerV2?.getAllSessions?.() ?? []
    for (const session of v2Sessions) {
      addRoot((session as any).workingDirectory)
      addRoot((session as any).config?.workingDirectory)
    }
  } catch {
    // ignore
  }

  try {
    const workspaces = deps.database.getAllWorkspaces()
    for (const workspace of workspaces) {
      addRoot(workspace.rootPath)
      for (const repo of workspace.repos || []) {
        addRoot(repo.repoPath)
      }
    }
  } catch {
    // ignore
  }

  const canonicalRoots = new Set<string>()
  for (const rootCandidate of rootCandidates) {
    try {
      canonicalRoots.add(await canonicalizePath(rootCandidate, true))
    } catch {
      // ignore roots that no longer exist
    }
  }

  return Array.from(canonicalRoots)
}

async function assertFileManagerPathAllowed(
  deps: IpcDependencies,
  targetPath: string,
  operation: string,
  allowMissing = false
): Promise<string> {
  const canonicalTargetPath = await canonicalizePath(targetPath, allowMissing)
  const authorizedRoots = await getAuthorizedRoots(deps)

  if (authorizedRoots.some(rootPath => isPathWithinRoot(canonicalTargetPath, rootPath))) {
    return canonicalTargetPath
  }

  throw new SpectrAIError({
    code: ErrorCode.PERMISSION_DENIED,
    message: `Path is outside authorized workspaces/sessions: ${canonicalTargetPath}`,
    userMessage: '该路径不在已授权的工作区或会话目录内，已拒绝访问',
    context: { operation, targetPath: canonicalTargetPath },
  })
}

async function ensurePathDoesNotExist(targetPath: string, kind: 'file' | 'directory' | 'target'): Promise<void> {
  try {
    await fs.promises.lstat(targetPath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  const messages: Record<typeof kind, string> = {
    file: '文件已存在',
    directory: '目录已存在',
    target: '目标名称已存在',
  }

  throw new SpectrAIError({
    code: ErrorCode.ALREADY_EXISTS,
    message: `${kind} already exists`,
    userMessage: messages[kind],
    context: { targetPath },
  })
}

export function registerFileManagerHandlers(
  deps: IpcDependencies,
  fileChangeTracker?: FileChangeTracker
): void {

  // ==================== list-dir：列出目录内容 ====================

  ipcMain.handle('file-manager:list-dir', async (_event, { path: dirPath }: { path: string }) => {
    try {
      const normalizedPath = await assertFileManagerPathAllowed(deps, dirPath, 'fileManager.listDir')
      const dirents = await fs.promises.readdir(normalizedPath, { withFileTypes: true })

      const entries: FileEntry[] = []

      for (const dirent of dirents) {
        const entryPath = path.join(normalizedPath, dirent.name)
        const isDir = dirent.isDirectory()
        const isHidden = dirent.name.startsWith('.')

        const entry: FileEntry = {
          name: dirent.name,
          path: entryPath,
          type: isDir ? 'directory' : 'file',
          isHidden,
        }

        // 获取 stat 信息（size / modified）
        try {
          const stat = await fs.promises.stat(entryPath)
          entry.modified = stat.mtimeMs
          if (!isDir) {
            entry.size = stat.size
            const ext = path.extname(dirent.name)
            if (ext) entry.extension = ext
          }
        } catch {
          // stat 失败（权限不足等）时跳过，保留基本信息
        }

        entries.push(entry)
      }

      // 排序规则：
      //   1. 目录在前，文件在后
      //   2. 各组内隐藏项（以 '.' 开头）排在末尾
      //   3. 组内按名称字母序（大小写不敏感）
      entries.sort((a, b) => {
        // 目录 vs 文件
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1
        }
        // 隐藏 vs 非隐藏（同类型内部）
        if (a.isHidden !== b.isHidden) {
          return a.isHidden ? 1 : -1
        }
        // 字母序（大小写不敏感）
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      })

      const result: DirListing = { path: normalizedPath, entries }
      return result
    } catch (error: any) {
      console.error('[IPC] file-manager:list-dir error:', error)
      return { path: dirPath, entries: [], error: createErrorResponse(error, { operation: 'fileManager.listDir', dirPath }).error }
    }
  })

  // ==================== open-path：用系统程序打开 ====================

  ipcMain.handle('file-manager:open-path', async (_event, filePath: string) => {
    try {
      const normalizedPath = await assertFileManagerPathAllowed(deps, filePath, 'fileManager.openPath', true)
      const errorMsg = await shell.openPath(normalizedPath)
      // shell.openPath 返回空字符串表示成功，否则返回错误描述
      if (errorMsg) {
        return createErrorResponse(new Error(errorMsg), { operation: 'fileManager.openPath' })
      }
      return createSuccessResponse({})
    } catch (error: any) {
      console.error('[IPC] file-manager:open-path error:', error)
      return createErrorResponse(error, { operation: 'fileManager' })
    }
  })

  // ==================== read-file：读取文本文件内容 ====================

  ipcMain.handle('file-manager:read-file', async (_event, filePath: string) => {
    try {
      const normalizedPath = await assertFileManagerPathAllowed(deps, filePath, 'fileManager.readFile')

      // 先检查文件大小，超出 5MB 拒绝读取
      const stat = await fs.promises.stat(normalizedPath)
      if (stat.size > MAX_READ_SIZE) {
        return {
          error: `文件过大（${Math.round(stat.size / 1024 / 1024 * 10) / 10}MB），超出 5MB 限制，无法读取`
        }
      }

      const content = await fs.promises.readFile(normalizedPath, 'utf-8')
      return createSuccessResponse({ content })
    } catch (error: any) {
      console.error('[IPC] file-manager:read-file error:', error)
      return createErrorResponse(error, { operation: 'fileManager' })
    }
  })

  // ==================== watch-dir：开始监听目录变化 ====================

  ipcMain.handle('file-manager:watch-dir', async (_event, dirPath: string) => {
    try {
      const normalizedPath = await assertFileManagerPathAllowed(deps, dirPath, 'fileManager.watchDir')

      // 若已有监听器，先关闭旧的（幂等操作）
      if (watchers.has(normalizedPath)) {
        watchers.get(normalizedPath)!.close()
        watchers.delete(normalizedPath)
      }

      const watcher = fs.watch(
        normalizedPath,
        { recursive: false },
        (eventType: 'rename' | 'change', filename: string | null) => {
          const event: FileWatchEvent = {
            eventType,
            // Windows 上 filename 有时为 null，保持原样传递
            filename: filename ?? null,
            dirPath: normalizedPath,
          }
          sendToRenderer('file-manager:watch-change', event)
        }
      )

      watcher.on('error', (err) => {
        console.error(`[IPC] file-manager watcher error (${normalizedPath}):`, err)
        watchers.delete(normalizedPath)
      })

      watchers.set(normalizedPath, watcher)
      console.log(`[IPC] file-manager: watching ${normalizedPath}`)
      return createSuccessResponse({})
    } catch (error: any) {
      console.error('[IPC] file-manager:watch-dir error:', error)
      return createErrorResponse(error, { operation: 'fileManager' })
    }
  })

  // ==================== unwatch-dir：停止监听目录 ====================

  ipcMain.handle('file-manager:unwatch-dir', async (_event, dirPath: string) => {
    try {
      let normalizedPath: string
      try {
        normalizedPath = await canonicalizePath(dirPath, true)
      } catch {
        normalizedPath = path.resolve(dirPath)
      }

      if (watchers.has(normalizedPath)) {
        watchers.get(normalizedPath)!.close()
        watchers.delete(normalizedPath)
        console.log(`[IPC] file-manager: unwatched ${normalizedPath}`)
      }

      return createSuccessResponse({})
    } catch (error: any) {
      console.error('[IPC] file-manager:unwatch-dir error:', error)
      return createErrorResponse(error, { operation: 'fileManager' })
    }
  })

  // ==================== write-file：写入文本文件内容 ====================

  ipcMain.handle(
    'file-manager:write-file',
    async (_event, { path: filePath, content }: { path: string; content: string }) => {
      try {
        // 安全检查：内容大小限制 5MB
        if (content.length > 5 * 1024 * 1024) {
          throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'File content exceeds 5MB limit',
          userMessage: '文件内容超过 5MB 限制，无法保存',
          context: { contentLength: content.length }
        })
        }
        const normalizedPath = await assertFileManagerPathAllowed(deps, filePath, 'fileManager.writeFile', true)
        await fs.promises.writeFile(normalizedPath, content, 'utf-8')
        return createSuccessResponse({})
      } catch (error: any) {
        console.error('[IPC] file-manager:write-file error:', error)
        return createErrorResponse(error, { operation: 'fileManager.writeFile' })
      }
    }
  )

  // ==================== get-session-files：查询会话改动的文件列表 ====================

  ipcMain.handle('file-manager:get-session-files', (_event, sessionId: string) => {
    if (!fileChangeTracker) return []
    return fileChangeTracker.getSessionChanges(sessionId)
  })

  // ==================== list-project-files：递归列举项目文件（用于 @ 符号引用） ====================

  ipcMain.handle('file-manager:list-project-files', async (
    _event,
    dirPath: string,
    maxResults = 800
  ) => {
    try {
      const normalizedPath = await assertFileManagerPathAllowed(deps, dirPath, 'fileManager.listProjectFiles')

      // 检查是否是目录
      let dirStat: fs.Stats
      try {
        dirStat = await fs.promises.stat(normalizedPath)
      } catch {
        return { files: [], total: 0, truncated: false, error: new SpectrAIError({
          code: ErrorCode.NOT_FOUND,
          message: 'Path does not exist',
          userMessage: '路径不存在',
          context: { dirPath: normalizedPath }
        }).userMessage }
      }
      if (!dirStat.isDirectory()) {
        return { files: [], total: 0, truncated: false, error: new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'Path is not a directory',
          userMessage: '路径不是目录',
          context: { dirPath: normalizedPath }
        }).userMessage }
      }

      /** 递归忽略的目录名 */
      const IGNORE_DIRS = new Set([
        'node_modules', '.git', '.svn', '.hg',
        'dist', 'build', 'out', '.next', '.nuxt', '.turbo',
        '.cache', '__pycache__', '.venv', 'venv', 'env',
        '.claude', 'target', 'vendor',
        '.idea', '.vscode', 'coverage', '.nyc_output',
        'tmp', 'temp', 'logs',
      ])

      const results: Array<{
        name: string
        path: string
        relativePath: string
        ext: string
      }> = []

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 10 || results.length >= maxResults) return

        let entries: fs.Dirent[]
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true })
        } catch {
          return  // 权限不足等情况跳过
        }

        for (const entry of entries) {
          if (results.length >= maxResults) return

          // 深度 > 0 时跳过隐藏文件/目录（以 '.' 开头）
          if (depth > 0 && entry.name.startsWith('.')) continue

          const entryPath = path.join(dir, entry.name)

          if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name)) {
              await walk(entryPath, depth + 1)
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name)
            const relativePath = path.relative(normalizedPath, entryPath).replace(/\\/g, '/')
            results.push({ name: entry.name, path: entryPath, relativePath, ext })
          }
        }
      }

      await walk(normalizedPath, 0)

      return {
        files: results,
        total: results.length,
        truncated: results.length >= maxResults,
      }
    } catch (error: any) {
      console.error('[IPC] file-manager:list-project-files error:', error)
      return { files: [], total: 0, truncated: false, error: createErrorResponse(error, { operation: 'fileManager.listProjectFiles' }).error }
    }
  })

  // ==================== create-file：创建空文件 ====================

  ipcMain.handle(
    'file-manager:create-file',
    async (_event, filePath: string) => {
      try {
        const normalizedPath = await assertFileManagerPathAllowed(deps, filePath, 'fileManager.createFile', true)
        await ensurePathDoesNotExist(normalizedPath, 'file')
        // 确保父目录存在
        const dir = path.dirname(normalizedPath)
        await fs.promises.mkdir(dir, { recursive: true })
        await fs.promises.writeFile(normalizedPath, '', 'utf-8')
        return createSuccessResponse({})
      } catch (error: any) {
        console.error('[IPC] file-manager:create-file error:', error)
        return createErrorResponse(error, { operation: 'fileManager' })
      }
    }
  )

  // ==================== create-dir：创建目录 ====================

  ipcMain.handle(
    'file-manager:create-dir',
    async (_event, dirPath: string) => {
      try {
        const normalizedPath = await assertFileManagerPathAllowed(deps, dirPath, 'fileManager.createDir', true)
        await ensurePathDoesNotExist(normalizedPath, 'directory')
        await fs.promises.mkdir(normalizedPath, { recursive: true })
        return createSuccessResponse({})
      } catch (error: any) {
        console.error('[IPC] file-manager:create-dir error:', error)
        return createErrorResponse(error, { operation: 'fileManager' })
      }
    }
  )

  // ==================== rename：重命名文件/目录 ====================

  ipcMain.handle(
    'file-manager:rename',
    async (_event, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
      try {
        const normalizedOld = await assertFileManagerPathAllowed(deps, oldPath, 'fileManager.rename')
        const normalizedNew = await assertFileManagerPathAllowed(deps, newPath, 'fileManager.rename', true)
        await ensurePathDoesNotExist(normalizedNew, 'target')
        await fs.promises.rename(normalizedOld, normalizedNew)
        return createSuccessResponse({})
      } catch (error: any) {
        console.error('[IPC] file-manager:rename error:', error)
        return createErrorResponse(error, { operation: 'fileManager' })
      }
    }
  )

  // ==================== delete：删除文件/目录 ====================

  ipcMain.handle(
    'file-manager:delete',
    async (_event, targetPath: string) => {
      try {
        const normalizedPath = await assertFileManagerPathAllowed(deps, targetPath, 'fileManager.delete')
        const stat = await fs.promises.stat(normalizedPath)

        if (stat.isDirectory()) {
          // 移动到回收站（更安全），失败则递归删除
          try {
            await shell.trashItem(normalizedPath)
          } catch {
            await fs.promises.rm(normalizedPath, { recursive: true, force: true })
          }
        } else {
          try {
            await shell.trashItem(normalizedPath)
          } catch {
            await fs.promises.unlink(normalizedPath)
          }
        }

        return createSuccessResponse({})
      } catch (error: any) {
        console.error('[IPC] file-manager:delete error:', error)
        return createErrorResponse(error, { operation: 'fileManager' })
      }
    }
  )

  // ==================== show-in-folder：在系统文件管理器中显示 ====================

  ipcMain.handle(
    'file-manager:show-in-folder',
    async (_event, filePath: string) => {
      try {
        const normalizedPath = await assertFileManagerPathAllowed(deps, filePath, 'fileManager.showInFolder', true)
        shell.showItemInFolder(normalizedPath)
        return createSuccessResponse({})
      } catch (error: any) {
        console.error('[IPC] file-manager:show-in-folder error:', error)
        return createErrorResponse(error, { operation: 'fileManager' })
      }
    }
  )

  // ==================== 监听 tracker flush 事件，推送给渲染进程 ====================

  if (fileChangeTracker) {
    fileChangeTracker.on('files-updated', (sessionId: string, files: any[]) => {
      sendToRenderer('file-manager:session-files-updated', { sessionId, files })
    })
  }

  // ==================== get-file-diff：获取文件 git diff ====================

  ipcMain.handle('file-manager:get-file-diff', async (_event, filePath: string) => {
    try {
      const normalizedPath = await assertFileManagerPathAllowed(deps, filePath, 'fileManager.getFileDiff')
      const dir = path.dirname(normalizedPath)

      // 执行 git diff HEAD -- <file>，获取未提交改动
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileAsync = promisify(execFile)

      let rawDiff = ''
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['diff', 'HEAD', '--', normalizedPath],
          { cwd: dir, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }
        )
        rawDiff = stdout
      } catch {
        // git diff 失败（可能是新建文件未被 git 追踪），尝试 git diff --cached
        try {
          const { execFile: execFile2 } = await import('child_process')
          const execFile2Async = promisify(execFile2)
          const { stdout } = await execFile2Async(
            'git',
            ['diff', '--cached', '--', normalizedPath],
            { cwd: dir, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }
          )
          rawDiff = stdout
        } catch {
          rawDiff = ''
        }
      }

      // 解析 diff 输出为结构化数据
      const hunks = parseDiff(rawDiff)
      return { hunks, raw: rawDiff }
    } catch (error: any) {
      console.error('[IPC] file-manager:get-file-diff error:', error)
      return { hunks: [], raw: '', error: createErrorResponse(error, { operation: 'fileManager.getFileDiff' }).error }
    }
  })
}

// ─────────────────────────────────────────────────────────
// diff 解析工具
// ─────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk-header'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

function parseDiff(raw: string): DiffHunk[] {
  if (!raw.trim()) return []

  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of raw.split('\n')) {
    // hunk 头：@@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk)
      oldLine = parseInt(hunkMatch[1], 10)
      newLine = parseInt(hunkMatch[2], 10)
      currentHunk = { header: line, lines: [] }
      continue
    }

    // 跳过 diff --git / index / --- / +++ 头部信息
    if (!currentHunk) continue
    if (line.startsWith('diff ') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ')) continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), newLineNo: newLine++ })
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLineNo: oldLine++ })
    } else if (line.startsWith(' ') || line === '') {
      currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLineNo: oldLine++, newLineNo: newLine++ })
    }
  }

  if (currentHunk) hunks.push(currentHunk)
  return hunks
}
