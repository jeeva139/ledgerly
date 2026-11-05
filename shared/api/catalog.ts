import type {
  Account, AccountType, BootstrapState, DetectionPreferences, ImportPreferences, NetWorthState, PeriodId, Preferences, TagUsage
} from '../types'

export interface CategoryInfo {
  name: string
  count: number
  managed: boolean
  system: boolean
}

/** Start-up state, preferences, period, net worth and the import/detection preferences. */
export interface CatalogApi {
  bootstrap(): Promise<BootstrapState>
  setPreferences(patch: Partial<Preferences>): Promise<Preferences>
  setPeriod(input: { period: PeriodId }): Promise<PeriodId>
  setNetWorth(input: { assets: number; liabilities: number }): Promise<NetWorthState>
  clearNetWorth(): Promise<NetWorthState>
  getImportPreferences(): Promise<ImportPreferences>
  setImportPreferences(patch: Partial<ImportPreferences>): Promise<ImportPreferences>
  getDetectionPreferences(): Promise<DetectionPreferences>
  setDetectionPreferences(patch: Partial<DetectionPreferences>): Promise<DetectionPreferences>
  /** Remember the last visited page (for the "reopen last page" startup behaviour). */
  setLastPage(input: { page: string }): Promise<void>
  getLastPage(): Promise<string | null>
}
export const catalogMethods = {
  bootstrap: 1, setPreferences: 1, setPeriod: 1, setNetWorth: 1, clearNetWorth: 1, getImportPreferences: 1,
  setImportPreferences: 1, getDetectionPreferences: 1, setDetectionPreferences: 1, setLastPage: 1, getLastPage: 1
} satisfies Record<keyof CatalogApi, 1>

export interface CategoriesApi {
  /** Managed categories plus labels that only exist on historical transactions, with usage counts. */
  list(): Promise<CategoryInfo[]>
  /** Add a category, or a subcategory when `parent` is given. Returns the managed list. */
  add(input: { name: string; parent?: string | null }): Promise<string[]>
  /** Rename; `newName` is the leaf name. Updates transactions, rules and budgets that used it. */
  rename(input: { from: string; newName: string }): Promise<{ categories: string[]; transactions: number; rules: number; budgets: number }>
  /** Remove from the managed list. Historical transaction labels are left untouched. */
  remove(input: { name: string }): Promise<string[]>
}
export const categoriesMethods = { list: 1, add: 1, rename: 1, remove: 1 } satisfies Record<keyof CategoriesApi, 1>

export interface AccountsApi {
  list(): Promise<Account[]>
  create(input: { name: string; type?: AccountType; openingBalance?: number | null; active?: boolean }): Promise<Account>
  update(input: { id: string; name?: string; type?: AccountType; openingBalance?: number | null; active?: boolean }): Promise<Account>
  remove(input: { id: string }): Promise<Account[]>
}
export const accountsMethods = { list: 1, create: 1, update: 1, remove: 1 } satisfies Record<keyof AccountsApi, 1>

export interface TagsApi {
  list(): Promise<TagUsage[]>
  /** A tag needs only a name. Returns the stored spelling. */
  create(input: { name: string }): Promise<string>
  delete(input: { name: string; removeFromTransactions: boolean }): Promise<{ removedFrom: number }>
}
export const tagsMethods = { list: 1, create: 1, delete: 1 } satisfies Record<keyof TagsApi, 1>
