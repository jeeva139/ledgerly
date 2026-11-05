// Recurring & Subscriptions — shared types plus API contract.

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
export type RecurringKind = 'subscription' | 'bill' | 'other'
export type RecurringStatus = 'suggested' | 'kept' | 'ignored'

/** One detected recurring payment. Detection never confirms anything by itself: the user chooses Keep or Ignore. */
export interface RecurringItem {
  /** Stable identity = normalised merchant key. Decisions (keep / ignore) are stored against it. */
  key: string
  /** Readable name (cleaned merchant text). */
  merchant: string
  kind: RecurringKind
  cadence: Cadence
  confidence: 'high' | 'medium'
  occurrences: number
  averageAmount: number
  lastAmount: number
  /** (max − min) / median amount, in percent. */
  amountVariationPct: number
  firstDate: string
  lastDate: string
  /** Expected next payment (last date + typical interval). */
  nextDate: string
  /** Median days between payments. */
  intervalDays: number
  /** Most common category among the payments. */
  category: string
  account: string
  status: RecurringStatus
  monthlyCost: number
  annualCost: number
}

export interface RecurringListInput {
  status?: RecurringStatus | 'all'
  kind?: RecurringKind | 'all'
}

/** Whether the detection features are switched on (Settings → Detection). */
export interface DetectionStatus {
  recurringEnabled: boolean
  subscriptionsEnabled: boolean
}

/**
 * Recurring payment detection (always computed from real transactions, never confirmed automatically).
 * `restore` moves an ignored (or kept) item back to "suggested". Settings uses `list({status:'ignored'})` + `restore`.
 */
export interface RecurringApi {
  list(input?: RecurringListInput): Promise<RecurringItem[]>
  keep(input: { key: string }): Promise<void>
  ignore(input: { key: string }): Promise<void>
  restore(input: { key: string }): Promise<void>
  /** Are recurring / subscription detection switched on? */
  status(): Promise<DetectionStatus>
}
export const recurringMethods = { list: 1, keep: 1, ignore: 1, restore: 1, status: 1 } satisfies Record<keyof RecurringApi, 1>

export interface SubscriptionsSummary {
  keptCount: number
  suggestedCount: number
  /** Only items the user kept are counted — suggestions never inflate the totals. */
  keptMonthlyCost: number
  keptAnnualCost: number
}

export interface SubscriptionsApi {
  list(input?: { status?: RecurringStatus | 'all' }): Promise<{ items: RecurringItem[]; summary: SubscriptionsSummary; enabled: boolean }>
}
export const subscriptionsMethods = { list: 1 } satisfies Record<keyof SubscriptionsApi, 1>
