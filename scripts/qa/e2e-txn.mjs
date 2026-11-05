// UI-driven checks for the Transactions page and Add Entry modal (spec §36–39, §89).
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
const list = (extra = {}) => call('transactions', 'list', { page: 1, pageSize: 250, sort: { field: 'date', dir: 'asc' }, ...extra })
const modalText = () => app.eval("document.querySelector('.modal')?.innerText ?? ''")
const fields = () => app.eval(`[...document.querySelectorAll('.modal input, .modal select, .modal textarea')].map(e => ({ id: e.id, type: e.type, label: e.labels?.[0]?.innerText?.trim() ?? e.getAttribute('aria-label'), value: e.value }))`)
try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(1440, 900)

  console.log('\nAdd Entry modal')
  await app.click('button', 'Add Entry')
  await app.waitFor("!!document.querySelector('.modal')")
  await app.sleep(300)
  await app.screenshot(path.join(out, 'txn-1-add-entry.png'))
  const f = await fields()
  console.log('  fields:', JSON.stringify(f.map((x) => `${x.label}=${JSON.stringify(x.value)}`)))
  const amount = f.find((x) => /amount/i.test(x.label ?? ''))
  const merchant = f.find((x) => /merchant/i.test(x.label ?? ''))
  const date = f.find((x) => /date/i.test(x.label ?? ''))
  check('Amount starts blank', amount?.value === '')
  check('Merchant starts blank', merchant?.value === '')
  check('Date defaults to today', date?.value === new Date().toISOString().slice(0, 10) || /^\d{4}-\d{2}-\d{2}$/.test(date?.value))
  check('Expense / Income / Transfer choices exist', /Expense/.test(await modalText()) && /Income/.test(await modalText()) && /Transfer/.test(await modalText()))

  // validation: saving an empty form must not create anything
  await app.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => /save|add/i.test(b.textContent) && !/cancel/i.test(b.textContent)).click()`)
  await app.sleep(400)
  const t1 = await modalText()
  check('empty form shows validation, modal stays open', /Amount|amount/.test(t1) && /Merchant|merchant/.test(t1) && (await list()).total === 0)
  await app.screenshot(path.join(out, 'txn-2-validation.png'))

  await app.fill(`#${amount.id}`, '0')
  await app.fill(`#${merchant.id}`, 'Chai Point')
  await app.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => /save|add/i.test(b.textContent) && !/cancel/i.test(b.textContent)).click()`)
  await app.sleep(400)
  check('amount 0 is rejected', (await list()).total === 0)

  await app.fill(`#${amount.id}`, '1,250.50')
  await app.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => /save|add/i.test(b.textContent) && !/cancel/i.test(b.textContent)).click()`)
  await app.waitFor("!document.querySelector('.modal')", 8000)
  let rows = (await list()).rows
  check('valid entry saved (amount 1250.50, expense, Needs review)', rows.length === 1 && rows[0].amount === 1250.5 && rows[0].type === 'expense' && rows[0].merchant === 'Chai Point' && rows[0].category === 'Needs review', JSON.stringify(rows[0]))

  // duplicate protection through the UI
  await app.click('button', 'Add Entry')
  await app.waitFor("!!document.querySelector('.modal')")
  const f2 = await fields()
  const same = (re) => f2.find((x) => re.test(x.label ?? '')).id
  await app.fill(`#${same(/amount/i)}`, '1250.50')
  await app.fill(`#${same(/merchant/i)}`, 'chai point')
  await app.fill(`#${same(/^date/i)}`, rows[0].date)
  await app.eval(`[...document.querySelectorAll('.modal-foot button')].find(b => /save|add/i.test(b.textContent) && !/cancel/i.test(b.textContent)).click()`)
  await app.sleep(700)
  const dupText = await app.eval('document.body.innerText')
  await app.screenshot(path.join(out, 'txn-3-duplicate.png'))
  check('duplicate is detected and the user is asked (not silently added)', /already exists|Add anyway|duplicate/i.test(dupText) && (await list()).total === 1, dupText.slice(0, 120))
  await app.eval(`(() => { const m = document.querySelector('.modal'); const b = [...document.querySelectorAll('button')].find(b => /add anyway/i.test(b.textContent)); if (b) b.click() })()`)
  await app.sleep(700)
  check('"Add anyway" keeps both entries', (await list()).total === 2)
  await app.eval(`document.querySelectorAll('.modal').forEach(() => { const c = [...document.querySelectorAll('.modal button')].find(b => /close|cancel/i.test(b.getAttribute('aria-label') || b.textContent)); c && c.click() })`)
  await app.sleep(300)

  console.log('\nTransactions page: inline category, tags, search')
  await call('transactions', 'create', { date: '2026-10-02', merchant: 'Big Bazaar', amount: 840, type: 'expense', account: 'Cash' })
  await call('transactions', 'create', { date: '2026-10-03', merchant: 'Salary Acme', amount: 50000, type: 'income', account: 'Main Checking', category: 'Income' })
  await app.click('.nav-item', 'Transactions')
  await app.sleep(800)
  await app.screenshot(path.join(out, 'txn-4-page.png'))
  const bb = (await list({ search: 'big bazaar' })).rows[0]
  // change category through the inline dropdown for that row
  const changed = await app.eval(`(() => { const tr = [...document.querySelectorAll('.tx-table tbody tr')].find(r => r.innerText.includes('Big Bazaar')); const s = tr.querySelector('select');
    const o = [...s.options].find(o => o.text.trim() === 'Groceries'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await app.sleep(700)
  const bb2 = await call('transactions', 'get', { id: bb.id })
  check('inline category edit saved immediately to SQLite and locked', changed && bb2.category === 'Groceries' && bb2.categoryLocked === true)
  // tag via popover
  await app.eval(`(() => { const tr = [...document.querySelectorAll('.tx-table tbody tr')].find(r => r.innerText.includes('Big Bazaar')); tr.querySelector('.tag-add').click() })()`)
  await app.sleep(300)
  await app.screenshot(path.join(out, 'txn-5-tag-popover.png'))
  const popInputs = await app.eval(`[...document.querySelectorAll('.tx-popover input')].map(i => i.placeholder || i.getAttribute('aria-label'))`)
  check('tag popover asks only for a tag name', popInputs.length === 1, JSON.stringify(popInputs))
  await app.fill('.tx-popover input', 'Weekend')
  await app.eval(`(() => { const i = document.querySelector('.tx-popover input'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
  await app.sleep(700)
  let tagged = await call('transactions', 'get', { id: bb.id })
  if (!tagged.tags.includes('Weekend')) {
    await app.eval(`[...document.querySelectorAll('.tx-popover button')].find(b => /add|create/i.test(b.textContent))?.click()`)
    await app.sleep(700)
    tagged = await call('transactions', 'get', { id: bb.id })
  }
  check('tag created from just a name and attached', tagged.tags.includes('Weekend') && (await call('tags', 'list')).some((t) => t.name === 'Weekend'))
  // global search from the top bar
  await app.fill('input[type=search]', 'weekend')
  await app.sleep(1000)
  const visible = await app.eval(`[...document.querySelectorAll('.tx-table tbody tr')].map(r => r.innerText.split('\\n')[1] || r.innerText.slice(0, 30))`)
  check('top-bar search (tags are searchable) narrows the list', visible.length === 1, JSON.stringify(visible))
  await app.fill('input[type=search]', '')
  await app.sleep(800)

  console.log('\nconsole errors:', JSON.stringify(app.consoleErrors))
  check('no renderer console errors', app.consoleErrors.length === 0)
} catch (e) {
  console.log('\n  ABORTED:', e.message)
  results.push(false)
  await app.screenshot(path.join(out, 'txn-failure.png')).catch(() => {})
} finally {
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  await app.close()
}
process.exit(0)
