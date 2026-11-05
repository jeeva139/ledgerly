import { Db } from './sqlite'
import { runMigrations } from './migrations'
import { paths } from './paths'
import { AppError } from '../../shared/errors'

let current: Db | null = null

export function getDb(): Db {
  if (!current) throw new AppError('DB', 'Ledgerly could not open its database. Your existing files have not been deleted. Please restart the application or restore a backup.')
  return current
}

export function hasDb(): boolean {
  return current !== null
}

/**
 * Open (or create) the on-disk database and bring its schema up to date.
 * Never deletes or recreates an existing file; never falls back to a different location.
 */
export function openDatabase(file: string = paths.db()): Db {
  try {
    const db = new Db(file)
    runMigrations(db, { backupDir: paths.backups() })
    current = db
    return db
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError(
      'DB',
      'Ledgerly could not open its database. Your existing files have not been deleted. Please restart the application or restore a backup.'
    )
  }
}

/** Fresh in-memory database installed as the active one (used by tests). */
export function openMemoryDatabase(): Db {
  const db = new Db(':memory:')
  runMigrations(db)
  current = db
  return db
}

export function closeDatabase(): void {
  if (current) {
    current.close()
    current = null
  }
}

export function setActiveDatabase(db: Db | null): void {
  current = db
}
