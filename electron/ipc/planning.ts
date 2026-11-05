// Budgets & Goals — IPC handlers.
import { z } from 'zod'
import { handle } from './register'
import { idSchema, isoDate, nonNegativeAmount, positiveAmount, shortText } from './schemas'
import { createBudget, deleteBudget, listBudgets, updateBudget } from '../services/budgets'
import { createGoal, deleteGoal, listGoals, setGoalSaved, updateGoal } from '../services/goals'

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a valid month.')
const category = z.string().trim().min(1, 'Choose a category for this budget.').max(130)

export function registerPlanningIpc(): void {
  // ---- budgets ----
  handle('budgets.list', z.object({ month: month.optional() }).optional(), (input) => listBudgets(input?.month))
  handle('budgets.create', z.object({ category, monthlyLimit: positiveAmount, active: z.boolean().optional() }), (input) => createBudget(input))
  handle(
    'budgets.update',
    z.object({ id: idSchema, category: category.optional(), monthlyLimit: positiveAmount.optional(), active: z.boolean().optional() }),
    ({ id, ...patch }) => updateBudget(id, patch)
  )
  handle('budgets.delete', z.object({ id: idSchema }), ({ id }) => deleteBudget(id))

  // ---- goals ----
  const goalFields = {
    name: shortText(100, 'Goal name'),
    targetAmount: positiveAmount,
    currentAmount: nonNegativeAmount,
    dueDate: isoDate.nullable(),
    note: z.string().max(1000, 'Notes can be at most 1,000 characters long.')
  }
  handle('goals.list', z.undefined().or(z.null()), () => listGoals())
  handle(
    'goals.create',
    z.object({ name: goalFields.name, targetAmount: goalFields.targetAmount, currentAmount: goalFields.currentAmount.optional(), dueDate: goalFields.dueDate.optional(), note: goalFields.note.optional() }),
    (input) => createGoal(input)
  )
  handle(
    'goals.update',
    z.object({
      id: idSchema,
      name: goalFields.name.optional(),
      targetAmount: goalFields.targetAmount.optional(),
      currentAmount: goalFields.currentAmount.optional(),
      dueDate: goalFields.dueDate.optional(),
      note: goalFields.note.optional()
    }),
    ({ id, ...patch }) => updateGoal(id, patch)
  )
  handle('goals.setSaved', z.object({ id: idSchema, currentAmount: nonNegativeAmount }), ({ id, currentAmount }) => setGoalSaved(id, currentAmount))
  handle('goals.delete', z.object({ id: idSchema }), ({ id }) => deleteGoal(id))
}
