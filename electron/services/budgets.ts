// Monthly category budgets. Definitions live in the settings table (K.budgets); every "spent" figure is a
// real SQL aggregate over the user's transactions (expenses only, transfers excluded).
import { getDb } from '../database/db'
import { newId, nowISO } from '../database/ids'
import { K, getSetting, updateSetting } from './settings'
import { canonicalCategory } from './catalog'
import { AppError } from '../../shared/errors'
import { endOfMonth, todayISO } from '../../shared/dates'
import { round2 } from '../../shared/money'
import { CATEGORY_SEPARATOR, type Budget } from '../../shared/types'
import type { BudgetHealth, BudgetProgress, BudgetsListResult, BudgetState } from '../../shared/api/planning'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
/** At or above this share of the limit a budget is flagged as "near limit". */
export const NEAR_LIMIT_PERCENT = 80

export function currentMonth(): string {
  return todayISO().slice(0, 7)
}

function validateMonth(month: string | undefined): string {
  if (month === undefined) return currentMonth()
  if (!MONTH_RE.test(month)) throw new AppError('VALIDATION', 'Choose a valid month.')
  return month
}

function validateLimit(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new AppError('VALIDATION', 'The monthly limit must be greater than zero.')
  if (v > 1e12) throw new AppError('VALIDATION', 'The monthly limit is too large.')
  return round2(v)
}

function resolveCategory(name: string): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw new AppError('VALIDATION', 'Choose a category for this budget.')
  const canonical = canonicalCategory(trimmed)
  if (!canonical) throw new AppError('VALIDATION', `"${trimmed}" is not one of your categories yet. Choose an existing category or create it first.`)
  return canonical
}

export function getBudgets(): Budget[] {
  return getSetting<Budget[]>(K.budgets, [])
}

const sameCategory = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function createBudget(input: { category: string; monthlyLimit: number; active?: boolean }): Budget {
  const category = resolveCategory(input.category)
  const monthlyLimit = validateLimit(input.monthlyLimit)
  const budget: Budget = { id: newId(), category, monthlyLimit, active: input.active ?? true, createdAt: nowISO() }
  updateSetting<Budget[]>(K.budgets, [], (list) => {
    if (list.some((b) => sameCategory(b.category, category))) {
      throw new AppError('DUPLICATE', `A budget for "${category.replace(CATEGORY_SEPARATOR, ' › ')}" already exists. Edit it instead.`)
    }
    return [...list, budget]
  })
  return budget
}

export function updateBudget(id: string, patch: { category?: string; monthlyLimit?: number; active?: boolean }): Budget {
  let updated!: Budget
  updateSetting<Budget[]>(K.budgets, [], (list) => {
    const current = list.find((b) => b.id === id)
    if (!current) throw new AppError('NOT_FOUND', 'That budget no longer exists.')
    updated = {
      ...current,
      category: patch.category !== undefined ? resolveCategory(patch.category) : current.category,
      monthlyLimit: patch.monthlyLimit !== undefined ? validateLimit(patch.monthlyLimit) : current.monthlyLimit,
      active: patch.active ?? current.active
    }
    if (list.some((b) => b.id !== id && sameCategory(b.category, updated.category))) {
      throw new AppError('DUPLICATE', `A budget for "${updated.category.replace(CATEGORY_SEPARATOR, ' › ')}" already exists.`)
    }
    return list.map((b) => (b.id === id ? updated : b))
  })
  return updated
}

export function deleteBudget(id: string): void {
  updateSetting<Budget[]>(K.budgets, [], (list) => {
    if (!list.some((b) => b.id === id)) throw new AppError('NOT_FOUND', 'That budget no longer exists.')
    return list.filter((b) => b.id !== id)
  })
}

function stateOf(budget: Budget, percent: number, spent: number): BudgetState {
  if (!budget.active) return 'inactive'
  if (spent > budget.monthlyLimit) return 'over'
  return percent >= NEAR_LIMIT_PERCENT ? 'near-limit' : 'on-track'
}

/** Budgets with spending for one month ("YYYY-MM"; default: the current month). */
export function listBudgets(monthInput?: string): BudgetsListResult {
  const month = validateMonth(monthInput)
  const budgets = getBudgets()
  const from = `${month}-01`
  const to = endOfMonth(from)

  // One aggregate per category; each budget then sums its own category plus its subcategories ("Food:*").
  const spentByCategory = new Map<string, { sum: number; count: number }>()
  if (budgets.length > 0) {
    for (const r of getDb().all<{ category: string; s: number; c: number }>(
      `SELECT category, SUM(amount) AS s, COUNT(*) AS c FROM transactions
        WHERE type = 'expense' AND isTransfer = 0 AND date >= ? AND date <= ?
        GROUP BY category`,
      from,
      to
    )) {
      spentByCategory.set(r.category, { sum: r.s, count: r.c })
    }
  }

  const progress: BudgetProgress[] = budgets.map((b) => {
    let spent = 0
    let count = 0
    const childPrefix = `${b.category}${CATEGORY_SEPARATOR}`
    for (const [cat, v] of spentByCategory) {
      if (cat === b.category || cat.startsWith(childPrefix)) {
        spent += v.sum
        count += v.count
      }
    }
    spent = round2(spent)
    const percent = b.monthlyLimit > 0 ? Math.round((spent / b.monthlyLimit) * 1000) / 10 : 0
    return {
      ...b,
      month,
      spent,
      remaining: round2(b.monthlyLimit - spent),
      percent,
      state: stateOf(b, percent, spent),
      transactionCount: count
    }
  })
  progress.sort((a, b) => a.category.localeCompare(b.category, undefined, { sensitivity: 'base' }))

  const active = progress.filter((p) => p.active)
  const health: BudgetHealth = {
    month,
    activeCount: active.length,
    totalLimit: round2(active.reduce((s, p) => s + p.monthlyLimit, 0)),
    totalSpent: round2(active.reduce((s, p) => s + p.spent, 0)),
    onTrack: active.filter((p) => p.state === 'on-track').length,
    nearLimit: active.filter((p) => p.state === 'near-limit').length,
    over: active.filter((p) => p.state === 'over').length
  }
  return { month, budgets: progress, health }
}
