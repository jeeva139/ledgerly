// Development runner: Vite dev server + esbuild watch for the main process + Electron.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')

// Initial main-process build, then watch.
spawnSync(process.execPath, [path.join(root, 'scripts', 'build-main.mjs')], { stdio: 'inherit' })
spawn(process.execPath, [path.join(root, 'scripts', 'build-main.mjs'), '--watch'], { stdio: 'inherit' })

const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts') })
await server.listen()
const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5173/'
console.log('[dev] renderer at', url)

const child = spawn(electronExe, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url }
})
child.on('exit', async () => {
  await server.close()
  process.exit(0)
})
