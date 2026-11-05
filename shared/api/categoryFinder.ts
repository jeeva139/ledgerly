// Category Finder — API contract.
//
// Flow: search (read-only, creates a server-side "finder session" that holds the match ids and the
// user's selection) → page through the preview → adjust selection → apply (the ONLY step that writes)
// → optionally save the keywords as rules. Nothing is modified before `apply`. Matching runs locally
// in the main process; the renderer never receives more than one page of matches.
import type { Rule, TxnType } from '../types'

export interface FinderSearchInput {
  /** Existing (managed) category the matches should be assigned to. */
  category: string
  /** Raw comma-separated keywords, e.g. "Tea, Briyani, Dosa". */
  keywords: string
  /** Match whole words only (so "tea" does not match "steak"). Default: substring match. */
  wholeWord?: boolean
}

export interface FinderKeywordHit {
  keyword: string
  /** Offsets into `FinderRow.text`. */
  start: number
  end: number
}

export interface FinderKeywordCount {
  keyword: string
  count: number
}

export interface FinderSummary {
  sessionId: string
  /** Canonical spelling of the target category. */
  category: string
  /** Cleaned, de-duplicated keywords. */
  keywords: string[]
  wholeWord: boolean
  /** Number of matching transactions. */
  total: number
  /** Number of transactions that were searched. */
  scanned: number
  /** Matches that already carry the target category (unchecked by default). */
  alreadyInCategory: number
  /** Matches whose category was set by hand to something else (unchecked by default). */
  lockedElsewhere: number
  /** Selection size right after the search. */
  selectedCount: number
  perKeyword: FinderKeywordCount[]
}

export interface FinderRow {
  id: string
  date: string
  /** Merchant plus memo/narration — the text that was searched. */
  text: string
  amount: number
  type: TxnType
  account: string
  currentCategory: string
  /** Category was chosen manually (it is protected unless the user selects the row). */
  categoryLocked: boolean
  isTransfer: boolean
  alreadyInCategory: boolean
  selected: boolean
  /** Every keyword found in `text`, ordered by position. */
  hits: FinderKeywordHit[]
}

export interface FinderPage {
  rows: FinderRow[]
  total: number
  page: number
  pageSize: number
  selectedCount: number
}

export type FinderSelectOp = 'all' | 'none' | 'invert' | 'default'

export interface FinderApplyResult {
  category: string
  /** Transactions whose category actually changed. */
  changed: number
  /** Selected transactions that already had the category (they are now protected as manual). */
  alreadyInCategory: number
  /** Matching transactions the user left unselected. */
  notSelected: number
  selected: number
  total: number
}

export interface FinderSaveRulesInput {
  category: string
  keywords: string[]
  wholeWord?: boolean
}

export interface FinderSaveRulesResult {
  created: Rule[]
  skipped: { keyword: string; reason: 'duplicate' | 'conflict'; existingCategory?: string }[]
}

export interface CategoryFinderApi {
  search(input: FinderSearchInput): Promise<FinderSummary>
  page(input: { sessionId: string; page: number; pageSize: number }): Promise<FinderPage>
  /** Select all / none / invert / back to the safe default. */
  select(input: { sessionId: string; op: FinderSelectOp }): Promise<{ selectedCount: number }>
  /** Check or uncheck specific rows (ids from the current page). */
  toggle(input: { sessionId: string; ids: string[]; selected: boolean }): Promise<{ selectedCount: number }>
  /** Assign the category to the selected matches (category only — never amounts, dates, merchants or accounts). */
  apply(input: { sessionId: string }): Promise<FinderApplyResult>
  /** One rule per keyword for future imports. Existing identical rules are skipped. */
  saveRules(input: FinderSaveRulesInput): Promise<FinderSaveRulesResult>
  /** Discard a finder session (the preview). Safe to call with an unknown id. */
  cancel(input: { sessionId: string }): Promise<void>
}

export const categoryFinderMethods = {
  search: 1,
  page: 1,
  select: 1,
  toggle: 1,
  apply: 1,
  saveRules: 1,
  cancel: 1
} satisfies Record<keyof CategoryFinderApi, 1>
