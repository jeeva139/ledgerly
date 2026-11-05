import fs from 'node:fs'
import path from 'node:path'

// Application data layout (default: %APPDATA%\Ledgerly):
//   ledgerly.db · documents/{receipts,invoices,statements,spreadsheets,other} · backups · exports · logs
let dataDir: string | null = null

export const DOCUMENT_SUBDIRS = ['receipts', 'invoices', 'statements', 'spreadsheets', 'other'] as const
export type DocumentSubdir = (typeof DOCUMENT_SUBDIRS)[number]

export function setDataDir(dir: string): void {
  dataDir = path.resolve(dir)
}

export function getDataDir(): string {
  if (!dataDir) throw new Error('Data directory not initialised')
  return dataDir
}

export const paths = {
  root: () => getDataDir(),
  db: () => path.join(getDataDir(), 'ledgerly.db'),
  documents: () => path.join(getDataDir(), 'documents'),
  backups: () => path.join(getDataDir(), 'backups'),
  exports: () => path.join(getDataDir(), 'exports'),
  logs: () => path.join(getDataDir(), 'logs'),
  tmp: () => path.join(getDataDir(), 'tmp')
}

export function ensureDataLayout(): void {
  fs.mkdirSync(getDataDir(), { recursive: true })
  for (const d of DOCUMENT_SUBDIRS) fs.mkdirSync(path.join(paths.documents(), d), { recursive: true })
  for (const d of [paths.backups(), paths.exports(), paths.logs(), paths.tmp()]) fs.mkdirSync(d, { recursive: true })
}

/** Resolve a vault-relative object path and make sure it stays inside the documents folder. */
export function resolveVaultPath(objectPath: string): string {
  const root = path.resolve(paths.documents())
  const full = path.resolve(root, objectPath)
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Path escapes the document vault')
  return full
}
