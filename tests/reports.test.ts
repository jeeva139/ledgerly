import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './helpers'
import { insertTransaction, type NewTransaction } from '../electron/database/txnStore'
import {
  accountsReport, categoryTrends, monthlyReport, saveCsv, spendingByCategory, tagsReport, topMerchants
} from '../electron/services/reports'
import { listAccounts, updateAccount } from '../electron/services/catalog'
import { setDialogProvider } from '../electron/platform/dialogs'
import { clearHandlersForTests, callChannel } from '../electron/ipc/register'
import { registerReportsIpc } from '../electron/ipc/reports'
import { csvFilename, toCsv } from '../src/features/reports/csv'
import { LONG_UPI } from './helpers'

const NOW = new Date(2026, 10, 15, 12) // 15 Nov 2026

let n = 0
function add(date: string, amount: number, type: 'expense' | 'income', extra: Partial<NewTransaction> = {}) {
  return insertTransaction({
    date,
    merchant: extra.merchant ?? `Merchant ${++n}`,
    amount,
    type,
    account: 'Main Checking',
    source: 'manual',
    category: type === 'income' ? 'Income' : 'Groceries',
    ...extra
  })
}

beforeEach(() => {
  freshDb()
  n = 0
})
afterEach(() => setDialogProvider(null))

describe('reports: spending by category', () => {
  beforeEach(() => {
    add('2026-11-01', 400, 'expense', { category: 'Food:Dining' })
    add('2026-11-02', 100, 'expense', { category: 'Food' })
    add('2026-11-03', 500, 'expense', { category: 'Rent' })
    add('2026-11-04', 3000, 'income')
    add('2026-11-05', 700, 'expense', { category: 'Transfer', isTransfer: true })
    add('2026-10-05', 50, 'expense', { category: 'Rent' })
  })

  it('totals, share and count per category; income and transfers are excluded', () => {
    const r = spendingByCategory('this-month', false, NOW)
    expect(r.total).toBe(1000)
    expect(r.count).toBe(3)
    expect(r.rows.map((x) => [x.name, x.total, x.count, x.pct])).toEqual([
      ['Rent', 500, 1, 50],
      ['Food:Dining', 400, 1, 40],
      ['Food', 100, 1, 10]
    ])
  })

  it('rolls subcategories up into their parent', () => {
    const r = spendingByCategory('this-month', true, NOW)
    expect(r.rows.map((x) => [x.name, x.total, x.count])).toEqual([
      ['Food', 500, 2],
      ['Rent', 500, 1]
    ])
  })

  it('respects the period and returns nothing (not zeros) for an empty one', () => {
    expect(spendingByCategory('last-month', true, NOW).rows).toEqual([{ name: 'Rent', total: 50, count: 1, pct: 100 }])
    expect(spendingByCategory('last-3-months', true, new Date(2030, 0, 1)).rows).toEqual([])
  })
})

describe('reports: monthly', () => {
  it('lists continuous months with true zeros for quiet months, plus totals and savings rate', () => {
    add('2026-08-05', 100, 'expense')
    add('2026-08-06', 1000, 'income')
    add('2026-10-05', 300, 'expense')
    add('2026-10-06', 200, 'expense', { isTransfer: true })
    const r = monthlyReport('all-time', NOW)
    expect(r.rows).toEqual([
      { month: '2026-08', expense: 100, income: 1000, net: 900 },
      { month: '2026-09', expense: 0, income: 0, net: 0 },
      { month: '2026-10', expense: 300, income: 0, net: -300 }
    ])
    expect(r.totals).toEqual({ income: 1000, expense: 400, net: 600, savingsRate: 60 })
  })

  it('is empty — not zero-filled — when there is no history', () => {
    const r = monthlyReport('all-time', NOW)
    expect(r.rows).toEqual([])
    expect(r.totals).toEqual({ income: 0, expense: 0, net: 0, savingsRate: 0 })
  })
})

describe('reports: category trends', () => {
  it('returns the top categories by total with a continuous month axis', () => {
    add('2026-08-01', 100, 'expense', { category: 'Food' })
    add('2026-10-01', 50, 'expense', { category: 'Food:Dining' })
    add('2026-10-02', 700, 'expense', { category: 'Rent' })
    add('2026-09-02', 5, 'expense', { category: 'Misc' })
    const r = categoryTrends('all-time', 2, NOW)
    expect(r.months).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(r.series.map((s) => s.name)).toEqual(['Rent', 'Food'])
    expect(r.series[0]).toEqual({ name: 'Rent', total: 700, values: [0, 0, 700] })
    expect(r.series[1]).toEqual({ name: 'Food', total: 150, values: [100, 0, 50] })
  })

  it('is empty when there is no spending', () => {
    add('2026-08-01', 100, 'income')
    expect(categoryTrends('all-time', 5, NOW)).toMatchObject({ months: [], series: [] })
  })
})

describe('reports: top merchants', () => {
  it('groups the same merchant across reference numbers and UPI narrations', () => {
    add('2026-11-01', 300, 'expense', { merchant: 'SWIGGY ORDER #4482913' })
    add('2026-11-02', 200, 'expense', { merchant: 'SWIGGY ORDER #9921345' })
    add('2026-11-03', 20, 'expense', { merchant: LONG_UPI })
    add('2026-11-04', 30, 'expense', { merchant: 'UPI-MR A MANIKANDAN-9578379800-2@YBL-CIUB0000476-621367896104-DINNER' })
    add('2026-11-05', 50, 'expense', { merchant: 'Tea Stall' })
    add('2026-11-05', 5000, 'income', { merchant: 'Salary' })
    add('2026-11-05', 900, 'expense', { merchant: 'Own account', isTransfer: true })
    const r = topMerchants('all-time', 15, NOW)
    expect(r.totalSpending).toBe(600)
    expect(r.rows[0]).toMatchObject({ key: 'swiggy order', name: 'Swiggy Order', total: 500, count: 2, pct: 83.3 })
    const mani = r.rows.find((x) => x.key === 'mr a manikandan')
    expect(mani).toMatchObject({ total: 50, count: 2 })
    expect(r.rows.some((x) => x.name === 'Salary' || x.name === 'Own Account')).toBe(false)
  })

  it('honours the limit', () => {
    for (let i = 1; i <= 20; i++) add('2026-11-01', i, 'expense', { merchant: `Shop ${String.fromCharCode(64 + i)}` })
    expect(topMerchants('all-time', 5, NOW).rows).toHaveLength(5)
  })
})

describe('reports: accounts', () => {
  it('shows real activity per account; balance only when an opening balance was entered', () => {
    const accounts = listAccounts()
    const checking = accounts.find((a) => a.name === 'Main Checking')!
    updateAccount(checking.id, { openingBalance: 1000 })
    add('2026-11-02', 5000, 'income')
    add('2026-11-03', 200, 'expense')
    add('2026-11-04', 300, 'expense', { isTransfer: true, category: 'Transfer' })
    add('2026-11-04', 300, 'income', { isTransfer: true, category: 'Transfer', account: 'Cash' })
    add('2026-10-05', 50, 'expense', { account: 'Cash' })
    add('2026-10-06', 10, 'expense', { account: 'Old HDFC' })

    const r = accountsReport('this-month', NOW)
    const by = (name: string) => r.rows.find((x) => x.account === name)!
    expect(by('Main Checking')).toMatchObject({
      managed: true, moneyIn: 5000, moneyOut: 200, net: 4800, transfersIn: 0, transfersOut: 300, count: 3, openingBalance: 1000,
      balance: 5500 // 1000 + 5000 − 200 − 300 (all dates, transfers included)
    })
    expect(by('Cash')).toMatchObject({ managed: true, moneyIn: 0, moneyOut: 0, transfersIn: 300, count: 1, openingBalance: null, balance: null })
    expect(by('Old HDFC')).toMatchObject({ managed: false, count: 0, balance: null })
    // accounts with no transactions and no opening balance are not listed
    expect(r.rows.some((x) => x.account === 'Everyday Visa' || x.account === 'Rewards Card')).toBe(false)
  })

  it('balance ignores the selected period', () => {
    const checking = listAccounts().find((a) => a.name === 'Main Checking')!
    updateAccount(checking.id, { openingBalance: 100 })
    add('2026-01-02', 50, 'income')
    expect(accountsReport('last-month', NOW).rows[0]).toMatchObject({ account: 'Main Checking', count: 0, balance: 150 })
  })
})

describe('reports: tags', () => {
  it('counts usage, spending and income per tag (case-insensitive, transfers excluded)', () => {
    add('2026-11-01', 100, 'expense', { tags: ['Weekend', 'Family'] })
    add('2026-11-02', 50, 'expense', { tags: ['weekend'] })
    add('2026-11-03', 400, 'income', { tags: ['Weekend'] })
    add('2026-11-04', 999, 'expense', { tags: ['Weekend'], isTransfer: true })
    add('2026-10-01', 1, 'expense', { tags: ['Family'] })
    const r = tagsReport('this-month', NOW)
    expect(r.rows).toEqual([
      { tag: 'Weekend', count: 3, spending: 150, income: 400 },
      { tag: 'Family', count: 1, spending: 100, income: 0 }
    ])
    expect(tagsReport('all-time', NOW).rows.find((x) => x.tag === 'Family')).toMatchObject({ count: 2, spending: 101 })
  })

  it('is empty when nothing is tagged', () => {
    add('2026-11-01', 1, 'expense')
    expect(tagsReport('all-time', NOW).rows).toEqual([])
  })
})

describe('reports: CSV export', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-reports-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const provider = (target: string | null, seen?: { defaultPath?: string }) => ({
    openFile: async () => null,
    saveFile: async (o: { defaultPath: string }) => {
      if (seen) seen.defaultPath = o.defaultPath
      return target
    },
    openPath: async () => '',
    openFolder: async () => ''
  })

  it('writes UTF-8 with a BOM through the save dialog and reports cancel honestly', async () => {
    const target = path.join(dir, 'out.csv')
    setDialogProvider(provider(target))
    expect(await saveCsv('Spending by category.csv', 'Category,Spending\r\nFood,₹100\r\n')).toEqual({ saved: true })
    const bytes = fs.readFileSync(target)
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(bytes.toString('utf8')).toContain('₹100')

    setDialogProvider(provider(null))
    expect(await saveCsv('x', 'a,b')).toEqual({ saved: false })
  })

  it('sanitises the suggested file name and refuses absurdly large content', async () => {
    const seen: { defaultPath?: string } = {}
    setDialogProvider(provider(null, seen))
    await saveCsv('../..\\evil:name?', 'a')
    expect(path.basename(seen.defaultPath!)).toBe('.._..\\evil_name_.csv'.replace(/\\/g, '_'))
    await expect(saveCsv('big', 'a'.repeat(5_000_001))).rejects.toThrow(/too large/)
  })

  it('works through IPC with validation', async () => {
    clearHandlersForTests()
    registerReportsIpc()
    const target = path.join(dir, 'ipc.csv')
    setDialogProvider(provider(target))
    expect(await callChannel('reports.saveCsv', { filename: 'a.csv', content: 'x,y\r\n1,2\r\n' })).toEqual({ saved: true })
    await expect(callChannel('reports.saveCsv', { filename: 'a.csv', content: '' })).rejects.toThrow(/nothing to export/)
    await expect(callChannel('reports.monthly', { period: 'bogus' })).rejects.toThrow()
  })

  it('toCsv quotes cells and neutralises spreadsheet formulas', () => {
    expect(toCsv(['A', 'B'], [['x,y', 'say "hi"'], ['=SUM(A1)', 5], ['-note', -5]])).toBe('A,B\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),5\r\n\'-note,-5\r\n')
    expect(csvFilename('Spending by Category', 'last-3-months')).toBe('ledgerly-spending-by-category-last-3-months.csv')
  })
})
