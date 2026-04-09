/**
 * 多维度专家分析 - 分析协调器
 * 
 * 负责调度 4 个专家并行分析代码库，汇总结果并生成行动清单
 * 
 * @author weibin
 */

import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import type {
  AnalysisRequestConfig,
  ExpertAnalysisResult,
  MultiDimensionalAnalysisReport,
  AnalysisFinding,
  ActionItem,
  ExpertType,
  SeverityLevel,
} from './types'
import { EXPERT_CONFIGS, getExpertConfig } from './expertConfigs'

/** 分析事件类型 */
export interface AnalyzerEvents {
  /** 分析开始 */
  'analysis:started': [reportId: string]
  /** 单个专家分析开始 */
  'expert:started': [reportId: string, expert: ExpertType]
  /** 单个专家分析完成 */
  'expert:completed': [reportId: string, expert: ExpertType, result: ExpertAnalysisResult]
  /** 单个专家分析失败 */
  'expert:failed': [reportId: string, expert: ExpertType, error: string]
  /** 所有专家分析完成 */
  'analysis:completed': [reportId: string, report: MultiDimensionalAnalysisReport]
  /** 分析失败 */
  'analysis:failed': [reportId: string, error: string]
}

/** 分析协调器 */
export class AnalyzerOrchestrator extends EventEmitter {
  /** 进行中的分析报告 */
  private activeReports: Map<string, MultiDimensionalAnalysisReport> = new Map()

  /** 启动多维度分析 */
  async startAnalysis(config: AnalysisRequestConfig): Promise<string> {
    const reportId = uuidv4()
    const experts = config.experts || EXPERT_CONFIGS.map(e => e.type).filter(t => EXPERT_CONFIGS.find(c => c.type === t)?.enabled)

    // 创建报告骨架
    const report: MultiDimensionalAnalysisReport = {
      id: reportId,
      sessionId: config.sessionId,
      workDir: config.workDir,
      status: 'analyzing',
      expertResults: experts.map(expert => {
        const cfg = getExpertConfig(expert)
        return {
          expert,
          expertName: cfg?.name || expert,
          status: 'pending' as const,
          findings: [],
          stats: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        }
      }),
      actionItems: [],
      createdAt: new Date().toISOString(),
    }

    this.activeReports.set(reportId, report)
    this.emit('analysis:started', reportId)

    // 并行启动各专家分析
    const analysisPromises = experts.map(async (expert) => {
      this.emit('expert:started', reportId, expert)
      const startTime = Date.now()

      try {
        const result = await this.runExpertAnalysis(expert, config)
        result.durationMs = Date.now() - startTime

        // 更新报告中的专家结果
        const reportRef = this.activeReports.get(reportId)
        if (reportRef) {
          const expertIdx = reportRef.expertResults.findIndex(r => r.expert === expert)
          if (expertIdx >= 0) {
            reportRef.expertResults[expertIdx] = result
          }
        }

        this.emit('expert:completed', reportId, expert, result)
        return result
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        this.emit('expert:failed', reportId, expert, errorMsg)

        // 记录失败结果
        const reportRef = this.activeReports.get(reportId)
        if (reportRef) {
          const expertIdx = reportRef.expertResults.findIndex(r => r.expert === expert)
          if (expertIdx >= 0) {
            reportRef.expertResults[expertIdx] = {
              expert,
              expertName: getExpertConfig(expert)?.name || expert,
              status: 'failed',
              findings: [],
              stats: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
              error: errorMsg,
            }
          }
        }

        return null
      }
    })

    // 等待所有专家完成
    try {
      await Promise.all(analysisPromises)

      // 生成行动清单
      const completedReport = this.activeReports.get(reportId)
      if (completedReport) {
        completedReport.actionItems = this.generateActionItems(completedReport.expertResults)
        completedReport.overallScore = this.calculateOverallScore(completedReport.expertResults)
        completedReport.status = 'completed'
        completedReport.completedAt = new Date().toISOString()

        this.emit('analysis:completed', reportId, completedReport)
      }

      return reportId
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const reportRef = this.activeReports.get(reportId)
      if (reportRef) {
        reportRef.status = 'failed'
      }
      this.emit('analysis:failed', reportId, errorMsg)
      throw err
    }
  }

  /**
   * 运行单个专家的分析（核心逻辑）
   * 
   * 这里使用规则引擎进行分析，不依赖 AI（速度快、成本低）
   * 后续可扩展为 AI 辅助分析
   */
  private async runExpertAnalysis(
    expert: ExpertType,
    config: AnalysisRequestConfig
  ): Promise<ExpertAnalysisResult> {
    const cfg = getExpertConfig(expert)
    if (!cfg) {
      throw new Error(`Unknown expert: ${expert}`)
    }

    const findings: AnalysisFinding[] = []

    // 扫描工作目录下的文件
    const files = this.scanFiles(config.workDir, config.maxFiles || 100)

    switch (expert) {
      case 'code_quality':
        findings.push(...this.analyzeCodeQuality(files, config))
        break
      case 'performance':
        findings.push(...this.analyzePerformance(files, config))
        break
      case 'security':
        findings.push(...this.analyzeSecurity(files, config))
        break
      case 'architecture':
        findings.push(...this.analyzeArchitecture(files, config))
        break
    }

    // 计算统计
    const stats = {
      total: findings.length,
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    }

    return {
      expert,
      expertName: cfg.name,
      status: 'completed',
      findings,
      stats,
    }
  }

  /**
   * 代码质量分析
   */
  private analyzeCodeQuality(files: string[], config: AnalysisRequestConfig): AnalysisFinding[] {
    const findings: AnalysisFinding[] = []

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        const ext = path.extname(file)

        // 跳过非代码文件
        if (!this.isCodeFile(ext)) continue

        // 1. 过长文件检测
        if (lines.length > 500) {
          findings.push({
            id: uuidv4(),
            title: `文件过长 (${lines.length} 行)`,
            description: `文件 ${path.relative(config.workDir, file)} 包含 ${lines.length} 行代码，建议拆分为多个模块`,
            severity: lines.length > 1000 ? 'high' : 'medium',
            expert: 'code_quality',
            filePaths: [file],
            recommendation: '将文件按功能拆分为多个小文件，每个文件不超过 500 行',
            referenceUrl: 'https://rules.sonarsource.com/typescript/RSPEC-104',
          })
        }

        // 2. 过长函数检测
        const functionMatches = content.matchAll(/(?:function\s+(\w+)|(\w+)\s*[:=]\s*(?:async\s+)?\([^)]*\)\s*=>?)/g)
        for (const match of functionMatches) {
          const funcName = match[1] || match[2] || 'anonymous'
          const funcStart = lines.indexOf(lines.find(l => l.includes(match[0])) || '')
          if (funcStart >= 0) {
            // 简单估算函数长度（查找下一个函数或文件末尾）
            let funcLength = 0
            let braceCount = 0
            let started = false
            for (let i = funcStart; i < lines.length; i++) {
              braceCount += (lines[i].match(/{/g) || []).length
              braceCount -= (lines[i].match(/}/g) || []).length
              if (braceCount > 0) started = true
              if (started && braceCount === 0) {
                funcLength = i - funcStart + 1
                break
              }
            }

            if (funcLength > 50) {
              findings.push({
                id: uuidv4(),
                title: `函数过长: ${funcName} (${funcLength} 行)`,
                description: `函数 ${funcName} 包含 ${funcLength} 行代码，违反单一职责原则`,
                severity: funcLength > 100 ? 'high' : 'medium',
                expert: 'code_quality',
                filePaths: [file],
                recommendation: '将函数拆分为多个小函数，每个函数不超过 30 行',
                referenceUrl: 'https://rules.sonarsource.com/typescript/RSPEC-138',
              })
            }
          }
        }

        // 3. 过深嵌套检测
        let maxDepth = 0
        let currentDepth = 0
        for (const line of lines) {
          const trimmed = line.trimStart()
          const indent = line.length - trimmed.length
          const depth = Math.floor(indent / 2) // 假设 2 空格缩进
          if (depth > maxDepth) maxDepth = depth
          if (depth > 4) {
            findings.push({
              id: uuidv4(),
              title: `嵌套过深 (${depth} 层)`,
              description: `文件 ${path.relative(config.workDir, file)} 中存在 ${depth} 层嵌套，降低可读性`,
              severity: depth > 6 ? 'high' : 'medium',
              expert: 'code_quality',
              filePaths: [file],
              recommendation: '使用提前返回（guard clause）或提取函数降低嵌套层级',
              referenceUrl: 'https://rules.sonarsource.com/typescript/RSPEC-134',
            })
            break // 只报告一次
          }
        }

        // 4. TODO/FIXME 注释检测
        const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi)
        if (todoMatches && todoMatches.length > 0) {
          findings.push({
            id: uuidv4(),
            title: `存在 ${todoMatches.length} 个待处理注释`,
            description: `文件包含 ${todoMatches.join(', ')} 注释，表明存在未完成的工作`,
            severity: 'low',
            expert: 'code_quality',
            filePaths: [file],
            recommendation: '处理这些待办事项或创建 issue 跟踪',
          })
        }

        // 5. console.log 检测（生产代码）
        const consoleLogs = content.match(/console\.(log|warn|error|debug|info)\(/g)
        if (consoleLogs && consoleLogs.length > 0 && !file.includes('test') && !file.includes('spec')) {
          findings.push({
            id: uuidv4(),
            title: `存在 ${consoleLogs.length} 个 console 调用`,
            description: '生产代码中不应包含 console 输出，应使用日志框架',
            severity: 'low',
            expert: 'code_quality',
            filePaths: [file],
            recommendation: '移除 console 调用或替换为日志框架（如 winston、pino）',
            referenceUrl: 'https://rules.sonarsource.com/typescript/RSPEC-100',
          })
        }

      } catch (err) {
        console.warn(`[Analyzer] Failed to analyze file ${file}:`, err)
      }
    }

    return findings
  }

  /**
   * 性能分析
   */
  private analyzePerformance(files: string[], config: AnalysisRequestConfig): AnalysisFinding[] {
    const findings: AnalysisFinding[] = []

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        const ext = path.extname(file)

        if (!this.isCodeFile(ext)) continue

        // 1. 嵌套循环检测（O(n²) 风险）
        const nestedLoopPattern = /for\s*\([^)]+\)\s*\{[^}]*for\s*\(/s
        if (nestedLoopPattern.test(content)) {
          findings.push({
            id: uuidv4(),
            title: '可能存在 O(n²) 嵌套循环',
            description: '检测到嵌套循环结构，在大数据集上可能导致性能问题',
            severity: 'high',
            expert: 'performance',
            filePaths: [file],
            recommendation: '考虑使用 Map/Set 优化查找操作，或使用更高效的算法',
          })
        }

        // 2. 同步 I/O 检测（Node.js）
        if (ext === '.ts' || ext === '.js') {
          const syncIO = content.match(/fs\.(readFileSync|writeFileSync|appendFileSync|existsSync)\(/g)
          if (syncIO && syncIO.length > 0) {
            findings.push({
              id: uuidv4(),
              title: `存在 ${syncIO.length} 个同步 I/O 调用`,
              description: '同步 I/O 会阻塞事件循环，影响并发性能',
              severity: 'medium',
              expert: 'performance',
              filePaths: [file],
              recommendation: '使用异步 API（如 fs.readFile）替代同步 I/O',
            })
          }
        }

        // 3. 未使用的 import 检测（简单版）
        if (ext === '.ts' || ext === '.tsx') {
          const imports = content.match(/import\s+{([^}]+)}\s+from\s+['"][^'"]+['"]/g)
          if (imports) {
            // 这里只做简单检测，完整检测需要 AST 解析
          }
        }

        // 4. 大数组字面量检测
        const largeArrayPattern = /\[\s*(?:[^,]+,\s*){50,}/s
        if (largeArrayPattern.test(content)) {
          findings.push({
            id: uuidv4(),
            title: '存在大型数组字面量',
            description: '代码中包含大型数组字面量，可能导致初始化性能问题',
            severity: 'medium',
            expert: 'performance',
            filePaths: [file],
            recommendation: '考虑懒加载或从外部数据源加载',
          })
        }

      } catch (err) {
        console.warn(`[Analyzer] Failed to analyze file ${file}:`, err)
      }
    }

    return findings
  }

  /**
   * 安全分析
   */
  private analyzeSecurity(files: string[], config: AnalysisRequestConfig): AnalysisFinding[] {
    const findings: AnalysisFinding[] = []

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        const ext = path.extname(file)

        if (!this.isCodeFile(ext)) continue

        // 1. 硬编码密钥/密码检测
        const secretPatterns = [
          { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi, name: '硬编码密码' },
          { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: '硬编码 API Key' },
          { pattern: /(?:secret|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: '硬编码密钥/Token' },
          { pattern: /(?:aws[_-]?access[_-]?key|aws[_-]?secret)\s*[:=]\s*['"][^'"]+['"]/gi, name: '硬编码 AWS 凭证' },
        ]

        for (const { pattern, name } of secretPatterns) {
          const matches = content.match(pattern)
          if (matches && matches.length > 0) {
            findings.push({
              id: uuidv4(),
              title: name,
              description: `检测到 ${name}，存在信息泄露风险`,
              severity: 'critical',
              expert: 'security',
              filePaths: [file],
              recommendation: '使用环境变量或密钥管理服务（如 AWS Secrets Manager）存储敏感信息',
              referenceUrl: 'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
            })
          }
        }

        // 2. SQL 注入检测
        if (content.match(/(?:query|execute)\s*\(\s*['"`].*\$\{|\+.*(?:select|insert|update|delete)/i)) {
          findings.push({
            id: uuidv4(),
            title: '可能存在 SQL 注入',
            description: '检测到字符串拼接 SQL 查询，存在注入风险',
            severity: 'critical',
            expert: 'security',
            filePaths: [file],
            recommendation: '使用参数化查询或 ORM 框架',
            referenceUrl: 'https://owasp.org/Top10/A03_2021-Injection/',
          })
        }

        // 3. eval() 使用检测
        if (content.match(/\beval\s*\(/)) {
          findings.push({
            id: uuidv4(),
            title: '使用 eval()',
            description: 'eval() 会执行任意代码，存在严重安全风险',
            severity: 'critical',
            expert: 'security',
            filePaths: [file],
            recommendation: '避免使用 eval()，使用 JSON.parse() 或 Function 构造器替代',
            referenceUrl: 'https://owasp.org/Top10/A03_2021-Injection/',
          })
        }

        // 4. 命令注入检测
        if (content.match(/(?:exec|execSync|spawn|spawnSync)\s*\(\s*['"`].*\$\{|\+/)) {
          findings.push({
            id: uuidv4(),
            title: '可能存在命令注入',
            description: '检测到用户输入可能用于构造系统命令',
            severity: 'critical',
            expert: 'security',
            filePaths: [file],
            recommendation: '对用户输入进行严格校验和转义',
            referenceUrl: 'https://owasp.org/Top10/A03_2021-Injection/',
          })
        }

        // 5. XSS 检测（React 中 dangerouslySetInnerHTML）
        if (content.match(/dangerlySetInnerHTML|innerHTML\s*=/)) {
          findings.push({
            id: uuidv4(),
            title: '可能存在 XSS 漏洞',
            description: '检测到直接使用 innerHTML 或 dangerouslySetInnerHTML',
            severity: 'high',
            expert: 'security',
            filePaths: [file],
            recommendation: '对用户输入进行转义，或使用 DOMPurify 等库进行清理',
            referenceUrl: 'https://owasp.org/Top10/A03_2021-Injection/',
          })
        }

        // 6. 弱加密检测
        if (content.match(/(?:md5|sha1|des)\s*\(/i)) {
          findings.push({
            id: uuidv4(),
            title: '使用弱加密算法',
            description: '检测到使用 MD5/SHA1/DES 等弱加密算法',
            severity: 'high',
            expert: 'security',
            filePaths: [file],
            recommendation: '使用 SHA-256 或更强的加密算法',
            referenceUrl: 'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
          })
        }

      } catch (err) {
        console.warn(`[Analyzer] Failed to analyze file ${file}:`, err)
      }
    }

    return findings
  }

  /**
   * 架构分析
   */
  private analyzeArchitecture(files: string[], config: AnalysisRequestConfig): AnalysisFinding[] {
    const findings: AnalysisFinding[] = []

    // 1. 循环依赖检测（简单版）
    const importGraph: Record<string, string[]> = {}
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        const imports = content.match(/from\s+['"]([^'"]+)['"]/g) || []
        importGraph[file] = imports.map(i => i.replace(/from\s+['"]/g, '').replace(/['"]/g, ''))
      } catch {
        // ignore
      }
    }

    // 检测循环依赖（简化版，只检测 A→B→A）
    for (const [file, deps] of Object.entries(importGraph)) {
      for (const dep of deps) {
        const depResolved = Object.keys(importGraph).find(f => f.endsWith(dep) || dep.endsWith(path.basename(f, path.extname(f))))
        if (depResolved && importGraph[depResolved]?.some(d => file.endsWith(d) || d.endsWith(path.basename(file, path.extname(file))))) {
          findings.push({
            id: uuidv4(),
            title: `循环依赖: ${path.basename(file)} ↔ ${path.basename(depResolved)}`,
            description: '检测到循环依赖，增加耦合度，降低可维护性',
            severity: 'high',
            expert: 'architecture',
            filePaths: [file, depResolved],
            recommendation: '引入中间抽象层或重新设计模块依赖关系',
          })
          break
        }
      }
    }

    // 2. 上帝类检测（超大类）
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        const classMatches = content.match(/class\s+(\w+)\s+{/g)
        if (classMatches) {
          for (const match of classMatches) {
            const className = match.replace(/class\s+/, '').replace(/\s+{/, '')
            const classStart = content.indexOf(match)
            const classEnd = content.indexOf('}', classStart + match.length)
            if (classEnd > classStart) {
              const classContent = content.slice(classStart, classEnd)
              const methodCount = (classContent.match(/(?:async\s+)?\w+\s*\([^)]*\)\s*{/g) || []).length
              const lineCount = classContent.split('\n').length

              if (methodCount > 20 || lineCount > 500) {
                findings.push({
                  id: uuidv4(),
                  title: `上帝类: ${className} (${methodCount} 个方法, ${lineCount} 行)`,
                  description: '类承担过多职责，违反单一职责原则',
                  severity: methodCount > 30 ? 'high' : 'medium',
                  expert: 'architecture',
                  filePaths: [file],
                  recommendation: '将类拆分为多个小类，每个类负责单一职责',
                })
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. 缺乏接口/抽象类
    const tsFiles = files.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    const interfaceCount = tsFiles.reduce((count, file) => {
      try {
        const content = fs.readFileSync(file, 'utf-8')
        return count + (content.match(/interface\s+\w+/g) || []).length
      } catch {
        return count
      }
    }, 0)

    if (tsFiles.length > 10 && interfaceCount === 0) {
      findings.push({
        id: uuidv4(),
        title: '缺乏接口定义',
        description: '项目包含多个 TypeScript 文件但未定义任何接口，可能缺乏抽象设计',
        severity: 'medium',
        expert: 'architecture',
        filePaths: tsFiles.slice(0, 5),
        recommendation: '为核心服务定义接口，提高代码可测试性和可扩展性',
      })
    }

    return findings
  }

  /**
   * 生成行动清单（按优先级排序）
   */
  private generateActionItems(results: ExpertAnalysisResult[]): ActionItem[] {
    const actionItems: ActionItem[] = []

    // 按严重程度收集所有发现
    const allFindings = results.flatMap(r => r.findings)

    // 按严重程度分组
    const criticalFindings = allFindings.filter(f => f.severity === 'critical')
    const highFindings = allFindings.filter(f => f.severity === 'high')
    const mediumFindings = allFindings.filter(f => f.severity === 'medium')

    // 生成关键优先级行动项
    for (const finding of criticalFindings.slice(0, 10)) {
      actionItems.push({
        id: uuidv4(),
        title: `[紧急] ${finding.title}`,
        description: finding.description,
        priority: 5,
        findingIds: [finding.id],
        estimatedEffort: 'medium',
        expert: finding.expert,
      })
    }

    // 生成高优先级行动项（合并同类问题）
    const highByExpert = this.groupBy(highFindings, f => f.expert)
    for (const [expert, findings] of Object.entries(highByExpert)) {
      actionItems.push({
        id: uuidv4(),
        title: `[高优先级] 修复 ${expert} 相关问题 (${findings.length} 项)`,
        description: findings.map(f => f.title).join('; '),
        priority: 4,
        findingIds: findings.map(f => f.id),
        estimatedEffort: 'long',
        expert: expert as ExpertType,
      })
    }

    // 生成中优先级行动项
    const mediumByExpert = this.groupBy(mediumFindings, f => f.expert)
    for (const [expert, findings] of Object.entries(mediumByExpert)) {
      actionItems.push({
        id: uuidv4(),
        title: `[建议] 改进 ${expert} (${findings.length} 项)`,
        description: findings.slice(0, 3).map(f => f.title).join('; '),
        priority: 3,
        findingIds: findings.map(f => f.id),
        estimatedEffort: 'medium',
        expert: expert as ExpertType,
      })
    }

    // 按优先级排序
    return actionItems.sort((a, b) => b.priority - a.priority)
  }

  /**
   * 计算总体评分（0-100）
   */
  private calculateOverallScore(results: ExpertAnalysisResult[]): number {
    let score = 100

    for (const result of results) {
      // 根据问题严重程度扣分
      score -= result.stats.critical * 10
      score -= result.stats.high * 5
      score -= result.stats.medium * 2
      score -= result.stats.low * 1
    }

    return Math.max(0, Math.min(100, score))
  }

  /**
   * 扫描工作目录下的文件
   */
  private scanFiles(workDir: string, maxFiles: number): string[] {
    const files: string[] = []
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.java', '.go', '.rs']

    const scan = (dir: string) => {
      if (files.length >= maxFiles) return

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (files.length >= maxFiles) break

          const fullPath = path.join(dir, entry.name)

          // 跳过 node_modules、.git、dist 等目录
          if (entry.isDirectory()) {
            if (['node_modules', '.git', 'dist', 'build', 'out', '.next'].includes(entry.name)) continue
            scan(fullPath)
          } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
            files.push(fullPath)
          }
        }
      } catch {
        // ignore
      }
    }

    scan(workDir)
    return files
  }

  /**
   * 判断是否为代码文件
   */
  private isCodeFile(ext: string): boolean {
    const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.java', '.go', '.rs', '.rb', '.php']
    return codeExts.includes(ext)
  }

  /**
   * 按 key 分组
   */
  private groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
    return items.reduce((acc, item) => {
      const key = keyFn(item)
      if (!acc[key]) acc[key] = []
      acc[key].push(item)
      return acc
    }, {} as Record<string, T[]>)
  }

  /**
   * 获取报告
   */
  getReport(reportId: string): MultiDimensionalAnalysisReport | undefined {
    return this.activeReports.get(reportId)
  }

  /**
   * 获取所有报告
   */
  getAllReports(): MultiDimensionalAnalysisReport[] {
    return Array.from(this.activeReports.values())
  }

  /**
   * 清理旧报告
   */
  cleanup(maxAgeHours: number = 24) {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000
    for (const [id, report] of this.activeReports) {
      if (new Date(report.createdAt).getTime() < cutoff) {
        this.activeReports.delete(id)
      }
    }
  }
}

// 导出单例
export const analyzerOrchestrator = new AnalyzerOrchestrator()
