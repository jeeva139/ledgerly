import { beforeEach, describe, expect, it, vi } from 'vitest'
import { freshDb } from './helpers'
import { insertTransaction, type NewTransaction } from '../electron/database/txnStore'
import { getDashboard, getDashboardSummary } from '../electron/services/dashboard'
import { buildInsights, chooseGranularity, fillBuckets, foldTopN, spendingComparison } from '../electron/services/analytics'
import { saveNetWorth } from '../electron/services/catalog'
import { K, setSetting } from '../electron/services/settings'
import { clearHandlersForTests, callChannel, registeredChannels } from '../electron/ipc/register'
import { registerReportsIpc } from '../electron/ipc/reports'
import { API_METHODS } from '../shared/api'
import type { RecurringItem } from '../shared/api/recurring'
import { describeInsight, periodPhrase } from '../src/features/dashboard/insights'

const mocks = vi.hoisted(() => ({ kept: [] as unknown[] }))
vi.mock('../electron/services/recurring', () => ({ getKeptRecurringItems: () => mocks.kept }))

const NOW = new Date(2026, 10, 15, 12) // 15 Nov 2026

let n = 0
function add(date: string, amount: number, type: 'expense' | 'income', extra: Partial<NewTransaction> = {}) {
  return insertTransaction({
    date,
    merchant: extra.merchant ?? `Merchant ${++n}`,
    amount,
    type,
    account: 'Main Checking',
    source: 'manual',
    category: type === 'income' ? 'Income' : 'Groceries',
    ...extra
  })
}

const recurringItem = (over: Partial<RecurringItem>): RecurringItem => ({
  key: 'netflix', merchant: 'Netflix', kind: 'subscription', cadence: 'monthly', confidence: 'high', occurrences: 4,
  averageAmount: 199, lastAmount: 199, amountVariationPct: 0, firstDate: '2026-08-01', lastDate: '2026-11-01', nextDate: '2026-12-01',
  intervalDays: 30, category: 'Subscriptions', account: 'Main Checking', status: 'kept', monthlyCost: 199, annualCost: 2388, ...over
})

beforeEach(() => {
  freshDb()
  mocks.kept = []
  n = 0
})

describe('dashboard: empty (fresh install)', () => {
  it('returns honest empty data — no zero-filled series, no invented insights', () => {
    const d = getDashboard('all-time', NOW)
    expect(d.hasTransactions).toBe(false)
    expect(d.buckets).toEqual([])
    expect(d.categories).toEqual([])
    expect(d.recent).toEqual([])
    expect(d.needsReview).toEqual({ count: 0, latest: [] })
    expect(d.upcoming).toEqual([])
    expect(d.subscriptions).toEqual({ items: [], monthlyTotal: 0 })
    expect(d.insights).toEqual([])
    expect(d.summary).toMatchObject({ income: 0, spending: 0, net: 0, savingsRate: 0, transactionCount: 0 })
    expect(d.summary.netWorth).toEqual({ configured: false, assets: 0, liabilities: 0, value: null })
  })
})

describe('dashboard: income, spending, savings rate', () => {
  it('excludes transfers from income, spending and savings', () => {
    add('2026-11-02', 5000, 'income', { merchant: 'Salary' })
    add('2026-11-03', 1200, 'expense')
    add('2026-11-04', 300, 'expense')
    add('2026-11-05', 800, 'expense', { merchant: 'To savings', isTransfer: true, category: 'Transfer' })
    add('2026-11-05', 800, 'income', { merchant: 'From checking', isTransfer: true, category: 'Transfer', account: 'Cash' })
    const s = getDashboardSummary('all-time', NOW)
    expect(s).toMatchObject({ income: 5000, spending: 1500, net: 3500, savingsRate: 70, incomeCount: 1, spendingCount: 2, transactionCount: 3 })
  })

  it('savings rate is 0 when there is no income (never divides by zero) and negative when overspending', () => {
    add('2026-11-03', 100, 'expense')
    expect(getDashboardSummary('all-time', NOW).savingsRate).toBe(0)
    add('2026-11-04', 50, 'income')
    expect(getDashboardSummary('all-time', NOW).savingsRate).toBe(-100)
  })

  it('net worth is only what the user entered — never derived from cash flow', () => {
    add('2026-11-02', 9999, 'income')
    expect(getDashboardSummary('all-time', NOW).netWorth).toEqual({ configured: false, assets: 0, liabilities: 0, value: null })
    saveNetWorth({ assets: 1000, liabilities: 250 })
    add('2026-11-03', 500, 'income')
    expect(getDashboardSummary('all-time', NOW).netWorth).toEqual({ configured: true, assets: 1000, liabilities: 250, value: 750 })
  })
})

describe('dashboard: periods', () => {
  beforeEach(() => {
    add('2026-08-10', 11, 'expense') // before the 3-month window
    add('2026-08-20', 22, 'expense') // inside last-3-months (from 2026-08-16)
    add('2026-10-05', 200, 'expense')
    add('2026-10-20', 5000, 'expense')
    add('2026-11-03', 300, 'expense')
    add('2025-12-31', 7, 'expense') // previous year
  })

  it('filters by the selected period', () => {
    const spend = (p: Parameters<typeof getDashboardSummary>[0]) => getDashboardSummary(p, NOW).spending
    expect(spend('all-time')).toBe(5540)
    expect(spend('this-month')).toBe(300)
    expect(spend('last-month')).toBe(5200)
    expect(spend('last-3-months')).toBe(5522)
    expect(spend('last-6-months')).toBe(5533)
    expect(spend('this-year')).toBe(5533)
  })

  it('applies the period to charts, categories and recent activity', () => {
    const d = getDashboard('last-month', NOW)
    expect(d.range).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(d.buckets.every((b) => b.key.startsWith('2026-10'))).toBe(true)
    expect(d.categories[0]).toMatchObject({ name: 'Groceries', total: 5200, count: 2, pct: 100 })
    expect(d.recent.map((r) => r.date)).toEqual(['2026-10-20', '2026-10-05'])
  })
})

describe('dashboard: buckets', () => {
  it('chooses daily buckets for short ranges or short histories, otherwise monthly', () => {
    expect(chooseGranularity({ from: '2026-11-01', to: '2026-11-30' }, '2026-11-02', '2026-11-20')).toBe('day')
    // all-time with only a few days of history
    expect(chooseGranularity({ from: null, to: null }, '2026-11-01', '2026-11-20')).toBe('day')
    expect(chooseGranularity({ from: null, to: null }, '2026-09-20', '2026-11-20')).toBe('month') // 62 days of data
    expect(chooseGranularity({ from: '2026-08-16', to: '2026-11-15' }, '2026-09-01', '2026-10-01')).toBe('day') // span < 62
    expect(chooseGranularity({ from: '2026-08-16', to: '2026-11-15' }, '2026-08-20', '2026-11-10')).toBe('month')
  })

  it('fills only gaps inside the real data span and keeps a running total', () => {
    const out = fillBuckets(
      [
        { key: '2026-01', income: 100, expense: 40 },
        { key: '2026-04', income: 0, expense: 10 }
      ],
      'month'
    )
    expect(out.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(out.map((b) => b.net)).toEqual([60, 0, 0, -10])
    expect(out.map((b) => b.cumulative)).toEqual([60, 60, 60, 50])
    expect(fillBuckets([], 'day')).toEqual([])
  })

  it('daily buckets across a month boundary are continuous', () => {
    const out = fillBuckets([{ key: '2026-10-30', income: 0, expense: 5 }, { key: '2026-11-02', income: 0, expense: 1 }], 'day')
    expect(out.map((b) => b.key)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })

  it('uses daily buckets for a short history and monthly for a long one (end to end)', () => {
    add('2026-11-03', 10, 'expense')
    add('2026-11-05', 20, 'income')
    let d = getDashboard('all-time', NOW)
    expect(d.granularity).toBe('day')
    expect(d.buckets.map((b) => b.key)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05'])
    add('2026-02-01', 30, 'expense')
    d = getDashboard('all-time', NOW)
    expect(d.granularity).toBe('month')
    expect(d.buckets[0].key).toBe('2026-02')
    expect(d.buckets[d.buckets.length - 1].key).toBe('2026-11')
    expect(d.buckets[d.buckets.length - 1].cumulative).toBe(-20) // 20 − 10 − 30
  })
})

describe('dashboard: categories', () => {
  it('rolls subcategories up, folds the tail into Other (top 8 + Other) and never counts transfers', () => {
    for (let i = 1; i <= 10; i++) add('2026-11-03', i * 10, 'expense', { category: `Cat${i}` })
    add('2026-11-03', 15, 'expense', { category: 'Cat10:Sub' })
    add('2026-11-03', 999, 'expense', { category: 'Transfer', isTransfer: true })
    const d = getDashboard('all-time', NOW)
    expect(d.categories).toHaveLength(9)
    expect(d.categories[0]).toMatchObject({ name: 'Cat10', total: 115, count: 2 })
    const other = d.categories[8]
    expect(other).toMatchObject({ name: 'Other', isOther: true, count: 2, total: 30 }) // Cat1 + Cat2
    expect(d.categories.reduce((s, c) => s + c.total, 0)).toBe(565) // 10+20+…+100 plus the 15 subcategory; transfers excluded
    expect(foldTopN(d.categories.slice(0, 5), 8)).toHaveLength(5)
  })
})

describe('dashboard: lists', () => {
  it('recent activity is capped at 8, newest first', () => {
    for (let i = 1; i <= 12; i++) add(`2026-11-${String(i).padStart(2, '0')}`, i, 'expense')
    const d = getDashboard('all-time', NOW)
    expect(d.recent).toHaveLength(8)
    expect(d.recent[0].date).toBe('2026-11-12')
    expect(d.recent[7].date).toBe('2026-11-05')
  })

  it('needs-review is a to-do list across all dates (not limited by the period)', () => {
    add('2026-01-05', 10, 'expense', { category: 'Needs review' })
    add('2026-11-05', 20, 'expense', { category: 'Needs review' })
    add('2026-11-06', 30, 'expense')
    const d = getDashboard('this-month', NOW)
    expect(d.needsReview.count).toBe(2)
    expect(d.needsReview.latest.map((t) => t.date)).toEqual(['2026-11-05', '2026-01-05'])
  })

  it('upcoming payments and subscriptions come only from items the user kept', () => {
    add('2026-11-01', 199, 'expense', { merchant: 'Netflix' })
    setSetting(K.recurringDecisions, { netflix: { status: 'keep' } }) // the user has made a decision
    mocks.kept = [
      recurringItem({ key: 'rent', merchant: 'Rent', kind: 'bill', nextDate: '2026-11-17', monthlyCost: 20000, averageAmount: 20000 }),
      recurringItem({ key: 'netflix', nextDate: '2026-12-01' }),
      recurringItem({ key: 'spotify', merchant: 'Spotify', nextDate: '2026-11-10', monthlyCost: 119, averageAmount: 119 })
    ]
    const d = getDashboard('all-time', NOW)
    expect(d.upcoming.map((u) => u.key)).toEqual(['spotify', 'rent', 'netflix'])
    expect(d.upcoming.map((u) => u.daysUntil)).toEqual([-5, 2, 16]) // negative = expected date already passed
    expect(d.subscriptions.items.map((s) => s.key)).toEqual(['netflix', 'spotify'])
    expect(d.subscriptions.monthlyTotal).toBe(318)
  })
})

describe('dashboard: recurring is only consulted after the user decided something', () => {
  it('shows nothing upcoming (and does no detection) while there are no Keep/Ignore decisions', () => {
    add('2026-11-01', 199, 'expense', { merchant: 'Netflix' })
    mocks.kept = [recurringItem({})]
    const d = getDashboard('all-time', NOW)
    expect(d.upcoming).toEqual([])
    expect(d.subscriptions).toEqual({ items: [], monthlyTotal: 0 })
  })
})

describe('dashboard: insights (facts only)', () => {
  it('reports needs-review and the top category (excluding Needs review), rolled up to the parent', () => {
    add('2026-11-03', 400, 'expense', { category: 'Food:Dining' })
    add('2026-11-04', 300, 'expense', { category: 'Food:Snacks' })
    add('2026-11-05', 900, 'expense', { category: 'Needs review' })
    add('2026-11-06', 500, 'expense', { category: 'Rent' })
    add('2026-11-02', 5000, 'income')
    const d = getDashboard('this-month', NOW)
    expect(d.insights).toContainEqual({ id: 'needs-review', count: 1 })
    expect(d.insights).toContainEqual({ id: 'top-category', category: 'Food', total: 700, sharePct: 33.3 }) // 700 of 2,100 total spending
  })

  it('compares like for like: month-to-date vs the same days last month', () => {
    add('2026-10-05', 200, 'expense')
    add('2026-10-20', 5000, 'expense') // after day 15 → ignored by the like-for-like window
    add('2026-11-03', 300, 'expense')
    expect(spendingComparison('this-month', NOW)).toEqual({ current: 300, previous: 200, basis: 'same-days-last-month' })
    const d = getDashboard('this-month', NOW)
    expect(d.insights).toContainEqual({ id: 'spending-change', direction: 'up', pct: 50, current: 300, previous: 200, basis: 'same-days-last-month' })
  })

  it('last-month compares with the month before; other periods make no comparison', () => {
    add('2026-09-10', 2600, 'expense')
    add('2026-10-10', 1300, 'expense')
    expect(getDashboard('last-month', NOW).insights).toContainEqual({
      id: 'spending-change', direction: 'down', pct: 50, current: 1300, previous: 2600, basis: 'previous-month'
    })
    expect(spendingComparison('all-time', NOW)).toBeNull()
    expect(spendingComparison('last-3-months', NOW)).toBeNull()
    expect(getDashboard('this-year', NOW).insights.some((i) => i.id === 'spending-change')).toBe(false)
  })

  it('makes no spending-change claim when either side has no data', () => {
    add('2026-11-03', 300, 'expense')
    expect(getDashboard('this-month', NOW).insights.some((i) => i.id === 'spending-change')).toBe(false)
  })

  it('flags overspending and missing income, and says nothing when nothing is supported', () => {
    add('2026-11-03', 600, 'expense')
    add('2026-11-02', 500, 'income')
    expect(getDashboard('all-time', NOW).insights).toContainEqual({ id: 'spending-exceeds-income', shortfall: 100 })
    expect(buildInsights({ income: 0, spending: 10, transactionCount: 1, rolledCategories: [], needsReviewCount: 0, comparison: null })).toEqual([{ id: 'no-income' }])
    expect(buildInsights({ income: 100, spending: 0, transactionCount: 1, rolledCategories: [], needsReviewCount: 0, comparison: null })).toEqual([])
  })
})

describe('insight sentences', () => {
  const money = (x: number) => `₹${x}`
  it('turns structured insights into plain facts', () => {
    expect(describeInsight({ id: 'needs-review', count: 14 }, 'all-time', money).text).toBe('You have 14 transactions marked Needs review.')
    expect(describeInsight({ id: 'needs-review', count: 1 }, 'all-time', money).text).toBe('You have 1 transaction marked Needs review.')
    expect(describeInsight({ id: 'top-category', category: 'Food', total: 700, sharePct: 29.2 }, 'this-month', money).text).toBe(
      'Food is your highest spending category this month — ₹700, 29.2% of spending.'
    )
    expect(
      describeInsight({ id: 'spending-change', direction: 'up', pct: 50, current: 300, previous: 200, basis: 'same-days-last-month' }, 'this-month', money).text
    ).toBe('Spending is up 50% compared with the same days last month (₹300 vs ₹200).')
    expect(describeInsight({ id: 'spending-exceeds-income', shortfall: 100 }, 'last-3-months', money).text).toBe(
      'You spent ₹100 more than you earned in the last 3 months.'
    )
    expect(periodPhrase('all-time')).toBe('overall')
  })
})

describe('dashboard IPC', () => {
  it('is registered, validates the period and returns data', async () => {
    clearHandlersForTests()
    registerReportsIpc()
    add('2026-11-03', 10, 'expense')
    const d = await callChannel<{ summary: { spending: number } }>('dashboard.get', { period: 'all-time' })
    expect(d.summary.spending).toBe(10)
    await expect(callChannel('dashboard.get', { period: 'next-decade' })).rejects.toThrow()
    await expect(callChannel('dashboard.get', {})).rejects.toThrow()
    const have = new Set(registeredChannels())
    for (const ns of ['dashboard', 'reports'] as const) for (const m of API_METHODS[ns]) expect(have.has(`${ns}.${m}`)).toBe(true)
  })
})
