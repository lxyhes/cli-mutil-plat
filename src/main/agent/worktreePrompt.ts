/**
 * Worktree 规范 Prompt 构建/注入 + 检测工具
 *
 * 当 autoWorktree 设置开启时，注入规则告知 Claude 在修改代码前必须进入 worktree
 *
 * @author weibin
 */

import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import {
  ensureRulesDir,
  WORKTREE_RULES_FILENAME,
  upsertManagedBlock,
  removeManagedBlock,
} from './rulesFiles'

/**
 * 构建 Worktree 使用规范提示
 * 当 autoWorktree 设置开启时，注入此规则告知 Claude 在修改代码前必须进入 worktree
 * @param baseBranch - 会话创建时检测到的当前 git 分支名（注入到规则中，防止从错误分支创建 worktree）
 */
export function buildWorktreePrompt(baseBranch?: string): string {
  const branchLine = baseBranch
    ? `\n> ⚠️ **当前主分支为 \`${baseBranch}\`**，\`enter_worktree\` 必须在此分支上调用，新 worktree 才会基于正确的代码基线创建。\n`
    : ''

  return `# Worktree 隔离规范

当前项目已启用 **Git Worktree 隔离模式**（由 SpectrAI autoWorktree 设置控制）。
${branchLine}
## 规则

在对项目文件进行任何 **新建、编辑、删除** 操作之前，**必须先** 调用 \`enter_worktree\` 工具切换到隔离的 git worktree 分支，然后再进行操作。

## 标准流程

1. 收到代码修改任务 → 用 \`git branch --show-current\` 确认当前分支是 \`${baseBranch ?? '<主分支>'}\`
   - 如果不是，先执行 \`git checkout ${baseBranch ?? '<主分支>'}\` 切回主分支
2. **用 \`git status\` 检查是否有未提交的改动**
   - 如果有，先提醒用户并执行 \`git stash\` 或让用户先 commit，再继续
   - 未提交的改动不会随 worktree 带走，合并时会引发冲突
3. 调用 \`enter_worktree\` 创建隔离分支（将基于当前 HEAD 创建新分支）
4. 在 worktree 分支中完成所有文件修改并提交（\`git add <files> && git commit -m "..."\`）
5. 完成后**必须主动询问用户**："改动已完成，是否合并回 \`${baseBranch ?? '<主分支>'}\`？"
   - 用户确认 → 按下方"合并回主分支流程"执行
   - 用户拒绝 → 告知 worktree 分支名，提示用户可稍后手动合并

## 合并回主分支流程

> ⚠️ \`enter_worktree\` 的"退出提示合并"仅在独立会话退出时触发，**同一对话内使用 \`enter_worktree\` 不会自动弹出提示**，必须手动执行以下步骤：

1. 确认 worktree 内改动已全部 commit
2. 切回主仓库根目录执行合并：
   \`\`\`
   cd <项目根目录>
   git merge <worktree-branch> --no-ff
   \`\`\`
3. 合并成功后清理 worktree 分支：
   \`\`\`
   git worktree remove .claude/worktrees/<name> --force
   git branch -d <worktree-branch>
   \`\`\`
   若 \`--force\` 仍报错（目录被其他会话占用，Windows 文件锁），改用备用方案：
   \`\`\`
   rm -rf .claude/worktrees/<name>
   git worktree prune
   git branch -d <worktree-branch>
   \`\`\`

## 注意

- \`enter_worktree\` 基于**当前 HEAD（已提交状态）** 创建新分支，工作目录的未提交改动不会被带入
- 若主分支工作目录有未提交改动，合并 worktree 时同区域文件会产生冲突
- 不要在已有的 worktree 目录中再次调用 \`enter_worktree\`
- **worktree 可能基于较旧的 \`${baseBranch ?? '<主分支>'}\` 提交创建**（其他 worktree 的改动尚未合并回主分支时）。若在 worktree 中发现代码与预期不符、缺少某些功能或文件，应主动执行 \`git merge ${baseBranch ?? '<主分支>'}\` 将主分支最新代码合并进来，再继续工作。

## 例外（以下情况不需要 worktree）

- 仅读取 / 查看文件（不做任何修改）
- 用户明确说"直接改主分支"或"不用 worktree"
- 执行 shell 命令但不涉及文件写入
`
}

/**
 * 检测工作目录是否是一个 git secondary worktree（.git 为文件而非目录）
 * - 主工作树：.git/ 是目录
 * - 次级 worktree：.git 是文件（内容为 gitdir 指针）
 */
export function isInsideWorktree(workDir: string): boolean {
  try {
    const gitPath = path.join(workDir, '.git')
    return fs.existsSync(gitPath) && fs.statSync(gitPath).isFile()
  } catch (_) {
    return false
  }
}

/**
 * 构建"平台已自动创建 worktree，直接在此工作"的提示
 * 用于 autoWorktree 成功创建 worktree 后注入，取代原有的"调用 enter_worktree"规则。
 * 原因：AI 已经处于隔离 worktree 中，再调用 enter_worktree 会因"already in a worktree"而失败。
 * @param branchName - 当前 worktree 分支名
 */
export function buildWorktreeAlreadyActivePrompt(branchName?: string): string {
  const branchTag = branchName ? `（\`${branchName}\`）` : ''
  return `# 当前工作环境：已隔离的 Git Worktree

SpectrAI 平台已为此会话自动创建了隔离的 Git Worktree 分支${branchTag}。

## 工作规范

- ✅ **直接在当前目录修改文件**，代码已处于隔离分支，不影响主分支
- ✅ 修改后可执行 \`git add / git commit\`，提交记录在隔离分支上
- ❌ **不要调用 \`enter_worktree\`**——会话已在 worktree 内，再次调用会失败
- ❌ **不要手动合并**到主分支，由 SpectrAI 调度器在任务完成后统一合并

## 说明

当前目录即为 worktree 根目录。所有文件操作都是隔离的，可以放心修改。
`
}

/**
 * 检测工作目录当前 git 分支名
 * @returns 分支名，detached HEAD 或非 git 目录时返回 undefined
 */
export function detectBaseBranch(workDir: string): string | undefined {
  try {
    const result = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    return (result && result !== 'HEAD') ? result : undefined
  } catch (_) {
    return undefined
  }
}

/**
 * 注入 Worktree 规范（autoWorktree 开启时，随会话创建调用）
 * 写入 .claude/rules/spectrai-worktree.md，Claude Code 启动时自动加载
 *
 * 会在注入时检测 workDir 的当前 git 分支，写入规则文件，
 * 防止 Claude 在错误分支（如 master）上调用 enter_worktree。
 */
export function injectWorktreeRule(workDir: string): string {
  ensureRulesDir(workDir)

  const baseBranch = detectBaseBranch(workDir)
  const filePath = path.join(workDir, '.claude', 'rules', WORKTREE_RULES_FILENAME)
  fs.writeFileSync(filePath, buildWorktreePrompt(baseBranch), 'utf-8')
  console.log(`[Worktree] Injected rule: ${filePath} (baseBranch: ${baseBranch ?? 'unknown'})`)
  return filePath
}

/**
 * 清理 Worktree 规范文件（会话结束时调用）
 */
export function cleanupWorktreeRule(workDir: string): void {
  try {
    const filePath = path.join(workDir, '.claude', 'rules', WORKTREE_RULES_FILENAME)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log(`[Worktree] Cleaned up rule: ${filePath}`)
    }
  } catch (_) { /* ignore */ }
}

/**
 * 注入"已在 worktree"规则（Claude Code）
 * 在 autoWorktree 成功创建 worktree 并切换 workingDirectory 后调用。
 */
export function injectWorktreeAlreadyActiveRule(workDir: string, branchName?: string): string {
  ensureRulesDir(workDir)
  const filePath = path.join(workDir, '.claude', 'rules', WORKTREE_RULES_FILENAME)
  fs.writeFileSync(filePath, buildWorktreeAlreadyActivePrompt(branchName), 'utf-8')
  console.log(`[Worktree] Injected already-active rule: ${filePath} (branch: ${branchName ?? 'unknown'})`)
  return filePath
}

/**
 * 注入"已在 worktree"规则到 AGENTS.md（Codex）
 */
export function injectWorktreeAlreadyActiveToAgentsMd(workDir: string, branchName?: string): string {
  const filePath = path.join(workDir, 'AGENTS.md')
  upsertManagedBlock(filePath, buildWorktreeAlreadyActivePrompt(branchName))
  console.log(`[Worktree] Injected already-active rule to AGENTS.md: ${filePath} (branch: ${branchName ?? 'unknown'})`)
  return filePath
}

/**
 * 注入"已在 worktree"规则到 GEMINI.md（Gemini CLI）
 */
export function injectWorktreeAlreadyActiveToGeminiMd(workDir: string, branchName?: string): string {
  const filePath = path.join(workDir, 'GEMINI.md')
  upsertManagedBlock(filePath, buildWorktreeAlreadyActivePrompt(branchName))
  console.log(`[Worktree] Injected already-active rule to GEMINI.md: ${filePath} (branch: ${branchName ?? 'unknown'})`)
  return filePath
}

// ==================== 第三方 Provider Worktree 规范注入 ====================

/**
 * 将 Worktree 规范注入 AGENTS.md（Codex CLI 的规则文件）
 * Codex 在工作目录及父级目录中自动发现并加载 AGENTS.md，无需作为消息发送
 */
export function injectWorktreeRuleToAgentsMd(workDir: string): string {
  const filePath = path.join(workDir, 'AGENTS.md')
  const baseBranch = detectBaseBranch(workDir)
  upsertManagedBlock(filePath, buildWorktreePrompt(baseBranch))
  console.log(`[Worktree] Injected rule to AGENTS.md: ${filePath} (baseBranch: ${baseBranch ?? 'unknown'})`)
  return filePath
}

/**
 * 从 AGENTS.md 移除 SpectrAI 管理的 Worktree 规范块（会话结束时调用）
 */
export function cleanupWorktreeRuleFromAgentsMd(workDir: string): void {
  try {
    removeManagedBlock(path.join(workDir, 'AGENTS.md'))
    console.log(`[Worktree] Cleaned up AGENTS.md in: ${workDir}`)
  } catch (_) { /* ignore */ }
}

/**
 * 将 Worktree 规范注入 GEMINI.md（Gemini CLI 的规则文件）
 * Gemini CLI 在工作目录中自动加载 GEMINI.md
 */
export function injectWorktreeRuleToGeminiMd(workDir: string): string {
  const filePath = path.join(workDir, 'GEMINI.md')
  const baseBranch = detectBaseBranch(workDir)
  upsertManagedBlock(filePath, buildWorktreePrompt(baseBranch))
  console.log(`[Worktree] Injected rule to GEMINI.md: ${filePath} (baseBranch: ${baseBranch ?? 'unknown'})`)
  return filePath
}

/**
 * 从 GEMINI.md 移除 SpectrAI 管理的 Worktree 规范块（会话结束时调用）
 */
export function cleanupWorktreeRuleFromGeminiMd(workDir: string): void {
  try {
    removeManagedBlock(path.join(workDir, 'GEMINI.md'))
    console.log(`[Worktree] Cleaned up GEMINI.md in: ${workDir}`)
  } catch (_) { /* ignore */ }
}
