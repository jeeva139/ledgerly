import { getDb } from '../database/db'
import { daysBetween, toISODate } from '../../shared/dates'
import { round2, savingsRate } from '../../shared/money'
import { NEEDS_REVIEW, type PeriodId, type TxnType } from '../../shared/types'
import type { DashboardData, DashboardSummary, TransactionLite, UpcomingPayment } from '../../shared/api/reports'
import { K, getNetWorth, getSetting } from './settings'
import { getKeptRecurringItems } from './recurring'
import {
  buildInsights, bucketsFromCells, categoryTotals, loadCells, totalsFromCells, foldTopN, rangeClause, rangeFor, spendingComparison,
  type Cell
} from './analytics'

interface LiteRow {
  id: string
  date: string
  merchant: string
  category: string
  amount: number
  type: TxnType
  account: string
  isTransfer: number
}

const toLite = (r: LiteRow): TransactionLite => ({
  id: r.id,
  date: r.date,
  merchant: r.merchant,
  category: r.category,
  amount: r.amount,
  type: r.type,
  account: r.account,
  isTransfer: r.isTransfer === 1
})

const LITE_COLUMNS = 'id, date, merchant, category, amount, type, account, isTransfer'

export function getDashboardSummary(period: PeriodId, now: Date = new Date(), cells?: Cell[]): DashboardSummary {
  const totals = totalsFromCells(cells ?? loadCells(rangeFor(period, now)))
  const nw = getNetWorth()
  return {
    income: totals.income,
    spending: totals.spending,
    net: round2(totals.income - totals.spending),
    savingsRate: savingsRate(totals.income, totals.spending),
    incomeCount: totals.incomeCount,
    spendingCount: totals.spendingCount,
    transactionCount: totals.incomeCount + totals.spendingCount,
    netWorth: {
      configured: nw.configured,
      assets: nw.assets,
      liabilities: nw.liabilities,
      // Net worth = assets − liabilities, entered by the user. Never derived from transactions.
      value: nw.configured ? round2(nw.assets - nw.liabilities) : null
    }
  }
}

/** Everything the dashboard shows, in one round trip. Every figure derives from real transactions. */
export function getDashboard(period: PeriodId, now: Date = new Date()): DashboardData {
  const db = getDb()
  const range = rangeFor(period, now)
  const rc = rangeClause(range)
  const today = toISODate(now)

  const hasTransactions = !!db.get('SELECT 1 AS x FROM transactions LIMIT 1')
  // One grouped pass over the period feeds the totals, the charts and the category breakdown.
  const cells = loadCells(range)
  const summary = getDashboardSummary(period, now, cells)
  const { granularity, buckets } = bucketsFromCells(range, cells)

  const cats = categoryTotals(range, true, cells)
  const recent = db
    .all<LiteRow>(`SELECT ${LITE_COLUMNS} FROM transactions WHERE 1 = 1${rc.sql} ORDER BY date DESC, createdAt DESC LIMIT 8`, ...rc.params)
    .map(toLite)

  const needsReviewCount = db.scalar<number>('SELECT COUNT(*) FROM transactions WHERE category = ?', NEEDS_REVIEW) ?? 0
  const needsReviewLatest = needsReviewCount
    ? db
        .all<LiteRow>(`SELECT ${LITE_COLUMNS} FROM transactions WHERE category = ? ORDER BY date DESC, createdAt DESC LIMIT 5`, NEEDS_REVIEW)
        .map(toLite)
    : []

  // Nothing can be "kept" until the user has made at least one Keep/Ignore decision, so skip the
  // (potentially expensive) detection pass entirely on fresh data.
  const hasDecisions = Object.keys(getSetting<Record<string, unknown>>(K.recurringDecisions, {})).length > 0
  const kept = hasDecisions ? getKeptRecurringItems() : []
  const upcoming: UpcomingPayment[] = kept
    .map((item) => ({ ...item, daysUntil: daysBetween(today, item.nextDate) }))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.merchant.localeCompare(b.merchant))
    .slice(0, 6)
  const subscriptionItems = kept.filter((i) => i.kind === 'subscription').sort((a, b) => b.monthlyCost - a.monthlyCost)

  return {
    period,
    range,
    hasTransactions,
    summary,
    granularity,
    buckets,
    categories: foldTopN(cats.rows, 8),
    recent,
    needsReview: { count: needsReviewCount, latest: needsReviewLatest },
    upcoming,
    subscriptions: {
      items: subscriptionItems,
      monthlyTotal: round2(subscriptionItems.reduce((s, i) => s + i.monthlyCost, 0))
    },
    insights: buildInsights({
      income: summary.income,
      spending: summary.spending,
      transactionCount: summary.transactionCount,
      rolledCategories: cats.rows,
      needsReviewCount,
      comparison: spendingComparison(period, now)
    })
  }
}
