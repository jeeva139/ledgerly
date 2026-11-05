import { getDb } from '../database/db'
import {
  DEFAULT_DETECTION_PREFERENCES,
  DEFAULT_IMPORT_PREFERENCES,
  DEFAULT_PREFERENCES,
  STARTER_ACCOUNT_DEFS,
  STARTER_CATEGORIES,
  type Account,
  type DetectionPreferences,
  type ImportPreferences,
  type NetWorthState,
  type PeriodId,
  type Preferences
} from '../../shared/types'
import { newId, nowISO } from '../database/ids'

/** Keys used in the `settings` table (JSON-encoded values). */
export const K = {
  categories: 'categories',
  accounts: 'accounts',
  budgets: 'budgets',
  goals: 'goals',
  recurringDecisions: 'recurringDecisions',
  assets: 'assets',
  liabilities: 'liabilities',
  netWorthConfigured: 'netWorthConfigured',
  selectedPeriod: 'selectedPeriod',
  preferences: 'preferences',
  importPreferences: 'importPreferences',
  detectionPreferences: 'detectionPreferences',
  freshStart: 'freshStart',
  rulesOrderMode: 'rulesOrderMode',
  lock: 'lock',
  lastPage: 'lastPage',
  seeded: 'seeded'
} as const

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(key: string, value: unknown): void {
  getDb().run(
    `INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    key,
    JSON.stringify(value),
    nowISO()
  )
}

export function deleteSetting(key: string): void {
  getDb().run('DELETE FROM settings WHERE key = ?', key)
}

/**
 * Read-modify-write a setting atomically (main process is single-threaded and every call is synchronous,
 * so no other handler can interleave).
 */
export function updateSetting<T>(key: string, fallback: T, fn: (current: T) => T): T {
  return getDb().transaction(() => {
    const next = fn(getSetting<T>(key, fallback))
    setSetting(key, next)
    return next
  })
}

// ---- typed accessors ------------------------------------------------------------------------

export const getPreferences = (): Preferences => ({ ...DEFAULT_PREFERENCES, ...getSetting<Partial<Preferences>>(K.preferences, {}) })
export const getImportPreferences = (): ImportPreferences => ({
  ...DEFAULT_IMPORT_PREFERENCES,
  ...getSetting<Partial<ImportPreferences>>(K.importPreferences, {})
})
export const getDetectionPreferences = (): DetectionPreferences => ({
  ...DEFAULT_DETECTION_PREFERENCES,
  ...getSetting<Partial<DetectionPreferences>>(K.detectionPreferences, {})
})
export const getSelectedPeriod = (): PeriodId => getSetting<PeriodId>(K.selectedPeriod, 'all-time')
export const getCategories = (): string[] => getSetting<string[]>(K.categories, [])
export const getAccounts = (): Account[] => getSetting<Account[]>(K.accounts, [])
export const getNetWorth = (): NetWorthState => ({
  configured: getSetting<boolean>(K.netWorthConfigured, false),
  assets: getSetting<number>(K.assets, 0),
  liabilities: getSetting<number>(K.liabilities, 0)
})

/**
 * First-launch seeding: starter category names and account *definitions* only.
 * No transactions, balances, budgets, goals, rules, tags, subscriptions or documents are ever created here.
 */
export function seedDefaultsIfNeeded(): boolean {
  const db = getDb()
  if (getSetting<boolean>(K.seeded, false)) return false
  db.transaction(() => {
    setSetting(K.categories, STARTER_CATEGORIES)
    setSetting(
      K.accounts,
      STARTER_ACCOUNT_DEFS.map<Account>((a) => ({ id: newId(), name: a.name, type: a.type, openingBalance: null, active: true }))
    )
    setSetting(K.budgets, [])
    setSetting(K.goals, [])
    setSetting(K.recurringDecisions, {})
    setSetting(K.assets, 0)
    setSetting(K.liabilities, 0)
    setSetting(K.netWorthConfigured, false)
    setSetting(K.selectedPeriod, 'all-time')
    setSetting(K.preferences, DEFAULT_PREFERENCES)
    setSetting(K.importPreferences, DEFAULT_IMPORT_PREFERENCES)
    setSetting(K.detectionPreferences, DEFAULT_DETECTION_PREFERENCES)
    setSetting(K.rulesOrderMode, 'auto')
    setSetting(K.freshStart, true)
    setSetting(K.seeded, true)
  })
  return true
}

let freshStartCache: boolean | null = null
/** Called whenever the first real financial record is created. */
export function markNotFreshStart(): void {
  if (freshStartCache === false) return
  if (getSetting<boolean>(K.freshStart, true)) setSetting(K.freshStart, false)
  freshStartCache = false
}
export function resetFreshStartCache(): void {
  freshStartCache = null
}
