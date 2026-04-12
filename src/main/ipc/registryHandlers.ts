/**
 * Registry（在线市场）IPC 处理器
 * 支持在线获取 MCP/Skill 列表、从 URL 导入 Skill
 *
 * 注意：缓存使用 app_settings 表存储，通过 database.getAppSettings() 统一读取（已自动 JSON.parse），
 * 通过 database.updateAppSetting(key, value) 存储（内部自动 JSON.stringify，勿重复序列化）。
 */
import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { IpcDependencies } from './index'
import { createErrorResponse, createSuccessResponse } from '../../shared/errors'

const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/spectrai/registry/main/registry.json'
const MIRROR_REGISTRY_URL = 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/registry.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 小时

// ── 多技能市场数据源 ──
export interface RegistrySource {
  id: string
  name: string
  description: string
  url: string
  icon?: string
  official?: boolean
}

const REGISTRY_SOURCES: RegistrySource[] = [
  {
    id: 'spectrai-official',
    name: 'SpectrAI 官方',
    description: 'SpectrAI 官方维护的技能市场',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/registry.json',
    icon: '⚡',
    official: true,
  },
  {
    id: 'awesome-claude-commands',
    name: 'Awesome Claude Commands',
    description: '社区精选 Claude Code 命令集合',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/awesome-claude.json',
    icon: '🌟',
  },
  {
    id: 'awesome-codex-prompts',
    name: 'Awesome Codex Prompts',
    description: 'Codex CLI 社区精选 Prompt 集合',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/awesome-codex.json',
    icon: '🤖',
  },
  {
    id: 'prompt-engineering',
    name: 'Prompt Engineering Hub',
    description: '高质量 Prompt 工程模板集合',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/prompt-engineering.json',
    icon: '🧠',
  },
  {
    id: 'devops-automation',
    name: 'DevOps 自动化',
    description: 'DevOps / SRE 自动化技能集合',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/devops-automation.json',
    icon: '🔧',
  },
  {
    id: 'data-analysis',
    name: '数据分析助手',
    description: '数据分析、可视化、SQL 技能集合',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/data-analysis.json',
    icon: '📊',
  },
  // ── 国内可访问的社区源 ──
  {
    id: 'awesome-chatgpt-prompts-zh',
    name: '中文 Prompt 精选',
    description: '中文 ChatGPT/Prompt 工程精选合集，覆盖写作、编程、翻译等场景',
    url: 'https://cdn.jsdelivr.net/gh/PlexPt/awesome-chatgpt-prompts-zh@main/prompts.json',
    icon: '🇨🇳',
  },
  {
    id: 'awesome-ai-prompts',
    name: 'AI Prompt 百宝箱',
    description: '多场景 AI Prompt 模板库，含角色扮演、创意写作、技术分析等',
    url: 'https://cdn.jsdelivr.net/gh/f/awesome-chatgpt-prompts@main/prompts.csv',
    icon: '💡',
  },
  {
    id: 'claude-prompt-catalog',
    name: 'Claude Prompt 百科',
    description: 'Claude 专属 Prompt 目录，含代码生成、文本分析、知识问答等',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/claude-prompts.json',
    icon: '🎯',
  },
  {
    id: 'chinese-dev-tools',
    name: '中文开发工具箱',
    description: '面向中文开发者的代码生成、文档注释、API 设计、代码审查技能',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/chinese-dev-tools.json',
    icon: '🛠️',
  },
  {
    id: 'chinese-writing',
    name: '中文写作助手',
    description: '公文写作、文案策划、论文润色、翻译校对等中文写作技能',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/chinese-writing.json',
    icon: '✍️',
  },
  {
    id: 'ai-programming',
    name: 'AI 编程助手',
    description: '代码补全、Bug 修复、重构建议、单元测试生成等编程技能',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/ai-programming.json',
    icon: '💻',
  },
  {
    id: 'business-analysis',
    name: '商业分析',
    description: '竞品分析、市场调研、商业模式画布、SWOT 分析等商业技能',
    url: 'https://cdn.jsdelivr.net/gh/spectrai/registry@main/community/business-analysis.json',
    icon: '📈',
  },
]

/** 将 CSV 格式的 Prompt 列表转换为 MarketSkillItem 格式 */
function parseCsvToSkills(csvText: string, sourceId: string): any[] {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))
  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('title') || h.includes('act'))
  const promptIdx = headers.findIndex(h => h.includes('prompt') || h.includes('content') || h.includes('template'))
  const descIdx = headers.findIndex(h => h.includes('desc'))

  if (nameIdx === -1 && promptIdx === -1) return []

  const skills: any[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of lines[i]) {
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue }
      current += ch
    }
    cols.push(current.trim())

    const name = nameIdx !== -1 ? cols[nameIdx] : ''
    const prompt = promptIdx !== -1 ? cols[promptIdx] : ''
    const desc = descIdx !== -1 ? cols[descIdx] : prompt?.slice(0, 100)

    if (!name && !prompt) continue

    skills.push({
      id: `${sourceId}-${i}`,
      name: name || `Prompt ${i}`,
      description: desc || '',
      category: 'general',
      type: 'prompt',
      slashCommand: (name || `prompt-${i}`).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').slice(0, 30),
      compatibleProviders: 'all',
      author: 'Community',
      version: '1.0.0',
      tags: ['community', 'prompt'],
      promptTemplate: prompt || '',
      sourceId,
    })
  }
  return skills
}

// ── 内置默认技能列表（离线 fallback / 首次使用时展示）──
const BUILTIN_MARKET_SKILLS = [
  // ══════════════ 开发类 ══════════════
  {
    id: 'skill-code-review',
    name: '代码审查',
    description: '对代码进行全面审查，包括逻辑、性能、安全性和可维护性',
    category: 'development',
    slashCommand: 'code-review',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['code', 'review', 'quality'],
    promptTemplate: '请对以下代码进行全面审查：\n\n```\n{{user_input}}\n```\n\n请从以下维度分析：\n1. **逻辑正确性** — 是否有 bug、边界条件处理\n2. **性能** — 时间/空间复杂度，是否有不必要的计算\n3. **安全性** — SQL 注入、XSS、敏感信息泄露等\n4. **可维护性** — 命名、注释、结构清晰度\n5. **最佳实践** — 是否符合语言/框架惯例\n\n对每个问题给出具体的改进建议。',
  },
  {
    id: 'skill-git-commit',
    name: '生成提交信息',
    description: '根据代码变更自动生成规范的 Git commit message',
    category: 'development',
    slashCommand: 'git-commit',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['git', 'commit', 'workflow'],
    promptTemplate: '请根据以下 git diff 生成规范的提交信息：\n\n```diff\n{{user_input}}\n```\n\n要求：\n- 遵循 Conventional Commits 规范（feat/fix/refactor/docs/test/chore）\n- 主题行不超过 72 个字符\n- 如有必要，添加正文说明改动原因\n- 使用中文',
  },
  {
    id: 'skill-explain-code',
    name: '解释代码',
    description: '用通俗易懂的语言解释代码的功能和实现原理',
    category: 'development',
    slashCommand: 'explain',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['code', 'explain', 'learning'],
    promptTemplate: '请解释以下代码：\n\n```\n{{user_input}}\n```\n\n解释要求：\n1. **整体功能** — 这段代码做什么\n2. **逐行/逐块解析** — 关键部分的具体含义\n3. **使用的技术/模式** — 涉及的设计模式、算法或框架特性\n4. **注意事项** — 使用时需要注意什么',
  },
  {
    id: 'skill-write-tests',
    name: '编写测试用例',
    description: '为代码自动生成单元测试和集成测试用例',
    category: 'development',
    slashCommand: 'write-tests',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['test', 'tdd', 'quality'],
    promptTemplate: '请为以下代码编写测试用例：\n\n```\n{{user_input}}\n```\n\n请生成：\n1. **单元测试** — 覆盖核心功能和边界条件\n2. **异常测试** — 错误输入和异常情况处理\n3. **集成测试（如适用）** — 与依赖组件的交互\n\n测试框架：根据代码语言自动选择（Jest/pytest/JUnit 等）\n确保测试覆盖率达到 80% 以上，并包含测试说明注释。',
  },
  {
    id: 'skill-refactor',
    name: '重构建议',
    description: '分析代码并提供具体的重构方案，提升代码质量',
    category: 'development',
    slashCommand: 'refactor',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['refactor', 'code', 'clean'],
    promptTemplate: '请分析以下代码并提供重构建议：\n\n```\n{{user_input}}\n```\n\n重构目标：\n1. **消除重复代码**（DRY 原则）\n2. **简化复杂逻辑**\n3. **改善命名和可读性**\n4. **提取可复用的函数/组件**\n5. **应用合适的设计模式**\n\n请提供重构后的代码示例，并说明每处改动的原因。',
  },
  {
    id: 'skill-api-design',
    name: 'API 设计审查',
    description: '审查 API 设计，检查 RESTful 规范、安全性和易用性',
    category: 'development',
    slashCommand: 'api-review',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['api', 'rest', 'design'],
    promptTemplate: '请审查以下 API 设计：\n\n```\n{{user_input}}\n```\n\n审查维度：\n1. **RESTful 规范** — URL 命名、HTTP 方法使用是否正确\n2. **安全性** — 认证、授权、输入验证\n3. **错误处理** — 错误码是否合理、错误信息是否清晰\n4. **版本控制** — 是否有版本策略\n5. **文档完整性** — 参数、返回值是否清晰\n\n提供具体改进建议。',
  },
  {
    id: 'skill-doc-gen',
    name: '生成文档注释',
    description: '为函数、类或模块自动生成规范的文档注释（JSDoc/docstring）',
    category: 'development',
    slashCommand: 'doc-gen',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['docs', 'comments', 'jsdoc'],
    promptTemplate: '请为以下代码生成完整的文档注释：\n\n```\n{{user_input}}\n```\n\n注释要求：\n- 根据语言自动选择注释格式（JSDoc/TypeDoc/Python docstring/JavaDoc）\n- 描述功能、参数类型和含义、返回值、可能的异常\n- 添加使用示例（如有必要）\n- 保持简洁，避免废话\n\n直接输出带注释的完整代码。',
  },
  // ══════════════ 安全类 ══════════════
  {
    id: 'skill-security-audit',
    name: '安全审计',
    description: '对代码进行安全漏洞扫描，识别 OWASP Top 10 等常见安全问题',
    category: 'security',
    slashCommand: 'security',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['security', 'audit', 'owasp'],
    promptTemplate: '请对以下代码进行安全审计：\n\n```\n{{user_input}}\n```\n\n重点检查 OWASP Top 10：\n1. **注入攻击**（SQL/命令注入、XSS）\n2. **身份验证缺陷**（弱密码、会话管理）\n3. **敏感数据泄露**（硬编码密钥、日志泄露）\n4. **权限控制缺陷**\n5. **不安全的依赖**\n6. **其他安全问题**\n\n对每个发现的问题：标注严重程度（高/中/低）、描述风险、提供修复方案。',
  },
  {
    id: 'skill-dependency-check',
    name: '依赖安全检查',
    description: '检查项目依赖是否存在已知安全漏洞，提供升级建议',
    category: 'security',
    slashCommand: 'dep-check',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['security', 'dependency', 'vulnerability'],
    promptTemplate: '请检查以下项目依赖的安全性：\n\n```\n{{user_input}}\n```\n\n检查要点：\n1. **已知漏洞** — CVE 编号、严重程度\n2. **过期版本** — 是否有更新版本可用\n3. **许可证合规** — 是否有不兼容的开源协议\n4. **依赖树分析** — 间接依赖是否存在风险\n5. **替换建议** — 如有不安全依赖，推荐替代方案\n\n输出格式：按严重程度排序，标注修复优先级。',
  },
  {
    id: 'skill-secrets-scan',
    name: '密钥泄露扫描',
    description: '扫描代码中可能泄露的密钥、Token 和敏感信息',
    category: 'security',
    slashCommand: 'secrets-scan',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['security', 'secrets', 'leak'],
    promptTemplate: '请扫描以下代码中可能泄露的密钥和敏感信息：\n\n```\n{{user_input}}\n```\n\n扫描范围：\n1. **API Key / Token** — 硬编码的 API 密钥、Bearer Token\n2. **数据库连接串** — 包含密码的连接字符串\n3. **私钥/证书** — PEM 格式私钥、SSH Key\n4. **环境变量** — .env 文件中的敏感值\n5. **JWT Secret** — 硬编码的签名密钥\n6. **云服务凭证** — AWS/Azure/GCP Access Key\n\n对每个发现：标注风险等级，提供修复建议（如使用环境变量、密钥管理服务）。',
  },
  // ══════════════ 数据库类 ══════════════
  {
    id: 'skill-sql-optimize',
    name: 'SQL 优化',
    description: '分析 SQL 查询并提供性能优化建议',
    category: 'database',
    slashCommand: 'sql-opt',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['sql', 'database', 'performance'],
    promptTemplate: '请优化以下 SQL 查询：\n\n```sql\n{{user_input}}\n```\n\n请分析：\n1. **执行计划** — 预估的查询复杂度\n2. **索引建议** — 需要创建或修改哪些索引\n3. **查询重写** — 是否有更高效的写法\n4. **潜在问题** — N+1 查询、全表扫描等\n\n提供优化后的 SQL 和预期的性能提升说明。',
  },
  {
    id: 'skill-db-design',
    name: '数据库设计审查',
    description: '审查数据库表结构设计，优化范式/反范式、索引和分区策略',
    category: 'database',
    slashCommand: 'db-design',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['database', 'design', 'schema'],
    promptTemplate: '请审查以下数据库表结构设计：\n\n```\n{{user_input}}\n```\n\n审查维度：\n1. **范式分析** — 是否符合 3NF，有无过度范式化\n2. **索引策略** — 主键、唯一索引、联合索引是否合理\n3. **分区方案** — 大表是否需要分区，分区键选择\n4. **数据类型** — 字段类型是否最优（如 INT vs BIGINT）\n5. **关系设计** — 外键、关联表是否合理\n6. **扩展性** — 未来数据增长的设计考量\n\n给出优化后的 DDL 语句和改进说明。',
  },
  {
    id: 'skill-mongodb-query',
    name: 'MongoDB 查询优化',
    description: '优化 MongoDB 聚合管道和查询语句',
    category: 'database',
    slashCommand: 'mongo-opt',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['mongodb', 'nosql', 'performance'],
    promptTemplate: '请优化以下 MongoDB 查询/聚合管道：\n\n```javascript\n{{user_input}}\n```\n\n分析要点：\n1. **索引覆盖** — 查询是否命中索引\n2. **管道优化** — $match 前置、$project 减少字段\n3. **内存使用** — 是否有大量排序或内存消耗操作\n4. **分片策略** — 如有分片，查询是否高效路由\n5. **写入性能** — 批量写入优化建议\n\n输出优化后的查询语句和性能对比分析。',
  },
  // ══════════════ 语言/翻译类 ══════════════
  {
    id: 'skill-translate-to-en',
    name: '中译英（技术文档）',
    description: '将中文技术文档或代码注释翻译为专业英文',
    category: 'language',
    slashCommand: 'trans-en',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['translation', 'english', 'docs'],
    promptTemplate: '请将以下中文内容翻译为专业英文：\n\n{{user_input}}\n\n翻译要求：\n- 保持技术术语的准确性\n- 语言自然流畅，符合英文技术文档规范\n- 保留原有的代码块、格式标记（Markdown）\n- 如有歧义，在括号内注明原文',
  },
  {
    id: 'skill-translate-to-zh',
    name: '英译中（技术文档）',
    description: '将英文技术文档翻译为通顺的中文',
    category: 'language',
    slashCommand: 'trans-zh',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['translation', 'chinese', 'docs'],
    promptTemplate: '请将以下英文内容翻译为通顺的中文：\n\n{{user_input}}\n\n翻译要求：\n- 技术术语保留英文原文（如 React、WebSocket、Docker）\n- 语言流畅自然，符合中文技术文档习惯\n- 保留原有代码块和格式标记\n- 长句适当拆分，避免翻译腔',
  },
  {
    id: 'skill-i18n-extract',
    name: '国际化提取',
    description: '从代码中提取硬编码字符串，生成 i18n 资源文件',
    category: 'language',
    slashCommand: 'i18n',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['i18n', 'localization', 'internationalization'],
    promptTemplate: '请从以下代码中提取需要国际化的字符串，并生成 i18n 资源文件：\n\n```\n{{user_input}}\n```\n\n要求：\n1. 识别所有面向用户的硬编码字符串\n2. 生成 key-value 格式的资源文件（JSON/YAML）\n3. key 命名遵循嵌套点号规范（如 `common.submit`）\n4. 同时输出中文（zh-CN）和英文（en-US）版本\n5. 展示替换后的代码（使用 t() 函数）',
  },
  // ══════════════ DevOps/运维类 ══════════════
  {
    id: 'skill-dockerfile',
    name: 'Dockerfile 优化',
    description: '优化 Dockerfile，减小镜像体积、提升构建速度和安全性',
    category: 'devops',
    slashCommand: 'docker-opt',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['docker', 'devops', 'optimization'],
    promptTemplate: '请优化以下 Dockerfile：\n\n```dockerfile\n{{user_input}}\n```\n\n优化方向：\n1. **镜像体积** — 多阶段构建、Alpine 基础镜像\n2. **构建缓存** — 合理安排 COPY 指令顺序\n3. **安全性** — 非 root 用户运行、最小权限\n4. **启动速度** — 健康检查、优雅关机\n5. **最佳实践** — .dockerignore、LABEL 标签\n\n输出优化后的 Dockerfile 和体积/性能对比。',
  },
  {
    id: 'skill-ci-pipeline',
    name: 'CI/CD 流水线生成',
    description: '根据项目类型生成 GitHub Actions / GitLab CI 流水线配置',
    category: 'devops',
    slashCommand: 'ci-gen',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['ci', 'cd', 'pipeline', 'github-actions'],
    promptTemplate: '请为以下项目生成 CI/CD 流水线配置：\n\n{{user_input}}\n\n要求：\n1. 识别项目类型（Node.js/Python/Go/Java/Mono-repo 等）\n2. 生成 GitHub Actions YAML 配置\n3. 包含阶段：lint → test → build → deploy\n4. 配置缓存策略（依赖缓存、构建缓存）\n5. 环境变量和密钥管理\n6. 并行执行和条件触发\n\n输出完整的 YAML 配置文件。',
  },
  {
    id: 'skill-k8s-manifest',
    name: 'K8s 清单生成',
    description: '根据应用需求生成 Kubernetes Deployment/Service/Ingress 清单',
    category: 'devops',
    slashCommand: 'k8s-gen',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['kubernetes', 'k8s', 'devops'],
    promptTemplate: '请为以下应用需求生成 Kubernetes 清单：\n\n{{user_input}}\n\n生成内容：\n1. **Deployment** — 副本数、资源限制、健康检查、滚动更新策略\n2. **Service** — ClusterIP / NodePort / LoadBalancer\n3. **Ingress** — 路由规则、TLS 配置\n4. **ConfigMap / Secret** — 配置分离\n5. **HPA** — 自动扩缩容策略\n6. **PDB** — Pod 中断预算\n\n输出完整的 YAML 清单文件，每个资源独立 YAML 文档。',
  },
  {
    id: 'skill-terraform',
    name: 'Terraform 模板生成',
    description: '生成基础设施即代码的 Terraform 配置',
    category: 'devops',
    slashCommand: 'tf-gen',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['terraform', 'iac', 'infrastructure'],
    promptTemplate: '请根据以下需求生成 Terraform 配置：\n\n{{user_input}}\n\n要求：\n1. 模块化组织（network / compute / database / security）\n2. 变量定义（variables.tf）使用描述和类型约束\n3. 输出定义（outputs.tf）暴露关键信息\n4. 远程状态管理（S3/GCS backend）\n5. 最小权限 IAM 策略\n6. 标签/标记策略\n\n输出完整 Terraform 项目结构和文件。',
  },
  {
    id: 'skill-log-analyze',
    name: '日志分析',
    description: '分析应用日志，识别异常模式、错误根因和性能瓶颈',
    category: 'devops',
    slashCommand: 'log-analyze',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['logs', 'monitoring', 'troubleshooting'],
    promptTemplate: '请分析以下应用日志，识别异常和问题根因：\n\n```\n{{user_input}}\n```\n\n分析内容：\n1. **错误分类** — 按严重程度和类型归类\n2. **时间模式** — 错误发生的时间规律\n3. **根因分析** — 追踪错误链，找到根本原因\n4. **性能瓶颈** — 慢查询、超时、资源争用\n5. **关联分析** — 不同服务间错误的相关性\n6. **修复建议** — 针对每个问题的具体修复方案',
  },
  // ══════════════ 数据分析类 ══════════════
  {
    id: 'skill-data-clean',
    name: '数据清洗',
    description: '分析和清洗脏数据，处理缺失值、异常值和格式问题',
    category: 'data',
    slashCommand: 'data-clean',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['data', 'cleaning', 'pandas'],
    promptTemplate: '请为以下数据集编写数据清洗脚本：\n\n{{user_input}}\n\n清洗步骤：\n1. **缺失值处理** — 删除/填充/插值策略\n2. **异常值检测** — IQR / Z-Score / 业务规则\n3. **格式统一** — 日期、电话、地址等标准化\n4. **重复数据处理** — 去重策略\n5. **数据类型转换** — 数值/分类/时间类型\n6. **特征工程** — 衍生有用特征\n\n输出 Python/Pandas 清洗脚本和清洗报告。',
  },
  {
    id: 'skill-data-viz',
    name: '数据可视化',
    description: '根据数据特征推荐合适的图表类型并生成可视化代码',
    category: 'data',
    slashCommand: 'data-viz',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['data', 'visualization', 'chart'],
    promptTemplate: '请为以下数据推荐可视化方案并生成代码：\n\n{{user_input}}\n\n输出内容：\n1. **图表推荐** — 根据数据特征选择最合适的图表类型\n2. **设计建议** — 配色、标注、交互\n3. **代码实现** — 使用 matplotlib / plotly / echarts\n4. **多维度分析** — 至少 3 种不同视角的图表\n5. **趋势洞察** — 数据中的关键趋势和异常\n\n输出可直接运行的可视化代码。',
  },
  // ══════════════ 架构设计类 ══════════════
  {
    id: 'skill-system-design',
    name: '系统设计',
    description: '根据需求进行系统架构设计，输出架构图描述和关键决策',
    category: 'architecture',
    slashCommand: 'sys-design',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['architecture', 'system-design', 'scalability'],
    promptTemplate: '请为以下需求进行系统架构设计：\n\n{{user_input}}\n\n设计内容：\n1. **需求分析** — 功能需求和非功能需求（QPS、延迟、可用性）\n2. **高层架构** — 组件划分和交互方式\n3. **数据流** — 请求的完整生命周期\n4. **存储方案** — 数据库选型、缓存策略\n5. **扩展性** — 水平/垂直扩展方案\n6. **可靠性** — 容错、降级、灾备\n7. **安全设计** — 认证授权、数据加密\n8. **技术选型** — 关键技术栈和选择理由\n\n输出 Mermaid 架构图描述和详细设计文档。',
  },
  {
    id: 'skill-microservice',
    name: '微服务拆分',
    description: '分析单体应用并提供微服务拆分方案',
    category: 'architecture',
    slashCommand: 'micro-split',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['microservice', 'architecture', 'ddd'],
    promptTemplate: '请分析以下单体应用并提供微服务拆分方案：\n\n{{user_input}}\n\n拆分策略：\n1. **领域识别** — 使用 DDD 识别限界上下文\n2. **服务划分** — 每个服务的职责和数据边界\n3. **通信方式** — 同步（gRPC/REST）vs 异步（消息队列）\n4. **数据拆分** — 数据库拆分策略和一致性方案\n5. **迁移路径** — 从单体到微服务的渐进式迁移步骤\n6. **基础设施** — 服务发现、配置中心、链路追踪\n\n输出服务拆分图和迁移计划。',
  },
  // ══════════════ Prompt 工程类 ══════════════
  {
    id: 'skill-prompt-engineer',
    name: 'Prompt 优化器',
    description: '分析和优化 Prompt，提升 AI 输出质量',
    category: 'prompt',
    slashCommand: 'prompt-opt',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['prompt', 'engineering', 'optimization'],
    promptTemplate: '请分析并优化以下 Prompt：\n\n{{user_input}}\n\n优化方向：\n1. **角色设定** — 是否需要指定专家角色\n2. **任务明确性** — 目标是否清晰无歧义\n3. **约束条件** — 格式、长度、语言等约束\n4. **示例引导** — 添加 Few-shot 示例\n5. **思维链** — 是否需要 Chain-of-Thought 推理\n6. **输出格式** — 指定结构化输出格式\n\n输出优化前后的对比和优化理由。',
  },
  {
    id: 'skill-prompt-template',
    name: 'Prompt 模板生成',
    description: '根据任务描述生成可复用的 Prompt 模板',
    category: 'prompt',
    slashCommand: 'prompt-tpl',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['prompt', 'template', 'reusable'],
    promptTemplate: '请根据以下任务描述生成可复用的 Prompt 模板：\n\n{{user_input}}\n\n模板要求：\n1. 使用 `{{变量名}}` 标记可变部分\n2. 包含角色设定和上下文说明\n3. 定义输出格式和约束\n4. 提供变量说明和使用示例\n5. 支持多语言输出\n\n输出格式：\n- 模板名称\n- 适用场景\n- 变量列表及说明\n- 完整模板内容\n- 使用示例',
  },
  // ══════════════ 性能优化类 ══════════════
  {
    id: 'skill-perf-analyze',
    name: '性能分析',
    description: '分析代码/系统的性能瓶颈，提供优化方案',
    category: 'performance',
    slashCommand: 'perf',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['performance', 'optimization', 'profiling'],
    promptTemplate: '请分析以下代码/系统的性能问题并提供优化方案：\n\n```\n{{user_input}}\n```\n\n分析维度：\n1. **CPU 瓶颈** — 热点函数、算法复杂度\n2. **内存问题** — 内存泄漏、大对象分配\n3. **I/O 瓶颈** — 磁盘/网络 I/O、同步阻塞\n4. **并发问题** — 锁竞争、线程安全\n5. **缓存策略** — 缓存命中率和淘汰策略\n\n给出：\n- 问题定位（根因）\n- 优化方案（短期 vs 长期）\n- 预期效果（量化估算）\n- 实施步骤',
  },
  {
    id: 'skill-frontend-perf',
    name: '前端性能优化',
    description: '分析 Web 前端性能问题，提供加载和渲染优化方案',
    category: 'performance',
    slashCommand: 'fe-perf',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['frontend', 'performance', 'web'],
    promptTemplate: '请分析以下前端项目的性能问题：\n\n{{user_input}}\n\n优化方向：\n1. **首屏加载** — 代码分割、懒加载、预加载\n2. **渲染性能** — 虚拟列表、减少重排重绘\n3. **资源优化** — 图片压缩、字体加载、Tree Shaking\n4. **网络优化** — CDN、HTTP/2、缓存策略\n5. **运行时性能** — Web Worker、防抖节流\n6. **Core Web Vitals** — LCP / FID / CLS 优化\n\n输出优化方案清单，按投入产出比排序。',
  },
  // ══════════════ 写作/文档类 ══════════════
  {
    id: 'skill-readme-gen',
    name: 'README 生成',
    description: '为项目自动生成专业规范的 README 文档',
    category: 'documentation',
    slashCommand: 'readme',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['readme', 'documentation', 'project'],
    promptTemplate: '请为以下项目生成专业的 README 文档：\n\n{{user_input}}\n\nREADME 结构：\n1. **项目名称和简介** — 一句话描述\n2. **功能特性** — 核心功能列表\n3. **快速开始** — 安装和运行步骤\n4. **使用示例** — 基本用法和进阶用法\n5. **配置说明** — 关键配置项\n6. **API 文档** — 核心接口\n7. **贡献指南** — 开发环境搭建、PR 流程\n8. **许可证** — 开源协议\n\n输出完整 Markdown 格式的 README。',
  },
  {
    id: 'skill-changelog',
    name: '更新日志生成',
    description: '根据 Git 提交记录生成规范的 CHANGELOG',
    category: 'documentation',
    slashCommand: 'changelog',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['changelog', 'documentation', 'release'],
    promptTemplate: '请根据以下 Git 提交记录生成 CHANGELOG：\n\n```\n{{user_input}}\n```\n\n格式要求：\n- 遵循 Keep a Changelog 规范\n- 按版本号分组\n- 每个版本分为：Added / Changed / Fixed / Removed / Deprecated / Security\n- 简洁明了，避免冗余描述\n- 标注破坏性变更（BREAKING CHANGE）\n\n输出标准 Markdown 格式的 CHANGELOG。',
  },
  {
    id: 'skill-architecture-doc',
    name: '架构文档生成',
    description: '根据代码结构自动生成架构设计文档',
    category: 'documentation',
    slashCommand: 'arch-doc',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['architecture', 'documentation', 'adr'],
    promptTemplate: '请根据以下项目代码结构生成架构文档：\n\n{{user_input}}\n\n文档内容：\n1. **架构概述** — 整体架构风格和设计理念\n2. **模块划分** — 各模块的职责和边界\n3. **依赖关系** — 模块间的依赖和交互\n4. **数据流** — 核心数据流转路径\n5. **关键决策** — ADR（Architecture Decision Records）\n6. **技术债务** — 当前已知问题和改进计划\n\n输出 Markdown 格式的架构文档。',
  },
  // ══════════════ 学习/面试类 ══════════════
  {
    id: 'skill-interview-prep',
    name: '面试题生成',
    description: '根据职位和技术栈生成面试题及参考答案',
    category: 'learning',
    slashCommand: 'interview',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['interview', 'learning', 'career'],
    promptTemplate: '请根据以下职位/技术栈生成面试题：\n\n{{user_input}}\n\n题目类型：\n1. **基础知识**（30%）— 核心概念和原理\n2. **场景设计**（30%）— 实际问题解决方案\n3. **代码实现**（20%）— 手写代码题\n4. **系统设计**（20%）— 高层架构设计\n\n每道题包含：\n- 题目描述\n- 考察点\n- 参考答案\n- 评分标准\n\n难度分布：初级 30% / 中级 40% / 高级 30%',
  },
  {
    id: 'skill-leetcode',
    name: '算法题解析',
    description: '分析算法题，提供多种解法和复杂度分析',
    category: 'learning',
    slashCommand: 'algo',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['algorithm', 'leetcode', 'coding'],
    promptTemplate: '请解析以下算法题：\n\n{{user_input}}\n\n输出内容：\n1. **题目理解** — 关键条件和约束\n2. **暴力解法** — 最直观的思路和代码\n3. **优化解法** — 时间/空间优化思路\n4. **最优解法** — 最优复杂度和代码实现\n5. **复杂度分析** — 每种解法的 Big-O 分析\n6. **扩展思考** — 变形题、相关题目\n\n使用 Python / TypeScript 实现代码。',
  },
  // ══════════════ 通用工具类 ══════════════
  {
    id: 'skill-regex-gen',
    name: '正则表达式生成',
    description: '根据自然语言描述生成正则表达式',
    category: 'general',
    slashCommand: 'regex',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['regex', 'pattern', 'tool'],
    promptTemplate: '请根据以下描述生成正则表达式：\n\n{{user_input}}\n\n输出内容：\n1. **正则表达式** — 完整的 regex\n2. **逐段解释** — 每个部分的含义\n3. **测试用例** — 匹配和不匹配的示例\n4. **常见变体** — 不同语言/引擎的兼容版本\n5. **性能提示** — 是否有回溯风险，优化建议',
  },
  {
    id: 'skill-cron-gen',
    name: 'Cron 表达式生成',
    description: '根据自然语言描述生成 Cron 表达式',
    category: 'general',
    slashCommand: 'cron',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['cron', 'schedule', 'tool'],
    promptTemplate: '请根据以下描述生成 Cron 表达式：\n\n{{user_input}}\n\n输出内容：\n1. **Cron 表达式** — 标准 5/6/7 位格式\n2. **字段解释** — 每个字段的含义\n3. **执行时间预览** — 接下来 5 次执行时间\n4. **时区说明** — 如有夏令时等注意事项\n5. **等价写法** — 其他常见写法',
  },
  {
    id: 'skill-json-transform',
    name: 'JSON 转换',
    description: 'JSON 数据格式转换、提取、合并和重构',
    category: 'general',
    slashCommand: 'json-transform',
    type: 'prompt',
    compatibleProviders: 'all',
    author: 'SpectrAI',
    version: '1.0.0',
    tags: ['json', 'transform', 'tool'],
    promptTemplate: '请对以下 JSON 数据进行转换：\n\n{{user_input}}\n\n请描述你想要的转换目标（如：扁平化、提取字段、格式转换等），我会：\n1. 分析源 JSON 结构\n2. 生成转换代码（Python/JavaScript）\n3. 输出转换后的 JSON 结果\n4. 提供可复用的转换函数',
  },
]

export function registerRegistryHandlers(deps: IpcDependencies): void {
  const { database } = deps

  // ── 获取 Registry 数据源列表 ──
  ipcMain.handle(IPC.REGISTRY_GET_SOURCES, () => {
    return REGISTRY_SOURCES
  })

  // ── 从指定数据源获取 Skill 列表 ──
  ipcMain.handle(IPC.REGISTRY_FETCH_SKILLS_FROM_SOURCE, async (_event, sourceId: string, forceRefresh = false) => {
    try {
      const source = REGISTRY_SOURCES.find(s => s.id === sourceId)
      if (!source) throw new Error(`未找到数据源: ${sourceId}`)

      const cacheKey = `registry_cache_skills_${sourceId}`
      const settings = database.getAppSettings()

      // 非强制刷新时检查缓存
      if (!forceRefresh) {
        const cacheTime = Number(settings['registry_cache_time'] || 0)
        if (Date.now() - cacheTime < CACHE_TTL_MS) {
          const cached = settings[cacheKey]
          if (cached && Array.isArray(cached) && cached.length > 0) return cached
        }
      }

      // CDN 源失败时回退到 GitHub 原始地址
      const githubUrl = source.url.replace('cdn.jsdelivr.net/gh/', 'raw.githubusercontent.com/').replace('@main', '/main')
      let res: Response
      try {
        res = await fetch(source.url, { signal: AbortSignal.timeout(10000) })
      } catch (fetchErr: any) {
        console.log(`[Registry] source ${sourceId} CDN failed, trying GitHub:`, fetchErr.message)
        try {
          res = await fetch(githubUrl, { signal: AbortSignal.timeout(10000) })
        } catch (fallbackErr: any) {
          throw new Error(`CDN and GitHub both failed: ${fetchErr.message}`)
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // 兼容多种数据格式
      let skills: any[] = []
      const contentType = res.headers.get('content-type') || ''
      const text = await res.text()

      if (contentType.includes('csv') || source.url.endsWith('.csv')) {
        // CSV 格式解析（awesome-chatgpt-prompts 格式）
        skills = parseCsvToSkills(text, sourceId)
      } else {
        // JSON 格式解析
        try {
          const data = JSON.parse(text) as { mcps?: any[]; skills?: any[] }
          skills = data.skills || (Array.isArray(data) ? data : [])
        } catch {
          // 非 JSON 非 CSV，跳过
          skills = []
        }
      }

      if (skills.length === 0) {
        // 如果是官方源，fallback 到内置列表
        if (source.official) {
          console.log(`[Registry] source ${sourceId} online skills empty, using builtin defaults`)
          return BUILTIN_MARKET_SKILLS
        }
        return []
      }

      database.updateAppSetting(cacheKey, skills)
      database.updateAppSetting('registry_cache_time', Date.now())
      return skills
    } catch (err: any) {
      console.error(`[Registry] fetch skills from source ${sourceId} failed:`, err.message)
      // 降级：缓存 → 内置列表（仅官方源）
      const cacheKey = `registry_cache_skills_${sourceId}`
      const stale = database.getAppSettings()[cacheKey]
      if (stale && Array.isArray(stale) && stale.length > 0) return stale
      const source = REGISTRY_SOURCES.find(s => s.id === sourceId)
      if (source?.official) return BUILTIN_MARKET_SKILLS
      return []
    }
  })

  // ── 获取在线 MCP 列表（带 24h 缓存）──
  ipcMain.handle(IPC.REGISTRY_FETCH_MCPS, async () => {
    try {
      const settings = database.getAppSettings()
      const cacheTime = Number(settings['registry_cache_time'] || 0)
      if (Date.now() - cacheTime < CACHE_TTL_MS) {
        const cached = settings['registry_cache_mcps']
        if (cached) return cached
      }
      const registryUrl = String(settings['registry_url'] || DEFAULT_REGISTRY_URL)
      const res = await fetch(registryUrl, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { mcps?: any[]; skills?: any[] }
      const mcps = data.mcps || []
      // updateAppSetting 内部会 JSON.stringify，直接传原始值
      database.updateAppSetting('registry_cache_mcps', mcps)
      database.updateAppSetting('registry_cache_time', Date.now())
      return mcps
    } catch (err: any) {
      console.error('[Registry] fetch MCPs failed:', err.message)
      // 降级返回缓存（即使过期也比报错好）
      const stale = database.getAppSettings()['registry_cache_mcps']
      return stale || []
    }
  })

  // ── 获取在线 Skill 列表（带 24h 缓存，在线为空时 fallback 到内置列表）──
  ipcMain.handle(IPC.REGISTRY_FETCH_SKILLS, async (_event, forceRefresh = false) => {
    try {
      const settings = database.getAppSettings()
      // 非强制刷新时检查缓存
      if (!forceRefresh) {
        const cacheTime = Number(settings['registry_cache_time'] || 0)
        if (Date.now() - cacheTime < CACHE_TTL_MS) {
          const cached = settings['registry_cache_skills']
          if (cached && Array.isArray(cached) && cached.length > 0) return cached
        }
      }
      // 优先用 CDN 镜像（国内可访问），失败回退 GitHub
      const registryUrl = String(settings['registry_url'] || MIRROR_REGISTRY_URL)
      const fallbackUrl = registryUrl.includes('jsdelivr.net') ? DEFAULT_REGISTRY_URL : undefined
      let res: Response
      try {
        res = await fetch(registryUrl, { signal: AbortSignal.timeout(10000) })
      } catch (fetchErr: any) {
        if (fallbackUrl) {
          console.log('[Registry] mirror failed, trying GitHub:', fetchErr.message)
          res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(10000) })
        } else {
          throw fetchErr
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { mcps?: any[]; skills?: any[] }
      const skills = data.skills || []
      // 在线 registry 为空时，使用内置默认列表（但不缓存，下次仍会尝试在线）
      if (skills.length === 0) {
        console.log('[Registry] online skills empty, using builtin defaults')
        return BUILTIN_MARKET_SKILLS
      }
      database.updateAppSetting('registry_cache_skills', skills)
      database.updateAppSetting('registry_cache_time', Date.now())
      return skills
    } catch (err: any) {
      console.error('[Registry] fetch Skills failed:', err.message)
      // 降级：先尝试缓存，再用内置列表
      const stale = database.getAppSettings()['registry_cache_skills']
      if (stale && Array.isArray(stale) && stale.length > 0) return stale
      console.log('[Registry] using builtin skill list as fallback')
      return BUILTIN_MARKET_SKILLS
    }
  })

  // ── 强制刷新 Registry 缓存 ──
  ipcMain.handle(IPC.REGISTRY_FORCE_REFRESH, async () => {
    try {
      const settings = database.getAppSettings()
      const registryUrl = String(settings['registry_url'] || DEFAULT_REGISTRY_URL)
      const res = await fetch(registryUrl, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { mcps?: any[]; skills?: any[] }
      const mcps = data.mcps || []
      const skills = data.skills || []
      database.updateAppSetting('registry_cache_mcps', mcps)
      database.updateAppSetting('registry_cache_skills', skills.length > 0 ? skills : BUILTIN_MARKET_SKILLS)
      database.updateAppSetting('registry_cache_time', Date.now())
      return createSuccessResponse({ mcpsCount: mcps.length, skillsCount: skills.length })
    } catch (err: any) {
      console.error('[Registry] force refresh failed:', err.message)
      return createErrorResponse(err, { operation: 'registry' })
    }
  })

  // ── 从 URL 导入 Skill ──
  ipcMain.handle(IPC.SKILL_IMPORT_URL, async (_event, url: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as any
      if (!data.name || !data.type) {
        throw new Error('无效的 Skill 格式：缺少 name 或 type 字段')
      }
      const now = new Date().toISOString()
      const skill = {
        ...data,
        id: data.id || `imported-${Date.now()}`,
        source: 'marketplace',
        isEnabled: true,
        isInstalled: true,
        createdAt: data.createdAt || now,
        updatedAt: now,
      }
      database.createSkill(skill)
      return createSuccessResponse({ skill })
    } catch (err: any) {
      console.error('[Registry] import skill from URL failed:', err.message)
      return createErrorResponse(err, { operation: 'registry' })
    }
  })
}
