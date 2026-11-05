import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setupDataDir, teardownDataDir } from './fileDb'
import { getDb } from '../electron/database/db'
import { DOCUMENT_SUBDIRS, paths } from '../electron/database/paths'
import { insertTransaction } from '../electron/database/txnStore'
import { storeDocument } from '../electron/documents/vault'
import { registerBackupIpc } from '../electron/ipc/backup'
import { registerCoreIpc, buildBootstrap } from '../electron/ipc/core'
import { callChannel, clearHandlersForTests, invokeChannel } from '../electron/ipc/register'
import { addCategory, createTag, createAccount, saveNetWorth, savePeriod, savePreferences } from '../electron/services/catalog'
import { setPin } from '../electron/services/lock'
import { K, getSetting, setSetting } from '../electron/services/settings'
import { isLocked } from '../electron/security/lockState'
import { DATA_TABLES } from '../electron/services/dataWipe'
import { STARTER_ACCOUNT_DEFS, STARTER_CATEGORIES } from '../shared/types'
import type { BackupFileInfo } from '../shared/api/backup'

let dir: string
beforeEach(() => {
  dir = setupDataDir('ledgerly-wipe')
  clearHandlersForTests()
  registerCoreIpc()
  registerBackupIpc()
})
afterEach(() => teardownDataDir(dir))

function populate() {
  addCategory({ name: 'Food' })
  createTag('Weekend')
  createAccount({ name: 'HDFC Savings', type: 'bank', openingBalance: 1000 })
  saveNetWorth({ assets: 5000, liabilities: 100 })
  savePeriod('this-year')
  savePreferences({ theme: 'dark', currency: 'USD' })
  setSetting(K.budgets, [{ id: 'b', category: 'Food', monthlyLimit: 100, active: true, createdAt: 't' }])
  setSetting(K.goals, [{ id: 'g', name: 'Trip', targetAmount: 100, currentAmount: 1, dueDate: null, note: '', createdAt: 't' }])
  setSetting(K.recurringDecisions, { netflix: { status: 'keep' } })
  insertTransaction({ date: '2026-03-01', merchant: 'Chai Point', category: 'Food', amount: 120, type: 'expense', account: 'Cash', tags: ['Weekend'], source: 'manual' })
  getDb().run("INSERT INTO rules (id, whenText, thenText, enabled, createdAt, updatedAt) VALUES ('r1','tea','Food',1,'t','t')")
  getDb().run("INSERT INTO import_history (id, filename, format, createdAt) VALUES ('h1','bank.qif','qif','t')")
  storeDocument({ filename: 'receipt.pdf', bytes: new Uint8Array(Buffer.from('pdf')), kind: 'receipt', source: 'upload' })
  storeDocument({ filename: 'stmt.csv', bytes: new Uint8Array(Buffer.from('a,b')), source: 'import' })
  setPin('1234')
}

const tableCount = (t: string) => getDb().scalar<number>(`SELECT COUNT(*) FROM ${t}`)
const vaultFiles = () => DOCUMENT_SUBDIRS.flatMap((d) => fs.readdirSync(path.join(paths.documents(), d)))

describe('erase all data', () => {
  it('refuses anything but the exact word DELETE and deletes nothing', async () => {
    populate()
    for (const bad of ['', 'delete', 'DELETE ', 'Delete', 'yes', 'DELET']) {
      expect(await invokeChannel('data.eraseAll', { confirmation: bad })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    }
    expect(await invokeChannel('data.eraseAll', {})).toMatchObject({ ok: false })
    expect(tableCount('transactions')).toBe(1)
    expect(vaultFiles()).toHaveLength(2)
  })

  it('wipes every table and the whole vault, and the result equals a brand-new install', async () => {
    populate()
    expect(isLocked()).toBe(false)
    const res = await callChannel<{ safetyBackupName: string | null }>('data.eraseAll', { confirmation: 'DELETE', safetyBackup: false })
    expect(res.safetyBackupName).toBeNull()

    for (const t of DATA_TABLES.filter((t) => t !== 'settings')) expect(tableCount(t)).toBe(0)
    expect(vaultFiles()).toEqual([])
    for (const d of DOCUMENT_SUBDIRS) expect(fs.existsSync(path.join(paths.documents(), d))).toBe(true) // structure kept

    const boot = buildBootstrap()
    expect(boot.categories).toEqual(STARTER_CATEGORIES)
    expect(boot.accounts.map((a) => ({ name: a.name, type: a.type, openingBalance: a.openingBalance, active: a.active }))).toEqual(
      STARTER_ACCOUNT_DEFS.map((a) => ({ name: a.name, type: a.type, openingBalance: null, active: true }))
    )
    expect(boot).toMatchObject({
      tags: [],
      selectedPeriod: 'all-time',
      netWorth: { configured: false, assets: 0, liabilities: 0 },
      freshStart: true,
      lock: { enabled: false, locked: false },
      counts: { transactions: 0, documents: 0 },
      preferences: { theme: 'light', currency: 'INR', dateFormat: 'DD/MM/YYYY' }
    })
    expect(getSetting(K.budgets, null)).toEqual([])
    expect(getSetting(K.goals, null)).toEqual([])
    expect(getSetting(K.recurringDecisions, null)).toEqual({})
    expect(isLocked()).toBe(false)
  })

  it('settings after a wipe are exactly the set a fresh install writes', async () => {
    const fresh = getDb().all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key')
    // category / account ids are random, so compare keys and non-id values
    populate()
    await callChannel('data.eraseAll', { confirmation: 'DELETE' })
    const after = getDb().all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key')
    expect(after.map((s) => s.key)).toEqual(fresh.map((s) => s.key))
    expect(after.find((s) => s.key === 'categories')!.value).toBe(fresh.find((s) => s.key === 'categories')!.value)
  })

  it('keeps the schema, can be used straight away, and survives a second wipe', async () => {
    populate()
    await callChannel('data.eraseAll', { confirmation: 'DELETE' })
    insertTransaction({ date: '2026-05-05', merchant: 'Fresh start', amount: 10, type: 'expense', account: 'Cash', source: 'manual' })
    expect(getSetting(K.freshStart, true)).toBe(false)
    storeDocument({ filename: 'new.txt', bytes: new Uint8Array(Buffer.from('x')), source: 'upload' })
    await callChannel('data.eraseAll', { confirmation: 'DELETE' })
    expect(tableCount('transactions')).toBe(0)
    expect(vaultFiles()).toEqual([])
    expect(getSetting(K.freshStart, false)).toBe(true)
  })

  it('creates a restorable safety backup first when asked, and aborts without deleting if that fails', async () => {
    populate()
    const res = await callChannel<{ safetyBackupName: string | null }>('data.eraseAll', { confirmation: 'DELETE', safetyBackup: true })
    expect(res.safetyBackupName).toMatch(/^Ledgerly_SafetyBackup_before-erase_/)
    expect(tableCount('transactions')).toBe(0)
    const list = await callChannel<BackupFileInfo[]>('backup.list')
    expect(list.map((b) => b.name)).toContain(res.safetyBackupName)

    // The safety backup really contains the erased data.
    const inspected = await callChannel<{ token: string; summary: { counts: { transactions: number; documents: number } } }>('backup.inspect', { name: res.safetyBackupName })
    expect(inspected.summary.counts).toMatchObject({ transactions: 1, documents: 2 })
    await callChannel('backup.restore', { token: inspected.token, safetyBackup: false })
    expect(tableCount('transactions')).toBe(1)
    expect(vaultFiles()).toHaveLength(2)
    expect(getSetting(K.categories, [])).toContain('Food')
  })

  it('the lock screen state is cleared with the rest of the settings', async () => {
    populate()
    expect(buildBootstrap().lock.enabled).toBe(true)
    await callChannel('data.eraseAll', { confirmation: 'DELETE' })
    expect(buildBootstrap().lock.enabled).toBe(false)
  })
})
