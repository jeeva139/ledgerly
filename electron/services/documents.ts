// Document vault operations used by the Documents page and by receipt attachment.
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../database/db'
import { nowISO } from '../database/ids'
import { resolveVaultPath } from '../database/paths'
import {
  ALLOWED_DOCUMENT_EXTENSIONS, DOC_COLUMNS, STATEMENT_EXTENSIONS, extensionOf, getDocument, kindFor, readDocumentBytes,
  rowToDocument, storeDocument, subdirFor, documentFilePath
} from '../documents/vault'
import { extractDocument, hasExtractedValues } from '../documents/extract'
import { dialogs } from '../platform/dialogs'
import { getPreferences } from './settings'
import { loadCompiledRules } from './rulesStore'
import { AppError } from '../../shared/errors'
import {
  DOCUMENT_MAX_BYTES, type DocumentExtraction, type DocumentKind, type DocumentRecord, type DocumentStatus
} from '../../shared/types'
import type { DocumentListInput, UploadResult } from '../../shared/api/documents'

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

export function listDocuments(input: DocumentListInput = {}): { rows: DocumentRecord[]; total: number } {
  const db = getDb()
  const where: string[] = []
  const params: (string | number)[] = []
  const search = input.search?.trim()
  if (search) {
    where.push(`(filename LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')`)
    params.push(`%${escapeLike(search)}%`, `%${escapeLike(search)}%`)
  }
  if (input.kind && input.kind !== 'all') {
    where.push('kind = ?')
    params.push(input.kind)
  }
  if (input.status && input.status !== 'all') {
    where.push('status = ?')
    params.push(input.status)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 500)
  const page = Math.max(input.page ?? 1, 1)
  const total = db.scalar<number>(`SELECT COUNT(*) FROM documents ${clause}`, ...params) ?? 0
  const rows = db
    .all<Parameters<typeof rowToDocument>[0]>(
      `SELECT ${DOC_COLUMNS} FROM documents ${clause} ORDER BY createdAt DESC, id LIMIT ? OFFSET ?`,
      ...params, pageSize, (page - 1) * pageSize
    )
    .map(rowToDocument)
  return { rows, total }
}

export function requireDocument(id: string): DocumentRecord {
  const doc = getDocument(id)
  if (!doc) throw new AppError('NOT_FOUND', 'That document no longer exists.')
  return doc
}

const isStatementFile = (filename: string) => STATEMENT_EXTENSIONS.includes(extensionOf(filename))

/** Run local extraction for a stored document and persist the result. Never invents values. */
export function runExtraction(id: string): DocumentExtraction {
  const doc = requireDocument(id)
  const bytes = readDocumentBytes(id)
  const result = extractDocument({
    filename: doc.filename,
    bytes,
    kind: doc.kind,
    dateFormat: getPreferences().dateFormat,
    rules: loadCompiledRules()
  })
  let status: DocumentStatus = doc.status
  if (isStatementFile(doc.filename)) status = doc.status === 'review' ? 'stored' : doc.status
  else if (hasExtractedValues(result)) status = 'review'
  else if (doc.status === 'review') status = 'stored'
  getDb().run('UPDATE documents SET extracted = ?, status = ?, updatedAt = ? WHERE id = ?', JSON.stringify(result), status, nowISO(), id)
  return result
}

/** Store bytes, then (optionally) extract. Statement files are queued for import. */
export function storeAndProcess(input: { filename: string; bytes: Uint8Array; kind?: DocumentKind; extract: boolean }): DocumentRecord {
  const kind = kindFor(input.filename, input.kind)
  const doc = storeDocument({
    filename: input.filename,
    bytes: input.bytes,
    kind,
    source: 'upload',
    status: isStatementFile(input.filename) && input.extract ? 'queued' : 'stored'
  })
  if (input.extract) {
    try {
      runExtraction(doc.id)
    } catch {
      /* extraction is best effort; the document itself is safely stored */
    }
  }
  return getDocument(doc.id)!
}

const FILE_FILTERS = [
  { name: 'Documents', extensions: ALLOWED_DOCUMENT_EXTENSIONS.map((e) => e.slice(1)) },
  { name: 'Receipts and invoices', extensions: ['pdf', 'jpg', 'jpeg', 'png'] },
  { name: 'Statements and spreadsheets', extensions: ['csv', 'xls', 'xlsx', 'qif'] }
]

/** Native multi-select dialog → store each chosen file. Raw paths never leave the main process. */
export async function uploadViaDialog(kind?: DocumentKind): Promise<UploadResult> {
  const picked = await dialogs().openFile({ title: 'Upload documents', filters: FILE_FILTERS, multiple: true })
  if (!picked || picked.length === 0) return { added: [], rejected: [], cancelled: true }
  const added: DocumentRecord[] = []
  const rejected: UploadResult['rejected'] = []
  for (const file of picked) {
    const filename = path.basename(file)
    try {
      const st = fs.statSync(file)
      if (!st.isFile()) throw new AppError('VALIDATION', `"${filename}" is not a file.`)
      if (st.size > DOCUMENT_MAX_BYTES) {
        throw new AppError(
          'LIMIT',
          `"${filename}" is ${(st.size / 1024 / 1024).toFixed(1)} MB. Ledgerly accepts files up to 20 MB, so this file was not stored.`
        )
      }
      added.push(storeAndProcess({ filename, bytes: fs.readFileSync(file), kind, extract: true }))
    } catch (e) {
      rejected.push({ filename, reason: e instanceof AppError ? e.message : `"${filename}" could not be read.` })
    }
  }
  return { added, rejected, cancelled: false }
}

export function updateDocument(id: string, patch: { note?: string; kind?: DocumentKind; status?: DocumentStatus }): DocumentRecord {
  const db = getDb()
  const doc = requireDocument(id)
  const row = db.get<{ objectPath: string }>('SELECT objectPath FROM documents WHERE id = ?', id)!
  let objectPath = row.objectPath
  if (patch.kind && patch.kind !== doc.kind) {
    const next = `${subdirFor(patch.kind)}/${id}-${doc.filename}`
    const from = resolveVaultPath(row.objectPath)
    const to = resolveVaultPath(next)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.renameSync(from, to)
    try {
      db.run('UPDATE documents SET objectPath = ?, kind = ? WHERE id = ?', next, patch.kind, id)
      objectPath = next
    } catch (e) {
      fs.renameSync(to, from)
      throw e
    }
  }
  if (patch.note !== undefined) {
    if (patch.note.length > 2000) throw new AppError('VALIDATION', 'Notes can be at most 2,000 characters long.')
    db.run('UPDATE documents SET note = ? WHERE id = ?', patch.note.trim(), id)
  }
  if (patch.status) db.run('UPDATE documents SET status = ? WHERE id = ?', patch.status, id)
  db.run('UPDATE documents SET updatedAt = ? WHERE id = ?', nowISO(), id)
  void objectPath
  return getDocument(id)!
}

export async function openDocument(id: string): Promise<void> {
  requireDocument(id)
  const file = documentFilePath(id)
  if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 'The stored file is missing from the document vault.')
  const err = await dialogs().openPath(file)
  if (err) throw new AppError('IO', 'Windows could not open this document. You may not have an app installed for this file type.')
}

export async function saveDocumentCopy(id: string): Promise<boolean> {
  const doc = requireDocument(id)
  const file = documentFilePath(id)
  if (!fs.existsSync(file)) throw new AppError('NOT_FOUND', 'The stored file is missing from the document vault.')
  const ext = extensionOf(doc.filename).slice(1)
  const dest = await dialogs().saveFile({
    title: 'Save a copy of this document',
    defaultPath: doc.filename,
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined
  })
  if (!dest) return false
  fs.copyFileSync(file, dest)
  return true
}
