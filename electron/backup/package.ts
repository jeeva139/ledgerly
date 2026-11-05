// `.ledgerlybackup` package: a zip with
//   manifest.json   format/app/schema version, counts, sha256 of the database snapshot
//   ledgerly.db     consistent snapshot of the SQLite database (settings, rules, categories, accounts, tags …)
//   documents/**    the document vault
// Reading is hardened: strict entry names, no traversal, size caps, hash verification.
import archiver from 'archiver'
import yauzl from 'yauzl'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getDb } from '../database/db'
import { LATEST_SCHEMA_VERSION } from '../database/migrations'
import { paths } from '../database/paths'
import { Db } from '../database/sqlite'
import { AppError } from '../../shared/errors'
import type { BackupCounts, BackupSummary } from '../../shared/api/backup'

export const BACKUP_EXTENSION = '.ledgerlybackup'
export const BACKUP_FORMAT = 'ledgerly-backup'
export const BACKUP_FORMAT_VERSION = 1

const MAX_ENTRIES = 200_000
const MAX_TOTAL_UNCOMPRESSED = 24 * 1024 ** 3
const MAX_MANIFEST_BYTES = 1024 * 1024
const INVALID_MESSAGE =
  'This file is not a valid Ledgerly backup. It may be damaged, incomplete, or created by another program.\n\nNothing has been changed.'

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  appVersion: string
  schemaVersion: number
  createdAt: string
  database: { file: 'ledgerly.db'; size: number; sha256: string }
  counts: BackupCounts
  documentFiles: number
}

const invalid = (detail?: string): AppError => new AppError('VALIDATION', INVALID_MESSAGE, detail)

// ---- helpers ---------------------------------------------------------------------------------

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(
    fs.createReadStream(file),
    new Writable({
      write(chunk, _enc, cb) {
        hash.update(chunk)
        cb()
      }
    })
  )
  return hash.digest('hex')
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else if (e.isFile() && !e.name.endsWith('.part')) out.push(r)
    }
  }
  if (fs.existsSync(root)) walk(root, '')
  return out
}

const ALREADY_COMPRESSED = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.xlsx'])

function countRows(db: Db, table: string): number {
  try {
    return db.scalar<number>(`SELECT COUNT(*) FROM ${table}`) ?? 0
  } catch {
    return 0
  }
}

export function countsOf(db: Db): BackupCounts {
  return {
    transactions: countRows(db, 'transactions'),
    documents: countRows(db, 'documents'),
    rules: countRows(db, 'rules'),
    tags: countRows(db, 'tags')
  }
}

// ---- create ----------------------------------------------------------------------------------

/** Write a complete backup package of the live data to `destFile` (atomically: .part then rename). */
export async function createPackage(destFile: string, appVersion: string): Promise<BackupSummary> {
  const tmpRoot = path.join(paths.tmp(), `backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(tmpRoot, { recursive: true })
  const part = `${destFile}.part`
  try {
    const snapshot = path.join(tmpRoot, 'ledgerly.db')
    getDb().vacuumInto(snapshot)
    const snap = new Db(snapshot, { readOnly: true })
    let counts: BackupCounts
    try {
      counts = countsOf(snap)
    } finally {
      snap.close()
    }
    const dbHash = await sha256OfFile(snapshot)
    const dbSize = fs.statSync(snapshot).size
    const docRoot = paths.documents()
    const docFiles = listFilesRecursive(docRoot)

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion,
      schemaVersion: LATEST_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      database: { file: 'ledgerly.db', size: dbSize, sha256: dbHash },
      counts,
      documentFiles: docFiles.length
    }

    fs.mkdirSync(path.dirname(destFile), { recursive: true })
    const output = fs.createWriteStream(part)
    const archive = archiver('zip', { zlib: { level: 6 } })
    const done = new Promise<void>((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
    })
    archive.pipe(output)
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })
    archive.file(snapshot, { name: 'ledgerly.db' })
    for (const rel of docFiles) {
      const store = ALREADY_COMPRESSED.has(path.extname(rel).toLowerCase())
      // `store` (no re-compression) is supported by archiver but missing from its type definitions.
      archive.file(path.join(docRoot, ...rel.split('/')), { name: `documents/${rel}`, store } as archiver.EntryData)
    }
    await archive.finalize()
    await done
    fs.renameSync(part, destFile)
    return {
      appVersion,
      schemaVersion: manifest.schemaVersion,
      createdAt: manifest.createdAt,
      counts,
      documentFiles: docFiles.length,
      size: fs.statSync(destFile).size
    }
  } catch (e) {
    fs.rmSync(part, { force: true })
    if (e instanceof AppError) throw e
    throw new AppError('IO', 'Ledgerly could not create the backup. Your data is unchanged.\n\nCheck that the destination has enough free space and is writable.')
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
}

// ---- read / validate -------------------------------------------------------------------------

function checkEntryName(name: string): void {
  if (name.length === 0 || name.length > 400) throw invalid('name length')
  if (name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name) || name.includes('\0')) throw invalid('absolute or windows path')
  const segments = name.replace(/\/$/, '').split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) throw invalid('traversal')
  const top = segments[0]
  if (top === 'manifest.json' || top === 'ledgerly.db') {
    if (segments.length !== 1 || name.endsWith('/')) throw invalid('unexpected top-level entry')
  } else if (top === 'documents') {
    // documents/ or documents/<sub>/…
  } else {
    throw invalid('unexpected entry')
  }
}

type OpenStream = () => Promise<Readable>

async function walkZip(file: string, onEntry: (entry: yauzl.Entry, open: OpenStream) => Promise<void>): Promise<void> {
  let zip: yauzl.ZipFile
  try {
    zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
      yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: true }, (err, z) =>
        err || !z ? reject(err ?? new Error('open failed')) : resolve(z)
      )
    )
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') throw new AppError('NOT_FOUND', 'That backup file could not be found.')
    throw invalid('open')
  }
  try {
    await new Promise<void>((resolve, reject) => {
      let count = 0
      let total = 0
      const seen = new Set<string>()
      zip.on('error', reject)
      zip.on('end', () => resolve())
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          try {
            count++
            if (count > MAX_ENTRIES) throw invalid('too many entries')
            checkEntryName(entry.fileName)
            if (seen.has(entry.fileName)) throw invalid('duplicate entry')
            seen.add(entry.fileName)
            if (entry.isEncrypted()) throw invalid('encrypted')
            total += entry.uncompressedSize
            if (total > MAX_TOTAL_UNCOMPRESSED) throw invalid('too large')
            await onEntry(entry, () => new Promise<Readable>((res, rej) => zip.openReadStream(entry, (err, s) => (err || !s ? rej(err ?? new Error('read failed')) : res(s)))))
            zip.readEntry()
          } catch (e) {
            zip.close()
            reject(e)
          }
        })()
      })
      zip.readEntry()
    })
  } catch (e) {
    if (e instanceof AppError) throw e
    throw invalid('zip')
  }
}

async function readAll(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    size += (chunk as Buffer).length
    if (size > limit) throw invalid('manifest too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

export function parseManifest(raw: Buffer): BackupManifest {
  let m: Record<string, unknown>
  try {
    m = JSON.parse(raw.toString('utf8'))
  } catch {
    throw invalid('manifest json')
  }
  const db = m.database as Record<string, unknown> | undefined
  const counts = m.counts as Record<string, unknown> | undefined
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (
    m.format !== BACKUP_FORMAT || typeof m.formatVersion !== 'number' || typeof m.appVersion !== 'string' ||
    typeof m.schemaVersion !== 'number' || typeof m.createdAt !== 'string' || !db || db.file !== 'ledgerly.db' ||
    typeof db.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(db.sha256) || !num(db.size) || !counts ||
    !num(counts.transactions) || !num(counts.documents) || !num(counts.rules) || !num(counts.tags) || !num(m.documentFiles)
  ) {
    throw invalid('manifest shape')
  }
  if (m.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new AppError('VALIDATION', 'This backup was created by a newer version of Ledgerly. Please update Ledgerly to restore it.\n\nNothing has been changed.')
  }
  if (m.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new AppError('VALIDATION', 'This backup was created by a newer version of Ledgerly. Please update Ledgerly to restore it.\n\nNothing has been changed.')
  }
  if (m.schemaVersion < 1) throw invalid('schema version')
  return m as unknown as BackupManifest
}

export function summaryOf(m: BackupManifest, size: number): BackupSummary {
  return { appVersion: m.appVersion, schemaVersion: m.schemaVersion, createdAt: m.createdAt, counts: m.counts, documentFiles: m.documentFiles, size }
}

export interface InspectedPackage {
  manifest: BackupManifest
  summary: BackupSummary
  /** Total uncompressed bytes (for the free-space check before extraction). */
  uncompressedBytes: number
}

/** Validate structure, manifest and database hash without extracting anything. */
export async function inspectPackage(file: string): Promise<InspectedPackage> {
  let manifestRaw: Buffer | null = null
  let dbHash: string | null = null
  let dbSize = 0
  let docFiles = 0
  let uncompressed = 0
  await walkZip(file, async (entry, open) => {
    uncompressed += entry.uncompressedSize
    if (entry.fileName.endsWith('/')) return
    if (entry.fileName === 'manifest.json') {
      manifestRaw = await readAll(await open(), MAX_MANIFEST_BYTES)
    } else if (entry.fileName === 'ledgerly.db') {
      const hash = createHash('sha256')
      await pipeline(
        await open(),
        new Writable({
          write(chunk, _e, cb) {
            hash.update(chunk)
            dbSize += chunk.length
            cb()
          }
        })
      )
      dbHash = hash.digest('hex')
    } else {
      docFiles++
    }
  })
  if (!manifestRaw || !dbHash) throw invalid('missing manifest or database')
  const manifest = parseManifest(manifestRaw)
  if (manifest.database.sha256 !== dbHash || manifest.database.size !== dbSize) {
    throw new AppError('VALIDATION', 'This backup failed its integrity check — its database does not match what was recorded when it was created. It may be damaged or tampered with.\n\nNothing has been changed.')
  }
  if (manifest.documentFiles !== docFiles) throw invalid('document count mismatch')
  return { manifest, summary: summaryOf(manifest, fs.statSync(file).size), uncompressedBytes: uncompressed }
}

/** Extract a (previously inspected) package into `stagingDir`. Entries can never land outside it. */
export async function extractPackage(file: string, stagingDir: string): Promise<void> {
  const root = path.resolve(stagingDir)
  fs.mkdirSync(root, { recursive: true })
  await walkZip(file, async (entry, open) => {
    const target = path.resolve(root, ...entry.fileName.split('/').filter(Boolean))
    if (target !== root && !target.startsWith(root + path.sep)) throw invalid('traversal')
    if (entry.fileName.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true })
      return
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    await pipeline(await open(), fs.createWriteStream(target))
  })
}
