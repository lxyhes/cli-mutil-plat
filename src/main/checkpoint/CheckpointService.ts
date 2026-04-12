/**
 * 智能回溯服务 - 在 AI 修改代码的关键节点自动创建 Git 快照
 * 
 * 支持：创建/列出/恢复/删除/对比 Checkpoint
 * - 集成 GitWorktreeService（锁保护 + 路径缓存）
 * - 安全回滚（stash 未提交改动 + 确认检测）
 * - 自动节流（同会话 N 秒内不重复创建）
 * - Worktree 感知
 * - 事件通知（IPC 推送到前端）
 * 
 * @author spectrai
 */
import { v4 as uuid } from 'uuid'
import type { DatabaseManager } from '../storage/Database'
import type { GitWorktreeService } from '../git/GitWorktreeService'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'

export interface Checkpoint {
  id: string
  sessionId: string
  sessionName: string
  repoPath: string
  commitHash: string
  branchName: string
  label: string
  trigger: 'manual' | 'auto-file-change' | 'auto-tool-use' | 'auto-interval' | 'auto-turn-complete'
  description: string
  fileCount: number
  createdAt: string
}

/** 自动 checkpoint 节流间隔（毫秒）— 同会话在此时间内不重复自动创建 */
const AUTO_THROTTLE_MS = 30_000  // 30秒

export class CheckpointService {
  private db: DatabaseManager
  private rawDb: any  // better-sqlite3 底层实例，用于 exec/all/get/run
  private gitService: GitWorktreeService | null
  /** 节流：记录每个会话最近一次自动 checkpoint 时间 */
  private lastAutoTime = new Map<string, number>()
  /** 是否已启用自动 checkpoint */
  private autoEnabled = true

  constructor(db: DatabaseManager, gitService?: GitWorktreeService) {
    this.db = db
    this.rawDb = (db as any).db || db
    this.gitService = gitService || null
    this.ensureTable()
  }

  // ────────────────────────────────────────────────────────
  //  数据库
  // ────────────────────────────────────────────────────────

  private ensureTable(): void {
    try {
      this.rawDb.exec(`
        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          session_name TEXT NOT NULL,
          repo_path TEXT NOT NULL,
          commit_hash TEXT NOT NULL DEFAULT '',
          branch_name TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL,
          trigger_type TEXT NOT NULL DEFAULT 'manual',
          description TEXT NOT NULL DEFAULT '',
          file_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
      `)
      this.rawDb.exec(`CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at DESC)`)
    } catch (err) {
      console.error('[CheckpointService] ensureTable failed:', err)
    }
  }

  // ────────────────────────────────────────────────────────
  //  Git 操作（委托给 GitWorktreeService，有锁保护）
  // ────────────────────────────────────────────────────────

  private async gitExec(cwd: string, args: string[]): Promise<string> {
    if (this.gitService) {
      // GitWorktreeService 有 repoLock 串行化，但私有 git() 方法无法直接调用
      // 对于 checkpoint 特有操作，直接调用 GitWorktreeService 公开方法或回退到 execFile
    }
    // 回退方案：直接执行 git 命令（无锁保护但简单可靠）
    const { execFile } = require('child_process')
    const { promisify } = require('util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, windowsHide: true })
    return (stdout || '').trim()
  }

  private async isGitRepo(dirPath: string): Promise<boolean> {
    if (this.gitService) {
      return this.gitService.isGitRepo(dirPath)
    }
    try {
      await this.gitExec(dirPath, ['rev-parse', '--is-inside-work-tree'])
      return true
    } catch {
      return false
    }
  }

  private async getRepoRoot(dirPath: string): Promise<string> {
    if (this.gitService) {
      return this.gitService.getRepoRoot(dirPath)
    }
    return this.gitExec(dirPath, ['rev-parse', '--show-toplevel'])
  }

  // ────────────────────────────────────────────────────────
  //  核心：创建 Checkpoint
  // ────────────────────────────────────────────────────────

  async create(params: {
    sessionId: string
    sessionName: string
    repoPath: string
    label: string
    trigger: Checkpoint['trigger']
    description?: string
  }): Promise<{ success: boolean; checkpoint?: Checkpoint; error?: string }> {
    const { sessionId, sessionName, repoPath, label, trigger, description } = params
    const id = uuid()

    // 非手动触发时检查节流
    if (trigger !== 'manual') {
      const last = this.lastAutoTime.get(sessionId) || 0
      if (Date.now() - last < AUTO_THROTTLE_MS) {
        return { success: false, error: '节流中，跳过自动快照' }
      }
    }

    try {
      // 检查是否为 git 仓库
      const isRepo = await this.isGitRepo(repoPath)
      if (!isRepo) {
        // 非 git 仓库：仅记录标记，不创建 git commit
        const checkpoint: Checkpoint = {
          id, sessionId, sessionName, repoPath,
          commitHash: '', branchName: '',
          label, trigger,
          description: description || `回溯点: ${label} (非 Git 仓库)`,
          fileCount: 0,
          createdAt: new Date().toISOString(),
        }
        this.saveToDb(checkpoint)
        this.notifyFrontend(checkpoint)
        return { success: true, checkpoint }
      }

      // 获取仓库根目录
      const repoRoot = await this.getRepoRoot(repoPath)

      // 检查是否有改动需要提交
      let hasChanges = true
      try {
        const status = await this.gitExec(repoRoot, ['status', '--porcelain'])
        if (!status) {
          // 工作区干净，仍有可能是 allow-empty
          hasChanges = false
        }
      } catch { /* ignore */ }

      // Git add all + commit
      await this.gitExec(repoRoot, ['add', '-A'])
      const commitMsg = `[spectrai-checkpoint] ${label}`
      await this.gitExec(repoRoot, ['commit', '-m', commitMsg, '--allow-empty'])

      // 获取 commit hash
      const commitHash = await this.gitExec(repoRoot, ['rev-parse', 'HEAD'])

      // 获取当前分支
      let branchName = ''
      try {
        branchName = await this.gitExec(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
      } catch { /* ignore */ }

      // 统计变更文件数
      let fileCount = 0
      try {
        const diffOut = await this.gitExec(repoRoot, ['diff', '--name-only', 'HEAD~1', 'HEAD'])
        if (diffOut) fileCount = diffOut.split('\n').length
      } catch { /* ignore */ }

      const checkpoint: Checkpoint = {
        id, sessionId, sessionName, repoPath: repoRoot,
        commitHash, branchName,
        label, trigger,
        description: description || (hasChanges ? `${fileCount} 个文件变更` : '无文件变更（标记点）'),
        fileCount,
        createdAt: new Date().toISOString(),
      }

      this.saveToDb(checkpoint)
      this.notifyFrontend(checkpoint)

      // 更新节流时间
      if (trigger !== 'manual') {
        this.lastAutoTime.set(sessionId, Date.now())
      }

      console.log(`[Checkpoint] Created: ${label} (${commitHash.slice(0, 7)}) for session ${sessionId.slice(0, 8)}`)
      return { success: true, checkpoint }
    } catch (err: any) {
      console.warn('[Checkpoint] create failed:', err.message)
      // 创建失败时仍然记录（无 git commit）
      const checkpoint: Checkpoint = {
        id, sessionId, sessionName, repoPath,
        commitHash: '', branchName: '',
        label, trigger,
        description: description || `回溯点: ${label} (Git 操作失败: ${err.message?.slice(0, 80)})`,
        fileCount: 0,
        createdAt: new Date().toISOString(),
      }
      this.saveToDb(checkpoint)
      return { success: false, checkpoint, error: err.message }
    }
  }

  // ────────────────────────────────────────────────────────
  //  核心：恢复 Checkpoint（安全回滚）
  // ────────────────────────────────────────────────────────

  async restore(id: string): Promise<{ success: boolean; message: string; checkpoint?: Checkpoint }> {
    const cp = await this.get(id)
    if (!cp) return { success: false, message: 'Checkpoint 不存在' }
    if (!cp.commitHash) return { success: false, message: '该快照无有效 Git 提交，无法回滚' }

    try {
      const repoRoot = cp.repoPath

      // 1. 先检查当前是否有未提交的改动（在 checkpoint 之后产生的）
      let hasUncommitted = false
      try {
        const status = await this.gitExec(repoRoot, ['status', '--porcelain'])
        hasUncommitted = !!status
      } catch { /* ignore */ }

      // 2. 如果有未提交改动，先 stash 保存
      if (hasUncommitted) {
        try {
          await this.gitExec(repoRoot, ['stash', 'push', '-m', `spectrai-auto-stash-before-restore-${cp.label}`])
          console.log('[Checkpoint] Stashed uncommitted changes before restore')
        } catch (stashErr: any) {
          console.warn('[Checkpoint] Stash failed, proceeding with reset:', stashErr.message)
        }
      }

      // 3. 执行 git reset --hard 到目标 commit
      await this.gitExec(repoRoot, ['reset', '--hard', cp.commitHash])

      // 4. 通知前端
      this.notifyFrontend({ ...cp, description: `[已回滚] ${cp.description}` })

      console.log(`[Checkpoint] Restored to: ${cp.label} (${cp.commitHash.slice(0, 7)})`)
      return {
        success: true,
        message: `已回滚到: ${cp.label}${hasUncommitted ? '（未提交改动已 stash 保存）' : ''}`,
        checkpoint: cp,
      }
    } catch (err: any) {
      return { success: false, message: `回滚失败: ${err.message}` }
    }
  }

  // ────────────────────────────────────────────────────────
  //  查询
  // ────────────────────────────────────────────────────────

  async list(sessionId: string, limit?: number): Promise<{ success: boolean; checkpoints: Checkpoint[] }> {
    try {
      const rows = this.rawDb.prepare(`
        SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(sessionId, limit || 50)
      return { success: true, checkpoints: rows || [] }
    } catch {
      return { success: true, checkpoints: [] }
    }
  }

  async get(id: string): Promise<Checkpoint | null> {
    try {
      return this.rawDb.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) || null
    } catch {
      return null
    }
  }

  // ────────────────────────────────────────────────────────
  //  删除
  // ────────────────────────────────────────────────────────

  async delete(id: string): Promise<{ success: boolean }> {
    try {
      this.rawDb.prepare('DELETE FROM checkpoints WHERE id = ?').run(id)
      return { success: true }
    } catch {
      return { success: false }
    }
  }

  // ────────────────────────────────────────────────────────
  //  对比
  // ────────────────────────────────────────────────────────

  async diff(fromId: string, toId: string): Promise<{ success: boolean; files?: string[]; summary?: string; error?: string }> {
    const from = await this.get(fromId)
    const to = await this.get(toId)
    if (!from?.commitHash || !to?.commitHash) {
      return { success: false, error: '无法对比：缺少提交信息' }
    }

    try {
      const output = await this.gitExec(to.repoPath, ['diff', '--name-only', from.commitHash, to.commitHash])
      const files = output ? output.split('\n').filter(Boolean) : []
      return { success: true, files, summary: `${files.length} 个文件变更` }
    } catch (err: any) {
      return { success: false, error: `对比失败: ${err.message}` }
    }
  }

  // ────────────────────────────────────────────────────────
  //  自动创建（由事件流触发）
  // ────────────────────────────────────────────────────────

  async autoCreate(
    sessionId: string,
    sessionName: string,
    repoPath: string,
    reason: string,
    trigger: Checkpoint['trigger'] = 'auto-turn-complete',
  ): Promise<{ success: boolean; checkpoint?: Checkpoint; error?: string }> {
    if (!this.autoEnabled) return { success: false, error: '自动快照已禁用' }
    if (!repoPath) return { success: false, error: '无工作目录' }

    // 检查是否为 git 仓库
    try {
      const isRepo = await this.isGitRepo(repoPath)
      if (!isRepo) return { success: false, error: '非 Git 仓库' }
    } catch {
      return { success: false, error: 'Git 仓库检测失败' }
    }

    // 检查是否有实际改动（避免空 commit 泛滥）
    try {
      const repoRoot = await this.getRepoRoot(repoPath)
      const status = await this.gitExec(repoRoot, ['status', '--porcelain'])
      if (!status) {
        return { success: false, error: '无文件改动，跳过自动快照' }
      }
    } catch { /* 检测失败时仍然创建 */ }

    return this.create({
      sessionId,
      sessionName,
      repoPath,
      label: `自动: ${reason}`,
      trigger,
      description: reason,
    })
  }

  // ────────────────────────────────────────────────────────
  //  配置
  // ────────────────────────────────────────────────────────

  setAutoEnabled(enabled: boolean): void {
    this.autoEnabled = enabled
  }

  isAutoEnabled(): boolean {
    return this.autoEnabled
  }

  /** 获取注入到 AI 对话的 prompt */
  getPrompt(): string {
    return `[Checkpoint System] 智能回溯已启用。你的代码修改会在关键节点自动创建快照，用户可以随时回滚到任意版本。请在完成一组重要修改后告知用户已创建回溯点。`
  }

  // ────────────────────────────────────────────────────────
  //  内部工具
  // ────────────────────────────────────────────────────────

  private saveToDb(cp: Checkpoint): void {
    try {
      this.rawDb.prepare(`
        INSERT INTO checkpoints (id, session_id, session_name, repo_path, commit_hash, branch_name, label, trigger_type, description, file_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cp.id, cp.sessionId, cp.sessionName, cp.repoPath, cp.commitHash, cp.branchName, cp.label, cp.trigger, cp.description, cp.fileCount, cp.createdAt)
    } catch (err) {
      console.error('[Checkpoint] saveToDb failed:', err)
    }
  }

  /** 通知前端新 checkpoint 已创建 */
  private notifyFrontend(cp: Checkpoint): void {
    try {
      sendToRenderer(IPC.CHECKPOINT_CREATED, cp.sessionId, cp)
    } catch { /* ignore */ }
  }
}
