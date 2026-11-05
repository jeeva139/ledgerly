// Budgets & Goals — API contracts. Both are stored in the SQLite `settings` table.
import type { Budget, Goal } from '../types'

// ---------------------------------------------------------------- budgets

export type BudgetState = 'on-track' | 'near-limit' | 'over' | 'inactive'

/** A budget measured against real spending in one calendar month. */
export interface BudgetProgress extends Budget {
  /** "YYYY-MM" the figures below refer to. */
  month: string
  /** Expenses in this category (and its subcategories) that month — transfers excluded. */
  spent: number
  /** limit − spent; negative when over budget. */
  remaining: number
  /** spent / limit × 100 (not capped, 1 decimal). */
  percent: number
  state: BudgetState
  transactionCount: number
}

export interface BudgetHealth {
  month: string
  /** Active budgets only. */
  activeCount: number
  totalLimit: number
  totalSpent: number
  onTrack: number
  /** 80 % or more of the limit used. */
  nearLimit: number
  over: number
}

export interface BudgetsListResult {
  month: string
  budgets: BudgetProgress[]
  health: BudgetHealth
}

export interface BudgetsApi {
  /** `month` is "YYYY-MM"; defaults to the current month. */
  list(input?: { month?: string }): Promise<BudgetsListResult>
  create(input: { category: string; monthlyLimit: number; active?: boolean }): Promise<Budget>
  update(input: { id: string; category?: string; monthlyLimit?: number; active?: boolean }): Promise<Budget>
  delete(input: { id: string }): Promise<void>
}
export const budgetsMethods = { list: 1, create: 1, update: 1, delete: 1 } satisfies Record<keyof BudgetsApi, 1>

// ---------------------------------------------------------------- goals

export type GoalStatus = 'completed' | 'overdue' | 'due-soon' | 'active'

export interface GoalProgress extends Goal {
  remaining: number
  /** currentAmount / targetAmount × 100 (not capped, 1 decimal). */
  percent: number
  completed: boolean
  /** Days until the due date (negative = overdue); null when there is no due date. */
  daysLeft: number | null
  status: GoalStatus
}

export interface GoalInput {
  name: string
  targetAmount: number
  currentAmount?: number
  dueDate?: string | null
  note?: string
}

export interface GoalsApi {
  list(): Promise<GoalProgress[]>
  create(input: GoalInput): Promise<Goal>
  update(input: Partial<GoalInput> & { id: string }): Promise<Goal>
  /** Quick "update saved amount". */
  setSaved(input: { id: string; currentAmount: number }): Promise<Goal>
  delete(input: { id: string }): Promise<void>
}
export const goalsMethods = { list: 1, create: 1, update: 1, setSaved: 1, delete: 1 } satisfies Record<keyof GoalsApi, 1>
