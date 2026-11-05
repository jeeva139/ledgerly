// Shared persistence helpers for the `transactions` table: validation, fingerprinting,
// duplicate-safe inserts and row mapping. Used by manual entry, every importer and rename operations.
import { getDb } from './db'
import { newId, nowISO } from './ids'
import { AppError } from '../../shared/errors'
import { isValidISODate } from '../../shared/dates'
import { round2 } from '../../shared/money'
import { NEEDS_REVIEW, type Transaction, type TxnType } from '../../shared/types'
import { markNotFreshStart } from '../services/settings'

export const TXN_COLUMNS =
  'id, date, merchant, memo, category, amount, type, account, tags, receipt, receiptDocId, source, isTransfer, categoryLocked, reference, importId, createdAt, updatedAt'

export interface TxnRow {
  id: string
  date: string
  merchant: string
  memo: string
  category: string
  amount: number
  type: TxnType
  account: string
  tags: string
  receipt: number
  receiptDocId: string | null
  source: string
  isTransfer: number
  categoryLocked: number
  reference: string
  importId: string | null
  createdAt: string
  updatedAt: string
}

export function parseTagsJson(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function rowToTransaction(r: TxnRow): Transaction {
  return {
    id: r.id,
    date: r.date,
    merchant: r.merchant,
    memo: r.memo ?? '',
    category: r.category,
    amount: r.amount,
    type: r.type,
    account: r.account,
    tags: parseTagsJson(r.tags),
    receipt: r.receipt === 1,
    receiptDocId: r.receiptDocId ?? null,
    source: r.source,
    isTransfer: r.isTransfer === 1,
    categoryLocked: r.categoryLocked === 1,
    reference: r.reference ?? '',
    importId: r.importId ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

// ---- tags -------------------------------------------------------------------------------------

export const MAX_TAG_LENGTH = 40
export const MAX_TAGS_PER_TRANSACTION = 20

/** Trim, drop blanks, de-duplicate case-insensitively (first spelling wins). */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const name = t.trim().replace(/\s+/g, ' ')
    if (!name) continue
    if (name.length > MAX_TAG_LENGTH) throw new AppError('VALIDATION', `Tags can be at most ${MAX_TAG_LENGTH} characters long.`)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  if (out.length > MAX_TAGS_PER_TRANSACTION) throw new AppError('VALIDATION', `A transaction can have at most ${MAX_TAGS_PER_TRANSACTION} tags.`)
  return out
}

/** Make sure every tag exists in the `tags` table (tags are independent of categories). */
export function ensureTagsExist(names: string[]): void {
  if (!names.length) return
  const db = getDb()
  const now = nowISO()
  for (const name of names) {
    const exists = db.get('SELECT 1 AS x FROM tags WHERE name = ? COLLATE NOCASE', name)
    if (!exists) db.run('INSERT INTO tags (name, createdAt) VALUES (?, ?)', name, now)
  }
}

// ---- fingerprints -----------------------------------------------------------------------------

/** date | normalised merchant | amount (2dp) | normalised account */
export function baseFingerprint(date: string, merchant: string, amount: number, account: string): string {
  const m = merchant.trim().toLowerCase().replace(/\s+/g, ' ')
  const a = account.trim().toLowerCase()
  return `${date}|${m}|${amount.toFixed(2)}|${a}`
}

/** The Nth identical row inside one file gets `#N` so genuine repeats survive while re-imports still dedupe. */
export function occurrenceFingerprint(base: string, n: number): string {
  return n <= 1 ? base : `${base}#${n}`
}

export function fingerprintOf(t: { date: string; merchant: string; amount: number; account: string }): string {
  return baseFingerprint(t.date, t.merchant, t.amount, t.account)
}

/** Which of these fingerprints already exist in the database? */
export function existingFingerprints(fingerprints: string[]): Set<string> {
  const db = getDb()
  const found = new Set<string>()
  const CHUNK = 500
  for (let i = 0; i < fingerprints.length; i += CHUNK) {
    const chunk = fingerprints.slice(i, i + CHUNK)
    const marks = chunk.map(() => '?').join(',')
    for (const r of db.all<{ fingerprint: string }>(`SELECT fingerprint FROM transactions WHERE fingerprint IN (${marks})`, ...chunk)) {
      found.add(r.fingerprint)
    }
  }
  return found
}

function freeFingerprint(base: string, excludeId?: string): string {
  const db = getDb()
  for (let n = 1; n < 10_000; n++) {
    const fp = occurrenceFingerprint(base, n)
    const hit = db.get<{ id: string }>('SELECT id FROM transactions WHERE fingerprint = ?', fp)
    if (!hit || hit.id === excludeId) return fp
  }
  throw new AppError('DUPLICATE', 'Too many identical transactions already exist.')
}

/**
 * Recompute fingerprints after a date / merchant / amount / account change (edit, account rename).
 * Keeps the UNIQUE constraint satisfied by moving to the next free `#N` slot when needed.
 */
export function refingerprintTransactions(ids: string[]): void {
  const db = getDb()
  for (const id of ids) {
    const r = db.get<{ date: string; merchant: string; amount: number; account: string; fingerprint: string }>(
      'SELECT date, merchant, amount, account, fingerprint FROM transactions WHERE id = ?',
      id
    )
    if (!r) continue
    const base = baseFingerprint(r.date, r.merchant, r.amount, r.account)
    // Already correct (base or one of its #N variants)?
    if (r.fingerprint === base || r.fingerprint.startsWith(`${base}#`)) continue
    db.run('UPDATE transactions SET fingerprint = ? WHERE id = ?', freeFingerprint(base, id), id)
  }
}

// ---- validation -------------------------------------------------------------------------------

export interface NewTransaction {
  date: string
  merchant: string
  memo?: string
  category?: string
  amount: number
  type: TxnType
  account: string
  tags?: string[]
  receipt?: boolean
  receiptDocId?: string | null
  source: string
  isTransfer?: boolean
  categoryLocked?: boolean
  reference?: string
  importId?: string | null
}

export function validateNewTransaction(t: NewTransaction): Required<Omit<NewTransaction, 'receiptDocId' | 'importId'>> & {
  receiptDocId: string | null
  importId: string | null
} {
  if (typeof t.amount !== 'number' || !Number.isFinite(t.amount) || t.amount <= 0) {
    throw new AppError('VALIDATION', 'Amount must be a number greater than zero.')
  }
  if (!isValidISODate(t.date)) throw new AppError('VALIDATION', 'Please enter a valid date.')
  const merchant = (t.merchant ?? '').trim()
  if (!merchant) throw new AppError('VALIDATION', 'Merchant cannot be empty.')
  if (t.type !== 'expense' && t.type !== 'income') throw new AppError('VALIDATION', 'Type must be expense or income.')
  const account = (t.account ?? '').trim() || 'Imported account'
  const category = (t.category ?? '').trim() || NEEDS_REVIEW
  const tags = normalizeTags(t.tags ?? [])
  return {
    date: t.date,
    merchant,
    memo: (t.memo ?? '').trim(),
    category,
    amount: round2(t.amount),
    type: t.type,
    account,
    tags,
    receipt: !!t.receipt || !!t.receiptDocId,
    receiptDocId: t.receiptDocId ?? null,
    source: t.source,
    isTransfer: !!t.isTransfer,
    categoryLocked: !!t.categoryLocked,
    reference: (t.reference ?? '').trim(),
    importId: t.importId ?? null
  }
}

// ---- inserts ----------------------------------------------------------------------------------

/**
 * Insert one transaction. If an identical one (same date, merchant, amount, account) exists, throws
 * DUPLICATE unless `allowDuplicate` is set, in which case the next free `#N` fingerprint is used.
 */
export function insertTransaction(input: NewTransaction, opts: { allowDuplicate?: boolean } = {}): Transaction {
  const db = getDb()
  const t = validateNewTransaction(input)
  const base = baseFingerprint(t.date, t.merchant, t.amount, t.account)
  const id = newId()
  const now = nowISO()
  db.transaction(() => {
    let fingerprint = base
    if (db.get('SELECT 1 AS x FROM transactions WHERE fingerprint = ?', base)) {
      if (!opts.allowDuplicate) {
        throw new AppError('DUPLICATE', 'A transaction with the same date, merchant, amount and account already exists.')
      }
      fingerprint = freeFingerprint(base)
    }
    db.run(
      `INSERT INTO transactions (${TXN_COLUMNS}, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, t.date, t.merchant, t.memo, t.category, t.amount, t.type, t.account, JSON.stringify(t.tags),
      t.receipt ? 1 : 0, t.receiptDocId, t.source, t.isTransfer ? 1 : 0, t.categoryLocked ? 1 : 0, t.reference,
      t.importId, now, now, fingerprint
    )
    ensureTagsExist(t.tags)
  })
  markNotFreshStart()
  return getTransactionById(id)!
}

export function getTransactionById(id: string): Transaction | null {
  const r = getDb().get<TxnRow>(`SELECT ${TXN_COLUMNS} FROM transactions WHERE id = ?`, id)
  return r ? rowToTransaction(r) : null
}

export interface BatchRow extends NewTransaction {
  fingerprint: string
}

/**
 * Bulk insert for importers. Must be called inside the caller's transaction boundary (it opens its own
 * nested transaction/savepoint). The database UNIQUE constraint is the source of truth for duplicates:
 * a row whose fingerprint already exists is skipped (not an error) and counted.
 */
export function insertBatch(rows: BatchRow[]): { inserted: number; duplicates: number } {
  const db = getDb()
  let inserted = 0
  let duplicates = 0
  db.transaction(() => {
    const now = nowISO()
    const sql = `INSERT INTO transactions (${TXN_COLUMNS}, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO NOTHING`
    const tagsSeen = new Set<string>()
    for (const r of rows) {
      const t = validateNewTransaction(r)
      const res = db.run(
        sql,
        newId(), t.date, t.merchant, t.memo, t.category, t.amount, t.type, t.account, JSON.stringify(t.tags),
        t.receipt ? 1 : 0, t.receiptDocId, t.source, t.isTransfer ? 1 : 0, t.categoryLocked ? 1 : 0, t.reference,
        t.importId, now, now, r.fingerprint
      )
      if (res.changes > 0) {
        inserted++
        for (const tag of t.tags) tagsSeen.add(tag)
      } else duplicates++
    }
    ensureTagsExist([...tagsSeen])
  })
  if (inserted > 0) markNotFreshStart()
  return { inserted, duplicates }
}
