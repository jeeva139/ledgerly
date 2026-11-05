// Launch the PACKAGED Ledgerly.exe against a throwaway data folder and verify it boots.
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const exe = process.argv[2] ?? path.join(root, 'release', 'win-unpacked', 'Ledgerly.exe')
const app = await launch({ exe, args: [], port: 9344 })
try {
  await app.waitFor("document.querySelector('.app') !== null", 20000)
  const title = await app.eval('document.title')
  const nav = await app.eval("document.querySelectorAll('.nav-item').length")
  const hasBridge = await app.eval("typeof window.ledgerly === 'object' && typeof window.ledgerly.transactions === 'object'")
  const noNode = await app.eval("typeof require === 'undefined' && typeof process === 'undefined'")
  const csp = await app.eval("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')?.content ?? null")
  console.log(JSON.stringify({ title, navItems: nav, hasBridge, rendererHasNoNode: noNode, csp }, null, 1))
  console.log('db created:', fs.existsSync(path.join(app.dataDir, 'ledgerly.db')), '| folders:', fs.readdirSync(app.dataDir).join(', '))
  console.log('console errors:', JSON.stringify(app.consoleErrors))
  await app.screenshot(path.join(root, '.qa-data', 'shots', 'packaged-dashboard.png'))
} finally {
  await app.close()
}
process.exit(0)
