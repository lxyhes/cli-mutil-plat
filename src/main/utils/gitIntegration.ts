/**
 * Git 集成工具 - 自动创建 commit 并关联交付包
 * 
 * 功能:
 * 1. 在生成交付包后自动暂存所有改动
 * 2. 使用交付包中的建议提交信息创建 commit
 * 3. 在 commit message 中附加交付包元数据（hash、生成时间等）
 * 4. 可选：推送至远程仓库
 */

import { GitWorktreeService } from '../git/GitWorktreeService'

export interface AutoCommitOptions {
  /** 仓库路径 */
  repoPath: string
  /** 提交信息 */
  commitMessage: string
  /** 交付包哈希（用于追溯） */
  deliveryPackHash?: string
  /** 是否暂存所有文件（默认 true） */
  stageAll?: boolean
  /** 是否推送到远程（默认 false） */
  pushToRemote?: boolean
  /** Git 服务实例 */
  gitService?: GitWorktreeService
}

export interface AutoCommitResult {
  success: boolean
  commitHash?: string
  error?: string
  pushed?: boolean
}

/**
 * 自动创建 Git commit 并关联交付包
 */
export async function autoCommitWithDeliveryPack(
  options: AutoCommitOptions
): Promise<AutoCommitResult> {
  const gitService = options.gitService || new GitWorktreeService()

  try {
    // 1. 验证是否为 Git 仓库
    const isRepo = await gitService.isGitRepo(options.repoPath)
    if (!isRepo) {
      return {
        success: false,
        error: '当前目录不是 Git 仓库',
      }
    }

    // 2. 检查是否有改动
    const isDirty = await gitService.isDirty(options.repoPath)
    if (!isDirty && !options.stageAll) {
      return {
        success: false,
        error: '工作区没有未提交的改动',
      }
    }

    // 3. 构建增强版提交信息（包含交付包元数据）
    const enhancedMessage = buildEnhancedCommitMessage({
      message: options.commitMessage,
      deliveryPackHash: options.deliveryPackHash,
    })

    // 4. 暂存文件
    if (options.stageAll !== false) {
      await gitService.stageAll(options.repoPath)
    }

    // 5. 创建 commit
    await gitService.commit(options.repoPath, enhancedMessage)

    // 6. 获取 commit hash
    const commitHash = await gitService.getHeadCommit(options.repoPath)

    // 7. 可选：推送到远程
    let pushed = false
    if (options.pushToRemote) {
      const pushResult = await gitService.push(options.repoPath)
      pushed = pushResult.success
      if (!pushResult.success) {
        console.warn('[Git Integration] Push failed:', pushResult.output)
      }
    }

    return {
      success: true,
      commitHash,
      pushed,
    }
  } catch (error: any) {
    console.error('[Git Integration] Auto-commit failed:', error)
    return {
      success: false,
      error: error.message || 'Git commit 失败',
    }
  }
}

/**
 * 构建增强版提交信息
 * 格式:
 * ```
 * <原始提交信息>
 * 
 * 📦 Delivery Pack: <hash>
 * ⏰ Generated: <ISO timestamp>
 * 🔗 prismops://delivery/<hash>
 * ```
 */
function buildEnhancedCommitMessage(options: {
  message: string
  deliveryPackHash?: string
}): string {
  const lines: string[] = [options.message]

  if (options.deliveryPackHash) {
    const timestamp = new Date().toISOString()
    lines.push('')
    lines.push(`📦 Delivery Pack: ${options.deliveryPackHash}`)
    lines.push(`⏰ Generated: ${timestamp}`)
    lines.push(`🔗 prismops://delivery/${options.deliveryPackHash}`)
  }

  return lines.join('\n')
}

/**
 * 从交付包 Markdown 中提取建议的提交信息
 */
export function extractSuggestedCommitMessage(deliveryPackMarkdown: string): string {
  // 查找 "## 建议提交说明" 部分
  const match = deliveryPackMarkdown.match(/## 建议提交说明\s*\n\s*([\s\S]*?)(?=\n##|$)/i)
  if (match && match[1]) {
    return match[1].trim()
  }

  // 查找 "suggestedCommitMessage" 字段
  const jsonMatch = deliveryPackMarkdown.match(/"suggestedCommitMessage"\s*:\s*"([^"]+)"/)
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1]
  }

  // 默认提交信息
  return 'chore: update delivery work'
}

/**
 * 检测是否需要自动 commit
 * 条件:
 * 1. 用户启用了自动 commit 功能
 * 2. 有文件改动
 * 3. 已生成交付包
 * 4. 交付门禁全部通过
 */
export function shouldAutoCommit(context: {
  autoCommitEnabled: boolean
  changedFileCount: number
  deliveryPackGenerated: boolean
  allGatesPassed: boolean
}): boolean {
  return (
    context.autoCommitEnabled &&
    context.changedFileCount > 0 &&
    context.deliveryPackGenerated &&
    context.allGatesPassed
  )
}
