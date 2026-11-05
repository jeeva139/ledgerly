// Fast synthetic data for performance tests: one prepared INSERT inside one transaction, bypassing
// insertBatch (which slows down as the table grows because of its per-row validation + 7 indexes).
// `synchronous=OFF` is applied to the throwaway test database only.
import { randomUUID } from 'node:crypto'
import type { Db } from '../electron/database/sqlite'

/** Deterministic pseudo-random generator so data (and timings) are repeatable. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** "aaa", "aab", … — alphabetic only, so merchant normalisation keeps them distinct (digits would be stripped). */
export function alpha(n: number, width = 3): string {
  let out = ''
  let v = n
  for (let i = 0; i < width; i++) {
    out = String.fromCharCode(97 + (v % 26)) + out
    v = Math.floor(v / 26)
  }
  return out
}

export interface SeedOptions {
  count: number
  /** Latest month of the data (default Nov 2026) and how many months it spans. */
  endYear?: number
  endMonth0?: number
  months?: number
  seed?: number
}

export function seedRawTransactions(db: Db, opts: SeedOptions): void {
  const { count, endYear = 2026, endMonth0 = 10, months = 36, seed = 42 } = opts
  const rand = rng(seed)
  const categories = ['Groceries', 'Dining', 'Housing', 'Transportation', 'Utilities', 'Health', 'Shopping', 'Entertainment', 'Food:Dining', 'Food:Snacks', 'Needs review', 'Other']
  const accounts = ['Main Checking', 'Everyday Visa', 'Cash']
  const stores = Array.from({ length: 1500 }, (_, i) => `Store ${alpha(i)} Pvt Ltd`)
  const people = Array.from({ length: 400 }, (_, i) => `${alpha(i, 4).toUpperCase()} KUMAR`)
  const now = new Date().toISOString()

  db.exec('PRAGMA synchronous = OFF')
  db.transaction(() => {
    const st = db.raw.prepare(
      `INSERT INTO transactions (id, date, merchant, memo, category, amount, type, account, tags, receipt, receiptDocId, source, isTransfer, categoryLocked, reference, importId, createdAt, updatedAt, fingerprint)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 0, NULL, 'perf', ?, 0, '', NULL, ?, ?, ?)`
    )
    for (let i = 0; i < count; i++) {
      const d = new Date(endYear, endMonth0 - Math.floor(rand() * months), 1 + Math.floor(rand() * 28))
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const type = rand() < 0.12 ? 'income' : 'expense'
      const merchant =
        rand() < 0.2
          ? `UPI-${people[Math.floor(rand() * people.length)]}-${9000000000 + i}-${i}@YBL-CIUB0000476-${600000000000 + i}-NOTE`
          : `${stores[Math.floor(rand() * stores.length)]} #${i}`
      const amount = Math.round((rand() * 5000 + 1) * 100) / 100
      const account = accounts[Math.floor(rand() * accounts.length)]
      const category = type === 'income' ? 'Income' : categories[Math.floor(rand() * categories.length)]
      const tags = rand() < 0.1 ? '["Weekend"]' : '[]'
      const isTransfer = rand() < 0.03 ? 1 : 0
      st.run(randomUUID(), date, merchant, category, amount, type, account, tags, isTransfer, now, now, `${date}|${merchant}|${amount.toFixed(2)}|${account}#${i}`)
    }
  })
}
