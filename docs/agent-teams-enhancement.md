# Agent Teams Enhancement Notes

本文档对应 2026-04 这一轮 Agent Teams 增强落地，目标是把实现边界、验收点和后续扩展约束固定下来，避免 UI、IPC、主进程、存储层再次漂移。

## 已落地能力

### 阶段 1：任务依赖 DAG + 看板视图
- `TeamRepository.getTaskDAG()` 返回任务节点、依赖、批次、ready 信息
- `TeamRepository.validateTaskDependencies()` 使用 Kahn 拓扑思路做循环依赖校验
- `TeamManager` 在任务 claim 前检查依赖是否满足，未满足任务不可认领
- Renderer 已支持任务看板与 DAG 双视图

### 阶段 2：团队生命周期控制
- 支持 `cancelTeam`
- 支持 `pauseTeam`
- 支持 `resumeTeam`
- 支持 `updateTeam`
- 团队取消时会同步取消进行中任务、结束成员会话并清理团队资源

### 阶段 3：任务编辑 / 取消 / 转派
- `pending` 任务允许编辑
- 编辑依赖后会重新触发 DAG 校验
- `pending` / `in_progress` 任务允许取消
- 任务允许转派给其他成员

### 阶段 4：模板 CRUD
- 支持内置模板 + 自定义模板混合列表
- 内置模板通过 ID 规则在 UI 中视为只读
- 自定义模板支持创建、编辑、删除

### 阶段 5：UI 直接发消息
- 支持 UI 向单个成员发送消息
- 支持 UI 广播消息给团队
- 消息会通过 TeamBridge 注入成员上下文

### 阶段 6：Git Worktree 成员隔离
- 团队创建时可选启用成员级 worktree 隔离
- 非 Leader 角色默认落到独立 worktree
- 支持团队级 merge worktrees
- 支持团队清理时自动清除 worktree

### 阶段 7：导出 / 导入 + 层级团队预览
- 支持团队完整快照导出
- 支持团队快照导入并重建成员 / 任务 / 消息映射
- 支持 `parentTeamId`
- 子团队创建时会继承父团队目标与近期消息上下文

## 关键主进程入口

- `src/main/team/TeamManager.ts`
  负责团队生命周期、任务流转、UI 消息、导入导出、worktree 协调
- `src/main/team/TeamRepository.ts`
  负责团队实例、成员、任务、消息、模板、DAG 查询与校验
- `src/main/team/TeamBridge.ts`
  负责 UI / Agent / TeamManager 之间的消息桥接
- `src/main/ipc/teamHandlers.ts`
  负责 renderer 到 main 的 Team IPC 暴露

## 关键 UI 入口

- `src/renderer/components/team/TaskBoardView.tsx`
- `src/renderer/components/team/TaskEditDialog.tsx`
- `src/renderer/components/team/MessagePanel.tsx`
- `src/renderer/components/team/TeamSettingsDialog.tsx`
- `src/renderer/components/team/TemplateManagerDialog.tsx`
- `src/renderer/components/team/CreateTeamDialog.tsx`
- `src/renderer/components/team/TeamSessionView.tsx`
- `src/renderer/stores/teamStore.ts`

## 数据模型补充

### TeamInstance 增强字段
- `parentTeamId?: string`
- `worktreeIsolation?: boolean`

### TeamTask 增强行为
- `dependencies` 为任务 ID 数组
- `executionBatch` 用于 DAG / 看板 ready 分组
- `cancelled` 成为正式状态之一

### TeamSnapshot
- 导出数据不仅包含团队元信息，还包含成员、任务、消息、模板引用、工作目录和层级信息

## IPC 约定

所有新增 Team 处理器统一返回：

```ts
{ success: true, ...payload }
{ success: false, error: string }
```

重点新增通道包括：
- `TEAM_GET_TASK_DAG`
- `TEAM_VALIDATE_DEPENDENCIES`
- `TEAM_CANCEL`
- `TEAM_PAUSE`
- `TEAM_RESUME`
- `TEAM_UPDATE`
- `TEAM_UPDATE_TASK`
- `TEAM_CANCEL_TASK`
- `TEAM_REASSIGN_TASK`
- `TEAM_CREATE_TEMPLATE`
- `TEAM_UPDATE_TEMPLATE`
- `TEAM_DELETE_TEMPLATE`
- `TEAM_SEND_MESSAGE`
- `TEAM_UI_BROADCAST`
- `TEAM_EXPORT`
- `TEAM_IMPORT`
- `TEAM_MERGE_WORKTREES`

## 手工验收清单

### DAG / 任务流转
- 创建一个含依赖链的团队，确认 DAG 视图能显示节点与边
- 创建循环依赖，确认 UI / IPC 返回校验错误
- 尝试 claim 一个上游未完成的任务，确认被拒绝

### 生命周期
- 运行中团队点击暂停，确认成员停止继续推进
- 点击恢复，确认团队重新进入运行态
- 点击取消，确认进行中任务变成 `cancelled`

### 任务运维
- 编辑 `pending` 任务标题、描述、依赖，确认刷新后持久化存在
- 转派任务后，确认新成员看到该任务
- 取消 `in_progress` 任务，确认看板列移动正确

### 模板
- 创建自定义模板并立即用它创建团队
- 编辑模板角色 prompt，确认重新打开后仍存在
- 删除自定义模板，确认列表移除

### UI 消息
- 向单个成员发送消息，确认只该成员上下文收到
- 发广播消息，确认所有成员都收到

### Worktree
- 启用 worktree 隔离创建团队
- 确认非 Leader 成员运行目录不同
- 执行 merge worktrees，确认结果返回可读

### 导入导出
- 导出一个已有团队
- 重新导入，确认成员、任务、消息和依赖链仍然存在

## 后续扩展建议

- 增加 Team 相关单元测试或 smoke script，至少覆盖 DAG 校验、导入导出映射、worktree merge 失败路径
- 为 Agent Teams 补一张 README 截图，替换现有 TODO
- 若后续引入真正的层级团队执行，应把父子团队的状态聚合规则单独抽象，避免 TeamManager 继续膨胀
