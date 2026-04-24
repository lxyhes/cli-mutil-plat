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
})
