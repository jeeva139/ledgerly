// Financial goals. Stored in the settings table (K.goals); progress is derived, never invented.
import { newId, nowISO } from '../database/ids'
import { K, getSetting, updateSetting } from './settings'
import { AppError } from '../../shared/errors'
import { daysBetween, isValidISODate, todayISO } from '../../shared/dates'
import { round2 } from '../../shared/money'
import type { Goal } from '../../shared/types'
import type { GoalInput, GoalProgress, GoalStatus } from '../../shared/api/planning'

/** A goal due within this many days (and not completed) is flagged "due soon". */
export const DUE_SOON_DAYS = 30

export function getGoals(): Goal[] {
  return getSetting<Goal[]>(K.goals, [])
}

function validateName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
  if (!n) throw new AppError('VALIDATION', 'Give your goal a name.')
  if (n.length > 100) throw new AppError('VALIDATION', 'Goal names can be at most 100 characters long.')
  return n
}
function validateTarget(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new AppError('VALIDATION', 'The target amount must be greater than zero.')
  if (v > 1e12) throw new AppError('VALIDATION', 'The target amount is too large.')
  return round2(v)
}
function validateSaved(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new AppError('VALIDATION', 'The saved amount cannot be negative.')
  if (v > 1e13) throw new AppError('VALIDATION', 'The saved amount is too large.')
  return round2(v)
}
function validateDue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !isValidISODate(v)) throw new AppError('VALIDATION', 'Please enter a valid due date.')
  return v
}
function validateNote(v: unknown): string {
  const n = typeof v === 'string' ? v.trim() : ''
  if (n.length > 1000) throw new AppError('VALIDATION', 'Notes can be at most 1,000 characters long.')
  return n
}

export function createGoal(input: GoalInput): Goal {
  const goal: Goal = {
    id: newId(),
    name: validateName(input.name),
    targetAmount: validateTarget(input.targetAmount),
    currentAmount: validateSaved(input.currentAmount ?? 0),
    dueDate: validateDue(input.dueDate),
    note: validateNote(input.note),
    createdAt: nowISO()
  }
  updateSetting<Goal[]>(K.goals, [], (list) => [...list, goal])
  return goal
}

export function updateGoal(id: string, patch: Partial<GoalInput>): Goal {
  let updated!: Goal
  updateSetting<Goal[]>(K.goals, [], (list) => {
    const current = list.find((g) => g.id === id)
    if (!current) throw new AppError('NOT_FOUND', 'That goal no longer exists.')
    updated = {
      ...current,
      name: patch.name !== undefined ? validateName(patch.name) : current.name,
      targetAmount: patch.targetAmount !== undefined ? validateTarget(patch.targetAmount) : current.targetAmount,
      currentAmount: patch.currentAmount !== undefined ? validateSaved(patch.currentAmount) : current.currentAmount,
      dueDate: patch.dueDate !== undefined ? validateDue(patch.dueDate) : current.dueDate,
      note: patch.note !== undefined ? validateNote(patch.note) : current.note
    }
    return list.map((g) => (g.id === id ? updated : g))
  })
  return updated
}

export function setGoalSaved(id: string, currentAmount: number): Goal {
  return updateGoal(id, { currentAmount })
}

export function deleteGoal(id: string): void {
  updateSetting<Goal[]>(K.goals, [], (list) => {
    if (!list.some((g) => g.id === id)) throw new AppError('NOT_FOUND', 'That goal no longer exists.')
    return list.filter((g) => g.id !== id)
  })
}

export function toProgress(goal: Goal, today: string = todayISO()): GoalProgress {
  const remaining = round2(Math.max(0, goal.targetAmount - goal.currentAmount))
  const percent = goal.targetAmount > 0 ? Math.round((goal.currentAmount / goal.targetAmount) * 1000) / 10 : 0
  const completed = goal.currentAmount >= goal.targetAmount
  const daysLeft = goal.dueDate ? daysBetween(today, goal.dueDate) : null
  let status: GoalStatus = 'active'
  if (completed) status = 'completed'
  else if (daysLeft !== null && daysLeft < 0) status = 'overdue'
  else if (daysLeft !== null && daysLeft <= DUE_SOON_DAYS) status = 'due-soon'
  return { ...goal, remaining, percent, completed, daysLeft, status }
}

/** Open goals first (soonest due date first, undated last), completed goals after. */
export function listGoals(today: string = todayISO()): GoalProgress[] {
  return getGoals()
    .map((g) => toProgress(g, today))
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      const da = a.dueDate ?? '9999-12-31'
      const db = b.dueDate ?? '9999-12-31'
      return da.localeCompare(db) || a.createdAt.localeCompare(b.createdAt)
    })
}
