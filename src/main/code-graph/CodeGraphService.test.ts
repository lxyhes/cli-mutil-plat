import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseManager } from '../storage/Database'
import { CodeGraphService } from './CodeGraphService'

describe('CodeGraphService', () => {
  let tempDir: string
  let db: DatabaseManager
  let service: CodeGraphService

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrai-code-graph-'))
    db = new DatabaseManager(path.join(tempDir, 'test.db'))
    service = new CodeGraphService(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('indexes JS/TS file imports and computes blast radius', () => {
    const projectDir = path.join(tempDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'util.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(projectDir, 'src', 'feature.ts'), "import { value } from './util'\nexport const feature = value\n")
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), "const mod = require('./feature')\nconsole.log(mod)\n")

    const stats = service.indexProject(projectDir)
    expect(stats.fileCount).toBe(3)
    expect(stats.internalImportCount).toBe(2)

    const dependencies = service.getDependencies(projectDir, 'src/feature.ts')
    expect(dependencies).toHaveLength(1)
    expect(dependencies[0].resolvedFilePath).toBe('src/util.ts')

    const dependents = service.getDependents(projectDir, 'src/feature.ts')
    expect(dependents.map(item => item.filePath)).toEqual(['src/app.ts'])

    const radius = service.getBlastRadius(projectDir, 'src/util.ts', 2)
    expect(radius.affectedFiles).toEqual([
      { filePath: 'src/util.ts', distance: 0, relation: 'root' },
      { filePath: 'src/feature.ts', distance: 1, relation: 'dependent' },
      { filePath: 'src/app.ts', distance: 2, relation: 'dependent' },
    ])
  })

  it('updates a single file incrementally', () => {
    const projectDir = path.join(tempDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'util.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(projectDir, 'src', 'feature.ts'), "export const feature = 1\n")

    service.indexProject(projectDir)
    expect(service.getDependencies(projectDir, 'src/feature.ts')).toHaveLength(0)

    fs.writeFileSync(path.join(projectDir, 'src', 'feature.ts'), "import { value } from './util'\nexport const feature = value\n")
    service.indexFile(projectDir, 'src/feature.ts')
    expect(service.getDependencies(projectDir, 'src/feature.ts')[0].resolvedFilePath).toBe('src/util.ts')

    fs.rmSync(path.join(projectDir, 'src', 'feature.ts'))
    service.removeFile(projectDir, 'src/feature.ts')
    expect(service.getDependents(projectDir, 'src/util.ts')).toHaveLength(0)
  })

  it('computes symbol-level blast radius through named imports', () => {
    const projectDir = path.join(tempDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'util.ts'), [
      'export const value = 1',
      'export const untouched = 2',
      '',
    ].join('\n'))
    fs.writeFileSync(path.join(projectDir, 'src', 'feature.ts'), [
      "import { value, untouched } from './util'",
      'export const feature = value + 1',
      'export const stable = untouched + 1',
      '',
    ].join('\n'))
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), [
      "import { feature, stable } from './feature'",
      'export const app = feature + 1',
      'export const appStable = stable + 1',
      '',
    ].join('\n'))

    service.indexProject(projectDir)

    expect(service.getSymbols(projectDir, 'src/util.ts').filter(symbol => symbol.exported).map(symbol => symbol.name)).toEqual([
      'value',
      'untouched',
    ])

    const radius = service.getSymbolBlastRadius(projectDir, 'src/util.ts', ['value'], 2)
    expect(radius.affectedSymbols).toEqual([
      {
        filePath: 'src/util.ts',
        symbolName: 'value',
        kind: 'const',
        distance: 0,
        relation: 'root',
        rootSymbol: 'value',
      },
      {
        filePath: 'src/feature.ts',
        symbolName: 'feature',
        kind: 'const',
        distance: 1,
        relation: 'dependent',
        rootSymbol: 'value',
        viaFile: 'src/util.ts',
        viaSymbol: 'value',
      },
      {
        filePath: 'src/app.ts',
        symbolName: 'app',
        kind: 'const',
        distance: 2,
        relation: 'dependent',
        rootSymbol: 'value',
        viaFile: 'src/feature.ts',
        viaSymbol: 'feature',
      },
    ])
  })

  it('answers natural-language impact questions with suggested prompts', () => {
    const projectDir = path.join(tempDir, 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'util.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(projectDir, 'src', 'feature.ts'), "import { value } from './util'\nexport const feature = value\n")
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), "import { feature } from './feature'\nexport const app = feature\n")

    service.indexProject(projectDir)

    const answer = service.answerQuestion(projectDir, '改 `src/util.ts` 会影响哪里？')
    expect(answer.intent).toBe('impact')
    expect(answer.targetFile).toBe('src/util.ts')
    expect(answer.sections.some(section => section.items.some(item => item.includes('src/app.ts')))).toBe(true)
    expect(answer.suggestedPrompt).toContain('Code Graph')
    expect(answer.suggestedPrompt).toContain('src/util.ts')
  })
})
