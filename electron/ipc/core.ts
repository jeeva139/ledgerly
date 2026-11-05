// IPC handlers for the foundation: app info, application lock, catalog (preferences/period/net worth),
// categories, accounts and tags.
import { z } from 'zod'
import { app } from './electronApp'
import { handle, noArgs } from './register'
import { idSchema, nonNegativeAmount, periodId, shortText } from './schemas'
import * as catalog from '../services/catalog'
import * as lock from '../services/lock'
import {
  K, getDetectionPreferences, getImportPreferences, getNetWorth, getPreferences, getSelectedPeriod, getSetting, setSetting
} from '../services/settings'
import { getDb } from '../database/db'
import { getDataDir } from '../database/paths'
import { dialogs } from '../platform/dialogs'
import { isLocked } from '../security/lockState'
import { listAccounts, listCategories, listTagNames } from '../services/catalog'
import { AppError } from '../../shared/errors'
import type { BootstrapState } from '../../shared/types'
import { DEFAULT_DETECTION_PREFERENCES, DEFAULT_IMPORT_PREFERENCES } from '../../shared/types'

export function dataLocationLabel(): string {
  let dir: string
  try {
    dir = getDataDir()
  } catch {
    return ''
  }
  const appData = process.env.APPDATA
  if (appData && dir.toLowerCase() === `${appData}\\Ledgerly`.toLowerCase()) return '%APPDATA%\\Ledgerly'
  return dir
}

export function buildBootstrap(): BootstrapState {
  const db = getDb()
  const lockStatus = lock.lockStatus()
  return {
    appVersion: app.version(),
    categories: listCategories(),
    accounts: listAccounts(),
    tags: listTagNames(),
    preferences: getPreferences(),
    selectedPeriod: getSelectedPeriod(),
    netWorth: getNetWorth(),
    freshStart: getSetting<boolean>(K.freshStart, true),
    lock: { enabled: lockStatus.enabled, locked: lockStatus.locked },
    counts: {
      transactions: db.scalar<number>('SELECT COUNT(*) FROM transactions') ?? 0,
      documents: db.scalar<number>('SELECT COUNT(*) FROM documents') ?? 0
    },
    dataLocation: dataLocationLabel()
  }
}

const accountType = z.enum(['bank', 'credit-card', 'cash', 'wallet', 'other'])
const prefsPatch = z
  .object({
    currency: z.string().max(8),
    dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
    firstDayOfWeek: z.union([z.literal(0), z.literal(1), z.literal(6)]),
    theme: z.enum(['light', 'dark', 'system']),
    startupPage: z.enum(['dashboard', 'last']),
    sidebarCollapsed: z.boolean()
  })
  .partial()
  .strict()

export function registerCoreIpc(): void {
  // ---- app ----
  handle(
    'app.info',
    noArgs,
    () => ({
      version: app.version(),
      platform: process.platform,
      electron: process.versions.electron ?? 'n/a',
      dataLocation: isLocked() ? '' : dataLocationLabel()
    }),
    { allowWhenLocked: true }
  )

  handle('app.openDataFolder', noArgs, async () => {
    const err = await dialogs().openFolder(getDataDir())
    if (err) throw new AppError('IO', 'Ledgerly could not open the data folder.')
  })

  // ---- lock ----
  handle('lock.status', noArgs, () => lock.lockStatus(), { allowWhenLocked: true })
  handle('lock.unlock', z.object({ pin: z.string().max(64) }), ({ pin }) => lock.unlock(pin), { allowWhenLocked: true })
  handle('lock.lockNow', noArgs, () => lock.lockNow())
  handle('lock.setPin', z.object({ pin: z.string().max(64), currentPin: z.string().max(64).optional() }), ({ pin, currentPin }) =>
    lock.setPin(pin, currentPin)
  )
  handle('lock.removePin', z.object({ pin: z.string().max(64) }), ({ pin }) => lock.removePin(pin))
  handle('lock.setIdleMinutes', z.object({ minutes: z.number().int() }), ({ minutes }) => lock.setIdleMinutes(minutes))

  // ---- catalog ----
  handle('catalog.bootstrap', noArgs, () => buildBootstrap())
  handle('catalog.setPreferences', prefsPatch, (patch) => catalog.savePreferences(patch))
  handle('catalog.setPeriod', z.object({ period: periodId }), ({ period }) => catalog.savePeriod(period))
  handle('catalog.setNetWorth', z.object({ assets: nonNegativeAmount, liabilities: nonNegativeAmount }), (v) => catalog.saveNetWorth(v))
  handle('catalog.clearNetWorth', noArgs, () => catalog.clearNetWorth())
  handle('catalog.getImportPreferences', noArgs, () => getImportPreferences())
  handle(
    'catalog.setImportPreferences',
    z.object({ keepRepeatedRows: z.boolean(), rulesOverrideImported: z.boolean(), addNewCategories: z.boolean() }).partial().strict(),
    (patch) => {
      const next = { ...DEFAULT_IMPORT_PREFERENCES, ...getImportPreferences(), ...patch }
      setSetting(K.importPreferences, next)
      return next
    }
  )
  handle('catalog.getDetectionPreferences', noArgs, () => getDetectionPreferences())
  handle(
    'catalog.setDetectionPreferences',
    z.object({ recurring: z.boolean(), subscriptions: z.boolean() }).partial().strict(),
    (patch) => {
      const next = { ...DEFAULT_DETECTION_PREFERENCES, ...getDetectionPreferences(), ...patch }
      setSetting(K.detectionPreferences, next)
      return next
    }
  )
  handle('catalog.setLastPage', z.object({ page: z.string().max(40) }), ({ page }) => setSetting(K.lastPage, page))
  handle('catalog.getLastPage', noArgs, () => getSetting<string | null>(K.lastPage, null))

  // ---- categories ----
  handle('categories.list', noArgs, () => catalog.categoriesWithUsage())
  handle('categories.add', z.object({ name: shortText(60, 'Category name'), parent: z.string().max(60).nullish() }), ({ name, parent }) =>
    catalog.addCategory({ name, parent: parent ?? null })
  )
  handle('categories.rename', z.object({ from: shortText(130), newName: shortText(60, 'Category name') }), ({ from, newName }) =>
    catalog.renameCategory(from, newName)
  )
  handle('categories.remove', z.object({ name: shortText(130) }), ({ name }) => catalog.removeCategory(name))

  // ---- accounts ----
  handle('accounts.list', noArgs, () => catalog.listAccounts())
  handle(
    'accounts.create',
    z.object({
      name: shortText(60, 'Account name'),
      type: accountType.optional(),
      openingBalance: z.number().finite().nullable().optional(),
      active: z.boolean().optional()
    }),
    (input) => catalog.createAccount(input)
  )
  handle(
    'accounts.update',
    z.object({
      id: idSchema,
      name: shortText(60, 'Account name').optional(),
      type: accountType.optional(),
      openingBalance: z.number().finite().nullable().optional(),
      active: z.boolean().optional()
    }),
    ({ id, ...patch }) => catalog.updateAccount(id, patch)
  )
  handle('accounts.remove', z.object({ id: idSchema }), ({ id }) => catalog.removeAccount(id))

  // ---- tags ----
  handle('tags.list', noArgs, () => catalog.listTagUsage())
  handle('tags.create', z.object({ name: shortText(40, 'Tag name') }), ({ name }) => catalog.createTag(name))
  handle('tags.delete', z.object({ name: shortText(40), removeFromTransactions: z.boolean() }), ({ name, removeFromTransactions }) =>
    catalog.deleteTag(name, removeFromTransactions)
  )
}
