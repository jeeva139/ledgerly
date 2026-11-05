// Exploration: drop a QIF onto the Import page and screenshot each step (selectors for the real e2e script).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'
import { QIF } from './fixtures.mjs'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.qa-data', 'shots')
const app = await launch({ width: 1440, height: 900 })
try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(1440, 900)
  await app.click('.nav-item', 'Import')
  await app.sleep(500)
  await app.screenshot(path.join(out, 'import-0-start.png'))
  console.log('buttons:', JSON.stringify(await app.eval("[...document.querySelectorAll('.page button')].map(b => (b.getAttribute('aria-label') || b.textContent).trim()).filter(Boolean)")))
  console.log('dropzones:', JSON.stringify(await app.eval("[...document.querySelectorAll('[class*=drop]')].map(e => e.className)")))
  // Simulate dropping a .qif file onto whichever element handles drops.
  const dropped = await app.eval(`(async () => {
    const file = new File([${JSON.stringify(QIF)}], 'bank_statement.qif', { type: 'application/octet-stream' })
    const dt = new DataTransfer(); dt.items.add(file)
    const target = document.querySelector('[class*=drop]') || document.querySelector('.page')
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    return target.className
  })()`)
  console.log('dropped on:', dropped)
  await app.sleep(1500)
  await app.screenshot(path.join(out, 'import-1-review.png'))
  console.log('h-texts:', JSON.stringify(await app.eval("[...document.querySelectorAll('.page h1, .page h2, .page h3')].map(e => e.textContent.trim())")))
  console.log('buttons:', JSON.stringify(await app.eval("[...document.querySelectorAll('.page button')].map(b => (b.getAttribute('aria-label') || b.textContent).trim()).filter(Boolean)")))
  console.log('errors:', JSON.stringify(app.consoleErrors))
} finally {
  await app.close()
}
process.exit(0)
