/**
 * 智能回溯服务 - 在 AI 修改代码的关键节点自动创建 Git 快照
 * 支持：创建/列出/恢复/删除/对比 Checkpoint
 * @author spectrai
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { v4 as uuid } from 'uuid'
import { DatabaseManager } from '../storage/Database'

const execFileAsync = promisify(execFile)

export interface Checkpoint {
  id: string
  sessionId: string
  sessionName: string
  repoPath: string
  commitHash: string
  branchName: string
  label: string
  trigger: 'manual' | 'auto-file-change' | 'auto-tool-use' | 'auto-interval'
  description: string
  fileCount: number
  createdAt: string
}

export class CheckpointService {
  private db: DatabaseManager

  constructor(db: DatabaseManager) {
    this.db = db
  }

  /** 创建 checkpoint（git stash + git commit） */
  async create(params: {
    sessionId: string
    sessionName: string
    repoPath: string
    label: string
    trigger: Checkpoint['trigger']
    description?: string
  }): Promise<Checkpoint> {
    const { sessionId, sessionName, repoPath, label, trigger, description } = params
    const id = uuid()

    try {
      // Git add all + commit
      await execFileAsync('git', ['add', '-A'], { cwd: repoPath })
      const commitMsg = `[spectrai-checkpoint] ${label}`
      await execFileAsync('git', ['commit', '-m', commitMsg, '--allow-empty'], { cwd: repoPath })

      // Get commit hash
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoPath })
      const commitHash = stdout.trim()

      // Get current branch
      const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath })
      const branchName = branchOut.trim()

      // Count changed files
      const { stdout: diffOut } = await execFileAsync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: repoPath })
      const fileCount = diffOut.trim() ? diffOut.trim().split('\n').length : 0

      const checkpoint: Checkpoint = {
        id, sessionId, sessionName, repoPath, commitHash, branchName,
        label, trigger, description: description || '',
        fileCount, createdAt: new Date().toISOString(),
      }

      this.db.run(`
        INSERT INTO checkpoints (id, session_id, session_name, repo_path, commit_hash, branch_name, label, trigger_type, description, file_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, sessionId, sessionName, repoPath, commitHash, branchName, label, trigger, description || '', fileCount, checkpoint.createdAt])

      return checkpoint
    } catch (err: any) {
      // Not a git repo or no changes — create record without git commit
      const checkpoint: Checkpoint = {
        id, sessionId, sessionName, repoPath, commitHash: '', branchName: '',
        label, trigger, description: description || `回溯点: ${label} (未创建 Git 提交)`,
        fileCount: 0, createdAt: new Date().toISOString(),
      }
      this.db.run(`
        INSERT INTO checkpoints (id, session_id, session_name, repo_path, commit_hash, branch_name, label, trigger_type, description, file_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, sessionId, sessionName, repoPath, '', '', label, trigger, checkpoint.description, 0, checkpoint.createdAt])
      return checkpoint
    }
  }

  /** 列出会话的所有 checkpoint */
  async list(sessionId: string, limit?: number): Promise<Checkpoint[]> {
    return this.db.all<Checkpoint>(`
      SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    `, [sessionId, limit || 50])
  }

  /** 获取单个 checkpoint */
  async get(id: string): Promise<Checkpoint | null> {
    return this.db.get<Checkpoint>('SELECT * FROM checkpoints WHERE id = ?', [id])
  }

  /** 恢复到某个 checkpoint（git reset --hard） */
  async restore(id: string): Promise<{ success: boolean; message: string }> {
    const cp = await this.get(id)
    if (!cp || !cp.commitHash) return { success: false, message: 'Checkpoint 不存在或无有效提交' }

    try {
      await execFileAsync('git', ['reset', '--hard', cp.commitHash], { cwd: cp.repoPath })
      return { success: true, message: `已回滚到: ${cp.label}` }
    } catch (err: any) {
      return { success: false, message: `回滚失败: ${err.message}` }
    }
  }

  /** 删除 checkpoint 记录 */
  async delete(id: string): Promise<void> {
    this.db.run('DELETE FROM checkpoints WHERE id = ?', [id])
  }

  /** 对比两个 checkpoint */
  async diff(fromId: string, toId: string): Promise<{ files: string[]; summary: string }> {
    const from = await this.get(fromId)
    const to = await this.get(toId)
    if (!from?.commitHash || !to?.commitHash) return { files: [], summary: '无法对比：缺少提交信息' }

    try {
      const { stdout } = await execFileAsync('git', ['diff', '--name-only', from.commitHash, to.commitHash], { cwd: to.repoPath })
      const files = stdout.trim() ? stdout.trim().split('\n') : []
      return { files, summary: `${files.length} 个文件变更` }
    } catch {
      return { files: [], summary: '对比失败' }
    }
  }

  /** 自动创建（由 FileChangeTracker 等触发） */
  async autoCreate(sessionId: string, sessionName: string, repoPath: string, reason: string): Promise<Checkpoint | null> {
    try {
      return await this.create({
        sessionId, sessionName, repoPath,
        label: `自动: ${reason}`,
        trigger: 'auto-file-change',
        description: reason,
      })
    } catch {
      return null
    }
  }

  /** 获取注入到 AI 对话的 prompt */
  getPrompt(): string {
    return `[Checkpoint System] 智能回溯已启用。你的代码修改会在关键节点自动创建快照，用户可以随时回滚。请在完成重要修改后告知用户已创建回溯点。`
  }
}
