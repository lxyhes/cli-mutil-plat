# SpectrAI TODO

更新时间：2026-04-24

## 当前已完成

- [x] 修复 Codex 初始化 `baseInstructions` 传入 Promise 导致的 `invalid type: map, expected a string`。
- [x] 修复 KnowledgeCenter 查询参数数量错误。
- [x] 实现 Codex `/model` 真切换：运行中会话空闲时重新 `thread/start` 并更新 provider session id。
- [x] 将模型/推理模式选择外露到底部会话工具条，并补上选中状态。
- [x] 推理模式真切换：写入当前会话临时 `CODEX_HOME/config.toml` 的 `model_reasoning_effort` 后重新启动 Codex thread。
- [x] Code Graph Phase 1：TypeScript/JavaScript 文件级依赖索引、依赖查询、反向依赖查询、爆炸半径分析。
- [x] Code Graph 接入主进程服务、IPC、preload API 和类型声明。
- [x] Code Graph 增量索引：`FileChangeTracker` 文件变化后更新单文件依赖图，删除文件时清理依赖边。
- [x] Code Review 接入爆炸半径：审查前优先用 Code Graph 扩展受影响文件。
- [x] 新增 Code Graph 单元测试，覆盖全量索引和单文件增量更新。

## 下一步最短路线

1. [x] Code Review UI 展示“因爆炸半径纳入审查”的文件来源和距离。
2. [x] Code Graph Phase 3：输出变更文件的符号级爆炸半径，而不是只到文件级。
3. [x] 看板任务完成后自动触发 Evaluation，并把评分/结论回写 Goal 进度。
4. [ ] 统一知识中心 UI：项目知识、跨会话记忆、工作记忆三类数据在同一视图中按范围和生命周期筛选。
5. [ ] 成本/用量/上下文预算合并为资源监控中心。

## 验证记录

- [x] `npm run typecheck`
- [x] `npm test -- src/main/code-graph/CodeGraphService.test.ts`
- [x] `npm test`
- [x] `npm run build`

## 备注

- 当前 `npm test` 在部分本机环境可能会出现 `better-sqlite3` Node ABI 不匹配提示，测试会降级到 in-memory fallback；只要测试结果通过即可。
- 运行时使用 `out/main/index.js`，涉及主进程改动后必须执行 `npm run build`。
