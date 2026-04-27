import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

if (process.platform === 'win32') {
  const script = join(__dirname, 'generate-icon.ps1')
  const result = spawnSync(
    'powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-File', script],
    { stdio: 'inherit' },
  )
  process.exit(result.status ?? 1)
}

console.error('Icon generation currently uses scripts/generate-icon.ps1 on Windows.')
console.error('For non-Windows platforms, regenerate icons from build/icon-512.png or port the PowerShell drawing script.')
process.exit(1)
