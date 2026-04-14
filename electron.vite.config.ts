import { resolve } from 'path'
import { builtinModules } from 'module'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 原生模块、大型 SDK 和 electron 需要 external，避免打包失败或体积膨胀
// 注意：external 化的包需同步加入 package.json build.files，否则运行时 import 会找不到
const nativeExternals = [
  'electron',
  'node-pty',
  'better-sqlite3',
  'bufferutil',
  'utf-8-validate',
  // 大型 AI SDK（动态 import，必须 external）
  'openai',
  '@anthropic-ai/sdk',
  '@anthropic-ai/claude-agent-sdk',
  // Electron 生态包（依赖 Electron 运行时）
  'electron-updater',
  'electron-log',
  'electron-store',
  // 可能含原生模块
  'node-record-lpcm16',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`)
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'agent/AgentMCPServer': resolve(__dirname, 'src/main/agent/AgentMCPServer.ts')
        },
        external: nativeExternals
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    css: {
      postcss: resolve(__dirname, 'postcss.config.js')
    }
  }
})
