import { beforeEach, describe, expect, it } from 'vitest'
import { count, freshDb, LONG_UPI } from './helpers'
import { callChannel, clearHandlersForTests, invokeChannel } from '../electron/ipc/register'
import { registerCategoryFinderIpc } from '../electron/ipc/categoryFinder'
import { registerRulesIpc } from '../electron/ipc/rules'
import { missingHandlers } from '../electron/ipc'
import { baseFingerprint, insertBatch, insertTransaction } from '../electron/database/txnStore'
import { clearAllSessions } from '../electron/services/categoryFinder'
import { loadCompiledRules } from '../electron/services/rulesStore'
import { addCategory } from '../electron/services/catalog'
import { firstMatchingRule } from '../shared/matching'
import type { Db } from '../electron/database/sqlite'
import type {
  FinderApplyResult, FinderPage, FinderSaveRulesResult, FinderSummary
} from '../shared/api/categoryFinder'

let db: Db

beforeEach(() => {
  db = freshDb()
  clearHandlersForTests()
  clearAllSessions()
  registerCategoryFinderIpc()
  registerRulesIpc()
  addCategory({ name: 'Food' })
  addCategory({ name: 'Transportation2' })
})

const KEYWORDS = 'Tea, Briyani, Dosa, Dinner, Lunch, Breakfast'

const add = (merchant: string, over: Partial<Parameters<typeof insertTransaction>[0]> = {}) =>
  insertTransaction({ date: '2026-03-01', merchant, amount: 100, type: 'expense', account: 'Cash', source: 'manual', ...over })

const search = (category: string, keywords: string, wholeWord = false) =>
  callChannel<FinderSummary>('categoryFinder.search', { category, keywords, wholeWord })
const page = (sessionId: string, p = 1, pageSize = 50) => callChannel<FinderPage>('categoryFinder.page', { sessionId, page: p, pageSize })
const apply = (sessionId: string) => callChannel<FinderApplyResult>('categoryFinder.apply', { sessionId })

/** Every column of every transaction, keyed by id. */
const snapshot = () => {
  const out = new Map<string, Record<string, unknown>>()
  for (const r of db.all<Record<string, unknown>>('SELECT * FROM transactions')) out.set(String(r.id), { ...r })
  return out
}

describe('§115 acceptance: long UPI narration', () => {
  it('finds the transaction, reports Lunch and Tea, applies Food and changes nothing else', async () => {
    const t = add(LONG_UPI, { date: '2026-10-12', amount: 180, tags: ['Weekend'], account: 'Main Checking' })
    const before = snapshot().get(t.id)!

    const summary = await search('Food', KEYWORDS)
    expect(summary).toMatchObject({ category: 'Food', total: 1, scanned: 1, selectedCount: 1 })
    expect(summary.keywords).toEqual(['Tea', 'Briyani', 'Dosa', 'Dinner', 'Lunch', 'Breakfast'])
    expect(summary.perKeyword.filter((k) => k.count > 0).map((k) => k.keyword).sort()).toEqual(['Lunch', 'Tea'])

    const p = await page(summary.sessionId)
    expect(p.total).toBe(1)
    const row = p.rows[0]
    expect(row.hits.map((h) => h.keyword).sort()).toEqual(['Lunch', 'Tea'])
    for (const h of row.hits) expect(row.text.slice(h.start, h.end).toLowerCase()).toBe(h.keyword.toLowerCase())
    expect(row).toMatchObject({ amount: 180, type: 'expense', currentCategory: 'Needs review', selected: true, alreadyInCategory: false })

    // Searching and paging never write anything.
    expect(snapshot().get(t.id)).toEqual(before)

    const res = await apply(summary.sessionId)
    expect(res).toMatchObject({ category: 'Food', changed: 1, notSelected: 0, selected: 1, total: 1 })

    const after = snapshot().get(t.id)!
    expect(after.category).toBe('Food')
    // …and the transaction is otherwise unchanged.
    const { category: _c, categoryLocked: _l, updatedAt: _u, ...restAfter } = after
    const { category: _c2, categoryLocked: _l2, updatedAt: _u2, ...restBefore } = before
    expect(restAfter).toEqual(restBefore)
    expect(after.categoryLocked).toBe(1)
    expect(count(db, 'transactions')).toBe(1)
  })
})

describe('search is read-only and matching is correct', () => {
  it('does not modify anything before apply (summary, paging, selection)', async () => {
    add('TEA-12345')
    add('Briyani@Restaurant', { amount: 320 })
    add('Electricity bill', { amount: 900 })
    const before = snapshot()
    const s = await search('Food', 'tea, briyani')
    await page(s.sessionId)
    await callChannel('categoryFinder.select', { sessionId: s.sessionId, op: 'none' })
    await callChannel('categoryFinder.select', { sessionId: s.sessionId, op: 'all' })
    expect(snapshot()).toEqual(before)
  })

  it('is case-insensitive, substring based, searches merchant AND memo, and has no false matches', async () => {
    add('LUNCHUPI')
    add('xxDOSAyy', { amount: 90 })
    add('Plain shop', { memo: 'weekly Breakfast order', amount: 55 })
    add('Electricity bill', { amount: 900 })
    add('Rent', { amount: 20000 })
    const s = await search('Food', 'lunch, dosa, BREAKFAST')
    expect(s.total).toBe(3)
    expect(s.scanned).toBe(5)
    const p = await page(s.sessionId)
    expect(p.rows.map((r) => r.text).sort()).toEqual(['LUNCHUPI', 'Plain shop weekly Breakfast order', 'xxDOSAyy'])
  })

  it('whole-word mode skips matches glued to letters but keeps matches next to digits and punctuation', async () => {
    add('STEAK HOUSE', { amount: 10 })
    add('TEA-12345', { amount: 20 })
    add('TEAM LUNCH', { amount: 30 })
    add('morning tea', { amount: 40 })
    const sub = await search('Food', 'tea')
    expect(sub.total).toBe(4) // STEAK, TEA-, TEAM and morning all contain "tea"
    const word = await search('Food', 'tea', true)
    expect(word.total).toBe(2)
    expect(word.wholeWord).toBe(true)
    const rows = (await page(word.sessionId)).rows.map((r) => r.text).sort()
    expect(rows).toEqual(['TEA-12345', 'morning tea'])
  })

  it('treats comma-separated items as independent, de-duplicated keywords', async () => {
    add('lunch special')
    const s = await search('Food', ' Tea, tea, TEA ,, Lunch ,')
    expect(s.keywords).toEqual(['Tea', 'Lunch'])
    expect(s.total).toBe(1)
  })

  it('returns an empty result (not an error) when nothing matches', async () => {
    add('Rent')
    const s = await search('Food', 'tea')
    expect(s).toMatchObject({ total: 0, selectedCount: 0 })
    expect((await page(s.sessionId)).rows).toEqual([])
  })

  it('supports multiple categories in separate searches', async () => {
    add('Uber trip', { amount: 250 })
    add('Masala dosa', { amount: 90 })
    const food = await search('Food', 'dosa')
    await apply(food.sessionId)
    const transport = await search('Transportation2', 'uber')
    await apply(transport.sessionId)
    const cats = Object.fromEntries(db.all<{ merchant: string; category: string }>('SELECT merchant, category FROM transactions').map((r) => [r.merchant, r.category]))
    expect(cats).toEqual({ 'Uber trip': 'Transportation2', 'Masala dosa': 'Food' })
  })

  it('validates input with friendly messages', async () => {
    await expect(search('Food', '  ,  ')).rejects.toThrow(/at least one keyword/)
    await expect(search('', 'tea')).rejects.toThrow(/Category/)
    await expect(search('Nonexistent', 'tea')).rejects.toThrow(/does not exist yet/)
    await expect(callChannel('categoryFinder.page', { sessionId: 'nope', page: 1, pageSize: 50 })).rejects.toThrow(/no longer available/)
    await expect(callChannel('categoryFinder.page', { sessionId: 'x', page: 0, pageSize: 50 })).rejects.toThrow()
    await expect(callChannel('categoryFinder.apply', { sessionId: 'nope' })).rejects.toThrow(/no longer available/)
  })

  it('accepts a case-different category and uses the managed spelling', async () => {
    add('tea stall')
    expect((await search('food', 'tea')).category).toBe('Food')
  })
})

describe('selection model', () => {
  const seed = (n: number) => {
    for (let i = 0; i < n; i++) add(`Lunch place ${i}`, { amount: 10 + i, date: `2026-03-${String((i % 27) + 1).padStart(2, '0')}` })
  }

  it('select all / none / invert / default and per-row toggles work across pages', async () => {
    seed(25)
    const s = await search('Food', 'lunch')
    expect(s.total).toBe(25)
    expect(s.selectedCount).toBe(25)
    const sel = (op: string) => callChannel<{ selectedCount: number }>('categoryFinder.select', { sessionId: s.sessionId, op })

    expect((await sel('none')).selectedCount).toBe(0)
    const p2 = await page(s.sessionId, 2, 10)
    expect(p2.rows).toHaveLength(10)
    expect(p2.rows.every((r) => !r.selected)).toBe(true)

    const toggled = await callChannel<{ selectedCount: number }>('categoryFinder.toggle', {
      sessionId: s.sessionId, ids: p2.rows.slice(0, 3).map((r) => r.id), selected: true
    })
    expect(toggled.selectedCount).toBe(3)
    expect((await page(s.sessionId, 2, 10)).rows.filter((r) => r.selected)).toHaveLength(3)
    // idempotent
    expect((await callChannel<{ selectedCount: number }>('categoryFinder.toggle', {
      sessionId: s.sessionId, ids: p2.rows.slice(0, 3).map((r) => r.id), selected: true })).selectedCount).toBe(3)

    expect((await sel('invert')).selectedCount).toBe(22)
    expect((await sel('all')).selectedCount).toBe(25)
    expect((await sel('default')).selectedCount).toBe(25)
    expect((await page(s.sessionId, 3, 10)).rows).toHaveLength(5)
  })

  it('apply changes only the selected rows and reports how many were not selected', async () => {
    seed(27)
    const s = await search('Food', 'lunch')
    const first = await page(s.sessionId, 1, 10)
    await callChannel('categoryFinder.toggle', { sessionId: s.sessionId, ids: first.rows.slice(0, 3).map((r) => r.id), selected: false })
    const res = await apply(s.sessionId)
    expect(res).toMatchObject({ category: 'Food', changed: 24, notSelected: 3, selected: 24, total: 27 })
    expect(count(db, 'transactions')).toBe(27)
    expect(db.scalar<number>("SELECT COUNT(*) FROM transactions WHERE category = 'Food'")).toBe(24)
    expect(db.scalar<number>("SELECT COUNT(*) FROM transactions WHERE category = 'Needs review'")).toBe(3)
    // the session is consumed: applying twice is impossible
    await expect(apply(s.sessionId)).rejects.toThrow(/no longer available/)
  })

  it('refuses to apply an empty selection', async () => {
    seed(3)
    const s = await search('Food', 'lunch')
    await callChannel('categoryFinder.select', { sessionId: s.sessionId, op: 'none' })
    await expect(apply(s.sessionId)).rejects.toThrow(/Select at least one/)
    expect(db.scalar<number>("SELECT COUNT(*) FROM transactions WHERE category = 'Food'")).toBe(0)
  })

  it('cancel discards the preview without touching data', async () => {
    seed(2)
    const before = snapshot()
    const s = await search('Food', 'lunch')
    await callChannel('categoryFinder.cancel', { sessionId: s.sessionId })
    await callChannel('categoryFinder.cancel', { sessionId: 'unknown-session' })
    await expect(page(s.sessionId)).rejects.toThrow(/no longer available/)
    expect(snapshot()).toEqual(before)
  })

  it('keeps the oldest-session cap so memory stays bounded', async () => {
    seed(1)
    const first = await search('Food', 'lunch')
    for (let i = 0; i < 3; i++) await search('Food', 'lunch')
    await expect(page(first.sessionId)).rejects.toThrow(/no longer available/)
  })

  it('skips rows deleted after the search instead of failing', async () => {
    const a = add('Lunch one')
    add('Lunch two', { amount: 5 })
    const s = await search('Food', 'lunch')
    db.run('DELETE FROM transactions WHERE id = ?', a.id)
    const p = await page(s.sessionId)
    expect(p.rows).toHaveLength(1)
    const res = await apply(s.sessionId)
    expect(res.changed).toBe(1)
  })
})

describe('manual override protection', () => {
  it('lists manually categorized rows but leaves them unchecked; already-in-category rows too', async () => {
    const locked = add('Lunch locked', { category: 'Shopping', categoryLocked: true, amount: 11 })
    const already = add('Lunch already', { category: 'Food', amount: 12 })
    const free = add('Lunch free', { category: 'Dining', amount: 13 })
    const review = add('Lunch review', { amount: 14 })
    const s = await search('Food', 'lunch')
    expect(s).toMatchObject({ total: 4, alreadyInCategory: 1, lockedElsewhere: 1, selectedCount: 2 })
    const rows = new Map((await page(s.sessionId)).rows.map((r) => [r.id, r]))
    expect(rows.get(locked.id)).toMatchObject({ selected: false, categoryLocked: true, alreadyInCategory: false })
    expect(rows.get(already.id)).toMatchObject({ selected: false, alreadyInCategory: true })
    expect(rows.get(free.id)!.selected).toBe(true)
    expect(rows.get(review.id)!.selected).toBe(true)

    const res = await apply(s.sessionId)
    expect(res.changed).toBe(2)
    const cat = (id: string) => db.scalar<string>('SELECT category FROM transactions WHERE id = ?', id)
    expect(cat(locked.id)).toBe('Shopping') // untouched
    expect(cat(free.id)).toBe('Food')
    expect(cat(review.id)).toBe('Food')
  })

  it('the user can explicitly select a protected row to override it', async () => {
    const locked = add('Lunch locked', { category: 'Shopping', categoryLocked: true })
    const s = await search('Food', 'lunch')
    expect(s.selectedCount).toBe(0)
    await callChannel('categoryFinder.toggle', { sessionId: s.sessionId, ids: [locked.id], selected: true })
    const res = await apply(s.sessionId)
    expect(res.changed).toBe(1)
    expect(db.get<{ category: string; categoryLocked: number }>('SELECT category, categoryLocked FROM transactions')).toMatchObject({ category: 'Food', categoryLocked: 1 })
  })

  it('applied rows become protected so later rule runs never overwrite them', async () => {
    const t = add('Lunch place')
    const s = await search('Food', 'lunch')
    await apply(s.sessionId)
    expect(db.scalar<number>('SELECT categoryLocked FROM transactions WHERE id = ?', t.id)).toBe(1)
  })

  it('transfers are listed with their flag and never counted as spending changes elsewhere', async () => {
    add('Lunch transfer', { isTransfer: true, category: 'Transfer' })
    const s = await search('Food', 'lunch')
    expect((await page(s.sessionId)).rows[0]).toMatchObject({ isTransfer: true })
  })

  it('only category, categoryLocked and updatedAt can ever change', async () => {
    for (let i = 0; i < 5; i++) add(`Dinner ${i}`, { amount: 50 + i, memo: `memo ${i}`, tags: ['Family'], reference: `ref${i}`, account: 'Visa' })
    const before = snapshot()
    const s = await search('Food', 'dinner')
    await apply(s.sessionId)
    for (const [id, was] of before) {
      const now = snapshot().get(id)!
      for (const col of Object.keys(was)) {
        if (['category', 'categoryLocked', 'updatedAt'].includes(col)) continue
        expect(now[col], `${col} must be unchanged`).toEqual(was[col])
      }
    }
  })

  it('creates no duplicates and keeps fingerprints unique', async () => {
    add('Dinner a')
    add('Dinner b', { amount: 7 })
    const s = await search('Food', 'dinner')
    await apply(s.sessionId)
    expect(count(db, 'transactions')).toBe(2)
    expect(db.scalar<number>('SELECT COUNT(DISTINCT fingerprint) FROM transactions')).toBe(2)
  })
})

describe('saving keywords as rules', () => {
  it('creates one rule per keyword, flagged as Category Finder rules, and skips duplicates and conflicts', async () => {
    const kw = ['Tea', 'Briyani', 'Dosa']
    const first = await callChannel<FinderSaveRulesResult>('categoryFinder.saveRules', { category: 'Food', keywords: kw })
    expect(first.created.map((r) => r.whenText)).toEqual(expect.arrayContaining(kw))
    expect(first.created.every((r) => r.thenText === 'Food' && r.source === 'category-finder' && r.enabled && r.matchType === 'contains')).toBe(true)
    expect(first.skipped).toEqual([])
    expect(count(db, 'rules')).toBe(3)

    const again = await callChannel<FinderSaveRulesResult>('categoryFinder.saveRules', { category: 'Food', keywords: ['tea', 'Lunch'] })
    expect(again.created.map((r) => r.whenText)).toEqual(['Lunch'])
    expect(again.skipped).toEqual([{ keyword: 'tea', reason: 'duplicate' }])

    const conflict = await callChannel<FinderSaveRulesResult>('categoryFinder.saveRules', { category: 'Transportation2', keywords: ['Dosa'] })
    expect(conflict.created).toEqual([])
    expect(conflict.skipped).toEqual([{ keyword: 'Dosa', reason: 'conflict', existingCategory: 'Food' }])
    expect(count(db, 'rules')).toBe(4)
  })

  it('uses whole-word rules when the search was whole-word', async () => {
    const r = await callChannel<FinderSaveRulesResult>('categoryFinder.saveRules', { category: 'Food', keywords: ['tea'], wholeWord: true })
    expect(r.created[0].matchType).toBe('word')
  })

  it('saved rules are picked up by the import pipeline helpers (loadCompiledRules) in priority order', async () => {
    await callChannel('categoryFinder.saveRules', { category: 'Food', keywords: ['Tea', 'Lunch'] })
    const compiled = loadCompiledRules()
    expect(compiled).toHaveLength(2)
    expect(firstMatchingRule(LONG_UPI, compiled)?.rule.thenText).toBe('Food')
    expect(firstMatchingRule('ELECTRICITY BILL', compiled)).toBeNull()
  })

  it('rejects an unknown category and an empty keyword list', async () => {
    await expect(callChannel('categoryFinder.saveRules', { category: 'Nope', keywords: ['a'] })).rejects.toThrow(/does not exist/)
    await expect(callChannel('categoryFinder.saveRules', { category: 'Food', keywords: [] })).rejects.toThrow()
  })

  it('every contract method of this namespace has a handler', () => {
    expect(missingHandlers().filter((c) => /^(categoryFinder|rules)\./.test(c))).toEqual([])
  })
})

describe('performance (100,000 transactions)', () => {
  it('searches 100k transactions in under 3 seconds and pages without loading everything', async () => {
    const rows = []
    for (let i = 0; i < 100_000; i++) {
      const day = (i % 28) + 1
      const date = `2026-${String((i % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const merchant =
        i % 25 === 0
          ? `UPI-PAYEE ${i}-9578379800-${i}@YBL-CIUB0000476-${600000000000 + i}-LUNCHUPI-REF${i}`
          : i % 40 === 0
            ? `TEA-${i} STALL`
            : `GENERIC MERCHANT ${i} ONLINE PURCHASE`
      rows.push({
        date, merchant, amount: 10 + (i % 500), type: 'expense' as const, account: 'Main Checking', source: 'csv',
        fingerprint: baseFingerprint(date, merchant, 10 + (i % 500), 'Main Checking')
      })
    }
    insertBatch(rows)
    expect(count(db, 'transactions')).toBe(100_000)

    const t0 = performance.now()
    const s = await search('Food', KEYWORDS)
    const elapsed = performance.now() - t0
    console.info(`[perf] Category Finder search over 100,000 transactions: ${Math.round(elapsed)} ms`)
    expect(s.scanned).toBe(100_000)
    expect(s.total).toBe(6000) // every 25th row (LUNCHUPI) + every 40th row that is not also a 25th (TEA)
    expect(elapsed).toBeLessThan(3000)

    const p = await page(s.sessionId, 5, 100)
    expect(p.rows).toHaveLength(100)
    expect(p.rows.every((r) => r.hits.length > 0)).toBe(true)

    // selection operations over 6,000 (and in general 100k) matches stay instant
    const t1 = performance.now()
    await callChannel('categoryFinder.select', { sessionId: s.sessionId, op: 'invert' })
    await callChannel('categoryFinder.select', { sessionId: s.sessionId, op: 'invert' })
    expect(performance.now() - t1).toBeLessThan(500)

    const t2 = performance.now()
    const res = await apply(s.sessionId)
    expect(performance.now() - t2).toBeLessThan(3000)
    expect(res).toMatchObject({ changed: 6000, notSelected: 0 })
    expect(db.scalar<number>("SELECT COUNT(*) FROM transactions WHERE category = 'Food'")).toBe(6000)
    expect(count(db, 'transactions')).toBe(100_000)
  }, 120_000)
})
