# P0-2: 目标→规划→任务→评估 链条打通 - TODO

## 概述
将 Goal(目标锚点)、Planner(规划引擎)、Task(任务看板)、Evaluation(任务评估)、DriftGuard(漂移检测) 五大模块打通,形成完整的任务生命周期闭环。

---

## 状态说明
- ✅ 已完成
- 🔧 部分完成,待继续
- ⏳ 未开始

---

## 1. Goal → Planner: 从目标一键生成规划

### 1.1 后端服务层
- [x] `GoalService.setPlannerService()` - 设置 Planner 引用
- [x] `GoalService.generatePlanFromGoal(goalId, sessionId)` - 从目标生成规划
- [ ] `PlannerService` 接收 goalId 外键关联
- [ ] 数据库表扩展: `plan_sessions` 添加 `goal_id` 字段

### 1.2 IPC 层
- [ ] 添加 IPC: `GOAL_GENERATE_PLAN` - 前端调用生成规划
- [ ] 在 `goalHandlers.ts` 注册处理器

### 1.3 前端 Store
- [ ] `goalStore.ts` 添加 `generatePlan(goalId, sessionId)` 方法
- [ ] 监听 `plan-generated` 事件

### 1.4 前端 UI
- [ ] `GoalSettings.tsx` - 目标详情卡片添加"生成规划"按钮
- [ ] 生成中状态展示(loading spinner)
- [ ] 生成成功后跳转到规划详情

### 1.5 测试
- [ ] 单元测试: `generatePlanFromGoal()` 成功创建规划
- [ ] 集成测试: UI 点击 → IPC → 后端生成 → 前端展示

---

## 2. Planner → Task: 规划步骤转为看板任务

### 2.1 后端服务层
- [ ] `PlannerService.syncPlanToKanban(planId)` - 将规划任务同步到看板
- [ ] `TaskSessionCoordinator` 监听 Planner 事件
- [ ] 数据映射: `PlanTask` → `TaskCard`
- [ ] 保持双向关联: `TaskCard` 记录 `planTaskId`

### 2.2 数据库
- [ ] `tasks` 表添加 `plan_task_id` 外键字段
- [ ] 添加索引: `idx_task_plan_task`

### 2.3 IPC 层
- [ ] 添加 IPC: `PLAN_SYNC_TO_KANBAN` - 同步规划到看板
- [ ] 添加 IPC: `TASK_GET_BY_PLAN_TASK` - 根据规划任务查看板任务

### 2.4 前端 UI
- [ ] `PlannerSettings.tsx` - 规划详情添加"同步到看板"按钮
- [ ] 看板任务卡片展示来源标识("来自规划: xxx")
- [ ] 支持一键同步整个规划的所有任务

### 2.5 事件联动
- [ ] Planner 任务完成 → 自动更新看板任务状态
- [ ] 看板任务完成 → 自动检查 Planner 任务完成状态

---

## 3. Task → Evaluation: 任务完成触发评估

### 3.1 后端服务层
- [ ] `TaskSessionCoordinator` 监听任务状态变化
- [ ] 当任务状态变为 `done` 时自动触发评估
- [ ] `EvaluationService.autoEvaluate(taskId, templateId?)` - 自动评估
- [ ] 评估模板自动匹配(根据任务标签/优先级)

### 3.2 配置
- [ ] 添加全局配置: `autoEvaluateOnTaskComplete` (默认开启)
- [ ] 可配置默认评估模板

### 3.3 IPC 层
- [ ] 添加 IPC: `EVAL_AUTO_TRIGGER` - 自动评估触发
- [ ] 添加事件: `task:auto-evaluated`

### 3.4 前端 UI
- [ ] 看板任务完成时展示评估进度提示
- [ ] 评估完成后展示评分卡片
- [ ] 设置面板添加"自动评估"开关

### 3.5 评估结果展示
- [ ] 看板任务卡片展示评估分数徽章
- [ ] 点击可查看评估详情(分数/理由/建议)
- [ ] 评估历史时间线

---

## 4. DriftGuard → Goal: 偏差时回退目标进度

### 4.1 后端服务层
- [x] `GoalService.regressProgressFromDrift()` - 漂移回退进度
- [ ] `DriftGuardService` 调用 GoalService 方法
- [ ] 漂移检测到时自动关联目标
- [ ] 根据漂移严重程度自动回退

### 4.2 事件联动
- [ ] DriftGuard 检测到 drift → 触发 `goal:drift-regressed` 事件
- [ ] 前端接收事件并更新 UI
- [ ] 连续漂移告警(超过阈值自动暂停会话)

### 4.3 前端 UI
- [ ] 目标详情卡片展示漂移历史记录
- [ ] 漂移回退时展示 Toast 通知
- [ ] 漂移趋势图表(时间线)

### 4.4 配置
- [ ] 可配置回退幅度(轻微5%/中度10%/严重20%)
- [ ] 可关闭自动回退功能

---

## 5. Evaluation → Goal: 评估分数反馈到目标进度

### 5.1 后端服务层
- [x] `GoalService.updateProgressFromEvaluation()` - 评估更新进度
- [ ] `EvaluationService` 完成后调用 GoalService
- [ ] 进度计算公式: `newProgress = currentProgress * 0.3 + evaluationScore * 0.7`
- [ ] 进度达到100%自动标记目标为已达成

### 5.2 事件联动
- [ ] Evaluation 完成 → 触发 `goal:evaluation-updated` 事件
- [ ] 前端接收事件并更新进度条
- [ ] 目标达成时发送庆祝通知 🎉

### 5.3 前端 UI
- [ ] 目标进度条动画展示变化
- [ ] 评估分数与进度关联展示
- [ ] 评估历史与进度变化时间线

### 5.4 智能建议
- [ ] 低分评估时自动建议创建改进任务
- [ ] 高分评估时自动建议设置新目标

---

## 6. 完整链路集成测试

### 6.1 端到端测试场景
- [ ] **场景1**: 创建目标 → 生成规划 → 同步到看板 → 执行任务 → 自动评估 → 目标达成
- [ ] **场景2**: 创建目标 → 开启漂移检测 → 检测到漂移 → 进度回退 → 纠正后恢复
- [ ] **场景3**: 多目标并行 → 评估分数分别反馈 → 进度独立更新

### 6.2 边界情况
- [ ] 目标不存在时 graceful 处理
- [ ] 评估失败时不阻断任务流程
- [ ] 漂移检测误判时允许手动恢复进度
- [ ] 并发操作时的数据一致性

### 6.3 性能测试
- [ ] 100+ 目标同时评估的响应时间
- [ ] 大规划(50+ 任务)同步到看板的性能
- [ ] 频繁漂移检测时的系统负载

---

## 7. UI/UX 增强

### 7.1 统一导航
- [ ] 侧边栏添加"任务生命周期"一级入口
- [ ] 子菜单: 目标 / 规划 / 看板 / 评估 / 漂移
- [ ] 面包屑导航展示当前在链路中的位置

### 7.2 链路可视化
- [ ] 绘制任务生命周期流程图
- [ ] 实时展示当前任务在链路中的状态
- [ ] 点击节点跳转到对应功能页面

### 7.3 仪表盘
- [ ] 任务生命周期总览仪表盘
- [ ] 关键指标: 目标达成率/规划完成率/任务完成速度/评估平均分/漂移次数
- [ ] 趋势图表(周/月/季度)

### 7.4 智能推荐
- [ ] AI 推荐最佳实践路径
- [ ] 根据历史数据推荐评估模板
- [ ] 漂移预测与预防建议

---

## 8. 文档与培训

### 8.1 用户文档
- [ ] 任务生命周期使用指南
- [ ] 最佳实践案例
- [ ] 常见问题解答

### 8.2 开发文档
- [ ] 架构设计文档(数据流图/时序图)
- [ ] API 参考文档
- [ ] 扩展开发指南

### 8.3 演示
- [ ] 录制功能演示视频
- [ ] 创建示例项目展示完整链路

---

## 优先级排序

### 🔥 立即实现 (本周)
1. ✅ `GoalService.generatePlanFromGoal()` - 已完成
2. ✅ `GoalService.updateProgressFromEvaluation()` - 已完成  
3. ✅ `GoalService.regressProgressFromDrift()` - 已完成
4. ⏳ Goal → Planner IPC 和 UI (生成规划按钮)
5. ⏳ Evaluation → Goal 事件联动

### ⚡ 高优先级 (下周)
6. ⏳ Planner → Task 同步到看板
7. ⏳ Task → Evaluation 自动触发
8. ⏳ DriftGuard → Goal 漂移回退集成

### 📋 中优先级 (下月)
9. ⏳ 完整链路端到端测试
10. ⏳ 链路可视化与仪表盘
11. ⏳ 智能推荐功能

### 💡 低优先级 (未来)
12. ⏳ UI/UX 全面增强
13. ⏳ 文档与演示
14. ⏳ 性能优化与扩展

---

## 技术债务

- [ ] 数据库表结构需要扩展(外键关联)
- [ ] 事件系统规范化(统一事件命名)
- [ ] 错误处理统一模式
- [ ] 日志记录规范化
- [ ] 单元测试覆盖率提升到 80%+

---

## 备注

**已完成的核心能力:**
- GoalService 已具备生成规划、评估更新进度、漂移回退的方法
- 这些方法已可用,但需要 IPC、前端 UI 和事件联动来激活

**下一步行动:**
1. 添加 IPC handlers 暴露后端方法到前端
2. 在 GoalSettings UI 添加"生成规划"按钮
3. 连接 Evaluation 完成事件到 Goal 进度更新
4. 连接 DriftGuard 漂移事件到 Goal 进度回退
