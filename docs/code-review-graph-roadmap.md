# Code Review Graph / 爆炸半径分析路线

整理日期：2026-04-24

## 目标

把当前“文件改动审查”升级为“代码结构图谱审查”：系统先理解函数、类、导出、导入、调用链和测试关联，再把真正相关的上下文交给 AI，避免每次审查都重读整个仓库。

## 最小可落地版本

### Phase 1：代码索引

- 扫描项目源文件，建立本地 SQLite 索引。
- 记录文件、符号、导入导出、粗粒度调用关系。
- 首版可先支持 TypeScript/JavaScript，后续再扩展 Go/Python/Java。

### Phase 2：增量更新

- 接入现有 FileChangeTracker。
- 文件变更时只重建该文件的符号与依赖边。
- 删除文件时清理关联节点。

### Phase 3：爆炸半径

- 输入一个变更文件或符号，返回：
  - 直接调用方
  - 直接依赖方
  - 相关测试文件
  - 可能受影响的入口文件
- 输出一个按风险排序的文件清单，供 CodeReviewService 审查。

### Phase 4：AI 审查闭环

- CodeReviewService 优先读取爆炸半径文件，而不是全仓库扫描。
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

1. 先做 TypeScript/JavaScript 文件级依赖图。
2. 再做符号级索引。
3. 最后接入 Tree-sitter 做高精度调用链。
