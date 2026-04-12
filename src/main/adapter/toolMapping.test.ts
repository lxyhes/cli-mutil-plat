/**
 * toolMapping 单元测试
 * 验证各 Provider 的工具名到 ActivityEventType 映射正确性
 */
import { describe, it, expect } from 'vitest'
import { mapToolToActivityType, extractToolDetail } from './toolMapping'

describe('mapToolToActivityType', () => {
  describe('Claude Code', () => {
    it('文件操作映射正确', () => {
      expect(mapToolToActivityType('Read', 'claude-code')).toBe('file_read')
      expect(mapToolToActivityType('Write', 'claude-code')).toBe('file_write')
      expect(mapToolToActivityType('Edit', 'claude-code')).toBe('file_edit')
    })

    it('搜索操作映射正确', () => {
      expect(mapToolToActivityType('Glob', 'claude-code')).toBe('search')
      expect(mapToolToActivityType('Grep', 'claude-code')).toBe('search')
      expect(mapToolToActivityType('WebSearch', 'claude-code')).toBe('search')
    })

    it('命令执行映射正确', () => {
      expect(mapToolToActivityType('Bash', 'claude-code')).toBe('command_execute')
    })

    it('未知工具默认为 tool_use', () => {
      expect(mapToolToActivityType('UnknownTool', 'claude-code')).toBe('tool_use')
    })
  })

  describe('Codex', () => {
    it('shell 和 functionCall 映射正确', () => {
      expect(mapToolToActivityType('localShellCall', 'codex')).toBe('command_execute')
      expect(mapToolToActivityType('local_shell_call', 'codex')).toBe('command_execute')
      expect(mapToolToActivityType('functionCall', 'codex')).toBe('tool_use')
      expect(mapToolToActivityType('function_call', 'codex')).toBe('tool_use')
    })

    it('兼容旧版本事件名', () => {
      expect(mapToolToActivityType('commandExecution', 'codex')).toBe('command_execute')
      expect(mapToolToActivityType('shell', 'codex')).toBe('command_execute')
      expect(mapToolToActivityType('fileChange', 'codex')).toBe('file_write')
    })
  })

  describe('Gemini', () => {
    it('核心操作映射正确', () => {
      expect(mapToolToActivityType('shell', 'gemini-cli')).toBe('command_execute')
      expect(mapToolToActivityType('editFile', 'gemini-cli')).toBe('file_write')
      expect(mapToolToActivityType('readFile', 'gemini-cli')).toBe('file_read')
      expect(mapToolToActivityType('searchFiles', 'gemini-cli')).toBe('search')
    })
  })

  describe('iFlow', () => {
    it('文件操作映射正确', () => {
      expect(mapToolToActivityType('read_file', 'iflow')).toBe('file_read')
      expect(mapToolToActivityType('write_file', 'iflow')).toBe('file_write')
      expect(mapToolToActivityType('replace', 'iflow')).toBe('file_edit')
      expect(mapToolToActivityType('multi_edit', 'iflow')).toBe('file_edit')
    })

    it('搜索映射正确', () => {
      expect(mapToolToActivityType('search_file_content', 'iflow')).toBe('search')
      expect(mapToolToActivityType('glob', 'iflow')).toBe('search')
      expect(mapToolToActivityType('web_search', 'iflow')).toBe('search')
    })

    it('命令执行映射正确', () => {
      expect(mapToolToActivityType('run_shell_command', 'iflow')).toBe('command_execute')
    })
  })

  describe('OpenCode', () => {
    it('文件操作映射正确', () => {
      expect(mapToolToActivityType('read', 'opencode')).toBe('file_read')
      expect(mapToolToActivityType('write', 'opencode')).toBe('file_write')
      expect(mapToolToActivityType('edit', 'opencode')).toBe('file_edit')
      expect(mapToolToActivityType('patch', 'opencode')).toBe('file_write')
    })

    it('搜索映射正确', () => {
      expect(mapToolToActivityType('grep', 'opencode')).toBe('search')
      expect(mapToolToActivityType('glob', 'opencode')).toBe('search')
      expect(mapToolToActivityType('websearch', 'opencode')).toBe('search')
    })

    it('命令执行映射正确', () => {
      expect(mapToolToActivityType('bash', 'opencode')).toBe('command_execute')
    })
  })

  describe('未知 Provider', () => {
    it('未知 provider 默认返回 tool_use', () => {
      expect(mapToolToActivityType('Read', 'unknown-provider')).toBe('tool_use')
    })

    it('省略 providerId 默认使用 claude-code', () => {
      expect(mapToolToActivityType('Read')).toBe('file_read')
      expect(mapToolToActivityType('Bash')).toBe('command_execute')
    })
  })
})

describe('extractToolDetail', () => {
  describe('Claude Code 工具', () => {
    it('Read 提取文件路径', () => {
      expect(extractToolDetail('Read', { file_path: '/src/app.ts' })).toBe('读取: /src/app.ts')
    })

    it('Write 提取文件路径', () => {
      expect(extractToolDetail('Write', { file_path: '/src/app.ts' })).toBe('写入: /src/app.ts')
    })

    it('Edit 提取文件路径', () => {
      expect(extractToolDetail('Edit', { file_path: '/src/app.ts' })).toBe('编辑: /src/app.ts')
    })

    it('Bash 截断长命令', () => {
      const longCmd = 'a'.repeat(200)
      const result = extractToolDetail('Bash', { command: longCmd })
      expect(result).toBe(`执行: ${'a'.repeat(100)}...`)
    })

    it('Grep 提取搜索模式', () => {
      expect(extractToolDetail('Grep', { pattern: 'TODO' })).toBe('搜索内容: TODO')
    })

    it('Glob 提取 glob 模式', () => {
      expect(extractToolDetail('Glob', { pattern: '*.ts' })).toBe('搜索文件: *.ts')
    })
  })

  describe('iFlow 工具', () => {
    it('read_file 提取路径', () => {
      expect(extractToolDetail('read_file', { path: '/src/app.ts' })).toBe('读取: /src/app.ts')
    })

    it('run_shell_command 提取命令', () => {
      expect(extractToolDetail('run_shell_command', { command: 'npm test' })).toBe('执行: npm test')
    })

    it('web_search 提取查询', () => {
      expect(extractToolDetail('web_search', { query: 'vitest' })).toBe('搜索: vitest')
    })
  })

  describe('OpenCode 工具', () => {
    it('bash 提取命令', () => {
      expect(extractToolDetail('bash', { command: 'npm run build' })).toBe('执行命令: npm run build')
    })

    it('read 提取文件路径', () => {
      expect(extractToolDetail('read', { filePath: '/src/app.ts' })).toBe('读取文件: /src/app.ts')
    })
  })

  describe('Codex 工具', () => {
    it('shell 提取命令', () => {
      expect(extractToolDetail('shell', { command: 'ls' })).toBe('执行: ls')
    })

    it('functionCall 提取函数名', () => {
      expect(extractToolDetail('functionCall', { name: 'myFunc' })).toBe('调用: myFunc')
    })
  })

  describe('未知工具', () => {
    it('有 title 时使用 title', () => {
      expect(extractToolDetail('custom', { title: '自定义操作' })).toBe('custom: 自定义操作')
    })

    it('无 title 时使用第一个参数值', () => {
      expect(extractToolDetail('custom', { foo: 'bar' })).toBe('custom: bar')
    })

    it('空参数返回工具名', () => {
      expect(extractToolDetail('custom', {})).toBe('custom: ')
    })
  })
})
