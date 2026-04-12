/**
 * Workspace 多仓库上下文 Prompt 构建/注入
 *
 * 当任务绑定了 Workspace 时，将所有仓库信息注入 session 规则文件，
 * 让 AI 知道当前任务涵盖哪些仓库及其 worktree 路径
 *
 * @author weibin
 */

import * as path from 'path'
import {
  ensureRulesDir,
  getRulesFilePath,
  appendToRulesFile,
  upsertManagedBlock,
  removeManagedBlock,
} from './rulesFiles'

/**
 * 构建工作区多仓库上下文描述（Task 模式：worktree 已预建）
 * @param repos - 仓库信息列表（每个仓库含名称、worktreePath、isPrimary）
 * @returns Markdown 格式的仓库上下文描述
 */
export function buildWorkspaceSection(
  repos: Array<{ name: string; worktreePath: string; isPrimary: boolean }>
): string {
  if (!repos || repos.length === 0) return ''
  const hasPrimary = repos.some(r => r.isPrimary)

  const repoLines = repos.map(r => {
    const tag = r.isPrimary ? '（主仓库，AI 工作目录）' : ''
    return `- **${r.name}**${tag}: \`${r.worktreePath}\``
  })

  return `
## 多仓库工作区

当前任务绑定了一个包含多个 Git 仓库的工作区，所有仓库均已在独立 worktree 分支中准备就绪：

${repoLines.join('\n')}

### 重要说明

- ${hasPrimary
    ? '**主仓库**（标记为"主仓库，AI 工作目录"）是你当前所在目录，也是你的主要工作区'
    : '当前未设置主仓库：默认以列表中的第一个仓库作为工作目录'}
- **其他仓库**的 worktree 路径已列出，可在需要时直接访问这些目录
- 不同仓库之间可能存在接口依赖（如前端调用后端 API），跨仓库修改时注意保持接口一致性
- 所有仓库的 worktree 都在同一任务分支上工作，最终需要逐仓库合并回主分支
`
}

/**
 * 构建普通会话（非 Task）的工作区上下文描述
 * 区别于 buildWorkspaceSection：不声称"worktrees已准备就绪"，
 * 而是如实描述各仓库路径，并说明每个仓库需独立使用 enter_worktree。
 */
export function buildWorkspaceSessionSection(
  repos: Array<{ name: string; repoPath: string; isPrimary: boolean }>
): string {
  if (!repos || repos.length === 0) return ''
  const hasPrimary = repos.some(r => r.isPrimary)

  const repoLines = repos.map(r => {
    const tag = r.isPrimary ? '（主仓库，当前工作目录）' : ''
    return `- **${r.name}**${tag}: \`${r.repoPath}\``
  })

  return `
## 多仓库工作区

当前会话绑定了一个包含多个 Git 仓库的工作区：

${repoLines.join('\n')}

### 重要说明

- ${hasPrimary
    ? '**主仓库**（标记为"当前工作目录"）是你的启动目录，autoWorktree 规则对该目录生效'
    : '当前未设置主仓库：默认以列表中的第一个仓库作为启动目录，autoWorktree 规则对该目录生效'}
- **其他仓库**的路径已列出，你可以直接读取、搜索这些目录中的文件
- 若需要修改**其他仓库**的文件，应先 \`cd\` 到对应仓库路径，再按照该仓库自身的 git 状态决定是否创建 worktree（使用 \`enter_worktree\`）
- 不同仓库之间可能存在接口依赖（如前端调用后端 API），跨仓库修改时注意保持接口一致性
`
}

/**
 * 在已有的规则文件末尾追加 Workspace 多仓库上下文（不覆盖原内容）
 * 供 Task/Planner 流调用：worktree 已预建，文案声称"分支已就绪"
 */
export function injectWorkspaceSection(
  workDir: string,
  repos: Array<{ name: string; worktreePath: string; isPrimary: boolean }>
): void {
  if (!repos || repos.length === 0) return

  const section = buildWorkspaceSection(repos)
  if (!section) return

  appendToRulesFile(workDir, section)
  console.log(`[Workspace] Injected workspace section (task): ${getRulesFilePath(workDir)}`)
}

/**
 * 在已有的规则文件末尾追加 Workspace 多仓库上下文（不覆盖原内容）
 * 供普通 Session 创建流调用：worktree 未预建，如实描述各仓库路径
 */
export function injectWorkspaceSessionSection(
  workDir: string,
  repos: Array<{ name: string; repoPath: string; isPrimary: boolean }>
): void {
  if (!repos || repos.length === 0) return

  const section = buildWorkspaceSessionSection(repos)
  if (!section) return

  appendToRulesFile(workDir, section)
  console.log(`[Workspace] Injected workspace section (session): ${getRulesFilePath(workDir)}`)
}

// ==================== 第三方 Provider 工作区多仓库上下文注入 ====================

/**
 * 将工作区多仓库上下文注入 AGENTS.md（Codex CLI）
 * 使用 WORKSPACE 块标记，与 WORKTREE / FILEOPS 块互不干扰
 */
export function injectWorkspaceSessionSectionToAgentsMd(
  workDir: string,
  repos: Array<{ name: string; repoPath: string; isPrimary: boolean }>
): string {
  const section = buildWorkspaceSessionSection(repos)
  if (!section) return ''
  const filePath = path.join(workDir, 'AGENTS.md')
  upsertManagedBlock(filePath, section, 'WORKSPACE')
  console.log(`[Workspace] Injected workspace section to AGENTS.md: ${filePath}`)
  return filePath
}

/**
 * 从 AGENTS.md 移除工作区多仓库上下文块（会话结束时调用）
 */
export function cleanupWorkspaceSectionFromAgentsMd(workDir: string): void {
  try {
    removeManagedBlock(path.join(workDir, 'AGENTS.md'), 'WORKSPACE')
    console.log(`[Workspace] Cleaned up AGENTS.md workspace section in: ${workDir}`)
  } catch (_) { /* ignore */ }
}

/**
 * 将工作区多仓库上下文注入 GEMINI.md（Gemini CLI）
 * 使用 WORKSPACE 块标记
 */
export function injectWorkspaceSessionSectionToGeminiMd(
  workDir: string,
  repos: Array<{ name: string; repoPath: string; isPrimary: boolean }>
): string {
  const section = buildWorkspaceSessionSection(repos)
  if (!section) return ''
  const filePath = path.join(workDir, 'GEMINI.md')
  upsertManagedBlock(filePath, section, 'WORKSPACE')
  console.log(`[Workspace] Injected workspace section to GEMINI.md: ${filePath}`)
  return filePath
}

/**
 * 从 GEMINI.md 移除工作区多仓库上下文块（会话结束时调用）
 */
export function cleanupWorkspaceSectionFromGeminiMd(workDir: string): void {
  try {
    removeManagedBlock(path.join(workDir, 'GEMINI.md'), 'WORKSPACE')
    console.log(`[Workspace] Cleaned up GEMINI.md workspace section in: ${workDir}`)
  } catch (_) { /* ignore */ }
}
