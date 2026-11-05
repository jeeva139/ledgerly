// Internal types of the import engine (not part of the renderer contract).
import type { TxnType } from '../../shared/types'

export type Cell = string | number | null

export interface QifRecord {
  section: string
  date: string
  amount: string
  payee: string
  memo: string
  category: string
  number: string
  cleared: string
  splitCategories: string[]
  line: number
}

export interface ParsedQif {
  kind: 'qif'
  records: QifRecord[]
  /** Type of the first transaction section, e.g. "Bank", "CCard". */
  accountType: string | null
  accountNames: string[]
  skippedRecords: number
  skippedSections: string[]
  encoding: string
}

export interface ParsedTable {
  kind: 'table'
  format: 'csv' | 'excel'
  sheets: string[]
  sheet: string | null
  /** Every non-empty row of the file; cells are text or numbers (Excel dates already converted to YYYY-MM-DD). */
  rows: Cell[][]
  delimiter?: string
  encoding?: string
}

export type ParsedFile = ParsedQif | ParsedTable

export interface NormRow {
  /** 1-based position among the records of the file. */
  seq: number
  date: string | null
  rawDate: string
  merchant: string
  memo: string
  /** Positive magnitude (0 for invalid rows). */
  amount: number
  type: TxnType
  /** Category text from the file ('' = none). */
  category: string
  /** Account text from the file ('' = use the chosen account). */
  account: string
  isTransfer: boolean
  reference: string
  /** Why the row cannot be imported. */
  issue: string | null
  // ---- filled by the pipeline ----
  finalCategory: string
  categorySource: 'file' | 'rule' | 'transfer' | 'none'
  fingerprint: string
  status: 'new' | 'duplicate' | 'invalid'
  dupReason: '' | 'existing' | 'in-file'
  repeated: boolean
}
