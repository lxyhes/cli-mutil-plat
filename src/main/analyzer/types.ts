/**
 * 多维度专家分析 - 类型定义
 * 
 * 4 个专家视角：
 * - code_quality: 代码质量（SonarQube 规则）
 * - performance: 性能工程（性能瓶颈检测）
 * - security: 安全审计（OWASP Top 10）
 * - architecture: 架构评估（设计模式识别）
 * 
 * @author weibin
 */

/** 专家类型 */
export type ExpertType = 'code_quality' | 'performance' | 'security' | 'architecture'

/** 问题严重程度 */
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** 专家分析发现的具体问题 */
export interface AnalysisFinding {
  /** 唯一 ID */
  id: string
  /** 问题标题 */
  title: string
  /** 详细描述 */
  description: string
  /** 严重程度 */
  severity: SeverityLevel
  /** 所属专家 */
  expert: ExpertType
  /** 涉及的文件路径 */
  filePaths: string[]
  /** 建议的修复方案 */
  recommendation: string
  /** 相关代码片段（可选） */
  codeSnippet?: string
  /** 参考文档/规则链接 */
  referenceUrl?: string
}

/** 单个专家的分析结果 */
export interface ExpertAnalysisResult {
  /** 专家类型 */
  expert: ExpertType
  /** 专家显示名称 */
  expertName: string
  /** 分析状态 */
  status: 'pending' | 'analyzing' | 'completed' | 'failed'
  /** 发现的问题列表 */
  findings: AnalysisFinding[]
  /** 问题统计 */
  stats: {
    total: number
    critical: number
    high: number
    medium: number
    low: number
    info: number
  }
  /** 分析耗时（毫秒） */
  durationMs?: number
  /** 错误信息（如果失败） */
  error?: string
}

/** 完整的多维度分析报告 */
export interface MultiDimensionalAnalysisReport {
  /** 报告 ID */
  id: string
  /** 关联的会话 ID */
  sessionId: string
  /** 分析的工作目录 */
  workDir: string
  /** 报告状态 */
  status: 'pending' | 'analyzing' | 'completed' | 'failed'
  /** 各专家的分析结果 */
  expertResults: ExpertAnalysisResult[]
  /** 汇总的行动清单（按优先级排序） */
  actionItems: ActionItem[]
  /** 总体评分（0-100） */
  overallScore?: number
  /** 报告生成时间 */
  createdAt: string
  /** 报告完成时间 */
  completedAt?: string
}

/** 行动清单项 */
export interface ActionItem {
  /** 唯一 ID */
  id: string
  /** 行动标题 */
  title: string
  /** 行动描述 */
  description: string
  /** 优先级（1-5，5 最高） */
  priority: number
  /** 关联的发现 ID */
  findingIds: string[]
  /** 预估工作量 */
  estimatedEffort?: 'quick' | 'medium' | 'long'
  /** 负责的专家 */
  expert: ExpertType
}

/** 分析请求配置 */
export interface AnalysisRequestConfig {
  /** 要分析的专家列表（默认全部） */
  experts?: ExpertType[]
  /** 工作目录 */
  workDir: string
  /** 关联的会话 ID */
  sessionId: string
  /** 是否包含代码片段 */
  includeCodeSnippets?: boolean
  /** 最大分析文件数（默认 100） */
  maxFiles?: number
}

/** 专家配置 */
export interface ExpertConfig {
  /** 专家类型 */
  type: ExpertType
  /** 显示名称 */
  name: string
  /** 图标 */
  icon: string
  /** 描述 */
  description: string
  /** 分析 prompt 模板 */
  promptTemplate: string
  /** 默认启用 */
  enabled: boolean
}
