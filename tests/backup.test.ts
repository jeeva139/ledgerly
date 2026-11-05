import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({ failOpenOnce: false }))
// Lets one test make the first database re-open fail (to prove restore rolls back); otherwise delegates.
vi.mock('../electron/database/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/database/db')>()
  return {
    ...actual,
    openDatabase: (...args: Parameters<typeof actual.openDatabase>) => {
      if (control.failOpenOnce) {
        control.failOpenOnce = false
        throw new Error('simulated open failure')
      }
      return actual.openDatabase(...args)
    }
  }
})

import { setupDataDir, teardownDataDir, readZip, rewriteZip, writeZip } from './fileDb'
import { getDb } from '../electron/database/db'
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from '../electron/database/migrations'
import { paths } from '../electron/database/paths'
import { Db } from '../electron/database/sqlite'
import { insertTransaction } from '../electron/database/txnStore'
import { storeDocument } from '../electron/documents/vault'
import { setDialogProvider } from '../electron/platform/dialogs'
import { registerBackupIpc } from '../electron/ipc/backup'
import { callChannel, clearHandlersForTests, invokeChannel } from '../electron/ipc/register'
import { addCategory } from '../electron/services/catalog'
import { createTag } from '../electron/services/catalog'
import { getSetting } from '../electron/services/settings'
import type { BackupCreateResult, BackupFileInfo, BackupInspectResult, RestoreResult } from '../shared/api/backup'

let dir: string
beforeEach(() => {
  dir = setupDataDir('ledgerly-backup')
  clearHandlersForTests()
  registerBackupIpc()
  control.failOpenOnce = false
})
afterEach(() => teardownDataDir(dir))

const sha = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex')
const PDF_BYTES = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 31) % 251))

function seed() {
  addCategory({ name: 'Food' })
  createTag('Weekend')
  insertTransaction({ date: '2026-03-01', merchant: 'Chai Point', category: 'Food', amount: 120, type: 'expense', account: 'Cash', tags: ['Weekend'], source: 'manual' })
  insertTransaction({ date: '2026-03-02', merchant: 'Salary', category: 'Income', amount: 50000, type: 'income', account: 'Main Checking', source: 'manual' })
  getDb().run("INSERT INTO rules (id, whenText, thenText, enabled, createdAt, updatedAt, priority) VALUES ('r1','tea','Food',1,'t','t',1)")
  storeDocument({ filename: 'receipt.pdf', bytes: PDF_BYTES, kind: 'receipt', source: 'upload' })
  storeDocument({ filename: 'notes.txt', bytes: new Uint8Array(Buffer.from('some notes')), kind: 'other', source: 'upload' })
}

function snapshot() {
  const db = getDb()
  const docs: Record<string, string> = {}
  for (const r of db.all<{ filename: string; objectPath: string }>('SELECT filename, objectPath FROM documents ORDER BY filename')) {
    docs[r.filename] = sha(fs.readFileSync(path.join(paths.documents(), ...r.objectPath.split('/'))))
  }
  return {
    transactions: db.all('SELECT date, merchant, category, amount, type, account, tags, fingerprint FROM transactions ORDER BY date, merchant'),
    settings: db.all<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key'),
    tags: db.all('SELECT name FROM tags ORDER BY name'),
    rules: db.all('SELECT whenText, thenText, priority FROM rules ORDER BY id'),
    docRows: db.all('SELECT filename, mimeType, size, kind FROM documents ORDER BY filename'),
    docs
  }
}

const backupNow = () => callChannel<BackupCreateResult>('backup.create', { destination: 'backups-folder' })
const inspectByName = (name: string) => callChannel<BackupInspectResult | null>('backup.inspect', { name })

describe('create & list', () => {
  it('writes a .ledgerlybackup package with manifest, database snapshot and every document', async () => {
    seed()
    const res = await backupNow()
    expect(res.saved).toBe(true)
    expect(res.name).toMatch(/^Ledgerly_Backup_\d{4}-\d{2}-\d{2}\.ledgerlybackup$/)
    expect(res.summary).toMatchObject({ schemaVersion: LATEST_SCHEMA_VERSION, counts: { transactions: 2, documents: 2, rules: 1, tags: 1 }, documentFiles: 2 })
    expect(JSON.stringify(res)).not.toContain(dir.replace(/\\/g, '\\\\'))

    const entries = await readZip(path.join(paths.backups(), res.name))
    const names = entries.map((e) => e.name).sort()
    expect(names.filter((n) => !n.startsWith('documents/'))).toEqual(['ledgerly.db', 'manifest.json'])
    expect(names.filter((n) => n.startsWith('documents/other/') || n.startsWith('documents/receipts/'))).toHaveLength(2)
    const manifest = JSON.parse(entries.find((e) => e.name === 'manifest.json')!.data.toString())
    expect(manifest).toMatchObject({ format: 'ledgerly-backup', formatVersion: 1, documentFiles: 2 })
    expect(manifest.database.sha256).toBe(sha(entries.find((e) => e.name === 'ledgerly.db')!.data))

    const list = await callChannel<BackupFileInfo[]>('backup.list')
    expect(list.map((b) => b.name)).toEqual([res.name])
    expect(list[0].size).toBeGreaterThan(0)
  })

  it('a second backup on the same day gets a distinct name', async () => {
    const a = await backupNow()
    const b = await backupNow()
    expect(a.name).not.toBe(b.name)
    expect(await callChannel<BackupFileInfo[]>('backup.list')).toHaveLength(2)
  })

  it('"ask" uses the native save dialog, appends the extension, and cancelling saves nothing', async () => {
    seed()
    const chosen = path.join(dir, 'my-copy')
    setDialogProvider({ openFile: async () => null, saveFile: async () => chosen, openPath: async () => '', openFolder: async () => '' })
    const res = await callChannel<BackupCreateResult>('backup.create', { destination: 'ask' })
    expect(res).toMatchObject({ saved: true, name: 'my-copy.ledgerlybackup' })
    expect(fs.existsSync(`${chosen}.ledgerlybackup`)).toBe(true)
    expect(fs.existsSync(`${chosen}.ledgerlybackup.part`)).toBe(false)
    setDialogProvider({ openFile: async () => null, saveFile: async () => null, openPath: async () => '', openFolder: async () => '' })
    expect(await callChannel('backup.create', { destination: 'ask' })).toMatchObject({ saved: false })
  })
})

describe('restore round trip', () => {
  it('restores rows, settings, rules, tags and document bytes exactly — and makes a safety backup first', async () => {
    seed()
    const before = snapshot()
    const { name } = await backupNow()

    // Change everything after the backup was taken.
    getDb().run('DELETE FROM transactions')
    getDb().run('DELETE FROM rules')
    getDb().run("UPDATE settings SET value = '[\"Only\"]' WHERE key = 'categories'")
    getDb().run("DELETE FROM documents WHERE filename = 'receipt.pdf'")
    fs.rmSync(path.join(paths.documents(), 'receipts'), { recursive: true, force: true })
    fs.mkdirSync(path.join(paths.documents(), 'receipts'), { recursive: true })
    const notes = getDb().get<{ objectPath: string }>("SELECT objectPath FROM documents WHERE filename = 'notes.txt'")!
    fs.writeFileSync(path.join(paths.documents(), ...notes.objectPath.split('/')), 'edited after the backup')
    insertTransaction({ date: '2026-09-09', merchant: 'Post-backup', amount: 1, type: 'expense', account: 'Cash', source: 'manual' })
    const mutated = snapshot()
    expect(mutated).not.toEqual(before)

    const inspected = (await inspectByName(name))!
    expect(inspected.summary.counts.transactions).toBe(2)
    const res = await callChannel<RestoreResult>('backup.restore', { token: inspected.token })
    expect(res.restored).toBe(true)
    expect(res.safetyBackupName).toMatch(/^Ledgerly_SafetyBackup_before-restore_/)

    expect(snapshot()).toEqual(before)
    expect(getSetting<string[]>('categories', [])).toContain('Food')

    // The safety backup holds the state we replaced.
    const safety = (await inspectByName(res.safetyBackupName!))!
    expect(safety.summary.counts.transactions).toBe(1)

    // No staging or pre-restore leftovers.
    expect(fs.readdirSync(dir).filter((f) => f.includes('pre-restore'))).toEqual([])
    expect(fs.readdirSync(paths.tmp())).toEqual([])
    // Database remains usable.
    insertTransaction({ date: '2026-10-10', merchant: 'After restore', amount: 2, type: 'expense', account: 'Cash', source: 'manual' })
    expect(getDb().scalar('SELECT COUNT(*) FROM transactions')).toBe(3)
  })

  it('safetyBackup:false skips the safety copy', async () => {
    seed()
    const { name } = await backupNow()
    const inspected = (await inspectByName(name))!
    const res = await callChannel<RestoreResult>('backup.restore', { token: inspected.token, safetyBackup: false })
    expect(res.safetyBackupName).toBeNull()
    expect((await callChannel<BackupFileInfo[]>('backup.list')).map((b) => b.name)).toEqual([name])
  })

  it('a restore token is single-use and unknown tokens are refused', async () => {
    const { name } = await backupNow()
    const inspected = (await inspectByName(name))!
    await callChannel('backup.restore', { token: inspected.token, safetyBackup: false })
    expect(await invokeChannel('backup.restore', { token: inspected.token })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await invokeChannel('backup.restore', { token: 'deadbeefdeadbeefdeadbeef' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('inspect via the open dialog works, and cancelling returns null', async () => {
    seed()
    const { name } = await backupNow()
    const file = path.join(paths.backups(), name)
    setDialogProvider({ openFile: async () => [file], saveFile: async () => null, openPath: async () => '', openFolder: async () => '' })
    const inspected = (await callChannel<BackupInspectResult | null>('backup.inspect'))!
    expect(inspected.fileName).toBe(name)
    expect(inspected.summary.counts.documents).toBe(2)
    setDialogProvider({ openFile: async () => null, saveFile: async () => null, openPath: async () => '', openFolder: async () => '' })
    expect(await callChannel('backup.inspect')).toBeNull()
  })

  it('older backups (schema v1) restore and are migrated forward', async () => {
    const old = path.join(dir, 'old.db')
    const db = new Db(old)
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL)')
    MIGRATIONS[0].up(db)
    db.run("INSERT INTO schema_migrations VALUES (1, 'initial', 'now')")
    db.run(
      "INSERT INTO transactions (id,date,merchant,category,amount,type,account,tags,receipt,source,fingerprint,createdAt,updatedAt) VALUES ('x','2025-01-01','Legacy row','Other',9,'expense','Cash','[]',0,'manual','fp','t','t')"
    )
    db.close()
    const dbBytes = fs.readFileSync(old)
    const pkg = path.join(dir, 'legacy.ledgerlybackup')
    await writeZip(pkg, [
      { name: 'ledgerly.db', data: dbBytes },
      {
        name: 'manifest.json',
        data: Buffer.from(JSON.stringify({
          format: 'ledgerly-backup', formatVersion: 1, appVersion: '0.9.0', schemaVersion: 1, createdAt: new Date().toISOString(),
          database: { file: 'ledgerly.db', size: dbBytes.length, sha256: sha(dbBytes) }, counts: { transactions: 1, documents: 0, rules: 0, tags: 0 }, documentFiles: 0
        }))
      }
    ])
    setDialogProvider({ openFile: async () => [pkg], saveFile: async () => null, openPath: async () => '', openFolder: async () => '' })
    const inspected = (await callChannel<BackupInspectResult | null>('backup.inspect'))!
    expect(inspected.summary.schemaVersion).toBe(1)
    await callChannel('backup.restore', { token: inspected.token, safetyBackup: false })
    expect(getDb().get<{ merchant: string; memo: string }>('SELECT merchant, memo FROM transactions')).toEqual({ merchant: 'Legacy row', memo: '' })
    expect(getDb().scalar('SELECT MAX(version) FROM schema_migrations')).toBe(LATEST_SCHEMA_VERSION)
    expect(getSetting('categories', [])).not.toEqual([]) // starter definitions seeded for a package that had none
  })
})

describe('invalid packages are rejected and nothing changes', () => {
  let taken: string | null = null
  beforeEach(() => {
    taken = null
  })
  async function validBackup(): Promise<string> {
    if (taken) return taken
    seed()
    const { name } = await backupNow()
    taken = path.join(paths.backups(), name)
    return taken
  }
  const reject = async (file: string, message: RegExp) => {
    setDialogProvider({ openFile: async () => [file], saveFile: async () => null, openPath: async () => '', openFolder: async () => '' })
    const before = snapshot()
    const res = await invokeChannel('backup.inspect')
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect((res as { error: { message: string } }).error.message).toMatch(message)
    expect(snapshot()).toEqual(before)
  }

  it('garbage / non-zip / empty files', async () => {
    await validBackup()
    const junk = path.join(dir, 'junk.ledgerlybackup')
    fs.writeFileSync(junk, 'this is not a zip file at all')
    await reject(junk, /not a valid Ledgerly backup/)
    const empty = path.join(dir, 'empty.ledgerlybackup')
    fs.writeFileSync(empty, '')
    await reject(empty, /not a valid Ledgerly backup/)
    const truncated = path.join(dir, 'truncated.ledgerlybackup')
    fs.writeFileSync(truncated, fs.readFileSync(await validBackup()).subarray(0, 400))
    await reject(truncated, /not a valid Ledgerly backup/)
  })

  it('a zip with no manifest or database', async () => {
    await validBackup()
    const odd = path.join(dir, 'odd.ledgerlybackup')
    await writeZip(odd, [{ name: 'documents/other/a.txt', data: Buffer.from('x') }])
    await reject(odd, /not a valid Ledgerly backup/)
  })

  it('a tampered manifest hash or a swapped database fails the integrity check', async () => {
    const good = await validBackup()
    const badHash = path.join(dir, 'badhash.ledgerlybackup')
    await rewriteZip(good, badHash, (entries) =>
      entries.map((e) => {
        if (e.name !== 'manifest.json') return e
        const m = JSON.parse(e.data.toString())
        m.database.sha256 = 'a'.repeat(64)
        return { name: e.name, data: Buffer.from(JSON.stringify(m)) }
      })
    )
    await reject(badHash, /integrity check/)

    const swapped = path.join(dir, 'swapped.ledgerlybackup')
    await rewriteZip(good, swapped, (entries) => entries.map((e) => (e.name === 'ledgerly.db' ? { name: e.name, data: Buffer.concat([e.data, Buffer.from('x')]) } : e)))
    await reject(swapped, /integrity check/)
  })

  it('hostile entry names (path traversal, absolute, drive letters, unexpected files)', async () => {
    const good = await validBackup()
    for (const evil of ['../evil.txt', 'documents/../../evil.txt', '/abs/evil.txt', 'C:/evil.txt', 'evil.exe', 'documents/other/../../../evil.txt']) {
      const file = path.join(dir, `evil-${sha(Buffer.from(evil)).slice(0, 6)}.ledgerlybackup`)
      await rewriteZip(good, file, (entries) => [...entries, { name: evil, data: Buffer.from('boom') }])
      await reject(file, /not a valid Ledgerly backup/)
    }
    expect(fs.existsSync(path.join(path.dirname(dir), 'evil.txt'))).toBe(false)
  })

  it('a backup from a newer version of Ledgerly', async () => {
    const good = await validBackup()
    const newer = path.join(dir, 'newer.ledgerlybackup')
    await rewriteZip(good, newer, (entries) =>
      entries.map((e) => {
        if (e.name !== 'manifest.json') return e
        const m = JSON.parse(e.data.toString())
        m.schemaVersion = LATEST_SCHEMA_VERSION + 5
        return { name: e.name, data: Buffer.from(JSON.stringify(m)) }
      })
    )
    await reject(newer, /newer version of Ledgerly/)
  })

  it('a damaged database inside an otherwise consistent package is rejected before live data is touched', async () => {
    const good = await validBackup()
    const garbage = Buffer.alloc(8192, 7)
    const corrupt = path.join(dir, 'corrupt.ledgerlybackup')
    await rewriteZip(good, corrupt, (entries) =>
      entries.map((e) => {
        if (e.name === 'ledgerly.db') return { name: e.name, data: garbage }
        if (e.name === 'manifest.json') {
          const m = JSON.parse(e.data.toString())
          m.database = { file: 'ledgerly.db', size: garbage.length, sha256: sha(garbage) }
          return { name: e.name, data: Buffer.from(JSON.stringify(m)) }
        }
        return e
      })
    )
    setDialogProvider({ openFile: async () => [corrupt], saveFile: async () => null, openPath: async () => '', openFolder: async () => '' })
    const inspected = (await callChannel<BackupInspectResult | null>('backup.inspect'))!
    const before = snapshot()
    const res = await invokeChannel('backup.restore', { token: inspected.token, safetyBackup: false })
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect((res as { error: { message: string } }).error.message).toMatch(/Nothing has been changed|cannot be restored/)
    expect(snapshot()).toEqual(before)
    expect(fs.readdirSync(paths.tmp())).toEqual([])
  })

  it('backup names from the list cannot escape the backups folder', async () => {
    expect(await invokeChannel('backup.inspect', { name: '..\\..\\x.ledgerlybackup' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('backup.inspect', { name: 'notes.txt' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('backup.inspect', { name: 'missing.ledgerlybackup' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})

describe('restore failure rolls back', () => {
  it('if the restored database cannot be opened, the previous data is put back exactly', async () => {
    seed()
    const { name } = await backupNow()
    insertTransaction({ date: '2026-12-12', merchant: 'Newer than backup', amount: 3, type: 'expense', account: 'Cash', source: 'manual' })
    storeDocument({ filename: 'later.txt', bytes: new Uint8Array(Buffer.from('added after backup')), source: 'upload' })
    const before = snapshot()
    const inspected = (await inspectByName(name))!

    control.failOpenOnce = true
    const res = await invokeChannel('backup.restore', { token: inspected.token, safetyBackup: false })
    expect(res).toMatchObject({ ok: false })
    expect((res as { error: { message: string } }).error.message).toMatch(/previous data has been kept|could not restore/i)

    expect(snapshot()).toEqual(before)
    expect(fs.readdirSync(dir).filter((f) => f.includes('pre-restore'))).toEqual([])
    expect(fs.readdirSync(paths.tmp())).toEqual([])
    // and the app keeps working
    insertTransaction({ date: '2026-12-13', merchant: 'Still works', amount: 4, type: 'expense', account: 'Cash', source: 'manual' })
    expect(getDb().scalar('SELECT COUNT(*) FROM transactions')).toBe(4)
  })
})
