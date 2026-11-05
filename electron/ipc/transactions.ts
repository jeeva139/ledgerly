// Transactions — IPC handlers (channel names: transactions.<method>).
import { z } from 'zod'
import { handle } from './register'
import { idSchema, isoDate, optionalText, positiveAmount, shortText, txnType } from './schemas'
import * as svc from '../services/transactions'
import { exportTransactions } from '../exports/transactionsExport'

const nameList = z.array(z.string().trim().min(1).max(200)).max(200)

const filtersSchema = z.object({
  search: z.string().max(300).optional(),
  dateFrom: isoDate.nullish(),
  dateTo: isoDate.nullish(),
  accounts: nameList.optional(),
  categories: nameList.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  type: z.enum(['all', 'expense', 'income']).optional(),
  transfers: z.enum(['all', 'only', 'exclude']).optional(),
  needsReview: z.boolean().optional()
})

const selectionSchema = z.union([
  z.object({ ids: z.array(idSchema).min(1, 'Select at least one transaction.').max(5000, 'Too many transactions selected at once.') }),
  z.object({ filters: filtersSchema, exceptIds: z.array(idSchema).max(100_000).optional() })
])

const tagsSchema = z.array(z.string().max(60)).max(40)

const listSchema = filtersSchema.extend({
  page: z.number().int().min(1).max(1_000_000),
  pageSize: z.number().int().min(1).max(500),
  sort: z
    .object({
      field: z.enum(['date', 'merchant', 'category', 'account', 'amount', 'type']),
      dir: z.enum(['asc', 'desc'])
    })
    .optional()
})

const createSchema = z.object({
  date: isoDate,
  merchant: shortText(300, 'Merchant'),
  memo: optionalText(2000),
  category: z.string().trim().max(130).optional(),
  createCategoryIfMissing: z.boolean().optional(),
  amount: positiveAmount,
  type: txnType,
  account: z.string().trim().max(60).optional(),
  tags: tagsSchema.optional(),
  receiptDocumentId: idSchema.nullish(),
  allowDuplicate: z.boolean().optional()
})

const patchSchema = z.object({
  date: isoDate.optional(),
  merchant: shortText(300, 'Merchant').optional(),
  memo: optionalText(2000),
  category: z.string().trim().min(1, 'Choose a category.').max(130).optional(),
  amount: positiveAmount.optional(),
  type: txnType.optional(),
  account: z.string().trim().min(1, 'Choose an account.').max(60).optional(),
  tags: tagsSchema.optional(),
  isTransfer: z.boolean().optional()
})

export function registerTransactionsIpc(): void {
  handle('transactions.list', listSchema, (input) => svc.listTransactions(input))
  handle('transactions.get', z.object({ id: idSchema }), ({ id }) => svc.getTransaction(id))
  handle('transactions.create', createSchema, (input) => svc.createTransaction(input))
  handle(
    'transactions.update',
    z.object({ id: idSchema, patch: patchSchema, allowDuplicate: z.boolean().optional(), createCategoryIfMissing: z.boolean().optional() }),
    ({ id, patch, allowDuplicate, createCategoryIfMissing }) => svc.updateTransaction(id, patch, { allowDuplicate, createCategoryIfMissing })
  )
  handle('transactions.delete', z.object({ id: idSchema }), ({ id }) => svc.deleteTransaction(id))
  handle('transactions.deleteMany', z.object({ selection: selectionSchema }), ({ selection }) => svc.deleteTransactions(selection))
  handle(
    'transactions.setCategory',
    z.object({ selection: selectionSchema, category: z.string().trim().min(1, 'Choose a category.').max(130), createIfMissing: z.boolean().optional() }),
    ({ selection, category, createIfMissing }) => svc.setCategory(selection, category, createIfMissing)
  )
  handle('transactions.addTags', z.object({ selection: selectionSchema, tags: tagsSchema.min(1, 'Enter a tag name.') }), ({ selection, tags }) =>
    svc.addTags(selection, tags)
  )
  handle('transactions.setTags', z.object({ id: idSchema, tags: tagsSchema }), ({ id, tags }) => svc.setTags(id, tags))
  handle('transactions.markTransfer', z.object({ selection: selectionSchema, isTransfer: z.boolean() }), ({ selection, isTransfer }) =>
    svc.markTransfer(selection, isTransfer)
  )
  handle(
    'transactions.createTransfer',
    z.object({
      date: isoDate,
      amount: positiveAmount,
      fromAccount: shortText(60, 'From account'),
      toAccount: shortText(60, 'To account'),
      memo: optionalText(2000),
      allowDuplicate: z.boolean().optional()
    }),
    (input) => svc.createTransfer(input)
  )
  handle('transactions.attachReceipt', z.object({ id: idSchema, documentId: idSchema.nullable() }), ({ id, documentId }) =>
    svc.attachReceipt(id, documentId)
  )
  handle('transactions.export', z.object({ format: z.enum(['csv', 'xlsx', 'qif']), filters: filtersSchema.optional() }), ({ format, filters }) =>
    exportTransactions(format, filters ?? {})
  )
  handle('transactions.listFilterOptions', z.undefined().or(z.null()), () => svc.listFilterOptions())
}
