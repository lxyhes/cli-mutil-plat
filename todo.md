## 下一步推进记录（2026-04-24）

- [x] 修复 `npm test` 路径：更新 `TeamManager` 测试 mock 与当前仓储接口，补齐团队创建、查询、取消的行为约束。
- [x] 新增 Phase 1 代码图谱：TypeScript/JavaScript 文件级依赖索引、依赖查询、反向依赖查询、爆炸半径分析。
- [x] 接入 Code Graph 主进程服务、IPC、preload API 和类型声明。
- [x] 新增 `CodeGraphService` 单元测试；`npm run typecheck` 与 `npm test` 均已通过。
- [ ] 下一步：接入 `FileChangeTracker` 做增量索引，并让 `CodeReviewService` 优先消费爆炸半径结果。

## 最短路线推进状态（2026-04-24）

### 1. 工程绿灯

- [x] 修复 `npm run typecheck` 当前硬错误。
- [x] 收口 `PanelId` 与工具箱二级功能类型，避免侧边栏/工具箱类型混用。
- [x] 补齐 `GoalStore.generatePlan` 类型声明。
- [x] 修复 Knowledge 分类过滤类型。
- [x] 修复 `ConversationView` 分组 key 的类型窄化问题。
- [ ] `npm test` 仍受本机 `spawn EPERM` 阻塞，需要处理 Vitest/esbuild 子进程权限。

### 2. 目标 → 规划 → 任务 → 评估闭环

- [x] 修正 Goal 生成 Planner 规划的返回结构与事件通知。
- [x] 修正 Planner 内部计划任务状态更新，避免误写普通看板任务。
- [x] 新增 `plan:sync-to-kanban` IPC 与 preload API。
- [x] Planner Store 支持 `syncToKanban`。
- [x] Planner UI 增加“同步到看板”入口。
- [x] 同步看板时通过 `plan-task:<id>` 标签避免重复创建。
- [ ] 看板任务完成后的自动评估结果，还需要进一步回写 Goal 进度并在 UI 展示。

### 3. 代码图谱 / 爆炸半径

- [x] 补充路线文档：[docs/code-review-graph-roadmap.md](docs/code-review-graph-roadmap.md)
- [ ] Phase 1：TypeScript/JavaScript 文件级依赖图。
- [ ] Phase 2：接入 FileChangeTracker 做增量索引。
- [ ] Phase 3：输出变更文件/符号的爆炸半径。
- [ ] Phase 4：CodeReviewService 消费爆炸半径结果。

---

基于全面的系统分析，我整理出了功能融合方案。以下是 SpectrAI 系统功能融合的优先级排序和具体方案：

功能融合方案
P0 — 最关键的碎片化问题
1. 知识系统三合一
   现状：项目知识库、跨会话记忆、工作记忆三者概念重叠，用户难区分 方案：构建统一「知识中心」，按 范围×生命周期 组织：

维度	持久（跨会话）	临时（会话内）
项目级	项目知识库	工作记忆
全局级	跨会话记忆	当前上下文
侧边栏 KnowledgeView 升级为三 Tab 统一视图
会话内 SessionKnowledgePanel 复用 KnowledgeView 的渲染组件（消除代码重复）
统一自动注入机制，避免知识库和记忆重复注入
2. 目标→规划→任务→评估 链条打通
   现状：Goal、Planner、Task、Evaluation、DriftGuard 各自独立 方案：

Goal 可一键触发 Planner 生成规划
Planner 产出的步骤可转为看板 Task
Task 执行完成触发 Evaluation 评分
DriftGuard 偏差时关联 Goal 进度回退
评估分数反馈到 Goal 进度百分比
P1 — 高价值集成
3. 成本/用量统一监控
   现状：成本仪表盘、上下文预算、每日日报分散 方案：合并为「资源监控中心」三 Tab：

概览 — 实时 Token/金额/上下文使用率
趋势 — 日/周/月用量曲线
日报 — 自动生成+推送（飞书/Telegram）
4. 审查→回溯→Git 闭环
   现状：代码审查、智能回溯、Git 面板操作路径独立 方案：

审查前自动创建 Checkpoint 快照
审查结果可一键「回滚到此快照」
审查修复后自动 commit（Git 面板联动）
5. AI 质量评估生态统一
   现状：对决、竞技场、评估三个独立比较系统 方案：统一为「AI 质量中心」

对决结果 → 可提交到竞技场排名
评估打分 → 可作为竞技场评分依据
竞技场排行 → 可触发对决验证
P2 — 体验优化
6. 通知推送中心统一
   飞书/Telegram Webhook 一处配置，多处使用（日报+通知+告警）
7. 会话模板 ∪ 技能系统
   模板可引用 Skill 作为启动组件
   Skill 的 systemPromptAddition 可从知识库条目生成
8. Timeline + Replay 统一时序视图
   Timeline 支持回放模式
   Replay 作为 Timeline 的「存档回放」模式
9. VoiceView 样式统一
   替换原始 gray-800/blue-400 为 bg-bg-secondary/text-accent-blue 主题变量
10. 侧边栏功能分级
    核心功能（知识、审查、成本）前置
    高级功能（竞技场、录像、漂移检测）折叠到二级
    按场景推荐功能入口
    要我开始实现哪些融合？建议从 P0-1 知识系统三合一 开始，因为代码重复最严重、用户困惑最大。
