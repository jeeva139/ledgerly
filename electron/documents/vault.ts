// Local document vault: original bytes live under <data>/documents/<kind>/<id>-<filename>,
// metadata lives in the `documents` table. Nothing here touches the network.
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../database/db'
import { newId, nowISO } from '../database/ids'
import { DOCUMENT_SUBDIRS, paths, resolveVaultPath, type DocumentSubdir } from '../database/paths'
import { AppError } from '../../shared/errors'
import {
  DOCUMENT_MAX_BYTES, type DocumentExtraction, type DocumentKind, type DocumentRecord, type DocumentSource, type DocumentStatus
} from '../../shared/types'
import { markNotFreshStart } from '../services/settings'

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.csv': 'text/csv',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.qif': 'application/x-qif',
  '.txt': 'text/plain'
}
export const ALLOWED_DOCUMENT_EXTENSIONS = Object.keys(MIME)
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff']
export const STATEMENT_EXTENSIONS = ['.csv', '.xls', '.xlsx', '.qif']

export const extensionOf = (filename: string): string => path.extname(filename).toLowerCase()
export const mimeFor = (filename: string): string => MIME[extensionOf(filename)] ?? 'application/octet-stream'

/** Statements/spreadsheets are classified by extension; everything else by what the caller says (default "other"). */
export function kindFor(filename: string, requested?: DocumentKind): DocumentKind {
  const ext = extensionOf(filename)
  if (requested) return requested
  if (ext === '.qif') return 'statement'
  if (ext === '.csv' || ext === '.xls' || ext === '.xlsx') return 'spreadsheet'
  return 'other'
}

export function subdirFor(kind: DocumentKind): DocumentSubdir {
  const map: Record<DocumentKind, DocumentSubdir> = {
    receipt: 'receipts',
    invoice: 'invoices',
    statement: 'statements',
    spreadsheet: 'spreadsheets',
    other: 'other'
  }
  return map[kind]
}

export function kindFromObjectPath(objectPath: string): DocumentKind {
  const dir = objectPath.split('/')[0] as DocumentSubdir
  const idx = DOCUMENT_SUBDIRS.indexOf(dir)
  return (['receipt', 'invoice', 'statement', 'spreadsheet', 'other'] as DocumentKind[])[idx] ?? 'other'
}

/** Strip any path, control and reserved characters; keep it readable and bounded. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(String(name).replace(/\\/g, '/'))
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  const ext = path.extname(cleaned)
  const stem = cleaned.slice(0, cleaned.length - ext.length).slice(0, 120).trim() || 'document'
  return `${stem}${ext.slice(0, 12)}`
}

interface DocRow {
  id: string
  filename: string
  mimeType: string
  size: number
  objectPath: string
  status: DocumentStatus
  source: DocumentSource
  kind: DocumentKind | null
  note: string | null
  extracted: string | null
  createdAt: string
  updatedAt: string
}

export const DOC_COLUMNS = 'id, filename, mimeType, size, objectPath, status, source, kind, note, extracted, createdAt, updatedAt'

export function rowToDocument(r: DocRow): DocumentRecord {
  let extracted: DocumentExtraction | null = null
  if (r.extracted) {
    try {
      extracted = JSON.parse(r.extracted) as DocumentExtraction
    } catch {
      extracted = null
    }
  }
  return {
    id: r.id,
    filename: r.filename,
    mimeType: r.mimeType,
    size: r.size,
    status: r.status,
    source: r.source,
    kind: r.kind ?? kindFromObjectPath(r.objectPath),
    note: r.note ?? '',
    extracted,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

export function getDocument(id: string): DocumentRecord | null {
  const r = getDb().get<DocRow>(`SELECT ${DOC_COLUMNS} FROM documents WHERE id = ?`, id)
  return r ? rowToDocument(r) : null
}

export interface StoreInput {
  filename: string
  bytes: Uint8Array
  kind?: DocumentKind
  source: DocumentSource
  status?: DocumentStatus
}

/**
 * Validate and store a file in the vault. The 20 MB limit is enforced here (never truncates).
 * File first, database row second; if the row cannot be written the file is removed again.
 */
export function storeDocument(input: StoreInput): DocumentRecord {
  const filename = sanitizeFilename(input.filename)
  const ext = extensionOf(filename)
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) {
    throw new AppError('UNSUPPORTED', `"${filename}" is not a supported file type. Supported: PDF, images, CSV, Excel (XLS/XLSX), QIF and text files.`)
  }
  const size = input.bytes.byteLength
  if (size === 0) throw new AppError('VALIDATION', `"${filename}" is empty.`)
  if (size > DOCUMENT_MAX_BYTES) {
    throw new AppError(
      'LIMIT',
      `"${filename}" is ${(size / 1024 / 1024).toFixed(1)} MB. Ledgerly accepts files up to 20 MB, so this file was not stored.`
    )
  }
  const kind = kindFor(filename, input.kind)
  const id = newId()
  const objectPath = `${subdirFor(kind)}/${id}-${filename}`
  const full = resolveVaultPath(objectPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  const tmp = `${full}.part`
  fs.writeFileSync(tmp, input.bytes)
  fs.renameSync(tmp, full)
  const now = nowISO()
  try {
    getDb().run(
      `INSERT INTO documents (id, filename, mimeType, size, objectPath, status, source, kind, note, extracted, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?)`,
      id, filename, mimeFor(filename), size, objectPath, input.status ?? 'stored', input.source, kind, now, now
    )
  } catch (e) {
    fs.rmSync(full, { force: true })
    throw e
  }
  markNotFreshStart()
  return getDocument(id)!
}

export function documentFilePath(id: string): string {
  const row = getDb().get<{ objectPath: string }>('SELECT objectPath FROM documents WHERE id = ?', id)
  if (!row) throw new AppError('NOT_FOUND', 'That document no longer exists.')
  return resolveVaultPath(row.objectPath)
}

export function readDocumentBytes(id: string): Buffer {
  const file = documentFilePath(id)
  if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 'The stored file is missing from the document vault.')
  return fs.readFileSync(file)
}

/** Remove the stored file and its row, and detach it from any transaction that used it as a receipt. */
export function deleteDocument(id: string): void {
  const db = getDb()
  const row = db.get<{ objectPath: string }>('SELECT objectPath FROM documents WHERE id = ?', id)
  if (!row) throw new AppError('NOT_FOUND', 'That document no longer exists.')
  db.transaction(() => {
    db.run('UPDATE transactions SET receipt = 0, receiptDocId = NULL, updatedAt = ? WHERE receiptDocId = ?', nowISO(), id)
    db.run('DELETE FROM documents WHERE id = ?', id)
  })
  fs.rmSync(resolveVaultPath(row.objectPath), { force: true })
}

/** Remove every file in the vault (used by the full data wipe). Keeps the folder layout. */
export function clearVaultFiles(): void {
  for (const d of DOCUMENT_SUBDIRS) {
    const dir = path.join(paths.documents(), d)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  }
}
