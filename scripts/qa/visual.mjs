// Visual review: seeded data set + recurring series + budgets + goals, screenshots of every page at several sizes.
//   (seed first)  ELECTRON_RUN_AS_NODE=1 electron.exe scripts/qa/seed.mjs <dir> 3000
//   then          ELECTRON_RUN_AS_NODE=1 electron.exe scripts/qa/visual.mjs <dir>
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'

const dataDir = process.argv[2]
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.qa-data', 'shots', 'visual')
const app = await launch({ dataDir, width: 1440, height: 900 })
const call = async (ns, m, arg) => {
  const r = await app.eval(`window.ledgerly[${JSON.stringify(ns)}][${JSON.stringify(m)}](${JSON.stringify(arg ?? null)})`)
  if (!r.ok) throw new Error(`${ns}.${m}: ${r.error.message}`)
  return r.data
}
try {
  await app.waitFor("document.querySelector('.app') !== null")
  // Recurring series with real, regular dates (monthly), so detection has something genuine to find.
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
  for (const m of months) {
    await call('transactions', 'create', { date: `${m}-05`, merchant: 'NETFLIX.COM', amount: 649, type: 'expense', account: 'Everyday Visa', category: 'Subscriptions' })
    await call('transactions', 'create', { date: `${m}-01`, merchant: 'HOUSE RENT - MR KUMAR', amount: 18000, type: 'expense', account: 'Main Checking', category: 'Housing' })
    await call('transactions', 'create', { date: `${m}-28`, merchant: 'ACME CORP SALARY', amount: 65000, type: 'income', account: 'Main Checking', category: 'Income' })
    await call('transactions', 'create', { date: `${m}-12`, merchant: 'SPOTIFY INDIA', amount: 119, type: 'expense', account: 'Everyday Visa', category: 'Subscriptions' })
  }
  await call('catalog', 'setNetWorth', { assets: 1250000, liabilities: 340000 })
  await call('budgets', 'create', { category: 'Dining', monthlyLimit: 6000, active: true })
  await call('budgets', 'create', { category: 'Groceries', monthlyLimit: 12000, active: true })
  await call('budgets', 'create', { category: 'Subscriptions', monthlyLimit: 500, active: true })
  await call('goals', 'create', { name: 'Emergency fund', targetAmount: 300000, currentAmount: 120000, dueDate: '2027-06-30', note: 'Six months of expenses' })
  const rec = await call('recurring', 'list', { status: 'suggested' })
  console.log('recurring suggestions:', rec.map((r) => `${r.merchant} (${r.cadence}, ${r.kind}, ${r.confidence})`).join('; '))
  for (const r of rec.filter((x) => /netflix|rent|spotify/i.test(x.merchant))) await call('recurring', 'keep', { key: r.key })
  await call('catalog', 'setPeriod', { period: 'all-time' })
  await app.eval('location.reload()')
  await app.waitFor("document.querySelector('.app') !== null")

  const pages = ['Dashboard', 'Transactions', 'Recurring', 'Subscriptions', 'Budgets', 'Goals', 'Reports', 'Documents', 'Rules', 'Settings', 'Import']
  for (const [w, h] of [[1440, 900], [1024, 768], [800, 600]]) {
    await app.setSize(w, h)
    for (const p of pages) {
      await app.click('.nav-item', p)
      await app.sleep(900)
      const overflowX = await app.eval('document.documentElement.scrollWidth > window.innerWidth + 1 || document.querySelector(".content").scrollWidth > document.querySelector(".content").clientWidth + 1')
      console.log(`${String(w).padStart(4)}px  ${p.padEnd(14)} horizontal-overflow=${overflowX}`)
      await app.screenshot(path.join(out, `${w}-${p.toLowerCase()}.png`))
    }
  }
  console.log('console errors:', JSON.stringify(app.consoleErrors))
} catch (e) {
  console.log('ABORTED', e.message)
  await app.screenshot(path.join(out, 'failure.png')).catch(() => {})
} finally {
  await app.close()
}
process.exit(0)
