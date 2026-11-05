import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase } from '../electron/database/db'
import { setDataDir } from '../electron/database/paths'
import { seedRawTransactions } from './perfSeed'
import { resetFreshStartCache, seedDefaultsIfNeeded } from '../electron/services/settings'
import { getDashboard } from '../electron/services/dashboard'
import { accountsReport, categoryTrends, monthlyReport, spendingByCategory, tagsReport, topMerchants } from '../electron/services/reports'

const ROWS = 100_000
const NOW = new Date(2026, 10, 15, 12)
let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerly-perf-'))
  setDataDir(dir)
  closeDatabase()
  const db = openDatabase(path.join(dir, 'ledgerly.db'))
  resetFreshStartCache()
  seedDefaultsIfNeeded()
  const t0 = performance.now()
  seedRawTransactions(db, { count: ROWS })
  console.log(`[perf] seeded ${ROWS.toLocaleString()} rows in ${Math.round(performance.now() - t0)} ms`)
}, 120_000)

afterAll(() => {
  closeDatabase()
  fs.rmSync(dir, { recursive: true, force: true })
})

function timed<T>(label: string, fn: () => T): { result: T; ms: number } {
  const t = performance.now()
  const result = fn()
  const ms = Math.round(performance.now() - t)
  console.log(`[perf] ${label}: ${ms} ms`)
  return { result, ms }
}

describe('100,000 transactions', () => {
  it('dashboard (all time) stays fast', () => {
    const { result, ms } = timed('dashboard all-time', () => getDashboard('all-time', NOW))
    expect(ms).toBeLessThan(1500)
    expect(result.hasTransactions).toBe(true)
    expect(result.buckets.length).toBeGreaterThan(30)
    expect(result.categories.length).toBeLessThanOrEqual(9)
    expect(result.recent).toHaveLength(8)
  })

  it('dashboard (this month / last 6 months) stays fast', () => {
    for (const p of ['this-month', 'last-month', 'last-6-months', 'this-year'] as const) {
      expect(timed(`dashboard ${p}`, () => getDashboard(p, NOW)).ms).toBeLessThan(1500)
    }
  })

  it('every report stays fast', () => {
    expect(timed('spending by category', () => spendingByCategory('all-time', true, NOW)).ms).toBeLessThan(1500)
    expect(timed('monthly', () => monthlyReport('all-time', NOW)).ms).toBeLessThan(1500)
    expect(timed('category trends', () => categoryTrends('all-time', 5, NOW)).ms).toBeLessThan(1500)
    expect(timed('accounts', () => accountsReport('all-time', NOW)).ms).toBeLessThan(1500)
    expect(timed('tags', () => tagsReport('all-time', NOW)).ms).toBeLessThan(1500)
    // Top merchants normalises every distinct narration in JS, so it gets a little more headroom.
    const top = timed('top merchants', () => topMerchants('all-time', 15, NOW))
    expect(top.ms).toBeLessThan(3000)
    expect(top.result.rows).toHaveLength(15)
  })

  it('aggregates agree with each other (no double counting)', () => {
    const d = getDashboard('all-time', NOW)
    const cats = spendingByCategory('all-time', true, NOW)
    const monthly = monthlyReport('all-time', NOW)
    expect(Math.round(cats.total * 100)).toBe(Math.round(d.summary.spending * 100))
    expect(Math.round(monthly.totals.expense * 100)).toBe(Math.round(d.summary.spending * 100))
    expect(Math.round(monthly.totals.income * 100)).toBe(Math.round(d.summary.income * 100))
  })
})
