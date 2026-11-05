import type { LucideIcon } from 'lucide-react'
import {
  BarChart3, CalendarClock, FileText, Gauge, Import, ListFilter, PiggyBank, Repeat, ScrollText, Settings, Target, Wallet
} from 'lucide-react'

export type PageId =
  | 'dashboard'
  | 'transactions'
  | 'category-finder'
  | 'import'
  | 'recurring'
  | 'subscriptions'
  | 'budgets'
  | 'goals'
  | 'reports'
  | 'documents'
  | 'rules'
  | 'settings'

export interface PageDef {
  id: PageId
  label: string
  icon: LucideIcon
  /** Shown in the sidebar as an emphasised entry. */
  featured?: boolean
  /** Whether the global period selector applies to this page. */
  usesPeriod?: boolean
  /** Separator is drawn *before* this item. */
  groupStart?: boolean
}

export const PAGES: PageDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge, usesPeriod: true },
  { id: 'transactions', label: 'Transactions', icon: Wallet, usesPeriod: true },
  { id: 'category-finder', label: 'Category Finder', icon: ListFilter, featured: true },
  { id: 'import', label: 'Import', icon: Import, groupStart: true },
  { id: 'recurring', label: 'Recurring', icon: Repeat, groupStart: true },
  { id: 'subscriptions', label: 'Subscriptions', icon: CalendarClock },
  { id: 'budgets', label: 'Budgets', icon: PiggyBank },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'reports', label: 'Reports', icon: BarChart3, usesPeriod: true },
  { id: 'documents', label: 'Documents', icon: FileText, groupStart: true },
  { id: 'rules', label: 'Rules', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings, groupStart: true }
]

export const isPageId = (v: string | null | undefined): v is PageId => !!v && PAGES.some((p) => p.id === v)
