// Erase everything Ledgerly stores and return to a brand-new installation.
import { getDb } from '../database/db'
import { clearVaultFiles } from '../documents/vault'
import { reloadWindows } from '../platform/events'
import { log } from '../logging/logger'
import { createSafetyBackup } from '../backup/service'
import { setLocked } from '../security/lockState'
import { resetFreshStartCache, seedDefaultsIfNeeded } from './settings'
import { AppError } from '../../shared/errors'

/** Tables that hold user data. `schema_migrations` is structural and is kept. */
export const DATA_TABLES = ['transactions', 'tags', 'rules', 'documents', 'import_history', 'settings'] as const

/** Delete every row of user data and reset settings to the fresh-install state (starter definitions only). */
export function wipeDatabaseAndVault(): void {
  const db = getDb()
  db.transaction(() => {
    for (const t of DATA_TABLES) db.run(`DELETE FROM ${t}`)
  })
  clearVaultFiles()
  resetFreshStartCache()
  seedDefaultsIfNeeded()
  setLocked(false)
  try {
    // Reclaim the freed pages so deleted records do not linger inside the database file.
    db.exec('VACUUM')
    db.checkpoint()
  } catch {
    /* compaction is best effort */
  }
}

export async function eraseAllData(input: { confirmation: string; safetyBackup: boolean }): Promise<{ safetyBackupName: string | null }> {
  if (input.confirmation !== 'DELETE') {
    throw new AppError('VALIDATION', 'To erase your data, type DELETE exactly as shown.')
  }
  // If a requested safety backup cannot be made we stop — nothing is deleted.
  const safetyBackupName = input.safetyBackup ? await createSafetyBackup('before-erase') : null
  wipeDatabaseAndVault()
  log.warn('data.erased')
  reloadWindows()
  return { safetyBackupName }
}
