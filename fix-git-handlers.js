const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/main/ipc/gitHandlers.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. 添加导入
if (!content.includes('createErrorResponse')) {
  content = content.replace(
    "import type { FileChangeTracker } from '../tracker/FileChangeTracker'",
    "import type { FileChangeTracker } from '../tracker/FileChangeTracker'\nimport { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'"
  );
}

// 2. 逐个替换每个 handler 的错误返回
const replacements = [
  // GIT_STAGE
  {
    from: /ipcMain\.handle\(IPC\.GIT_STAGE[\s\S]*?return \{ success: false, error: error\.message \}/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'git.stage', repoPath })"
    )
  },
  // GIT_UNSTAGE
  {
    from: /ipcMain\.handle\(IPC\.GIT_UNSTAGE[\s\S]*?return \{ success: false, error: error\.message \}/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'git.unstage', repoPath })"
    )
  },
  // GIT_DISCARD
  {
    from: /ipcMain\.handle\(IPC\.GIT_DISCARD[\s\S]*?return \{ success: false, error: error\.message \}/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'git.discard', repoPath })"
    )
  },
  // GIT_STAGE_ALL
  {
    from: /ipcMain\.handle\(IPC\.GIT_STAGE_ALL[\s\S]*?return \{ success: false, error: error\.message \}/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'git.stageAll', repoPath })"
    )
  },
  // GIT_COMMIT
  {
    from: /ipcMain\.handle\(IPC\.GIT_COMMIT[\s\S]*?return \{ success: false, error: error\.message \}/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'git.commit', repoPath })"
    )
  },
  // WORKTREE_CREATE
  {
    from: /ipcMain\.handle\(IPC\.WORKTREE_CREATE[\s\S]*?return \{ success: false, error: error\.message \}/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'worktree.create', repoPath })"
    )
  },
  // WORKTREE_REMOVE
  {
    from: /ipcMain\.handle\(IPC\.WORKTREE_REMOVE[\s\S]*?return \{ success: false, error: error\.message \}/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'worktree.remove', repoPath })"
    )
  },
  // WORKTREE_MERGE
  {
    from: /ipcMain\.handle\(IPC\.WORKTREE_MERGE[\s\S]*?return \{ success: false, error: error\.message \}\s*\}\s*\}\)/,
    to: (match) => match.replace(
      'return { success: false, error: error.message }',
      "return createErrorResponse(error, { operation: 'worktree.merge', repoPath })"
    )
  }
];

replacements.forEach(({ from, to }) => {
  content = content.replace(from, to);
});

// 3. 替换成功返回
content = content.replace(
  /return \{ success: true \}(?!\s*\/\/)/g,
  'return createSuccessResponse({ success: true })'
);

content = content.replace(
  /return \{ success: true, \.\.\.result \}/g,
  'return createSuccessResponse(result)'
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ gitHandlers.ts 已修复');
