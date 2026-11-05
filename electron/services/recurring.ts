// Recurring payment & subscription detection.
//
// Everything is computed locally from the user's own transactions. Detection only *suggests*: an item is
// "kept" or "ignored" strictly because the user chose it (decisions live in the settings table).
//
// Rules (spec §44–48):
//  * expense, non-transfer transactions are grouped by a normalised merchant key (shared/merchant.ts)
//  * at least two unique payment dates; cadence from the median interval
//      weekly 5–9 d · biweekly 12–17 d · monthly 24–40 d · quarterly 75–110 d · annual 330–400 d
//    and at least 60 % of the intervals must fall inside that band
//  * amount variation = (max − min) / median amount
//  * hinted merchants (well-known subscription / bill names, or the user's own Subscriptions / Housing /
//    Utilities / Insurance categories): subscription ≤ 20 %, bill ≤ 35 %, anything else ≤ 35 % ("other")
//  * un-hinted merchants (routine shopping must not look recurring): ≥ 3 occurrences, monthly / quarterly /
//    annual cadence and ≤ 3 % variation
//  * high confidence = ≥ 3 occurrences, variation ≤ 12 %, interval jitter ≤ 5 days
import { getDb } from '../database/db'
import type { Db } from '../database/sqlite'
import { AppError } from '../../shared/errors'
import { addDays, addMonths, daysBetween } from '../../shared/dates'
import { round2 } from '../../shared/money'
import { normalizeMerchantKey, prettyMerchant } from '../../shared/merchant'
import { NEEDS_REVIEW, topLevelCategory } from '../../shared/types'
import type {
  Cadence, DetectionStatus, RecurringItem, RecurringKind, RecurringListInput, RecurringStatus, SubscriptionsSummary
} from '../../shared/api/recurring'
import { K, getDetectionPreferences, getSetting, updateSetting } from './settings'

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

interface Band {
  cadence: Cadence
  min: number
  max: number
  perYear: number
}
export const CADENCE_BANDS: Band[] = [
  { cadence: 'weekly', min: 5, max: 9, perYear: 52 },
  { cadence: 'biweekly', min: 12, max: 17, perYear: 26 },
  { cadence: 'monthly', min: 24, max: 40, perYear: 12 },
  { cadence: 'quarterly', min: 75, max: 110, perYear: 4 },
  { cadence: 'annual', min: 330, max: 400, perYear: 1 }
]
const bandFor = (cadence: Cadence): Band => CADENCE_BANDS.find((b) => b.cadence === cadence)!

const IN_BAND_SHARE = 0.6
const SUBSCRIPTION_MAX_VARIATION = 20
const OTHER_MAX_VARIATION = 35
const UNHINTED_MAX_VARIATION = 3
const HIGH_CONFIDENCE_MAX_VARIATION = 12
const HIGH_CONFIDENCE_MAX_JITTER = 5

/** Detection hints only — never seeded as rules or data. Matched against the normalised merchant key. */
const SUBSCRIPTION_HINT = new RegExp(
  '\\b(?:netflix\\w*|spotify\\w*|disney\\w*|youtube\\w*|icloud\\w*|dropbox\\w*|adobe\\w*|microsoft\\w*|amazon\\s*prime|prime\\s*video|patreon\\w*|gyms?|membership\\w*|openai\\w*|chatgpt\\w*|canva\\w*|notion|zoom|slack|github\\w*)\\b'
)
const BILL_HINT = new RegExp(
  '\\b(?:mortgage\\w*|rents?|loans?|insurance\\w*|utility|utilities|electric\\w*|water|internet|phone|mobile|daycare|tuition|lease|car\\s*payment|auto\\s*payment|hoa|property\\s*tax)\\b'
)
const SUBSCRIPTION_CATEGORIES = new Set(['subscriptions'])
const BILL_CATEGORIES = new Set(['housing', 'utilities', 'insurance'])

// ---------------------------------------------------------------------------------------------
// Pure detection over grouped payments (exported for tests)
// ---------------------------------------------------------------------------------------------

export interface PaymentRow {
  merchant: string
  date: string
  amount: number
  category: string
  account: string
}

export type DetectedItem = Omit<RecurringItem, 'status'>

interface Group {
  key: string
  /** Payment date → total paid that day. */
  byDate: Map<string, number>
  categories: Map<string, number>
  accounts: Map<string, number>
  transactions: number
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
}

function topKey(counts: Map<string, number>, skip?: string): string {
  let best = ''
  let bestCount = -1
  for (const [k, c] of counts) {
    if (skip !== undefined && k === skip && counts.size > 1) continue
    if (c > bestCount) {
      best = k
      bestCount = c
    }
  }
  return best
}

function classifyCadence(medianInterval: number): Band | null {
  const rounded = Math.round(medianInterval)
  return CADENCE_BANDS.find((b) => rounded >= b.min && rounded <= b.max) ?? null
}

function nextExpected(last: string, band: Band, intervalDays: number): string {
  if (band.cadence === 'monthly') return addMonths(last, 1)
  if (band.cadence === 'quarterly') return addMonths(last, 3)
  if (band.cadence === 'annual') return addMonths(last, 12)
  return addDays(last, intervalDays)
}

function evaluateGroup(g: Group): DetectedItem | null {
  if (g.byDate.size < 2) return null
  const dates = [...g.byDate.keys()].sort()
  const intervals: number[] = []
  for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i - 1], dates[i]))
  const sortedIntervals = [...intervals].sort((a, b) => a - b)
  const medianInterval = median(sortedIntervals)
  const band = classifyCadence(medianInterval)
  if (!band) return null
  const inBand = intervals.filter((d) => d >= band.min && d <= band.max).length
  if (inBand / intervals.length < IN_BAND_SHARE) return null

  const amounts = dates.map((d) => round2(g.byDate.get(d)!))
  const sortedAmounts = [...amounts].sort((a, b) => a - b)
  const medAmount = median(sortedAmounts)
  if (!(medAmount > 0)) return null
  const variation = ((sortedAmounts[sortedAmounts.length - 1] - sortedAmounts[0]) / medAmount) * 100
  const occurrences = dates.length
  const intervalDays = Math.round(medianInterval)
  const jitter = intervals.reduce((m, d) => Math.max(m, Math.abs(d - medianInterval)), 0)

  // The user's own categories can act as a hint when most payments carry it.
  const topCategoryShare = (set: Set<string>): boolean => {
    let hits = 0
    for (const [cat, n] of g.categories) if (set.has(topLevelCategory(cat).trim().toLowerCase())) hits += n
    return g.transactions > 0 && hits / g.transactions >= 0.5
  }
  const subscriptionHint = SUBSCRIPTION_HINT.test(g.key) || topCategoryShare(SUBSCRIPTION_CATEGORIES)
  const billHint = BILL_HINT.test(g.key) || topCategoryShare(BILL_CATEGORIES)

  let kind: RecurringKind | null = null
  if (subscriptionHint || billHint) {
    if (subscriptionHint && variation <= SUBSCRIPTION_MAX_VARIATION) kind = 'subscription'
    else if (billHint && variation <= OTHER_MAX_VARIATION) kind = 'bill'
    else if (variation <= OTHER_MAX_VARIATION) kind = 'other'
  } else if (
    occurrences >= 3 &&
    (band.cadence === 'monthly' || band.cadence === 'quarterly' || band.cadence === 'annual') &&
    variation <= UNHINTED_MAX_VARIATION
  ) {
    kind = 'other'
  }
  if (!kind) return null

  const average = round2(amounts.reduce((s, a) => s + a, 0) / amounts.length)
  const lastDate = dates[dates.length - 1]
  const confidence: 'high' | 'medium' =
    occurrences >= 3 && variation <= HIGH_CONFIDENCE_MAX_VARIATION && jitter <= HIGH_CONFIDENCE_MAX_JITTER ? 'high' : 'medium'

  return {
    key: g.key,
    merchant: prettyMerchant(g.key),
    kind,
    cadence: band.cadence,
    confidence,
    occurrences,
    averageAmount: average,
    lastAmount: amounts[amounts.length - 1],
    amountVariationPct: round2(variation),
    firstDate: dates[0],
    lastDate,
    nextDate: nextExpected(lastDate, band, intervalDays),
    intervalDays,
    category: topKey(g.categories, NEEDS_REVIEW),
    account: topKey(g.accounts),
    monthlyCost: round2((average * band.perYear) / 12),
    annualCost: round2(average * band.perYear)
  }
}

/** Detect recurring payments in a list of expense rows (pure; no database, no decisions). */
export function detectRecurring(rows: Iterable<PaymentRow>): DetectedItem[] {
  const keyCache = new Map<string, string>()
  const groups = new Map<string, Group>()
  for (const r of rows) {
    let key = keyCache.get(r.merchant)
    if (key === undefined) {
      key = normalizeMerchantKey(r.merchant)
      keyCache.set(r.merchant, key)
    }
    if (!key) continue
    let g = groups.get(key)
    if (!g) {
      g = { key, byDate: new Map(), categories: new Map(), accounts: new Map(), transactions: 0 }
      groups.set(key, g)
    }
    g.byDate.set(r.date, (g.byDate.get(r.date) ?? 0) + r.amount)
    g.categories.set(r.category, (g.categories.get(r.category) ?? 0) + 1)
    g.accounts.set(r.account, (g.accounts.get(r.account) ?? 0) + 1)
    g.transactions++
  }
  const items: DetectedItem[] = []
  for (const g of groups.values()) {
    const item = evaluateGroup(g)
    if (item) items.push(item)
  }
  return items.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.merchant.localeCompare(b.merchant))
}

// ---------------------------------------------------------------------------------------------
// Database-backed detection with a cheap cache
// ---------------------------------------------------------------------------------------------

interface Cache {
  db: Db
  signature: string
  /** SQLite's connection-wide write counter when the cache was last validated. */
  changes: number
  items: DetectedItem[]
}
let cache: Cache | null = null

/** Cheap fingerprint of the data detection depends on (any edit changes count, sum or a timestamp). */
function dataSignature(db: Db): string {
  const r = db.get<{ c: number; u: string | null; cr: string | null; s: number | null }>(
    `SELECT COUNT(*) AS c, MAX(updatedAt) AS u, MAX(createdAt) AS cr, SUM(amount) AS s
       FROM transactions WHERE type = 'expense' AND isTransfer = 0`
  )!
  return `${r.c}|${r.u}|${r.cr}|${r.s}`
}

/** All detected items (no decisions applied), recomputed only when the underlying transactions changed. */
export function detectAll(): DetectedItem[] {
  const db = getDb()
  // Fast path: no row was written by this connection since the last check → nothing can have changed (O(1)).
  const changes = db.scalar<number>('SELECT total_changes()') ?? 0
  if (cache && cache.db === db && cache.changes === changes) return cache.items
  // Something was written (maybe only an unrelated setting): compare the cheap data signature before recomputing.
  const signature = dataSignature(db)
  if (cache && cache.db === db && cache.signature === signature) {
    cache.changes = changes
    return cache.items
  }
  // `.all()` is several times faster than streaming rows one by one with node:sqlite's iterator.
  const rows = db.all<PaymentRow>(
    `SELECT merchant, date, amount, category, account FROM transactions WHERE type = 'expense' AND isTransfer = 0`
  )
  const items = detectRecurring(rows)
  cache = { db, signature, changes, items }
  return items
}

export function clearRecurringCache(): void {
  cache = null
}

// ---------------------------------------------------------------------------------------------
// Decisions (Keep / Ignore) — stored in the settings table, never automatic
// ---------------------------------------------------------------------------------------------

export interface RecurringDecision {
  status: 'keep' | 'ignore'
  decidedAt: string
  merchant: string
}
type Decisions = Record<string, RecurringDecision>

const getDecisions = (): Decisions => getSetting<Decisions>(K.recurringDecisions, {})

function statusOf(key: string, decisions: Decisions): RecurringStatus {
  const d = decisions[key]
  return d?.status === 'keep' ? 'kept' : d?.status === 'ignore' ? 'ignored' : 'suggested'
}

function withStatus(items: DetectedItem[]): RecurringItem[] {
  const decisions = getDecisions()
  return items.map((i) => ({ ...i, status: statusOf(i.key, decisions) }))
}

export function detectionStatus(): DetectionStatus {
  const p = getDetectionPreferences()
  return { recurringEnabled: p.recurring, subscriptionsEnabled: p.subscriptions }
}

/** Recurring payments (all kinds) with the user's decisions applied. Empty when recurring detection is off. */
export function listRecurring(input: RecurringListInput = {}): RecurringItem[] {
  if (!getDetectionPreferences().recurring) return []
  let items = withStatus(detectAll())
  if (input.status && input.status !== 'all') items = items.filter((i) => i.status === input.status)
  if (input.kind && input.kind !== 'all') items = items.filter((i) => i.kind === input.kind)
  return items
}

export function decide(key: string, decision: 'keep' | 'ignore' | null): void {
  const item = detectAll().find((i) => i.key === key)
  if (decision !== null && !item) {
    throw new AppError('NOT_FOUND', 'That recurring payment is no longer detected, so it can’t be changed.')
  }
  updateSetting<Decisions>(K.recurringDecisions, {}, (current) => {
    const next = { ...current }
    if (decision === null) delete next[key]
    else next[key] = { status: decision, decidedAt: new Date().toISOString(), merchant: item!.merchant }
    return next
  })
}

export const keepRecurring = (key: string) => decide(key, 'keep')
export const ignoreRecurring = (key: string) => decide(key, 'ignore')
export const restoreRecurring = (key: string) => decide(key, null)

/** Subscriptions = detected items of kind "subscription" (when subscription detection is on). */
export function listSubscriptions(status: RecurringStatus | 'all' = 'all'): {
  items: RecurringItem[]
  summary: SubscriptionsSummary
  enabled: boolean
} {
  const enabled = getDetectionPreferences().subscriptions
  const empty: SubscriptionsSummary = { keptCount: 0, suggestedCount: 0, keptMonthlyCost: 0, keptAnnualCost: 0 }
  if (!enabled) return { items: [], summary: empty, enabled }
  const all = withStatus(detectAll()).filter((i) => i.kind === 'subscription')
  const kept = all.filter((i) => i.status === 'kept')
  const summary: SubscriptionsSummary = {
    keptCount: kept.length,
    suggestedCount: all.filter((i) => i.status === 'suggested').length,
    // Only kept items count towards the totals — suggestions never inflate them.
    keptMonthlyCost: round2(kept.reduce((s, i) => s + i.monthlyCost, 0)),
    keptAnnualCost: round2(kept.reduce((s, i) => s + i.annualCost, 0))
  }
  return { items: status === 'all' ? all : all.filter((i) => i.status === status), summary, enabled }
}

/**
 * Items the user explicitly chose to Keep, soonest expected payment first.
 * Subscriptions need subscription detection, every other kind needs recurring detection.
 */
export function getKeptRecurringItems(): RecurringItem[] {
  const prefs = getDetectionPreferences()
  if (!prefs.recurring && !prefs.subscriptions) return []
  return withStatus(detectAll())
    .filter((i) => i.status === 'kept')
    .filter((i) => (i.kind === 'subscription' ? prefs.subscriptions : prefs.recurring))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.merchant.localeCompare(b.merchant))
}
