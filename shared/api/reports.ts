// Dashboard & Reports — read-only analytics. Everything here is computed from real local
// transactions with SQL aggregates; nothing is ever invented or zero-filled when there is no data.
import type { PeriodId, TxnType } from '../types'
import type { RecurringItem } from './recurring'

export interface DateRangeInfo {
  /** Inclusive lower bound (YYYY-MM-DD) or null when open-ended. */
  from: string | null
  to: string | null
}

// ---------------------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------------------

export type BucketGranularity = 'day' | 'month'

/** One time bucket: key is "YYYY-MM-DD" (day) or "YYYY-MM" (month). Transfers are excluded everywhere. */
export interface TimeBucket {
  key: string
  income: number
  expense: number
  net: number
  /** Running total of `net` up to and including this bucket (within the shown range). */
  cumulative: number
}

export interface CategoryTotal {
  name: string
  total: number
  count: number
  /** Share of total spending, 0–100. */
  pct: number
  /** True for the folded "Other" tail. */
  isOther?: boolean
}

export interface TransactionLite {
  id: string
  date: string
  merchant: string
  category: string
  amount: number
  type: TxnType
  account: string
  isTransfer: boolean
}

// ---------------------------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------------------------

export interface DashboardSummary {
  income: number
  spending: number
  net: number
  /** ((income − spending) / income) × 100, and 0 when income is 0. */
  savingsRate: number
  incomeCount: number
  spendingCount: number
  /** Transactions in the period, transfers excluded. */
  transactionCount: number
  /** Net worth comes only from the assets & liabilities the user entered — never from cash flow. */
  netWorth: { configured: boolean; assets: number; liabilities: number; value: number | null }
}

/** Facts only: each insight is directly supported by data. The renderer turns these into sentences. */
export type Insight =
  | { id: 'needs-review'; count: number }
  | { id: 'top-category'; category: string; total: number; sharePct: number }
  | {
      id: 'spending-change'
      direction: 'up' | 'down' | 'same'
      pct: number
      current: number
      previous: number
      basis: 'same-days-last-month' | 'previous-month'
    }
  | { id: 'spending-exceeds-income'; shortfall: number }
  | { id: 'no-income' }

export interface UpcomingPayment extends RecurringItem {
  /** Whole days from today to `nextDate` (negative = expected date already passed). */
  daysUntil: number
}

export interface DashboardData {
  period: PeriodId
  range: DateRangeInfo
  /** Any transaction at all (all dates). False = brand-new / freshly wiped data. */
  hasTransactions: boolean
  summary: DashboardSummary
  /** Day buckets for short ranges / short histories, otherwise month buckets. Empty when there is no data. */
  granularity: BucketGranularity
  buckets: TimeBucket[]
  /** Spending by top-level category: top 8 plus an "Other" tail. */
  categories: CategoryTotal[]
  /** Latest transactions inside the period. */
  recent: TransactionLite[]
  /** "Needs review" is a to-do list, so it spans all dates. */
  needsReview: { count: number; latest: TransactionLite[] }
  /** Only recurring items the user explicitly kept. */
  upcoming: UpcomingPayment[]
  subscriptions: { items: RecurringItem[]; monthlyTotal: number }
  insights: Insight[]
}

export interface DashboardApi {
  get(input: { period: PeriodId }): Promise<DashboardData>
}
export const dashboardMethods = { get: 1 } satisfies Record<keyof DashboardApi, 1>

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export interface SpendingByCategoryReport {
  range: DateRangeInfo
  rollUp: boolean
  rows: CategoryTotal[]
  total: number
  count: number
}

export interface MonthRow {
  /** "YYYY-MM" */
  month: string
  expense: number
  income: number
  net: number
}
export interface MonthlyReport {
  range: DateRangeInfo
  rows: MonthRow[]
  totals: { income: number; expense: number; net: number; savingsRate: number }
}

export interface CategoryTrendsReport {
  range: DateRangeInfo
  /** Continuous list of months between the first and last month that have spending. */
  months: string[]
  series: { name: string; total: number; values: number[] }[]
}

export interface MerchantRow {
  /** Normalised merchant key. */
  key: string
  name: string
  total: number
  count: number
  pct: number
}
export interface TopMerchantsReport {
  range: DateRangeInfo
  rows: MerchantRow[]
  totalSpending: number
}

export interface AccountRow {
  account: string
  /** False when transactions use this label but it is not in the managed account list. */
  managed: boolean
  /** In the selected period, transfers excluded. */
  moneyIn: number
  moneyOut: number
  net: number
  transfersIn: number
  transfersOut: number
  count: number
  openingBalance: number | null
  /** opening + all income − all expense (transfers included, all dates). Null unless an opening balance was entered. */
  balance: number | null
}
export interface AccountsReport {
  range: DateRangeInfo
  rows: AccountRow[]
}

export interface TagRow {
  tag: string
  count: number
  spending: number
  income: number
}
export interface TagsReport {
  range: DateRangeInfo
  rows: TagRow[]
}

export interface ReportsApi {
  spendingByCategory(input: { period: PeriodId; rollUp?: boolean }): Promise<SpendingByCategoryReport>
  monthly(input: { period: PeriodId }): Promise<MonthlyReport>
  categoryTrends(input: { period: PeriodId; top?: number }): Promise<CategoryTrendsReport>
  topMerchants(input: { period: PeriodId; limit?: number }): Promise<TopMerchantsReport>
  accounts(input: { period: PeriodId }): Promise<AccountsReport>
  tags(input: { period: PeriodId }): Promise<TagsReport>
  /** Save report text as a CSV file through the native "Save as" dialog. Resolves saved=false when cancelled. */
  saveCsv(input: { filename: string; content: string }): Promise<{ saved: boolean }>
}
export const reportsMethods = {
  spendingByCategory: 1,
  monthly: 1,
  categoryTrends: 1,
  topMerchants: 1,
  accounts: 1,
  tags: 1,
  saveCsv: 1
} satisfies Record<keyof ReportsApi, 1>
