// Test helpers for areas that need a real on-disk data folder (document vault, backup, wipe).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import archiver from 'archiver'
import yauzl from 'yauzl'
import { closeDatabase, openDatabase } from '../electron/database/db'
import { ensureDataLayout, setDataDir } from '../electron/database/paths'
import { resetFreshStartCache, seedDefaultsIfNeeded } from '../electron/services/settings'
import { setLocked } from '../electron/security/lockState'
import { setDialogProvider } from '../electron/platform/dialogs'

/** Fresh temp data directory with an open, seeded, file-backed database. */
export function setupDataDir(label = 'ledgerly-test'): string {
  closeDatabase()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`))
  setDataDir(dir)
  ensureDataLayout()
  openDatabase()
  resetFreshStartCache()
  setLocked(false)
  seedDefaultsIfNeeded()
  return dir
}

export function teardownDataDir(dir: string): void {
  setDialogProvider(null)
  closeDatabase()
  fs.rmSync(dir, { recursive: true, force: true })
}

export interface ZipEntryData {
  name: string
  data: Buffer
}

export async function readZip(file: string): Promise<ZipEntryData[]> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, strictFileNames: false }, (e, z) => (e || !z ? reject(e) : resolve(z)))
  )
  return new Promise((resolve, reject) => {
    const out: ZipEntryData[] = []
    zip.on('error', reject)
    zip.on('end', () => resolve(out))
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith('/')) return zip.readEntry()
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err)
        const chunks: Buffer[] = []
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('end', () => {
          out.push({ name: entry.fileName, data: Buffer.concat(chunks) })
          zip.readEntry()
        })
      })
    })
    zip.readEntry()
  })
}

export async function writeZip(file: string, entries: ZipEntryData[]): Promise<void> {
  const output = fs.createWriteStream(file)
  const archive = archiver('zip')
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    archive.on('error', reject)
  })
  archive.pipe(output)
  for (const e of entries) archive.append(e.data, { name: e.name })
  await archive.finalize()
  await done
}

/** Copy a zip while letting the test change its entries (tampering, adding hostile entries …). */
export async function rewriteZip(src: string, dest: string, mutate: (entries: ZipEntryData[]) => ZipEntryData[]): Promise<void> {
  await writeZip(dest, mutate(await readZip(src)))
}
