import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { indicatorType, parseAmount } from '../electron/imports/common/amount'
import { detectDateOrder, parseDate, parseDateParts, resolveDate } from '../electron/imports/common/dates'
import { decodeText } from '../electron/imports/common/decode'
import { parseQif } from '../electron/imports/qif/parseQif'
import { parseCsv } from '../electron/imports/csv/parseCsv'
import { parseExcel } from '../electron/imports/excel/parseExcel'
import { detectHeaderRow, detectMapping, layoutTable, mappingBlockers, resolveMapping } from '../electron/imports/table'
import { normalizeQifRecord, normalizeTableRow } from '../electron/imports/normalize'
import { parseBytes } from '../electron/imports/engine'
import type { ColumnMapping } from '../shared/api/imports'

const enc = (s: string) => new TextEncoder().encode(s)
const ctx = { order: 'DMY' as const, reverse: false }

describe('parseAmount', () => {
  it('handles separators, symbols and signs', () => {
    expect(parseAmount('1,234.56')?.value).toBe(1234.56)
    expect(parseAmount('₹ 1,23,456.78')?.value).toBe(123456.78)
    expect(parseAmount('$-12.50')?.value).toBe(-12.5)
    expect(parseAmount('(1,234.50)')?.value).toBe(-1234.5)
    expect(parseAmount('123.45-')?.value).toBe(-123.45)
    expect(parseAmount('−45')?.value).toBe(-45)
    expect(parseAmount('Rs. 2,500')?.value).toBe(2500)
    expect(parseAmount('1,234')?.value).toBe(1234)
    expect(parseAmount('12,50')?.value).toBe(12.5)
    expect(parseAmount('1.234,56')?.value).toBe(1234.56)
    expect(parseAmount('1.234.567')?.value).toBe(1234567)
    expect(parseAmount(42.5)?.value).toBe(42.5)
  })
  it('reads Dr/Cr markers', () => {
    expect(parseAmount('1,200.00 Dr')).toEqual({ value: 1200, indicator: 'dr' })
    expect(parseAmount('500.00Cr')).toEqual({ value: 500, indicator: 'cr' })
    expect(parseAmount('Cr 750')).toEqual({ value: 750, indicator: 'cr' })
    expect(indicatorType('DR')).toBe('expense')
    expect(indicatorType('Credit')).toBe('income')
    expect(indicatorType('transfer')).toBeNull()
  })
  it('rejects non-numbers', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount(Number.NaN)).toBeNull()
  })
})

describe('dates', () => {
  it('reads common formats', () => {
    expect(parseDate('12/10/2026', 'DMY')).toBe('2026-10-12')
    expect(parseDate('12/10/2026', 'MDY')).toBe('2026-12-10')
    expect(parseDate("1/ 5'06", 'MDY')).toBe('2006-01-05')
    expect(parseDate('12.10.26', 'DMY')).toBe('2026-10-12')
    expect(parseDate('2026-10-12', 'DMY')).toBe('2026-10-12')
    expect(parseDate('2026/10/12 14:33:00', 'DMY')).toBe('2026-10-12')
    expect(parseDate('20261012', 'DMY')).toBe('2026-10-12')
    expect(parseDate('12-Oct-26', 'MDY')).toBe('2026-10-12')
    expect(parseDate('12 October 2026', 'MDY')).toBe('2026-10-12')
    expect(parseDate('Oct 12, 2026', 'DMY')).toBe('2026-10-12')
    expect(parseDate('12/10/99', 'DMY')).toBe('1999-10-12')
  })
  it('never invents a date', () => {
    expect(parseDate('31/02/2026', 'DMY')).toBeNull()
    expect(parseDate('13/13/2026', 'DMY')).toBeNull()
    expect(parseDate('tomorrow', 'DMY')).toBeNull()
    expect(parseDate('', 'DMY')).toBeNull()
    expect(parseDateParts(undefined)).toBeNull()
    expect(resolveDate({ kind: 'numeric', a: 31, b: 4, c: 2026 }, 'DMY')).toBeNull()
  })
  it('detects day/month order from the whole file', () => {
    expect(detectDateOrder(['01/02/2026', '13/02/2026'], 'MDY')).toMatchObject({ order: 'DMY', ambiguous: false })
    expect(detectDateOrder(['01/02/2026', '02/13/2026'], 'DMY')).toMatchObject({ order: 'MDY', ambiguous: false })
    expect(detectDateOrder(['01/02/2026', '03/04/2026'], 'DMY')).toMatchObject({ order: 'DMY', ambiguous: true })
    expect(detectDateOrder(['13/02/2026', '02/13/2026'], 'DMY')).toMatchObject({ ambiguous: true })
    expect(detectDateOrder(['2026-02-01', '12-Oct-26'], 'DMY')).toMatchObject({ ambiguous: false, numericCount: 0 })
  })
})

describe('decodeText', () => {
  it('handles BOMs and falls back to Windows-1252', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).text).toBe('A')
    const w = decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))
    expect(w).toEqual({ text: 'Café', encoding: 'windows-1252' })
    expect(decodeText(enc('Café')).encoding).toBe('utf-8')
  })
})

describe('parseQif', () => {
  const sample = [
    '!Option:AutoSwitch', '!Account', 'NMain Checking', 'TBank', '^', '!Clear:AutoSwitch',
    '!Type:Bank',
    'D13/10/2026', 'T-180.00', 'PSWIGGY', 'MOrder 12345', 'LFood:Dining/Personal', 'N1001', 'C*', '^',
    'D14/10/2026', 'T25,000.00', 'PACME SALARY', 'LIncome', '^',
    'D15/10/2026', 'T-500.00', 'PTransfer out', 'L[Savings]', '^',
    '!Type:Cat', 'NFood', 'E', '^', 'NSalary', 'I', '^',
    '!Type:Invst', 'D1/1/2026', 'NBuy', 'YACME', '^'
  ].join('\r\n')

  it('splits records on ^ and maps every field', () => {
    const q = parseQif(enc(sample))
    expect(q.records).toHaveLength(3)
    expect(q.records[0]).toMatchObject({ date: '13/10/2026', amount: '-180.00', payee: 'SWIGGY', memo: 'Order 12345', category: 'Food:Dining/Personal', number: '1001', cleared: '*' })
    expect(q.accountNames).toEqual(['Main Checking'])
    expect(q.accountType).toBe('Bank')
  })
  it('skips unsupported sections and counts them', () => {
    const q = parseQif(enc(sample))
    expect(q.skippedRecords).toBe(3)
    expect(q.skippedSections.sort()).toEqual(['Categories', 'Investment'])
  })
  it('does not assume optional fields, and handles a missing final ^', () => {
    const q = parseQif(enc('!Type:Bank\nD1/2/2026\nT-5\n^\nT-7'))
    expect(q.records).toHaveLength(2)
    expect(q.records[1].amount).toBe('-7')
    expect(q.records[0].payee).toBe('')
  })
  it('treats a headerless file as a bank register and reads U amounts', () => {
    const q = parseQif(enc('D1/2/2026\nU1,000.00\nPShop\n^'))
    expect(q.records[0].amount).toBe('1,000.00')
  })
  it('reads Windows-1252 payees', () => {
    const bytes = new Uint8Array([...enc('!Type:Bank\nD1/2/2026\nT-5\nPCaf'), 0xe9, ...enc('\n^\n')])
    const q = parseQif(bytes)
    expect(q.encoding).toBe('windows-1252')
    expect(q.records[0].payee).toBe('Café')
  })
  it('collects split categories', () => {
    const q = parseQif(enc('!Type:Bank\nD1/2/2026\nT-30\nPStore\nSFood\nE\n$-10\nSFood\n$-20\n^'))
    expect(q.records[0].splitCategories).toEqual(['Food', 'Food'])
  })
  it('rejects a file with no transactions', () => {
    expect(() => parseBytes('qif', enc('hello world'))).toThrow(/No transactions were found/)
    expect(() => parseBytes('qif', new Uint8Array())).toThrow(/empty/)
  })
})

describe('normalizeQifRecord', () => {
  const rec = (over: Partial<Parameters<typeof normalizeQifRecord>[0]> = {}) =>
    ({ section: 'Bank', date: '13/10/2026', amount: '-180.00', payee: 'SWIGGY', memo: 'Order 1', category: 'Food', number: '', cleared: '', splitCategories: [], line: 1, ...over })

  it('negative → expense, positive → income, stored as positive magnitudes', () => {
    expect(normalizeQifRecord(rec(), 1, ctx)).toMatchObject({ date: '2026-10-13', amount: 180, type: 'expense', merchant: 'SWIGGY', memo: 'Order 1', category: 'Food' })
    expect(normalizeQifRecord(rec({ amount: '25,000.00' }), 1, ctx)).toMatchObject({ amount: 25000, type: 'income' })
  })
  it('reverse flips meaning', () => {
    expect(normalizeQifRecord(rec({ amount: '180' }), 1, { order: 'DMY', reverse: true })).toMatchObject({ type: 'expense' })
  })
  it('falls back to the memo when there is no payee, and to a placeholder last', () => {
    expect(normalizeQifRecord(rec({ payee: '' }), 1, ctx)).toMatchObject({ merchant: 'Order 1', memo: '' })
    expect(normalizeQifRecord(rec({ payee: '', memo: '' }), 1, ctx).merchant).toBe('(No description)')
  })
  it('[Account] becomes a transfer; class suffix is stripped; unparseable data is invalid, not invented', () => {
    expect(normalizeQifRecord(rec({ category: '[Savings]' }), 1, ctx)).toMatchObject({ isTransfer: true, category: 'Transfer' })
    expect(normalizeQifRecord(rec({ category: 'Food:Dining/Project' }), 1, ctx).category).toBe('Food:Dining')
    expect(normalizeQifRecord(rec({ date: 'garbage' }), 1, ctx)).toMatchObject({ date: null, issue: 'Date could not be read' })
    expect(normalizeQifRecord(rec({ date: '' }), 1, ctx).issue).toBe('No date')
    expect(normalizeQifRecord(rec({ amount: '' }), 1, ctx).issue).toBe('No amount')
    expect(normalizeQifRecord(rec({ amount: '0.00' }), 1, ctx).issue).toBe('Amount is zero')
    expect(normalizeQifRecord(rec({ category: '', splitCategories: ['Fuel', 'Fuel'] }), 1, ctx).category).toBe('Fuel')
  })
})

describe('CSV tables: header and mapping detection', () => {
  const hdfc = [
    'HDFC BANK Ltd.,,,,,,',
    'Account Statement,,,,,,',
    '',
    'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
    '01/10/26,UPI-SWIGGY-9812345678,0000123,01/10/26,"1,250.00",,"48,750.00"',
    '02/10/26,SALARY ACME,0000124,02/10/26,,"85,000.00","1,33,750.00"',
    '13/10/26,UPI-LUNCH,0000125,13/10/26,180.00,,"1,33,570.00"',
    ',Total,,,"1,430.00","85,000.00",'
  ].join('\n')

  it('skips preamble lines to find the header and detects the columns', () => {
    const t = parseCsv(enc(hdfc))
    expect(detectHeaderRow(t.rows)).toBe(2)
    const layout = layoutTable(t.rows)
    expect(layout.headers[0]).toBe('Date')
    const { mapping, uncertain } = detectMapping(layout.headers, t.rows.slice(layout.dataStart))
    expect(mapping).toMatchObject({ date: 0, description: 1, reference: 2, debit: 4, credit: 5, balance: 6 })
    expect(Object.keys(uncertain)).toEqual([])
    expect(mappingBlockers(mapping)).toEqual([])
  })

  it('normalises debit/credit rows and flags the footer as not a transaction', () => {
    const t = parseCsv(enc(hdfc))
    const layout = layoutTable(t.rows)
    const { mapping } = detectMapping(layout.headers, t.rows.slice(layout.dataStart))
    const rows = t.rows.slice(layout.dataStart).map((r, i) => normalizeTableRow(r, i + 1, mapping, ctx)!)
    expect(rows[0]).toMatchObject({ date: '2026-10-01', amount: 1250, type: 'expense', issue: null })
    expect(rows[1]).toMatchObject({ amount: 85000, type: 'income' })
    expect(rows[3].issue).toBe('Not a transaction row')
  })

  it('single signed Amount column with Dr/Cr suffix, indicator column and reverse', () => {
    const csv = 'Date,Description,Amount\n2026-10-01,Coffee,-4.50\n2026-10-02,Refund,12.00\n2026-10-03,Rent,"1,000.00 Dr"'
    const t = parseCsv(enc(csv))
    const layout = layoutTable(t.rows)
    const { mapping } = detectMapping(layout.headers, t.rows.slice(1))
    const rows = t.rows.slice(1).map((r, i) => normalizeTableRow(r, i + 1, mapping, ctx)!)
    expect(rows.map((r) => [r.amount, r.type])).toEqual([[4.5, 'expense'], [12, 'income'], [1000, 'expense']])
    const rev = t.rows.slice(1).map((r, i) => normalizeTableRow(r, i + 1, mapping, { order: 'DMY', reverse: true })!)
    expect(rev.map((r) => r.type)).toEqual(['income', 'expense', 'income'])

    const csv2 = 'Date,Particulars,Amount,Dr/Cr\n01-10-2026,Shop,500.00,DR\n02-10-2026,Pay,900.00,CR'
    const t2 = parseCsv(enc(csv2))
    const l2 = layoutTable(t2.rows)
    const m2 = detectMapping(l2.headers, t2.rows.slice(1)).mapping
    expect(m2.drcr).toBe(3)
    expect(t2.rows.slice(1).map((r, i) => normalizeTableRow(r, i + 1, m2, ctx)!.type)).toEqual(['expense', 'income'])
  })

  it('handles quoted commas, semicolon delimiters and Indian grouping', () => {
    const csv = 'Date;Description;Amount\n01/10/2026;"Shop, Main Road";-1,23,456.78'
    const t = parseCsv(enc(csv))
    expect(t.delimiter).toBe(';')
    const layout = layoutTable(t.rows)
    const m = detectMapping(layout.headers, t.rows.slice(1)).mapping
    expect(normalizeTableRow(t.rows[1], 1, m, ctx)).toMatchObject({ merchant: 'Shop, Main Road', amount: 123456.78, type: 'expense' })
  })

  it('flags two equally good date columns as uncertain instead of guessing silently', () => {
    const csv = 'Date,Transaction Date,Description,Amount\n01/10/2026,02/10/2026,Shop,-5\n03/10/2026,04/10/2026,Cafe,-7'
    const t = parseCsv(enc(csv))
    const layout = layoutTable(t.rows)
    const { mapping, uncertain } = detectMapping(layout.headers, t.rows.slice(1))
    expect(uncertain.date).toMatch(/Several columns/)
    // the user's explicit choice clears the warning
    const resolved = resolveMapping({ mapping, uncertain }, { date: 1 }, layout.width)
    expect(resolved.mapping.date).toBe(1)
    expect(resolved.uncertain.date).toBeUndefined()
  })

  it('guesses from data when there are no titles — but marks every guess as uncertain', () => {
    const csv = '01/10/2026,Coffee shop on Main Street,-4.50\n02/10/2026,Salary from the employer,5000.00'
    const t = parseCsv(enc(csv))
    const layout = layoutTable(t.rows)
    expect(layout.headerIndex).toBe(-1)
    const { mapping, uncertain } = detectMapping(layout.headers, t.rows)
    expect(mapping).toMatchObject({ date: 0, description: 1, amount: 2 })
    expect(Object.keys(uncertain).sort()).toEqual(['amount', 'date', 'description'])
  })

  it('reports what is missing when nothing can be mapped', () => {
    const t = parseCsv(enc('Foo,Bar\nx,y\nz,w'))
    const layout = layoutTable(t.rows)
    const { mapping } = detectMapping(layout.headers, t.rows.slice(1))
    expect(mappingBlockers(mapping).length).toBeGreaterThan(0)
  })
  it('explicit mapping can clear a field and out-of-range columns are dropped', () => {
    const base = { mapping: { date: 0, description: 1, memo: null, amount: 2, debit: null, credit: null, drcr: null, category: null, account: null, reference: null, balance: null } as ColumnMapping, uncertain: {} }
    expect(resolveMapping(base, { amount: null, memo: 9 }, 3).mapping).toMatchObject({ amount: null, memo: null })
  })
})

const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000

function workbook(sheets: Record<string, XLSX.WorkSheet>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name)
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

describe('Excel', () => {
  it('converts real date cells exactly, keeps numbers, and detects columns', () => {
    const ws: XLSX.WorkSheet = {
      A1: { t: 's', v: 'Date' }, B1: { t: 's', v: 'Narration' }, C1: { t: 's', v: 'Debit' }, D1: { t: 's', v: 'Credit' },
      A2: { t: 'n', v: serial(2026, 10, 12), z: 'dd/mm/yyyy' }, B2: { t: 's', v: 'UPI-TEA STALL' }, C2: { t: 'n', v: 20 },
      A3: { t: 'n', v: serial(2026, 3, 1), z: 'dd-mmm-yy' }, B3: { t: 's', v: 'SALARY' }, D3: { t: 'n', v: 50000.5 },
      '!ref': 'A1:D3'
    }
    const t = parseExcel(workbook({ Statement: ws }))
    expect(t.sheet).toBe('Statement')
    expect(t.rows[1][0]).toBe('2026-10-12')
    expect(t.rows[2][0]).toBe('2026-03-01')
    expect(t.rows[1][2]).toBe(20)
    const layout = layoutTable(t.rows)
    const { mapping } = detectMapping(layout.headers, t.rows.slice(1))
    expect(mapping).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3 })
    const rows = t.rows.slice(1).map((r, i) => normalizeTableRow(r, i + 1, mapping, ctx)!)
    expect(rows[0]).toMatchObject({ date: '2026-10-12', amount: 20, type: 'expense' })
    expect(rows[1]).toMatchObject({ date: '2026-03-01', amount: 50000.5, type: 'income' })
  })

  it('lists sheets and reads the requested one', () => {
    const a: XLSX.WorkSheet = { A1: { t: 's', v: 'x' }, '!ref': 'A1:A1' }
    const b: XLSX.WorkSheet = { A1: { t: 's', v: 'Date' }, B1: { t: 's', v: 'Description' }, A2: { t: 's', v: '01/10/2026' }, B2: { t: 's', v: 'Shop' }, '!ref': 'A1:B2' }
    const bytes = workbook({ Cover: a, Data: b })
    expect(parseExcel(bytes).sheet).toBe('Data') // first sheet with real content
    const t = parseExcel(bytes, 'Cover')
    expect(t.sheets).toEqual(['Cover', 'Data'])
    expect(t.sheet).toBe('Cover')
  })

  it('reports an unreadable file with a friendly message', () => {
    expect(() => parseBytes('excel', enc('this is not a workbook'))).toThrow(/valid Excel file|No data/)
  })
})
