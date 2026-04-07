const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/main/ipc/fileManagerHandlers.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. 添加导入
content = content.replace(
  "import type { FileChangeTracker } from '../tracker/FileChangeTracker'",
  "import type { FileChangeTracker } from '../tracker/FileChangeTracker'\nimport { createErrorResponse, createSuccessResponse, ErrorCode, SpectrAIError } from '../../shared/errors'"
);

// 2. 替换所有 catch 块中的错误返回
content = content.replace(
  /catch \(error: any\) \{\s*console\.error\('\[IPC\] file-manager:list-dir error:', error\)\s*return \{ path: dirPath, entries: \[\], error: error\.message \} as DirListing & \{ error: string \}\s*\}/g,
  `catch (error: any) {
      console.error('[IPC] file-manager:list-dir error:', error)
      return { path: dirPath, entries: [], error: createErrorResponse(error, { operation: 'fileManager.listDir', dirPath }).error }
    }`
);

content = content.replace(
  /return \{ success: false, error: error\.message \}/g,
  "return createErrorResponse(error, { operation: 'fileManager' })"
);

// 3. 替换特定错误消息
content = content.replace(
  /return \{ success: false, error: errorMsg \}/g,
  "return createErrorResponse(new Error(errorMsg), { operation: 'fileManager.openPath' })"
);

content = content.replace(
  /return \{\s*error: `文件过大[^}]+\}\s*\}/g,
  `throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: \`File too large: \${Math.round(stat.size / 1024 / 1024 * 10) / 10}MB exceeds 5MB limit\`,
          userMessage: \`文件过大（\${Math.round(stat.size / 1024 / 1024 * 10) / 10}MB），超出 5MB 限制，无法读取\`,
          context: { filePath: normalizedPath, size: stat.size }
        })`
);

content = content.replace(
  /return \{ error: error\.message \}/g,
  "return createErrorResponse(error, { operation: 'fileManager' })"
);

content = content.replace(
  /return \{ error: '文件内容超过 5MB 限制，无法保存' \}/g,
  `throw new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'File content exceeds 5MB limit',
          userMessage: '文件内容超过 5MB 限制，无法保存',
          context: { contentLength: content.length }
        })`
);

content = content.replace(
  /return \{ error: error\.message \?\? String\(error\) \}/g,
  "return createErrorResponse(error, { operation: 'fileManager.writeFile' })"
);

content = content.replace(
  /return \{ files: \[\], total: 0, truncated: false, error: '路径不存在' \}/g,
  `return { files: [], total: 0, truncated: false, error: new SpectrAIError({
          code: ErrorCode.NOT_FOUND,
          message: 'Path does not exist',
          userMessage: '路径不存在',
          context: { dirPath: normalizedPath }
        }).userMessage }`
);

content = content.replace(
  /return \{ files: \[\], total: 0, truncated: false, error: '路径不是目录' \}/g,
  `return { files: [], total: 0, truncated: false, error: new SpectrAIError({
          code: ErrorCode.INVALID_INPUT,
          message: 'Path is not a directory',
          userMessage: '路径不是目录',
          context: { dirPath: normalizedPath }
        }).userMessage }`
);

content = content.replace(
  /return \{ files: \[\], total: 0, truncated: false, error: error\.message \}/g,
  "return { files: [], total: 0, truncated: false, error: createErrorResponse(error, { operation: 'fileManager.listProjectFiles' }).error }"
);

content = content.replace(
  /return \{ success: false, error: '文件已存在' \}/g,
  `throw new SpectrAIError({
          code: ErrorCode.ALREADY_EXISTS,
          message: 'File already exists',
          userMessage: '文件已存在',
          context: { filePath: normalizedPath }
        })`
);

content = content.replace(
  /return \{ success: false, error: '目录已存在' \}/g,
  `throw new SpectrAIError({
          code: ErrorCode.ALREADY_EXISTS,
          message: 'Directory already exists',
          userMessage: '目录已存在',
          context: { dirPath: normalizedPath }
        })`
);

content = content.replace(
  /return \{ success: false, error: '目标名称已存在' \}/g,
  `throw new SpectrAIError({
          code: ErrorCode.ALREADY_EXISTS,
          message: 'Target name already exists',
          userMessage: '目标名称已存在',
          context: { oldPath: normalizedOld, newPath: normalizedNew }
        })`
);

content = content.replace(
  /return \{ hunks: \[\], raw: '', error: error\.message \}/g,
  "return { hunks: [], raw: '', error: createErrorResponse(error, { operation: 'fileManager.getFileDiff' }).error }"
);

// 4. 替换成功返回
content = content.replace(
  /return \{ success: true \}(?!\s*\/\/)/g,
  'return createSuccessResponse({})'
);

content = content.replace(
  /return \{ content \}/g,
  'return createSuccessResponse({ content })'
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('✅ fileManagerHandlers.ts 已更新');
