/**
 * CodeContextInjectionService - 代码上下文注入
 *
 * 选中文件/代码块 → 右键"让 AI 审查/优化/解释" → 自动注入到当前会话
 * 支持多种注入模式：审查、优化、解释、重构、添加测试
 *
 * @author weibin
 */

import { EventEmitter } from 'events'
import { sendToRenderer } from '../ipc/shared'
import { IPC } from '../../shared/constants'

// ─── 类型定义 ─────────────────────────────────────────────

export type InjectionMode = 'review' | 'optimize' | 'explain' | 'refactor' | 'test' | 'fix' | 'custom'

export interface CodeContextRequest {
  /** 目标会话 ID */
  sessionId: string
  /** 注入模式 */
  mode: InjectionMode
  /** 文件路径 */
  filePath: string
  /** 选中代码内容 */
  selectedCode: string
  /** 代码行范围 */
  lineRange?: { start: number; end: number }
  /** 周围上下文代码（可选） */
  surroundingContext?: string
  /** 自定义提示词（mode=custom 时） */
  customPrompt?: string
  /** 编程语言（自动检测或手动指定） */
  language?: string
}

export interface CodeContextResponse {
  /** 生成的完整提示词 */
  prompt: string
  /** 请求信息 */
  request: CodeContextRequest
  /** 注入时间 */
  injectedAt: string
}

// ─── 模式 → 提示词模板映射 ────────────────────────────────

const MODE_TEMPLATES: Record<InjectionMode, { name: string; icon: string; template: string }> = {
  review: {
    name: '代码审查',
    icon: '🔍',
    template: `请审查以下{{language}}代码，从以下维度给出评价和改进建议：

1. **代码质量**：可读性、命名规范、代码组织
2. **潜在 Bug**：边界条件、空值处理、类型安全
3. **性能问题**：不必要的计算、内存泄漏风险
4. **安全漏洞**：注入攻击、数据泄露风险
5. **最佳实践**：设计模式、SOLID 原则

{{#surroundingContext}}
### 上下文代码
\`\`\`{{language}}
{{{surroundingContext}}}
\`\`\`
{{/surroundingContext}}

### 待审查代码（{{filePath}}{{#lineRange}}:{{start}}-{{end}}{{/lineRange}}）
\`\`\`{{language}}
{{{selectedCode}}}
\`\`\`

请给出具体改进建议和代码示例。`,
  },
  optimize: {
    name: '优化建议',
    icon: '⚡',
    template: `请优化以下{{language}}代码，提升其性能和可读性：

{{#surroundingContext}}
### 上下文代码
\`\`\`{{language}}
{{{surroundingContext}}}
\`\`\`
{{/surroundingContext}}

### 待优化代码（{{filePath}}{{#lineRange}}:{{start}}-{{end}}{{/lineRange}}）
\`\`\`{{language}}
{{{selectedCode}}}
\`\`\`

请给出：
1. 性能优化建议
2. 优化后的代码
3. 优化前后的对比说明`,
  },
  explain: {
    name: '代码解释',
    icon: '📖',
    template: `请详细解释以下{{language}}代码：

{{#surroundingContext}}
### 上下文代码
\`\`\`{{language}}
{{{surroundingContext}}}
\`\`\`
{{/surroundingContext}}

### 待解释代码（{{filePath}}{{#lineRange}}:{{start}}-{{end}}{{/lineRange}}）
\`\`\`{{language}}
{{{selectedCode}}}
\`\`\`

请说明：
1. 代码的整体目的
2. 关键逻辑和算法
3. 每个重要步骤的作用
4. 可能的边界情况`,
  },
  refactor: {
    name: '重构建议',
    icon: '♻️',
    template: `请重构以下{{language}}代码，提升其可维护性和可扩展性：

{{#surroundingContext}}
### 上下文代码
\`\`\`{{language}}
{{{surroundingContext}}}
\`\`\`
{{/surroundingContext}}

### 待重构代码（{{filePath}}{{#lineRange}}:{{start}}-{{end}}{{/lineRange}}）
\`\`\`{{language}}
{{{selectedCode}}}
\`\`\`

请遵循以下原则：
1. 保持行为不变
2. 消除重复代码
3. 改善命名和结构
4. 应用合适的设计模式

给出重构后的代码和改动说明。`,
  },
  test: {
    name: '生成测试',
    icon: '🧪',
    template: `请为以下{{language}}代码生成全面的测试用例：

{{#surroundingContext}}
### 上下文代码
\`\`\`{{language}}
{{{surroundingContext}}}
\`\`\`
{{/surroundingContext}}

### 待测试代码（{{filePath}}{{#lineRange}}:{{start}}-{{end}}{{/lineRange}}）
\`\`\`{{language}}
{{{selectedCode}}}
\`\`\`

请生成：
1. 单元测试（覆盖正常路径和异常路径）
2. 边界条件测试
3. Mock 外部依赖
4. 使用项目已有的测试框架`,
  },
  fix: {
    name: '修复 Bug',
    icon: '🐛',
    template: `请分析并修复以下{{language}}代码中的问题：

{{#surroundingContext}}
### 上下文代码
\`\`\`{{language}}
{{{surroundingContext}}}
\`\`\`
{{/surroundingContext}}

### 待修复代码（{{filePath}}{{#lineRange}}:{{start}}-{{end}}{{/lineRange}}）
\`\`\`{{language}}
{{{selectedCode}}}
\`\`\`

请：
1. 识别可能的问题和 Bug
2. 分析根因
3. 给出修复方案
4. 提供修复后的代码`,
  },
  custom: {
    name: '自定义',
    icon: '✨',
    template: `{{customPrompt}}

### 代码（{{filePath}}{{#lineRange}}:{{start}}-{{end}}{{/lineRange}}）
\`\`\`{{language}}
{{{selectedCode}}}
\`\`\``,
  },
}

// ─── 服务 ─────────────────────────────────────────────────

export class CodeContextInjectionService extends EventEmitter {
  /** 生成注入提示词 */
  generatePrompt(request: CodeContextRequest): CodeContextResponse {
    const template = MODE_TEMPLATES[request.mode]
    if (!template) throw new Error(`Unknown injection mode: ${request.mode}`)

    const language = request.language || this.detectLanguage(request.filePath)
    const prompt = this.renderTemplate(template.template, {
      ...request,
      language,
    })

    const response: CodeContextResponse = {
      prompt,
      request,
      injectedAt: new Date().toISOString(),
    }

    this.emit('code-context-injected', response)
    return response
  }

  /** 获取所有可用模式 */
  getModes(): Array<{ mode: InjectionMode; name: string; icon: string }> {
    return Object.entries(MODE_TEMPLATES).map(([mode, config]) => ({
      mode: mode as InjectionMode,
      name: config.name,
      icon: config.icon,
    }))
  }

  /** 获取模式信息 */
  getModeInfo(mode: InjectionMode): { name: string; icon: string; template: string } | null {
    return MODE_TEMPLATES[mode] || null
  }

  // ── Private ─────────────────────────────────────────────

  /** 简易模板渲染 */
  private renderTemplate(template: string, data: CodeContextRequest & { language: string }): string {
    let result = template

    // 替换简单变量
    result = result.replace(/\{\{language\}\}/g, data.language)
    result = result.replace(/\{\{filePath\}\}/g, data.filePath)
    result = result.replace(/\{\{selectedCode\}\}/g, data.selectedCode)
    result = result.replace(/\{\{customPrompt\}\}/g, data.customPrompt || '')

    // 替换行范围
    if (data.lineRange) {
      result = result.replace(/\{\{start\}\}/g, String(data.lineRange.start))
      result = result.replace(/\{\{end\}\}/g, String(data.lineRange.end))
    }

    // 条件块：{{#surroundingContext}}...{{/surroundingContext}}
    result = result.replace(
      /\{\{#surroundingContext\}\}([\s\S]*?)\{\{\/surroundingContext\}\}/g,
      (_, content) => data.surroundingContext ? content : ''
    )
    result = result.replace(/\{\{surroundingContext\}\}/g, data.surroundingContext || '')

    // 条件块：{{#lineRange}}...{{/lineRange}}
    result = result.replace(
      /\{\{#lineRange\}\}([\s\S]*?)\{\{\/lineRange\}\}/g,
      (_, content) => data.lineRange ? content : ''
    )

    // 三重花括号（不转义）
    result = result.replace(/\{\{\{surroundingContext\}\}\}/g, data.surroundingContext || '')
    result = result.replace(/\{\{\{selectedCode\}\}\}/g, data.selectedCode)
    result = result.replace(/\{\{\{customPrompt\}\}\}/g, data.customPrompt || '')

    return result.trim()
  }

  /** 根据文件扩展名检测编程语言 */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const langMap: Record<string, string> = {
      ts: 'TypeScript', tsx: 'TypeScript React',
      js: 'JavaScript', jsx: 'JavaScript React',
      py: 'Python', rb: 'Ruby', go: 'Go',
      rs: 'Rust', java: 'Java', kt: 'Kotlin',
      cs: 'C#', cpp: 'C++', c: 'C',
      h: 'C/C++ Header', hpp: 'C++ Header',
      sql: 'SQL', sh: 'Shell', bash: 'Bash',
      yml: 'YAML', yaml: 'YAML', json: 'JSON',
      xml: 'XML', html: 'HTML', css: 'CSS',
      scss: 'SCSS', less: 'Less',
      md: 'Markdown', vue: 'Vue', svelte: 'Svelte',
    }
    return langMap[ext] || ext.toUpperCase() || 'Code'
  }

  cleanup(): void {
    this.removeAllListeners()
  }
}
