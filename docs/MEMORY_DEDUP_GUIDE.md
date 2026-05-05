# 记忆相似度去重和版本历史功能

## 📋 功能概述

记忆相似度去重和版本历史功能提供了智能的记忆管理和演化追踪能力，帮助系统自动识别重复记忆、维护版本历史、提供合并建议，从而提升知识库的质量和可维护性。

### ✨ 核心功能

1. **智能相似度计算** - 基于 Jaccard + TF-IDF 混合算法
2. **自动去重检测** - 定期扫描并识别重复记忆
3. **版本历史追踪** - 记录每次变更的完整历史
4. **记忆演化分析** - 分析记忆的演变过程和稳定性
5. **合并建议生成** - 智能推荐需要合并的记忆
6. **冲突检测** - 识别矛盾或过时的记忆

---

## 🎯 使用场景

### 场景 1: 防止记忆冗余

当系统积累了大量跨会话记忆时：
- 自动检测相似的记忆条目
- 避免存储重复内容
- 节省存储空间
- 提高检索效率

```typescript
// 示例：检测新记忆是否与现有记忆重复
const newMemory = {
  id: 'mem-new',
  summary: '使用 React Hooks 管理状态',
  keyPoints: 'useState, useEffect, useContext',
}

const existingMemories = await getAllMemories()
const duplicates = await window.spectrAI.memoryDedup.detectDuplicates(newMemory, existingMemories)

if (duplicates.length > 0) {
  console.log('发现重复记忆:', duplicates)
  // 可以选择合并、替换或保留
}
```

### 场景 2: 追踪记忆演化

当某个知识点随时间发生变化时：
- 记录每次更新的版本
- 追踪知识的演进路径
- 识别重大变更
- 评估知识稳定性

```typescript
// 示例：获取记忆的版本历史
const versions = await window.spectrAI.memoryDedup.getVersionHistory(memoryId)

versions.forEach(version => {
  console.log(`v${version.version}: ${version.changeType} at ${version.createdAt}`)
  console.log(`  Reason: ${version.changeReason}`)
})
```

### 场景 3: 优化知识库质量

定期执行去重检查：
- 发现潜在的重复记忆
- 生成合并建议
- 人工审核后执行合并
- 保持知识库精简高效

```typescript
// 示例：执行全量去重检查
const result = await window.spectrAI.memoryDedup.performCheck()

console.log(`检测到 ${result.candidates.length} 个重复对`)

// 查看待处理的合并建议
const suggestions = await window.spectrAI.memoryDedup.getPendingSuggestions()

suggestions.forEach(suggestion => {
  console.log(`建议合并 ${suggestion.memoryIds.length} 个记忆`)
  console.log(`置信度: ${(suggestion.confidence * 100).toFixed(1)}%`)
  console.log(`理由: ${suggestion.reason}`)
})
```

---

## 🔧 API 使用

### 基础用法

#### 1. 计算文本相似度

```typescript
const result = await window.spectrAI.memoryDedup.calculateSimilarity(
  '使用 React Hooks 管理状态',
  'React Hooks 用于状态管理'
)

console.log(`相似度: ${(result.score * 100).toFixed(1)}%`)
console.log(`方法: ${result.method}`)
console.log(`详情:`, result.details)
```

**返回结果：**
```json
{
  "success": true,
  "result": {
    "score": 0.87,
    "method": "jaccard+tfidf",
    "details": {
      "jaccard": 0.75,
      "tfidf": 0.95,
      "weights": {
        "jaccard": 0.4,
        "tfidf": 0.6
      }
    }
  }
}
```

#### 2. 检测重复记忆

```typescript
const newMemory = {
  id: 'mem-123',
  summary: 'TypeScript 类型安全最佳实践',
  keyPoints: '使用 interface, 避免 any, 严格模式',
}

const existingMemories = [
  {
    id: 'mem-456',
    summary: 'TypeScript 类型安全的实践方法',
    keyPoints: 'interface, no any, strict mode',
  },
  // ... 更多记忆
]

const duplicates = await window.spectrAI.memoryDedup.detectDuplicates(
  newMemory,
  existingMemories
)

duplicates.forEach(dup => {
  console.log(`重复候选: ${dup.originalId} <-> ${dup.duplicateId}`)
  console.log(`相似度: ${(dup.similarity.score * 100).toFixed(1)}%`)
  console.log(`建议: ${dup.recommendation}`)
  console.log(`原因: ${dup.reason}`)
})
```

#### 3. 创建记忆版本

```typescript
const version = await window.spectrAI.memoryDedup.createVersion({
  memoryId: 'mem-123',
  content: '更新后的内容...',
  keyPoints: '新的关键点...',
  keywords: 'keyword1, keyword2',
  summary: '新的摘要...',
  createdBy: 'session-abc',
  changeType: 'update',
  changeReason: '根据最新实践更新',
  metadata: {
    source: 'manual-edit',
    reviewedBy: 'user-xyz',
  },
})

console.log(`创建版本 v${version.version}`)
```

#### 4. 获取版本历史

```typescript
const result = await window.spectrAI.memoryDedup.getVersionHistory('mem-123', 10)

result.versions.forEach(v => {
  console.log(`v${v.version} (${v.changeType}): ${v.createdAt}`)
  console.log(`  内容: ${v.content.slice(0, 100)}...`)
})
```

#### 5. 分析记忆演化

```typescript
const result = await window.spectrAI.memoryDedup.analyzeEvolution('mem-123')

console.log(result.analysis.evolutionSummary)
console.log(`稳定性评分: ${(result.analysis.stabilityScore * 100).toFixed(1)}%`)

result.analysis.majorChanges.forEach(change => {
  console.log(`v${change.version}: ${change.description}`)
})
```

#### 6. 生成合并建议

```typescript
const suggestion = await window.spectrAI.memoryDedup.generateMergeSuggestion([
  'mem-123',
  'mem-456',
  'mem-789',
])

console.log(`建议合并 ${suggestion.memoryIds.length} 个记忆`)
console.log(`置信度: ${(suggestion.confidence * 100).toFixed(1)}%`)
console.log(`理由: ${suggestion.reason}`)
console.log(`合并后内容:\n${suggestion.suggestedContent}`)
```

#### 7. 接受/拒绝合并建议

```typescript
// 接受建议
await window.spectrAI.memoryDedup.acceptSuggestion('merge-abc')

// 拒绝建议
await window.spectrAI.memoryDedup.rejectSuggestion('merge-abc')
```

#### 8. 获取统计信息

```typescript
const stats = await window.spectrAI.memoryDedup.getStats()

console.log(`总记忆数: ${stats.totalMemories}`)
console.log(`总版本数: ${stats.totalVersions}`)
console.log(`待处理建议: ${stats.pendingSuggestions}`)
console.log(`开放冲突: ${stats.openConflicts}`)
console.log(`平均每记忆版本数: ${stats.averageVersionsPerMemory.toFixed(2)}`)
```

---

## 📊 算法说明

### 1. 相似度计算算法

系统采用**混合算法**结合 Jaccard 相似度和 TF-IDF 余弦相似度：

```
最终相似度 = Jaccard得分 × 0.4 + TF-IDF得分 × 0.6
```

#### Jaccard 相似度

**公式**: J(A,B) = |A ∩ B| / |A ∪ B|

**特点**:
- 简单快速
- 适合短文本
- 对词序不敏感

**示例**:
```
文本1: "使用 React Hooks"
文本2: "React Hooks 使用"

集合1: {使用, react, hooks}
集合2: {react, hooks, 使用}

交集: {使用, react, hooks} → 大小 3
并集: {使用, react, hooks} → 大小 3

Jaccard = 3/3 = 1.0 (完全相同)
```

#### TF-IDF 余弦相似度

**TF (Term Frequency)**: 词频
```
TF(term) = 该词在文档中出现的次数 / 文档总词数
```

**IDF (Inverse Document Frequency)**: 逆文档频率
```
IDF(term) = log(总文档数 / 包含该词的文档数) + 1
```

**TF-IDF**: 
```
TF-IDF(term) = TF(term) × IDF(term)
```

**余弦相似度**:
```
cos(θ) = (A·B) / (||A|| × ||B||)
```

**特点**:
- 考虑词的重要性
- 适合长文本
- 能识别关键词

### 2. 去重检测流程

```
1. 提取新记忆的文本特征
2. 与现有记忆逐一比较
3. 计算相似度分数
4. 如果分数 >= 阈值 (默认 0.85):
   - 标记为重复候选
   - 根据分数推荐操作:
     * >= 0.95: merge (合并)
     * >= 0.90: replace (替换)
     * >= 0.85: keep_both (保留两者)
5. 按相似度排序返回结果
```

### 3. 版本管理策略

**版本号规则**:
- 从 1 开始递增
- 每次变更创建新版本
- 保留最近 N 个版本 (默认 10)

**变更类型**:
- `create`: 初始创建
- `update`: 内容更新
- `merge`: 合并多个记忆
- `split`: 拆分为多个记忆

**清理策略**:
```sql
DELETE FROM memory_versions
WHERE memory_id = ?
  AND version NOT IN (
    SELECT version FROM memory_versions
    WHERE memory_id = ?
    ORDER BY version DESC
    LIMIT 10  -- maxVersionsPerMemory
  )
```

### 4. 稳定性评分算法

**计算公式**:
```
densityFactor = 版本数量 / (时间跨度(天) + 1)
stabilityScore = max(0, min(1, 1 - densityFactor × 0.5))
```

**解释**:
- 版本越密集，稳定性越低
- 时间跨度越大，稳定性越高
- 评分范围: 0 (极不稳定) ~ 1 (非常稳定)

**示例**:
```
记忆 A: 5 个版本，跨越 10 天
densityFactor = 5 / (10 + 1) = 0.45
stabilityScore = 1 - 0.45 × 0.5 = 0.775 (较稳定)

记忆 B: 5 个版本，跨越 1 天
densityFactor = 5 / (1 + 1) = 2.5
stabilityScore = max(0, 1 - 2.5 × 0.5) = 0 (极不稳定)
```

---

## ⚙️ 配置选项

### 默认配置

```typescript
const defaultConfig = {
  enabled: true,                // 是否启用
  similarityThreshold: 0.85,    // 相似度阈值
  jaccardWeight: 0.4,           // Jaccard 权重
  tfidfWeight: 0.6,             // TF-IDF 权重
  maxVersionsPerMemory: 10,     // 最大版本数
  autoMergeEnabled: false,      // 自动合并 (暂未实现)
  checkIntervalMs: 3600000,     // 检查间隔 (1小时)
}
```

### 自定义配置

```typescript
// 更新配置
await window.spectrAI.memoryDedup.updateConfig({
  similarityThreshold: 0.9,     // 提高阈值，减少误报
  maxVersionsPerMemory: 20,     // 保留更多版本
  checkIntervalMs: 7200000,     // 每2小时检查一次
})

// 获取当前配置
const config = await window.spectrAI.memoryDedup.getConfig()
console.log(config)
```

### 配置说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | true | 是否启用周期性检查 |
| `similarityThreshold` | number | 0.85 | 相似度阈值 (0-1) |
| `jaccardWeight` | number | 0.4 | Jaccard 算法权重 |
| `tfidfWeight` | number | 0.6 | TF-IDF 算法权重 |
| `maxVersionsPerMemory` | number | 10 | 每个记忆的最大版本数 |
| `autoMergeEnabled` | boolean | false | 是否自动合并 (预留) |
| `checkIntervalMs` | number | 3600000 | 周期性检查间隔 (毫秒) |

**注意**: `jaccardWeight + tfidfWeight` 应该等于 1.0

---

## 💡 最佳实践

### 1. 调整相似度阈值

**高阈值 (0.9-0.95)**:
- 优点: 减少误报，只检测高度重复
- 缺点: 可能漏掉中度相似的重复
- 适用: 记忆质量高，变化频繁的场景

**低阈值 (0.75-0.85)**:
- 优点: 发现更多潜在重复
- 缺点: 可能产生误报
- 适用: 记忆量大，需要严格去重的场景

### 2. 版本管理策略

**保守策略**:
```typescript
{
  maxVersionsPerMemory: 20,
  checkIntervalMs: 7200000,  // 2小时
}
```
- 保留更多历史版本
- 减少检查频率
- 适合重要知识的长期追踪

**激进策略**:
```typescript
{
  maxVersionsPerMemory: 5,
  checkIntervalMs: 1800000,  // 30分钟
}
```
- 节省存储空间
- 更频繁的检查
- 适合快速迭代的场景

### 3. 合并建议审核流程

```
1. 定期获取待处理建议
2. 人工审核每个建议:
   - 检查合并理由
   - 预览合并后内容
   - 确认不会丢失重要信息
3. 接受或拒绝建议
4. 记录审核决策供后续学习
```

### 4. 监控统计指标

```typescript
// 定期检查统计信息
setInterval(async () => {
  const stats = await window.spectrAI.memoryDedup.getStats()
  
  // 告警条件
  if (stats.pendingSuggestions > 50) {
    console.warn('待处理合并建议过多，请及时审核')
  }
  
  if (stats.openConflicts > 10) {
    console.warn('存在多个未解决的记忆冲突')
  }
  
  if (stats.averageVersionsPerMemory > 15) {
    console.warn('平均版本数过高，考虑增加 maxVersionsPerMemory')
  }
}, 3600000)  // 每小时检查
```

---

## 🛠️ 故障排查

### 问题 1: 检测不到明显的重复

**可能原因**:
- 阈值设置过高
- 文本差异较大但语义相同

**解决方法**:
```typescript
// 降低阈值
await window.spectrAI.memoryDedup.updateConfig({
  similarityThreshold: 0.75,
})

// 手动测试相似度
const result = await window.spectrAI.memoryDedup.calculateSimilarity(text1, text2)
console.log(`实际相似度: ${result.score}`)
```

### 问题 2: 误报太多

**可能原因**:
- 阈值设置过低
- 短文本容易误判

**解决方法**:
```typescript
// 提高阈值
await window.spectrAI.memoryDedup.updateConfig({
  similarityThreshold: 0.9,
})

// 调整权重，增加 TF-IDF 的比重
await window.spectrAI.memoryDedup.updateConfig({
  jaccardWeight: 0.3,
  tfidfWeight: 0.7,
})
```

### 问题 3: 版本历史增长过快

**可能原因**:
- `maxVersionsPerMemory` 设置过大
- 记忆更新过于频繁

**解决方法**:
```typescript
// 减少最大版本数
await window.spectrAI.memoryDedup.updateConfig({
  maxVersionsPerMemory: 5,
})

// 检查是否有自动化脚本在频繁更新记忆
```

### 问题 4: 周期性检查未执行

**可能原因**:
- `enabled` 设置为 false
- `checkIntervalMs` 设置过大

**解决方法**:
```typescript
const config = await window.spectrAI.memoryDedup.getConfig()
console.log(`启用状态: ${config.enabled}`)
console.log(`检查间隔: ${config.checkIntervalMs / 1000} 秒`)

// 重新启用
await window.spectrAI.memoryDedup.updateConfig({
  enabled: true,
  checkIntervalMs: 3600000,
})
```

---

## 📈 性能优化

### 1. 大规模记忆库优化

对于 1000+ 记忆的场景：

**批量处理**:
```typescript
// 不要一次性加载所有记忆
const batchSize = 100
for (let i = 0; i < totalMemories; i += batchSize) {
  const batch = await getMemoriesBatch(i, batchSize)
  const duplicates = await detectDuplicates(newMemory, batch)
  // 处理结果...
}
```

**索引优化**:
- 数据库已为 `memory_id` 和 `version` 创建索引
- FTS5 全文搜索索引加速文本匹配

### 2. 缓存策略

**内存缓存**:
- 服务内部维护 TF-IDF 索引缓存
- 去重指纹缓存 (1小时过期)

**建议**:
- 避免频繁重启服务
- 利用周期性检查的缓存结果

### 3. 异步处理

**非阻塞操作**:
```typescript
// 后台执行去重检查
window.spectrAI.memoryDedup.performCheck().then(result => {
  // 处理结果...
}).catch(err => {
  console.error('去重检查失败:', err)
})

// 继续执行其他任务...
```

---

## 🔮 未来改进方向

### 短期（1-2周）

1. **向量相似度支持**
   - 集成轻量级嵌入模型
   - 支持语义级别的相似度检测
   - 提高长文本匹配准确度

2. **自动合并执行**
   - 实现实际的合并逻辑
   - 创建合并后的新记忆
   - 标记旧记忆为已合并

3. **用户反馈学习**
   - 记录用户的接受/拒绝决策
   - 自动调整阈值和权重
   - 个性化去重策略

### 中期（1-2月）

1. **冲突解决助手**
   - AI 辅助分析记忆冲突
   - 提供解决建议
   - 自动生成修正方案

2. **可视化演化图**
   - 图形化展示记忆演化路径
   - 时间轴视图
   - 版本对比工具

3. **分布式去重**
   - 支持多设备间的记忆去重
   - 云端同步时的冲突处理
   - 增量更新优化

### 长期（3-6月）

1. **知识图谱集成**
   - 构建记忆之间的关系网络
   - 基于图结构的去重
   - 知识推理增强

2. **主动学习**
   - 识别知识空白
   - 建议补充新记忆
   - 自动更新过时知识

3. **协作去重**
   - 多人协作审核
   - 投票机制决定合并
   - 团队知识一致性保障

---

## 📚 相关资源

### 技术文档

- [Jaccard 相似度](https://en.wikipedia.org/wiki/Jaccard_index)
- [TF-IDF 算法](https://en.wikipedia.org/wiki/Tf%E2%80%93idf)
- [余弦相似度](https://en.wikipedia.org/wiki/Cosine_similarity)

### 代码参考

- `src/main/memory/MemoryDeduplicationService.ts` - 核心服务实现
- `src/main/ipc/memoryDedupHandlers.ts` - IPC handlers
- `src/preload/index.ts` - 前端 API 桥接

### 数据类型

- `src/shared/knowledgeCenterTypes.ts` - 统一知识类型定义

---

**最后更新**: 2026-04-30  
**版本**: 1.0  
**维护者**: AI Assistant
