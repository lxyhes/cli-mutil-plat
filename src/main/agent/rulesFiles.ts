/**
 * 规则文件管理通用工具
 *
 * 提供 .claude/rules/ 目录管理、Managed Block 增删查等底层能力。
 * 供各规范模块（Supervisor / Worktree / FileOps / Workspace）复用。
 *
 * @author weibin
 */

import * as path from 'path'
import * as fs from 'fs'

/** 注入文件名（放在 .claude/rules/ 下，Claude Code 自动加载） */
export const RULES_FILENAME = 'spectrai-session.md'

/** Worktree 规则文件名（独立文件，按设置开关控制） */
export const WORKTREE_RULES_FILENAME = 'spectrai-worktree.md'

/** 文件操作规则注入文件名 */
export const FILEOPS_RULES_FILENAME = 'spectrai-fileops.md'

/** 旧路径（用于迁移清理） */
const LEGACY_DIR = '.claudeops'

/**
 * 获取规则文件路径
 */
export function getRulesFilePath(workDir: string): string {
  return path.join(workDir, '.claude', 'rules', RULES_FILENAME)
}

/**
 * 确保 .claude/rules/ 目录存在
 */
export function ensureRulesDir(workDir: string): void {
  const rulesDir = path.join(workDir, '.claude', 'rules')
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true })
  }
}

// ==================== Managed Block 管理 ====================

/** SpectrAI 管理块标记生成（支持多种块类型，互不干扰） */
export function blockMarkers(blockId = 'WORKTREE') {
  return {
    start: `<!-- CLAUDEOPS:${blockId}:START -->`,
    end: `<!-- CLAUDEOPS:${blockId}:END -->`,
  }
}

/** 转义正则特殊字符 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 将内容写入目标文件的 SpectrAI 管理块：
 * - 文件不存在 → 直接创建，只含该块
 * - 文件已含管理块 → 替换块内容
 * - 文件存在但无管理块 → 在末尾追加
 * @param blockId - 块标识符（不同类型的规范使用不同 ID，如 WORKTREE / FILEOPS）
 */
export function upsertManagedBlock(filePath: string, content: string, blockId = 'WORKTREE'): void {
  const { start: BLOCK_START, end: BLOCK_END } = blockMarkers(blockId)
  const block = `${BLOCK_START}\n${content}\n${BLOCK_END}\n`
  const blockRegex = new RegExp(
    `${escapeRegex(BLOCK_START)}[\\s\\S]*?${escapeRegex(BLOCK_END)}\\n?`,
    'g'
  )

  if (fs.existsSync(filePath)) {
    let existing = fs.readFileSync(filePath, 'utf-8')
    if (blockRegex.test(existing)) {
      existing = existing.replace(blockRegex, block)
    } else {
      existing = existing.trimEnd() + '\n\n' + block
    }
    fs.writeFileSync(filePath, existing, 'utf-8')
  } else {
    fs.writeFileSync(filePath, block, 'utf-8')
  }
}

/**
 * 从文件中移除 SpectrAI 管理块。
 * 若移除后文件为空则直接删除文件。
 * @param blockId - 块标识符（与 upsertManagedBlock 的 blockId 对应）
 */
export function removeManagedBlock(filePath: string, blockId = 'WORKTREE'): void {
  if (!fs.existsSync(filePath)) return

  const { start: BLOCK_START, end: BLOCK_END } = blockMarkers(blockId)
  const blockRegex = new RegExp(
    `${escapeRegex(BLOCK_START)}[\\s\\S]*?${escapeRegex(BLOCK_END)}\\n?`,
    'g'
  )
  const content = fs.readFileSync(filePath, 'utf-8').replace(blockRegex, '').trimEnd()

  if (content) {
    fs.writeFileSync(filePath, content + '\n', 'utf-8')
  } else {
    fs.unlinkSync(filePath)
  }
}

// ==================== 旧版清理 ====================

/**
 * 清理旧版 .claudeops/CLAUDE.md（迁移用）
 */
export function cleanupLegacy(workDir: string): void {
  try {
    const legacyFile = path.join(workDir, LEGACY_DIR, 'CLAUDE.md')
    if (fs.existsSync(legacyFile)) {
      fs.unlinkSync(legacyFile)
      console.log(`[Supervisor] Cleaned up legacy file: ${legacyFile}`)
    }
    // 如果 .spectrai 目录为空则删除
    const legacyDir = path.join(workDir, LEGACY_DIR)
    if (fs.existsSync(legacyDir)) {
      const entries = fs.readdirSync(legacyDir)
      if (entries.length === 0) {
        fs.rmdirSync(legacyDir)
      }
    }
  } catch (_) { /* ignore */ }
}

/**
 * 在已有的规则文件末尾追加内容（不覆盖原内容）
 */
export function appendToRulesFile(workDir: string, section: string): void {
  ensureRulesDir(workDir)
  const filePath = getRulesFilePath(workDir)

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8')
    fs.writeFileSync(filePath, existing.trimEnd() + '\n' + section, 'utf-8')
  } else {
    fs.writeFileSync(filePath, section, 'utf-8')
  }
}
