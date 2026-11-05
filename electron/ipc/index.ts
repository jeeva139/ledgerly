import { registerCoreIpc } from './core'
import { registerTransactionsIpc } from './transactions'
import { registerCategoryFinderIpc } from './categoryFinder'
import { registerRulesIpc } from './rules'
import { registerImportIpc } from './imports'
import { registerRecurringIpc } from './recurring'
import { registerPlanningIpc } from './planning'
import { registerDocumentsIpc } from './documents'
import { registerReportsIpc } from './reports'
import { registerBackupIpc } from './backup'
import { API_METHODS } from '../../shared/api'
import { registeredChannels } from './register'

/** Register every handler once (a no-op when the registry is already populated). */
export function registerAllIpc(): void {
  if (registeredChannels().length > 0) return
  registerCoreIpc()
  registerTransactionsIpc()
  registerCategoryFinderIpc()
  registerRulesIpc()
  registerImportIpc()
  registerRecurringIpc()
  registerPlanningIpc()
  registerDocumentsIpc()
  registerReportsIpc()
  registerBackupIpc()
}

/** Channels declared in the shared API contract that have no handler (should always be empty). */
export function missingHandlers(): string[] {
  const have = new Set(registeredChannels())
  const missing: string[] = []
  for (const [ns, methods] of Object.entries(API_METHODS)) {
    for (const m of methods) if (!have.has(`${ns}.${m}`)) missing.push(`${ns}.${m}`)
  }
  return missing
}
