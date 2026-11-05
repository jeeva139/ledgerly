// Backup / restore orchestration.
// Restore is staged: validate → extract to a temp folder → verify the staged database → (optional) safety backup →
// swap, keeping the old data as *.pre-restore until the restored database has opened and migrated successfully.
// Any failure rolls the previous data back, so current data is never partially destroyed.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { closeDatabase, openDatabase } from '../database/db'
import { LATEST_SCHEMA_VERSION } from '../database/migrations'
import { ensureDataLayout, paths } from '../database/paths'
import { Db } from '../database/sqlite'
import { dialogs } from '../platform/dialogs'
import { reloadWindows } from '../platform/events'
import { log } from '../logging/logger'
import { app } from '../ipc/electronApp'
import { initLockOnStartup } from '../services/lock'
import { resetFreshStartCache, seedDefaultsIfNeeded } from '../services/settings'
import { AppError } from '../../shared/errors'
import type { BackupCreateResult, BackupFileInfo, BackupInspectResult, RestoreResult } from '../../shared/api/backup'
import {
  BACKUP_EXTENSION, createPackage, extractPackage, inspectPackage, parseManifest, sha256OfFile, type InspectedPackage
} from './package'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stampWithTime = (d = new Date()) => `${stamp(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

function uniqueBackupPath(dir: string, baseName: string): string {
  let candidate = path.join(dir, `${baseName}${BACKUP_EXTENSION}`)
  if (!fs.existsSync(candidate)) return candidate
  candidate = path.join(dir, `${baseName}_${stampWithTime().split('_')[1]}${BACKUP_EXTENSION}`)
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${baseName}_${stampWithTime().split('_')[1]}_${n}${BACKUP_EXTENSION}`)
  return candidate
}

const FILTERS = [{ name: 'Ledgerly backup', extensions: ['ledgerlybackup'] }]

// ---- create / list ----------------------------------------------------------------------------

export async function createBackup(destination: 'ask' | 'backups-folder'): Promise<BackupCreateResult> {
  ensureDataLayout()
  const baseName = `Ledgerly_Backup_${stamp()}`
  let dest: string
  if (destination === 'backups-folder') {
    dest = uniqueBackupPath(paths.backups(), baseName)
  } else {
    const chosen = await dialogs().saveFile({
      title: 'Create Ledgerly backup',
      defaultPath: uniqueBackupPath(paths.backups(), baseName),
      filters: FILTERS
    })
    if (!chosen) return { saved: false, name: '', size: 0, summary: null }
    dest = chosen.toLowerCase().endsWith(BACKUP_EXTENSION) ? chosen : `${chosen}${BACKUP_EXTENSION}`
  }
  const summary = await createPackage(dest, app.version())
  log.info('backup.created', { documents: summary.documentFiles, transactions: summary.counts.transactions })
  return { saved: true, name: path.basename(dest), size: summary.size, summary }
}

/** Automatic safety copy placed in the backups folder. Returns its file name. */
export async function createSafetyBackup(reason: 'before-restore' | 'before-erase'): Promise<string> {
  ensureDataLayout()
  const dest = uniqueBackupPath(paths.backups(), `Ledgerly_SafetyBackup_${reason}_${stampWithTime()}`)
  await createPackage(dest, app.version())
  return path.basename(dest)
}

export function listBackups(): BackupFileInfo[] {
  const dir = paths.backups()
  if (!fs.existsSync(dir)) return []
  const out: BackupFileInfo[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(BACKUP_EXTENSION)) continue
    try {
      const st = fs.statSync(path.join(dir, name))
      if (st.isFile()) out.push({ name, size: st.size, createdAt: st.mtime.toISOString() })
    } catch {
      /* vanished while listing */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ---- inspect (token handshake) ------------------------------------------------------------------

interface Staged {
  file: string
  fileName: string
  inspected: InspectedPackage
  expires: number
}
const staged = new Map<string, Staged>()
const TOKEN_TTL_MS = 30 * 60 * 1000

function purgeTokens(): void {
  const now = Date.now()
  for (const [t, s] of staged) if (s.expires < now) staged.delete(t)
}

export async function inspectBackup(name?: string): Promise<BackupInspectResult | null> {
  purgeTokens()
  let file: string
  if (name !== undefined) {
    if (path.basename(name) !== name || !name.toLowerCase().endsWith(BACKUP_EXTENSION)) {
      throw new AppError('VALIDATION', 'Choose a backup from the list or select a .ledgerlybackup file.')
    }
    file = path.join(paths.backups(), name)
    if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 'That backup file could not be found.')
  } else {
    const picked = await dialogs().openFile({ title: 'Select a Ledgerly backup to restore', filters: FILTERS })
    if (!picked || picked.length === 0) return null
    file = picked[0]
  }
  const inspected = await inspectPackage(file)
  const token = randomBytes(16).toString('hex')
  staged.set(token, { file, fileName: path.basename(file), inspected, expires: Date.now() + TOKEN_TTL_MS })
  return { token, fileName: path.basename(file), summary: inspected.summary }
}

// ---- restore ----------------------------------------------------------------------------------

const REQUIRED_TABLES = ['transactions', 'tags', 'rules', 'settings', 'documents', 'schema_migrations']

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** rename with a few retries — antivirus / indexers can briefly hold files on Windows. */
function moveSync(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt < 5 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) sleepSync(150 * (attempt + 1))
      else throw e
    }
  }
}

function freeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}

/** Open the extracted database read-only and prove it is a healthy Ledgerly database. */
function verifyStagedDatabase(file: string): void {
  let db: Db | null = null
  try {
    db = new Db(file, { readOnly: true })
    const check = db.get<{ integrity_check: string }>('PRAGMA integrity_check')
    if (check?.integrity_check !== 'ok') throw new AppError('VALIDATION', 'The database inside this backup is damaged, so it cannot be restored.\n\nNothing has been changed.')
    const tables = new Set(db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name))
    for (const t of REQUIRED_TABLES) {
      if (!tables.has(t)) throw new AppError('VALIDATION', 'This file does not look like a Ledgerly backup (required data is missing).\n\nNothing has been changed.')
    }
    const version = db.scalar<number>('SELECT COALESCE(MAX(version), 0) FROM schema_migrations') ?? 0
    if (version > LATEST_SCHEMA_VERSION) {
      throw new AppError('VALIDATION', 'This backup was created by a newer version of Ledgerly. Please update Ledgerly to restore it.\n\nNothing has been changed.')
    }
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('VALIDATION', 'The database inside this backup could not be read, so it cannot be restored.\n\nNothing has been changed.')
  } finally {
    db?.close()
  }
}

function dbSidecars(dbFile: string): string[] {
  return [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]
}

export async function restoreBackup(token: string, safetyBackup: boolean): Promise<RestoreResult> {
  purgeTokens()
  const entry = staged.get(token)
  if (!entry) throw new AppError('NOT_FOUND', 'This restore request has expired. Please select the backup again.')
  staged.delete(token)
  if (!fs.existsSync(entry.file)) throw new AppError('NOT_FOUND', 'That backup file could not be found.')

  ensureDataLayout()
  // The file may have changed since it was inspected — validate again.
  const inspected = await inspectPackage(entry.file)

  const stagingDir = path.join(paths.tmp(), `restore-${Date.now()}`)
  let safetyName: string | null = null
  try {
    const free = freeBytes(paths.root())
    if (free !== null && free < inspected.uncompressedBytes * 1.1 + 50 * 1024 * 1024) {
      throw new AppError('IO', 'There is not enough free disk space to restore this backup.\n\nNothing has been changed.')
    }

    // 1) Extract + verify in the staging area. Live data is untouched so far.
    await extractPackage(entry.file, stagingDir)
    const stagedDb = path.join(stagingDir, 'ledgerly.db')
    const manifest = parseManifest(fs.readFileSync(path.join(stagingDir, 'manifest.json')))
    if ((await sha256OfFile(stagedDb)) !== manifest.database.sha256) {
      throw new AppError('VALIDATION', 'This backup failed its integrity check.\n\nNothing has been changed.')
    }
    verifyStagedDatabase(stagedDb)

    // 2) Safety backup of the current data (default on). If it fails we stop before touching anything.
    if (safetyBackup) safetyName = await createSafetyBackup('before-restore')

    // 3) Swap, with rollback.
    const live = paths.db()
    const docs = paths.documents()
    const suffix = `.pre-restore-${Date.now()}`
    const moved: { from: string; to: string }[] = []
    const stagedDocs = path.join(stagingDir, 'documents')

    closeDatabase()
    try {
      for (const f of dbSidecars(live)) {
        if (fs.existsSync(f)) {
          moveSync(f, f + suffix)
          moved.push({ from: f, to: f + suffix })
        }
      }
      if (fs.existsSync(docs)) {
        moveSync(docs, docs + suffix)
        moved.push({ from: docs, to: docs + suffix })
      }
      moveSync(stagedDb, live)
      if (fs.existsSync(stagedDocs)) moveSync(stagedDocs, docs)
      ensureDataLayout()

      openDatabase() // applies pending migrations to older backups
      seedDefaultsIfNeeded()
      resetFreshStartCache()
      initLockOnStartup()
    } catch (e) {
      // Roll back: discard whatever was put in place, restore the previous files, reopen the old database.
      try {
        closeDatabase()
      } catch {
        /* already closed */
      }
      for (const f of dbSidecars(live)) fs.rmSync(f, { force: true })
      fs.rmSync(docs, { recursive: true, force: true })
      for (const m of moved.reverse()) {
        try {
          moveSync(m.to, m.from)
        } catch {
          /* best effort — the .pre-restore copy stays on disk */
        }
      }
      ensureDataLayout()
      try {
        openDatabase()
        initLockOnStartup()
      } catch {
        /* surfaced below */
      }
      log.error('backup.restore-failed')
      if (e instanceof AppError) throw e
      throw new AppError('IO', 'Ledgerly could not restore this backup.\n\nYour previous data has been kept exactly as it was.')
    }

    // 4) Success: the previous copies are no longer needed.
    for (const m of moved) fs.rmSync(m.to, { recursive: true, force: true })
    log.info('backup.restored', { transactions: manifest.counts.transactions })
    reloadWindows()
    return { restored: true, safetyBackupName: safetyName, summary: inspected.summary }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
}

