// Reusable zod building blocks for IPC input validation.
import { z } from 'zod'
import { isValidISODate } from '../../shared/dates'

export const idSchema = z.string().min(1, 'Missing identifier.').max(100)
export const isoDate = z.string().refine(isValidISODate, 'Please enter a valid date.')
export const positiveAmount = z
  .number({ invalid_type_error: 'Amount must be a number.' })
  .finite('Amount must be a number.')
  .gt(0, 'Amount must be greater than zero.')
  .max(1e12, 'Amount is too large.')
export const nonNegativeAmount = z.number().finite('Enter a valid number.').min(0, 'Amount cannot be negative.').max(1e13, 'Amount is too large.')
export const shortText = (max = 200, label = 'Text') =>
  z.string().trim().min(1, `${label} cannot be empty.`).max(max, `${label} is too long (max ${max} characters).`)
export const optionalText = (max = 2000) => z.string().trim().max(max).optional()
export const txnType = z.enum(['expense', 'income'])
export const periodId = z.enum(['all-time', 'this-month', 'last-month', 'last-3-months', 'last-6-months', 'this-year'])
export const idList = (max = 100_000) => z.array(idSchema).min(1, 'Select at least one item.').max(max)
