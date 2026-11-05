// Backup, Restore and the full data wipe — IPC handlers (`backup.*` and `data.*`).
import { z } from 'zod'
import { handle, noArgs } from './register'
import { createBackup, inspectBackup, listBackups, restoreBackup } from '../backup/service'
import { eraseAllData } from '../services/dataWipe'

export function registerBackupIpc(): void {
  handle('backup.create', z.object({ destination: z.enum(['ask', 'backups-folder']) }), ({ destination }) => createBackup(destination))
  handle('backup.list', noArgs, () => listBackups())
  handle('backup.inspect', z.object({ name: z.string().max(260).optional() }).optional(), (input) => inspectBackup(input?.name))
  handle(
    'backup.restore',
    z.object({ token: z.string().min(8).max(100), safetyBackup: z.boolean().optional() }),
    ({ token, safetyBackup }) => restoreBackup(token, safetyBackup ?? true)
  )

  handle(
    'data.eraseAll',
    z.object({ confirmation: z.string().max(40), safetyBackup: z.boolean().optional() }),
    ({ confirmation, safetyBackup }) => eraseAllData({ confirmation, safetyBackup: safetyBackup ?? false })
  )
}
