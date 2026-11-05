import type { Transaction, TxnType } from '../types'

export type TxnSortField = 'date' | 'merchant' | 'category' | 'account' | 'amount' | 'type'
export interface TxnSort {
  field: TxnSortField
  dir: 'asc' | 'desc'
}

/** Filters shared by listing, bulk selection and export. All optional; omitted = no restriction. */
export interface TransactionFilters {
  /** Case-insensitive; every word must appear somewhere in merchant, memo, category, tags, account or reference. */
  search?: string
  /** Inclusive YYYY-MM-DD bounds. */
  dateFrom?: string | null
  dateTo?: string | null
  /** Exact account names (any of). */
  accounts?: string[]
  /** Category names (any of). A parent category also matches its subcategories. */
  categories?: string[]
  /** Tag names (any of, case-insensitive). */
  tags?: string[]
  type?: TxnType | 'all'
  /** Default 'all'. */
  transfers?: 'all' | 'only' | 'exclude'
  /** Shortcut for category = "Needs review". */
  needsReview?: boolean
}

export interface TransactionListInput extends TransactionFilters {
  /** 1-based. */
  page: number
  pageSize: number
  sort?: TxnSort
}

export interface TransactionTotals {
  income: number
  expense: number
  /** Number of non-transfer transactions included in income / expense. */
  count: number
}

export interface TransactionListResult {
  rows: Transaction[]
  /** All rows matching the filters (including transfers). */
  total: number
  /** Income / expense over the whole filtered set; transfers are never counted. */
  totals: TransactionTotals
}

/** Which transactions a bulk operation applies to. */
export type TransactionSelection =
  | { ids: string[] }
  /** "Select all N matching": everything the filters match, except `exceptIds`. */
  | { filters: TransactionFilters; exceptIds?: string[] }

export interface CreateTransactionInput {
  date: string
  merchant: string
  memo?: string
  /** Must exist in the managed list unless `createCategoryIfMissing` is set. Default "Needs review". */
  category?: string
  createCategoryIfMissing?: boolean
  amount: number
  type: TxnType
  account?: string
  tags?: string[]
  /** An already-stored document to link as the receipt. */
  receiptDocumentId?: string | null
  /** Keep the new entry even if an identical one (same date, merchant, amount, account) exists. */
  allowDuplicate?: boolean
}

export interface UpdateTransactionPatch {
  date?: string
  merchant?: string
  memo?: string
  category?: string
  amount?: number
  type?: TxnType
  account?: string
  tags?: string[]
  isTransfer?: boolean
}

export interface CreateTransferInput {
  date: string
  amount: number
  fromAccount: string
  toAccount: string
  memo?: string
  allowDuplicate?: boolean
}

export type ExportFormat = 'csv' | 'xlsx' | 'qif'

export interface ExportInput {
  format: ExportFormat
  filters?: TransactionFilters
}

export interface ExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean
  count: number
  fileName: string | null
}

export interface TransactionFilterOptions {
  accounts: string[]
  categories: string[]
  tags: string[]
}

export interface TransactionsApi {
  list(input: TransactionListInput): Promise<TransactionListResult>
  get(input: { id: string }): Promise<Transaction>
  create(input: CreateTransactionInput): Promise<Transaction>
  /** Editing the date / merchant / amount / account keeps duplicate protection (DUPLICATE unless `allowDuplicate`). */
  update(input: { id: string; patch: UpdateTransactionPatch; allowDuplicate?: boolean; createCategoryIfMissing?: boolean }): Promise<Transaction>
  delete(input: { id: string }): Promise<void>
  deleteMany(input: { selection: TransactionSelection }): Promise<{ deleted: number }>
  /** Manual categorisation: sets the category and locks it against routine rule runs. Saved immediately. */
  setCategory(input: { selection: TransactionSelection; category: string; createIfMissing?: boolean }): Promise<{ updated: number; category: string }>
  addTags(input: { selection: TransactionSelection; tags: string[] }): Promise<{ updated: number }>
  /** Replace the tags of one transaction (tags are created on the fly; a tag needs only a name). */
  setTags(input: { id: string; tags: string[] }): Promise<Transaction>
  /** Transfers never count as income, spending or savings. */
  markTransfer(input: { selection: TransactionSelection; isTransfer: boolean }): Promise<{ updated: number }>
  /** Account-to-account transfer: an expense leg on the source and an income leg on the target. */
  createTransfer(input: CreateTransferInput): Promise<{ from: Transaction; to: Transaction }>
  attachReceipt(input: { id: string; documentId: string | null }): Promise<Transaction>
  /** Native "Save as" dialog, then writes the file locally. Never uploads anything. */
  export(input: ExportInput): Promise<ExportResult>
  /** Accounts, categories and tags that can be used in filters (managed ones plus labels on historical rows). */
  listFilterOptions(): Promise<TransactionFilterOptions>
}

export const transactionsMethods = {
  list: 1,
  get: 1,
  create: 1,
  update: 1,
  delete: 1,
  deleteMany: 1,
  setCategory: 1,
  addTags: 1,
  setTags: 1,
  markTransfer: 1,
  createTransfer: 1,
  attachReceipt: 1,
  export: 1,
  listFilterOptions: 1
} satisfies Record<keyof TransactionsApi, 1>
