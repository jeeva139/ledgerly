// The complete renderer ↔ main API. `window.ledgerly` exposes exactly these namespaces/methods.
// Each feature area owns one contract file; this file only composes them.
import { appMethods, type AppApi } from './app'
import { lockMethods, type LockApi } from './lock'
import { catalogMethods, categoriesMethods, accountsMethods, tagsMethods, type CatalogApi, type CategoriesApi, type AccountsApi, type TagsApi } from './catalog'
import { transactionsMethods, type TransactionsApi } from './transactions'
import { categoryFinderMethods, type CategoryFinderApi } from './categoryFinder'
import { rulesMethods, type RulesApi } from './rules'
import { importMethods, type ImportApi } from './imports'
import { recurringMethods, subscriptionsMethods, type RecurringApi, type SubscriptionsApi } from './recurring'
import { budgetsMethods, goalsMethods, type BudgetsApi, type GoalsApi } from './planning'
import { documentsMethods, type DocumentsApi } from './documents'
import { dashboardMethods, reportsMethods, type DashboardApi, type ReportsApi } from './reports'
import { backupMethods, dataMethods, type BackupApi, type DataApi } from './backup'

export interface LedgerlyApi {
  app: AppApi
  lock: LockApi
  catalog: CatalogApi
  categories: CategoriesApi
  accounts: AccountsApi
  tags: TagsApi
  transactions: TransactionsApi
  categoryFinder: CategoryFinderApi
  rules: RulesApi
  import: ImportApi
  recurring: RecurringApi
  subscriptions: SubscriptionsApi
  budgets: BudgetsApi
  goals: GoalsApi
  documents: DocumentsApi
  dashboard: DashboardApi
  reports: ReportsApi
  backup: BackupApi
  data: DataApi
}

/** Namespace → method names. Drives the preload bridge and the "every method has a handler" check. */
export const API_METHODS: { [N in keyof LedgerlyApi]: readonly string[] } = {
  app: Object.keys(appMethods),
  lock: Object.keys(lockMethods),
  catalog: Object.keys(catalogMethods),
  categories: Object.keys(categoriesMethods),
  accounts: Object.keys(accountsMethods),
  tags: Object.keys(tagsMethods),
  transactions: Object.keys(transactionsMethods),
  categoryFinder: Object.keys(categoryFinderMethods),
  rules: Object.keys(rulesMethods),
  import: Object.keys(importMethods),
  recurring: Object.keys(recurringMethods),
  subscriptions: Object.keys(subscriptionsMethods),
  budgets: Object.keys(budgetsMethods),
  goals: Object.keys(goalsMethods),
  documents: Object.keys(documentsMethods),
  dashboard: Object.keys(dashboardMethods),
  reports: Object.keys(reportsMethods),
  backup: Object.keys(backupMethods),
  data: Object.keys(dataMethods)
}

/** Methods that may run while the application lock is active. */
export const LOCK_EXEMPT = ['lock.status', 'lock.unlock', 'app.info'] as const

/** What the preload bridge hands the renderer: every call resolves to a result envelope. */
export type RawApi = {
  [N in keyof LedgerlyApi]: {
    [M in keyof LedgerlyApi[N]]: LedgerlyApi[N][M] extends (...args: infer A) => Promise<infer R>
      ? (...args: A) => Promise<import('../errors').IpcResult<R>>
      : never
  }
}

export * from './events'
export type { AppInfo } from './app'
export type { LockStatus } from './lock'
export type { CategoryInfo } from './catalog'
