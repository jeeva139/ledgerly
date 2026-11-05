// Transactions service: filtered/paginated queries, CRUD, bulk operations, transfers and receipts.
// All SQL is parameterised; nothing here logs transaction contents.
import { getDb } from '../database/db'
import { nowISO } from '../database/ids'
import type { SqlParam } from '../database/sqlite'
import {
  TXN_COLUMNS, baseFingerprint, ensureTagsExist, getTransactionById, insertTransaction, normalizeTags, refingerprintTransactions,
  rowToTransaction, validateNewTransaction, type TxnRow
} from '../database/txnStore'
import { canonicalCategory, ensureCategory, listAccounts, listCategories, listTagNames } from './catalog'
import { getDocument } from '../documents/vault'
import { AppError } from '../../shared/errors'
import { NEEDS_REVIEW, TRANSFER_CATEGORY, type Transaction } from '../../shared/types'
import type {
  CreateTransactionInput, CreateTransferInput, TransactionFilterOptions, TransactionFilters, TransactionListInput, TransactionListResult,
  TransactionSelection, TxnSort, UpdateTransactionPatch
} from '../../shared/api/transactions'

// =============================================================================================
// Query building
// =============================================================================================

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

export interface Where {
  sql: string
  params: SqlParam[]
}

/** Build the WHERE clause (without the keyword) for a set of filters. Always returns a valid fragment. */
export function buildWhere(f: TransactionFilters = {}): Where {
  const clauses: string[] = []
  const params: SqlParam[] = []

  const search = (f.search ?? '').trim()
  if (search) {
    // Every word must match somewhere (AND across words, OR across columns).
    for (const term of search.split(/\s+/).slice(0, 8)) {
      const like = `%${escapeLike(term)}%`
      clauses.push(
        `(merchant LIKE ? ESCAPE '\\' OR memo LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR account LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\')`
      )
      params.push(like, like, like, like, like, like)
    }
  }
  if (f.dateFrom) {
    clauses.push('date >= ?')
    params.push(f.dateFrom)
  }
  if (f.dateTo) {
    clauses.push('date <= ?')
    params.push(f.dateTo)
  }
  if (f.accounts?.length) {
    clauses.push(`account IN (${f.accounts.map(() => '?').join(',')})`)
    params.push(...f.accounts)
  }
  if (f.categories?.length) {
    // A parent category ("Food") also matches its subcategories ("Food:Dining").
    const parts = f.categories.map(() => `(category = ? OR category LIKE ? ESCAPE '\\')`)
    clauses.push(`(${parts.join(' OR ')})`)
    for (const c of f.categories) params.push(c, `${escapeLike(c)}:%`)
  }
  if (f.tags?.length) {
    clauses.push(`EXISTS (SELECT 1 FROM json_each(transactions.tags) WHERE lower(value) IN (${f.tags.map(() => 'lower(?)').join(',')}))`)
    params.push(...f.tags)
  }
  if (f.type === 'expense' || f.type === 'income') {
    clauses.push('type = ?')
    params.push(f.type)
  }
  if (f.transfers === 'only') clauses.push('isTransfer = 1')
  else if (f.transfers === 'exclude') clauses.push('isTransfer = 0')
  if (f.needsReview) {
    clauses.push('category = ?')
    params.push(NEEDS_REVIEW)
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1 = 1', params }
}

const SORT_COLUMNS: Record<TxnSort['field'], string> = {
  date: 'date',
  merchant: 'merchant COLLATE NOCASE',
  category: 'category COLLATE NOCASE',
  account: 'account COLLATE NOCASE',
  amount: 'amount',
  type: 'type'
}

function orderBy(sort?: TxnSort): string {
  const field = sort?.field && SORT_COLUMNS[sort.field] ? sort.field : 'date'
  const dir = sort?.dir === 'asc' ? 'ASC' : 'DESC'
  const primary = `${SORT_COLUMNS[field]} ${dir}`
  // Stable, predictable tie-breakers.
  return field === 'date' ? `${primary}, createdAt ${dir}, id ${dir}` : `${primary}, date DESC, createdAt DESC, id DESC`
}

export function listTransactions(input: TransactionListInput): TransactionListResult {
  const db = getDb()
  const where = buildWhere(input)
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize)), 500)
  const page = Math.max(1, Math.floor(input.page))

  const agg = db.get<{ total: number; income: number; expense: number; count: number }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN isTransfer = 0 AND type = 'income'  THEN amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN isTransfer = 0 AND type = 'expense' THEN amount END), 0) AS expense,
            COALESCE(SUM(CASE WHEN isTransfer = 0 THEN 1 ELSE 0 END), 0) AS count
       FROM transactions WHERE ${where.sql}`,
    ...where.params
  )!
  const rows = db
    .all<TxnRow>(
      `SELECT ${TXN_COLUMNS} FROM transactions WHERE ${where.sql} ORDER BY ${orderBy(input.sort)} LIMIT ? OFFSET ?`,
      ...where.params, pageSize, (page - 1) * pageSize
    )
    .map(rowToTransaction)

  return {
    rows,
    total: agg.total,
    totals: { income: round(agg.income), expense: round(agg.expense), count: agg.count }
  }
}

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function getTransaction(id: string): Transaction {
  const t = getTransactionById(id)
  if (!t) throw new AppError('NOT_FOUND', 'That transaction no longer exists.')
  return t
}

/** Accounts, categories and tags usable in filters: managed lists plus labels still on historical rows. */
export function listFilterOptions(): TransactionFilterOptions {
  const db = getDb()
  const sortNames = (names: Iterable<string>) => [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  const accounts = sortNames([
    ...listAccounts().map((a) => a.name),
    ...db.all<{ account: string }>('SELECT DISTINCT account FROM transactions').map((r) => r.account)
  ])
  const categories = sortNames([
    ...listCategories(),
    ...db.all<{ category: string }>('SELECT DISTINCT category FROM transactions').map((r) => r.category)
  ])
  return { accounts, categories, tags: sortNames(listTagNames()) }
}

// =============================================================================================
// Selections (ids, or "everything matching these filters except …")
// =============================================================================================

const CHUNK = 800

function forChunks<T>(items: T[], fn: (chunk: T[]) => void): void {
  for (let i = 0; i < items.length; i += CHUNK) fn(items.slice(i, i + CHUNK))
}

export function resolveSelection(sel: TransactionSelection): string[] {
  if ('ids' in sel) return [...new Set(sel.ids)]
  const where = buildWhere(sel.filters)
  const except = new Set(sel.exceptIds ?? [])
  const ids = getDb().all<{ id: string }>(`SELECT id FROM transactions WHERE ${where.sql}`, ...where.params).map((r) => r.id)
  return except.size ? ids.filter((id) => !except.has(id)) : ids
}

const marks = (n: number) => new Array(n).fill('?').join(',')

// =============================================================================================
// Create / update / delete
// =============================================================================================

/** Category must exist in the managed list, or be explicitly created. Returns the canonical spelling. */
function resolveCategory(name: string, createIfMissing: boolean): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw new AppError('VALIDATION', 'Choose a category.')
  const canonical = canonicalCategory(trimmed)
  if (canonical) return canonical
  if (trimmed === TRANSFER_CATEGORY) return trimmed
  if (createIfMissing) return ensureCategory(trimmed)
  throw new AppError('VALIDATION', `The category "${trimmed}" does not exist. Choose an existing category or create it first.`)
}

export function createTransaction(input: CreateTransactionInput): Transaction {
  const category = input.category ? resolveCategory(input.category, !!input.createCategoryIfMissing) : NEEDS_REVIEW
  const doc = input.receiptDocumentId ? getDocument(input.receiptDocumentId) : null
  if (input.receiptDocumentId && !doc) throw new AppError('NOT_FOUND', 'The receipt document could not be found.')
  return insertTransaction(
    {
      date: input.date,
      merchant: input.merchant,
      memo: input.memo,
      category,
      amount: input.amount,
      type: input.type,
      account: input.account ?? '',
      tags: input.tags,
      receiptDocId: doc?.id ?? null,
      receipt: !!doc,
      source: 'manual',
      // A category chosen by hand is a manual decision.
      categoryLocked: category !== NEEDS_REVIEW
    },
    { allowDuplicate: !!input.allowDuplicate }
  )
}

interface ExistingRow {
  id: string
  fingerprint: string
}

export function updateTransaction(id: string, patch: UpdateTransactionPatch, opts: { allowDuplicate?: boolean; createCategoryIfMissing?: boolean } = {}): Transaction {
  const db = getDb()
  const existing = getTransaction(id)
  const fp = db.get<ExistingRow>('SELECT id, fingerprint FROM transactions WHERE id = ?', id)!.fingerprint

  const merged = {
    date: patch.date ?? existing.date,
    merchant: patch.merchant ?? existing.merchant,
    memo: patch.memo ?? existing.memo,
    category: existing.category,
    amount: patch.amount ?? existing.amount,
    type: patch.type ?? existing.type,
    account: patch.account ?? existing.account,
    tags: patch.tags ?? existing.tags,
    isTransfer: patch.isTransfer ?? existing.isTransfer
  }

  let categoryLocked = existing.categoryLocked
  if (patch.category !== undefined && patch.category.trim() !== existing.category) {
    merged.category = resolveCategory(patch.category, !!opts.createCategoryIfMissing)
    categoryLocked = merged.category !== NEEDS_REVIEW
  }
  if (patch.isTransfer !== undefined && patch.isTransfer !== existing.isTransfer) {
    if (patch.isTransfer) {
      merged.category = TRANSFER_CATEGORY
      categoryLocked = true
    } else if (merged.category === TRANSFER_CATEGORY) {
      merged.category = NEEDS_REVIEW
      categoryLocked = false
    }
  }

  const valid = validateNewTransaction({ ...merged, source: existing.source })
  const newBase = baseFingerprint(valid.date, valid.merchant, valid.amount, valid.account)
  const baseChanged = !(fp === newBase || fp.startsWith(`${newBase}#`))

  return db.transaction(() => {
    if (baseChanged && !opts.allowDuplicate && db.get('SELECT 1 AS x FROM transactions WHERE fingerprint = ? AND id <> ?', newBase, id)) {
      throw new AppError('DUPLICATE', 'A transaction with the same date, merchant, amount and account already exists.')
    }
    db.run(
      `UPDATE transactions
          SET date = ?, merchant = ?, memo = ?, category = ?, amount = ?, type = ?, account = ?, tags = ?,
              isTransfer = ?, categoryLocked = ?, updatedAt = ?
        WHERE id = ?`,
      valid.date, valid.merchant, valid.memo, valid.category, valid.amount, valid.type, valid.account, JSON.stringify(valid.tags),
      valid.isTransfer ? 1 : 0, categoryLocked ? 1 : 0, nowISO(), id
    )
    ensureTagsExist(valid.tags)
    if (baseChanged) refingerprintTransactions([id])
    return getTransaction(id)
  })
}

export function deleteTransaction(id: string): void {
  const res = getDb().run('DELETE FROM transactions WHERE id = ?', id)
  if (res.changes === 0) throw new AppError('NOT_FOUND', 'That transaction no longer exists.')
}

export function deleteTransactions(sel: TransactionSelection): { deleted: number } {
  const ids = resolveSelection(sel)
  const db = getDb()
  let deleted = 0
  db.transaction(() => {
    forChunks(ids, (chunk) => {
      deleted += db.run(`DELETE FROM transactions WHERE id IN (${marks(chunk.length)})`, ...chunk).changes
    })
  })
  return { deleted }
}

// =============================================================================================
// Bulk operations
// =============================================================================================

export function setCategory(sel: TransactionSelection, category: string, createIfMissing = false): { updated: number; category: string } {
  const resolved = resolveCategory(category, createIfMissing)
  const ids = resolveSelection(sel)
  const db = getDb()
  const lock = resolved === NEEDS_REVIEW ? 0 : 1
  const now = nowISO()
  let updated = 0
  db.transaction(() => {
    forChunks(ids, (chunk) => {
      updated += db.run(
        `UPDATE transactions SET category = ?, categoryLocked = ?, updatedAt = ? WHERE id IN (${marks(chunk.length)})`,
        resolved, lock, now, ...chunk
      ).changes
    })
  })
  return { updated, category: resolved }
}

function mergeTags(current: string[], add: string[]): string[] {
  return normalizeTags([...current, ...add])
}

export function addTags(sel: TransactionSelection, tags: string[]): { updated: number } {
  const add = normalizeTags(tags)
  if (add.length === 0) throw new AppError('VALIDATION', 'Enter a tag name.')
  const ids = resolveSelection(sel)
  const db = getDb()
  const now = nowISO()
  let updated = 0
  db.transaction(() => {
    ensureTagsExist(add)
    forChunks(ids, (chunk) => {
      const rows = db.all<{ id: string; tags: string }>(`SELECT id, tags FROM transactions WHERE id IN (${marks(chunk.length)})`, ...chunk)
      for (const r of rows) {
        let current: string[] = []
        try {
          const v = JSON.parse(r.tags)
          if (Array.isArray(v)) current = v.filter((t): t is string => typeof t === 'string')
        } catch {
          /* treat as empty */
        }
        const next = mergeTags(current, add)
        if (next.length === current.length) continue
        db.run('UPDATE transactions SET tags = ?, updatedAt = ? WHERE id = ?', JSON.stringify(next), now, r.id)
        updated++
      }
    })
  })
  return { updated }
}

export function setTags(id: string, tags: string[]): Transaction {
  getTransaction(id)
  const next = normalizeTags(tags)
  const db = getDb()
  db.transaction(() => {
    ensureTagsExist(next)
    db.run('UPDATE transactions SET tags = ?, updatedAt = ? WHERE id = ?', JSON.stringify(next), nowISO(), id)
  })
  return getTransaction(id)
}

export function markTransfer(sel: TransactionSelection, isTransfer: boolean): { updated: number } {
  const ids = resolveSelection(sel)
  const db = getDb()
  const now = nowISO()
  let updated = 0
  db.transaction(() => {
    forChunks(ids, (chunk) => {
      if (isTransfer) {
        updated += db.run(
          `UPDATE transactions SET isTransfer = 1, category = ?, categoryLocked = 1, updatedAt = ? WHERE id IN (${marks(chunk.length)}) AND isTransfer = 0`,
          TRANSFER_CATEGORY, now, ...chunk
        ).changes
      } else {
        updated += db.run(
          `UPDATE transactions
              SET isTransfer = 0,
                  category = CASE WHEN category = ? THEN ? ELSE category END,
                  categoryLocked = CASE WHEN category = ? THEN 0 ELSE categoryLocked END,
                  updatedAt = ?
            WHERE id IN (${marks(chunk.length)}) AND isTransfer = 1`,
          TRANSFER_CATEGORY, NEEDS_REVIEW, TRANSFER_CATEGORY, now, ...chunk
        ).changes
      }
    })
  })
  return { updated }
}

export function createTransfer(input: CreateTransferInput): { from: Transaction; to: Transaction } {
  const fromAccount = (input.fromAccount ?? '').trim()
  const toAccount = (input.toAccount ?? '').trim()
  if (!fromAccount || !toAccount) throw new AppError('VALIDATION', 'Choose both accounts for the transfer.')
  if (fromAccount.toLowerCase() === toAccount.toLowerCase()) throw new AppError('VALIDATION', 'A transfer needs two different accounts.')
  const common = {
    date: input.date,
    amount: input.amount,
    memo: input.memo,
    category: TRANSFER_CATEGORY,
    isTransfer: true,
    categoryLocked: true,
    source: 'manual'
  }
  const opts = { allowDuplicate: !!input.allowDuplicate }
  return getDb().transaction(() => {
    const from = insertTransaction({ ...common, merchant: `Transfer to ${toAccount}`, type: 'expense', account: fromAccount }, opts)
    const to = insertTransaction({ ...common, merchant: `Transfer from ${fromAccount}`, type: 'income', account: toAccount }, opts)
    return { from, to }
  })
}

export function attachReceipt(id: string, documentId: string | null): Transaction {
  getTransaction(id)
  if (documentId && !getDocument(documentId)) throw new AppError('NOT_FOUND', 'That document could not be found.')
  getDb().run('UPDATE transactions SET receipt = ?, receiptDocId = ?, updatedAt = ? WHERE id = ?', documentId ? 1 : 0, documentId, nowISO(), id)
  return getTransaction(id)
}
