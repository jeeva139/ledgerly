// End-to-end acceptance run against the REAL app (UI-driven), spec §114 / §116 / §115 / §83.
//   ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\qa\e2e-core.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'
import { QIF, LONG_UPI } from './fixtures.mjs'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.qa-data', 'shots')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail && !ok ? `   → ${detail}` : ''}`)
}
const app = await launch({ width: 1440, height: 900 })
const call = async (ns, m, arg) => {
  const r = await app.eval(`window.ledgerly[${JSON.stringify(ns)}][${JSON.stringify(m)}](${JSON.stringify(arg ?? null)})`)
  if (!r.ok) throw new Error(`${ns}.${m}: ${r.error.message}`)
  return r.data
}
const list = (extra = {}) => call('transactions', 'list', { page: 1, pageSize: 250, sort: { field: 'date', dir: 'asc' }, ...extra })
const pageText = () => app.eval("document.querySelector('.page')?.innerText ?? ''")
const bodyText = () => app.eval('document.body.innerText')
const setSelect = (sel, text) => app.eval(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); const o = [...s.options].find(o => o.text.includes(${JSON.stringify(text)}) || o.value === ${JSON.stringify(text)});
  if (!o) throw new Error('no option ' + ${JSON.stringify(text)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
const dropFile = (name, content) => app.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}))
  const t = document.querySelector('.imp-drop'); for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })) })()`)

async function importQif(name, content, accountText = 'Main Checking') {
  await app.click('.nav-item', 'Import')
  await app.sleep(300)
  // back to the start step if a previous report is showing
  if (!(await app.eval("!!document.querySelector('.imp-drop')"))) await app.click('.page button', 'Import another file')
  await dropFile(name, content)
  await app.waitFor("document.body.innerText.includes('Import settings')")
  await setSelect('.page select', accountText)
  await app.sleep(500)
  await app.click('.page button', 'Import Transactions')
  await app.waitFor("document.body.innerText.includes('Import complete')", 20000)
  return pageText()
}
const num = (text, label) => Number((new RegExp(`${label}\\s*\\n?\\s*([\\d,]+)`).exec(text) ?? [])[1]?.replace(/,/g, ''))

try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(1440, 900)

  console.log('\n§114 Fresh install is truly empty')
  const boot = await call('catalog', 'bootstrap')
  check('no transactions', boot.counts.transactions === 0 && (await list()).total === 0)
  check('no documents', boot.counts.documents === 0)
  const emptyRules = (await call('rules', 'list')).rules.length === 0
  const emptyTags = (await call('tags', 'list')).length === 0
  const emptyBudgets = (await call('budgets', 'list', {})).budgets.length === 0
  check('no budgets / goals / rules / tags', emptyRules && emptyTags && emptyBudgets && (await call('goals', 'list')).length === 0)
  check('net worth not configured, period all-time', boot.netWorth.configured === false && boot.selectedPeriod === 'all-time')
  check('starter accounts have no balance', boot.accounts.length === 4 && boot.accounts.every((a) => a.openingBalance === null))

  console.log('\n§116 QIF import through the UI')
  const report = await importQif('bank_statement.qif', QIF)
  await app.screenshot(path.join(out, 'e2e-import-report.png'))
  check('report: inserted 7', num(report, 'Inserted') === 7, report.replace(/\n+/g, ' | ').slice(0, 200))
  check('report: invalid/skipped 1', num(report, 'Invalid / skipped') === 1)
  let rows = (await list()).rows
  check('7 transactions stored (identical in-file repeat kept)', rows.length === 7)
  const sw = rows.find((r) => r.merchant === 'SWIGGY')
  check('payee→merchant, memo kept, QIF category kept', sw?.memo.includes('Order 12345') && sw.category === 'Dining' && sw.amount === 180 && sw.type === 'expense' && sw.date === '2026-10-12', JSON.stringify(sw))
  const sal = rows.find((r) => r.merchant.includes('SALARY'))
  check('positive amount → income (magnitude stored)', sal?.type === 'income' && sal.amount === 65000 && sal.category === 'Income')
  check('no category → Needs review', rows.find((r) => r.merchant === 'DOSA CORNER')?.category === 'Needs review')
  check('thousands separator parsed (1,299.00)', rows.find((r) => r.merchant === 'NETFLIX.COM')?.amount === 1299)
  // Re-importing the same file: the preview must flag every row as a duplicate and refuse to import.
  await app.click('.nav-item', 'Import')
  await app.sleep(300)
  if (!(await app.eval("!!document.querySelector('.imp-drop')"))) await app.click('.page button', 'Import another file')
  await dropFile('bank_statement.qif', QIF)
  await app.waitFor("document.body.innerText.includes('Import settings')")
  await setSelect('.page select', 'Main Checking')
  await app.sleep(600)
  const dupPreview = await pageText()
  check('re-import preview: Duplicates (7), nothing new to import', /Duplicates \(7\)/.test(dupPreview) && /nothing new to import/i.test(dupPreview))
  check('re-import: Import button is disabled', await app.eval("[...document.querySelectorAll('.page button')].find(b => b.textContent.includes('Import Transactions'))?.disabled === true"))
  await app.click('.page button', 'Cancel')
  await app.sleep(300)
  check('still 7 rows after re-import', (await list()).total === 7)

  console.log('\n§115 Category Finder acceptance (UI)')
  const upi = await call('transactions', 'create', { date: '2026-10-18', merchant: LONG_UPI, amount: 180, type: 'expense', account: 'Main Checking' })
  const before = (await call('transactions', 'get', { id: upi.id }))
  await app.click('.nav-item', 'Category Finder')
  await app.sleep(500)
  await setSelect('.page select', '__create__')
  await app.sleep(200)
  await app.fill('input[aria-label="New category name"]', 'Food')
  await app.click('.page button', 'Add')
  await app.sleep(600)
  await app.fill('.page textarea', 'Tea, Briyani, Dosa, Dinner, Lunch, Breakfast')
  await app.screenshot(path.join(out, 'e2e-finder-1-input.png'))
  await app.click('.page button', 'Search transactions')
  await app.waitFor("document.body.innerText.includes('Found')", 15000)
  await app.sleep(500)
  await app.screenshot(path.join(out, 'e2e-finder-2-preview.png'))
  const preview = await pageText()
  check('preview lists Category: Food and the keywords', /Food/.test(preview) && /Briyani/.test(preview) && /Breakfast/.test(preview))
  check('Found: 6 transactions (long UPI + briyani + dosa + dinner-memo + 2 tea)', /Found:?\s*\n?\s*6/.test(preview), preview.replace(/\n+/g, ' | ').slice(0, 300))
  check('long UPI narration shown with "Matched keyword" Lunch and Tea', (await app.eval(`[...document.querySelectorAll('.page tr')].filter(r => r.innerText.includes('MANIKANDAN')).some(r => r.querySelector('[title="Matched keyword: Lunch"]') && r.querySelector('[title="Matched keyword: Tea"]'))`)))
  const untouched = await call('transactions', 'get', { id: upi.id })
  check('NOTHING changed before Apply', untouched.category === before.category && untouched.updatedAt === before.updatedAt)

  await app.click('.page button', 'Apply')
  await app.sleep(500)
  await app.screenshot(path.join(out, 'e2e-finder-3-confirm.png'))
  const confirmText = await app.eval("document.querySelector('.modal')?.innerText ?? ''")
  check('confirm dialog: "Apply Food to 6 selected transactions?"', /Apply Food to 6 selected transactions\?/.test(confirmText), confirmText.slice(0, 200))
  await app.eval(`[...document.querySelectorAll('.modal-foot button')].pop().click()`)
  await app.waitFor("document.body.innerText.includes('Successfully categorized')", 15000)
  await app.sleep(500)
  await app.screenshot(path.join(out, 'e2e-finder-4-done.png'))
  const done = await pageText()
  check('result message: Successfully categorized 6 transactions as Food', /Successfully categorized 6 transactions as Food/.test(done), done.replace(/\n+/g, ' | ').slice(0, 300))
  check('offers to save keywords as future rules', /Save these keywords as a future rule\?/.test(done))
  const after = await call('transactions', 'get', { id: upi.id })
  const same = ['date', 'merchant', 'memo', 'amount', 'type', 'account', 'source', 'tags', 'isTransfer'].every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k]))
  check('category=Food; date, merchant, amount, type, account unchanged', after.category === 'Food' && same)
  check('manual choice is protected afterwards (categoryLocked)', after.categoryLocked === true)
  rows = (await list()).rows
  check('exactly 6 rows are Food; salary/netflix untouched', rows.filter((r) => r.category === 'Food').length === 6 && rows.find((r) => r.merchant.includes('SALARY')).category === 'Income' && rows.find((r) => r.merchant === 'NETFLIX.COM').category === 'Subscriptions')

  await app.click('.page button', 'Yes')
  await app.sleep(800)
  const rules = (await call('rules', 'list')).rules
  check('6 rules saved (one per keyword → Food)', rules.length === 6 && rules.every((r) => r.thenText === 'Food'), JSON.stringify(rules.map((r) => r.whenText)))

  console.log('\n§83 Saved rules apply to FUTURE imports')
  const future = ['!Type:Bank', 'D20/10/2026', 'T-20.00', 'PMORNING TEA STALL', '^', 'D21/10/2026', 'T-500.00', 'PELECTRICITY BOARD', '^', ''].join('\r\n')
  await importQif('second.qif', future)
  rows = (await list()).rows
  check('new "TEA" transaction auto-categorised Food by rule', rows.find((r) => r.merchant === 'MORNING TEA STALL')?.category === 'Food')
  check('non-matching transaction stays Needs review', rows.find((r) => r.merchant === 'ELECTRICITY BOARD')?.category === 'Needs review')
  check('earlier manual categories not rewritten', rows.find((r) => r.merchant === 'SWIGGY')?.category === 'Food')

  console.log('\nconsole errors:', JSON.stringify(app.consoleErrors))
  check('no renderer console errors', app.consoleErrors.length === 0)
} catch (e) {
  console.log('\n  ABORTED:', e.message)
  check('script completed', false, e.message)
  await app.screenshot(path.join(out, 'e2e-failure.png')).catch(() => {})
} finally {
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} checks passed`)
  console.log('data dir:', app.dataDir)
  await app.close()
}
process.exit(0)
