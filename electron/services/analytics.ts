// Shared building blocks for the Dashboard and Reports services.
// Business rules (spec §42–43, §88):
//   spending = expense AND isTransfer = 0      income = income AND isTransfer = 0
//   transfers never count towards income, spending or savings.
// Everything is a parameterised SQL aggregate over the indexed `date` column — raw rows never leave main.
import { getDb } from '../database/db'
import { addDays, addMonths, daysBetween, endOfMonth, periodRange, startOfMonth, toISODate, type DateRange } from '../../shared/dates'
import { round2 } from '../../shared/money'
import { NEEDS_REVIEW, topLevelCategory, type PeriodId, type TxnType } from '../../shared/types'
import type { BucketGranularity, CategoryTotal, Insight, TimeBucket } from '../../shared/api/reports'

export function rangeFor(period: PeriodId, now: Date = new Date()): DateRange {
  return periodRange(period, now)
}

/** " AND date >= ? AND date <= ?" for whichever bounds exist. */
export function rangeClause(range: DateRange, column = 'date'): { sql: string; params: string[] } {
  const parts: string[] = []
  const params: string[] = []
  if (range.from) {
    parts.push(`${column} >= ?`)
    params.push(range.from)
  }
  if (range.to) {
    parts.push(`${column} <= ?`)
    params.push(range.to)
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params }
}

export interface PeriodTotals {
  income: number
  spending: number
  incomeCount: number
  spendingCount: number
}

/**
 * One grouped row of real (non-transfer) activity: everything the dashboard and reports need is derived
 * from these cells in JavaScript, so a screen costs ONE pass over the table instead of one per widget.
 * (A 100,000-row table groups into roughly 10–15 thousand cells in ~0.3 s; a date-limited range seeks the
 * date index and is much cheaper.)
 */
export interface Cell {
  date: string
  type: TxnType
  category: string
  amount: number
  count: number
}

export function loadCells(range: DateRange): Cell[] {
  const rc = rangeClause(range)
  // Open-ended range: a sequential scan beats 100k random index look-ups on a wide table.
  const hint = !range.from && !range.to ? ' NOT INDEXED' : ''
  return getDb().all<Cell>(
    `SELECT date, type, category, SUM(amount) AS amount, COUNT(*) AS count
       FROM transactions${hint} WHERE isTransfer = 0${rc.sql}
      GROUP BY date, type, category`,
    ...rc.params
  )
}

export function totalsFromCells(cells: Cell[]): PeriodTotals {
  let income = 0
  let spending = 0
  let incomeCount = 0
  let spendingCount = 0
  for (const c of cells) {
    if (c.type === 'income') {
      income += c.amount
      incomeCount += c.count
    } else {
      spending += c.amount
      spendingCount += c.count
    }
  }
  return { income: round2(income), spending: round2(spending), incomeCount, spendingCount }
}

export function computeTotals(range: DateRange, cells: Cell[] = loadCells(range)): PeriodTotals {
  return totalsFromCells(cells)
}

// ---------------------------------------------------------------------------------------------
// Time buckets
// ---------------------------------------------------------------------------------------------

/**
 * Daily buckets when the selected range is at most 62 days, or when the history inside it spans fewer
 * than 62 days; otherwise monthly buckets.
 */
export function chooseGranularity(range: DateRange, dataMin: string, dataMax: string): BucketGranularity {
  const spanDays = daysBetween(dataMin, dataMax) + 1
  const rangeDays = range.from && range.to ? daysBetween(range.from, range.to) + 1 : Number.POSITIVE_INFINITY
  return rangeDays <= 62 || spanDays < 62 ? 'day' : 'month'
}

export interface RawBucket {
  key: string
  income: number
  expense: number
}

const nextKey = (key: string, g: BucketGranularity): string => (g === 'day' ? addDays(key, 1) : addMonths(`${key}-01`, 1).slice(0, 7))

/**
 * Turn sparse aggregate rows into a continuous series between the first and last bucket that has data.
 * Gaps become true zeros (there really were no transactions then); nothing outside the data's own span is added.
 */
export function fillBuckets(rows: RawBucket[], granularity: BucketGranularity): TimeBucket[] {
  if (rows.length === 0) return []
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const sorted = [...byKey.keys()].sort()
  const out: TimeBucket[] = []
  let cumulative = 0
  for (let key = sorted[0]; key <= sorted[sorted.length - 1]; key = nextKey(key, granularity)) {
    const r = byKey.get(key)
    const income = round2(r?.income ?? 0)
    const expense = round2(r?.expense ?? 0)
    const net = round2(income - expense)
    cumulative = round2(cumulative + net)
    out.push({ key, income, expense, net, cumulative })
  }
  return out
}

/** Income / expense per day or month, continuous between the first and last bucket that has data. */
export function bucketsFromCells(range: DateRange, cells: Cell[]): { granularity: BucketGranularity; buckets: TimeBucket[] } {
  if (cells.length === 0) return { granularity: 'month', buckets: [] }
  let lo = cells[0].date
  let hi = cells[0].date
  for (const c of cells) {
    if (c.date < lo) lo = c.date
    if (c.date > hi) hi = c.date
  }
  const granularity = chooseGranularity(range, lo, hi)
  const byKey = new Map<string, RawBucket>()
  for (const c of cells) {
    const key = granularity === 'day' ? c.date : c.date.slice(0, 7)
    let b = byKey.get(key)
    if (!b) byKey.set(key, (b = { key, income: 0, expense: 0 }))
    if (c.type === 'income') b.income += c.amount
    else b.expense += c.amount
  }
  return { granularity, buckets: fillBuckets([...byKey.values()], granularity) }
}

export function getBuckets(range: DateRange, cells: Cell[] = loadCells(range)): { granularity: BucketGranularity; buckets: TimeBucket[] } {
  return bucketsFromCells(range, cells)
}

// ---------------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------------

const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

/** Spending per category (optionally rolled up to the top level), largest first. */
export function categoryTotals(
  range: DateRange,
  rollUp: boolean,
  cells: Cell[] = loadCells(range)
): { rows: CategoryTotal[]; total: number; count: number } {
  const groups = new Map<string, { total: number; count: number }>()
  for (const c of cells) {
    if (c.type !== 'expense') continue
    const name = rollUp ? topLevelCategory(c.category) : c.category
    const g = groups.get(name)
    if (g) {
      g.total += c.amount
      g.count += c.count
    } else groups.set(name, { total: c.amount, count: c.count })
  }
  const raw = [...groups.entries()].sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const total = round2(raw.reduce((sum, [, g]) => sum + g.total, 0))
  const count = raw.reduce((sum, [, g]) => sum + g.count, 0)
  return {
    rows: raw.map(([name, g]) => ({ name, total: round2(g.total), count: g.count, pct: pct1(g.total, total) })),
    total,
    count
  }
}

/** Keep the largest `n` categories and fold the rest into one "Other" row (never more than n + 1 rows). */
export function foldTopN(rows: CategoryTotal[], n: number): CategoryTotal[] {
  if (rows.length <= n + 1) return rows
  const head = rows.slice(0, n)
  const tail = rows.slice(n)
  const total = round2(tail.reduce((s, r) => s + r.total, 0))
  const count = tail.reduce((s, r) => s + r.count, 0)
  const pct = Math.round(tail.reduce((s, r) => s + r.pct, 0) * 10) / 10
  return [...head, { name: 'Other', total, count, pct, isOther: true }]
}

// ---------------------------------------------------------------------------------------------
// Insights — only statements that the data directly supports
// ---------------------------------------------------------------------------------------------

export interface SpendingComparison {
  current: number
  previous: number
  basis: 'same-days-last-month' | 'previous-month'
}

/**
 * Like-for-like comparison, available only for monthly periods:
 *  - this-month: month-to-date vs the same number of days of last month
 *  - last-month: the whole month vs the month before it
 * Returns null for every other period (no comparison is invented).
 */
export function spendingComparison(period: PeriodId, now: Date = new Date()): SpendingComparison | null {
  const today = toISODate(now)
  if (period === 'this-month') {
    const thisStart = startOfMonth(today)
    const lastStart = startOfMonth(addMonths(thisStart, -1))
    const lastEnd = endOfMonth(lastStart)
    const dayOfMonth = Number(today.slice(8, 10))
    const prevTo = addDays(lastStart, dayOfMonth - 1)
    const previous = computeTotals({ from: lastStart, to: prevTo > lastEnd ? lastEnd : prevTo }).spending
    const current = computeTotals({ from: thisStart, to: today }).spending
    return { current, previous, basis: 'same-days-last-month' }
  }
  if (period === 'last-month') {
    const cur = rangeFor('last-month', now)
    const prevStart = startOfMonth(addMonths(cur.from!, -1))
    const previous = computeTotals({ from: prevStart, to: endOfMonth(prevStart) }).spending
    const current = computeTotals(cur).spending
    return { current, previous, basis: 'previous-month' }
  }
  return null
}

export interface InsightInput {
  income: number
  spending: number
  transactionCount: number
  /** Spending by top-level category, largest first (unfolded). */
  rolledCategories: CategoryTotal[]
  needsReviewCount: number
  comparison: SpendingComparison | null
}

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = []

  if (i.needsReviewCount > 0) out.push({ id: 'needs-review', count: i.needsReviewCount })

  const top = i.rolledCategories.find((c) => c.name !== NEEDS_REVIEW && c.total > 0)
  if (top && i.spending > 0) out.push({ id: 'top-category', category: top.name, total: top.total, sharePct: pct1(top.total, i.spending) })

  const c = i.comparison
  if (c && c.previous > 0 && c.current > 0) {
    const pct = Math.round(((c.current - c.previous) / c.previous) * 100)
    out.push({
      id: 'spending-change',
      direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'same',
      pct: Math.abs(pct),
      current: c.current,
      previous: c.previous,
      basis: c.basis
    })
  }

  if (i.income > 0 && i.spending > i.income) out.push({ id: 'spending-exceeds-income', shortfall: round2(i.spending - i.income) })
  if (i.income === 0 && i.spending > 0) out.push({ id: 'no-income' })

  return out
}

export { topLevelCategory }
