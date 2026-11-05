// Bundles the Electron main process, the preload script and the import worker with esbuild.
import esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
  logLevel: 'info',
  absWorkingDir: root,
  alias: { '@shared': './shared' },
  // `node:sqlite` is part of Electron's Node runtime.
  external: ['electron', 'node:*']
}

const entries = [
  // Runtime npm dependencies stay external (packaged inside app.asar/node_modules).
  { entry: 'electron/main.ts', out: 'dist-electron/main.js', external: ['archiver', 'yauzl'] },
  { entry: 'electron/preload.ts', out: 'dist-electron/preload.js', external: [] },
  // The worker bundles everything (xlsx, papaparse) so it has no module lookups at runtime.
  { entry: 'electron/imports/worker.ts', out: 'dist-electron/import-worker.js', external: [], optional: true }
]

const jobs = entries.filter((e) => !e.optional || fs.existsSync(path.join(root, e.entry)))
fs.mkdirSync(path.join(root, 'dist-electron'), { recursive: true })

const options = (e) => ({
  ...common,
  entryPoints: [e.entry],
  outfile: e.out,
  external: [...common.external, ...e.external]
})

if (watch) {
  for (const e of jobs) {
    const ctx = await esbuild.context(options(e))
    await ctx.watch()
  }
  console.log('[build-main] watching…')
} else {
  for (const e of jobs) await esbuild.build(options(e))
  console.log(`[build-main] built ${jobs.length} bundle(s).`)
}
