// Find the elements that make a page wider than its scroll container.
//   electron.exe scripts/qa/overflow.mjs <dataDir> "<Page>:<width>" ...
import { launch } from './driver.mjs'

const dataDir = process.argv[2]
const cases = process.argv.slice(3).map((c) => c.split(':'))
const app = await launch({ dataDir })
try {
  await app.waitFor("document.querySelector('.app') !== null")
  for (const [page, w] of cases) {
    await app.setSize(Number(w), 768)
    await app.click('.nav-item', page)
    await app.sleep(1200)
    const res = await app.eval(`(() => {
      const box = document.querySelector('.content'); const limit = box.getBoundingClientRect().right
      const bad = [...box.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > limit + 1 && getComputedStyle(e).position !== 'fixed' })
      // keep only the outermost offenders
      const top = bad.filter(e => !bad.some(o => o !== e && o.contains(e)))
      return { contentW: box.clientWidth, scrollW: box.scrollWidth, offenders: top.slice(0, 8).map(e => ({ tag: e.tagName, cls: String(e.className).slice(0, 70), w: Math.round(e.getBoundingClientRect().width), right: Math.round(e.getBoundingClientRect().right), limit: Math.round(limit), text: (e.innerText || '').slice(0, 40).replace(/\\n/g, ' ') })) }
    })()`)
    console.log(`${page} @ ${w}px:`, JSON.stringify(res, null, 1))
  }
} finally {
  await app.close()
}
process.exit(0)
