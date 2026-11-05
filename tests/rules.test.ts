import { beforeEach, describe, expect, it } from 'vitest'
import { count, freshDb, LONG_UPI } from './helpers'
import { callChannel, clearHandlersForTests, invokeChannel } from '../electron/ipc/register'
import { registerRulesIpc } from '../electron/ipc/rules'
import { registerCategoryFinderIpc } from '../electron/ipc/categoryFinder'
import { insertTransaction } from '../electron/database/txnStore'
import { addCategory } from '../electron/services/catalog'
import { listRules, loadCompiledRules } from '../electron/services/rulesStore'
import { getSetting, K } from '../electron/services/settings'
import { firstMatchingRule } from '../shared/matching'
import type { Rule } from '../shared/types'
import type { RecategorizePreview, RulesListResult } from '../shared/api/rules'
import type { Db } from '../electron/database/sqlite'

let db: Db

beforeEach(() => {
  db = freshDb()
  clearHandlersForTests()
  registerRulesIpc()
  registerCategoryFinderIpc()
  for (const c of ['Food', 'Transportation2', 'Utilities2']) addCategory({ name: c }) // 'Dining' is a starter category
})

const create = (whenText: string, thenText: string, extra: Record<string, unknown> = {}) =>
  callChannel<Rule>('rules.create', { whenText, thenText, ...extra })
const list = () => callChannel<RulesListResult>('rules.list')
const names = async () => (await list()).rules.map((r) => r.whenText)

const txn = (merchant: string, over: Partial<Parameters<typeof insertTransaction>[0]> = {}) =>
  insertTransaction({ date: '2026-03-01', merchant, amount: 100, type: 'expense', account: 'Cash', source: 'manual', ...over })
const cat = (id: string) => db.scalar<string>('SELECT category FROM transactions WHERE id = ?', id)

describe('rule CRUD & validation', () => {
  it('starts empty (no seeded rules) and creates a rule with sensible defaults', async () => {
    expect(await list()).toEqual({ rules: [], orderMode: 'auto' })
    const r = await create('  Netflix ', 'Food')
    expect(r).toMatchObject({ whenText: 'Netflix', thenText: 'Food', enabled: true, matchType: 'contains', source: 'manual', priority: 1 })
    expect(count(db, 'rules')).toBe(1)
  })

  it('validates keyword and category', async () => {
    await expect(create('   ', 'Food')).rejects.toThrow(/Enter the text/)
    await expect(create('x'.repeat(201), 'Food')).rejects.toThrow()
    await expect(create('tea', '')).rejects.toThrow(/Choose the category/)
    await expect(create('tea', 'Nope')).rejects.toThrow(/does not exist/)
    await expect(create('tea', 'Food', { matchType: 'regex' })).rejects.toThrow()
    expect(count(db, 'rules')).toBe(0)
  })

  it('canonicalises the category spelling', async () => {
    expect((await create('tea', 'food')).thenText).toBe('Food')
  })

  it('refuses a duplicate rule and a clashing keyword, but allows the same text with another match type', async () => {
    await create('tea', 'Food')
    await expect(create(' TEA ', 'Food')).rejects.toThrow(/already exists/)
    await expect(create('tea', 'Dining')).rejects.toThrow(/already assigns "Food"/)
    await create('tea', 'Food', { matchType: 'word' })
    expect(count(db, 'rules')).toBe(2)
  })

  it('updates, enables/disables and deletes', async () => {
    const a = await create('tea', 'Food')
    const b = await create('uber', 'Transportation2')
    const upd = await callChannel<Rule>('rules.update', { id: a.id, whenText: 'chai', thenText: 'Dining', matchType: 'word' })
    expect(upd).toMatchObject({ whenText: 'chai', thenText: 'Dining', matchType: 'word' })
    await expect(callChannel('rules.update', { id: a.id, whenText: 'uber', matchType: 'contains' })).rejects.toThrow(/already exists/)
    expect((await callChannel<Rule>('rules.setEnabled', { id: b.id, enabled: false })).enabled).toBe(false)
    await callChannel('rules.delete', { id: a.id })
    expect(await names()).toEqual(['uber'])
    expect((await list()).rules[0].priority).toBe(1) // gap closed
    await expect(callChannel('rules.delete', { id: a.id })).rejects.toThrow(/no longer exists/)
    await expect(callChannel('rules.update', { id: 'nope', whenText: 'x' })).rejects.toThrow(/no longer exists/)
  })

  it('every method in the contract has a handler', async () => {
    const { missingHandlers } = await import('../electron/ipc')
    expect(missingHandlers().filter((c) => c.startsWith('rules.'))).toEqual([])
  })
})

describe('ordering: auto (most specific first) vs manual', () => {
  it('new rules are inserted by specificity while the order mode is auto', async () => {
    await create('tea', 'Food')
    await create('tea house', 'Dining') // longer → more specific → first
    await create('chai', 'Food') // 4 chars: between
    expect(await names()).toEqual(['tea house', 'chai', 'tea'])
    expect((await list()).rules.map((r) => r.priority)).toEqual([1, 2, 3])
    // the more specific rule wins for overlapping text
    const compiled = loadCompiledRules()
    expect(firstMatchingRule('TEA HOUSE 22', compiled)?.rule.thenText).toBe('Dining')
    expect(firstMatchingRule('hot tea', compiled)?.rule.thenText).toBe('Food')
  })

  it('ties are broken by earlier creation time, even for rules created in the same millisecond', async () => {
    await create('aaa', 'Food')
    await create('bbb', 'Food')
    await create('ccc', 'Food')
    expect(await names()).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('keywords saved together from the Category Finder keep their creation order', async () => {
    await callChannel('categoryFinder.saveRules', { category: 'Dining', keywords: ['k1', 'k2', 'k3', 'k4'] })
    expect(await names()).toEqual(['k1', 'k2', 'k3', 'k4'])
  })

  it('stricter match types are more specific than "contains"', async () => {
    await create('tea', 'Food')
    await create('tea', 'Dining', { matchType: 'equals' })
    expect((await list()).rules.map((r) => r.matchType)).toEqual(['equals', 'contains'])
  })

  it('moving a rule switches to manual mode and new rules are then appended', async () => {
    await create('tea house', 'Dining')
    await create('chai', 'Food')
    await create('tea', 'Food')
    expect(await names()).toEqual(['tea house', 'chai', 'tea'])

    const moved = await callChannel<RulesListResult>('rules.move', { id: (await list()).rules[2].id, direction: 'up' })
    expect(moved.orderMode).toBe('manual')
    expect(moved.rules.map((r) => r.whenText)).toEqual(['tea house', 'tea', 'chai'])
    expect(getSetting(K.rulesOrderMode, 'auto')).toBe('manual')

    await create('longer specific rule', 'Food') // manual mode: appended, not re-sorted
    expect(await names()).toEqual(['tea house', 'tea', 'chai', 'longer specific rule'])

    // edits do not re-sort in manual mode either
    const first = (await list()).rules[0]
    await callChannel('rules.update', { id: first.id, whenText: 'x' })
    expect((await names())[0]).toBe('x')
  })

  it('move is a no-op at the ends and rejects unknown rules', async () => {
    const a = await create('aaaa', 'Food')
    await create('bb', 'Food')
    const top = await callChannel<RulesListResult>('rules.move', { id: a.id, direction: 'up' })
    expect(top.orderMode).toBe('auto') // nothing moved, nothing changed
    expect(top.rules[0].id).toBe(a.id)
    await expect(callChannel('rules.move', { id: 'nope', direction: 'up' })).rejects.toThrow(/no longer exists/)
  })

  it('"Sort by specificity" restores automatic ordering and renumbers priorities', async () => {
    await create('tea', 'Food')
    await create('tea house', 'Dining')
    await callChannel('rules.move', { id: (await list()).rules[0].id, direction: 'down' })
    expect((await list()).orderMode).toBe('manual')
    const sorted = await callChannel<RulesListResult>('rules.sortBySpecificity')
    expect(sorted.orderMode).toBe('auto')
    expect(sorted.rules.map((r) => r.whenText)).toEqual(['tea house', 'tea'])
    expect(sorted.rules.map((r) => r.priority)).toEqual([1, 2])
  })

  it('disabled rules never match but keep their place', async () => {
    const a = await create('tea', 'Food')
    await callChannel('rules.setEnabled', { id: a.id, enabled: false })
    expect(loadCompiledRules()).toHaveLength(0)
    expect(listRules()).toHaveLength(1)
  })

  it('rules match long UPI narrations case-insensitively', async () => {
    await create('LUNCH', 'Food')
    expect(firstMatchingRule(LONG_UPI, loadCompiledRules())?.rule.thenText).toBe('Food')
  })
})

describe('bulk recategorize (explicit, previewed, safe by default)', () => {
  const opts = (over: Partial<{ includeCategorized: boolean; includeLocked: boolean }> = {}) => ({ includeCategorized: false, includeLocked: false, ...over })
  const preview = (o = opts()) => callChannel<RecategorizePreview>('rules.recategorizePreview', o)
  const applyBulk = (o = opts()) => callChannel<{ changed: number }>('rules.recategorizeApply', o)

  const seed = () => {
    const review = txn('Chai tea stall', { amount: 10 })
    const categorized = txn('Hot tea cafe', { amount: 20, category: 'Dining' })
    const locked = txn('Tea garden', { amount: 30, categoryLocked: true }) // Needs review but manual
    const lockedCat = txn('Tea shop two', { amount: 35, category: 'Dining', categoryLocked: true })
    const transfer = txn('Tea transfer', { amount: 40, isTransfer: true })
    const other = txn('Electricity', { amount: 50 })
    return { review, categorized, locked, lockedCat, transfer, other }
  }

  it('preview changes nothing and reports counts, categories and samples', async () => {
    seed()
    await create('tea', 'Food')
    const before = db.all('SELECT id, category, updatedAt FROM transactions ORDER BY id')
    const p = await preview()
    expect(db.all('SELECT id, category, updatedAt FROM transactions ORDER BY id')).toEqual(before)
    expect(p).toMatchObject({ rulesEnabled: 1, wouldChange: 1, skippedLocked: 2, skippedCategorized: 1 })
    expect(p.byCategory).toEqual([{ category: 'Food', count: 1 }])
    expect(p.samples).toHaveLength(1)
    expect(p.samples[0]).toMatchObject({ from: 'Needs review', to: 'Food', rule: 'tea' })
  })

  it('by default only recategorizes unlocked "Needs review" rows and never transfers', async () => {
    const t = seed()
    await create('tea', 'Food')
    expect(await applyBulk()).toEqual({ changed: 1 })
    expect(cat(t.review.id)).toBe('Food')
    expect(cat(t.categorized.id)).toBe('Dining')
    expect(cat(t.locked.id)).toBe('Needs review')
    expect(cat(t.lockedCat.id)).toBe('Dining')
    expect(cat(t.transfer.id)).toBe('Needs review')
    expect(cat(t.other.id)).toBe('Needs review')
  })

  it('"also re-evaluate already categorized" widens the scope but still protects manual rows and transfers', async () => {
    const t = seed()
    await create('tea', 'Food')
    const p = await preview(opts({ includeCategorized: true }))
    expect(p).toMatchObject({ wouldChange: 2, skippedLocked: 2, skippedCategorized: 0 })
    expect(await applyBulk(opts({ includeCategorized: true }))).toEqual({ changed: 2 })
    expect(cat(t.categorized.id)).toBe('Food')
    expect(cat(t.lockedCat.id)).toBe('Dining')
  })

  it('"include manually categorized" lets rules overwrite manual choices only when asked', async () => {
    const t = seed()
    await create('tea', 'Food')
    expect(await applyBulk(opts({ includeLocked: true }))).toEqual({ changed: 2 })
    expect(cat(t.locked.id)).toBe('Food')
    expect(cat(t.lockedCat.id)).toBe('Dining') // already-categorized rows still need the other option
    expect(await applyBulk(opts({ includeLocked: true, includeCategorized: true }))).toEqual({ changed: 2 })
    expect(cat(t.lockedCat.id)).toBe('Food')
    expect(cat(t.categorized.id)).toBe('Food')
  })

  it('only the category (and updatedAt) of matched rows changes; the manual flag is preserved', async () => {
    const t = seed()
    await create('tea', 'Food')
    const before = db.get<Record<string, unknown>>('SELECT * FROM transactions WHERE id = ?', t.review.id)!
    await applyBulk()
    const after = db.get<Record<string, unknown>>('SELECT * FROM transactions WHERE id = ?', t.review.id)!
    for (const col of Object.keys(before)) {
      if (col === 'category' || col === 'updatedAt') continue
      expect(after[col]).toEqual(before[col])
    }
    expect(after.categoryLocked).toBe(0)
  })

  it('uses rule priority: the first matching rule wins', async () => {
    txn('Tea house deluxe', { amount: 77 })
    await create('tea', 'Food')
    await create('tea house', 'Dining')
    await applyBulk()
    expect(db.scalar<string>('SELECT category FROM transactions')).toBe('Dining')
  })

  it('disabled rules are ignored and applying without any enabled rule is refused', async () => {
    txn('Tea stall')
    const r = await create('tea', 'Food')
    await callChannel('rules.setEnabled', { id: r.id, enabled: false })
    expect((await preview()).rulesEnabled).toBe(0)
    await expect(applyBulk()).rejects.toThrow(/no enabled rules/)
    expect(db.scalar<string>('SELECT category FROM transactions')).toBe('Needs review')
  })

  it('is a no-op when nothing matches', async () => {
    txn('Rent')
    await create('tea', 'Food')
    expect(await applyBulk()).toEqual({ changed: 0 })
  })

  it('validates its input', async () => {
    const res = await invokeChannel('rules.recategorizeApply', { includeCategorized: 'yes' })
    expect(res.ok).toBe(false)
  })
})
