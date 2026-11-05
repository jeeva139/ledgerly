import { beforeEach, describe, expect, it } from 'vitest'
import { count, freshDb } from './helpers'
import { MIGRATIONS, LATEST_SCHEMA_VERSION, runMigrations, currentSchemaVersion } from '../electron/database/migrations'
import { Db } from '../electron/database/sqlite'
import {
  baseFingerprint, existingFingerprints, insertBatch, insertTransaction, normalizeTags, getTransactionById, refingerprintTransactions
} from '../electron/database/txnStore'
import * as catalog from '../electron/services/catalog'
import { getSetting, K, getNetWorth } from '../electron/services/settings'
import * as lock from '../electron/services/lock'
import { registerAllIpc, missingHandlers } from '../electron/ipc'
import { callChannel, invokeChannel, handle, clearHandlersForTests } from '../electron/ipc/register'
import { z } from 'zod'
import { AppError } from '../shared/errors'
import { periodRange } from '../shared/dates'
import { savingsRate, round2, formatMoney } from '../shared/money'
import { buildBootstrap } from '../electron/ipc/core'
import { isLocked } from '../electron/security/lockState'

let db: Db
beforeEach(() => {
  db = freshDb()
})

const txn = (over: Partial<Parameters<typeof insertTransaction>[0]> = {}) =>
  insertTransaction({ date: '2026-03-01', merchant: 'Chai Point', amount: 120, type: 'expense', account: 'Cash', source: 'manual', ...over })

describe('schema & migrations', () => {
  it('creates every required table and applies all migrations', () => {
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name)
    for (const t of ['transactions', 'tags', 'rules', 'settings', 'documents', 'import_history', 'schema_migrations']) expect(tables).toContain(t)
  })

  it('is idempotent: running migrations again changes nothing and never drops data', () => {
    txn()
    const r = runMigrations(db)
    expect(r.from).toBe(r.to)
    expect(count(db, 'transactions')).toBe(1)
  })

  it('upgrades a version-1 database in place and keeps its rows', () => {
    const old = new Db(':memory:')
    old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL)')
    MIGRATIONS[0].up(old)
    old.run('INSERT INTO schema_migrations VALUES (1, ?, ?)', 'initial', 'now')
    old.run(
      "INSERT INTO transactions (id,date,merchant,category,amount,type,account,tags,receipt,source,fingerprint,createdAt,updatedAt) VALUES ('x','2026-01-01','Old row','Other',5,'expense','Cash','[]',0,'manual','fp1','t','t')"
    )
    expect(runMigrations(old)).toEqual({ from: 1, to: LATEST_SCHEMA_VERSION })
    const row = old.get<{ merchant: string; memo: string; isTransfer: number }>('SELECT merchant, memo, isTransfer FROM transactions')
    expect(row).toMatchObject({ merchant: 'Old row', memo: '', isTransfer: 0 })
  })

  it('refuses a database created by a newer version', () => {
    db.run('INSERT INTO schema_migrations VALUES (?, ?, ?)', LATEST_SCHEMA_VERSION + 1, 'future', 'now')
    expect(() => runMigrations(db)).toThrow(/newer version/)
  })
})

describe('first launch', () => {
  it('seeds category and account DEFINITIONS only — no financial records', () => {
    expect(count(db, 'transactions')).toBe(0)
    expect(count(db, 'documents')).toBe(0)
    expect(count(db, 'rules')).toBe(0)
    expect(count(db, 'tags')).toBe(0)
    expect(count(db, 'import_history')).toBe(0)
    const boot = buildBootstrap()
    expect(boot.categories).toContain('Needs review')
    expect(boot.accounts.map((a) => a.name)).toEqual(['Main Checking', 'Everyday Visa', 'Rewards Card', 'Cash'])
    expect(boot.accounts.every((a) => a.openingBalance === null)).toBe(true)
    expect(getSetting(K.budgets, null)).toEqual([])
    expect(getSetting(K.goals, null)).toEqual([])
    expect(getSetting(K.recurringDecisions, null)).toEqual({})
    expect(boot.netWorth).toEqual({ configured: false, assets: 0, liabilities: 0 })
    expect(boot.selectedPeriod).toBe('all-time')
    expect(boot.freshStart).toBe(true)
    expect(boot.counts).toEqual({ transactions: 0, documents: 0 })
  })
})

describe('transactions store', () => {
  it('inserts, reads back and stores amounts as positive magnitudes', () => {
    const t = txn({ merchant: '  Chai   Point ', tags: ['Weekend', 'weekend', ' Family '] })
    expect(t).toMatchObject({ merchant: 'Chai   Point', amount: 120, type: 'expense', category: 'Needs review', tags: ['Weekend', 'Family'], isTransfer: false })
    expect((getTransactionById(t.id) as unknown as Record<string, unknown>).fingerprint).toBeUndefined()
    expect(count(db, 'tags')).toBe(2)
    expect(getSetting(K.freshStart, true)).toBe(false)
  })

  it('validates input', () => {
    expect(() => txn({ amount: 0 })).toThrow(/greater than zero/)
    expect(() => txn({ amount: -5 })).toThrow(/greater than zero/)
    expect(() => txn({ amount: Number.NaN })).toThrow()
    expect(() => txn({ merchant: '   ' })).toThrow(/Merchant/)
    expect(() => txn({ date: '2026-02-30' })).toThrow(/valid date/)
    expect(() => txn({ type: 'transfer' as never })).toThrow()
  })

  it('refuses duplicates (same date, merchant, amount, account) unless explicitly allowed', () => {
    txn()
    expect(() => txn({ merchant: 'CHAI POINT' })).toThrowError(/already exists/)
    expect(() => txn({ merchant: '  chai   point ' })).toThrowError(/already exists/)
    expect(count(db, 'transactions')).toBe(1)
  })

  it('allowDuplicate stores a distinct #N fingerprint', () => {
    const a = txn()
    const b = insertTransaction({ date: '2026-03-01', merchant: 'chai point', amount: 120, type: 'expense', account: 'cash', source: 'manual' }, { allowDuplicate: true })
    expect(b.id).not.toBe(a.id)
    const fps = db.all<{ fingerprint: string }>('SELECT fingerprint FROM transactions ORDER BY createdAt').map((r) => r.fingerprint)
    expect(fps[0]).toBe('2026-03-01|chai point|120.00|cash')
    expect(fps[1]).toBe('2026-03-01|chai point|120.00|cash#2')
  })

  it('database UNIQUE constraint blocks duplicates even if UI checks are bypassed', () => {
    txn()
    expect(() =>
      db.run(
        "INSERT INTO transactions (id,date,merchant,category,amount,type,account,tags,receipt,source,fingerprint,createdAt,updatedAt) VALUES ('z','2026-03-01','Chai Point','x',120,'expense','Cash','[]',0,'manual',?, 't','t')",
        baseFingerprint('2026-03-01', 'Chai Point', 120, 'Cash')
      )
    ).toThrow(/UNIQUE/)
  })

  it('CHECK constraints reject a negative amount or unknown type at the database level', () => {
    const ins = (amount: number, type: string, fp: string) =>
      db.run("INSERT INTO transactions (id,date,merchant,category,amount,type,account,tags,receipt,source,fingerprint,createdAt,updatedAt) VALUES (?, '2026-01-01','m','c',?,?,'a','[]',0,'s',?,'t','t')", fp, amount, type, fp)
    expect(() => ins(-1, 'expense', 'f1')).toThrow()
    expect(() => ins(1, 'transfer', 'f2')).toThrow()
  })

  it('insertBatch skips rows whose fingerprint exists and reports counts', () => {
    const mk = (m: string, n = 1) => ({
      date: '2026-04-01', merchant: m, amount: 10, type: 'expense' as const, account: 'Cash', source: 'csv',
      fingerprint: n > 1 ? `${baseFingerprint('2026-04-01', m, 10, 'Cash')}#${n}` : baseFingerprint('2026-04-01', m, 10, 'Cash')
    })
    expect(insertBatch([mk('A'), mk('B'), mk('A', 2)])).toEqual({ inserted: 3, duplicates: 0 })
    expect(insertBatch([mk('A'), mk('C'), mk('A', 2)])).toEqual({ inserted: 1, duplicates: 2 })
    expect(count(db, 'transactions')).toBe(4)
    expect(existingFingerprints([mk('A').fingerprint, 'nope']).size).toBe(1)
  })

  it('insertBatch is atomic: one invalid row rolls the whole batch back', () => {
    const good = { date: '2026-04-01', merchant: 'Good', amount: 10, type: 'expense' as const, account: 'Cash', source: 'csv', fingerprint: 'g1' }
    const bad = { ...good, merchant: 'Bad', amount: -1, fingerprint: 'b1' }
    expect(() => insertBatch([good, bad])).toThrow()
    expect(count(db, 'transactions')).toBe(0)
  })

  it('normalizeTags trims, de-duplicates and enforces limits', () => {
    expect(normalizeTags([' a ', 'A', 'b', ''])).toEqual(['a', 'b'])
    expect(() => normalizeTags(['x'.repeat(41)])).toThrow(/at most/)
  })

  it('refingerprint keeps uniqueness after edits', () => {
    const a = txn({ merchant: 'One' })
    const b = txn({ merchant: 'Two' })
    db.run("UPDATE transactions SET merchant = 'One' WHERE id = ?", b.id)
    refingerprintTransactions([b.id])
    expect(db.get<{ fingerprint: string }>('SELECT fingerprint FROM transactions WHERE id = ?', b.id)!.fingerprint).toMatch(/#2$/)
    expect(a.id).not.toBe(b.id)
  })
})

describe('catalog: categories', () => {
  it('adds, nests and de-duplicates categories', () => {
    expect(catalog.addCategory({ name: 'Food' })).toContain('Food')
    expect(catalog.addCategory({ name: 'Dining', parent: 'Food' })).toContain('Food:Dining')
    expect(() => catalog.addCategory({ name: 'food' })).toThrow(/already exists/)
    expect(() => catalog.addCategory({ name: '' })).toThrow(/empty/)
    expect(() => catalog.addCategory({ name: 'A:B' })).toThrow(/cannot contain/)
    expect(() => catalog.addCategory({ name: 'X', parent: 'Nope' })).toThrow(/does not exist/)
  })

  it('removing a category never rewrites historical transaction labels', () => {
    catalog.addCategory({ name: 'Food' })
    txn({ category: 'Food' })
    catalog.removeCategory('Food')
    expect(catalog.listCategories()).not.toContain('Food')
    expect(db.scalar<string>('SELECT category FROM transactions')).toBe('Food')
    const info = catalog.categoriesWithUsage().find((c) => c.name === 'Food')
    expect(info).toMatchObject({ managed: false, count: 1 })
  })

  it('protects the Needs review category', () => {
    expect(() => catalog.removeCategory('Needs review')).toThrow(/cannot be removed/)
    expect(() => catalog.renameCategory('Needs review', 'X')).toThrow(/cannot be renamed/)
  })

  it('renaming updates transactions, rules, budgets and subcategories', () => {
    catalog.addCategory({ name: 'Food' })
    catalog.addCategory({ name: 'Dining', parent: 'Food' })
    txn({ category: 'Food' })
    txn({ category: 'Food:Dining', merchant: 'Other place' })
    db.run("INSERT INTO rules (id, whenText, thenText, enabled, createdAt, updatedAt) VALUES ('r','tea','Food',1,'t','t')")
    const res = catalog.renameCategory('Food', 'Meals')
    expect(res).toMatchObject({ transactions: 2, rules: 1 })
    expect(catalog.listCategories()).toEqual(expect.arrayContaining(['Meals', 'Meals:Dining']))
    expect(db.all<{ category: string }>('SELECT category FROM transactions ORDER BY merchant').map((r) => r.category).sort()).toEqual(['Meals', 'Meals:Dining'])
    expect(db.scalar<string>("SELECT thenText FROM rules WHERE id='r'")).toBe('Meals')
  })

  it('ensureCategory creates missing categories (and parents) explicitly', () => {
    expect(catalog.ensureCategory('Gifts:Birthday')).toBe('Gifts:Birthday')
    expect(catalog.listCategories()).toEqual(expect.arrayContaining(['Gifts', 'Gifts:Birthday']))
    expect(catalog.ensureCategory('gifts')).toBe('Gifts')
  })
})

describe('catalog: accounts & tags', () => {
  it('creates accounts; opening balance is only what the user entered', () => {
    const a = catalog.createAccount({ name: 'HDFC Savings', type: 'bank' })
    expect(a.openingBalance).toBeNull()
    const b = catalog.createAccount({ name: 'Wallet', type: 'wallet', openingBalance: 250.5 })
    expect(b.openingBalance).toBe(250.5)
    expect(() => catalog.createAccount({ name: 'hdfc savings' })).toThrow(/already exists/)
  })

  it('renaming an account updates its transactions and keeps fingerprints consistent', () => {
    const acc = catalog.createAccount({ name: 'Old Name', type: 'bank' })
    const t = txn({ account: 'Old Name' })
    catalog.updateAccount(acc.id, { name: 'New Name' })
    expect(getTransactionById(t.id)?.account).toBe('New Name')
    expect(db.get<{ fingerprint: string }>('SELECT fingerprint FROM transactions')!.fingerprint).toContain('|new name')
    // removing the account definition leaves the transaction label alone
    catalog.removeAccount(acc.id)
    expect(getTransactionById(t.id)?.account).toBe('New Name')
  })

  it('tags need only a name; deleting can also strip them from transactions', () => {
    expect(catalog.createTag(' Weekend ')).toBe('Weekend')
    expect(catalog.createTag('weekend')).toBe('Weekend')
    txn({ tags: ['Weekend', 'Family'] })
    txn({ merchant: 'Other', tags: ['weekend'] })
    const usage = catalog.listTagUsage()
    expect(usage.find((u) => u.name === 'Weekend')?.count).toBe(2)
    expect(catalog.deleteTag('Weekend', true)).toEqual({ removedFrom: 2 })
    expect(db.all<{ tags: string }>('SELECT tags FROM transactions ORDER BY merchant').map((r) => JSON.parse(r.tags))).toEqual([['Family'], []])
    expect(catalog.listTagUsage().map((u) => u.name)).toEqual(['Family'])
    // keep historical tags when asked
    expect(catalog.deleteTag('Family', false)).toEqual({ removedFrom: 0 })
    expect(JSON.parse(db.scalar<string>("SELECT tags FROM transactions WHERE merchant='Chai Point'")!)).toEqual(['Family'])
  })
})

describe('preferences, period, net worth', () => {
  it('net worth is "not configured" until the user saves assets & liabilities', () => {
    expect(getNetWorth().configured).toBe(false)
    expect(catalog.saveNetWorth({ assets: 1000, liabilities: 250 })).toEqual({ configured: true, assets: 1000, liabilities: 250 })
    expect(() => catalog.saveNetWorth({ assets: -1, liabilities: 0 })).toThrow()
    expect(catalog.clearNetWorth().configured).toBe(false)
  })

  it('persists preferences and the selected period in SQLite', () => {
    expect(catalog.savePreferences({ theme: 'dark', currency: 'USD' })).toMatchObject({ theme: 'dark', currency: 'USD', dateFormat: 'DD/MM/YYYY' })
    expect(() => catalog.savePreferences({ currency: 'XXX' })).toThrow()
    expect(catalog.savePeriod('last-3-months')).toBe('last-3-months')
    expect(buildBootstrap().selectedPeriod).toBe('last-3-months')
  })
})

describe('dates & money helpers', () => {
  const now = new Date(2026, 10, 5) // 5 Nov 2026
  it('computes period ranges', () => {
    expect(periodRange('all-time', now)).toEqual({ from: null, to: null })
    expect(periodRange('this-month', now)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('last-month', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(periodRange('last-3-months', now)).toEqual({ from: '2026-08-06', to: '2026-11-05' })
    expect(periodRange('last-6-months', now)).toEqual({ from: '2026-05-06', to: '2026-11-05' })
    expect(periodRange('this-year', now)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
  it('savings rate never divides by zero', () => {
    expect(savingsRate(0, 500)).toBe(0)
    expect(savingsRate(1000, 250)).toBe(75)
    expect(savingsRate(1000, 1500)).toBe(-50)
  })
  it('rounds and formats currency', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(formatMoney(1234567.5, 'INR')).toBe('₹12,34,567.50')
    expect(formatMoney(-18, 'USD')).toBe('−$18.00')
  })
})

describe('IPC wrapper', () => {
  beforeEach(() => {
    clearHandlersForTests()
  })

  it('validates input and returns friendly errors, never stack traces', async () => {
    handle('t.add', z.object({ n: z.number().gt(0, 'Amount must be greater than zero.') }), ({ n }) => n * 2)
    expect(await invokeChannel('t.add', { n: 2 })).toEqual({ ok: true, data: 4 })
    expect(await invokeChannel('t.add', { n: 0 })).toMatchObject({ ok: false, error: { code: 'VALIDATION', message: 'Amount must be greater than zero.' } })
    expect(await invokeChannel('t.add', { n: 'x' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('t.add', 'garbage')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('nope')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('maps thrown errors without leaking internals', async () => {
    handle('t.app', z.undefined(), () => {
      throw new AppError('NOT_FOUND', 'That item does not exist.')
    })
    handle('t.boom', z.undefined(), () => {
      throw new Error('secret merchant name leaked here')
    })
    handle('t.sql', z.undefined(), () => db.run('INSERT INTO transactions (id) VALUES (1)'))
    expect(await invokeChannel('t.app')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: 'That item does not exist.' } })
    const boom = await invokeChannel('t.boom')
    expect(JSON.stringify(boom)).not.toContain('secret')
    expect(boom).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    const sql = await invokeChannel('t.sql')
    expect(sql).toMatchObject({ ok: false, error: { code: 'DB' } })
    expect(JSON.stringify(sql)).not.toMatch(/NOT NULL|transactions\./)
  })

  it('registers the foundation channels and works end to end', async () => {
    registerAllIpc()
    const boot = await callChannel<ReturnType<typeof buildBootstrap>>('catalog.bootstrap')
    expect(boot.counts.transactions).toBe(0)
    await callChannel('categories.add', { name: 'Food' })
    await expect(callChannel('categories.add', { name: 'food' })).rejects.toThrow(/already exists/)
    await expect(callChannel('catalog.setNetWorth', { assets: 'many', liabilities: 0 })).rejects.toThrow()
    await expect(callChannel('tags.create', { name: '   ' })).rejects.toThrow(/empty/)
    // every method in the shared contract that has a handler is wired; stubs for unbuilt areas are tolerated here
    expect(missingHandlers().filter((c) => /^(app|lock|catalog|categories|accounts|tags)\./.test(c))).toEqual([])
  })
})

describe('application lock', () => {
  it('locks, throttles wrong PINs, unlocks and blocks IPC while locked', async () => {
    clearHandlersForTests()
    registerAllIpc()
    expect(() => lock.setPin('12')).toThrow(/at least 4/)
    lock.setPin('1234')
    lock.initLockOnStartup()
    expect(isLocked()).toBe(true)
    expect(await invokeChannel('catalog.bootstrap')).toMatchObject({ ok: false, error: { code: 'LOCKED' } })
    expect(await invokeChannel('lock.status')).toMatchObject({ ok: true, data: { enabled: true, locked: true } })
    expect(() => lock.unlock('0000')).toThrow(/not the correct/)
    expect(lock.unlock('1234').locked).toBe(false)
    expect(await invokeChannel('catalog.bootstrap')).toMatchObject({ ok: true })
    lock.lockNow()
    expect(isLocked()).toBe(true)
    lock.unlock('1234')
    expect(() => lock.setPin('5678', 'wrong')).toThrow(/current PIN/)
    lock.setPin('5678', '1234')
    expect(() => lock.removePin('1234')).toThrow()
    expect(lock.removePin('5678').enabled).toBe(false)
  })
})
