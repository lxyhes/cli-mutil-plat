import { spawnSync } from 'node:child_process'

function runOrExit(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const args = process.argv.slice(2)
const publishLatest = args.includes('--publish-latest')
const archArg = args.find((arg) => arg.startsWith('--arch=')) || ''
const baseOutputDir = args.find((arg) => !arg.startsWith('--')) || 'release'
const targetArch = (archArg.split('=')[1] || process.arch) === 'x64' ? 'x64' : 'arm64'

runOrExit(npx, ['electron-vite', 'build'])
runOrExit(npm, ['run', 'rebuild'])

const builderArgs = [
  'electron-builder',
  '--mac',
  targetArch === 'x64' ? '--x64' : '--arm64',
  `--config.directories.output=${baseOutputDir}`,
]

if (publishLatest) {
  builderArgs.push('--publish', 'always')
  builderArgs.push('--config.publish.provider=generic')
  builderArgs.push(`--config.publish.url=https://claudeops.wbdao.cn/releases/stable/mac/${targetArch}`)
}

runOrExit(npx, builderArgs)
