// Recurring & Subscriptions — IPC handlers.
import { z } from 'zod'
import { handle, noArgs } from './register'
import {
  detectionStatus, ignoreRecurring, keepRecurring, listRecurring, listSubscriptions, restoreRecurring
} from '../services/recurring'

const status = z.enum(['suggested', 'kept', 'ignored', 'all'])
const kind = z.enum(['subscription', 'bill', 'other', 'all'])
const keyOnly = z.object({ key: z.string().min(1, 'Missing payment identifier.').max(300) })

export function registerRecurringIpc(): void {
  handle('recurring.list', z.object({ status: status.optional(), kind: kind.optional() }).optional(), (input) => listRecurring(input ?? {}))
  handle('recurring.keep', keyOnly, ({ key }) => keepRecurring(key))
  handle('recurring.ignore', keyOnly, ({ key }) => ignoreRecurring(key))
  handle('recurring.restore', keyOnly, ({ key }) => restoreRecurring(key))
  handle('recurring.status', noArgs, () => detectionStatus())

  handle('subscriptions.list', z.object({ status: status.optional() }).optional(), (input) => listSubscriptions(input?.status ?? 'all'))
}
