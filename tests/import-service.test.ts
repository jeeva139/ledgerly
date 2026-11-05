import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { count, freshDb } from './helpers'
import { clearHandlersForTests, callChannel, invokeChannel, registeredChannels } from '../electron/ipc/register'
import { API_METHODS } from '../shared/api'
import { registerImportIpc } from '../electron/ipc/imports'
import { clearSessionsForTests, sessionCountForTests } from '../electron/imports/service'
import { parseBytes } from '../electron/imports/engine'
import { ensureDataLayout, setDataDir } from '../electron/database/paths'
import { setDialogProvider } from '../electron/platform/dialogs'
import { setEventSink } from '../electron/platform/events'
import { K, setSetting } from '../electron/services/settings'
import { listCategories } from '../electron/services/catalog'
import type { Db } from '../electron/database/sqlite'
import type {
  ImportHistoryEntry, ImportOptions, ImportPreview, ImportReport, ImportSessionSummary, PreviewRowsPage
} from '../shared/api/imports'

let db: Db
let dataDir: string

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-import-'))
  setDataDir(dataDir)
  ensureDataLayout()
})
afterAll(() => {
  setDialogProvider(null)
  setEventSink(null)
  fs.rmSync(dataDir, { recursive: true, force: true })
})
beforeEach(() => {
  db = freshDb()
  clearHandlersForTests()
  clearSessionsForTests()
  registerImportIpc()
  setEventSink(null)
  setDialogProvider(null)
})

const enc = (s: string) => new TextEncoder().encode(s)
const open = (filename: string, content: string | Uint8Array) =>
  callChannel<ImportSessionSummary>('import.openBytes', { filename, bytes: typeof content === 'string' ? enc(content) : content })
const preview = (sessionId: string, options: ImportOptions) => callChannel<ImportPreview>('import.preview', { sessionId, options })
const commit = (sessionId: string, options: ImportOptions) => callChannel<ImportReport>('import.commit', { sessionId, options })
const rowsOf = (sessionId: string, filter: 'all' | 'new' | 'duplicate' | 'needs-review' | 'invalid' = 'all', page = 1, pageSize = 100) =>
  callChannel<PreviewRowsPage>('import.previewRows', { sessionId, filter, page, pageSize })

const ACCT: ImportOptions = { account: { name: 'Main Checking' } }

interface Rec { d: string; t: string; p?: string; m?: string; l?: string; n?: string }
const qif = (recs: Rec[], type = 'Bank') =>
  [`!Type:${type}`, ...recs.flatMap((r) => [`D${r.d}`, `T${r.t}`, ...(r.p ? [`P${r.p}`] : []), ...(r.m ? [`M${r.m}`] : []), ...(r.l ? [`L${r.l}`] : []), ...(r.n ? [`N${r.n}`] : []), '^'])].join('\r\n')

const insertRule = (whenText: string, thenText: string, priority = 0) =>
  db.run(
    "INSERT INTO rules (id, whenText, thenText, enabled, createdAt, updatedAt, priority, matchType, source) VALUES (?, ?, ?, 1, ?, ?, ?, 'contains', 'manual')",
    `r-${whenText}`, whenText, thenText, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', priority
  )

const BASIC: Rec[] = [
  { d: '13/10/2026', t: '-180.00', p: 'SWIGGY', m: 'Order 12345' },
  { d: '14/10/2026', t: '85,000.00', p: 'ACME CORP', m: 'Salary October', l: 'Income' },
  { d: '15/10/2026', t: '-90.00', p: 'DOSA CORNER', l: 'Food' },
  { d: '16/10/2026', t: '-55.00', p: 'MYSTERY SHOP' },
  { d: '99/99/2026', t: '-1.00', p: 'BAD DATE' }
]

describe('IPC contract', () => {
  it('registers a handler for every method in the shared import API', () => {
    const have = new Set(registeredChannels())
    const missing = API_METHODS.import.map((m) => `import.${m}`).filter((c) => !have.has(c))
    expect(missing).toEqual([])
    expect([...API_METHODS.import].sort()).toEqual(['cancel', 'commit', 'csv', 'excel', 'history', 'openBytes', 'preview', 'previewRows', 'qif', 'undo'])
  })
})

describe('§116 acceptance: QIF → preview → duplicates → import → rules → transactions', () => {
  it('runs the whole workflow and writes nothing before confirmation', async () => {
    insertRule('swiggy', 'Dining')
    const summary = await open('bank_statement.qif', qif(BASIC))
    expect(summary).toMatchObject({ format: 'qif', filename: 'bank_statement.qif' })
    expect(summary.qif?.accountType).toBe('Bank')
    expect(count(db, 'transactions')).toBe(0)

    const p = await preview(summary.sessionId, ACCT)
    expect(p).toMatchObject({
      detected: 5, valid: 4, incomeCount: 1, incomeTotal: 85000, expenseCount: 3, expenseTotal: 325, duplicates: 0,
      newCount: 4, needsReview: 1, invalid: 1, dateOrder: 'DMY', dateAmbiguous: false, canImport: true
    })
    expect(p.newCategories).toEqual(['Food'])
    expect(count(db, 'transactions')).toBe(0) // preview never writes

    const all = await rowsOf(summary.sessionId)
    expect(all.total).toBe(5)
    const swiggy = all.rows.find((r) => r.merchant === 'SWIGGY')!
    expect(swiggy).toMatchObject({ date: '2026-10-13', amount: 180, type: 'expense', category: 'Dining', categorySource: 'rule', memo: 'Order 12345' })
    expect(all.rows.find((r) => r.merchant === 'ACME CORP')).toMatchObject({ category: 'Income', categorySource: 'file', type: 'income' })
    expect(all.rows.find((r) => r.merchant === 'MYSTERY SHOP')).toMatchObject({ category: 'Needs review', needsReview: true })
    expect(all.rows.find((r) => r.merchant === 'BAD DATE')).toMatchObject({ status: 'invalid', issue: 'Date could not be read', date: null })
    expect((await rowsOf(summary.sessionId, 'invalid')).total).toBe(1)
    expect((await rowsOf(summary.sessionId, 'needs-review')).total).toBe(1)

    const report = await commit(summary.sessionId, ACCT)
    expect(report).toMatchObject({ inserted: 4, duplicates: 0, needsReview: 1, skipped: 1, status: 'complete', documentKept: true })
    expect(report.addedCategories).toEqual(['Food'])
    expect(listCategories()).toContain('Food')

    const txns = db.all<Record<string, unknown>>('SELECT * FROM transactions ORDER BY date')
    expect(txns).toHaveLength(4)
    expect(txns.every((t) => t.importId === report.importId && t.source === 'qif' && t.account === 'Main Checking' && (t.amount as number) > 0)).toBe(true)
    expect(txns.map((t) => t.type)).toEqual(['expense', 'income', 'expense', 'expense'])
    expect(txns[0]).toMatchObject({ merchant: 'SWIGGY', memo: 'Order 12345', category: 'Dining', categoryLocked: 0 })
    // the original file is kept in the vault as an "import" document
    expect(db.get<{ source: string; kind: string }>('SELECT source, kind FROM documents')).toMatchObject({ source: 'import', kind: 'statement' })
    expect(sessionCountForTests()).toBe(0)

    // dashboard-relevant numbers are queryable straight away
    expect(db.get<{ s: number }>("SELECT SUM(amount) AS s FROM transactions WHERE type='income'")!.s).toBe(85000)

    // importing the same file again: everything is a duplicate, nothing is inserted
    const again = await open('bank_statement.qif', qif(BASIC))
    const p2 = await preview(again.sessionId, ACCT)
    expect(p2).toMatchObject({ duplicates: 4, newCount: 0, invalid: 1, canImport: false })
    expect(p2.blockers[0]).toMatch(/nothing new/i)
    await expect(commit(again.sessionId, ACCT)).rejects.toThrow(/nothing new/i)
    expect(count(db, 'transactions')).toBe(4)
    expect((await rowsOf(again.sessionId, 'duplicate')).rows[0].issue).toBe('Already in Ledgerly')
  })

  it('records the import in history and the history can be undone (only that import is removed)', async () => {
    db.run("INSERT INTO transactions (id,date,merchant,category,amount,type,account,tags,receipt,source,fingerprint,createdAt,updatedAt) VALUES ('keep','2026-01-01','Manual row','Other',5,'expense','Cash','[]',0,'manual','k','t','t')")
    const s = await open('a.qif', qif(BASIC))
    const report = await commit(s.sessionId, ACCT)
    db.run("UPDATE transactions SET updatedAt = '2999-01-01T00:00:00Z' WHERE merchant = 'SWIGGY'")

    const history = await callChannel<ImportHistoryEntry[]>('import.history')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: report.importId, filename: 'a.qif', format: 'qif', account: 'Main Checking', inserted: 4, duplicates: 0, skipped: 1, needsReview: 2, status: 'complete', remaining: 4, edited: 1 })
    expect(history[0].documentId).toBeTruthy()

    expect(await callChannel('import.undo', { importId: report.importId })).toEqual({ removed: 4 })
    expect(count(db, 'transactions')).toBe(1)
    expect(db.get('SELECT 1 AS x FROM transactions WHERE id = ?', 'keep')).toBeTruthy()
    const after = await callChannel<ImportHistoryEntry[]>('import.history')
    expect(after[0]).toMatchObject({ status: 'undone', remaining: 0 })
    expect(after[0].undoneAt).toBeTruthy()
    await expect(callChannel('import.undo', { importId: report.importId })).rejects.toThrow(/already been undone/)
    await expect(callChannel('import.undo', { importId: 'nope' })).rejects.toThrow(/could not be found/)
  })
})

describe('rule application order', () => {
  it('keeps the category from the file by default; rules fill the gaps; Needs review is the fallback', async () => {
    insertRule('dosa', 'Dining')
    insertRule('mystery', 'Shopping')
    const s = await open('r.qif', qif(BASIC))
    await preview(s.sessionId, ACCT)
    const rows = (await rowsOf(s.sessionId)).rows
    expect(rows.find((r) => r.merchant === 'DOSA CORNER')).toMatchObject({ category: 'Food', categorySource: 'file' })
    expect(rows.find((r) => r.merchant === 'MYSTERY SHOP')).toMatchObject({ category: 'Shopping', categorySource: 'rule' })
  })

  it('lets rules replace file categories only when the user chooses to', async () => {
    insertRule('dosa', 'Dining')
    const s = await open('r.qif', qif(BASIC))
    await preview(s.sessionId, { ...ACCT, rulesOverrideImported: true })
    expect((await rowsOf(s.sessionId)).rows.find((r) => r.merchant === 'DOSA CORNER')).toMatchObject({ category: 'Dining', categorySource: 'rule' })
  })

  it('uses rule priority and ignores disabled rules', async () => {
    insertRule('shop', 'Shopping', 5)
    insertRule('mystery', 'Gifts', 1)
    db.run("INSERT INTO rules (id, whenText, thenText, enabled, createdAt, updatedAt, priority) VALUES ('off','mystery shop','Disabled',0,'t','t',0)")
    const s = await open('r.qif', qif(BASIC))
    await preview(s.sessionId, ACCT)
    expect((await rowsOf(s.sessionId)).rows.find((r) => r.merchant === 'MYSTERY SHOP')?.category).toBe('Gifts')
  })

  it('finds keywords inside long UPI narrations and marks transfers without applying rules', async () => {
    insertRule('lunch', 'Food')
    const upi = 'UPI-MR A MANIKANDAN-9578379800-2@YBL-CIUB0000476-621367896104-LUNCHUPI-JEEVAJEEVA534571OKAX-JEEVAJEEVA53457-1@OKAXIS-YESB0001350-657900506223-TEA'
    const s = await open('u.qif', qif([{ d: '13/10/2026', t: '-20', p: upi }, { d: '14/10/2026', t: '-500', p: 'To savings lunch', l: '[Savings]' }]))
    const p = await preview(s.sessionId, ACCT)
    expect(p.transferCount).toBe(1)
    expect(p.expenseCount).toBe(1) // transfers never count as spending
    const rows = (await rowsOf(s.sessionId)).rows
    expect(rows[0]).toMatchObject({ category: 'Food', categorySource: 'rule' })
    expect(rows[1]).toMatchObject({ isTransfer: true, category: 'Transfer', categorySource: 'transfer' })
    await commit(s.sessionId, ACCT)
    expect(db.get<{ isTransfer: number }>("SELECT isTransfer FROM transactions WHERE merchant LIKE 'To savings%'")!.isTransfer).toBe(1)
  })
})

describe('dates and sign convention', () => {
  const ambiguous = qif([{ d: '01/02/2026', t: '-5', p: 'A' }, { d: '03/04/2026', t: '-6', p: 'B' }])

  it('asks the user when day/month order cannot be determined, and honours the choice', async () => {
    const s = await open('amb.qif', ambiguous)
    const p = await preview(s.sessionId, ACCT)
    expect(p).toMatchObject({ dateAmbiguous: true, canImport: false })
    expect(p.blockers.join(' ')).toMatch(/date format/i)
    expect((await preview(s.sessionId, { ...ACCT, dateFormat: 'MDY' })).canImport).toBe(true)
    expect((await rowsOf(s.sessionId)).rows[0].date).toBe('2026-01-02')
    expect((await preview(s.sessionId, { ...ACCT, dateFormat: 'DMY' })).dateAmbiguous).toBe(false)
    expect((await rowsOf(s.sessionId)).rows[0].date).toBe('2026-02-01')
  })

  it('reads apostrophe years and DD/MM when a day is above 12', async () => {
    const s = await open('apos.qif', qif([{ d: "13/ 5'06", t: '-5', p: 'A' }, { d: "1/ 6'06", t: '-6', p: 'B' }]))
    await preview(s.sessionId, ACCT)
    expect((await rowsOf(s.sessionId)).rows.map((r) => r.date)).toEqual(['2006-05-13', '2006-06-01'])
  })

  it('suggests Reverse for a credit-card file with positive charges and applies it on request', async () => {
    const recs = Array.from({ length: 6 }, (_, i) => ({ d: `${20 + i}/10/2026`, t: `${(i + 1) * 100}.00`, p: `SHOP ${i}` }))
    const s = await open('card.qif', qif(recs, 'CCard'))
    const p = await preview(s.sessionId, ACCT)
    expect(p.signHint).toMatch(/credit-card/)
    expect(p).toMatchObject({ incomeCount: 6, expenseCount: 0 })
    const rev = await preview(s.sessionId, { ...ACCT, signConvention: 'reverse' })
    expect(rev).toMatchObject({ incomeCount: 0, expenseCount: 6, expenseTotal: 2100, signHint: null })
  })
})

describe('account selection', () => {
  it('requires an account, and creates a new one only when the import is confirmed', async () => {
    const s = await open('x.qif', qif(BASIC))
    const p = await preview(s.sessionId, {})
    expect(p.canImport).toBe(false)
    expect(p.blockers.join(' ')).toMatch(/account/i)
    const opts: ImportOptions = { account: { name: 'HDFC Savings', type: 'bank' } }
    const p2 = await preview(s.sessionId, opts)
    expect(p2.account).toEqual({ name: 'HDFC Savings', exists: false })
    expect(await callChannel<{ name: string }[]>('accounts.list').catch(() => [])).toEqual(expect.anything())
    const before = db.scalar<string>("SELECT value FROM settings WHERE key = 'accounts'")!
    expect(before).not.toContain('HDFC Savings')
    const r = await commit(s.sessionId, opts)
    expect(r.createdAccounts).toEqual(['HDFC Savings'])
    expect(db.scalar<string>("SELECT value FROM settings WHERE key = 'accounts'")).toContain('HDFC Savings')
    expect(db.scalar<string>('SELECT DISTINCT account FROM transactions')).toBe('HDFC Savings')
  })
})

describe('CSV', () => {
  const stmt = [
    'HDFC BANK Ltd.,,,,,,', 'Account Statement,,,,,,', '',
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '01/10/26,UPI-SWIGGY-9812345678,0000123,01/10/26,"1,250.00",,"48,750.00"',
    '02/10/26,SALARY ACME,0000124,02/10/26,,"85,000.00","1,33,750.00"',
    '13/10/26,UPI-LUNCH,0000125,13/10/26,180.00,,"1,33,570.00"',
    ',Total,,,"1,430.00","85,000.00",'
  ].join('\n')

  it('imports a bank CSV with preamble, debit/credit columns and a footer', async () => {
    const s = await open('hdfc.csv', stmt)
    expect(s.table).toMatchObject({ headerRow: 3, dataRowCount: 4 })
    expect(s.table!.mapping).toMatchObject({ date: 0, description: 1, debit: 4, credit: 5 })
    expect(s.table!.uncertain).toEqual({})
    const p = await preview(s.sessionId, ACCT)
    expect(p).toMatchObject({ detected: 4, valid: 3, incomeCount: 1, expenseCount: 2, expenseTotal: 1430, invalid: 1, dateOrder: 'DMY', canImport: true })
    const r = await commit(s.sessionId, ACCT)
    expect(r).toMatchObject({ inserted: 3, skipped: 1 })
    expect(db.get<{ reference: string; source: string }>("SELECT reference, source FROM transactions WHERE merchant LIKE 'SALARY%'")).toEqual({ reference: '0000124', source: 'csv' })
  })

  it('blocks until an ambiguous mapping is confirmed — nothing is guessed silently', async () => {
    const csv = 'Date,Transaction Date,Description,Amount\n01/10/2026,02/10/2026,Shop,-5\n13/10/2026,14/10/2026,Cafe,-7'
    const s = await open('two.csv', csv)
    expect(s.table!.uncertain.date).toMatch(/Several columns/)
    const p = await preview(s.sessionId, ACCT)
    expect(p).toMatchObject({ canImport: false })
    expect(p.blockers.join(' ')).toMatch(/confirm/i)
    const confirmed = await preview(s.sessionId, { ...ACCT, mapping: { ...s.table!.mapping, date: 1 } })
    expect(confirmed.canImport).toBe(true)
    expect((await rowsOf(s.sessionId)).rows[0].date).toBe('2026-10-02')
  })

  it('reports exactly what is missing when the columns cannot be identified', async () => {
    const s = await open('weird.csv', 'Foo,Bar\nx,y\nz,w')
    const p = await preview(s.sessionId, ACCT)
    expect(p.canImport).toBe(false)
    expect(p.blockers.join(' ')).toMatch(/date/i)
    expect(p.detected).toBe(0)
    // the user maps the columns by hand
    const s2 = await open('manual.csv', 'When,What,How much\n2026-10-01,Tea,-20\n2026-10-02,Pay,500')
    const p2 = await preview(s2.sessionId, { ...ACCT, mapping: { date: 0, description: 1, amount: 2 } })
    expect(p2).toMatchObject({ canImport: true, valid: 2 })
  })

  it('handles a CSV with an Account column by creating the accounts it names', async () => {
    const csv = 'Date,Description,Amount,Account\n2026-10-01,Tea,-20,Wallet One\n2026-10-02,Pay,500,Main Checking\n2026-10-03,Snack,-5,'
    const s = await open('acct.csv', csv)
    const p = await preview(s.sessionId, {})
    expect(p.newAccounts).toEqual(['Wallet One'])
    expect(p.canImport).toBe(true) // account comes from the file
    const r = await commit(s.sessionId, {})
    expect(r.createdAccounts).toEqual(['Wallet One'])
    expect(db.all<{ account: string }>('SELECT account FROM transactions ORDER BY date').map((t) => t.account)).toEqual(['Wallet One', 'Main Checking', 'Imported account'])
  })

  it('re-importing a CSV skips every row that is already there', async () => {
    const first = await open('s.csv', stmt)
    await commit(first.sessionId, ACCT)
    const again = await open('s.csv', stmt)
    expect(await preview(again.sessionId, ACCT)).toMatchObject({ duplicates: 3, newCount: 0, canImport: false })
    expect(count(db, 'transactions')).toBe(3)
  })
})

describe('Excel', () => {
  const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000
  const book = (): Uint8Array => {
    const ws: XLSX.WorkSheet = {
      A1: { t: 's', v: 'Txn Date' }, B1: { t: 's', v: 'Description' }, C1: { t: 's', v: 'Amount' },
      A2: { t: 'n', v: serial(2026, 10, 12), z: 'dd/mm/yyyy' }, B2: { t: 's', v: 'UPI-TEA STALL' }, C2: { t: 'n', v: -20 },
      A3: { t: 'n', v: serial(2026, 3, 1), z: 'dd/mm/yyyy' }, B3: { t: 's', v: 'SALARY' }, C3: { t: 'n', v: 50000.5 },
      A4: { t: 's', v: '15/10/2026' }, B4: { t: 's', v: 'TEXT DATE ROW' }, C4: { t: 's', v: '1,234.50' },
      '!ref': 'A1:C4'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Statement')
    XLSX.utils.book_append_sheet(wb, { A1: { t: 's', v: 'Notes' }, '!ref': 'A1:A1' }, 'Notes')
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
  }

  it('maps columns, reads date cells exactly and text dates/amounts, and dedupes on re-import', async () => {
    const s = await open('stmt.xlsx', book())
    expect(s.format).toBe('excel')
    expect(s.table).toMatchObject({ sheets: ['Statement', 'Notes'], sheet: 'Statement', headerRow: 1 })
    expect(s.table!.mapping).toMatchObject({ date: 0, description: 1, amount: 2 })
    const p = await preview(s.sessionId, ACCT)
    expect(p).toMatchObject({ valid: 3, incomeCount: 2, expenseCount: 1, canImport: true })
    const rows = (await rowsOf(s.sessionId)).rows
    expect(rows.map((r) => r.date)).toEqual(['2026-10-12', '2026-03-01', '2026-10-15'])
    expect(rows[2]).toMatchObject({ amount: 1234.5, type: 'income' })
    const r = await commit(s.sessionId, ACCT)
    expect(r).toMatchObject({ inserted: 3, documentKept: true })
    expect(db.get<{ kind: string }>('SELECT kind FROM documents')!.kind).toBe('spreadsheet')

    const again = await open('stmt.xlsx', book())
    expect(await preview(again.sessionId, ACCT)).toMatchObject({ duplicates: 3, newCount: 0 })
  })

  it('switching sheets re-reads that sheet', async () => {
    const s = await open('stmt.xlsx', book())
    const p = await preview(s.sessionId, { ...ACCT, sheet: 'Notes' })
    expect(p.table?.sheet).toBe('Notes')
    expect(p.detected).toBe(0)
  })
})

describe('duplicates inside one file', () => {
  const twice = qif([{ d: '20/10/2026', t: '-20', p: 'CHAI POINT' }, { d: '20/10/2026', t: '-20', p: 'CHAI POINT' }, { d: '21/10/2026', t: '-5', p: 'OTHER' }])

  it('keeps genuine repeats as separate transactions, and re-imports still dedupe', async () => {
    const s = await open('t.qif', twice)
    const p = await preview(s.sessionId, ACCT)
    expect(p).toMatchObject({ newCount: 3, repeatedInFile: 1, duplicates: 0 })
    expect((await rowsOf(s.sessionId)).rows[1].issue).toMatch(/Identical to an earlier row/)
    expect((await commit(s.sessionId, ACCT)).inserted).toBe(3)
    const again = await open('t.qif', twice)
    expect(await preview(again.sessionId, ACCT)).toMatchObject({ duplicates: 3, newCount: 0 })
  })

  it('a file with one occurrence against two stored rows only matches the first', async () => {
    const s = await open('t.qif', twice)
    await commit(s.sessionId, ACCT)
    const one = await open('one.qif', qif([{ d: '20/10/2026', t: '-20', p: 'CHAI POINT' }]))
    expect(await preview(one.sessionId, ACCT)).toMatchObject({ duplicates: 1, newCount: 0 })
    const three = await open('three.qif', qif(Array.from({ length: 3 }, () => ({ d: '20/10/2026', t: '-20', p: 'CHAI POINT' }))))
    expect(await preview(three.sessionId, ACCT)).toMatchObject({ duplicates: 2, newCount: 1 })
  })

  it('treats in-file repeats as duplicates when the preference says so', async () => {
    setSetting(K.importPreferences, { keepRepeatedRows: false, rulesOverrideImported: false, addNewCategories: true })
    const s = await open('t.qif', twice)
    const p = await preview(s.sessionId, ACCT)
    expect(p).toMatchObject({ newCount: 2, duplicates: 1 })
    expect((await rowsOf(s.sessionId, 'duplicate')).rows[0].issue).toBe('Repeated earlier in this file')
  })

  it('the database constraint is the final guard: a row inserted after the preview is counted as a duplicate', async () => {
    const s = await open('t.qif', qif([{ d: '20/10/2026', t: '-20', p: 'RACE' }, { d: '21/10/2026', t: '-5', p: 'NEW' }]))
    await preview(s.sessionId, ACCT)
    db.run(
      "INSERT INTO transactions (id,date,merchant,category,amount,type,account,tags,receipt,source,fingerprint,createdAt,updatedAt) VALUES ('race','2026-10-20','RACE','x',20,'expense','Main Checking','[]',0,'manual','2026-10-20|race|20.00|main checking','t','t')"
    )
    const r = await commit(s.sessionId, ACCT)
    expect(r).toMatchObject({ inserted: 1, duplicates: 1 })
  })
})

describe('commit safety (spec §99)', () => {
  const addBomb = () =>
    db.exec("CREATE TRIGGER bomb BEFORE INSERT ON transactions WHEN NEW.merchant = 'BOOM' BEGIN SELECT RAISE(ABORT, 'boom'); END")

  it('a small import is atomic: one failing row saves nothing and leaves no history entry', async () => {
    addBomb()
    const s = await open('b.qif', qif([{ d: '20/10/2026', t: '-1', p: 'FINE' }, { d: '21/10/2026', t: '-2', p: 'BOOM' }]))
    await preview(s.sessionId, ACCT)
    await expect(commit(s.sessionId, ACCT)).rejects.toThrow(/existing data is safe/)
    expect(count(db, 'transactions')).toBe(0)
    expect(count(db, 'import_history')).toBe(0)
  })

  it('a large import keeps completed batches and reports a partial result', async () => {
    const recs: Rec[] = Array.from({ length: 21_000 }, (_, i) => ({ d: '20/10/2026', t: `-${i + 1}`, p: i === 20_500 ? 'BOOM' : `MERCHANT ${i}` }))
    const s = await open('big.qif', qif(recs))
    await preview(s.sessionId, ACCT)
    addBomb()
    const r = await commit(s.sessionId, ACCT)
    expect(r.status).toBe('partial')
    expect(r.inserted).toBe(20_000)
    expect(r.notes.join(' ')).toMatch(/stopped early/)
    expect(count(db, 'transactions')).toBe(20_000)
    expect((await callChannel<ImportHistoryEntry[]>('import.history'))[0]).toMatchObject({ status: 'partial', inserted: 20_000 })
    // the partial import can be undone
    await callChannel('import.undo', { importId: r.importId })
    expect(count(db, 'transactions')).toBe(0)
  }, 60_000)

  it('emits progress events while importing', async () => {
    const events: { phase: string; done: number; total: number }[] = []
    setEventSink((channel, payload) => {
      if (channel === 'import:progress') events.push(payload as never)
    })
    const s = await open('p.qif', qif(BASIC))
    await commit(s.sessionId, ACCT)
    expect(events.some((e) => e.phase === 'parsing')).toBe(true)
    expect(events.filter((e) => e.phase === 'importing').pop()).toMatchObject({ done: 4, total: 4 })
    expect(events.pop()?.phase).toBe('done')
  })

  it('still imports the data when the original file cannot be kept in the vault', async () => {
    const s = await open('big.csv', 'Date,Description,Amount\n2026-10-01,Tea,-20\n' + ' '.repeat(21 * 1024 * 1024))
    const r = await commit(s.sessionId, ACCT)
    expect(r).toMatchObject({ inserted: 1, documentKept: false })
    expect(r.notes.join(' ')).toMatch(/20 MB/)
  })
})

describe('sessions, dialogs and validation', () => {
  it('cancelling discards the session; unknown sessions give a friendly error', async () => {
    const s = await open('x.qif', qif(BASIC))
    await callChannel('import.cancel', { sessionId: s.sessionId })
    await expect(preview(s.sessionId, ACCT)).rejects.toThrow(/no longer open/)
    expect(count(db, 'transactions')).toBe(0)
  })

  it('rejects unsupported, empty and invalid input', async () => {
    await expect(open('notes.docx', 'x')).rejects.toThrow(/\.qif, \.csv, \.xlsx/)
    await expect(open('a.qif', '')).rejects.toThrow(/empty/)
    await expect(open('x.xlsx', 'definitely not a workbook')).rejects.toThrow(/valid Excel file/)
    await expect(open('x.qif', 'hello')).rejects.toThrow() // no transactions recognised
    expect(await invokeChannel('import.preview', { sessionId: 'x', options: { dateFormat: 'bogus' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('import.previewRows', { sessionId: 'x', filter: 'all', page: 0, pageSize: 10 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(() => parseBytes('qif', { byteLength: 300 * 1024 * 1024 } as Uint8Array)).toThrow(/200 MB/)
  })

  it('opens files through the native dialog, and cancelling returns null', async () => {
    const file = path.join(dataDir, 'statement.qif')
    fs.writeFileSync(file, qif(BASIC))
    let calls = 0
    setDialogProvider({
      openFile: async (opts) => {
        calls++
        expect(opts.filters?.[0].extensions).toEqual(['qif'])
        return calls === 1 ? [file] : null
      },
      saveFile: async () => null,
      openPath: async () => '',
      openFolder: async () => ''
    })
    const s = await callChannel<ImportSessionSummary>('import.qif')
    expect(s).toMatchObject({ filename: 'statement.qif', format: 'qif' })
    expect(JSON.stringify(s)).not.toContain(dataDir) // the renderer never sees a path
    expect(await callChannel('import.qif')).toBeNull()
  })

  it('pages the preview and filters by status', async () => {
    const s = await open('p.qif', qif(Array.from({ length: 25 }, (_, i) => ({ d: '20/10/2026', t: `-${i + 1}`, p: `SHOP ${i}` }))))
    await preview(s.sessionId, ACCT)
    const page2 = await rowsOf(s.sessionId, 'all', 2, 10)
    expect(page2).toMatchObject({ total: 25, page: 2, pageSize: 10 })
    expect(page2.rows[0].seq).toBe(11)
    expect((await rowsOf(s.sessionId, 'new', 9, 10)).page).toBe(3) // clamps to the last page
    expect((await rowsOf(s.sessionId, 'duplicate')).total).toBe(0)
  })
})

describe('performance: 75,000 rows', () => {
  it('parses, previews and commits a 75,000-transaction QIF in a few seconds', async () => {
    const recs: Rec[] = Array.from({ length: 75_000 }, (_, i) => ({
      d: `${String((i % 28) + 1).padStart(2, '0')}/${String((i % 12) + 1).padStart(2, '0')}/${2024 + (i % 3)}`,
      t: i % 9 === 0 ? `${(i % 500) + 100}.00` : `-${(i % 700) + 1}.${String(i % 100).padStart(2, '0')}`,
      p: `MERCHANT ${i}`,
      m: `Narration ${i}`
    }))
    insertRule('merchant 1', 'Other')
    const text = qif(recs)
    const batchStamps: number[] = []
    setEventSink((channel, payload) => {
      const e = payload as { phase: string }
      if (channel === 'import:progress' && e.phase === 'importing') batchStamps.push(Date.now())
    })
    const t0 = Date.now()
    const s = await open('huge.qif', text)
    const t1 = Date.now()
    const p = await preview(s.sessionId, ACCT)
    const t2 = Date.now()
    expect(p).toMatchObject({ detected: 75_000, valid: 75_000, newCount: 75_000, invalid: 0, canImport: true })
    const r = await commit(s.sessionId, ACCT)
    const t3 = Date.now()
    expect(r.inserted).toBe(75_000)
    expect(count(db, 'transactions')).toBe(75_000)
    const perBatch = batchStamps.slice(1).map((t, i) => t - batchStamps[i])
    console.log(
      `75k rows → parse ${t1 - t0} ms · preview ${t2 - t1} ms · commit ${t3 - t2} ms · ` +
        `${perBatch.length} batches of 5,000: first ${perBatch[0]} ms, last ${perBatch[perBatch.length - 1]} ms, max ${Math.max(...perBatch)} ms`
    )
    expect(t3 - t0).toBeLessThan(40_000)

    // re-import: 75k duplicates detected without inserting anything
    const again = await open('huge.qif', text)
    const p2 = await preview(again.sessionId, ACCT)
    expect(p2).toMatchObject({ duplicates: 75_000, newCount: 0 })
    expect(count(db, 'transactions')).toBe(75_000)
  }, 120_000)

  it('stays fast with realistic data: 75,000 long random UPI-style narrations, random amounts and dates', async () => {
    // deterministic pseudo-random data so the B-tree indexes (merchant, fingerprint, date) see scattered keys
    let seed = 123456789
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
    const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('').toUpperCase()
    const names = ['MR A MANIKANDAN', 'JEEVA KUMAR', 'SWIGGY LTD', 'AMAZON PAY', 'DOSA CORNER', 'ZOMATO', 'BIG BAZAAR', 'IRCTC', 'RAJAN STORES', 'MEDPLUS']
    const recs: Rec[] = Array.from({ length: 75_000 }, () => ({
      d: `${String(13 + Math.floor(rnd() * 16)).padStart(2, '0')}/${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}/${2022 + Math.floor(rnd() * 4)}`,
      t: `${rnd() < 0.15 ? '' : '-'}${(rnd() * 5000 + 1).toFixed(2)}`,
      p: `UPI-${names[Math.floor(rnd() * names.length)]}-${Math.floor(rnd() * 9e9 + 1e9)}-${hex(6)}@YBL-CIUB0000${Math.floor(rnd() * 999)}-${Math.floor(rnd() * 9e11 + 1e11)}-${hex(12)}-${hex(8)}`,
      m: `Ref ${hex(10)}`
    }))
    const stamps: number[] = []
    setEventSink((channel, payload) => {
      const e = payload as { phase: string }
      if (channel === 'import:progress' && e.phase === 'importing') stamps.push(Date.now())
    })
    const text = qif(recs)
    const t0 = Date.now()
    const s = await open('random.qif', text)
    const t1 = Date.now()
    const p = await preview(s.sessionId, { ...ACCT, dateFormat: 'DMY' })
    const t2 = Date.now()
    expect(p.newCount).toBeGreaterThan(74_000) // a handful of random collisions are legitimate repeats/duplicates
    const r = await commit(s.sessionId, { ...ACCT, dateFormat: 'DMY' })
    const t3 = Date.now()
    expect(r.inserted + r.duplicates).toBe(p.newCount + p.duplicates)
    expect(count(db, 'transactions')).toBe(r.inserted)
    const perBatch = stamps.slice(1).map((t, i) => t - stamps[i])
    console.log(
      `75k random narrations → parse ${t1 - t0} ms · preview ${t2 - t1} ms · commit ${t3 - t2} ms · ` +
        `batches: first ${perBatch[0]} ms, last ${perBatch[perBatch.length - 1]} ms, max ${Math.max(...perBatch)} ms`
    )
    expect(t3 - t0).toBeLessThan(40_000)
  }, 120_000)
})
