import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShipCheckService } from './ShipCheckService'

const tempDirs: string[] = []

function createFixture(scripts: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-check-'))
  tempDirs.push(root)
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }, null, 2), 'utf8')
  return root
}

describe('ShipCheckService', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const root = tempDirs.pop()
      if (root) fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('runs selected package scripts and captures output', async () => {
    const root = createFixture({
      test: 'node -e "console.log(\'ship-ok\')"',
    })
    const service = new ShipCheckService()

    const result = await service.runPlan(root, { commandIds: ['test'] })

    expect(result.passed).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].status).toBe('passed')
    expect(result.results[0].outputTail).toContain('ship-ok')
    expect(result.suggestedPrompt).toContain('通过')
  })

  it('captures failures and skips later checks when stopOnFailure is enabled', async () => {
    const root = createFixture({
      test: 'node -e "console.error(\'ship-bad\'); process.exit(2)"',
      build: 'node -e "console.log(\'should-not-run\')"',
    })
    const service = new ShipCheckService()

    const result = await service.runPlan(root, { commandIds: ['test', 'build'] })

    expect(result.passed).toBe(false)
    expect(result.results).toHaveLength(2)
    expect(result.results[0].status).toBe('failed')
    expect(result.results[0].exitCode).toBe(2)
    expect(result.results[0].outputTail).toContain('ship-bad')
    expect(result.results[1].status).toBe('skipped')
    expect(result.suggestedPrompt).toContain('失败详情')
  })

  it('generates a delivery change summary with validation and commit guidance', () => {
    const root = createFixture({
      test: 'node -e "console.log(\'ship-ok\')"',
      build: 'node -e "console.log(\'build-ok\')"',
    })
    const service = new ShipCheckService()

    const result = service.generateChangeSummary(root)

    expect(result.markdown).toContain('# Change Summary')
    expect(result.markdown).toContain('## Validation And Ship Commands')
    expect(result.suggestedCommands).toContain('git diff --check')
    expect(result.suggestedCommands).toContain('npm run test')
    expect(result.suggestedCommands).toContain('npm run build')
    expect(result.suggestedCommitMessage).toContain(':')
  })
})
