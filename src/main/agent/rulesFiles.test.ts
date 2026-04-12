/**
 * rulesFiles 通用工具单元测试
 * 验证 Managed Block 的增删查逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  ensureRulesDir,
  getRulesFilePath,
  blockMarkers,
  escapeRegex,
  upsertManagedBlock,
  removeManagedBlock,
} from './rulesFiles'

describe('rulesFiles', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrai-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('ensureRulesDir', () => {
    it('应创建 .claude/rules/ 目录', () => {
      ensureRulesDir(tmpDir)
      const rulesDir = path.join(tmpDir, '.claude', 'rules')
      expect(fs.existsSync(rulesDir)).toBe(true)
    })

    it('目录已存在时不报错', () => {
      ensureRulesDir(tmpDir)
      expect(() => ensureRulesDir(tmpDir)).not.toThrow()
    })
  })

  describe('getRulesFilePath', () => {
    it('返回正确的规则文件路径', () => {
      expect(getRulesFilePath(tmpDir)).toBe(
        path.join(tmpDir, '.claude', 'rules', 'spectrai-session.md')
      )
    })
  })

  describe('blockMarkers', () => {
    it('默认生成 WORKTREE 标记', () => {
      const markers = blockMarkers()
      expect(markers.start).toBe('<!-- CLAUDEOPS:WORKTREE:START -->')
      expect(markers.end).toBe('<!-- CLAUDEOPS:WORKTREE:END -->')
    })

    it('自定义 blockId 生成对应标记', () => {
      const markers = blockMarkers('FILEOPS')
      expect(markers.start).toBe('<!-- CLAUDEOPS:FILEOPS:START -->')
      expect(markers.end).toBe('<!-- CLAUDEOPS:FILEOPS:END -->')
    })
  })

  describe('escapeRegex', () => {
    it('转义正则特殊字符', () => {
      expect(escapeRegex('hello.world')).toBe('hello\\.world')
      expect(escapeRegex('[test]')).toBe('\\[test\\]')
      expect(escapeRegex('a*b+c?')).toBe('a\\*b\\+c\\?')
    })

    it('无特殊字符时不改变', () => {
      expect(escapeRegex('hello')).toBe('hello')
    })
  })

  describe('upsertManagedBlock', () => {
    it('文件不存在时创建新文件', () => {
      const filePath = path.join(tmpDir, 'AGENTS.md')
      upsertManagedBlock(filePath, 'worktree content', 'WORKTREE')

      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).toContain('<!-- CLAUDEOPS:WORKTREE:START -->')
      expect(content).toContain('worktree content')
      expect(content).toContain('<!-- CLAUDEOPS:WORKTREE:END -->')
    })

    it('文件存在但无 block 时追加到末尾', () => {
      const filePath = path.join(tmpDir, 'AGENTS.md')
      fs.writeFileSync(filePath, 'existing content', 'utf-8')

      upsertManagedBlock(filePath, 'new block', 'WORKTREE')

      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).toContain('existing content')
      expect(content).toContain('new block')
    })

    it('文件已含 block 时替换内容', () => {
      const filePath = path.join(tmpDir, 'AGENTS.md')
      upsertManagedBlock(filePath, 'old content', 'WORKTREE')
      upsertManagedBlock(filePath, 'new content', 'WORKTREE')

      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).not.toContain('old content')
      expect(content).toContain('new content')
    })

    it('不同 blockId 互不干扰', () => {
      const filePath = path.join(tmpDir, 'AGENTS.md')
      upsertManagedBlock(filePath, 'worktree content', 'WORKTREE')
      upsertManagedBlock(filePath, 'fileops content', 'FILEOPS')

      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).toContain('worktree content')
      expect(content).toContain('fileops content')
    })
  })

  describe('removeManagedBlock', () => {
    it('移除指定 block', () => {
      const filePath = path.join(tmpDir, 'AGENTS.md')
      upsertManagedBlock(filePath, 'worktree content', 'WORKTREE')
      upsertManagedBlock(filePath, 'fileops content', 'FILEOPS')

      removeManagedBlock(filePath, 'WORKTREE')

      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).not.toContain('worktree content')
      expect(content).toContain('fileops content')
    })

    it('移除后文件为空则删除文件', () => {
      const filePath = path.join(tmpDir, 'AGENTS.md')
      upsertManagedBlock(filePath, 'only content', 'WORKTREE')

      removeManagedBlock(filePath, 'WORKTREE')

      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('文件不存在时不报错', () => {
      const filePath = path.join(tmpDir, 'nonexistent.md')
      expect(() => removeManagedBlock(filePath, 'WORKTREE')).not.toThrow()
    })
  })
})
