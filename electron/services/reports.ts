// Report queries. Same rules as the dashboard: transfers never count as income or spending;
// all figures are SQL aggregates over real transactions; nothing is invented when history is missing.
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../database/db'
import { paths } from '../database/paths'
import { dialogs } from '../platform/dialogs'
import { AppError } from '../../shared/errors'
import { addMonths } from '../../shared/dates'
import { round2, savingsRate } from '../../shared/money'
import { normalizeMerchantKey, prettyMerchant } from '../../shared/merchant'
import type { PeriodId } from '../../shared/types'
import type {
  AccountRow, AccountsReport, CategoryTrendsReport, MerchantRow, MonthRow, MonthlyReport, SpendingByCategoryReport,
  TagRow, TagsReport, TopMerchantsReport
} from '../../shared/api/reports'
import { getAccounts } from './settings'
import { categoryTotals, fillBuckets, loadCells, rangeClause, rangeFor, topLevelCategory } from './analytics'

export function spendingByCategory(period: PeriodId, rollUp: boolean, now?: Date): SpendingByCategoryReport {
  const range = rangeFor(period, now)
  const c = categoryTotals(range, rollUp)
  return { range, rollUp, rows: c.rows, total: c.total, count: c.count }
}

export function monthlyReport(period: PeriodId, now?: Date): MonthlyReport {
  const range = rangeFor(period, now)
  const byMonth = new Map<string, { key: string; income: number; expense: number }>()
  for (const c of loadCells(range)) {
    const key = c.date.slice(0, 7)
    let m = byMonth.get(key)
    if (!m) byMonth.set(key, (m = { key, income: 0, expense: 0 }))
    if (c.type === 'income') m.income += c.amount
    else m.expense += c.amount
  }
  // Continuous months between the first and last month with data (a month with no transactions is a true zero).
  const rows: MonthRow[] = fillBuckets([...byMonth.values()], 'month').map((b) => ({ month: b.key, expense: b.expense, income: b.income, net: b.net }))
  const income = round2(rows.reduce((s, r) => s + r.income, 0))
  const expense = round2(rows.reduce((s, r) => s + r.expense, 0))
  return { range, rows, totals: { income, expense, net: round2(income - expense), savingsRate: savingsRate(income, expense) } }
}

export function categoryTrends(period: PeriodId, top: number, now?: Date): CategoryTrendsReport {
  const range = rangeFor(period, now)
  const cells = loadCells(range)
  const totals = categoryTotals(range, true, cells).rows.slice(0, Math.max(1, top))
  if (totals.length === 0) return { range, months: [], series: [] }

  const wanted = new Set(totals.map((t) => t.name))
  const perMonth = new Map<string, Map<string, number>>() // month → category → total
  let lo = ''
  let hi = ''
  for (const c of cells) {
    if (c.type !== 'expense') continue
    const name = topLevelCategory(c.category)
    if (!wanted.has(name)) continue
    const month = c.date.slice(0, 7)
    if (!lo || month < lo) lo = month
    if (!hi || month > hi) hi = month
    let m = perMonth.get(month)
    if (!m) perMonth.set(month, (m = new Map()))
    m.set(name, (m.get(name) ?? 0) + c.amount)
  }
  const months: string[] = []
  for (let m = lo; m <= hi; m = addMonths(`${m}-01`, 1).slice(0, 7)) months.push(m)
  const series = totals.map((t) => ({ name: t.name, total: t.total, values: months.map((m) => round2(perMonth.get(m)?.get(t.name) ?? 0)) }))
  return { range, months, series }
}

export function topMerchants(period: PeriodId, limit: number, now?: Date): TopMerchantsReport {
  const range = rangeFor(period, now)
  const rc = rangeClause(range)
  const raw = getDb().all<{ merchant: string; total: number; count: number }>(
    `SELECT merchant, SUM(amount) AS total, COUNT(*) AS count
       FROM transactions WHERE type = 'expense' AND isTransfer = 0${rc.sql}
      GROUP BY merchant`,
    ...rc.params
  )
  const groups = new Map<string, { total: number; count: number }>()
  let totalSpending = 0
  for (const r of raw) {
    totalSpending += r.total
    const key = normalizeMerchantKey(r.merchant)
    const g = groups.get(key)
    if (g) {
      g.total += r.total
      g.count += r.count
    } else groups.set(key, { total: r.total, count: r.count })
  }
  totalSpending = round2(totalSpending)
  const rows: MerchantRow[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      name: prettyMerchant(key),
      total: round2(g.total),
      count: g.count,
      pct: totalSpending > 0 ? Math.round((g.total / totalSpending) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit))
  return { range, rows, totalSpending }
}

export function accountsReport(period: PeriodId, now?: Date): AccountsReport {
  const range = rangeFor(period, now)
  const rc = rangeClause(range)
  const db = getDb()
  const inPeriod = db.all<{
    account: string; moneyIn: number; moneyOut: number; tIn: number; tOut: number; cnt: number
  }>(
    `SELECT account,
            COALESCE(SUM(CASE WHEN isTransfer = 0 AND type = 'income'  THEN amount END), 0) AS moneyIn,
            COALESCE(SUM(CASE WHEN isTransfer = 0 AND type = 'expense' THEN amount END), 0) AS moneyOut,
            COALESCE(SUM(CASE WHEN isTransfer = 1 AND type = 'income'  THEN amount END), 0) AS tIn,
            COALESCE(SUM(CASE WHEN isTransfer = 1 AND type = 'expense' THEN amount END), 0) AS tOut,
            COUNT(*) AS cnt
       FROM transactions WHERE 1 = 1${rc.sql}
      GROUP BY account`,
    ...rc.params
  )
  // Balances look at all dates and include transfers (money really moved between accounts).
  const allTime = db.all<{ account: string; bal: number }>(
    `SELECT account, SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS bal FROM transactions GROUP BY account`
  )
  const balanceByAccount = new Map(allTime.map((r) => [r.account.toLowerCase(), r.bal]))
  const periodByAccount = new Map(inPeriod.map((r) => [r.account.toLowerCase(), r]))
  const managed = getAccounts()

  const seen = new Set<string>()
  const rows: AccountRow[] = []
  const add = (name: string, isManaged: boolean, opening: number | null) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const p = periodByAccount.get(key)
    const hasActivity = balanceByAccount.has(key)
    if (!hasActivity && opening === null) return // nothing real to show for this account
    const moneyIn = round2(p?.moneyIn ?? 0)
    const moneyOut = round2(p?.moneyOut ?? 0)
    rows.push({
      account: name,
      managed: isManaged,
      moneyIn,
      moneyOut,
      net: round2(moneyIn - moneyOut),
      transfersIn: round2(p?.tIn ?? 0),
      transfersOut: round2(p?.tOut ?? 0),
      count: p?.cnt ?? 0,
      openingBalance: opening,
      balance: opening === null ? null : round2(opening + (balanceByAccount.get(key) ?? 0))
    })
  }
  for (const a of managed) add(a.name, true, a.openingBalance)
  for (const r of allTime) add(r.account, false, null)
  rows.sort((a, b) => b.count - a.count || a.account.localeCompare(b.account))
  return { range, rows }
}

export function tagsReport(period: PeriodId, now?: Date): TagsReport {
  const range = rangeFor(period, now)
  const rc = rangeClause(range, 't.date')
  const rows = getDb()
    .all<TagRow>(
      `SELECT MIN(j.value) AS tag,
              COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS spending,
              COALESCE(SUM(CASE WHEN t.type = 'income'  THEN t.amount END), 0) AS income
         FROM transactions t, json_each(t.tags) j
        WHERE t.isTransfer = 0${rc.sql}
        GROUP BY lower(j.value)
        ORDER BY spending DESC, count DESC, tag COLLATE NOCASE`,
      ...rc.params
    )
    .map((r) => ({ tag: r.tag, count: r.count, spending: round2(r.spending), income: round2(r.income) }))
  return { range, rows }
}

const MAX_CSV_CHARS = 5_000_000

/** Save report CSV through the native "Save as" dialog (UTF-8 with BOM so Excel reads symbols correctly). */
export async function saveCsv(filename: string, content: string): Promise<{ saved: boolean }> {
  if (content.length > MAX_CSV_CHARS) throw new AppError('LIMIT', 'This report is too large to export as one CSV file.')
  const safe = (filename || 'report.csv').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.+$/, '')
  const name = /\.csv$/i.test(safe) ? safe : `${safe}.csv`
  let defaultPath = name
  try {
    defaultPath = path.join(paths.exports(), name)
  } catch {
    /* no data directory (tests) — fall back to the bare file name */
  }
  const target = await dialogs().saveFile({ title: 'Export report', defaultPath, filters: [{ name: 'CSV file', extensions: ['csv'] }] })
  if (!target) return { saved: false }
  fs.writeFileSync(target, content.startsWith('﻿') ? content : `﻿${content}`, 'utf8')
  return { saved: true }
}
