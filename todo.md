# SpectrAI TODO

更新时间：2026-04-27

## 产品目标

做一个面向开发者的本地 AI 研发工作台：本地多 Agent 编排 + 代码库理解 + 任务/目标闭环 + 多模型调度。

## 已完成

- [x] Codex 初始化修复：`baseInstructions` Promise 导致的 `invalid type: map, expected a string`。
- [x] KnowledgeCenter 查询参数数量错误修复。
- [x] Codex `/model` 真实切换：空闲时重启 thread 并更新 provider session id。
- [x] 推理模式真实切换：写入临时 `CODEX_HOME/config.toml` 的 `model_reasoning_effort` 后重启 thread。
- [x] 模型与推理模式选择外露到底部会话工具栏，并补上选中状态。
- [x] Code Graph 文件级依赖索引、增量索引、反向依赖、爆炸半径分析。
- [x] Code Graph 符号级爆炸半径。
- [x] Code Review 接入 Code Graph 影响范围，并在 UI 展示纳入审查的文件来源和距离。
- [x] 看板任务完成后自动触发 Evaluation，并把评分/结论回写 Goal 进度。
- [x] 统一知识中心 UI：项目知识、跨会话记忆、工作记忆按范围和生命周期筛选。
- [x] 成本、用量、上下文预算合并为资源监控中心。

## 下一步最短路线

1. [x] 目标到执行的一键闭环：`Goal -> Planner -> Kanban/Team -> Evaluation -> Goal progress`。
   - [x] Goal 生成 Planner 时保存 `goalId` 关联。
   - [x] Goal 详情页支持“生成规划”与“生成并同步到看板”。
   - [x] Planner 同步看板后能在任务 metadata/tag 中保留 plan/goal 来源。
   - [x] 看板任务完成后的 Evaluation 能稳定回写对应 Goal。
   - [x] 从看板/规划任务一键派发到 Agent Team。
   - [x] 完整链路端到端验证：目标 -> 规划 -> 看板 -> 完成 -> 评估 -> 目标进度。
2. [x] Team/Agent 执行体验增强。
   - [x] 团队视图突出“谁在做什么、卡在哪里、产出是什么”。
   - [x] 支持从看板/规划任务一键派发到 Agent Team。
   - [x] Agent 失败时提供重试、换模型、转人工处理入口。
   - [x] Team 成员可单独配置厂商、模型和提示词，并在成员会话启动时真实传入。
3. [ ] 代码库自然语言问答。
   - [x] 基于 Code Graph 回答“谁调用了这个函数/改这里影响哪里/入口在哪里”的第一版解析接口。
   - [x] 聊天工具栏接入“代码库问答”，可把图谱结果整理成上下文插入输入框。
   - [x] 会话中可直接引用符号、文件、爆炸半径结果，并在 Code Graph 问答结果里提供打开/引用操作。
4. [ ] QA/SHIP 闭环。
   - [x] 生成交付检查计划：根据 package scripts、git 改动和相关测试候选生成验证提示，并可从聊天工具栏插入当前会话。
   - [x] 自动执行相关测试/类型检查/构建检查并采集结果摘要，失败时把 stdout/stderr 摘要插入会话。
   - [ ] 测试失败后生成修复任务。
   - [ ] 生成变更说明，可选提交/打包。
5. [ ] 资源监控策略化。
   - [ ] 超预算提醒并建议切换模型。
   - [ ] 上下文快满时建议压缩或迁移。
   - [ ] 低价值会话自动归档建议。
6. [ ] 新手主路径与信息架构收敛。
   - [ ] 首屏引导用户从“目标”开始。
   - [ ] 串联目标、规划、团队、看板、评估的生命周期视图。

## 验证记录

- [x] `npm run typecheck`
- [x] `npm test -- src/main/goal/GoalExecutionFlow.test.ts`
- [x] `npm test`
- [x] `npm run build`

## 备注

- 当前 `npm test` 在部分本机环境可能出现 `better-sqlite3` Node ABI 不匹配提示，测试会降级到 in-memory fallback；只要测试结果通过即可。
- 运行时使用 `out/main/index.js`，涉及主进程改动后必须执行 `npm run build`。
