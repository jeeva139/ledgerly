// Runs vitest inside Electron's Node runtime (ELECTRON_RUN_AS_NODE) so that `node:sqlite` is available.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
if (!fs.existsSync(electronExe)) {
  console.error('Electron is not installed. Run: node scripts/setup-electron.mjs')
  process.exit(1)
}
const args = process.argv.slice(2)
const res = spawnSync(electronExe, [vitest, ...(args.length ? args : ['run'])], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' }
})
process.exit(res.status ?? 1)
