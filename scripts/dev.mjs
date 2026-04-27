import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const electronVitePkg = require.resolve('electron-vite/package.json')
const electronViteBin = join(dirname(electronVitePkg), 'bin', 'electron-vite.js')
const electronRebuildCli = require.resolve('@electron/rebuild/lib/cli.js')
const electronVersion = require('electron/package.json').version
const betterSqliteVersion = require('better-sqlite3/package.json').version
const nodePtyVersion = require('node-pty/package.json').version
const nativeCacheDir = join(repoRoot, 'node_modules', '.cache', 'spectrai')
const nativeCacheFile = join(nativeCacheDir, 'native-rebuild.json')
const sqliteBinary = join(repoRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
const nativeStamp = {
  electronVersion,
  betterSqliteVersion,
  nodePtyVersion,
  platform: process.platform,
  arch: process.arch
}

const env = {
  ...process.env,
  NODE_OPTIONS: '--max-old-space-size=4096'
}

function readNativeCache() {
  try {
    return JSON.parse(readFileSync(nativeCacheFile, 'utf-8'))
  } catch {
    return null
  }
}

function shouldRebuildNativeModules() {
  if (process.env.SPECTRAI_SKIP_NATIVE_REBUILD === '1') {
    return false
  }

  const cache = readNativeCache()
  if (!cache) return true

  for (const [key, value] of Object.entries(nativeStamp)) {
    if (cache[key] !== value) return true
  }

  try {
    return cache.sqliteBinaryMtimeMs !== statSync(sqliteBinary).mtimeMs
  } catch {
    return true
  }
}

function ensureElectronNativeModules() {
  if (!shouldRebuildNativeModules()) return

  console.log('[dev] Rebuilding native modules for Electron. Close any running PrismOps window if this fails with EPERM.')
  const result = spawnSync(
    process.execPath,
    [electronRebuildCli, '-f', '-w', 'node-pty', 'better-sqlite3'],
    {
      cwd: repoRoot,
      env,
      stdio: 'inherit'
    }
  )

  if (result.status !== 0) {
    console.error('[dev] Native module rebuild failed. Persistent SQLite storage may not work until this succeeds.')
    process.exit(result.status ?? 1)
  }

  mkdirSync(nativeCacheDir, { recursive: true })
  writeFileSync(nativeCacheFile, JSON.stringify({
    ...nativeStamp,
    sqliteBinaryMtimeMs: existsSync(sqliteBinary) ? statSync(sqliteBinary).mtimeMs : null,
    rebuiltAt: new Date().toISOString()
  }, null, 2))
}

ensureElectronNativeModules()

const child = spawn(process.execPath, [electronViteBin, 'dev'], {
  cwd: repoRoot,
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
