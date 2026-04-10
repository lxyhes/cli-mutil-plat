import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronVitePkg = require.resolve('electron-vite/package.json')
const electronViteBin = join(dirname(electronVitePkg), 'bin', 'electron-vite.js')

const env = {
  ...process.env,
  NODE_OPTIONS: '--max-old-space-size=4096'
}

const child = spawn(process.execPath, [electronViteBin, 'dev'], {
  env,
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error('[dev] Failed to start electron-vite:', error)
  process.exit(1)
})
