import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../sqlite'
import { AppError } from '../../../shared/errors'
import { migration001 } from './001_initial'
import { migration002 } from './002_extensions'

export interface Migration {
  version: number
  name: string
  up: (db: Db) => void
}

/** Append new migrations to the end. Never edit or reorder a migration that has shipped. */
export const MIGRATIONS: Migration[] = [migration001, migration002]
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

function ensureMigrationTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version   INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    appliedAt TEXT NOT NULL
  )`)
}

export function currentSchemaVersion(db: Db): number {
  ensureMigrationTable(db)
  return db.scalar<number>('SELECT COALESCE(MAX(version), 0) FROM schema_migrations') ?? 0
}

/**
 * Apply pending migrations, each inside its own transaction.
 * An existing database is never replaced: before upgrading one that already has data we take a
 * safety copy into `backupDir` (when given).
 */
export function runMigrations(db: Db, opts: { backupDir?: string } = {}): { from: number; to: number } {
  const from = currentSchemaVersion(db)
  if (from > LATEST_SCHEMA_VERSION) {
    throw new AppError(
      'DB',
      'This Ledgerly database was created by a newer version of the application. Please update Ledgerly or restore a compatible backup.'
    )
  }
  const pending = MIGRATIONS.filter((m) => m.version > from)
  if (pending.length === 0) return { from, to: from }

  if (from > 0 && opts.backupDir && db.file !== ':memory:') {
    try {
      fs.mkdirSync(opts.backupDir, { recursive: true })
      const dest = path.join(opts.backupDir, `pre-migration-v${from}-${Date.now()}.db`)
      db.vacuumInto(dest)
    } catch {
      /* A failed safety copy must not block startup, but the migrations below are transactional. */
    }
  }

  for (const m of pending) {
    db.transaction(() => {
      m.up(db)
      db.run('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)', m.version, m.name, new Date().toISOString())
    })
  }
  return { from, to: LATEST_SCHEMA_VERSION }
}
