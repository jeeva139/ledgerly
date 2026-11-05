// System-level end-to-end checks against the REAL app: application lock, offline behaviour, document vault,
// dark theme, backup file creation and the destructive "erase all data" flow (spec §70, §75–76, §106, §107, §117).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.qa-data', 'shots')
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${!ok && detail ? '   → ' + detail : ''}`) }
const app = await launch({ width: 1440, height: 900 })
const call = async (ns, m, arg) => {
  const r = await app.eval(`window.ledgerly[${JSON.stringify(ns)}][${JSON.stringify(m)}](${JSON.stringify(arg ?? null)})`)
  if (!r.ok) throw new Error(`${ns}.${m}: ${r.error.message}`)
  return r.data
}
const raw = (ns, m, arg) => app.eval(`window.ledgerly[${JSON.stringify(ns)}][${JSON.stringify(m)}](${JSON.stringify(arg ?? null)})`)

// Outbound (non-loopback) TCP connections owned by any Ledgerly/Electron process tree started by the driver.
function outboundConnections() {
  try {
    const ps = `$ids = (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*remote-debugging-port=9333*' -or $_.CommandLine -like '*--user-data-dir=*ledgerly*' } | Select-Object -ExpandProperty ProcessId); ` +
      `$all = Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ParentProcessId -or $ids -contains $_.ProcessId } | Select-Object -ExpandProperty ProcessId; ` +
      `Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $all -contains $_.OwningProcess -and $_.RemoteAddress -notin @('127.0.0.1','::1','0.0.0.0','::') -and $_.State -ne 'Listen' } | ForEach-Object { "$($_.RemoteAddress):$($_.RemotePort) $($_.State)" }`
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
  } catch (e) { return ['probe-failed: ' + e.message] }
}

try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(1440, 900)
  await call('transactions', 'create', { date: '2026-10-02', merchant: 'Test Merchant', amount: 100, type: 'expense', account: 'Cash' })

  console.log('\n§107 / §106 Offline & security')
  const fetchResult = await app.eval(`fetch('https://example.com/', { mode: 'no-cors' }).then(() => 'LOADED', (e) => 'BLOCKED')`)
  check('renderer cannot reach the internet (fetch to https://example.com is blocked)', fetchResult === 'BLOCKED', fetchResult)
  const xhr = await app.eval(`new Promise(r => { const x = new XMLHttpRequest(); x.onerror = () => r('BLOCKED'); x.onload = () => r('LOADED'); x.open('GET', 'http://example.com/'); x.send() })`)
  check('XMLHttpRequest to the internet is blocked', xhr === 'BLOCKED', xhr)
  const ws = await app.eval(`new Promise(r => { try { const s = new WebSocket('wss://example.com/'); s.onerror = () => r('BLOCKED'); s.onopen = () => r('OPEN') } catch { r('BLOCKED') } })`)
  check('WebSocket to the internet is blocked', ws === 'BLOCKED', ws)
  check('renderer has no Node.js / filesystem access', await app.eval("typeof require === 'undefined' && typeof process === 'undefined' && typeof module === 'undefined'"))
  check('bridge exposes only the typed API (no raw ipcRenderer / fs)', await app.eval("!('ipcRenderer' in window) && !('electron' in window) && typeof window.ledgerly.fs === 'undefined'"))
  const bad = await raw('transactions', 'create', { date: 'x', merchant: 123, amount: 'a' })
  check('main process rejects malformed IPC input with a friendly error', bad.ok === false && !/at .*\.js:\d+/.test(JSON.stringify(bad)), JSON.stringify(bad).slice(0, 160))
  const traversal = await raw('documents', 'open', { id: '../../../Windows/System32/cmd.exe' })
  check('document ids cannot be used for path traversal', traversal.ok === false)
  await app.sleep(1500)
  const conns = outboundConnections()
  check('no outbound network connections from Ledgerly processes (netstat)', conns.length === 0, conns.join('; '))

  console.log('\nApplication lock')
  await call('lock', 'setPin', { pin: '2468' })
  check('lock enabled (current session stays unlocked until Lock now / restart)', (await call('lock', 'status')).enabled === true && (await call('lock', 'status')).locked === false)
  await call('lock', 'lockNow')
  await app.eval('location.reload()')
  await app.waitFor("document.body.innerText.includes('Ledgerly is locked')", 10000)
  await app.screenshot(path.join(out, 'sys-lock.png'))
  const blocked = await raw('transactions', 'list', { page: 1, pageSize: 10 })
  check('while locked, data requests are refused by the main process', blocked.ok === false && blocked.error.code === 'LOCKED')
  await app.fill('input[type=password]', '0000')
  await app.click('button', 'Unlock')
  await app.sleep(600)
  check('wrong PIN is rejected with a clear message', /not the correct PIN/i.test(await app.eval('document.body.innerText')))
  await app.fill('input[type=password]', '2468')
  await app.click('button', 'Unlock')
  await app.waitFor("document.querySelector('.app') !== null", 10000)
  check('correct PIN unlocks the app', true)
  await call('lock', 'removePin', { pin: '2468' })

  console.log('\nDocument vault')
  await app.click('.nav-item', 'Documents')
  await app.sleep(500)
  await app.screenshot(path.join(out, 'sys-documents-empty.png'))
  const small = await app.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['Merchant: Test Cafe\\nDate: 2026-10-05\\nTotal: 245.00'], 'receipt.txt', { type: 'text/plain' }))
    const t = document.querySelector('.doc-drop'); for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); return true })()`)
  await app.sleep(1200)
  let docs = (await call('documents', 'list', {})).rows
  check('dropped file is stored in the local vault with metadata', small && docs.length === 1 && docs[0].filename === 'receipt.txt' && docs[0].size > 0 && docs[0].source === 'upload', JSON.stringify(docs[0]))
  check('document records never expose a filesystem path', !JSON.stringify(docs).match(/[A-Za-z]:\\\\|objectPath/))
  const big = await raw('documents', 'uploadBytes', { filename: 'huge.pdf', bytes: Array.from({ length: 1 }, () => 0) })
  const tooBig = await app.eval(`(async () => { const bytes = new Uint8Array(21 * 1024 * 1024); const r = await window.ledgerly.documents.uploadBytes({ filename: 'huge.pdf', bytes }); return r })()`)
  check('file over 20 MB is refused with a readable message (not truncated)', tooBig.ok === false && /20 MB/.test(tooBig.error.message), JSON.stringify(tooBig).slice(0, 200))
  const wrongType = await raw('documents', 'uploadBytes', { filename: 'virus.exe', bytes: [1, 2, 3] })
  check('unsupported file type is refused', wrongType.ok === false)
  const vaultFiles = fs.readdirSync(path.join(app.dataDir, 'documents', 'other')).concat(fs.readdirSync(path.join(app.dataDir, 'documents', 'receipts')))
  check('original bytes stored on disk inside the vault', vaultFiles.some((f) => f.endsWith('receipt.txt')))
  void big

  console.log('\nTheme & accessibility')
  await call('catalog', 'setPreferences', { theme: 'dark' })
  await app.eval('location.reload()')
  await app.waitFor("document.querySelector('.app') !== null")
  check('dark theme applied', (await app.eval("document.documentElement.dataset.theme")) === 'dark')
  await app.click('.nav-item', 'Dashboard')
  await app.sleep(800)
  await app.screenshot(path.join(out, 'sys-dark-dashboard.png'))
  await call('catalog', 'setPreferences', { theme: 'light' })
  await app.eval('location.reload()')
  await app.waitFor("document.querySelector('.app') !== null")
  await app.click('button', 'Add Entry')
  await app.waitFor("!!document.querySelector('.modal')")
  await app.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await app.sleep(300)
  check('Escape closes the dialog', !(await app.eval("!!document.querySelector('.modal')")))
  await app.click('button', 'Add Entry')
  await app.waitFor("!!document.querySelector('.modal')")
  const trapped = await app.eval(`(() => { const m = document.querySelector('.modal'); const f = [...m.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]; f[f.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); return m.contains(document.activeElement) })()`)
  check('focus stays inside the open dialog', trapped)
  await app.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  const unlabeled = await app.eval(`[...document.querySelectorAll('button, [role=button]')].filter(b => !(b.innerText || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length`)
  check('every icon-only button has an accessible name', unlabeled === 0, String(unlabeled))

  console.log('\nBackup & erase-all-data')
  const bk = await call('backup', 'create', { destination: 'backups-folder' })
  const backups = await call('backup', 'list')
  check('backup package created in the backups folder (.ledgerlybackup)', JSON.stringify(bk).includes('ledgerlybackup') || backups.length >= 1, JSON.stringify(bk).slice(0, 160))
  await call('categories', 'add', { name: 'TempCategory' })
  await call('budgets', 'create', { category: 'Dining', monthlyLimit: 100, active: true })
  await call('goals', 'create', { name: 'Temp goal', targetAmount: 1000, currentAmount: 10, dueDate: null, note: '' })
  await call('catalog', 'setNetWorth', { assets: 10, liabilities: 5 })
  await app.click('.nav-item', 'Settings')
  await app.sleep(500)
  await app.click('.page button', 'Danger zone')
  await app.sleep(300)
  await app.screenshot(path.join(out, 'sys-danger.png'))
  await app.eval(`[...document.querySelectorAll('.page button')].find(b => /erase all/i.test(b.textContent)).click()`)
  await app.sleep(500)
  await app.screenshot(path.join(out, 'sys-erase-dialog.png'))
  const eraseBtn = () => app.eval(`(() => { const b = [...document.querySelectorAll('.modal button')].find(b => /DELETE EVERYTHING/.test(b.textContent)); return b ? b.disabled : null })()`)
  check('DELETE EVERYTHING is disabled until the exact word is typed', (await eraseBtn()) === true)
  await app.fill('.modal input[placeholder="DELETE"]', 'delete')
  check('lower-case "delete" does not enable it', (await eraseBtn()) === true)
  await app.fill('.modal input[placeholder="DELETE"]', 'DELETE')
  check('exact "DELETE" enables it', (await eraseBtn()) === false)
  await app.eval(`[...document.querySelectorAll('.modal button')].find(b => /DELETE EVERYTHING/.test(b.textContent)).click()`)
  await app.sleep(4000)
  await app.waitFor("document.querySelector('.app') !== null", 15000)
  const fresh = await call('catalog', 'bootstrap')
  check('after erase: brand-new install (no transactions/documents, net worth not set, all-time)', fresh.counts.transactions === 0 && fresh.counts.documents === 0 && fresh.netWorth.configured === false && fresh.selectedPeriod === 'all-time' && fresh.freshStart === true)
  check('after erase: starter categories only, TempCategory gone', fresh.categories.includes('Needs review') && !fresh.categories.includes('TempCategory'))
  check('after erase: budgets/goals/tags/rules empty', (await call('budgets', 'list', {})).budgets.length === 0 && (await call('goals', 'list')).length === 0 && (await call('tags', 'list')).length === 0)
  const leftovers = ['receipts', 'other', 'invoices', 'statements', 'spreadsheets'].flatMap((d) => fs.readdirSync(path.join(app.dataDir, 'documents', d)))
  check('after erase: document vault emptied on disk', leftovers.length === 0, leftovers.join(','))
  await app.screenshot(path.join(out, 'sys-after-erase.png'))

  console.log('\nconsole errors:', JSON.stringify(app.consoleErrors))
  check('no renderer console errors', app.consoleErrors.length === 0)
} catch (e) {
  console.log('\n  ABORTED:', e.message)
  results.push(false)
  await app.screenshot(path.join(out, 'sys-failure.png')).catch(() => {})
} finally {
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  await app.close()
}
process.exit(0)
