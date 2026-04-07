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

// 2. 替换所有 "return { success: false, error: error.message }"
// 需要根据上下文确定 operation 名称
const handlers = [
  { pattern: /\[IPC\] GIT_STAGE error:/, operation: 'git.stage', line: 102 },
  { pattern: /\[IPC\] GIT_UNSTAGE error:/, operation: 'git.unstage', line: 111 },
  { pattern: /\[IPC\] GIT_DISCARD error:/, operation: 'git.discard', line: 121 },
  { pattern: /\[IPC\] GIT_STAGE_ALL error:/, operation: 'git.stageAll', line: 130 },
  { pattern: /\[IPC\] GIT_COMMIT error:/, operation: 'git.commit', line: 139 },
  { pattern: /\[IPC\] WORKTREE_CREATE error:/, operation: 'worktree.create', line: 183 },
  { pattern: /\[IPC\] WORKTREE_REMOVE error:/, operation: 'worktree.remove', line: 192 },
  { pattern: /\[IPC\] WORKTREE_MERGE error:/, operation: 'worktree.merge', line: 253 },
];

// 对于没有 console.error 的 catch 块，直接替换
content = content.replace(
  /(\s+)return \{ success: false, error: error\.message \}(\s+)\} catch/g,
  '$1return createErrorResponse(error, { operation: \'git.operation\', repoPath })$2} catch'
);

// 替换 "return { success: true }"
content = content.replace(
  /return \{ success: true \}(?!\s*\/\/)/g,
  'return createSuccessResponse({ success: true })'
);

// 替换 "return { success: true, ...result }"
content = content.replace(
  /return \{ success: true, \.\.\.result \}/g,
  'return createSuccessResponse(result)'
);

// 手动修复特定行的 operation 名称
const lines = content.split('\n');

// 修复 GIT_STAGE (line 102)
if (lines[101] && lines[101].includes('return createErrorResponse')) {
  lines[101] = lines[101].replace('git.operation', 'git.stage');
}

// 修复 GIT_UNSTAGE (line 111)
if (lines[110] && lines[110].includes('return createErrorResponse')) {
  lines[110] = lines[110].replace('git.operation', 'git.unstage');
}

// 修复 GIT_STAGE_ALL (line 130)
if (lines[129] && lines[129].includes('return createErrorResponse')) {
  lines[129] = lines[129].replace('git.operation', 'git.stageAll');
}

// 修复 GIT_COMMIT (line 139)
if (lines[138] && lines[138].includes('return createErrorResponse')) {
  lines[138] = lines[138].replace('git.operation', 'git.commit');
}

// 修复 WORKTREE_CREATE (line 183)
if (lines[182] && lines[182].includes('return createErrorResponse')) {
  lines[182] = lines[182].replace('git.operation', 'worktree.create');
}

// 修复 WORKTREE_REMOVE (line 192)
if (lines[191] && lines[191].includes('return createErrorResponse')) {
  lines[191] = lines[191].replace('git.operation', 'worktree.remove');
}

// 修复 WORKTREE_MERGE (line 253)
if (lines[252] && lines[252].includes('return createErrorResponse')) {
  lines[252] = lines[252].replace('git.operation', 'worktree.merge');
}

content = lines.join('\n');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ gitHandlers.ts 已更新');
