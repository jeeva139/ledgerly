// Run an arbitrary JS expression in the app after navigating:  probe.mjs <dataDir> <Page> <width> "<js>"
import { launch } from './driver.mjs'
const [dataDir, page, w, js] = process.argv.slice(2)
const app = await launch({ dataDir })
try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(Number(w), 768)
  await app.click('.nav-item', page)
  await app.sleep(1200)
  console.log(JSON.stringify(await app.eval(js), null, 1))
} finally { await app.close() }
process.exit(0)
