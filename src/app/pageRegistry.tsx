import type { ComponentType } from 'react'
import type { PageId } from './pages'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { TransactionsPage } from '@/features/transactions/TransactionsPage'
import { CategoryFinderPage } from '@/features/category-finder/CategoryFinderPage'
import { ImportPage } from '@/features/import/ImportPage'
import { RecurringPage } from '@/features/recurring/RecurringPage'
import { SubscriptionsPage } from '@/features/subscriptions/SubscriptionsPage'
import { BudgetsPage } from '@/features/budgets/BudgetsPage'
import { GoalsPage } from '@/features/goals/GoalsPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { DocumentsPage } from '@/features/documents/DocumentsPage'
import { RulesPage } from '@/features/rules/RulesPage'
import { SettingsPage } from '@/features/settings/SettingsPage'

export const PAGE_COMPONENTS: Record<PageId, ComponentType> = {
  dashboard: DashboardPage,
  transactions: TransactionsPage,
  'category-finder': CategoryFinderPage,
  import: ImportPage,
  recurring: RecurringPage,
  subscriptions: SubscriptionsPage,
  budgets: BudgetsPage,
  goals: GoalsPage,
  reports: ReportsPage,
  documents: DocumentsPage,
  rules: RulesPage,
  settings: SettingsPage
}
