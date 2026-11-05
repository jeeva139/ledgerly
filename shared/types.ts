// Domain types shared by the Electron main process and the React renderer.

export type TxnType = 'expense' | 'income'
export type TxnSource = 'manual' | 'qif' | 'csv' | 'excel' | 'document'

export interface Transaction {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** Visible description / payee / narration. */
  merchant: string
  /** Additional searchable text (QIF memo, CSV narration, reference). */
  memo: string
  category: string
  /** Always a positive magnitude; `type` decides income vs expense. */
  amount: number
  type: TxnType
  account: string
  tags: string[]
  receipt: boolean
  receiptDocId: string | null
  source: string
  /** Account-to-account transfer: excluded from income, spending and savings. */
  isTransfer: boolean
  /** True once the user chose the category by hand — routine rule runs never overwrite it. */
  categoryLocked: boolean
  reference: string
  importId: string | null
  createdAt: string
  updatedAt: string
}

export const NEEDS_REVIEW = 'Needs review'
export const TRANSFER_CATEGORY = 'Transfer'
/** Subcategories are stored as "Parent:Child" (same convention QIF uses). */
export const CATEGORY_SEPARATOR = ':'

export type PeriodId = 'all-time' | 'this-month' | 'last-month' | 'last-3-months' | 'last-6-months' | 'this-year'
export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'all-time', label: 'All time' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-3-months', label: 'Last 3 months' },
  { id: 'last-6-months', label: 'Last 6 months' },
  { id: 'this-year', label: 'This year' }
]

export type AccountType = 'bank' | 'credit-card' | 'cash' | 'wallet' | 'other'
export const ACCOUNT_TYPES: { id: AccountType; label: string }[] = [
  { id: 'bank', label: 'Bank account' },
  { id: 'credit-card', label: 'Credit card' },
  { id: 'cash', label: 'Cash' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'other', label: 'Other' }
]

export interface Account {
  id: string
  name: string
  type: AccountType
  /** Only ever set by the user — never invented. */
  openingBalance: number | null
  active: boolean
}

export type RuleMatchType = 'contains' | 'word' | 'starts_with' | 'equals'
export interface Rule {
  id: string
  /** The keyword / text to look for (case-insensitive). */
  whenText: string
  /** The category to assign. */
  thenText: string
  enabled: boolean
  /** Lower number = evaluated first. */
  priority: number
  matchType: RuleMatchType
  source: 'manual' | 'category-finder'
  createdAt: string
  updatedAt: string
}

export interface Budget {
  id: string
  category: string
  monthlyLimit: number
  active: boolean
  createdAt: string
}

export interface Goal {
  id: string
  name: string
  targetAmount: number
  currentAmount: number
  dueDate: string | null
  note: string
  createdAt: string
}

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
export type ThemeChoice = 'light' | 'dark' | 'system'
export interface Preferences {
  currency: string
  dateFormat: DateFormat
  /** 0 = Sunday, 1 = Monday, 6 = Saturday */
  firstDayOfWeek: 0 | 1 | 6
  theme: ThemeChoice
  startupPage: 'dashboard' | 'last'
  sidebarCollapsed: boolean
}
export const DEFAULT_PREFERENCES: Preferences = {
  currency: 'INR',
  dateFormat: 'DD/MM/YYYY',
  firstDayOfWeek: 1,
  theme: 'light',
  startupPage: 'dashboard',
  sidebarCollapsed: false
}

export interface ImportPreferences {
  /** Identical rows inside one file are real repeats (e.g. two identical purchases). */
  keepRepeatedRows: boolean
  /** Saved rules may replace a category that came from the file. Off by default. */
  rulesOverrideImported: boolean
  /** Add categories found in an imported file to the managed category list. */
  addNewCategories: boolean
}
export const DEFAULT_IMPORT_PREFERENCES: ImportPreferences = {
  keepRepeatedRows: true,
  rulesOverrideImported: false,
  addNewCategories: true
}

export interface DetectionPreferences {
  recurring: boolean
  subscriptions: boolean
}
export const DEFAULT_DETECTION_PREFERENCES: DetectionPreferences = { recurring: true, subscriptions: true }

export interface NetWorthState {
  configured: boolean
  assets: number
  liabilities: number
}

export interface TagUsage {
  name: string
  count: number
  createdAt: string
}

export type DocumentStatus = 'stored' | 'review' | 'queued'
export type DocumentSource = 'upload' | 'import'
export type DocumentKind = 'receipt' | 'invoice' | 'statement' | 'spreadsheet' | 'other'
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

export interface DocumentRecord {
  id: string
  filename: string
  mimeType: string
  size: number
  status: DocumentStatus
  source: DocumentSource
  kind: DocumentKind
  /** Optional free text note shown with the document. */
  note: string
  /** Locally extracted suggestion (never invented). null when nothing could be extracted. */
  extracted: DocumentExtraction | null
  createdAt: string
  updatedAt: string
}

export interface DocumentExtraction {
  merchant: string | null
  date: string | null
  amount: number | null
  type: TxnType | null
  category: string | null
  /** Human-readable note, e.g. "Automatic text extraction is unavailable for this document." */
  message: string
}

/** Everything the UI needs at start-up. Never contains transaction rows. */
export interface BootstrapState {
  appVersion: string
  categories: string[]
  accounts: Account[]
  tags: string[]
  preferences: Preferences
  selectedPeriod: PeriodId
  netWorth: NetWorthState
  freshStart: boolean
  lock: { enabled: boolean; locked: boolean }
  counts: { transactions: number; documents: number }
  dataLocation: string
}

/** Configuration definitions only — these never create financial records or balances. */
export const STARTER_CATEGORIES: string[] = [
  'Housing',
  'Groceries',
  'Shopping',
  'Dining',
  'Transportation',
  'Utilities',
  'Subscriptions',
  'Insurance',
  'Health',
  'Entertainment',
  'Income',
  NEEDS_REVIEW,
  'Other'
]

export const STARTER_ACCOUNT_DEFS: { name: string; type: AccountType }[] = [
  { name: 'Main Checking', type: 'bank' },
  { name: 'Everyday Visa', type: 'credit-card' },
  { name: 'Rewards Card', type: 'credit-card' },
  { name: 'Cash', type: 'cash' }
]

export function isSubcategory(name: string): boolean {
  return name.includes(CATEGORY_SEPARATOR)
}
export function topLevelCategory(name: string): string {
  const i = name.indexOf(CATEGORY_SEPARATOR)
  return i < 0 ? name : name.slice(0, i)
}
/** "Food:Dining" → "Food › Dining" for display. */
export function categoryLabel(name: string): string {
  return name.split(CATEGORY_SEPARATOR).map((s) => s.trim()).join(' › ')
}
