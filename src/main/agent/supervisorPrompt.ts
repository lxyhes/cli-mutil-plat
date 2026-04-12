/**
 * 会话引导 Prompt 聚合入口
 *
 * 本文件是各规范模块的统一 re-export 入口，保持向后兼容。
 * 消费者不需要修改导入路径。
 *
 * 模块拆分：
 *   - rulesFiles.ts      — 通用工具（目录管理、Managed Block 增删查）
 *   - awarenessPrompt.ts  — 感知层 + 调度层（Supervisor）prompt
 *   - workspacePrompt.ts  — 多仓库上下文 prompt
 *   - fileOpsPrompt.ts    — 文件操作规范 prompt
 *   - worktreePrompt.ts   — Worktree 规范 + 检测工具
 *
 * @author weibin
 */

// ==================== 感知层 + 调度层 ====================
export {
  buildAwarenessPrompt,
  buildSupervisorPrompt,
  injectAwarenessPrompt,
  injectSupervisorPrompt,
  cleanupSupervisorPrompt,
  injectSupervisorPromptToAgentsMd,
  cleanupSupervisorPromptFromAgentsMd,
  injectSupervisorPromptToGeminiMd,
  cleanupSupervisorPromptFromGeminiMd,
} from './awarenessPrompt'

// ==================== Workspace 多仓库上下文 ====================
export {
  buildWorkspaceSection,
  buildWorkspaceSessionSection,
  injectWorkspaceSection,
  injectWorkspaceSessionSection,
  injectWorkspaceSessionSectionToAgentsMd,
  cleanupWorkspaceSectionFromAgentsMd,
  injectWorkspaceSessionSectionToGeminiMd,
  cleanupWorkspaceSectionFromGeminiMd,
} from './workspacePrompt'

// ==================== 文件操作规范 ====================
export {
  buildFileOpsPrompt,
  injectFileOpsRule,
  cleanupFileOpsRule,
  injectFileOpsRuleToAgentsMd,
  cleanupFileOpsRuleFromAgentsMd,
  injectFileOpsRuleToGeminiMd,
  cleanupFileOpsRuleFromGeminiMd,
} from './fileOpsPrompt'

// ==================== Worktree 规范 ====================
export {
  buildWorktreePrompt,
  buildWorktreeAlreadyActivePrompt,
  isInsideWorktree,
  detectBaseBranch,
  injectWorktreeRule,
  cleanupWorktreeRule,
  injectWorktreeAlreadyActiveRule,
  injectWorktreeAlreadyActiveToAgentsMd,
  injectWorktreeAlreadyActiveToGeminiMd,
  injectWorktreeRuleToAgentsMd,
  cleanupWorktreeRuleFromAgentsMd,
  injectWorktreeRuleToGeminiMd,
  cleanupWorktreeRuleFromGeminiMd,
} from './worktreePrompt'

// ==================== 通用工具（供高级消费者使用） ====================
export {
  ensureRulesDir,
  getRulesFilePath,
  upsertManagedBlock,
  removeManagedBlock,
} from './rulesFiles'
