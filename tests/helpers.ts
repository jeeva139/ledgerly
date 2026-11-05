import { openMemoryDatabase, closeDatabase } from '../electron/database/db'
import { seedDefaultsIfNeeded, resetFreshStartCache } from '../electron/services/settings'
import { setLocked } from '../electron/security/lockState'
import type { Db } from '../electron/database/sqlite'

/** Fresh in-memory database with migrations applied and starter definitions seeded. */
export function freshDb(): Db {
  closeDatabase()
  const db = openMemoryDatabase()
  resetFreshStartCache()
  setLocked(false)
  seedDefaultsIfNeeded()
  return db
}

export function count(db: Db, table: string): number {
  return db.scalar<number>(`SELECT COUNT(*) FROM ${table}`) ?? 0
}

export const LONG_UPI =
  'UPI-MR A MANIKANDAN-9578379800-2@YBL-CIUB0000476-621367896104-LUNCHUPI-JEEVAJEEVA534571OKAX-JEEVAJEEVA53457-1@OKAXIS-YESB0001350-657900506223-TEA'
