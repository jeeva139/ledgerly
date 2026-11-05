import type { AccountType, TxnType } from '../types'

// =====================================================================================================
// Import (QIF / CSV / Excel) — API contract.
// Workflow: open (file dialog or dropped bytes) → preview (as many times as options change) →
// commit (only after the user confirms). Nothing reaches the database before `commit`.
// Files are read in the main process only; the renderer never sees a file system path.
// =====================================================================================================

export type ImportFormat = 'qif' | 'csv' | 'excel'
export type DateOrder = 'auto' | 'DMY' | 'MDY'
export type SignConvention = 'normal' | 'reverse'

/** Logical columns of a CSV / Excel statement that can be mapped. */
export const MAPPING_FIELDS = ['date', 'description', 'memo', 'amount', 'debit', 'credit', 'drcr', 'category', 'account', 'reference', 'balance'] as const
export type MappingField = (typeof MAPPING_FIELDS)[number]
/** Field → zero-based column index (null = not used). */
export type ColumnMapping = Record<MappingField, number | null>

export const MAPPING_LABELS: Record<MappingField, string> = {
  date: 'Date',
  description: 'Description / narration',
  memo: 'Extra memo (optional)',
  amount: 'Amount (single column)',
  debit: 'Debit / withdrawal',
  credit: 'Credit / deposit',
  drcr: 'Debit-or-credit indicator',
  category: 'Category (optional)',
  account: 'Account (optional)',
  reference: 'Reference (optional)',
  balance: 'Balance (ignored)'
}

export interface ImportOptions {
  /** Account the transactions belong to. An unknown name creates a new account when the import is confirmed. */
  account?: { name: string; type?: AccountType } | null
  /** How to read ambiguous numeric dates such as 03/04/2026. */
  dateFormat?: DateOrder
  /** "reverse" swaps income and expense (e.g. credit-card exports that list charges as positive amounts). */
  signConvention?: SignConvention
  /** CSV/Excel: columns the user chose. Fields not present here use automatic detection. */
  mapping?: Partial<ColumnMapping>
  /** CSV/Excel: 1-based number of the header row; -1 = the file has no header row; null/0 = detect automatically. */
  headerRow?: number | null
  /** Excel: sheet to read. */
  sheet?: string | null
  /** Saved rules may replace a category that came from the file. */
  rulesOverrideImported?: boolean
  /** Add categories found in the file to the managed category list. */
  addNewCategories?: boolean
}

export interface TableInfo {
  sheets: string[]
  sheet: string | null
  /** 1-based header row number; 0 = the file has no header row. */
  headerRow: number
  headers: string[]
  /** First data rows, as display text. */
  sampleRows: string[][]
  dataRowCount: number
  /** Mapping in effect (automatic detection merged with the user's choices). */
  mapping: ColumnMapping
  /** Automatically detected fields Ledgerly is not sure about, with a reason. The user must confirm these. */
  uncertain: Partial<Record<MappingField, string>>
  /** First rows of the file as display text (for picking the header row). */
  topRows: string[][]
}

export interface QifInfo {
  /** e.g. "Bank", "CCard". */
  accountType: string | null
  accountNames: string[]
  skippedRecords: number
  skippedSections: string[]
}

export interface ImportSessionSummary {
  sessionId: string
  filename: string
  format: ImportFormat
  size: number
  table?: TableInfo
  qif?: QifInfo
  /** Starting options (preferences applied). */
  defaults: ImportOptions
  notes: string[]
}

export type PreviewFilter = 'all' | 'new' | 'duplicate' | 'needs-review' | 'invalid'

export interface ImportPreview {
  sessionId: string
  filename: string
  format: ImportFormat
  /** Records found in the file (valid + invalid). */
  detected: number
  valid: number
  incomeCount: number
  incomeTotal: number
  expenseCount: number
  expenseTotal: number
  transferCount: number
  /** Rows that would be added. */
  newCount: number
  /** Rows that already exist (or repeat an earlier row when repeats are not kept). */
  duplicates: number
  /** Identical rows inside the file that are kept as separate transactions. */
  repeatedInFile: number
  /** Rows that would be imported as "Needs review". */
  needsReview: number
  /** Rows that could not be read (bad date, missing amount, footer lines …). */
  invalid: number
  /** Order used for numeric dates; `dateAmbiguous` = the file does not settle it, please confirm. */
  dateOrder: 'DMY' | 'MDY' | null
  dateAmbiguous: boolean
  signHint: string | null
  /** Categories found in the file that are not in the managed list. */
  newCategories: string[]
  /** Account names from the file's account column that do not exist yet. */
  newAccounts: string[]
  account: { name: string; exists: boolean } | null
  table?: TableInfo
  notes: string[]
  /** Reasons the import cannot start yet (all must be resolved). */
  blockers: string[]
  canImport: boolean
}

export interface PreviewRowDto {
  seq: number
  date: string | null
  rawDate: string
  merchant: string
  memo: string
  amount: number | null
  type: TxnType | null
  category: string
  categorySource: 'file' | 'rule' | 'transfer' | 'none'
  account: string
  isTransfer: boolean
  status: 'new' | 'duplicate' | 'invalid'
  /** Why a row is invalid, or "Already imported" / "Repeated row". */
  issue: string | null
  repeated: boolean
  needsReview: boolean
}

export interface PreviewRowsPage {
  rows: PreviewRowDto[]
  total: number
  page: number
  pageSize: number
}

export interface ImportReport {
  importId: string
  filename: string
  format: ImportFormat
  inserted: number
  duplicates: number
  needsReview: number
  /** Invalid / skipped rows. */
  skipped: number
  status: 'complete' | 'partial'
  documentKept: boolean
  addedCategories: string[]
  createdAccounts: string[]
  notes: string[]
}

export interface ImportHistoryEntry {
  id: string
  filename: string
  format: ImportFormat
  account: string
  inserted: number
  duplicates: number
  skipped: number
  needsReview: number
  status: 'complete' | 'partial' | 'undone'
  createdAt: string
  undoneAt: string | null
  documentId: string | null
  /** Transactions from this import still in the database. */
  remaining: number
  /** Of those, how many were edited after the import. */
  edited: number
}

export interface ImportApi {
  /** Native file dialog for a .qif file. Resolves null when the dialog is cancelled. */
  qif(): Promise<ImportSessionSummary | null>
  /** Native file dialog for a .csv file. */
  csv(): Promise<ImportSessionSummary | null>
  /** Native file dialog for .xlsx / .xls. */
  excel(): Promise<ImportSessionSummary | null>
  /** Drag & drop: the renderer hands over the bytes; the format comes from the extension. */
  openBytes(input: { filename: string; bytes: Uint8Array }): Promise<ImportSessionSummary>
  /** (Re)compute the preview for the given options. Nothing is written to the database. */
  preview(input: { sessionId: string; options: ImportOptions }): Promise<ImportPreview>
  previewRows(input: { sessionId: string; filter: PreviewFilter; page: number; pageSize: number }): Promise<PreviewRowsPage>
  /** Insert the previewed transactions. Emits `import:progress` events. */
  commit(input: { sessionId: string; options: ImportOptions }): Promise<ImportReport>
  /** Discard a session (nothing was imported). */
  cancel(input: { sessionId: string }): Promise<void>
  history(): Promise<ImportHistoryEntry[]>
  /** Remove the transactions of one import. */
  undo(input: { importId: string }): Promise<{ removed: number }>
}

export const importMethods = {
  qif: 1, csv: 1, excel: 1, openBytes: 1, preview: 1, previewRows: 1, commit: 1, cancel: 1, history: 1, undo: 1
} satisfies Record<keyof ImportApi, 1>
