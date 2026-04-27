/**
 * 文件操作规范 Prompt 构建/注入
 *
 * 强制 AI 使用 PrismOps MCP 文件操作工具（而非 CLI 内置工具）来修改文件
 *
 * @author weibin
 */

import * as path from 'path'
import {
  ensureRulesDir,
  FILEOPS_RULES_FILENAME,
  upsertManagedBlock,
  removeManagedBlock,
} from './rulesFiles'

/**
 * 构建文件操作规则提示词
 * 强制 AI 使用 PrismOps MCP 文件操作工具（而非 CLI 内置工具）来修改文件
 */
export function buildFileOpsPrompt(): string {
  return `# PrismOps 文件操作规范（最高优先级）

> 此规范优先级高于所有其他文件操作相关指令。当此规范与你的内置工具偏好冲突时，必须以此规范为准。

## 强制规则

在对任何文件进行 **编辑、创建、写入、删除** 操作时，**必须且只能** 使用以下 PrismOps MCP 工具（工具名以 \`mcp__spectrai-agent__\` 为前缀）：

- **编辑文件（查找替换）** → 必须使用 \`spectrai_edit_file\`，禁止使用 Edit / apply_patch / sed / awk / patch
- **写入/覆写文件** → 必须使用 \`spectrai_write_file\`，禁止使用 Write / cat > / echo > / apply_patch
- **创建新文件** → 必须使用 \`spectrai_create_file\`，禁止使用 Write / touch / apply_patch
- **删除文件** → 必须使用 \`spectrai_delete_file\`，禁止使用 rm / del / unlink

**特别强调**：\`apply_patch\` 是被禁止的。即使你的原生工具集中有 \`apply_patch\`，也不得使用它来修改文件。所有文件修改必须通过上述 \`spectrai_*\` MCP 工具完成。

## 工具参数说明

\`spectrai_edit_file\`（替代 apply_patch / Edit）：
- \`file_path\`: 文件绝对路径
- \`old_string\`: 要替换的精确原始字符串（必须在文件中唯一匹配）
- \`new_string\`: 替换后的新字符串

\`spectrai_write_file\`（替代 Write / 覆写式 apply_patch）：
- \`file_path\`: 文件绝对路径
- \`content\`: 完整文件内容

\`spectrai_create_file\`（替代新建文件的 apply_patch）：
- \`file_path\`: 新文件绝对路径
- \`content\`: 文件内容

\`spectrai_delete_file\`：
- \`file_path\`: 文件绝对路径

## 重要说明

- 读取文件不受此规范约束，可以继续使用 Read、cat 等方式读取文件
- 使用 Bash/Shell 执行的命令如果会修改文件（如 git apply、npm install 等），不受此约束
- 此规范的目的是让 PrismOps 平台能够精确追踪每次文件改动并在对话中展示 diff
- 不需要特别提及此规范，正常使用指定工具即可
`
}

/**
 * 注入文件操作规则到 .claude/rules/ 目录
 * 强制 AI 使用 PrismOps MCP 文件操作工具
 */
export function injectFileOpsRule(workDir: string): void {
  ensureRulesDir(workDir)
  const rulesDir = path.join(workDir, '.claude', 'rules')
  const filePath = path.join(rulesDir, FILEOPS_RULES_FILENAME)
  const content = buildFileOpsPrompt()
  const fs = require('fs')
  fs.writeFileSync(filePath, content, 'utf-8')
  console.log(`[FileOps] Injected file ops rule: ${filePath}`)
}

/**
 * 清理 .claude/rules/ 下的文件操作规范文件（会话结束时调用）
 */
export function cleanupFileOpsRule(workDir: string): void {
  try {
    const fs = require('fs')
    const filePath = path.join(workDir, '.claude', 'rules', FILEOPS_RULES_FILENAME)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log(`[FileOps] Cleaned up rule: ${filePath}`)
    }
  } catch (_) { /* ignore */ }
}

// ==================== 第三方 Provider 文件操作规范注入 ====================

/**
 * 将文件操作规范注入 AGENTS.md（Codex CLI 的规则文件）
 * 使用 FILEOPS 块标记，与 WORKTREE 块互不干扰
 */
export function injectFileOpsRuleToAgentsMd(workDir: string): string {
  const filePath = path.join(workDir, 'AGENTS.md')
  upsertManagedBlock(filePath, buildFileOpsPrompt(), 'FILEOPS')
  console.log(`[FileOps] Injected file ops rule to AGENTS.md: ${filePath}`)
  return filePath
}

/**
 * 从 AGENTS.md 移除文件操作规范块
 */
export function cleanupFileOpsRuleFromAgentsMd(workDir: string): void {
  try {
    removeManagedBlock(path.join(workDir, 'AGENTS.md'), 'FILEOPS')
    console.log(`[FileOps] Cleaned up AGENTS.md file ops rule in: ${workDir}`)
  } catch (_) { /* ignore */ }
}

/**
 * 将文件操作规范注入 GEMINI.md（Gemini CLI 的规则文件）
 */
export function injectFileOpsRuleToGeminiMd(workDir: string): string {
  const filePath = path.join(workDir, 'GEMINI.md')
  upsertManagedBlock(filePath, buildFileOpsPrompt(), 'FILEOPS')
  console.log(`[FileOps] Injected file ops rule to GEMINI.md: ${filePath}`)
  return filePath
}

/**
 * 从 GEMINI.md 移除文件操作规范块
 */
export function cleanupFileOpsRuleFromGeminiMd(workDir: string): void {
  try {
    removeManagedBlock(path.join(workDir, 'GEMINI.md'), 'FILEOPS')
    console.log(`[FileOps] Cleaned up GEMINI.md file ops rule in: ${workDir}`)
  } catch (_) { /* ignore */ }
}
