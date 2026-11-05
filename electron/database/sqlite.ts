import { DatabaseSync, type StatementSync } from 'node:sqlite'

export type SqlParam = null | number | bigint | string | Uint8Array

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

/**
 * Small synchronous wrapper around Electron's built-in `node:sqlite`.
 * Every statement is parameterised — callers never build SQL from user text.
 */
export class Db {
  readonly raw: DatabaseSync
  readonly file: string
  private cache = new Map<string, StatementSync>()
  private depth = 0
  private spCounter = 0

  constructor(file: string, opts: { readOnly?: boolean } = {}) {
    this.file = file
    this.raw = new DatabaseSync(file, { readOnly: opts.readOnly ?? false, timeout: 5000 })
    if (!opts.readOnly) {
      this.raw.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -65536;
      `)
    }
  }

  private stmt(sql: string): StatementSync {
    const hit = this.cache.get(sql)
    if (hit) return hit
    const s = this.raw.prepare(sql)
    // Cache static statements only; huge dynamic IN-lists are prepared once and dropped.
    if (sql.length < 2000 && this.cache.size < 400) this.cache.set(sql, s)
    return s
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  run(sql: string, ...params: SqlParam[]): RunResult {
    const r = this.stmt(sql).run(...params)
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[] {
    return this.stmt(sql).all(...params) as T[]
  }

  /**
   * Iterate over every row of a query.
   *
   * `node:sqlite`'s native `StatementSync.iterate()` costs ~25 µs per row (about 2.5 s for 100,000 rows)
   * whereas one `.all()` call costs ~4 µs per row. Personal-finance data sets are small enough
   * (100k rows ≈ tens of MB) that reading the result in a single native call is the better trade-off,
   * so this yields from an in-memory array. For unbounded scans prefer paging with LIMIT/OFFSET.
   */
  *iterate<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): Generator<T> {
    const rows = this.raw.prepare(sql).all(...params) as T[]
    for (let i = 0; i < rows.length; i++) yield rows[i]
  }

  scalar<T = number>(sql: string, ...params: SqlParam[]): T | undefined {
    const row = this.stmt(sql).get(...params) as Record<string, unknown> | undefined
    if (!row) return undefined
    return Object.values(row)[0] as T
  }

  /**
   * Run `fn` inside a transaction. Nested calls become savepoints. Throwing rolls everything back.
   * `fn` must be synchronous.
   */
  transaction<T>(fn: () => T): T {
    if (this.depth === 0) {
      this.raw.exec('BEGIN IMMEDIATE')
      this.depth = 1
      try {
        const result = fn()
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new Error('Db.transaction callback must be synchronous')
        }
        this.raw.exec('COMMIT')
        return result
      } catch (e) {
        try {
          this.raw.exec('ROLLBACK')
        } catch {
          /* already rolled back */
        }
        throw e
      } finally {
        this.depth = 0
      }
    }
    const name = `sp_${++this.spCounter}`
    this.raw.exec(`SAVEPOINT ${name}`)
    this.depth++
    try {
      const result = fn()
      this.raw.exec(`RELEASE ${name}`)
      return result
    } catch (e) {
      try {
        this.raw.exec(`ROLLBACK TO ${name}`)
        this.raw.exec(`RELEASE ${name}`)
      } catch {
        /* ignore */
      }
      throw e
    } finally {
      this.depth--
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0
  }

  /** Consistent, compacted copy of the database (safe while the app is running). */
  vacuumInto(destFile: string): void {
    this.raw.prepare('VACUUM INTO ?').run(destFile)
  }

  checkpoint(): void {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* best effort */
    }
  }

  close(): void {
    this.cache.clear()
    try {
      this.checkpoint()
      this.raw.close()
    } catch {
      /* already closed */
    }
  }
}
