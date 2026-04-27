/**
 * 内置技能定义
 * 这些技能在应用启动时自动写入数据库（idempotent）
 * @author weibin
 */
import type { Skill } from '../../shared/types'

const NOW = new Date().toISOString()

export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'builtin-code-review',
    name: '代码审查',
    description: '对代码进行全面审查，涵盖逻辑、性能、安全性和可维护性',
    category: 'development',
    slashCommand: 'code-review',
    type: 'prompt',
    compatibleProviders: 'all',
    promptTemplate: `请对以下代码进行全面审查：

{{user_input}}

请从以下维度分析：
1. **逻辑正确性** - 是否存在逻辑错误或边界情况未处理
2. **性能** - 是否有性能瓶颈或可优化点
3. **安全性** - 是否有安全漏洞（注入、越权、数据泄露等）
4. **可读性** - 命名、注释、结构是否清晰
5. **可维护性** - 是否符合最佳实践，是否便于扩展

请以结构化格式输出审查结果，并给出具体的改进建议（附代码示例）。`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['code', 'review', 'quality'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'builtin-translate',
    name: '翻译',
    description: '将内容翻译为指定语言，保持原文语气和格式',
    category: 'language',
    slashCommand: 'translate',
    type: 'prompt',
    compatibleProviders: 'all',
    inputVariables: [
      {
        name: 'lang',
        description: '目标语言',
        required: false,
        defaultValue: '中文',
        type: 'select',
        options: ['中文', '英文', '日语', '韩语', '法语', '德语', '西班牙语', '俄语'],
      },
    ],
    promptTemplate: `请将以下内容翻译为{{lang}}，保持原文的语气、风格和格式：

{{user_input}}

注意：
- 专业术语保持准确
- 不要过度意译，尊重原文表达
- 如有歧义，优先参考上下文`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['language', 'translation'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'builtin-explain',
    name: '解释代码',
    description: '用通俗易懂的语言解释代码的功能和实现原理',
    category: 'development',
    slashCommand: 'explain',
    type: 'prompt',
    compatibleProviders: 'all',
    promptTemplate: `请解释以下代码：

{{user_input}}

请包含：
1. **整体功能**（1-2 句话概括）
2. **关键逻辑步骤**（按执行顺序说明）
3. **使用的主要技术/模式**
4. **潜在注意事项**（边界情况、副作用等）

用通俗易懂的语言，适合中等水平开发者理解。`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['code', 'explain', 'learning'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'builtin-write-test',
    name: '生成测试',
    description: '为代码或函数生成完整的单元测试',
    category: 'development',
    slashCommand: 'write-test',
    type: 'prompt',
    compatibleProviders: 'all',
    inputVariables: [
      {
        name: 'framework',
        description: '测试框架',
        required: false,
        defaultValue: 'jest',
        type: 'select',
        options: ['jest', 'vitest', 'mocha', 'pytest', 'unittest', 'go test', 'JUnit'],
      },
    ],
    promptTemplate: `请为以下代码使用 {{framework}} 编写完整的单元测试：

{{user_input}}

测试要求：
- 覆盖正常流程、边界情况和异常情况
- 测试命名清晰描述意图（given-when-then 风格）
- 使用 {{framework}} 的最佳实践
- 包含必要的 mock 和 stub
- 目标测试覆盖率 ≥ 80%`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['testing', 'code', 'quality'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'builtin-write-doc',
    name: '生成文档',
    description: '为代码、函数或模块生成文档注释',
    category: 'documentation',
    slashCommand: 'write-doc',
    type: 'prompt',
    compatibleProviders: 'all',
    inputVariables: [
      {
        name: 'style',
        description: '文档风格',
        required: false,
        defaultValue: 'JSDoc',
        type: 'select',
        options: ['JSDoc', 'TSDoc', 'Docstring (Python)', 'GoDoc', 'Markdown README'],
      },
    ],
    promptTemplate: `请为以下代码生成 {{style}} 格式的文档注释：

{{user_input}}

文档需包含：
- 简短描述（一句话说明用途）
- 参数说明（类型、含义、是否可选）
- 返回值说明
- 使用示例（如适用）
- 注意事项（如异常情况、副作用等）`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['documentation', 'code'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'builtin-refactor',
    name: '重构建议',
    description: '分析代码并给出具体重构建议，提升代码质量',
    category: 'development',
    slashCommand: 'refactor',
    type: 'prompt',
    compatibleProviders: 'all',
    promptTemplate: `请分析以下代码并给出具体的重构建议：

{{user_input}}

重点关注：
- **消除重复**（DRY 原则）
- **简化复杂逻辑**（降低圈复杂度）
- **改善命名和抽象**（提升可读性）
- **应用合适的设计模式**

对每个建议：
1. 说明当前问题
2. 解释重构理由
3. 提供重构后的代码示例`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['refactoring', 'code', 'quality'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'builtin-commit-msg',
    name: 'Commit Message',
    description: '根据代码改动生成规范的 Git commit message',
    category: 'git',
    slashCommand: 'commit-msg',
    type: 'prompt',
    compatibleProviders: 'all',
    promptTemplate: `请根据以下代码改动生成规范的 Git commit message：

{{user_input}}

要求：
- 遵循 Conventional Commits 规范：<type>(<scope>): <description>
- type 选项：feat/fix/chore/docs/refactor/test/style/perf/ci
- 标题简洁（中文 ≤ 30 字，英文 ≤ 72 字符）
- 如有必要，添加详细描述（body）说明原因和影响
- 中文描述优先`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['git', 'commit'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'builtin-debug',
    name: 'Debug 协助',
    description: '分析错误信息和代码，帮助定位和解决 Bug',
    category: 'development',
    slashCommand: 'debug',
    type: 'prompt',
    compatibleProviders: 'all',
    promptTemplate: `请帮我分析以下问题：

{{user_input}}

请：
1. **分析可能的根本原因**（列出所有可能性，按可能性排序）
2. **指出最可能的原因**及判断依据
3. **给出具体的修复方案**（附代码示例）
4. **提供预防建议**（如何避免此类问题再次出现）

如果信息不足，请告诉我需要提供什么额外信息。`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['debug', 'bug', 'troubleshoot'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  // ---- Native Skill 示例 ----
  {
    id: 'builtin-quick-shell',
    name: '快速 Shell',
    description: '通过 Native 方式直接向 Claude 发送 Shell 命令执行请求',
    category: 'devops',
    slashCommand: 'sh',
    type: 'native',
    compatibleProviders: ['claude-code'],
    nativeConfig: {
      providerId: 'claude-code',
      rawContent: `请执行以下 Shell 命令并返回结果：

{{user_input}}

执行后请告诉我：
- 命令是否成功执行
- 标准输出内容
- 如有错误，给出原因和修复建议`,
    },
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['shell', 'command', 'devops'],
    createdAt: NOW,
    updatedAt: NOW,
  },
  // ---- Orchestration Skill 示例 ----
  {
    id: 'builtin-review-and-test',
    name: '审查 + 测试',
    description: '编排技能：先用 Claude 审查代码，再自动生成测试用例',
    category: 'development',
    slashCommand: 'review-test',
    type: 'orchestration',
    compatibleProviders: 'all',
    orchestrationConfig: {
      mode: 'sequential',
      steps: [
        {
          id: 'step-review',
          name: '代码审查',
          providerId: '',
          prompt: `请对以下代码进行全面审查：\n\n{{user_input}}\n\n重点关注：逻辑正确性、性能、安全性、可维护性。以结构化格式输出审查结果。`,
          dependsOn: [],
        },
        {
          id: 'step-test',
          name: '生成测试',
          providerId: '',
          prompt: `基于上一步的代码审查结果，为以下代码生成单元测试：\n\n{{user_input}}\n\n请覆盖审查中发现的边界情况和异常情况。使用 vitest 框架。`,
          dependsOn: ['step-review'],
        },
      ],
    },
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['review', 'testing', 'orchestration'],
    createdAt: NOW,
    updatedAt: NOW,
  },

  // ─────────────────────────────────────────────────────────────
  // v2 新增内置技能
  // ─────────────────────────────────────────────────────────────

  // ---- CSO 安全审计 ----
  {
    id: 'builtin-cso-security-audit',
    name: 'CSO 安全审计',
    description: '以 CSO 视角对代码/架构进行全面安全审计，覆盖 OWASP Top 10 和业务逻辑漏洞',
    category: 'security',
    slashCommand: 'security-audit',
    type: 'prompt',
    compatibleProviders: 'all',
    inputVariables: [
      {
        name: 'scope',
        description: '审计范围',
        required: false,
        defaultValue: 'full',
        type: 'select',
        options: ['full', 'api', 'auth', 'data', 'infra', 'frontend'],
      },
    ],
    promptTemplate: `请以 CSO（首席安全官）的视角对以下内容进行安全审计（范围：{{scope}}）：

{{user_input}}

## 审计框架

### 1. OWASP Top 10 检查
- **A01 权限控制失效** — 越权访问、IDOR、角色绕过
- **A02 密码学失败** — 弱加密、硬编码密钥、不安全随机数
- **A03 注入** — SQL/NoSQL/命令/XSS/模板注入
- **A04 不安全设计** — 业务逻辑漏洞、竞态条件、缺少安全控制
- **A05 安全配置错误** — 默认凭证、调试模式开启、CORS 过宽
- **A06 易受攻击组件** — 过时依赖、已知 CVE
- **A07 身份认证失败** — 弱密码策略、Session 固定、Token 泄露
- **A08 数据完整性失败** — 不安全反序列化、缺少签名校验
- **A09 安全日志不足** — 敏感操作无日志、日志泄露敏感信息
- **A10 服务端请求伪造** — SSRF、内网探测

### 2. 业务逻辑安全
- 资金/积分操作是否有防重放
- 敏感操作是否有二次确认
- 数据隔离是否完善（多租户）

### 3. 输出格式
每个发现按以下格式：
| 编号 | 严重级别(Critical/High/Medium/Low) | 类别 | 描述 | 修复建议 | 修复代码示例 |

最后给出：
- **风险评分**（1-10，10 最危险）
- **优先修复顺序**（Top 3）
- **整体安全架构改进建议**`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['security', 'audit', 'OWASP', 'CSO'],
    createdAt: NOW,
    updatedAt: NOW,
  },

  // ---- Retro 工程复盘 ----
  {
    id: 'builtin-retro-engineering',
    name: 'Retro 工程复盘',
    description: '以技术 Leader 视角对已完成的项目/迭代进行结构化复盘，沉淀经验教训',
    category: 'management',
    slashCommand: 'retro',
    type: 'prompt',
    compatibleProviders: 'all',
    inputVariables: [
      {
        name: 'mode',
        description: '复盘模式',
        required: false,
        defaultValue: 'full',
        type: 'select',
        options: ['full', 'incident', 'milestone', 'sprint'],
      },
    ],
    promptTemplate: `请以技术 Leader 的视角对以下内容进行工程复盘（模式：{{mode}}）：

{{user_input}}

## 复盘框架

### 1. 目标回顾
- 原始目标是什么？
- 实际达成了什么？
- 差距有多大？

### 2. 过程分析
- **做得好的（Keep）**
  - 哪些决策带来了积极结果？
  - 哪些实践值得继续？
- **做得不好的（Problem）**
  - 哪些环节出了问题？
  - 根因是什么？（5-Why 分析）
- **可以改进的（Try）**
  - 具体的改进措施
  - 如何避免同类问题？

### 3. 关键指标
- 时间预估 vs 实际
- 代码质量指标（Bug 率、返工率）
- 技术债务增减

### 4. 经验沉淀
- **可复用的模式**（设计模式、架构决策、工具链）
- **需警惕的反模式**（踩过的坑、误用）
- **团队成长点**（新掌握的技能、认知升级）

### 5. 行动项（Action Items）
| 编号 | 行动项 | 负责人建议 | 截止时间 | 优先级 |

输出要求：客观、数据驱动、避免归因于个人，聚焦系统和流程改进。`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['retro', 'review', 'management', 'engineering'],
    createdAt: NOW,
    updatedAt: NOW,
  },

  // ---- Office Hours 产品思考 ----
  {
    id: 'builtin-office-hours-product',
    name: 'Office Hours 产品思考',
    description: '模拟产品经理 Office Hours，从用户价值、商业模型、技术可行性三维度深度分析产品方案',
    category: 'product',
    slashCommand: 'office-hours',
    type: 'prompt',
    compatibleProviders: 'all',
    inputVariables: [
      {
        name: 'lens',
        description: '分析视角',
        required: false,
        defaultValue: 'all',
        type: 'select',
        options: ['all', 'user-value', 'business', 'technical', 'competition'],
      },
    ],
    promptTemplate: `请以资深产品经理的视角对以下产品方案/想法进行深度分析（视角：{{lens}}）：

{{user_input}}

## 分析框架

### 1. 用户价值分析
- **目标用户**是谁？画像描述
- **核心痛点**是什么？频率和强度如何？
- **现有替代方案**有哪些？为什么不满意？
- **价值主张**：一句话说清楚用户为什么选择你
- **用户旅程**：从发现到留存的关键触点

### 2. 商业模型分析
- **变现模式**：订阅/交易/广告/增值服务？
- **单位经济**：LTV / CAC 估算
- **增长飞轮**：自增长机制在哪里？
- **市场规模**：TAM → SAM → SOM
- **护城河**：网络效应/切换成本/规模效应/品牌？

### 3. 技术可行性分析
- **技术难度**评估（1-5 分）
- **关键技术风险**及缓解策略
- **MVP 技术方案**建议
- **技术债务容忍度**：哪些可以先简后优？

### 4. 竞争格局
- 直接竞品 vs 间接竞品
- 差异化定位
- 防御策略

### 5. 决策建议
- **做/不做**的判断及理由
- 如果做，**优先级排序**（MoSCoW 法则）
- **3 个最关键的风险**及应对
- **下一步行动建议**

输出要求：诚实直接，不回避问题，用数据和逻辑支撑观点。`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['product', 'strategy', 'analysis', 'office-hours'],
    createdAt: NOW,
    updatedAt: NOW,
  },

  // ---- Benchmark 性能基线 ----
  {
    id: 'builtin-benchmark-performance',
    name: 'Benchmark 性能基线',
    description: '对代码/系统进行性能基线评估，建立 Benchmark 并给出优化路线图',
    category: 'performance',
    slashCommand: 'benchmark',
    type: 'prompt',
    compatibleProviders: 'all',
    inputVariables: [
      {
        name: 'target',
        description: '性能目标',
        required: false,
        defaultValue: 'general',
        type: 'select',
        options: ['general', 'latency', 'throughput', 'memory', 'startup', 'bundle-size'],
      },
    ],
    promptTemplate: `请对以下代码/系统进行性能基线评估（性能目标：{{target}}）：

{{user_input}}

## Benchmark 评估框架

### 1. 性能现状分析
- **时间复杂度**分析（关键路径 Big-O）
- **空间复杂度**分析（内存占用峰值、GC 压力）
- **I/O 瓶颈**识别（网络/磁盘/数据库）
- **并发能力**评估（线程安全、锁竞争、连接池）

### 2. 基线指标建立
| 指标 | 当前值 | 行业基准 | 差距 |
|------|--------|---------|------|
| 响应时间 P50 | - | - | - |
| 响应时间 P99 | - | - | - |
| 吞吐量 QPS | - | - | - |
| 内存占用 | - | - | - |
| CPU 利用率 | - | - | - |
| 冷启动时间 | - | - | - |

### 3. 热点分析
- 识别 **Top 5 性能热点**（耗时最多的代码路径）
- 每个热点的 **优化潜力**（高/中/低）
- 每个热点的 **优化成本**（开发时间估算）

### 4. 优化路线图
- **Quick Wins**（1 天内可完成，收益 > 20%）
- **中期优化**（1 周内，收益 > 50%）
- **架构级优化**（1 月内，收益 > 2x）

### 5. Benchmark 方案
- 推荐 **压测工具**和配置
- **测试场景**设计（正常/峰值/持久）
- **回归检测**方案（CI 集成建议）

输出要求：量化为主，给出具体数值和百分比，避免模糊描述。`,
    isInstalled: true,
    isEnabled: true,
    source: 'builtin',
    version: '1.0.0',
    author: 'PrismOps',
    tags: ['performance', 'benchmark', 'optimization', 'baseline'],
    createdAt: NOW,
    updatedAt: NOW,
  },
]
