/**
 * ShipCheckService - creates a local QA/ship plan from project scripts and changed files.
 */
import fs from 'fs'
import path from 'path'
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'

export interface ShipCommand {
  id: string
  label: string
  command: string
  reason: string
  required: boolean
  scriptName: string
  args: string[]
  timeoutMs: number
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

export interface ShipRunOptions {
  commandIds?: string[]
  includeOptional?: boolean
  stopOnFailure?: boolean
}

export interface ShipCommandResult {
  id: string
  label: string
  command: string
  status: 'passed' | 'failed' | 'timed-out' | 'skipped'
  required: boolean
  exitCode: number | null
  signal?: string | null
  durationMs: number
  stdout: string
  stderr: string
  outputTail: string
  errorMessage?: string
  skipReason?: string
}

export interface ShipRunResult {
  plan: ShipPlan
  results: ShipCommandResult[]
  passed: boolean
  startedAt: string
  completedAt: string
  durationMs: number
  summary: string
  suggestedPrompt: string
}

export interface ShipChangedFile {
  path: string
  status: string
  stagedStatus: string
  worktreeStatus: string
  previousPath?: string
}

export interface ShipFileStat {
  path: string
  insertions: number | null
  deletions: number | null
  binary: boolean
}

export interface ShipChangeSummary {
  projectPath: string
  generatedAt: string
  branch?: string
  changedFiles: ShipChangedFile[]
  fileStats: ShipFileStat[]
  diffStat: string
  warnings: string[]
  summary: string
  markdown: string
  suggestedPrompt: string
  suggestedCommitMessage: string
  suggestedCommands: string[]
}

const execFileAsync = promisify(execFile)
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])
const TEST_FILE_RE = /(?:^|[\\/])(?:__tests__[\\/].+|.+\.(?:test|spec))\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/
const MAX_OUTPUT_CHARS = 12000
const MAX_TAIL_CHARS = 5000

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

  async runPlan(projectPath: string, options: ShipRunOptions = {}): Promise<ShipRunResult> {
    const startedMs = Date.now()
    const startedAt = new Date(startedMs).toISOString()
    const plan = this.createPlan(projectPath)
    const commandIds = options.commandIds?.length
      ? new Set(options.commandIds)
      : new Set(plan.commands
        .filter(command => options.includeOptional || command.required)
        .map(command => command.id))
    const stopOnFailure = options.stopOnFailure !== false
    const results: ShipCommandResult[] = []
    let halted = false

    for (const command of plan.commands) {
      if (!commandIds.has(command.id)) continue
      if (halted) {
        results.push({
          id: command.id,
          label: command.label,
          command: command.command,
          status: 'skipped',
          required: command.required,
          exitCode: null,
          durationMs: 0,
          stdout: '',
          stderr: '',
          outputTail: '',
          skipReason: '前置检查失败，已按 stopOnFailure 策略停止后续命令。',
        })
        continue
      }

      const result = await this.runCommand(plan.projectPath, plan.packageManager, command)
      results.push(result)
      if (stopOnFailure && result.status !== 'passed') {
        halted = true
      }
    }

    const completedMs = Date.now()
    const passed = results.length > 0 && results.every(result => result.status === 'passed' || result.status === 'skipped')
    const completedAt = new Date(completedMs).toISOString()
    const summary = this.buildRunSummary(results)

    return {
      plan,
      results,
      passed,
      startedAt,
      completedAt,
      durationMs: completedMs - startedMs,
      summary,
      suggestedPrompt: this.buildRunSuggestedPrompt(plan, results, summary),
    }
  }

  generateChangeSummary(projectPath: string): ShipChangeSummary {
    const plan = this.createPlan(projectPath)
    const packageJson = this.readPackageJson(plan.projectPath)
    const changedFiles = this.getChangedFileEntries(plan.projectPath)
    const fileStats = this.getFileStats(plan.projectPath)
    const diffStat = this.getGitOutput(plan.projectPath, ['diff', '--stat', 'HEAD', '--']).trim()
    const branch = this.getGitOutput(plan.projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']).trim() || undefined
    const warnings = [...plan.warnings]

    if (changedFiles.length === 0) {
      warnings.push('No git changes were detected, so the change summary may be incomplete.')
    }
    if (changedFiles.some(file => file.status === 'untracked')) {
      warnings.push('Untracked files are listed, but git diff statistics do not include their content.')
    }

    const suggestedCommitMessage = this.buildSuggestedCommitMessage(changedFiles)
    const suggestedCommands = this.buildSuggestedShipCommands(plan, packageJson, suggestedCommitMessage)
    const summary = this.buildChangeSummaryText(changedFiles, warnings)
    const generatedAt = new Date().toISOString()
    const markdown = this.buildChangeSummaryMarkdown({
      plan,
      generatedAt,
      branch,
      changedFiles,
      fileStats,
      diffStat,
      warnings,
      summary,
      suggestedCommitMessage,
      suggestedCommands,
    })

    return {
      projectPath: plan.projectPath,
      generatedAt,
      branch,
      changedFiles,
      fileStats,
      diffStat,
      warnings,
      summary,
      markdown,
      suggestedPrompt: markdown,
      suggestedCommitMessage,
      suggestedCommands,
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

  private getChangedFileEntries(root: string): ShipChangedFile[] {
    const output = this.getGitOutput(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    if (!output) return []

    const records = output.split('\0').filter(Boolean)
    const files: ShipChangedFile[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      const status = record.slice(0, 2)
      const file = record.slice(3).replace(/\\/g, '/')
      const previousPath = status.includes('R') || status.includes('C') ? file : undefined
      const nextPath = previousPath && records[index + 1]
        ? records[index + 1].replace(/\\/g, '/')
        : undefined

      files.push({
        path: nextPath || file,
        status: this.describeGitStatus(status),
        stagedStatus: status[0] || ' ',
        worktreeStatus: status[1] || ' ',
        previousPath,
      })

      if (nextPath) index += 1
    }

    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  private getFileStats(root: string): ShipFileStat[] {
    const output = this.getGitOutput(root, ['diff', '--numstat', 'HEAD', '--'])
    if (!output) return []

    return output.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [insertions, deletions, ...fileParts] = line.split('\t')
        const file = fileParts.join('\t').replace(/\\/g, '/')
        const binary = insertions === '-' || deletions === '-'
        return {
          path: file,
          insertions: binary ? null : Number(insertions),
          deletions: binary ? null : Number(deletions),
          binary,
        }
      })
  }

  private getGitOutput(root: string, args: string[]): string {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return ''
    }
  }

  private describeGitStatus(status: string): string {
    if (status === '??') return 'untracked'
    if (status.includes('R')) return 'renamed'
    if (status.includes('C')) return 'copied'
    if (status.includes('A')) return 'added'
    if (status.includes('D')) return 'deleted'
    if (status.includes('M')) return 'modified'
    if (status.includes('U')) return 'conflicted'
    return 'changed'
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
    const run = (scriptName: string, args: string[] = []) => this.scriptCommand(packageManager, scriptName, args)

    if (scripts.typecheck) {
      commands.push({
        id: 'typecheck',
        label: '类型检查',
        command: run('typecheck'),
        reason: '先挡住 TypeScript/API 契约问题。',
        required: true,
        scriptName: 'typecheck',
        args: [],
        timeoutMs: 120000,
      })
    }
    if (scripts.lint) {
      commands.push({
        id: 'lint',
        label: 'Lint',
        command: run('lint'),
        reason: '检查格式、未使用代码和常见静态问题。',
        required: false,
        scriptName: 'lint',
        args: [],
        timeoutMs: 120000,
      })
    }
    if (scripts.test) {
      const testArgs = relatedTestFiles.length > 0 ? relatedTestFiles : []
      commands.push({
        id: 'test',
        label: relatedTestFiles.length > 0 ? '相关测试' : '测试套件',
        command: run('test', testArgs),
        reason: relatedTestFiles.length > 0
          ? '优先跑与当前改动直接相关的测试，反馈最快。'
          : '未找到精确测试文件，回退到完整测试命令。',
        required: true,
        scriptName: 'test',
        args: testArgs,
        timeoutMs: 180000,
      })
    }
    if (scripts.build) {
      commands.push({
        id: 'build',
        label: '构建',
        command: run('build'),
        reason: '确认主进程、preload、renderer 打包链路没有断。',
        required: true,
        scriptName: 'build',
        args: [],
        timeoutMs: 240000,
      })
    }

    return commands
  }

  private scriptCommand(packageManager: ShipPlan['packageManager'], scriptName: string, args: string[] = []): string {
    const displayArgs = args.map(arg => this.quoteArg(arg)).join(' ')
    const suffix = displayArgs ? ` ${displayArgs}` : ''
    if (packageManager === 'yarn') return `yarn ${scriptName}${suffix}`
    if (packageManager === 'pnpm') return `pnpm run ${scriptName}${displayArgs ? ` -- ${displayArgs}` : ''}`
    if (packageManager === 'bun') return `bun run ${scriptName}${suffix}`
    return `npm run ${scriptName}${displayArgs ? ` -- ${displayArgs}` : ''}`
  }

  private packageManagerExecutable(packageManager: ShipPlan['packageManager']): string {
    return packageManager === 'bun' ? 'bun' : packageManager
  }

  private packageManagerArgs(packageManager: ShipPlan['packageManager'], scriptName: string, args: string[]): string[] {
    if (packageManager === 'yarn') return [scriptName, ...args]
    if (packageManager === 'bun') return ['run', scriptName, ...args]
    return ['run', scriptName, ...(args.length > 0 ? ['--', ...args] : [])]
  }

  private quoteArg(arg: string): string {
    return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
  }

  private packageManagerProcess(packageManager: ShipPlan['packageManager'], scriptName: string, args: string[]): { executable: string; args: string[] } {
    const executable = this.packageManagerExecutable(packageManager)
    const commandArgs = this.packageManagerArgs(packageManager, scriptName, args)
    if (process.platform !== 'win32') {
      return { executable, args: commandArgs }
    }
    return {
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', [executable, ...commandArgs.map(arg => this.quoteCmdArg(arg))].join(' ')],
    }
  }

  private quoteCmdArg(arg: string): string {
    if (/^[A-Za-z0-9_./:@+-]+$/.test(arg)) return arg
    return `"${arg.replace(/"/g, '""')}"`
  }

  private async runCommand(root: string, packageManager: ShipPlan['packageManager'], command: ShipCommand): Promise<ShipCommandResult> {
    const started = Date.now()
    const processCommand = this.packageManagerProcess(packageManager, command.scriptName, command.args)

    try {
      const { stdout, stderr } = await execFileAsync(processCommand.executable, processCommand.args, {
        cwd: root,
        timeout: command.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
        env: process.env,
      })
      const stdoutText = this.limitOutput(stdout)
      const stderrText = this.limitOutput(stderr)
      return {
        id: command.id,
        label: command.label,
        command: command.command,
        status: 'passed',
        required: command.required,
        exitCode: 0,
        durationMs: Date.now() - started,
        stdout: stdoutText,
        stderr: stderrText,
        outputTail: this.outputTail(stdoutText, stderrText),
      }
    } catch (error: any) {
      const stdoutText = this.limitOutput(error?.stdout)
      const stderrText = this.limitOutput(error?.stderr)
      const timedOut = Boolean(error?.killed && error?.signal === 'SIGTERM')
      return {
        id: command.id,
        label: command.label,
        command: command.command,
        status: timedOut ? 'timed-out' : 'failed',
        required: command.required,
        exitCode: typeof error?.code === 'number' ? error.code : null,
        signal: error?.signal ?? null,
        durationMs: Date.now() - started,
        stdout: stdoutText,
        stderr: stderrText,
        outputTail: this.outputTail(stdoutText, stderrText),
        errorMessage: error?.message || 'Command failed',
      }
    }
  }

  private limitOutput(value: unknown): string {
    const text = String(value || '').replace(/\r\n/g, '\n').trim()
    if (text.length <= MAX_OUTPUT_CHARS) return text
    return `...输出过长，已截取最后 ${MAX_OUTPUT_CHARS} 字符...\n${text.slice(-MAX_OUTPUT_CHARS)}`
  }

  private outputTail(stdout: string, stderr: string): string {
    const combined = [stdout, stderr].filter(Boolean).join('\n\n')
    if (combined.length <= MAX_TAIL_CHARS) return combined
    return combined.slice(-MAX_TAIL_CHARS)
  }

  private buildRunSummary(results: ShipCommandResult[]): string {
    if (results.length === 0) return '没有可执行的交付检查命令'
    const passed = results.filter(result => result.status === 'passed').length
    const failed = results.filter(result => result.status === 'failed' || result.status === 'timed-out').length
    const skipped = results.filter(result => result.status === 'skipped').length
    return `执行 ${results.length} 条交付检查：${passed} 通过，${failed} 失败，${skipped} 跳过`
  }

  private buildRunSuggestedPrompt(plan: ShipPlan, results: ShipCommandResult[], summary: string): string {
    const hasFailure = results.some(result => result.status === 'failed' || result.status === 'timed-out')
    const resultLines = results.length > 0
      ? results.map(result => {
        const status = result.status === 'passed' ? '通过' : result.status === 'skipped' ? '跳过' : '失败'
        const exitCode = result.exitCode === null ? '' : `，退出码 ${result.exitCode}`
        const duration = `，耗时 ${Math.round(result.durationMs / 1000)}s`
        return `- ${result.label}：${status}${exitCode}${duration}\n  命令：${result.command}`
      }).join('\n')
      : '- 没有命令被执行'
    const failureBlocks = results
      .filter(result => result.status === 'failed' || result.status === 'timed-out')
      .map(result => [
        `### ${result.label}`,
        `命令：${result.command}`,
        result.errorMessage ? `错误：${result.errorMessage}` : '',
        result.outputTail ? '输出摘要：' : '',
        result.outputTail ? '```text' : '',
        result.outputTail || '',
        result.outputTail ? '```' : '',
      ].filter(Boolean).join('\n'))
      .join('\n\n')

    return [
      'QA/SHIP 自动检查已完成，请根据结果继续处理。',
      '',
      `项目路径：${plan.projectPath}`,
      `结果摘要：${summary}`,
      '',
      '## 执行结果',
      resultLines,
      '',
      '## 失败详情',
      failureBlocks || '- 暂无失败项',
      '',
      hasFailure ? '如果有失败项，请先定位根因并做最小修复，然后只重跑失败命令；不要跳过失败项。' : '',
    ].filter(line => line !== '').join('\n')
  }

  private buildChangeSummaryText(changedFiles: ShipChangedFile[], warnings: string[]): string {
    const counts = changedFiles.reduce<Record<string, number>>((acc, file) => {
      acc[file.status] = (acc[file.status] || 0) + 1
      return acc
    }, {})
    const countText = Object.entries(counts)
      .map(([status, count]) => `${count} ${status}`)
      .join(', ')
    return `Detected ${changedFiles.length} changed file(s)${countText ? `: ${countText}` : ''}. ${warnings.length} warning(s).`
  }

  private buildSuggestedShipCommands(plan: ShipPlan, packageJson: any | null, suggestedCommitMessage: string): string[] {
    const commands = new Set<string>()
    commands.add('git diff --check')
    for (const command of plan.commands) {
      if (command.required) commands.add(command.command)
    }

    const scripts = packageJson?.scripts || {}
    const packageScript = ['package', 'dist', 'make'].find(script => scripts[script])
    if (packageScript) {
      commands.add(this.scriptCommand(plan.packageManager, packageScript))
    }

    commands.add('git status --short')
    commands.add(`${this.buildGitAddCommand(plan.changedFiles)} && git commit -m ${this.quoteArg(suggestedCommitMessage)}`)
    return Array.from(commands)
  }

  private buildGitAddCommand(changedFiles: string[]): string {
    if (changedFiles.length === 0 || changedFiles.length > 15) return 'git add .'
    return `git add -- ${changedFiles.map(file => this.quoteArg(file)).join(' ')}`
  }

  private buildSuggestedCommitMessage(changedFiles: ShipChangedFile[]): string {
    if (changedFiles.length === 0) return 'chore: update project files'
    const paths = changedFiles.map(file => file.path)
    const onlyDocs = paths.every(file => file.endsWith('.md') || file.startsWith('docs/'))
    const hasTests = paths.some(file => TEST_FILE_RE.test(file))
    const scope = this.detectCommitScope(paths)
    const type = onlyDocs ? 'docs' : hasTests && paths.every(file => TEST_FILE_RE.test(file)) ? 'test' : 'feat'
    const subject = onlyDocs
      ? 'update documentation'
      : scope === 'renderer'
        ? 'update UI workflow'
        : scope === 'main'
          ? 'update main process behavior'
          : scope === 'ship'
            ? 'update delivery workflow'
            : 'update project workflow'

    return `${type}${scope ? `(${scope})` : ''}: ${subject}`
  }

  private detectCommitScope(paths: string[]): string {
    if (paths.some(file => file.includes('/ship/') || file.includes('\\ship\\') || file.includes('shipHandlers'))) return 'ship'
    if (paths.every(file => file.startsWith('src/renderer/'))) return 'renderer'
    if (paths.every(file => file.startsWith('src/main/'))) return 'main'
    if (paths.every(file => file.startsWith('src/preload/'))) return 'preload'
    if (paths.every(file => file.startsWith('src/shared/'))) return 'shared'
    if (paths.every(file => file.startsWith('docs/') || file.endsWith('.md'))) return 'docs'
    return ''
  }

  private buildChangeSummaryMarkdown(input: {
    plan: ShipPlan
    generatedAt: string
    branch?: string
    changedFiles: ShipChangedFile[]
    fileStats: ShipFileStat[]
    diffStat: string
    warnings: string[]
    summary: string
    suggestedCommitMessage: string
    suggestedCommands: string[]
  }): string {
    const statByFile = new Map(input.fileStats.map(stat => [stat.path, stat]))
    const fileRows = input.changedFiles.length > 0
      ? input.changedFiles.map(file => {
        const stat = statByFile.get(file.path)
        const added = stat?.binary ? 'binary' : stat?.insertions ?? '-'
        const deleted = stat?.binary ? 'binary' : stat?.deletions ?? '-'
        const renamed = file.previousPath ? ` (from ${file.previousPath})` : ''
        return `| ${file.status} | \`${file.path}${renamed}\` | ${added} | ${deleted} |`
      }).join('\n')
      : '| none | - | - | - |'
    const validationCommands = input.suggestedCommands.length > 0
      ? input.suggestedCommands.map(command => `- \`${command}\``).join('\n')
      : '- No commands suggested.'
    const warningLines = input.warnings.length > 0
      ? input.warnings.map(warning => `- ${warning}`).join('\n')
      : '- No known warnings.'
    const diffStatBlock = input.diffStat
      ? ['```text', input.diffStat, '```'].join('\n')
      : '_No git diff stat available._'

    return [
      '# Change Summary',
      '',
      `Generated: ${input.generatedAt}`,
      `Project: ${input.plan.projectPath}`,
      input.branch ? `Branch: ${input.branch}` : '',
      '',
      '## Overview',
      `- ${input.summary}`,
      `- Suggested commit: \`${input.suggestedCommitMessage}\``,
      '',
      '## Changed Files',
      '| Status | File | + | - |',
      '| --- | --- | ---: | ---: |',
      fileRows,
      '',
      '## Diff Stat',
      diffStatBlock,
      '',
      '## Validation And Ship Commands',
      validationCommands,
      '',
      '## Release Notes Draft',
      this.buildReleaseNoteBullets(input.changedFiles),
      '',
      '## Risks And Follow-Up',
      warningLines,
      '',
      '## Optional Next Steps',
      '- Run the validation commands above before committing.',
      `- Commit with: \`git commit -m ${this.quoteArg(input.suggestedCommitMessage)}\``,
      '- If this repo has a package/dist/make script, run it only after validation passes.',
    ].filter(line => line !== '').join('\n')
  }

  private buildReleaseNoteBullets(changedFiles: ShipChangedFile[]): string {
    if (changedFiles.length === 0) return '- No visible changes detected yet.'
    const groups = new Map<string, number>()
    for (const file of changedFiles) {
      const area = this.describeChangeArea(file.path)
      groups.set(area, (groups.get(area) || 0) + 1)
    }
    return Array.from(groups.entries())
      .map(([area, count]) => `- ${area}: updated ${count} file(s).`)
      .join('\n')
  }

  private describeChangeArea(filePath: string): string {
    if (filePath.startsWith('src/main/')) return 'Main process'
    if (filePath.startsWith('src/renderer/')) return 'Renderer UI'
    if (filePath.startsWith('src/preload/')) return 'Preload bridge'
    if (filePath.startsWith('src/shared/')) return 'Shared contracts'
    if (filePath.startsWith('docs/') || filePath.endsWith('.md')) return 'Documentation'
    if (TEST_FILE_RE.test(filePath)) return 'Tests'
    if (filePath === 'package.json' || filePath.includes('lock')) return 'Dependencies and scripts'
    return 'Project files'
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
