import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './helpers'
import type { Db } from '../electron/database/sqlite'
import { insertTransaction } from '../electron/database/txnStore'
import { callChannel, clearHandlersForTests, invokeChannel } from '../electron/ipc/register'
import { registerPlanningIpc } from '../electron/ipc/planning'
import { registerRecurringIpc } from '../electron/ipc/recurring'
import { missingHandlers } from '../electron/ipc'
import { addCategory, renameCategory } from '../electron/services/catalog'
import { toProgress } from '../electron/services/goals'
import { K, getSetting } from '../electron/services/settings'
import { addDays, todayISO } from '../shared/dates'
import type { Budget, Goal } from '../shared/types'
import type { BudgetsListResult, GoalProgress } from '../shared/api/planning'

let db: Db
beforeEach(() => {
  db = freshDb()
  clearHandlersForTests()
  registerPlanningIpc()
  addCategory({ name: 'Food' })
  addCategory({ name: 'Dining', parent: 'Food' })
})

let n = 0
const spend = (category: string, amount: number, date: string, over: Record<string, unknown> = {}) =>
  insertTransaction({ date, merchant: `Shop ${++n}`, amount, type: 'expense', account: 'Cash', category, source: 'manual', ...over })

describe('budgets: CRUD & validation', () => {
  it('creates, lists, edits and deletes budgets (persisted in SQLite settings)', async () => {
    const b = await callChannel<Budget>('budgets.create', { category: 'Groceries', monthlyLimit: 5000 })
    expect(b).toMatchObject({ category: 'Groceries', monthlyLimit: 5000, active: true })
    expect(getSetting<Budget[]>(K.budgets, [])).toHaveLength(1)

    const edited = await callChannel<Budget>('budgets.update', { id: b.id, monthlyLimit: 6000.5, active: false })
    expect(edited).toMatchObject({ monthlyLimit: 6000.5, active: false })

    const list = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-03' })
    expect(list.budgets).toHaveLength(1)
    expect(list.month).toBe('2026-03')

    await callChannel('budgets.delete', { id: b.id })
    expect((await callChannel<BudgetsListResult>('budgets.list')).budgets).toEqual([])
    expect(await invokeChannel('budgets.delete', { id: b.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('guards against a second budget for the same category (case-insensitive)', async () => {
    await callChannel('budgets.create', { category: 'Groceries', monthlyLimit: 5000 })
    expect(await invokeChannel('budgets.create', { category: 'groceries', monthlyLimit: 100 })).toMatchObject({ ok: false, error: { code: 'DUPLICATE' } })
    const other = await callChannel<Budget>('budgets.create', { category: 'Shopping', monthlyLimit: 100 })
    expect(await invokeChannel('budgets.update', { id: other.id, category: 'Groceries' })).toMatchObject({ ok: false, error: { code: 'DUPLICATE' } })
  })

  it('validates category and limit', async () => {
    expect(await invokeChannel('budgets.create', { category: 'Nonexistent', monthlyLimit: 10 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('budgets.create', { category: '', monthlyLimit: 10 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('budgets.create', { category: 'Food', monthlyLimit: 0 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('budgets.create', { category: 'Food', monthlyLimit: -5 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('budgets.create', { category: 'Food', monthlyLimit: 'lots' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await invokeChannel('budgets.list', { month: '2026-13' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(getSetting<Budget[]>(K.budgets, [])).toEqual([])
  })

  it('starts empty (no sample budgets)', async () => {
    expect(await callChannel('budgets.list')).toMatchObject({ budgets: [], health: { activeCount: 0, totalLimit: 0, totalSpent: 0, onTrack: 0, nearLimit: 0, over: 0 } })
  })
})

describe('budgets: spending math', () => {
  it('sums real expenses for the selected month; transfers, income and other months are excluded', async () => {
    await callChannel('budgets.create', { category: 'Groceries', monthlyLimit: 1000 })
    spend('Groceries', 300, '2026-03-02')
    spend('Groceries', 150.5, '2026-03-31')
    spend('Groceries', 999, '2026-02-28') // previous month
    spend('Groceries', 999, '2026-04-01') // next month
    spend('Groceries', 400, '2026-03-10', { isTransfer: true })
    spend('Groceries', 77, '2026-03-11', { type: 'income' }) // refund-like income
    spend('Shopping', 500, '2026-03-12') // other category

    const march = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-03' })
    expect(march.budgets[0]).toMatchObject({ spent: 450.5, remaining: 549.5, percent: 45.1, state: 'on-track', transactionCount: 2, month: '2026-03' })
    const feb = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-02' })
    expect(feb.budgets[0]).toMatchObject({ spent: 999, remaining: 1, state: 'near-limit' })
    const jan = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-01' })
    expect(jan.budgets[0]).toMatchObject({ spent: 0, remaining: 1000, percent: 0, state: 'on-track' })
  })

  it('a parent category budget includes its subcategories; a subcategory budget does not include the parent', async () => {
    await callChannel('budgets.create', { category: 'Food', monthlyLimit: 1000 })
    await callChannel('budgets.create', { category: 'Food:Dining', monthlyLimit: 400 })
    spend('Food', 100, '2026-03-02')
    spend('Food:Dining', 250, '2026-03-03')
    const res = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-03' })
    const food = res.budgets.find((b) => b.category === 'Food')!
    const dining = res.budgets.find((b) => b.category === 'Food:Dining')!
    expect(food.spent).toBe(350)
    expect(dining.spent).toBe(250)
  })

  it('classifies on-track / near-limit / over (not by colour alone) and builds the health summary', async () => {
    for (const [category, limit] of [['Groceries', 1000], ['Shopping', 1000], ['Dining', 1000], ['Health', 1000]] as const) {
      await callChannel('budgets.create', { category, monthlyLimit: limit })
    }
    spend('Groceries', 200, '2026-03-05') // 20 %
    spend('Shopping', 800, '2026-03-05') // 80 % → near limit
    spend('Dining', 1000, '2026-03-05') // exactly 100 % → near limit, not over
    spend('Health', 1250.75, '2026-03-05') // over
    const { budgets, health } = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-03' })
    const state = Object.fromEntries(budgets.map((b) => [b.category, b.state]))
    expect(state).toEqual({ Dining: 'near-limit', Groceries: 'on-track', Health: 'over', Shopping: 'near-limit' })
    expect(budgets.find((b) => b.category === 'Health')).toMatchObject({ remaining: -250.75, percent: 125.1 })
    expect(health).toMatchObject({ activeCount: 4, totalLimit: 4000, totalSpent: 3250.75, onTrack: 1, nearLimit: 2, over: 1 })
  })

  it('inactive budgets are shown but excluded from the health summary', async () => {
    const b = await callChannel<Budget>('budgets.create', { category: 'Groceries', monthlyLimit: 1000, active: false })
    spend('Groceries', 5000, '2026-03-05')
    const { budgets, health } = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-03' })
    expect(budgets[0]).toMatchObject({ id: b.id, state: 'inactive', spent: 5000 })
    expect(health).toMatchObject({ activeCount: 0, totalLimit: 0, totalSpent: 0, over: 0 })
  })

  it('defaults to the current month', async () => {
    await callChannel('budgets.create', { category: 'Groceries', monthlyLimit: 1000 })
    spend('Groceries', 120, todayISO())
    const res = await callChannel<BudgetsListResult>('budgets.list')
    expect(res.month).toBe(todayISO().slice(0, 7))
    expect(res.budgets[0].spent).toBe(120)
  })

  it('renaming a category keeps its budget attached', async () => {
    await callChannel('budgets.create', { category: 'Food', monthlyLimit: 1000 })
    spend('Food', 100, '2026-03-02')
    renameCategory('Food', 'Meals')
    const res = await callChannel<BudgetsListResult>('budgets.list', { month: '2026-03' })
    expect(res.budgets[0]).toMatchObject({ category: 'Meals', spent: 100 })
  })
})

describe('goals', () => {
  it('creates, lists, edits, quick-updates and deletes', async () => {
    const g = await callChannel<Goal>('goals.create', { name: '  Emergency   fund ', targetAmount: 100000, currentAmount: 25000, dueDate: '2030-12-31', note: ' six months ' })
    expect(g).toMatchObject({ name: 'Emergency fund', targetAmount: 100000, currentAmount: 25000, dueDate: '2030-12-31', note: 'six months' })
    expect(getSetting<Goal[]>(K.goals, [])).toHaveLength(1)

    const edited = await callChannel<Goal>('goals.update', { id: g.id, name: 'Rainy day fund', targetAmount: 120000, dueDate: null })
    expect(edited).toMatchObject({ name: 'Rainy day fund', targetAmount: 120000, dueDate: null, currentAmount: 25000 })

    const quick = await callChannel<Goal>('goals.setSaved', { id: g.id, currentAmount: 60000 })
    expect(quick.currentAmount).toBe(60000)

    const [p] = await callChannel<GoalProgress[]>('goals.list')
    expect(p).toMatchObject({ remaining: 60000, percent: 50, completed: false, daysLeft: null, status: 'active' })

    await callChannel('goals.delete', { id: g.id })
    expect(await callChannel('goals.list')).toEqual([])
    expect(await invokeChannel('goals.delete', { id: g.id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('starts empty and defaults the saved amount to zero (nothing invented)', async () => {
    expect(await callChannel('goals.list')).toEqual([])
    const g = await callChannel<Goal>('goals.create', { name: 'Trip', targetAmount: 500 })
    expect(g).toMatchObject({ currentAmount: 0, dueDate: null, note: '' })
  })

  it('validates inputs', async () => {
    const bad = async (input: Record<string, unknown>) => expect(await invokeChannel('goals.create', input)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    await bad({ name: '', targetAmount: 100 })
    await bad({ name: '   ', targetAmount: 100 })
    await bad({ name: 'x', targetAmount: 0 })
    await bad({ name: 'x', targetAmount: -1 })
    await bad({ name: 'x', targetAmount: 100, currentAmount: -5 })
    await bad({ name: 'x', targetAmount: 100, dueDate: '2026-02-30' })
    await bad({ name: 'x', targetAmount: 100, dueDate: 'soon' })
    await bad({ name: 'x'.repeat(101), targetAmount: 100 })
    expect(await invokeChannel('goals.setSaved', { id: 'nope', currentAmount: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await callChannel('goals.list')).toEqual([])
  })

  it('progress maths: remaining, percent, completed, days left, overdue, due soon', () => {
    const base = { id: 'g', name: 'G', note: '', createdAt: '2026-01-01T00:00:00.000Z' }
    const today = '2026-06-15'
    expect(toProgress({ ...base, targetAmount: 1000, currentAmount: 250, dueDate: addDays(today, 100) }, today)).toMatchObject({
      remaining: 750, percent: 25, completed: false, daysLeft: 100, status: 'active'
    })
    expect(toProgress({ ...base, targetAmount: 1000, currentAmount: 333.33, dueDate: addDays(today, 10) }, today)).toMatchObject({
      remaining: 666.67, percent: 33.3, daysLeft: 10, status: 'due-soon'
    })
    expect(toProgress({ ...base, targetAmount: 1000, currentAmount: 100, dueDate: addDays(today, -3) }, today)).toMatchObject({ daysLeft: -3, status: 'overdue' })
    expect(toProgress({ ...base, targetAmount: 1000, currentAmount: 1000, dueDate: addDays(today, -3) }, today)).toMatchObject({ completed: true, status: 'completed', remaining: 0, percent: 100 })
    expect(toProgress({ ...base, targetAmount: 1000, currentAmount: 1500, dueDate: null }, today)).toMatchObject({ completed: true, remaining: 0, percent: 150 })
  })

  it('lists open goals first (soonest due first), completed goals last', async () => {
    const soon = await callChannel<Goal>('goals.create', { name: 'Soon', targetAmount: 100, dueDate: addDays(todayISO(), 20) })
    const later = await callChannel<Goal>('goals.create', { name: 'Later', targetAmount: 100, dueDate: addDays(todayISO(), 200) })
    const undated = await callChannel<Goal>('goals.create', { name: 'Undated', targetAmount: 100 })
    const done = await callChannel<Goal>('goals.create', { name: 'Done', targetAmount: 100, currentAmount: 100, dueDate: addDays(todayISO(), 5) })
    const order = (await callChannel<GoalProgress[]>('goals.list')).map((g) => g.id)
    expect(order).toEqual([soon.id, later.id, undated.id, done.id])
  })
})

describe('IPC coverage for this area', () => {
  it('every declared recurring / subscriptions / budgets / goals method has a handler (including recurring.status)', () => {
    clearHandlersForTests()
    registerRecurringIpc()
    registerPlanningIpc()
    expect(missingHandlers().filter((c) => /^(recurring|subscriptions|budgets|goals)\./.test(c))).toEqual([])
  })

  it('recurring.status reports the detection preferences', async () => {
    clearHandlersForTests()
    registerRecurringIpc()
    expect(await callChannel('recurring.status')).toEqual({ recurringEnabled: true, subscriptionsEnabled: true })
  })
})
