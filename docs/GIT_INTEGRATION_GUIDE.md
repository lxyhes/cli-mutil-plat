# Git 自动集成功能使用指南

## 概述

Git集成允许在生成交付包后自动创建Git commit，并将交付包元数据附加到提交信息中，实现完整的可追溯性。

## 功能特性

### 1. 自动 Commit 创建
- ✅ 自动暂存所有改动文件
- ✅ 使用交付包中的建议提交信息
- ✅ 在commit message中附加交付包哈希和时间戳
- ✅ 可选推送到远程仓库

### 2. 增强版提交信息格式
```
<原始提交信息>

📦 Delivery Pack: <hash>
⏰ Generated: <ISO timestamp>
🔗 prismops://delivery/<hash>
```

### 3. 智能提交信息提取
从交付包Markdown中自动提取"建议提交说明"部分作为commit message。

## API 使用

### 前端调用

```typescript
// 1. 从交付包提取建议的提交信息
const result = await window.spectrAI.git.extractCommitMessage(deliveryPackMarkdown)
if (result.success && result.data) {
  const commitMessage = result.data.message
}

// 2. 自动创建 commit
const commitResult = await window.spectrAI.git.autoCommitWithDeliveryPack({
  repoPath: '/path/to/repo',
  commitMessage: 'feat: add user authentication',
  deliveryPackHash: 'abc123def456', // 可选
  stageAll: true,                     // 可选，默认 true
  pushToRemote: false,                // 可选，默认 false
})

if (commitResult.success && commitResult.data) {
  console.log('Commit hash:', commitResult.data.commitHash)
  console.log('Pushed to remote:', commitResult.data.pushed)
} else {
  console.error('Commit failed:', commitResult.error)
}
```

### 后端直接调用

```typescript
import { autoCommitWithDeliveryPack, extractSuggestedCommitMessage } from '../main/utils/gitIntegration'

// 自动 commit
const result = await autoCommitWithDeliveryPack({
  repoPath: projectPath,
  commitMessage: 'fix: resolve login issue',
  deliveryPackHash: reportHash,
  stageAll: true,
  pushToRemote: false,
})

// 提取提交信息
const message = extractSuggestedCommitMessage(deliveryPackMarkdown)
```

## 与交付流程集成

### 在 ConversationView 中使用

```typescript
const handleGenerateShipSummary = useCallback(async () => {
  // ... 现有的交付包生成逻辑 ...
  
  const deliveryPackMarkdown = buildDeliveryPackMarkdown(snapshot, summary)
  const reportHash = computeReportHash(deliveryPackMarkdown)
  
  // 下载交付包
  downloadMarkdownFile(deliveryPackMarkdown, fileName)
  
  // 🆕 自动创建 commit（如果用户启用）
  if (autoCommitEnabled) {
    const commitMessage = extractSuggestedCommitMessage(deliveryPackMarkdown)
    const commitResult = await window.spectrAI.git.autoCommitWithDeliveryPack({
      repoPath: workingDirectory,
      commitMessage,
      deliveryPackHash: reportHash,
      stageAll: true,
      pushToRemote: false,
    })
    
    if (commitResult.success) {
      setQueueHintText(`交付包已导出，并已创建 commit: ${commitResult.data?.commitHash?.slice(0, 8)}`)
    } else {
      setQueueHintText(`交付包已导出，但 Git commit 失败: ${commitResult.error}`)
    }
  }
}, [workingDirectory, autoCommitEnabled])
```

## 配置选项

### 用户设置

在 Settings 中添加以下配置项：

```typescript
interface GitIntegrationSettings {
  /** 是否启用自动 commit */
  autoCommitEnabled: boolean
  /** 是否自动推送到远程 */
  autoPushEnabled: boolean
  /** 是否需要所有交付门禁通过才自动 commit */
  requireAllGatesPassed: boolean
}
```

### 条件检测

```typescript
import { shouldAutoCommit } from '../main/utils/gitIntegration'

const shouldCommit = shouldAutoCommit({
  autoCommitEnabled: settings.autoCommitEnabled,
  changedFileCount: opsBrief.changedFileCount,
  deliveryPackGenerated: opsBrief.deliveryPackGenerated,
  allGatesPassed: opsBrief.readinessGates.every(gate => gate.status === 'passed'),
})

if (shouldCommit) {
  // 执行自动 commit
}
```

## 错误处理

### 常见错误场景

1. **不是 Git 仓库**
   ```
   error: '当前目录不是 Git 仓库'
   ```

2. **没有未提交的改动**
   ```
   error: '工作区没有未提交的改动'
   ```

3. **Git 命令执行失败**
   ```
   error: 'Git commit 失败: pre-commit hook rejected'
   ```

### 错误处理示例

```typescript
try {
  const result = await window.spectrAI.git.autoCommitWithDeliveryPack(options)
  
  if (!result.success) {
    // 显示友好的错误提示
    showToast({
      type: 'warning',
      title: 'Git Commit 失败',
      message: result.error?.userMessage || result.error?.message || '未知错误',
      action: {
        label: '手动 Commit',
        onClick: () => openTerminal(),
      },
    })
  }
} catch (error) {
  console.error('[Git Integration] Unexpected error:', error)
}
```

## 最佳实践

### 1. 仅在有意义的工作完成后自动 Commit
- ✅ 有文件改动
- ✅ 已生成交付包
- ✅ 交付门禁全部通过
- ❌ 仅有对话没有实际改动

### 2. 提供清晰的用户反馈
```typescript
setQueueHintText('正在创建 Git commit...')
// ... 执行 commit ...
setQueueHintText(`✅ 已创建 commit ${shortHash}`)
```

### 3. 允许用户撤销
```typescript
// 保存最近的 commit hash，提供撤销按钮
const lastCommitHash = commitResult.data?.commitHash
// 用户点击撤销时执行 git reset --soft HEAD~1
```

### 4. 尊重用户的 Git 配置
- 不要覆盖用户的 `.gitignore`
- 不要强制推送
- 遵循用户的 commit message 规范

## 未来扩展

### 计划中的功能
- [ ] 支持自定义 commit 模板
- [ ] 集成 Conventional Commits 规范
- [ ] 自动生成 CHANGELOG
- [ ] 支持 GPG 签名 commits
- [ ] 创建 Git tag 标记重要交付
- [ ] 推送到指定分支（而非当前分支）

## 相关文件

- 核心实现: `src/main/utils/gitIntegration.ts`
- IPC Handler: `src/main/ipc/gitHandlers.ts`
- 类型定义: `src/preload/index.d.ts`
- IPC 常量: `src/shared/constants.ts`
- Preload 桥接: `src/preload/index.ts`

## 测试

运行单元测试：
```bash
npm test -- gitIntegration.test.ts
```

手动测试步骤：
1. 打开一个 Git 仓库项目
2. 修改一些文件
3. 生成交付包
4. 检查是否自动创建了 commit
5. 运行 `git log` 查看提交信息格式
