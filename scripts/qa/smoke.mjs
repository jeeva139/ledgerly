// Smoke test: first launch is an empty, honest app; every nav item opens; a screenshot of every page at 1440x900,
// then the dashboard at the other required window sizes.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.qa-data', 'shots')
const app = await launch({ width: 1440, height: 900 })
try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(1440, 900)
  const nav = await app.eval("[...document.querySelectorAll('.nav-item')].map(b => b.getAttribute('aria-label'))")
  for (const label of nav) {
    await app.click('.nav-item', label)
    await app.sleep(500)
    const info = await app.eval(`({ h1: document.querySelector('.page h1')?.textContent ?? null, errorAlerts: [...document.querySelectorAll('.alert.danger')].map(e => e.textContent.trim().slice(0, 120)) })`)
    console.log(`${label.padEnd(16)} h1="${info.h1}" ${info.errorAlerts.length ? 'ERRORS: ' + JSON.stringify(info.errorAlerts) : ''}`)
    await app.screenshot(path.join(out, `page-${label.toLowerCase().replace(/\s+/g, '-')}.png`))
  }
  await app.click('.nav-item', 'Dashboard')
  for (const [w, h] of [[1280, 720], [1024, 768], [820, 640]]) {
    await app.setSize(w, h)
    await app.sleep(400)
    await app.screenshot(path.join(out, `dashboard-${w}x${h}.png`))
  }
  console.log('console errors:', JSON.stringify(app.consoleErrors))
} finally {
  await app.close()
}
process.exit(0)
