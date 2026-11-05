import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb, LONG_UPI } from './helpers'
import type { Db } from '../electron/database/sqlite'
import { baseFingerprint, insertBatch, type BatchRow } from '../electron/database/txnStore'
import { callChannel, clearHandlersForTests, invokeChannel } from '../electron/ipc/register'
import { registerRecurringIpc } from '../electron/ipc/recurring'
import {
  clearRecurringCache, detectAll, detectRecurring, getKeptRecurringItems, listRecurring, listSubscriptions
} from '../electron/services/recurring'
import { K, setSetting, getSetting } from '../electron/services/settings'
import { addDays, addMonths } from '../shared/dates'
import type { RecurringItem } from '../shared/api/recurring'

let db: Db
beforeEach(() => {
  db = freshDb()
  clearRecurringCache()
  clearHandlersForTests()
  registerRecurringIpc()
})

interface Spec {
  merchant: string
  date: string
  amount: number
  category?: string
  type?: 'expense' | 'income'
  isTransfer?: boolean
  account?: string
}

function seed(rows: Spec[]): void {
  const batch: BatchRow[] = rows.map((r) => {
    const account = r.account ?? 'Main Checking'
    return {
      date: r.date,
      merchant: r.merchant,
      amount: r.amount,
      type: r.type ?? 'expense',
      account,
      category: r.category ?? 'Other',
      isTransfer: r.isTransfer ?? false,
      source: 'manual',
      fingerprint: `${baseFingerprint(r.date, r.merchant, r.amount, account)}|${Math.random().toString(36).slice(2, 8)}`
    }
  })
  insertBatch(batch)
}

/** n payments, `step(i)` days/months apart starting at `start`. */
const series = (merchant: string, start: string, n: number, next: (d: string, i: number) => string, amount: (i: number) => number, extra: Partial<Spec> = {}): Spec[] => {
  const out: Spec[] = []
  let d = start
  for (let i = 0; i < n; i++) {
    out.push({ merchant, date: d, amount: amount(i), ...extra })
    d = next(d, i)
  }
  return out
}
const monthly = (m: string, start: string, n: number, amt: (i: number) => number = () => 100, extra: Partial<Spec> = {}) =>
  series(m, start, n, (d) => addMonths(d, 1), amt, extra)
const every = (days: number) => (d: string) => addDays(d, days)

const find = (key: string): RecurringItem => {
  const item = listRecurring().find((i) => i.key === key)
  if (!item) throw new Error(`not detected: ${key} (have ${listRecurring().map((i) => i.key).join(', ')})`)
  return item
}
const keys = () => listRecurring().map((i) => i.key).sort()

describe('cadence detection', () => {
  it('weekly (hinted merchant)', () => {
    seed(series('Gym Sessions', '2026-01-05', 6, every(7), () => 500))
    expect(find('gym sessions')).toMatchObject({ cadence: 'weekly', kind: 'subscription', occurrences: 6, intervalDays: 7, nextDate: '2026-02-16' })
  })

  it('biweekly', () => {
    seed(series('Water Delivery', '2026-01-02', 5, every(14), () => 200))
    expect(find('water delivery')).toMatchObject({ cadence: 'biweekly', kind: 'bill', intervalDays: 14 })
  })

  it('monthly with calendar-aware next date', () => {
    seed(monthly('Netflix', '2026-01-15', 4, () => 649))
    const n = find('netflix')
    expect(n).toMatchObject({ cadence: 'monthly', kind: 'subscription', firstDate: '2026-01-15', lastDate: '2026-04-15', nextDate: '2026-05-15' })
    expect(n.averageAmount).toBe(649)
    expect(n.monthlyCost).toBe(649)
    expect(n.annualCost).toBe(7788)
  })

  it('quarterly', () => {
    seed(series('Pest Control Service', '2025-01-10', 4, (d) => addMonths(d, 3), () => 1200))
    expect(find('pest control service')).toMatchObject({ cadence: 'quarterly', kind: 'other', nextDate: '2026-01-10' })
    expect(find('pest control service').monthlyCost).toBe(400)
  })

  it('annual (two payments are enough for a hinted subscription)', () => {
    seed(series('Amazon Prime', '2024-06-20', 2, (d) => addMonths(d, 12), () => 1499))
    const a = find('amazon prime')
    expect(a).toMatchObject({ cadence: 'annual', kind: 'subscription', confidence: 'medium', nextDate: '2026-06-20' })
    expect(a.monthlyCost).toBe(124.92)
    expect(a.annualCost).toBe(1499)
  })

  it('needs two unique payment dates: several charges on one day are one occurrence', () => {
    seed([
      { merchant: 'Netflix', date: '2026-03-01', amount: 100 },
      { merchant: 'Netflix', date: '2026-03-01', amount: 100 }
    ])
    expect(keys()).toEqual([])
  })

  it('ignores intervals outside every band', () => {
    seed(series('Gym Sessions', '2026-01-01', 4, every(20), () => 500)) // 20 days: between biweekly and monthly
    seed(series('Netflix', '2026-01-01', 3, every(60), () => 500)) // 60 days: between monthly and quarterly
    expect(keys()).toEqual([])
  })
})

describe('confidence', () => {
  it('high: ≥3 payments, variation ≤12 %, jitter ≤5 days', () => {
    seed(monthly('Spotify', '2026-01-03', 4, (i) => [119, 119, 119, 119][i]))
    expect(find('spotify').confidence).toBe('high')
  })

  it('medium: only two payments', () => {
    seed(monthly('Spotify', '2026-01-03', 2, () => 119))
    expect(find('spotify').confidence).toBe('medium')
  })

  it('medium: amounts vary by more than 12 %', () => {
    seed(monthly('Electricity Board', '2026-01-05', 4, (i) => [1000, 1150, 1000, 1000][i]))
    const e = find('electricity board')
    expect(e.amountVariationPct).toBe(15)
    expect(e.confidence).toBe('medium')
  })

  it('medium: payment dates wobble by more than 5 days', () => {
    seed([
      { merchant: 'Internet Broadband', date: '2026-01-05', amount: 999 },
      { merchant: 'Internet Broadband', date: '2026-02-02', amount: 999 }, // 28 days
      { merchant: 'Internet Broadband', date: '2026-03-12', amount: 999 }, // 38 days → jitter 5 from median 33? (28, 38)
      { merchant: 'Internet Broadband', date: '2026-04-20', amount: 999 } // 39
    ])
    expect(find('internet broadband').confidence).toBe('medium')
  })
})

describe('kinds, hints and thresholds', () => {
  it('subscription hint ≤20 %, bill hint ≤35 %, otherwise "other"', () => {
    seed(monthly('Netflix', '2026-01-01', 3, () => 649))
    seed(monthly('Home Rent', '2026-01-01', 3, () => 20000))
    seed(monthly('Electricity Board', '2026-01-02', 3, (i) => [900, 1100, 1300][i])) // 36 % vs median 1100 → too variable
    seed(monthly('Zoom Pro', '2026-01-03', 3, (i) => [100, 125, 110][i])) // 22 % → not a subscription, still ≤35 → other
    expect(find('netflix').kind).toBe('subscription')
    expect(find('home rent').kind).toBe('bill')
    expect(keys()).not.toContain('electricity board')
    expect(find('zoom pro').kind).toBe('other')
  })

  it('a hinted merchant that varies more than 35 % is not recurring', () => {
    seed(monthly('Mobile Recharge', '2026-01-01', 4, (i) => [100, 400, 150, 90][i]))
    expect(keys()).toEqual([])
  })

  it('hints match whole words only ("rental", "parent" are not "rent")', () => {
    seed(monthly('Rental Car Co', '2026-01-01', 3, (i) => [100, 115, 130][i])) // un-hinted, 26 % variation → not recurring
    seed(monthly('Parent Teacher Store', '2026-01-02', 3, (i) => [100, 115, 130][i]))
    expect(keys()).toEqual([])
  })

  it('the user\'s own categories act as hints', () => {
    seed(monthly('Mystery App', '2026-01-01', 3, (i) => [100, 105, 110][i], { category: 'Subscriptions' }))
    seed(monthly('Landlord Ravi', '2026-01-01', 3, (i) => [5000, 5200, 5400][i], { category: 'Housing' }))
    expect(find('mystery app').kind).toBe('subscription')
    expect(find('landlord ravi').kind).toBe('bill')
  })

  it('subcategories count towards the parent category hint', () => {
    seed(monthly('Cloud Notes', '2026-01-01', 3, () => 99, { category: 'Subscriptions:Software' }))
    expect(find('cloud notes').kind).toBe('subscription')
  })
})

describe('false-positive protection', () => {
  it('a grocery store visited weekly with varying baskets is not recurring', () => {
    seed(series('Big Bazaar', '2026-01-03', 12, every(7), (i) => [450, 1800, 620, 940, 1320, 700, 510, 1650, 880, 1010, 760, 1230][i]))
    expect(keys()).toEqual([])
  })

  it('even identical weekly purchases at an un-hinted store are not recurring (only monthly or slower qualifies)', () => {
    seed(series('Corner Shop', '2026-01-03', 8, every(7), () => 250))
    expect(keys()).toEqual([])
  })

  it('un-hinted merchants need three payments', () => {
    seed(monthly('Piano Lessons', '2026-01-10', 2, () => 1500))
    expect(keys()).toEqual([])
    seed(monthly('Piano Lessons', '2026-03-10', 1, () => 1500))
    expect(find('piano lessons')).toMatchObject({ kind: 'other', cadence: 'monthly', confidence: 'high' })
  })

  it('un-hinted merchants need ≤3 % variation', () => {
    seed(monthly('Tailor Shop', '2026-01-10', 4, (i) => [1000, 1040, 1000, 1000][i])) // 4 %
    expect(keys()).toEqual([])
    seed(monthly('Yoga Studio', '2026-01-10', 4, (i) => [1000, 1020, 1000, 1010][i])) // 2 %
    expect(find('yoga studio').kind).toBe('other')
  })

  it('irregular dates do not form a rhythm', () => {
    seed([
      { merchant: 'Piano Lessons', date: '2026-01-02', amount: 1500 },
      { merchant: 'Piano Lessons', date: '2026-01-20', amount: 1500 },
      { merchant: 'Piano Lessons', date: '2026-04-11', amount: 1500 },
      { merchant: 'Piano Lessons', date: '2026-05-03', amount: 1500 }
    ])
    expect(keys()).toEqual([])
  })

  it('income and transfers are never recurring payments', () => {
    seed(monthly('Netflix', '2026-01-01', 4, () => 649, { type: 'income' }))
    seed(monthly('Rent Transfer', '2026-01-01', 4, () => 20000, { isTransfer: true }))
    expect(keys()).toEqual([])
  })
})

describe('merchant grouping', () => {
  it('groups UPI narrations by payee although the references change each month', () => {
    seed(
      monthly('x', '2026-01-08', 4).map((r, i) => ({
        ...r,
        merchant: `UPI-NETFLIX-netflix@icici-ICIC0000001-12345678901${i}-PAYMENT`,
        amount: 649
      }))
    )
    const n = find('netflix')
    expect(n.occurrences).toBe(4)
    expect(n.merchant).toBe('Netflix')
  })

  it('a long narration with many ids still produces a readable name', () => {
    seed(monthly(LONG_UPI, '2026-01-01', 3, () => 300, { category: 'Subscriptions' }))
    expect(find('mr a manikandan').merchant).toBe('Mr A Manikandan')
  })

  it('reports the most common category (ignoring Needs review) and account', () => {
    seed(monthly('Netflix', '2026-01-01', 3, () => 649, { category: 'Entertainment', account: 'Everyday Visa' }))
    seed([{ merchant: 'Netflix', date: '2026-04-01', amount: 649, category: 'Needs review', account: 'Everyday Visa' }])
    const n = find('netflix')
    expect(n.category).toBe('Entertainment')
    expect(n.account).toBe('Everyday Visa')
  })
})

describe('keep / ignore / restore', () => {
  beforeEach(() => {
    seed(monthly('Netflix', '2026-01-15', 4, () => 649))
    seed(monthly('Home Rent', '2026-01-01', 4, () => 20000))
  })

  it('nothing is confirmed automatically', () => {
    expect(listRecurring().every((i) => i.status === 'suggested')).toBe(true)
    expect(getKeptRecurringItems()).toEqual([])
    expect(getSetting(K.recurringDecisions, null)).toEqual({})
  })

  it('keep / ignore / restore through IPC', async () => {
    await callChannel('recurring.keep', { key: 'netflix' })
    await callChannel('recurring.ignore', { key: 'home rent' })
    const all = await callChannel<RecurringItem[]>('recurring.list')
    expect(all.find((i) => i.key === 'netflix')!.status).toBe('kept')
    expect(all.find((i) => i.key === 'home rent')!.status).toBe('ignored')
    expect((await callChannel<RecurringItem[]>('recurring.list', { status: 'ignored' })).map((i) => i.key)).toEqual(['home rent'])
    expect((await callChannel<RecurringItem[]>('recurring.list', { status: 'kept' })).map((i) => i.key)).toEqual(['netflix'])
    expect((await callChannel<RecurringItem[]>('recurring.list', { kind: 'bill' })).map((i) => i.key)).toEqual(['home rent'])

    await callChannel('recurring.restore', { key: 'home rent' })
    await callChannel('recurring.restore', { key: 'netflix' }) // restore also works for kept items
    expect((await callChannel<RecurringItem[]>('recurring.list')).every((i) => i.status === 'suggested')).toBe(true)
  })

  it('decisions persist in SQLite and survive a restart', async () => {
    await callChannel('recurring.keep', { key: 'netflix' })
    await callChannel('recurring.ignore', { key: 'home rent' })
    const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'recurringDecisions'")!
    const stored = JSON.parse(row.value)
    expect(stored.netflix).toMatchObject({ status: 'keep', merchant: 'Netflix' })
    expect(stored['home rent'].status).toBe('ignore')

    // "restart": drop every in-memory cache and read again from the database only
    clearRecurringCache()
    clearHandlersForTests()
    registerRecurringIpc()
    const again = await callChannel<RecurringItem[]>('recurring.list')
    expect(again.find((i) => i.key === 'netflix')!.status).toBe('kept')
    expect(again.find((i) => i.key === 'home rent')!.status).toBe('ignored')
  })

  it('getKeptRecurringItems returns only kept items, soonest first', async () => {
    await callChannel('recurring.keep', { key: 'netflix' })
    await callChannel('recurring.keep', { key: 'home rent' })
    const kept = getKeptRecurringItems()
    expect(kept.map((i) => i.key)).toEqual(['home rent', 'netflix']) // rent due 2026-05-01, netflix 2026-05-15
    expect(kept.every((i) => i.status === 'kept')).toBe(true)
    await callChannel('recurring.ignore', { key: 'home rent' })
    expect(getKeptRecurringItems().map((i) => i.key)).toEqual(['netflix'])
  })

  it('refuses to decide about something that is not detected', async () => {
    const res = await invokeChannel('recurring.keep', { key: 'not a real payment' })
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await invokeChannel('recurring.keep', {})).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(getSetting(K.recurringDecisions, null)).toEqual({})
  })

  it('a decision about something that disappears from the data is simply not listed', async () => {
    await callChannel('recurring.keep', { key: 'netflix' })
    db.run("DELETE FROM transactions WHERE merchant = 'Netflix'")
    expect(listRecurring().map((i) => i.key)).toEqual(['home rent'])
    expect(getKeptRecurringItems()).toEqual([])
  })
})

describe('subscriptions', () => {
  beforeEach(() => {
    seed(monthly('Netflix', '2026-01-15', 4, () => 649))
    seed(series('Amazon Prime', '2024-06-20', 2, (d) => addMonths(d, 12), () => 1499))
    seed(monthly('Spotify', '2026-01-03', 3, () => 119))
    seed(monthly('Home Rent', '2026-01-01', 4, () => 20000))
  })

  it('lists only subscription-kind items; totals count kept ones only', async () => {
    let res = listSubscriptions()
    expect(res.items.map((i) => i.key).sort()).toEqual(['amazon prime', 'netflix', 'spotify'])
    expect(res.summary).toEqual({ keptCount: 0, suggestedCount: 3, keptMonthlyCost: 0, keptAnnualCost: 0 })

    await callChannel('recurring.keep', { key: 'netflix' })
    await callChannel('recurring.keep', { key: 'amazon prime' })
    res = await callChannel('subscriptions.list')
    expect(res.summary.keptCount).toBe(2)
    expect(res.summary.suggestedCount).toBe(1)
    expect(res.summary.keptMonthlyCost).toBe(773.92) // 649 + 1499/12
    expect(res.summary.keptAnnualCost).toBe(9287) // 649*12 + 1499
    expect((await callChannel<{ items: RecurringItem[] }>('subscriptions.list', { status: 'suggested' })).items.map((i) => i.key)).toEqual(['spotify'])
    expect((await callChannel<{ items: RecurringItem[] }>('subscriptions.list', { status: 'kept' })).items).toHaveLength(2)
  })

  it('ignored subscriptions do not count', async () => {
    await callChannel('recurring.ignore', { key: 'netflix' })
    expect(listSubscriptions().summary.keptMonthlyCost).toBe(0)
    expect(listSubscriptions('ignored').items.map((i) => i.key)).toEqual(['netflix'])
  })
})

describe('detection preferences', () => {
  beforeEach(() => {
    seed(monthly('Netflix', '2026-01-15', 4, () => 649))
    seed(monthly('Home Rent', '2026-01-01', 4, () => 20000))
  })

  it('recurring detection off → nothing listed or kept; the status is reported', async () => {
    await callChannel('recurring.keep', { key: 'netflix' })
    setSetting(K.detectionPreferences, { recurring: false, subscriptions: true })
    expect(await callChannel('recurring.status')).toEqual({ recurringEnabled: false, subscriptionsEnabled: true })
    expect(listRecurring()).toEqual([])
    // subscriptions still work and a kept subscription still shows up for the dashboard
    expect(listSubscriptions().items.map((i) => i.key)).toEqual(['netflix'])
    expect(getKeptRecurringItems().map((i) => i.key)).toEqual(['netflix'])
  })

  it('subscription detection off → no subscriptions', () => {
    setSetting(K.detectionPreferences, { recurring: true, subscriptions: false })
    expect(listSubscriptions()).toMatchObject({ items: [], enabled: false })
    expect(listRecurring().map((i) => i.key).sort()).toEqual(['home rent', 'netflix'])
  })

  it('both off → empty everywhere', () => {
    setSetting(K.detectionPreferences, { recurring: false, subscriptions: false })
    expect(listRecurring()).toEqual([])
    expect(getKeptRecurringItems()).toEqual([])
  })
})

describe('caching', () => {
  it('recomputes when transactions change and reuses the result otherwise', () => {
    seed(monthly('Netflix', '2026-01-15', 3, () => 649))
    const first = detectAll()
    expect(detectAll()).toBe(first) // same array instance → served from cache
    seed(monthly('Spotify', '2026-01-03', 3, () => 119))
    const second = detectAll()
    expect(second).not.toBe(first)
    expect(second.map((i) => i.key).sort()).toEqual(['netflix', 'spotify'])
    db.run("UPDATE transactions SET isTransfer = 1, updatedAt = ? WHERE merchant = 'Spotify'", new Date(Date.now() + 5000).toISOString())
    expect(detectAll().map((i) => i.key)).toEqual(['netflix'])
  })
})

describe('detectRecurring (pure)', () => {
  it('works on plain rows without a database', () => {
    const rows = ['2026-01-01', '2026-02-01', '2026-03-01'].map((date) => ({ merchant: 'GitHub', date, amount: 400, category: 'Other', account: 'A' }))
    const items = detectRecurring(rows)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'github', kind: 'subscription', cadence: 'monthly', confidence: 'high' })
  })
})

describe('performance (100,000 transactions)', () => {
  it('detects in well under a couple of seconds and serves repeat calls from cache', () => {
    let seedValue = 12345
    const rand = () => {
      seedValue = (seedValue * 1664525 + 1013904223) % 4294967296
      return seedValue / 4294967296
    }
    const rows: Spec[] = []
    // letters only: digit groups are (deliberately) stripped from merchant keys
    const alpha = (n: number) => String.fromCharCode(97 + (Math.floor(n / 676) % 26), 97 + (Math.floor(n / 26) % 26), 97 + (n % 26))
    // 400 genuinely monthly payees (40 payments each = 16,000 rows)
    for (let m = 0; m < 400; m++) rows.push(...monthly(`Monthly Payee ${alpha(m)} Services`, '2023-01-05', 40, () => 500 + m))
    // 600 frequent shops with noisy baskets (≈ 54 visits each = 33,000 rows)
    for (let s = 0; s < 600; s++) {
      let d = '2023-01-02'
      for (let v = 0; v < 55; v++) {
        rows.push({ merchant: `Shop ${alpha(s)} Market`, date: d, amount: Math.round(100 + rand() * 2000) })
        d = addDays(d, 1 + Math.floor(rand() * 20))
      }
    }
    // the rest: one-off UPI narrations with unique references
    while (rows.length < 100_000) {
      const n = rows.length
      rows.push({
        merchant: `UPI-PERSON ${alpha(n % 977)}-98${String(n).padStart(8, '0')}-${n}@YBL-CIUB0000476-${600000000000 + n}-NOTE`,
        date: addDays('2023-01-01', n % 1000),
        amount: Math.round(10 + rand() * 900)
      })
    }
    for (let i = 0; i < rows.length; i += 5000) seed(rows.slice(i, i + 5000))
    expect(db.scalar<number>('SELECT COUNT(*) FROM transactions')).toBe(rows.length)

    // Best of three cold runs: other processes on a busy machine only ever make a run slower.
    let cold = Infinity
    let items = detectAll()
    for (let run = 0; run < 3; run++) {
      clearRecurringCache()
      const t0 = performance.now()
      items = detectAll()
      cold = Math.min(cold, performance.now() - t0)
    }
    const t1 = performance.now()
    detectAll()
    const warm = performance.now() - t1

    console.info(`[perf] detectAll on ${rows.length} transactions: cold ${Math.round(cold)} ms, cached ${warm.toFixed(1)} ms`)
    expect(items.filter((i) => i.key.startsWith('monthly payee')).length).toBe(400)
    // noisy shops must not be reported
    expect(items.some((i) => i.key.startsWith('shop '))).toBe(false)
    expect(cold).toBeLessThan(2500)
    expect(warm).toBeLessThan(100)
  }, 120_000)
})
