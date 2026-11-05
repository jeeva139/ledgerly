import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { count, freshDb } from './helpers'
import { clearHandlersForTests, callChannel, invokeChannel } from '../electron/ipc/register'
import { registerCoreIpc } from '../electron/ipc/core'
import { registerTransactionsIpc } from '../electron/ipc/transactions'
import { missingHandlers } from '../electron/ipc'
import { ensureDataLayout, setDataDir } from '../electron/database/paths'
import { insertBatch, baseFingerprint } from '../electron/database/txnStore'
import { setDialogProvider } from '../electron/platform/dialogs'
import { storeDocument, deleteDocument } from '../electron/documents/vault'
import { listCategories } from '../electron/services/catalog'
import { csvLine, csvText, qifRecord } from '../electron/exports/transactionsExport'
import type { Db } from '../electron/database/sqlite'
import type { Transaction } from '../shared/types'
import type { TransactionListResult } from '../shared/api/transactions'

let db: Db
let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-tx-'))
  setDataDir(tmp)
  ensureDataLayout()
})
afterAll(() => {
  setDialogProvider(null)
  fs.rmSync(tmp, { recursive: true, force: true })
})
beforeEach(() => {
  db = freshDb()
  clearHandlersForTests()
  registerCoreIpc()
  registerTransactionsIpc()
  setDialogProvider(null)
})

const create = (over: Record<string, unknown> = {}) =>
  callChannel<Transaction>('transactions.create', {
    date: '2026-03-01', merchant: 'Chai Point', amount: 120, type: 'expense', account: 'Cash', ...over
  })
const list = (over: Record<string, unknown> = {}) =>
  callChannel<TransactionListResult>('transactions.list', { page: 1, pageSize: 100, ...over })

/** A small, realistic dataset. */
async function seed() {
  const swiggy = await create({ date: '2026-01-05', merchant: 'Swiggy Order', memo: 'order 1', amount: 250, category: 'Dining', account: 'Main Checking', tags: ['Food'] })
  const salary = await create({ date: '2026-01-10', merchant: 'Salary ACME', amount: 50000, type: 'income', category: 'Income', account: 'Main Checking' })
  const netflix = await create({ date: '2026-02-01', merchant: 'Netflix', amount: 649, category: 'Subscriptions', account: 'Everyday Visa', tags: ['Streaming', 'Family'] })
  const bazaar = await create({ date: '2026-02-15', merchant: 'Big Bazaar', amount: 1800.5, category: 'Groceries', account: 'Cash' })
  const chai = await create({ date: '2026-02-20', merchant: 'Chai Point', amount: 120, account: 'Cash' })
  const transfer = await callChannel<{ from: Transaction; to: Transaction }>('transactions.createTransfer', {
    date: '2026-03-01', amount: 5000, fromAccount: 'Main Checking', toAccount: 'Everyday Visa'
  })
  return { swiggy, salary, netflix, bazaar, chai, transfer }
}

describe('IPC contract', () => {
  it('every method declared in the shared contract has a handler', () => {
    expect(missingHandlers().filter((c) => c.startsWith('transactions.'))).toEqual([])
  })

  it('rejects malformed input before touching the database', async () => {
    expect(await invokeChannel('transactions.list', {})).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('transactions.list', { page: 0, pageSize: 10 })).toMatchObject({ ok: false })
    expect(await invokeChannel('transactions.list', { page: 1, pageSize: 10, dateFrom: 'yesterday' })).toMatchObject({ ok: false })
    expect(await invokeChannel('transactions.update', { id: 'x', patch: { amount: -1 } })).toMatchObject({ ok: false })
    expect(await invokeChannel('transactions.setCategory', { selection: { ids: [] }, category: 'Dining' })).toMatchObject({ ok: false })
    expect(await invokeChannel('transactions.export', { format: 'pdf' })).toMatchObject({ ok: false })
    expect(await invokeChannel('transactions.deleteMany', { selection: 'everything' })).toMatchObject({ ok: false })
  })
})

describe('create / read / update / delete', () => {
  it('creates with sensible defaults and stores amounts as positive magnitudes', async () => {
    const t = await create({ merchant: '  Chai   Point ', account: undefined })
    expect(t).toMatchObject({ merchant: 'Chai   Point', amount: 120, type: 'expense', category: 'Needs review', account: 'Imported account', source: 'manual', categoryLocked: false, isTransfer: false })
    expect(await callChannel('transactions.get', { id: t.id })).toMatchObject({ id: t.id })
  })

  it('treats a category chosen by hand as a manual (locked) decision', async () => {
    const t = await create({ category: 'Dining', merchant: 'Lunch' })
    expect(t).toMatchObject({ category: 'Dining', categoryLocked: true })
  })

  it('updates fields, keeps the amount positive and bumps updatedAt', async () => {
    const t = await create()
    const u = await callChannel<Transaction>('transactions.update', { id: t.id, patch: { merchant: 'Chai Stall', amount: 150.5, type: 'income', memo: 'refund', tags: ['Weekend'] } })
    expect(u).toMatchObject({ merchant: 'Chai Stall', amount: 150.5, type: 'income', memo: 'refund', tags: ['Weekend'] })
    expect(u.updatedAt >= t.updatedAt).toBe(true)
    expect(count(db, 'tags')).toBe(1)
  })

  it('a manual category edit locks the category; choosing "Needs review" unlocks it', async () => {
    const t = await create()
    const a = await callChannel<Transaction>('transactions.update', { id: t.id, patch: { category: 'Dining' } })
    expect(a).toMatchObject({ category: 'Dining', categoryLocked: true })
    const b = await callChannel<Transaction>('transactions.update', { id: t.id, patch: { category: 'Needs review' } })
    expect(b).toMatchObject({ category: 'Needs review', categoryLocked: false })
  })

  it('deletes one transaction and reports a missing one', async () => {
    const t = await create()
    await callChannel('transactions.delete', { id: t.id })
    expect(count(db, 'transactions')).toBe(0)
    expect(await invokeChannel('transactions.delete', { id: t.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await invokeChannel('transactions.get', { id: t.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})

describe('validation', () => {
  it('rejects bad amounts, dates and merchants with friendly messages', async () => {
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: 'X', amount: 0, type: 'expense' })).toMatchObject({ ok: false, error: { code: 'VALIDATION', message: 'Amount must be greater than zero.' } })
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: 'X', amount: -5, type: 'expense' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: 'X', amount: 'ten', type: 'expense' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: 'X', amount: Number.POSITIVE_INFINITY, type: 'expense' })).toMatchObject({ ok: false })
    expect(await invokeChannel('transactions.create', { date: '2026-02-30', merchant: 'X', amount: 5, type: 'expense' })).toMatchObject({ ok: false, error: { code: 'VALIDATION', message: 'Please enter a valid date.' } })
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: '   ', amount: 5, type: 'expense' })).toMatchObject({ ok: false, error: { code: 'VALIDATION', message: 'Merchant cannot be empty.' } })
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: 'X', amount: 5, type: 'transfer' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(count(db, 'transactions')).toBe(0)
  })

  it('a category must exist or be explicitly created; tags are trimmed and de-duplicated', async () => {
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: 'X', amount: 5, type: 'expense', category: 'Brand New' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(listCategories()).not.toContain('Brand New')
    const t = await create({ category: 'Brand New', createCategoryIfMissing: true, tags: [' a ', 'A', 'b', ''] })
    expect(t).toMatchObject({ category: 'Brand New', tags: ['a', 'b'] })
    expect(listCategories()).toContain('Brand New')
    // case-insensitive match returns the managed spelling
    expect((await create({ merchant: 'Y', category: 'dining' })).category).toBe('Dining')
  })
})

describe('duplicate protection', () => {
  it('refuses an identical transaction unless explicitly allowed', async () => {
    await create()
    expect(await invokeChannel('transactions.create', { date: '2026-03-01', merchant: 'CHAI  POINT', amount: 120, type: 'expense', account: 'cash' })).toMatchObject({ ok: false, error: { code: 'DUPLICATE' } })
    expect(count(db, 'transactions')).toBe(1)
    const again = await create({ allowDuplicate: true })
    expect(again.id).toBeTruthy()
    expect(count(db, 'transactions')).toBe(2)
  })

  it('editing a transaction into a duplicate is refused; allowDuplicate keeps both', async () => {
    await create()
    const other = await create({ merchant: 'Other' })
    const res = await invokeChannel('transactions.update', { id: other.id, patch: { merchant: 'Chai Point' } })
    expect(res).toMatchObject({ ok: false, error: { code: 'DUPLICATE' } })
    const ok = await callChannel<Transaction>('transactions.update', { id: other.id, patch: { merchant: 'Chai Point' }, allowDuplicate: true })
    expect(ok.merchant).toBe('Chai Point')
    const fps = db.all<{ fingerprint: string }>('SELECT fingerprint FROM transactions').map((r) => r.fingerprint)
    expect(new Set(fps).size).toBe(2)
  })

  it('an edit that does not change the fingerprint inputs never trips the duplicate check', async () => {
    const t = await create()
    const u = await callChannel<Transaction>('transactions.update', { id: t.id, patch: { memo: 'note', category: 'Dining' } })
    expect(u.memo).toBe('note')
  })
})

describe('filters', () => {
  it('filters by date range (inclusive)', async () => {
    await seed()
    expect((await list({ dateFrom: '2026-02-01', dateTo: '2026-02-20' })).rows.map((r) => r.merchant).sort()).toEqual(['Big Bazaar', 'Chai Point', 'Netflix'])
    expect((await list({ dateFrom: '2026-03-01' })).total).toBe(2)
    expect((await list({ dateTo: '2026-01-05' })).total).toBe(1)
  })

  it('filters by account, category (incl. subcategories), tag, type and needs-review', async () => {
    await seed()
    await callChannel('categories.add', { name: 'Eating out', parent: 'Dining' })
    await create({ merchant: 'Cafe', category: 'Dining:Eating out', amount: 99 })
    expect((await list({ accounts: ['Cash'] })).total).toBe(3) // Big Bazaar, Chai Point, Cafe
    expect((await list({ accounts: ['Cash', 'Everyday Visa'] })).total).toBe(5) // + Netflix and the incoming transfer leg
    expect((await list({ categories: ['Dining'] })).rows.map((r) => r.merchant).sort()).toEqual(['Cafe', 'Swiggy Order'])
    expect((await list({ categories: ['Dining:Eating out'] })).total).toBe(1)
    expect((await list({ tags: ['streaming'] })).rows.map((r) => r.merchant)).toEqual(['Netflix'])
    expect((await list({ tags: ['Food', 'Family'] })).total).toBe(2)
    expect((await list({ type: 'income' })).rows.map((r) => r.merchant).sort()).toEqual(['Salary ACME', 'Transfer from Main Checking'])
    expect((await list({ type: 'all' })).total).toBe(8)
    expect((await list({ needsReview: true })).rows.map((r) => r.merchant)).toEqual(['Chai Point'])
  })

  it('transfers can be included, excluded or shown alone', async () => {
    await seed()
    expect((await list({ transfers: 'all' })).total).toBe(7)
    expect((await list({ transfers: 'exclude' })).total).toBe(5)
    const only = await list({ transfers: 'only' })
    expect(only.total).toBe(2)
    expect(only.rows.every((r) => r.isTransfer && r.category === 'Transfer')).toBe(true)
  })

  it('combines filters with AND', async () => {
    await seed()
    const r = await list({ accounts: ['Cash'], type: 'expense', dateFrom: '2026-02-16' })
    expect(r.rows.map((x) => x.merchant)).toEqual(['Chai Point'])
  })

  it('exposes filter options including labels that only exist on historical rows', async () => {
    await seed()
    db.run("UPDATE transactions SET category = 'Old Label', account = 'Closed account' WHERE merchant = 'Netflix'")
    const o = await callChannel<{ accounts: string[]; categories: string[]; tags: string[] }>('transactions.listFilterOptions')
    expect(o.accounts).toEqual(expect.arrayContaining(['Cash', 'Closed account', 'Main Checking']))
    expect(o.categories).toEqual(expect.arrayContaining(['Old Label', 'Dining', 'Needs review']))
    expect(o.tags).toEqual(expect.arrayContaining(['Family', 'Food', 'Streaming']))
  })
})

describe('search', () => {
  it('is case-insensitive across merchant, memo, category, tags and account', async () => {
    await seed()
    const names = async (search: string) => (await list({ search })).rows.map((r) => r.merchant).sort()
    expect(await names('SWIGGY')).toEqual(['Swiggy Order'])
    expect(await names('order 1')).toEqual(['Swiggy Order']) // memo + merchant, all words
    expect(await names('subscript')).toEqual(['Netflix']) // category
    expect(await names('STREAMING')).toEqual(['Netflix']) // tag
    expect(await names('everyday visa')).toEqual(['Netflix', 'Transfer from Main Checking', 'Transfer to Everyday Visa']) // account (and merchant text of the transfer leg)
    expect(await names('nothing-matches-this')).toEqual([])
  })

  it('treats % and _ literally and finds text inside very long UPI narrations', async () => {
    const upi = 'UPI-MR A MANIKANDAN-9578379800-2@YBL-CIUB0000476-621367896104-LUNCHUPI-JEEVAJEEVA534571OKAX-657900506223-TEA'
    await create({ merchant: upi, amount: 180 })
    await create({ merchant: '100% Cotton', amount: 10 })
    await create({ merchant: 'Plain Shirt', amount: 11 })
    expect((await list({ search: 'lunchupi' })).total).toBe(1)
    expect((await list({ search: '100%' })).rows.map((r) => r.merchant)).toEqual(['100% Cotton'])
    expect((await list({ search: '_' })).total).toBe(0)
    expect((await list({ search: '%' })).total).toBe(1)
  })
})

describe('sorting, pagination and totals', () => {
  it('sorts by every column in both directions with stable tie-breakers', async () => {
    await seed()
    const first = async (field: string, dir: string) => (await list({ sort: { field, dir }, transfers: 'exclude' })).rows.map((r) => r.merchant)
    expect((await first('date', 'desc'))[0]).toBe('Chai Point')
    expect((await first('date', 'asc'))[0]).toBe('Swiggy Order')
    expect((await first('amount', 'desc'))[0]).toBe('Salary ACME')
    expect((await first('amount', 'asc'))[0]).toBe('Chai Point')
    expect(await first('merchant', 'asc')).toEqual(['Big Bazaar', 'Chai Point', 'Netflix', 'Salary ACME', 'Swiggy Order'])
    expect((await first('category', 'asc'))[0]).toBe('Swiggy Order') // Dining sorts first
    expect((await first('category', 'desc'))[0]).toBe('Netflix') // Subscriptions sorts last
    expect((await first('account', 'asc'))[0]).toBe('Chai Point') // Cash, newest first within the account
    expect((await first('type', 'asc'))[0]).toBeTruthy()
    expect(await invokeChannel('transactions.list', { page: 1, pageSize: 10, sort: { field: 'DROP TABLE', dir: 'asc' } })).toMatchObject({ ok: false })
  })

  it('paginates server-side and reports totals for the whole filtered set (transfers excluded)', async () => {
    await seed()
    const p1 = await list({ pageSize: 3, page: 1 })
    const p2 = await list({ pageSize: 3, page: 2 })
    const p3 = await list({ pageSize: 3, page: 3 })
    expect([p1.rows.length, p2.rows.length, p3.rows.length]).toEqual([3, 3, 1])
    expect(p1.total).toBe(7)
    expect(new Set([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id)).size).toBe(7)
    // 7 rows, but the two transfer legs are not income/spending
    expect(p1.totals).toEqual({ income: 50000, expense: 2819.5, count: 5 })
    expect((await list({ transfers: 'only' })).totals).toEqual({ income: 0, expense: 0, count: 0 })
    expect((await list({ type: 'expense', transfers: 'exclude' })).totals.income).toBe(0)
    expect((await list({ pageSize: 2, page: 99 })).rows).toEqual([])
    expect(await invokeChannel('transactions.list', { page: 1, pageSize: 1000 })).toMatchObject({ ok: false })
  })
})

describe('bulk operations', () => {
  it('setCategory locks every selected transaction and does not touch anything else', async () => {
    const { chai, bazaar } = await seed()
    const before = db.get<Record<string, unknown>>('SELECT date, merchant, amount, account, type FROM transactions WHERE id = ?', chai.id)
    const r = await callChannel<{ updated: number; category: string }>('transactions.setCategory', { selection: { ids: [chai.id, bazaar.id] }, category: 'dining' })
    expect(r).toEqual({ updated: 2, category: 'Dining' })
    const rows = await list({ categories: ['Dining'] })
    expect(rows.rows.filter((x) => x.id === chai.id || x.id === bazaar.id).every((x) => x.category === 'Dining' && x.categoryLocked)).toBe(true)
    expect(db.get('SELECT date, merchant, amount, account, type FROM transactions WHERE id = ?', chai.id)).toEqual(before)
    // unknown category is refused unless explicitly created
    expect(await invokeChannel('transactions.setCategory', { selection: { ids: [chai.id] }, category: 'Nope' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('transactions.setCategory', { selection: { ids: [chai.id] }, category: 'Nope', createIfMissing: true })).toMatchObject({ ok: true })
    expect(listCategories()).toContain('Nope')
    // back to Needs review unlocks
    await callChannel('transactions.setCategory', { selection: { ids: [chai.id] }, category: 'Needs review' })
    expect((await callChannel<Transaction>('transactions.get', { id: chai.id })).categoryLocked).toBe(false)
  })

  it('"select all matching" applies to the filter result minus the excluded rows', async () => {
    await seed()
    const filters = { accounts: ['Cash'] }
    const all = (await list(filters)).rows
    const keep = all[0]
    const r = await callChannel<{ updated: number }>('transactions.setCategory', { selection: { filters, exceptIds: [keep.id] }, category: 'Other' })
    expect(r.updated).toBe(1)
    expect((await callChannel<Transaction>('transactions.get', { id: keep.id })).category).toBe(keep.category)
    expect((await list({ categories: ['Other'] })).total).toBe(1)
  })

  it('addTags merges without duplicating and creates the tags', async () => {
    const { swiggy, netflix } = await seed()
    const r = await callChannel<{ updated: number }>('transactions.addTags', { selection: { ids: [swiggy.id, netflix.id] }, tags: ['food', 'Weekend'] })
    expect(r.updated).toBe(2)
    expect((await callChannel<Transaction>('transactions.get', { id: swiggy.id })).tags).toEqual(['Food', 'Weekend'])
    expect((await callChannel<Transaction>('transactions.get', { id: netflix.id })).tags).toEqual(['Streaming', 'Family', 'food', 'Weekend'])
    expect(await invokeChannel('transactions.addTags', { selection: { ids: [swiggy.id] }, tags: [] })).toMatchObject({ ok: false })
    const again = await callChannel<{ updated: number }>('transactions.addTags', { selection: { ids: [swiggy.id] }, tags: ['WEEKEND'] })
    expect(again.updated).toBe(0)
  })

  it('setTags replaces the tags of one transaction; a tag needs only a name', async () => {
    const t = await create({ tags: ['One'] })
    const u = await callChannel<Transaction>('transactions.setTags', { id: t.id, tags: ['Two', 'two', ' Three '] })
    expect(u.tags).toEqual(['Two', 'Three'])
    expect((await callChannel<Transaction>('transactions.setTags', { id: t.id, tags: [] })).tags).toEqual([])
    expect(db.all<{ name: string }>('SELECT name FROM tags ORDER BY name').map((r) => r.name)).toEqual(['One', 'Three', 'Two'])
  })

  it('markTransfer flags / unflags and moves the category label accordingly', async () => {
    const { chai, bazaar } = await seed()
    expect(await callChannel('transactions.markTransfer', { selection: { ids: [chai.id, bazaar.id] }, isTransfer: true })).toEqual({ updated: 2 })
    const marked = await callChannel<Transaction>('transactions.get', { id: chai.id })
    expect(marked).toMatchObject({ isTransfer: true, category: 'Transfer', categoryLocked: true })
    expect((await list({})).totals.expense).toBe(250 + 649) // chai + bazaar no longer count as spending
    expect(await callChannel('transactions.markTransfer', { selection: { ids: [chai.id, bazaar.id] }, isTransfer: false })).toEqual({ updated: 2 })
    expect(await callChannel<Transaction>('transactions.get', { id: chai.id })).toMatchObject({ isTransfer: false, category: 'Needs review', categoryLocked: false })
    expect((await list({})).totals.expense).toBe(250 + 649 + 1800.5 + 120)
  })

  it('deleteMany works for ids and for filter selections', async () => {
    const { chai, bazaar } = await seed()
    expect(await callChannel('transactions.deleteMany', { selection: { ids: [chai.id, bazaar.id, 'missing-id'] } })).toEqual({ deleted: 2 })
    expect((await list({})).total).toBe(5)
    expect(await callChannel('transactions.deleteMany', { selection: { filters: { transfers: 'only' } } })).toEqual({ deleted: 2 })
    expect((await list({})).total).toBe(3)
    expect(await invokeChannel('transactions.deleteMany', { selection: { ids: [] } })).toMatchObject({ ok: false })
  })
})

describe('transfers', () => {
  it('creates an expense leg on the source and an income leg on the target, neither counted as income/spending', async () => {
    const { from, to } = await callChannel<{ from: Transaction; to: Transaction }>('transactions.createTransfer', {
      date: '2026-04-01', amount: 1000, fromAccount: 'Main Checking', toAccount: 'Everyday Visa', memo: 'Card payment'
    })
    expect(from).toMatchObject({ type: 'expense', account: 'Main Checking', isTransfer: true, category: 'Transfer', amount: 1000, memo: 'Card payment' })
    expect(to).toMatchObject({ type: 'income', account: 'Everyday Visa', isTransfer: true, category: 'Transfer', amount: 1000 })
    const r = await list({})
    expect(r.total).toBe(2)
    expect(r.totals).toEqual({ income: 0, expense: 0, count: 0 })
  })

  it('validates the accounts and is atomic (both legs or neither)', async () => {
    const bad = { date: '2026-04-01', amount: 10 }
    expect(await invokeChannel('transactions.createTransfer', { ...bad, fromAccount: 'Cash', toAccount: 'cash' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('transactions.createTransfer', { ...bad, fromAccount: '', toAccount: 'Cash' })).toMatchObject({ ok: false })
    // A pre-existing identical target leg makes the 2nd leg a duplicate → the 1st leg is rolled back too.
    await create({ date: '2026-04-01', merchant: 'Transfer from Cash', amount: 10, type: 'income', account: 'Rewards Card' })
    const before = count(db, 'transactions')
    const dup = await invokeChannel('transactions.createTransfer', { ...bad, fromAccount: 'Cash', toAccount: 'Rewards Card' })
    expect(dup).toMatchObject({ ok: false, error: { code: 'DUPLICATE' } })
    expect(count(db, 'transactions')).toBe(before)
    // explicitly allowed → both legs are written
    expect(await invokeChannel('transactions.createTransfer', { ...bad, fromAccount: 'Cash', toAccount: 'Rewards Card', allowDuplicate: true })).toMatchObject({ ok: true })
    expect(count(db, 'transactions')).toBe(before + 2)
  })
})

describe('receipts', () => {
  it('links and unlinks a stored document, and deleting the document clears the link', async () => {
    const t = await create()
    const doc = storeDocument({ filename: 'bill.pdf', bytes: Buffer.from('%PDF-1.4 test'), kind: 'receipt', source: 'upload' })
    const linked = await callChannel<Transaction>('transactions.attachReceipt', { id: t.id, documentId: doc.id })
    expect(linked).toMatchObject({ receipt: true, receiptDocId: doc.id })
    expect((await list({})).rows[0]).toMatchObject({ receipt: true, receiptDocId: doc.id })
    deleteDocument(doc.id)
    expect(await callChannel<Transaction>('transactions.get', { id: t.id })).toMatchObject({ receipt: false, receiptDocId: null })
    const doc2 = storeDocument({ filename: 'bill2.png', bytes: Buffer.from([1, 2, 3]), kind: 'receipt', source: 'upload' })
    await callChannel('transactions.attachReceipt', { id: t.id, documentId: doc2.id })
    expect(await callChannel<Transaction>('transactions.attachReceipt', { id: t.id, documentId: null })).toMatchObject({ receipt: false, receiptDocId: null })
    expect(await invokeChannel('transactions.attachReceipt', { id: t.id, documentId: 'nope' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('create can link a receipt document immediately', async () => {
    const doc = storeDocument({ filename: 'r.jpg', bytes: Buffer.from([9, 9, 9]), kind: 'receipt', source: 'upload' })
    const t = await create({ receiptDocumentId: doc.id })
    expect(t).toMatchObject({ receipt: true, receiptDocId: doc.id })
    expect(await invokeChannel('transactions.create', { date: '2026-03-02', merchant: 'Z', amount: 1, type: 'expense', receiptDocumentId: 'ghost' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})

describe('export', () => {
  const fakeSave = (file: string | null) =>
    setDialogProvider({
      openFile: async () => null,
      saveFile: async () => file,
      openPath: async () => '',
      openFolder: async () => ''
    })

  it('CSV: UTF-8 BOM, header, signed amounts, quoting and formula neutralisation', async () => {
    await create({ date: '2026-01-05', merchant: 'Swiggy, "Order"', memo: 'two\nlines', amount: 250.5, category: 'Dining', tags: ['Food', 'Weekend'] })
    await create({ date: '2026-01-06', merchant: '=HYPERLINK("http://x")', amount: 5 })
    await create({ date: '2026-01-07', merchant: 'Salary ₹', amount: 1000, type: 'income', category: 'Income' })
    const file = path.join(tmp, 'out.csv')
    fakeSave(file)
    const res = await callChannel<{ saved: boolean; count: number; fileName: string }>('transactions.export', { format: 'csv' })
    expect(res).toEqual({ saved: true, count: 3, fileName: 'out.csv' })
    const raw = fs.readFileSync(file)
    expect(raw.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    const text = raw.toString('utf8').slice(1)
    const lines = text.split('\r\n')
    expect(lines[0]).toBe('Date,Description,Memo,Category,Account,Type,Amount,Tags,Transfer,Reference')
    expect(lines[1]).toBe('2026-01-05,"Swiggy, ""Order""","two\nlines",Dining,Cash,expense,-250.50,Food; Weekend,No,')
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(lines[3]).toContain('Salary ₹')
    expect(lines[3]).toContain(',income,1000.00,')
    expect(csvText('plain')).toBe('plain')
    expect(csvText('-dash')).toBe("'-dash")
  })

  it('QIF: per-account sections with !Type:Bank, MM/DD/YYYY dates, signed amounts and ^ terminators', async () => {
    await create({ date: '2026-03-01', merchant: 'Chai Point', memo: 'tea', amount: 120, category: 'Dining', account: 'Main Checking' })
    await create({ date: '2026-03-02', merchant: 'Salary', amount: 5000, type: 'income', category: 'Income', account: 'Main Checking' })
    await create({ date: '2026-03-03', merchant: 'Amazon', amount: 999.99, account: 'Everyday Visa' })
    const file = path.join(tmp, 'out.qif')
    fakeSave(file)
    expect(await callChannel('transactions.export', { format: 'qif' })).toMatchObject({ saved: true, count: 3 })
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('!Type:Bank')
    expect(text).toContain('!Type:CCard') // Everyday Visa is a credit card account
    expect(text).toContain('D03/01/2026\r\nT-120.00\r\nPChai Point\r\nMtea\r\nLDining\r\n^')
    expect(text).toContain('T5000.00')
    expect((text.match(/\^/g) ?? []).length).toBe(3 + 2) // 3 records + 2 !Account headers
    expect(qifRecord({ date: '2026-12-31', merchant: 'A\nB', memo: '', category: '', amount: 1, type: 'expense', reference: '' } as Transaction)).toBe('D12/31/2026\r\nT-1.00\r\nPA B\r\n^')
  })

  it('XLSX: a real workbook with the right rows and numeric amounts', async () => {
    await create({ date: '2026-01-05', merchant: 'Swiggy', amount: 250, category: 'Dining' })
    await create({ date: '2026-01-06', merchant: 'Salary', amount: 1000, type: 'income', category: 'Income' })
    const file = path.join(tmp, 'out.xlsx')
    fakeSave(file)
    expect(await callChannel('transactions.export', { format: 'xlsx' })).toMatchObject({ saved: true, count: 2 })
    const XLSX = await import('xlsx')
    const wb = XLSX.read(fs.readFileSync(file))
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ Date: '2026-01-05', Description: 'Swiggy', Amount: -250, Type: 'expense' })
    expect(rows[1]).toMatchObject({ Description: 'Salary', Amount: 1000 })
  })

  it('honours the filters, reports cancellation and refuses an empty export', async () => {
    await seed()
    const file = path.join(tmp, 'filtered.csv')
    fakeSave(file)
    const res = await callChannel<{ count: number }>('transactions.export', { format: 'csv', filters: { accounts: ['Cash'], type: 'expense' } })
    expect(res.count).toBe(2)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('Netflix')
    fakeSave(null)
    expect(await callChannel('transactions.export', { format: 'csv' })).toEqual({ saved: false, count: 0, fileName: null })
    expect(await invokeChannel('transactions.export', { format: 'csv', filters: { search: 'zzz-no-match' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(fs.existsSync(`${file}.part`)).toBe(false)
  })

  it('exports in chronological order', async () => {
    await create({ date: '2026-05-01', merchant: 'Later' })
    await create({ date: '2026-01-01', merchant: 'Earlier' })
    const file = path.join(tmp, 'order.csv')
    fakeSave(file)
    await callChannel('transactions.export', { format: 'csv' })
    const lines = fs.readFileSync(file, 'utf8').slice(1).split('\r\n')
    expect(lines[1]).toContain('Earlier')
    expect(csvLine({ date: 'x', merchant: 'm', memo: '', category: 'c', account: 'a', type: 'income', amount: 2, tags: [], isTransfer: true, reference: 'r' } as unknown as Transaction)).toBe('x,m,,c,a,income,2.00,,Yes,r')
  })
})

describe('performance (20,000 rows)', () => {
  it('lists, searches, filters and totals quickly without loading everything', async () => {
    const rows = []
    for (let i = 0; i < 20_000; i++) {
      const day = String((i % 28) + 1).padStart(2, '0')
      const month = String((i % 12) + 1).padStart(2, '0')
      const merchant = i % 50 === 0 ? `UPI-SHOP ${i}-LUNCHUPI-REF${i}-TEA` : `MERCHANT ${i} STORE`
      rows.push({
        date: `2025-${month}-${day}`, merchant, amount: 10 + (i % 500), type: (i % 7 === 0 ? 'income' : 'expense') as 'income' | 'expense',
        account: i % 2 ? 'Cash' : 'Main Checking', source: 'csv', category: i % 3 ? 'Groceries' : 'Needs review',
        fingerprint: baseFingerprint(`2025-${month}-${day}`, merchant, 10 + (i % 500), i % 2 ? 'Cash' : 'Main Checking')
      })
    }
    for (let i = 0; i < rows.length; i += 5000) insertBatch(rows.slice(i, i + 5000))
    expect(count(db, 'transactions')).toBe(20_000)

    const t0 = performance.now()
    const page = await list({ pageSize: 100 })
    const search = await list({ search: 'lunchupi', pageSize: 100 })
    const filtered = await list({ accounts: ['Cash'], categories: ['Groceries'], dateFrom: '2025-03-01', dateTo: '2025-08-31', sort: { field: 'amount', dir: 'desc' } })
    const elapsed = performance.now() - t0

    expect(page.total).toBe(20_000)
    expect(page.rows).toHaveLength(100)
    expect(search.total).toBe(400)
    expect(filtered.total).toBeGreaterThan(0)
    expect(page.totals.count).toBe(20_000)
    console.log(`[perf] 3 list queries over 20k rows: ${elapsed.toFixed(0)} ms`)
    expect(elapsed).toBeLessThan(1500)
  })
})
