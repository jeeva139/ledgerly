// Exploration: complete a QIF import through the UI, then open Category Finder and dump its controls.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'
import { QIF } from './fixtures.mjs'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.qa-data', 'shots')
const texts = (app, sel) => app.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => (e.getAttribute('aria-label') || e.textContent).trim().replace(/\\s+/g, ' ').slice(0, 90)).filter(Boolean)`)
const app = await launch({ width: 1440, height: 900 })
try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(1440, 900)
  await app.click('.nav-item', 'Import')
  await app.sleep(400)
  await app.eval(`(async () => {
    const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(QIF)}], 'bank_statement.qif'))
    const t = document.querySelector('.imp-drop')
    for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  })()`)
  await app.waitFor("document.body.innerText.includes('Import settings')")
  console.log('selects:', JSON.stringify(await app.eval("[...document.querySelectorAll('.page select')].map(s => ({ aria: s.getAttribute('aria-label'), options: [...s.options].map(o => o.text) }))")))
  // choose the account
  await app.eval(`(() => { const s = document.querySelector('.page select'); const o = [...s.options].find(o => o.text.includes('Main Checking'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await app.sleep(600)
  await app.screenshot(path.join(out, 'import-2-ready.png'))
  await app.click('.page button', 'Import Transactions')
  await app.waitFor("document.body.innerText.includes('Import complete')", 20000)
  await app.sleep(500)
  await app.screenshot(path.join(out, 'import-3-report.png'))
  console.log('report text:', (await app.eval("document.querySelector('.page').innerText")).replace(/\n+/g, ' | ').slice(0, 500))
  // Category Finder
  await app.click('.nav-item', 'Category Finder')
  await app.sleep(600)
  await app.screenshot(path.join(out, 'finder-0.png'))
  console.log('finder controls:', JSON.stringify(await texts(app, '.page button, .page select, .page textarea, .page input')))
  console.log('errors:', JSON.stringify(app.consoleErrors))
} finally {
  await app.close()
}
process.exit(0)
