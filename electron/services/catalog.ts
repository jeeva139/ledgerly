// Managed lists the rest of the app depends on: categories, accounts, tags, preferences,
// selected period and net worth. All stored in SQLite (settings / tags tables).
import { getDb } from '../database/db'
import { newId, nowISO } from '../database/ids'
import { refingerprintTransactions, ensureTagsExist, MAX_TAG_LENGTH } from '../database/txnStore'
import {
  K,
  getAccounts,
  getCategories,
  getNetWorth,
  getPreferences,
  getSelectedPeriod,
  getSetting,
  setSetting,
  updateSetting
} from './settings'
import { AppError } from '../../shared/errors'
import { CURRENCIES, round2 } from '../../shared/money'
import {
  ACCOUNT_TYPES,
  CATEGORY_SEPARATOR,
  NEEDS_REVIEW,
  PERIODS,
  type Account,
  type AccountType,
  type Budget,
  type NetWorthState,
  type PeriodId,
  type Preferences,
  type TagUsage
} from '../../shared/types'

// =============================================================================================
// Categories
// =============================================================================================

/** Categories the application itself relies on; they can't be renamed or removed. */
export const SYSTEM_CATEGORIES = [NEEDS_REVIEW]

export interface CategoryInfo {
  name: string
  /** Transactions currently carrying this exact label. */
  count: number
  /** Present in the managed list (false = label only exists on historical transactions). */
  managed: boolean
  system: boolean
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function listCategories(): string[] {
  return getCategories()
}

export function categoryExists(name: string): boolean {
  return getCategories().some((c) => sameName(c, name))
}

/** Case-insensitive lookup returning the managed spelling. */
export function canonicalCategory(name: string): string | null {
  return getCategories().find((c) => sameName(c, name)) ?? null
}

export function categoriesWithUsage(): CategoryInfo[] {
  const usage = new Map<string, number>()
  for (const r of getDb().all<{ category: string; c: number }>('SELECT category, COUNT(*) AS c FROM transactions GROUP BY category')) {
    usage.set(r.category, r.c)
  }
  const managed = getCategories()
  const out: CategoryInfo[] = managed.map((name) => ({
    name,
    count: usage.get(name) ?? 0,
    managed: true,
    system: SYSTEM_CATEGORIES.includes(name)
  }))
  for (const [name, count] of usage) {
    if (!managed.some((m) => m === name)) out.push({ name, count, managed: false, system: false })
  }
  return out
}

function validateCategoryLeaf(name: string): string {
  const leaf = (name ?? '').trim().replace(/\s+/g, ' ')
  if (!leaf) throw new AppError('VALIDATION', 'Category name cannot be empty.')
  if (leaf.length > 60) throw new AppError('VALIDATION', 'Category names can be at most 60 characters long.')
  if (leaf.includes(CATEGORY_SEPARATOR)) throw new AppError('VALIDATION', `Category names cannot contain "${CATEGORY_SEPARATOR}".`)
  return leaf
}

/** Add a category, or a subcategory when `parent` is given. Returns the updated list. */
export function addCategory(input: { name: string; parent?: string | null }): string[] {
  const leaf = validateCategoryLeaf(input.name)
  let full = leaf
  if (input.parent) {
    const parent = canonicalCategory(input.parent)
    if (!parent) throw new AppError('NOT_FOUND', 'The parent category does not exist.')
    if (parent.includes(CATEGORY_SEPARATOR)) throw new AppError('VALIDATION', 'Subcategories can only be one level deep.')
    full = `${parent}${CATEGORY_SEPARATOR}${leaf}`
  }
  return updateSetting<string[]>(K.categories, [], (list) => {
    if (list.some((c) => sameName(c, full))) throw new AppError('DUPLICATE', `A category named "${full.replace(CATEGORY_SEPARATOR, ' › ')}" already exists.`)
    return [...list, full]
  })
}

/** Add the category if it is not in the managed list yet (explicit creation from Category Finder / import). */
export function ensureCategory(name: string): string {
  const existing = canonicalCategory(name)
  if (existing) return existing
  const trimmed = (name ?? '').trim()
  if (trimmed.includes(CATEGORY_SEPARATOR)) {
    const idx = trimmed.indexOf(CATEGORY_SEPARATOR)
    const parentName = trimmed.slice(0, idx).trim()
    const leaf = trimmed.slice(idx + 1).trim()
    if (parentName && leaf) {
      ensureCategory(parentName)
      const parent = canonicalCategory(parentName)!
      const full = `${parent}${CATEGORY_SEPARATOR}${validateCategoryLeaf(leaf)}`
      const found = canonicalCategory(full)
      if (found) return found
      updateSetting<string[]>(K.categories, [], (list) => [...list, full])
      return full
    }
  }
  const leaf = validateCategoryLeaf(trimmed)
  updateSetting<string[]>(K.categories, [], (list) => [...list, leaf])
  return leaf
}

export interface RenameCategoryResult {
  categories: string[]
  transactions: number
  rules: number
  budgets: number
}

/**
 * Rename a category (or subcategory). `newLeaf` is the new name without any parent part.
 * Subcategories of a renamed parent follow along. Transactions, saved rules and budgets are updated so nothing is orphaned.
 */
export function renameCategory(from: string, newLeaf: string): RenameCategoryResult {
  const db = getDb()
  const current = canonicalCategory(from)
  if (!current) throw new AppError('NOT_FOUND', 'That category does not exist.')
  if (SYSTEM_CATEGORIES.includes(current)) throw new AppError('VALIDATION', `"${current}" is used by Ledgerly and cannot be renamed.`)
  const leaf = validateCategoryLeaf(newLeaf)
  const sepIdx = current.lastIndexOf(CATEGORY_SEPARATOR)
  const prefix = sepIdx >= 0 ? current.slice(0, sepIdx + 1) : ''
  const to = `${prefix}${leaf}`
  if (to === current) return { categories: getCategories(), transactions: 0, rules: 0, budgets: 0 }
  if (getCategories().some((c) => c !== current && sameName(c, to))) {
    throw new AppError('DUPLICATE', `A category named "${to.replace(CATEGORY_SEPARATOR, ' › ')}" already exists.`)
  }
  const now = nowISO()
  const childPrefix = `${current}${CATEGORY_SEPARATOR}`
  const rewrite = (cat: string) => (cat === current ? to : cat.startsWith(childPrefix) ? `${to}${CATEGORY_SEPARATOR}${cat.slice(childPrefix.length)}` : cat)
  const likePattern = `${childPrefix.replace(/[\\%_]/g, '\\$&')}%`

  return db.transaction(() => {
    let transactions = 0
    transactions += db.run('UPDATE transactions SET category = ?, updatedAt = ? WHERE category = ?', to, now, current).changes
    transactions += db.run(
      `UPDATE transactions SET category = ? || substr(category, ?), updatedAt = ? WHERE category LIKE ? ESCAPE '\\'`,
      to + CATEGORY_SEPARATOR, childPrefix.length + 1, now, likePattern
    ).changes
    let rules = 0
    rules += db.run('UPDATE rules SET thenText = ?, updatedAt = ? WHERE thenText = ?', to, now, current).changes
    rules += db.run(
      `UPDATE rules SET thenText = ? || substr(thenText, ?), updatedAt = ? WHERE thenText LIKE ? ESCAPE '\\'`,
      to + CATEGORY_SEPARATOR, childPrefix.length + 1, now, likePattern
    ).changes
    let budgets = 0
    updateSetting<Budget[]>(K.budgets, [], (list) =>
      list.map((b) => {
        const next = rewrite(b.category)
        if (next !== b.category) budgets++
        return { ...b, category: next }
      })
    )
    const categories = updateSetting<string[]>(K.categories, [], (list) => list.map(rewrite))
    return { categories, transactions, rules, budgets }
  })
}

/**
 * Remove a category from the managed list. Historical transaction labels are NOT rewritten.
 * Removing a parent also removes its subcategories from the list.
 */
export function removeCategory(name: string): string[] {
  const current = canonicalCategory(name)
  if (!current) throw new AppError('NOT_FOUND', 'That category does not exist.')
  if (SYSTEM_CATEGORIES.includes(current)) throw new AppError('VALIDATION', `"${current}" is used by Ledgerly and cannot be removed.`)
  const childPrefix = `${current}${CATEGORY_SEPARATOR}`
  return updateSetting<string[]>(K.categories, [], (list) => list.filter((c) => c !== current && !c.startsWith(childPrefix)))
}

// =============================================================================================
// Accounts
// =============================================================================================

export interface AccountInput {
  name: string
  type?: AccountType
  openingBalance?: number | null
  active?: boolean
}

function validateAccountName(name: string): string {
  const n = (name ?? '').trim().replace(/\s+/g, ' ')
  if (!n) throw new AppError('VALIDATION', 'Account name cannot be empty.')
  if (n.length > 60) throw new AppError('VALIDATION', 'Account names can be at most 60 characters long.')
  return n
}

function validateOpeningBalance(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new AppError('VALIDATION', 'Opening balance must be a number.')
  return round2(v)
}

function validateAccountType(t: unknown): AccountType {
  if (t === undefined) return 'bank'
  if (!ACCOUNT_TYPES.some((a) => a.id === t)) throw new AppError('VALIDATION', 'Unknown account type.')
  return t as AccountType
}

export function listAccounts(): Account[] {
  return getAccounts()
}

export function createAccount(input: AccountInput): Account {
  const name = validateAccountName(input.name)
  const account: Account = {
    id: newId(),
    name,
    type: validateAccountType(input.type),
    openingBalance: validateOpeningBalance(input.openingBalance),
    active: input.active ?? true
  }
  updateSetting<Account[]>(K.accounts, [], (list) => {
    if (list.some((a) => sameName(a.name, name))) throw new AppError('DUPLICATE', `An account named "${name}" already exists.`)
    return [...list, account]
  })
  return account
}

/** Create the account only if no account with this name exists (used when an import targets a new account). */
export function ensureAccount(name: string, type: AccountType = 'other'): Account {
  const existing = getAccounts().find((a) => sameName(a.name, name))
  return existing ?? createAccount({ name, type })
}

export function updateAccount(id: string, patch: Partial<AccountInput>): Account {
  const db = getDb()
  const accounts = getAccounts()
  const current = accounts.find((a) => a.id === id)
  if (!current) throw new AppError('NOT_FOUND', 'That account does not exist.')
  const next: Account = {
    ...current,
    name: patch.name !== undefined ? validateAccountName(patch.name) : current.name,
    type: patch.type !== undefined ? validateAccountType(patch.type) : current.type,
    openingBalance: patch.openingBalance !== undefined ? validateOpeningBalance(patch.openingBalance) : current.openingBalance,
    active: patch.active ?? current.active
  }
  if (accounts.some((a) => a.id !== id && sameName(a.name, next.name))) {
    throw new AppError('DUPLICATE', `An account named "${next.name}" already exists.`)
  }
  db.transaction(() => {
    if (next.name !== current.name) {
      const ids = db.all<{ id: string }>('SELECT id FROM transactions WHERE account = ?', current.name).map((r) => r.id)
      db.run('UPDATE transactions SET account = ?, updatedAt = ? WHERE account = ?', next.name, nowISO(), current.name)
      refingerprintTransactions(ids)
    }
    setSetting(K.accounts, accounts.map((a) => (a.id === id ? next : a)))
  })
  return next
}

/** Removes the account definition only; transactions keep their account label. */
export function removeAccount(id: string): Account[] {
  return updateSetting<Account[]>(K.accounts, [], (list) => {
    if (!list.some((a) => a.id === id)) throw new AppError('NOT_FOUND', 'That account does not exist.')
    return list.filter((a) => a.id !== id)
  })
}

// =============================================================================================
// Tags
// =============================================================================================

export function listTagUsage(): TagUsage[] {
  return getDb().all<TagUsage>(
    `SELECT t.name AS name, t.createdAt AS createdAt, COALESCE(u.c, 0) AS count
       FROM tags t
       LEFT JOIN (
         SELECT lower(j.value) AS k, COUNT(*) AS c
           FROM transactions, json_each(transactions.tags) j
          GROUP BY lower(j.value)
       ) u ON u.k = lower(t.name)
      ORDER BY t.name COLLATE NOCASE`
  )
}

export function listTagNames(): string[] {
  return getDb().all<{ name: string }>('SELECT name FROM tags ORDER BY name COLLATE NOCASE').map((r) => r.name)
}

/** Creating a tag needs only a name. Returns the stored spelling (existing one if it already exists). */
export function createTag(name: string): string {
  const n = (name ?? '').trim().replace(/\s+/g, ' ')
  if (!n) throw new AppError('VALIDATION', 'Tag name cannot be empty.')
  if (n.length > MAX_TAG_LENGTH) throw new AppError('VALIDATION', `Tags can be at most ${MAX_TAG_LENGTH} characters long.`)
  const existing = getDb().get<{ name: string }>('SELECT name FROM tags WHERE name = ? COLLATE NOCASE', n)
  if (existing) return existing.name
  ensureTagsExist([n])
  return n
}

export function deleteTag(name: string, removeFromTransactions: boolean): { removedFrom: number } {
  const db = getDb()
  return db.transaction(() => {
    let removedFrom = 0
    if (removeFromTransactions) {
      removedFrom = db.run(
        `UPDATE transactions
            SET tags = (SELECT COALESCE(json_group_array(value), '[]') FROM json_each(transactions.tags) WHERE lower(value) <> lower(?)),
                updatedAt = ?
          WHERE EXISTS (SELECT 1 FROM json_each(transactions.tags) WHERE lower(value) = lower(?))`,
        name, nowISO(), name
      ).changes
    }
    const res = db.run('DELETE FROM tags WHERE name = ? COLLATE NOCASE', name)
    if (res.changes === 0) throw new AppError('NOT_FOUND', 'That tag does not exist.')
    return { removedFrom }
  })
}

// =============================================================================================
// Preferences, period, net worth
// =============================================================================================

export function savePreferences(patch: Partial<Preferences>): Preferences {
  const next = { ...getPreferences() }
  if (patch.currency !== undefined) {
    if (!CURRENCIES.some((c) => c.code === patch.currency)) throw new AppError('VALIDATION', 'Unsupported currency.')
    next.currency = patch.currency
  }
  if (patch.dateFormat !== undefined) {
    if (!['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(patch.dateFormat)) throw new AppError('VALIDATION', 'Unsupported date format.')
    next.dateFormat = patch.dateFormat
  }
  if (patch.firstDayOfWeek !== undefined) {
    if (![0, 1, 6].includes(patch.firstDayOfWeek)) throw new AppError('VALIDATION', 'First day of week must be Sunday, Monday or Saturday.')
    next.firstDayOfWeek = patch.firstDayOfWeek
  }
  if (patch.theme !== undefined) {
    if (!['light', 'dark', 'system'].includes(patch.theme)) throw new AppError('VALIDATION', 'Unsupported theme.')
    next.theme = patch.theme
  }
  if (patch.startupPage !== undefined) {
    if (!['dashboard', 'last'].includes(patch.startupPage)) throw new AppError('VALIDATION', 'Unsupported startup behaviour.')
    next.startupPage = patch.startupPage
  }
  if (patch.sidebarCollapsed !== undefined) next.sidebarCollapsed = !!patch.sidebarCollapsed
  setSetting(K.preferences, next)
  return next
}

export function savePeriod(period: PeriodId): PeriodId {
  if (!PERIODS.some((p) => p.id === period)) throw new AppError('VALIDATION', 'Unsupported period.')
  setSetting(K.selectedPeriod, period)
  return period
}

export function saveNetWorth(input: { assets: number; liabilities: number }): NetWorthState {
  for (const [label, v] of [['Total assets', input.assets], ['Total liabilities', input.liabilities]] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new AppError('VALIDATION', `${label} must be zero or a positive number.`)
  }
  getDb().transaction(() => {
    setSetting(K.assets, round2(input.assets))
    setSetting(K.liabilities, round2(input.liabilities))
    setSetting(K.netWorthConfigured, true)
  })
  return getNetWorth()
}

export function clearNetWorth(): NetWorthState {
  getDb().transaction(() => {
    setSetting(K.assets, 0)
    setSetting(K.liabilities, 0)
    setSetting(K.netWorthConfigured, false)
  })
  return getNetWorth()
}

export function currentPeriod(): PeriodId {
  return getSelectedPeriod()
}

export function lastPage(): string | null {
  return getSetting<string | null>(K.lastPage, null)
}
