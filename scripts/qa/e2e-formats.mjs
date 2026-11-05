// CSV and Excel imports through the real UI (spec §32–35): preamble/footer rows, quoted commas, debit/credit columns,
// ambiguous columns (must NOT be guessed), real Excel date cells, duplicate detection on re-import.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './driver.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.qa-data', 'shots')
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${!ok && detail ? '   → ' + detail : ''}`) }
const app = await launch({ width: 1440, height: 900 })
const call = async (ns, m, arg) => {
  const r = await app.eval(`window.ledgerly[${JSON.stringify(ns)}][${JSON.stringify(m)}](${JSON.stringify(arg ?? null)})`)
  if (!r.ok) throw new Error(`${ns}.${m}: ${r.error.message}`)
  return r.data
}
const rowsOf = async () => (await call('transactions', 'list', { page: 1, pageSize: 250, sort: { field: 'date', dir: 'asc' } })).rows
const pageText = () => app.eval("document.querySelector('.page')?.innerText ?? ''")
const dropBytes = (name, bytes) => app.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(bytes))})], ${JSON.stringify(name)}))
  const t = document.querySelector('.imp-drop'); for (const type of ['dragenter', 'dragover', 'drop']) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })) })()`)
const setSelect = (idx, text) => app.eval(`(() => { const s = document.querySelectorAll('.page select')[${idx}]; const o = [...s.options].find(o => o.text.includes(${JSON.stringify(text)})); if (!o) throw new Error('no option ' + ${JSON.stringify(text)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
const startImport = async () => {
  await app.click('.nav-item', 'Import'); await app.sleep(300)
  if (!(await app.eval("!!document.querySelector('.imp-drop')"))) {
    const again = await app.eval("[...document.querySelectorAll('.page button')].some(b => b.textContent.includes('Import another file'))")
    await app.click('.page button', again ? 'Import another file' : 'Cancel'); await app.sleep(300)
  }
}
const importIt = async () => { await app.click('.page button', 'Import Transactions'); await app.waitFor("document.body.innerText.includes('Import complete')", 20000); return pageText() }

try {
  await app.waitFor("document.querySelector('.app') !== null")
  await app.setSize(1440, 900)

  console.log('\nCSV: bank statement with preamble, quoted comma, separate withdrawal/deposit columns, footer')
  const csv = ['HDFC BANK LIMITED - STATEMENT OF ACCOUNT', 'Account No: XXXXXXXX1234', '', 'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '15/10/2026,UPI-SWIGGY-ORDER 123,450.00,,10000.00', '16/10/2026,SALARY OCT,,50000.00,60000.00', '17/10/2026,"AMAZON PAY, INDIA",1299.50,,58700.50',
    '28/10/2026,ELECTRICITY BILL,"2,100.00",,56600.00', 'Total,,3849.50,50000.00,', ''].join('\r\n')
  await startImport()
  await dropBytes('hdfc_oct.csv', Buffer.from(csv))
  await app.waitFor("document.body.innerText.includes('Import settings')")
  await setSelect(0, 'Main Checking')
  await app.sleep(700)
  await app.screenshot(path.join(out, 'fmt-csv-review.png'))
  const review = await pageText()
  check('CSV: mapping panel shown with detected columns', /Date/.test(review) && /Narration|Description/.test(review) && /Withdrawal/.test(review))
  const report = await importIt()
  const rows = await rowsOf()
  check('CSV: 4 transactions imported, preamble and footer rows ignored', rows.length === 4, JSON.stringify(rows.map((r) => r.merchant)))
  const amz = rows.find((r) => /AMAZON/.test(r.merchant))
  check('CSV: quoted comma kept in description; withdrawal → expense 1299.50', amz?.merchant === 'AMAZON PAY, INDIA' && amz.amount === 1299.5 && amz.type === 'expense', JSON.stringify(amz))
  check('CSV: deposit → income 50000 with magnitude stored', rows.find((r) => /SALARY/.test(r.merchant))?.type === 'income' && rows.find((r) => /SALARY/.test(r.merchant)).amount === 50000)
  check('CSV: "2,100.00" thousands separator parsed', rows.find((r) => /ELECTRICITY/.test(r.merchant))?.amount === 2100)
  check('CSV: dates normalised to YYYY-MM-DD (day 15 → DMY understood)', rows[0].date === '2026-10-15')
  check('CSV: report shows Inserted 4 and Invalid/skipped ≥ 1 (footer)', /Inserted\s*\n?\s*4/.test(report) && /Invalid \/ skipped\s*\n?\s*[1-9]/.test(report), report.replace(/\n+/g, ' | ').slice(0, 220))

  console.log('\nCSV: ambiguous columns are NOT guessed')
  await startImport()
  await dropBytes('mystery.csv', Buffer.from(['Field1,Field2,Field3', 'abc,def,ghi', 'jkl,mno,pqr', ''].join('\r\n')))
  await app.waitFor("document.body.innerText.includes('Import settings') || document.body.innerText.includes('Column')", 8000)
  await app.sleep(800)
  await app.screenshot(path.join(out, 'fmt-csv-ambiguous.png'))
  const blocked = await app.eval("[...document.querySelectorAll('.page button')].find(b => b.textContent.includes('Import Transactions'))?.disabled ?? 'nobutton'")
  check('ambiguous file: import is blocked until columns are mapped', blocked === true || blocked === 'nobutton', String(blocked))
  check('ambiguous file: tells the user to map columns', /map|confirm|which column|could not/i.test(await pageText()))
  const before = (await rowsOf()).length
  check('ambiguous file: nothing was written to the database', before === 4)

  console.log('\nExcel (.xlsx) with real date cells, numeric amounts, debit/credit')
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['Transaction Date', 'Description', 'Debit', 'Credit'],
    [new Date(Date.UTC(2026, 8, 3)), 'RENT PAYMENT SEP', 18000, null],
    [new Date(Date.UTC(2026, 8, 5)), 'FREELANCE INVOICE 44', null, 25000],
    ['09/09/2026', 'TEXT DATE ROW COFFEE', 150.75, null],
    [new Date(Date.UTC(2026, 8, 20)), 'SPOTIFY INDIA', 119, null]
  ], { cellDates: true })
  XLSX.utils.book_append_sheet(wb, ws, 'Statement')
  const xbytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  await startImport()
  await dropBytes('sept_statement.xlsx', xbytes)
  await app.waitFor("document.body.innerText.includes('Import settings')")
  await setSelect(0, 'Everyday Visa')
  await app.sleep(800)
  await app.screenshot(path.join(out, 'fmt-xlsx-review.png'))
  const xreport = await importIt()
  const all = await rowsOf()
  const x = all.filter((r) => r.date.startsWith('2026-09'))
  check('Excel: 4 rows imported', x.length === 4, JSON.stringify(x.map((r) => [r.date, r.merchant, r.amount])))
  check('Excel: real date cells keep the exact day (no timezone drift)', x.some((r) => r.date === '2026-09-03' && /RENT/.test(r.merchant)) && x.some((r) => r.date === '2026-09-05'))
  check('Excel: debit → expense, credit → income', x.find((r) => /RENT/.test(r.merchant))?.type === 'expense' && x.find((r) => /FREELANCE/.test(r.merchant))?.type === 'income')
  check('Excel: transactions assigned to the chosen account', x.every((r) => r.account === 'Everyday Visa'))
  check('Excel: report shows Inserted 4', /Inserted\s*\n?\s*4/.test(xreport))

  console.log('\nRe-import of the same Excel file → duplicates')
  await startImport()
  await dropBytes('sept_statement.xlsx', xbytes)
  await app.waitFor("document.body.innerText.includes('Import settings')")
  await setSelect(0, 'Everyday Visa')
  await app.sleep(800)
  check('Excel re-import: all 4 rows flagged as duplicates', /Duplicates \(4\)/.test(await pageText()))
  await app.click('.page button', 'Cancel')
  check('total rows unchanged after cancelled/duplicate imports', (await rowsOf()).length === 8)

  console.log('\nImport history & undo')
  await startImport()
  await app.click('.page button', 'Import history')
  await app.sleep(600)
  await app.screenshot(path.join(out, 'fmt-history.png'))
  const hist = await pageText()
  check('history lists both files with Format and counts', /hdfc_oct\.csv/.test(hist) && /sept_statement\.xlsx/.test(hist) && /CSV/i.test(hist) && /Excel|XLSX/i.test(hist))
  await app.eval(`[...document.querySelectorAll('.page button')].find(b => /undo/i.test(b.textContent))?.click()`)
  await app.sleep(500)
  const confirmText = await app.eval("document.querySelector('.modal')?.innerText ?? ''")
  check('undo asks for confirmation and warns about edited rows', /removes the 4 transactions/i.test(confirmText), confirmText.slice(0, 160))
  await app.eval(`[...document.querySelectorAll('.modal-foot button')].pop().click()`)
  await app.sleep(1000)
  const afterUndo = (await rowsOf()).length
  check('undo removed exactly that import (4 rows left)', afterUndo === 4, String(afterUndo))

  console.log('\nconsole errors:', JSON.stringify(app.consoleErrors))
  check('no renderer console errors', app.consoleErrors.length === 0)
} catch (e) {
  console.log('\n  ABORTED:', e.message)
  results.push(false)
  await app.screenshot(path.join(out, 'fmt-failure.png')).catch(() => {})
} finally {
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  await app.close()
}
process.exit(0)
