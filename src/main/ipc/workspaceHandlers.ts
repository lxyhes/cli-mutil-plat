/**
 * Workspace IPC 处理器 - 工作区管理
 * 支持多仓库 git worktree 隔离、VS Code .code-workspace 导入、目录扫描
 * @author weibin
 */

import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { IPC } from '../../shared/constants'
import { GitWorktreeService } from '../git/GitWorktreeService'
import type { IpcDependencies } from './index'
import { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'

function normalizePrimaryFlags<T extends { isPrimary: boolean }>(repos: T[]): T[] {
  let primaryFound = false
  return repos.map(repo => {
    if (!repo.isPrimary) return repo
    if (!primaryFound) {
      primaryFound = true
      return repo
    }
    return { ...repo, isPrimary: false }
  })
}

export function registerWorkspaceHandlers(deps: IpcDependencies): void {
  const { database } = deps
  const gitService = new GitWorktreeService()

  // ---- 查询所有工作区 ----
  ipcMain.handle(IPC.WORKSPACE_LIST, async () => {
    try {
      return database.getAllWorkspaces()
    } catch (error: any) {
      console.error('[IPC] WORKSPACE_LIST error:', error)
      return []
    }
  })

  // ---- 查询单个工作区 ----
  ipcMain.handle(IPC.WORKSPACE_GET, async (_event, workspaceId: string) => {
    try {
      return database.getWorkspace(workspaceId) ?? null
    } catch (error: any) {
      console.error('[IPC] WORKSPACE_GET error:', error)
      return null
    }
  })

  // ---- 创建工作区 ----
  ipcMain.handle(IPC.WORKSPACE_CREATE, async (_event, data: {
    name: string
    description?: string
    rootPath?: string
    repos: Array<{ repoPath: string; name: string; isPrimary: boolean }>
  }) => {
    try {
      if (!data.name?.trim()) {
        throw new SpectrAIError({
        code: ErrorCode.INVALID_INPUT,
        message: 'Workspace name cannot be empty',
        userMessage: '工作区名称不能为空'
      })
      }
      if (!data.repos || data.repos.length === 0) {
        throw new SpectrAIError({
        code: ErrorCode.INVALID_INPUT,
        message: 'At least one repository required',
        userMessage: '至少需要添加一个仓库'
      })
      }

      // 验证所有仓库路径均为有效 git 仓库
      for (const repo of data.repos) {
        const valid = await gitService.isGitRepo(repo.repoPath)
        if (!valid) {
          throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'Path is not a git repository',
          userMessage: `路径不是 git 仓库: ${repo.repoPath}`,
          context: { repoPath: repo.repoPath }
        })
        }
      }

      const normalizedRepos = normalizePrimaryFlags(data.repos)

      const workspaceId = uuidv4()
      const repos = normalizedRepos.map((r, i) => ({
        id: uuidv4(),
        repoPath: r.repoPath,
        name: r.name || path.basename(r.repoPath),
        isPrimary: r.isPrimary,
        sortOrder: i,
      }))

      database.createWorkspace(
        {
          id: workspaceId,
          name: data.name.trim(),
          description: data.description?.trim(),
          rootPath: data.rootPath,
        },
        repos
      )

      console.log(`[IPC] Workspace created: ${workspaceId} (${data.repos.length} repos)`)
      return createSuccessResponse({ workspaceId })
    } catch (error: any) {
      console.error('[IPC] WORKSPACE_CREATE error:', error)
      return createErrorResponse(error, { operation: 'workspace' })
    }
  })

  // ---- 更新工作区 ----
  ipcMain.handle(IPC.WORKSPACE_UPDATE, async (_event, workspaceId: string, data: {
    name?: string
    description?: string
    rootPath?: string
    repos?: Array<{ id?: string; repoPath: string; name: string; isPrimary: boolean; sortOrder?: number }>
  }) => {
    try {
      const existing = database.getWorkspace(workspaceId)
      if (!existing) {
        throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'Workspace not found',
        userMessage: '工作区不存在',
        context: { workspaceId }
      })
      }

      // 若有仓库更新，验证路径合法性
      const normalizedRepos = data.repos ? normalizePrimaryFlags(data.repos) : undefined
      if (normalizedRepos) {
        for (const repo of normalizedRepos) {
          const valid = await gitService.isGitRepo(repo.repoPath)
          if (!valid) {
            throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'Path is not a git repository',
          userMessage: `路径不是 git 仓库: ${repo.repoPath}`,
          context: { repoPath: repo.repoPath }
        })
          }
        }
      }

      const reposForUpdate = normalizedRepos?.map((r, i) => ({
        id: r.id || uuidv4(),
        repoPath: r.repoPath,
        name: r.name || path.basename(r.repoPath),
        isPrimary: r.isPrimary,
        sortOrder: r.sortOrder ?? i,
      }))

      database.updateWorkspace(workspaceId, {
        name: data.name,
        description: data.description,
        rootPath: data.rootPath,
      }, reposForUpdate)

      return createSuccessResponse({})
    } catch (error: any) {
      console.error('[IPC] WORKSPACE_UPDATE error:', error)
      return createErrorResponse(error, { operation: 'workspace' })
    }
  })

  // ---- 删除工作区 ----
  ipcMain.handle(IPC.WORKSPACE_DELETE, async (_event, workspaceId: string) => {
    try {
      const existing = database.getWorkspace(workspaceId)
      if (!existing) {
        throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'Workspace not found',
        userMessage: '工作区不存在',
        context: { workspaceId }
      })
      }
      database.deleteWorkspace(workspaceId)
      return createSuccessResponse({})
    } catch (error: any) {
      console.error('[IPC] WORKSPACE_DELETE error:', error)
      return createErrorResponse(error, { operation: 'workspace' })
    }
  })

  // ---- 扫描目录，发现子 git 仓库 ----
  ipcMain.handle(IPC.WORKSPACE_SCAN_REPOS, async (_event, dirPath: string) => {
    try {
      if (!fs.existsSync(dirPath)) {
        throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'Directory does not exist',
        userMessage: '目录不存在',
        context: { dirPath }
      })
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      const results: Array<{ repoPath: string; name: string }> = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const subPath = path.join(dirPath, entry.name)
        // 跳过隐藏目录
        if (entry.name.startsWith('.')) continue
        try {
          const isRepo = await gitService.isGitRepo(subPath)
          if (isRepo) {
            results.push({ repoPath: subPath, name: entry.name })
          }
        } catch {
          // 跳过无法访问的目录
        }
      }

      return createSuccessResponse({ repos: results })
    } catch (error: any) {
      console.error('[IPC] WORKSPACE_SCAN_REPOS error:', error)
      return createErrorResponse(error, { operation: 'workspace-scan' })
    }
  })

  // ---- 导入 VS Code .code-workspace 文件 ----
  ipcMain.handle(IPC.WORKSPACE_IMPORT_VSCODE, async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'File does not exist',
        userMessage: '文件不存在',
        context: { filePath }
      })
      }

      const raw = fs.readFileSync(filePath, 'utf-8')
      // .code-workspace 文件可能有 JSON 注释（JSONC 格式），需要容错
      // 使用逐字符解析，避免盲目正则误删字符串内的 //（如 URL）
      let parsed: any
      try {
        // 先尝试标准 JSON
        parsed = JSON.parse(raw)
      } catch {
        // JSONC 注释剥离：逐行处理行注释，跳过字符串内的 //
        const stripped = raw
          .split('\n')
          .map(line => {
            let inString = false
            let escape = false
            for (let i = 0; i < line.length; i++) {
              const ch = line[i]
              if (escape) { escape = false; continue }
              if (ch === '\\' && inString) { escape = true; continue }
              if (ch === '"') { inString = !inString; continue }
              if (!inString && ch === '/' && line[i + 1] === '/') {
                return line.substring(0, i) // 行注释开始，截断
              }
            }
            return line
          })
          .join('\n')
          // 块注释（/*...*/），.code-workspace 中较少见但兼容处理
          .replace(/\/\*[\s\S]*?\*\//g, '')
        parsed = JSON.parse(stripped)
      }

      if (!parsed.folders || !Array.isArray(parsed.folders)) {
        throw new SpectrAIError({
        code: ErrorCode.INVALID_INPUT,
        message: 'Invalid .code-workspace file',
        userMessage: '无效的 .code-workspace 文件（缺少 folders 字段）',
        context: { filePath }
      })
      }

      const workspaceDir = path.dirname(filePath)
      const repos: Array<{ repoPath: string; name: string }> = []

      for (const folder of parsed.folders) {
        if (!folder.path) continue
        // 解析相对/绝对路径
        const resolvedPath = path.isAbsolute(folder.path)
          ? folder.path
          : path.resolve(workspaceDir, folder.path)

        const name = folder.name || path.basename(resolvedPath)
        if (fs.existsSync(resolvedPath)) {
          repos.push({ repoPath: resolvedPath, name })
        }
      }

      if (repos.length === 0) {
        throw new SpectrAIError({
        code: ErrorCode.NOT_FOUND,
        message: 'No valid repository paths found',
        userMessage: '未找到有效的仓库路径',
        context: { filePath }
      })
      }

      // 推荐工作区名称（取文件名去后缀）
      const suggestedName = path.basename(filePath, '.code-workspace')
      return createSuccessResponse({ repos, suggestedName })
    } catch (error: any) {
      console.error('[IPC] WORKSPACE_IMPORT_VSCODE error:', error)
      return createErrorResponse(error, { operation: 'workspace-scan' })
    }
  })
}
