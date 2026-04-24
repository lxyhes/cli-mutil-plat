# Code Review Graph / 爆炸半径分析路线

整理日期：2026-04-24

## 目标

把当前“文件改动审查”升级为“代码结构图谱审查”：系统先理解文件依赖、导入关系、调用链和测试关联，再把真正相关的上下文交给 AI，避免每次审查都重读整个仓库。

## 当前进度

### Phase 1：文件级依赖图（已完成）

- 已新增 `CodeGraphService`，支持扫描 TypeScript/JavaScript 源文件。
- 已记录文件索引、导入边、相对路径解析结果。
- 已支持依赖查询、反向依赖查询、文件级爆炸半径分析。
- 已接入主进程初始化、IPC handlers、preload API 和类型声明。
- 已增加单元测试覆盖索引、依赖、反向依赖和爆炸半径。
- SQLite 可用时写入本地表；当前 Node/better-sqlite3 ABI 不匹配时会自动使用进程内 fallback 索引。

## 最小可落地版本

### Phase 2：增量更新

- 接入现有 `FileChangeTracker`。
- 文件变更时只重建该文件的索引和边。
- 删除文件时清理对应节点和导入边。

### Phase 3：爆炸半径增强

- 输入一个变更文件或符号，返回：
  - 直接依赖方
  - 直接被依赖方
  - 相关测试文件
  - 可能受影响的入口文件
- 输出按风险排序的文件清单，供 `CodeReviewService` 消费。

### Phase 4：AI 审查闭环

- `CodeReviewService` 优先读取爆炸半径文件，而不是全仓库扫描。
- 审查结果里展示“影响范围”。
- 一键把影响范围发送给当前会话或 Agent Team。

## 建议数据表

```sql
code_graph_files(id, project_path, file_path, language, content_hash, updated_at)
code_graph_symbols(id, file_id, name, kind, line_start, line_end, export_type)
code_graph_edges(id, project_path, from_symbol_id, to_symbol_id, edge_type)
code_graph_imports(id, file_id, imported_path, imported_name, local_name)
```

## 与现有模块关系

- `FileChangeTracker`：提供增量更新触发。
- `CodeReviewService`：消费爆炸半径结果，缩小审查上下文。
- `CodeContextInjectionService`：把影响范围包装成可发送给 AI 的提示词。
- `KnowledgeCenterService`：沉淀项目级架构知识和常见风险。

## 当前优先级

1. 接入 `FileChangeTracker` 做增量索引。
2. 让 `CodeReviewService` 消费文件级爆炸半径。
3. 再做符号级索引。
4. 最后接入 Tree-sitter 做高精度调用链。
