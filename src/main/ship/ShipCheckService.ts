/**
 * ShipCheckService - creates a local QA/ship plan from project scripts and changed files.
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

export interface ShipCommand {
  id: string
  label: string
  command: string
  reason: string
  required: boolean
}

export interface ShipPlan {
  projectPath: string
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  changedFiles: string[]
  relatedTestFiles: string[]
  commands: ShipCommand[]
  warnings: string[]
  summary: string
  suggestedPrompt: string
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const TEST_FILE_RE = /(?:^|[\\/])(?:__tests__[\\/].+|.+\.(?:test|spec))\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

export class ShipCheckService {
  createPlan(projectPath: string): ShipPlan {
    const root = path.resolve(projectPath)
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Project path is not a directory: ${projectPath}`)
    }

    const packageJson = this.readPackageJson(root)
    const scripts = packageJson?.scripts || {}
    const packageManager = this.detectPackageManager(root)
    const changedFiles = this.getChangedFiles(root)
    const relatedTestFiles = this.findRelatedTests(root, changedFiles)
    const commands = this.buildCommands(packageManager, scripts, relatedTestFiles)
    const warnings = this.buildWarnings(packageJson, changedFiles, relatedTestFiles, commands)
    const summary = this.buildSummary(changedFiles, relatedTestFiles, commands, warnings)

    return {
      projectPath: root,
      packageManager,
      changedFiles,
      relatedTestFiles,
      commands,
      warnings,
      summary,
      suggestedPrompt: this.buildSuggestedPrompt(root, changedFiles, relatedTestFiles, commands, warnings),
    }
  }

  private readPackageJson(root: string): any | null {
    const packageJsonPath = path.join(root, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return null
    try {
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    } catch {
      return null
    }
  }

  private detectPackageManager(root: string): ShipPlan['packageManager'] {
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
    if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn'
    if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun'
    return 'npm'
  }

  private getChangedFiles(root: string): string[] {
    try {
      const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const records = output.split('\0').filter(Boolean)
      const files = new Set<string>()
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index]
        const status = record.slice(0, 2)
        const file = record.slice(3)
        if (file) files.add(file.replace(/\\/g, '/'))
        if (status.includes('R') || status.includes('C')) {
          index += 1
        }
      }
      return Array.from(files).sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }

  private findRelatedTests(root: string, changedFiles: string[]): string[] {
    const tests = new Set<string>()
    for (const relFile of changedFiles) {
      const normalized = relFile.replace(/\\/g, '/')
      if (TEST_FILE_RE.test(normalized)) {
        tests.add(normalized)
        continue
      }
      if (!SOURCE_EXTENSIONS.has(path.extname(normalized))) continue

      const parsed = path.parse(normalized)
      const candidates = [
        path.join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
        path.join(parsed.dir, `${parsed.name}.spec${parsed.ext}`),
        path.join(parsed.dir, '__tests__', `${parsed.name}.test${parsed.ext}`),
        path.join(parsed.dir, '__tests__', `${parsed.name}.spec${parsed.ext}`),
        path.join('tests', parsed.dir.replace(/^src[\\/]/, ''), `${parsed.name}.test${parsed.ext}`),
        path.join('test', parsed.dir.replace(/^src[\\/]/, ''), `${parsed.name}.test${parsed.ext}`),
      ].map(file => file.replace(/\\/g, '/'))

      for (const candidate of candidates) {
        if (fs.existsSync(path.join(root, candidate))) tests.add(candidate)
      }
    }
    return Array.from(tests).sort((a, b) => a.localeCompare(b))
  }

  private buildCommands(packageManager: ShipPlan['packageManager'], scripts: Record<string, string>, relatedTestFiles: string[]): ShipCommand[] {
    const commands: ShipCommand[] = []
    const run = (scriptName: string) => this.scriptCommand(packageManager, scriptName)

    if (scripts.typecheck) {
      commands.push({
        id: 'typecheck',
        label: '类型检查',
        command: run('typecheck'),
        reason: '先挡住 TypeScript/API 契约问题。',
        required: true,
      })
    }
    if (scripts.lint) {
      commands.push({
        id: 'lint',
        label: 'Lint',
        command: run('lint'),
        reason: '检查格式、未使用代码和常见静态问题。',
        required: false,
      })
    }
    if (scripts.test) {
      commands.push({
        id: 'test',
        label: relatedTestFiles.length > 0 ? '相关测试' : '测试套件',
        command: relatedTestFiles.length > 0
          ? `${this.scriptCommand(packageManager, 'test')} -- ${relatedTestFiles.join(' ')}`
          : run('test'),
        reason: relatedTestFiles.length > 0
          ? '优先跑与当前改动直接相关的测试，反馈最快。'
          : '未找到精确测试文件，回退到完整测试命令。',
        required: true,
      })
    }
    if (scripts.build) {
      commands.push({
        id: 'build',
        label: '构建',
        command: run('build'),
        reason: '确认主进程、preload、renderer 打包链路没有断。',
        required: true,
      })
    }

    return commands
  }

  private scriptCommand(packageManager: ShipPlan['packageManager'], scriptName: string): string {
    if (packageManager === 'yarn') return `yarn ${scriptName}`
    if (packageManager === 'pnpm') return `pnpm ${scriptName}`
    if (packageManager === 'bun') return `bun run ${scriptName}`
    return `npm run ${scriptName}`
  }

  private buildWarnings(packageJson: any | null, changedFiles: string[], relatedTestFiles: string[], commands: ShipCommand[]): string[] {
    const warnings: string[] = []
    if (!packageJson) warnings.push('没有找到可解析的 package.json，无法自动识别 npm scripts。')
    if (changedFiles.length === 0) warnings.push('没有从 git status 识别到改动文件，可能当前目录不是 Git 仓库或工作区干净。')
    if (changedFiles.some(file => SOURCE_EXTENSIONS.has(path.extname(file))) && relatedTestFiles.length === 0) {
      warnings.push('有源码改动但未找到同名测试文件，建议补充或运行完整测试套件。')
    }
    if (!commands.some(command => command.id === 'test')) warnings.push('package.json 没有 test script，无法给出标准测试命令。')
    if (!commands.some(command => command.id === 'build')) warnings.push('package.json 没有 build script，交付前需要确认其他构建方式。')
    return warnings
  }

  private buildSummary(changedFiles: string[], relatedTestFiles: string[], commands: ShipCommand[], warnings: string[]): string {
    return [
      `检测到 ${changedFiles.length} 个改动文件`,
      `${relatedTestFiles.length} 个相关测试候选`,
      `${commands.length} 条建议验证命令`,
      warnings.length > 0 ? `${warnings.length} 条注意事项` : '无明显注意事项',
    ].join('，')
  }

  private buildSuggestedPrompt(root: string, changedFiles: string[], relatedTestFiles: string[], commands: ShipCommand[], warnings: string[]): string {
    const commandLines = commands.length > 0
      ? commands.map(command => `- ${command.command}  # ${command.label}：${command.reason}`).join('\n')
      : '- 未识别到可运行的标准验证命令，请先检查 package.json scripts。'
    const changedFileLines = changedFiles.length > 0
      ? changedFiles.map(file => `- ${file}`).join('\n')
      : '- 未识别到 git 改动文件'
    const testLines = relatedTestFiles.length > 0
      ? relatedTestFiles.map(file => `- ${file}`).join('\n')
      : '- 未找到精确相关测试'
    const warningLines = warnings.length > 0
      ? warnings.map(item => `- ${item}`).join('\n')
      : '- 暂无'

    return [
      '请按下面的 QA/SHIP 检查计划完成交付前验证。',
      '',
      `项目路径：${root}`,
      '',
      '## 改动文件',
      changedFileLines,
      '',
      '## 相关测试候选',
      testLines,
      '',
      '## 建议执行命令',
      commandLines,
      '',
      '## 注意事项',
      warningLines,
      '',
      '请依次执行必要命令。若测试或构建失败，先定位根因并做最小修复，再重新运行失败命令。最后输出：验证结果、剩余风险、建议提交说明。不要跳过失败项。',
    ].join('\n')
  }
}
