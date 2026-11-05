// Import service: sessions, preview pages, commit, history and undo.
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../database/db'
import { newId, nowISO } from '../database/ids'
import { insertBatch, type BatchRow } from '../database/txnStore'
import { ensureAccount, ensureCategory, listAccounts } from '../services/catalog'
import { storeDocument } from '../documents/vault'
import { dialogs } from '../platform/dialogs'
import { emitEvent } from '../platform/events'
import { logException } from '../logging/logger'
import { AppError } from '../../shared/errors'
import { NEEDS_REVIEW, type AccountType } from '../../shared/types'
import type {
  ImportFormat, ImportHistoryEntry, ImportOptions, ImportPreview, ImportReport, ImportSessionSummary, PreviewFilter, PreviewRowsPage
} from '../../shared/api/imports'
import { MAX_IMPORT_BYTES } from './engine'
import { buildPreview, buildSummary, toPreviewRow, yieldToLoop, type Session } from './pipeline'
import { parseFile } from './workerClient'

// ---- sessions ---------------------------------------------------------------------------------------

const sessions = new Map<string, Session>()
const SESSION_TTL_MS = 2 * 60 * 60 * 1000
const MAX_SESSIONS = 4

function purgeSessions(): void {
  const now = Date.now()
  for (const [id, s] of sessions) if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id)
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    sessions.delete(oldest.id)
  }
}

export function getSession(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new AppError('NOT_FOUND', 'This import is no longer open. Please select the file again.')
  return s
}

export function sessionCountForTests(): number {
  return sessions.size
}

export function clearSessionsForTests(): void {
  sessions.clear()
}

export function formatForFilename(filename: string): ImportFormat {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.qif') return 'qif'
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv') return 'csv'
  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') return 'excel'
  throw new AppError('UNSUPPORTED', 'Ledgerly can import .qif, .csv, .xlsx and .xls files.')
}

async function openSession(filename: string, format: ImportFormat, bytes: Uint8Array): Promise<ImportSessionSummary> {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new AppError('LIMIT', 'This file is larger than 200 MB, which is more than Ledgerly can import at once. Please split it into smaller files.')
  }
  purgeSessions()
  emitEvent('import:progress', { sessionId: '', phase: 'parsing', done: 0, total: 1 })
  const parsed = await parseFile(format, bytes)
  const s: Session = {
    id: newId(),
    filename: path.basename(filename),
    format,
    size: bytes.byteLength,
    bytes,
    parsed,
    createdAt: Date.now(),
    optionsKey: null,
    rows: [],
    preview: null,
    idx: { new: [], duplicate: [], review: [], invalid: [] },
    defaultAccount: '',
    newAccountsFromFile: [],
    accountType: 'other'
  }
  sessions.set(s.id, s)
  emitEvent('import:progress', { sessionId: s.id, phase: 'parsing', done: 1, total: 1 })
  return buildSummary(s)
}

const DIALOG: Record<ImportFormat, { title: string; filters: { name: string; extensions: string[] }[] }> = {
  qif: { title: 'Select a QIF file', filters: [{ name: 'Quicken QIF', extensions: ['qif'] }] },
  csv: { title: 'Select a CSV statement', filters: [{ name: 'CSV statement', extensions: ['csv', 'txt'] }] },
  excel: { title: 'Select an Excel statement', filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }] }
}

/** Native file dialog → read locally → parse. Resolves null when the dialog is cancelled. */
export async function openFromDialog(format: ImportFormat): Promise<ImportSessionSummary | null> {
  const d = DIALOG[format]
  const picked = await dialogs().openFile({ title: d.title, filters: [...d.filters, { name: 'All files', extensions: ['*'] }] })
  if (!picked || picked.length === 0) return null
  const file = picked[0]
  const stat = await fs.promises.stat(file)
  if (!stat.isFile()) throw new AppError('IO', 'That is not a file Ledgerly can read.')
  if (stat.size > MAX_IMPORT_BYTES) {
    throw new AppError('LIMIT', 'This file is larger than 200 MB, which is more than Ledgerly can import at once. Please split it into smaller files.')
  }
  const bytes = new Uint8Array(await fs.promises.readFile(file))
  return openSession(path.basename(file), format, bytes)
}

export async function openFromBytes(filename: string, bytes: Uint8Array): Promise<ImportSessionSummary> {
  return openSession(filename, formatForFilename(filename), bytes)
}

// ---- preview ----------------------------------------------------------------------------------------

export async function previewSession(sessionId: string, options: ImportOptions): Promise<ImportPreview> {
  const s = getSession(sessionId)
  const preview = await buildPreview(s, options)
  s.optionsKey = JSON.stringify(options)
  return preview
}

export function previewRows(sessionId: string, filter: PreviewFilter, page: number, pageSize: number): PreviewRowsPage {
  const s = getSession(sessionId)
  if (!s.preview) throw new AppError('VALIDATION', 'The preview is not ready yet.')
  const size = Math.min(500, Math.max(1, pageSize))
  const list: number[] | null =
    filter === 'all' ? null : filter === 'new' ? s.idx.new : filter === 'duplicate' ? s.idx.duplicate : filter === 'needs-review' ? s.idx.review : s.idx.invalid
  const total = list ? list.length : s.rows.length
  const pages = Math.max(1, Math.ceil(total / size))
  const p = Math.min(Math.max(1, page), pages)
  const from = (p - 1) * size
  const slice = list ? list.slice(from, from + size).map((i) => s.rows[i]) : s.rows.slice(from, from + size)
  return { rows: slice.map(toPreviewRow), total, page: p, pageSize: size }
}

export function cancelSession(sessionId: string): void {
  sessions.delete(sessionId)
}

// ---- commit -----------------------------------------------------------------------------------------

const SINGLE_TRANSACTION_LIMIT = 20_000
const BATCH_SIZE = 5_000

export async function commitSession(sessionId: string, options: ImportOptions): Promise<ImportReport> {
  const s = getSession(sessionId)
  const key = JSON.stringify(options)
  // Always import exactly what the user last saw; if the options changed since, rebuild first.
  if (!s.preview || s.optionsKey !== key) {
    await previewSession(sessionId, options)
  }
  const preview = s.preview!
  if (!preview.canImport) throw new AppError('VALIDATION', preview.blockers[0] ?? 'There is nothing to import.')

  const db = getDb()
  const notes: string[] = []
  const rows = s.idx.new.map((i) => s.rows[i])
  const importId = newId()
  const accountType = (options.account?.type ?? 'other') as AccountType

  // Accounts and categories the import needs (explicit, visible choices from the preview).
  const createdAccounts: string[] = []
  const addedCategories: string[] = []
  const addNew = options.addNewCategories ?? true
  const total = rows.length

  /** Create what the import needs, then turn the previewed rows into insert rows. Runs inside a transaction. */
  const prepare = (): BatchRow[] => {
    const known = new Set(listAccounts().map((a) => a.name.toLowerCase()))
    const ensureAcc = (name: string, type: AccountType) => {
      if (!known.has(name.toLowerCase())) {
        ensureAccount(name, type)
        known.add(name.toLowerCase())
        createdAccounts.push(name)
      }
    }
    if (preview.account && !preview.account.exists) ensureAcc(preview.account.name, accountType)
    for (const n of preview.newAccounts) ensureAcc(n, 'other')
    if (addNew) {
      for (const c of preview.newCategories) {
        try {
          addedCategories.push(ensureCategory(c))
        } catch {
          /* an unusable category name stays a plain label on the transactions */
        }
      }
    }
    const canonical = new Map(listAccounts().map((a) => [a.name.toLowerCase(), a.name]))
    return rows.map((r) => ({
      date: r.date as string,
      merchant: r.merchant,
      memo: r.memo,
      category: r.finalCategory || NEEDS_REVIEW,
      amount: r.amount,
      type: r.type,
      account: r.account ? (canonical.get(r.account.trim().toLowerCase()) ?? r.account.trim()) : s.defaultAccount,
      tags: [],
      receipt: false,
      source: s.format,
      isTransfer: r.isTransfer,
      categoryLocked: false,
      reference: r.reference,
      importId,
      fingerprint: r.fingerprint
    }))
  }

  db.run(
    `INSERT INTO import_history (id, filename, format, account, inserted, duplicates, skipped, needsReview, status, documentId, createdAt, undoneAt)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'partial', NULL, ?, NULL)`,
    importId, s.filename, s.format, s.defaultAccount, nowISO()
  )

  let inserted = 0
  let batchDuplicates = 0
  let failure: unknown = null
  const progress = (done: number) => emitEvent('import:progress', { sessionId, phase: 'importing', done, total })

  try {
    progress(0)
    if (total <= SINGLE_TRANSACTION_LIMIT) {
      // small import: one atomic transaction — all or nothing
      const r = db.transaction(() => insertBatch(prepare()))
      inserted += r.inserted
      batchDuplicates += r.duplicates
      progress(total)
    } else {
      // large import: safe batches; completed batches are preserved and reported if a later one fails
      const batchRows = db.transaction(prepare)
      for (let start = 0; start < total; start += BATCH_SIZE) {
        const r = insertBatch(batchRows.slice(start, start + BATCH_SIZE))
        inserted += r.inserted
        batchDuplicates += r.duplicates
        progress(Math.min(total, start + BATCH_SIZE))
        await yieldToLoop()
      }
    }
  } catch (e) {
    failure = e
    logException('import.commit', e)
  }

  if (failure && inserted === 0) {
    db.run('DELETE FROM import_history WHERE id = ?', importId)
    throw new AppError('DB', 'Ledgerly could not save the imported transactions.\n\nYour existing data is safe. Please try again.')
  }

  const needsReview = db.scalar<number>('SELECT COUNT(*) FROM transactions WHERE importId = ? AND category = ?', importId, NEEDS_REVIEW) ?? 0
  const duplicates = preview.duplicates + batchDuplicates
  const skipped = preview.invalid
  const status: 'complete' | 'partial' = failure ? 'partial' : 'complete'
  if (failure) {
    notes.push(
      `The import stopped early after ${inserted.toLocaleString()} of ${total.toLocaleString()} transactions. The transactions that were saved are kept; you can remove them with “Undo import” in Import History.`
    )
  }

  // Keep the original file in the document vault (best effort — the data is already safe).
  let documentId: string | null = null
  let documentKept = false
  try {
    if (s.bytes) {
      const doc = storeDocument({
        filename: s.filename,
        bytes: s.bytes,
        kind: s.format === 'qif' ? 'statement' : 'spreadsheet',
        source: 'import',
        status: 'stored'
      })
      documentId = doc.id
      documentKept = true
    }
  } catch (e) {
    notes.push(
      e instanceof AppError && (e.code === 'LIMIT' || e.code === 'UNSUPPORTED')
        ? `A copy of the original file was not kept in the document vault: ${e.message}`
        : 'A copy of the original file could not be kept in the document vault.'
    )
  }

  db.run(
    `UPDATE import_history SET inserted = ?, duplicates = ?, skipped = ?, needsReview = ?, status = ?, documentId = ? WHERE id = ?`,
    inserted, duplicates, skipped, needsReview, status, documentId, importId
  )

  const report: ImportReport = {
    importId,
    filename: s.filename,
    format: s.format,
    inserted,
    duplicates,
    needsReview,
    skipped,
    status,
    documentKept,
    addedCategories,
    createdAccounts,
    notes
  }
  emitEvent('import:progress', { sessionId, phase: 'done', done: total, total })
  // free the (potentially large) in-memory copy of the file
  sessions.delete(sessionId)
  return report
}

// ---- history & undo ---------------------------------------------------------------------------------

interface HistoryRow {
  id: string
  filename: string
  format: ImportFormat
  account: string
  inserted: number
  duplicates: number
  skipped: number
  needsReview: number
  status: 'complete' | 'partial' | 'undone'
  documentId: string | null
  createdAt: string
  undoneAt: string | null
  remaining: number
  edited: number
}

export function importHistory(): ImportHistoryEntry[] {
  return getDb()
    .all<HistoryRow>(
      `SELECT h.id, h.filename, h.format, h.account, h.inserted, h.duplicates, h.skipped, h.needsReview, h.status, h.documentId, h.createdAt, h.undoneAt,
              (SELECT COUNT(*) FROM transactions t WHERE t.importId = h.id) AS remaining,
              (SELECT COUNT(*) FROM transactions t WHERE t.importId = h.id AND t.updatedAt <> t.createdAt) AS edited
         FROM import_history h
        ORDER BY h.createdAt DESC
        LIMIT 500`
    )
    .map((r) => ({ ...r }))
}

/** Remove the transactions that came from one import. Edited ones are removed too (the UI warns first). */
export function undoImport(importId: string): { removed: number } {
  const db = getDb()
  const row = db.get<{ status: string }>('SELECT status FROM import_history WHERE id = ?', importId)
  if (!row) throw new AppError('NOT_FOUND', 'That import could not be found.')
  if (row.status === 'undone') throw new AppError('CONFLICT', 'This import has already been undone.')
  return db.transaction(() => {
    const removed = db.run('DELETE FROM transactions WHERE importId = ?', importId).changes
    db.run("UPDATE import_history SET status = 'undone', undoneAt = ? WHERE id = ?", nowISO(), importId)
    return { removed }
  })
}
