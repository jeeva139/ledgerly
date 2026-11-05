// Performance QA (spec §72, §105): the real app on 1k / 10k / 50k / 100k transactions.
//   ELECTRON_RUN_AS_NODE=1 electron.exe scripts/qa/perf.mjs [counts...]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const counts = process.argv.slice(2).map(Number).filter(Boolean)
const sizes = counts.length ? counts : [1000, 10000, 50000, 100000]
const rows = []

for (const n of sizes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ledgerly-perf-${n}-`))
  spawnSync(electronExe, [path.join(root, 'scripts', 'qa', 'seed.mjs'), dir, String(n)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' })
  const t0 = Date.now()
  const app = await launch({ dataDir: dir, port: 9360 })
  try {
    await app.waitFor("document.querySelector('.app') !== null")
    const startup = Date.now() - t0
    const call = (ns, m, arg) => app.eval(`(async () => { const t = performance.now(); const r = await window.ledgerly[${JSON.stringify(ns)}][${JSON.stringify(m)}](${JSON.stringify(arg ?? null)}); return { ms: Math.round(performance.now() - t), ok: r.ok, err: r.ok ? null : r.error.message } })()`)
    const m = {}
    m.list = (await call('transactions', 'list', { page: 1, pageSize: 100, sort: { field: 'date', dir: 'desc' } })).ms
    m.sortAmt = (await call('transactions', 'list', { page: 3, pageSize: 100, sort: { field: 'amount', dir: 'desc' } })).ms
    m.search = (await call('transactions', 'list', { page: 1, pageSize: 100, search: 'swiggy' })).ms
    m.searchUpi = (await call('transactions', 'list', { page: 1, pageSize: 100, search: 'manikandan lunch' })).ms
    m.filter = (await call('transactions', 'list', { page: 1, pageSize: 100, accounts: ['Cash'], categories: ['Dining'], dateFrom: '2025-01-01', dateTo: '2025-12-31' })).ms
    m.dash = (await call('dashboard', 'get', { period: 'all-time' })).ms
    m.dashMonth = (await call('dashboard', 'get', { period: 'last-6-months' })).ms
    m.finder = (await call('categoryFinder', 'search', { category: 'Dining', keywords: 'Tea, Briyani, Dosa, Dinner, Lunch, Breakfast' })).ms
    m.recurring = (await call('recurring', 'list', {})).ms
    m.reportCat = (await call('reports', 'spendingByCategory', { period: 'all-time' })).ms
    m.reportMerch = (await call('reports', 'topMerchants', { period: 'all-time' })).ms
    // UI: time from clicking Transactions to rows being on screen
    await app.click('.nav-item', 'Dashboard')
    await app.sleep(500)
    const u0 = Date.now()
    await app.click('.nav-item', 'Transactions')
    await app.waitFor("document.querySelectorAll('.tx-table tbody tr').length > 0", 20000)
    m.uiTxnPage = Date.now() - u0
    const domRows = await app.eval("document.querySelectorAll('.tx-table tbody tr').length")
    const heap = await app.eval('Math.round(performance.memory.usedJSHeapSize / 1048576)')
    rows.push({ n, startup, ...m, domRows, heapMB: heap, errs: app.consoleErrors.length })
  } finally {
    await app.close()
  }
}
const cols = Object.keys(rows[0])
console.log(cols.map((c) => c.padStart(10)).join(' '))
for (const r of rows) console.log(cols.map((c) => String(r[c]).padStart(10)).join(' '))
console.log('\nall values in ms unless noted: startup = launch→UI, ui* = click→rows on screen, domRows = rendered rows (page size), heapMB = renderer JS heap')
process.exit(0)
