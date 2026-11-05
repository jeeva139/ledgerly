// Rules — API contract.
// Saved rules categorise FUTURE imports (first matching rule wins). Existing transactions are only
// touched by the explicit "Bulk recategorize" tool, after a preview and a confirmation.
import type { Rule, RuleMatchType } from '../types'

export type RulesOrderMode = 'auto' | 'manual'

export interface RulesListResult {
  /** In evaluation order (explicit priority, ties → earlier-created). */
  rules: Rule[]
  /** auto = most specific first (maintained automatically); manual = the user reordered rules by hand. */
  orderMode: RulesOrderMode
}

export interface RuleInput {
  /** Keyword / text to look for (case-insensitive, no regular expressions). */
  whenText: string
  /** Category to assign (must exist). */
  thenText: string
  matchType?: RuleMatchType
  enabled?: boolean
}

export interface RecategorizeOptions {
  /** Also re-evaluate transactions that already have a category other than "Needs review". */
  includeCategorized: boolean
  /** Also overwrite categories the user chose by hand. */
  includeLocked: boolean
}

export interface RecategorizeSample {
  id: string
  date: string
  text: string
  from: string
  to: string
  /** The rule's keyword that matched. */
  rule: string
}

export interface RecategorizePreview {
  /** Enabled rules that were evaluated. */
  rulesEnabled: number
  scanned: number
  wouldChange: number
  /** Manually categorized rows left alone (0 when includeLocked is on). */
  skippedLocked: number
  /** Already-categorized rows left alone (0 when includeCategorized is on). */
  skippedCategorized: number
  byCategory: { category: string; count: number }[]
  samples: RecategorizeSample[]
}

export interface RulesApi {
  list(): Promise<RulesListResult>
  create(input: RuleInput): Promise<Rule>
  update(input: { id: string } & Partial<RuleInput>): Promise<Rule>
  delete(input: { id: string }): Promise<void>
  setEnabled(input: { id: string; enabled: boolean }): Promise<Rule>
  /** Swap with the neighbour; switches the order mode to "manual". */
  move(input: { id: string; direction: 'up' | 'down' }): Promise<RulesListResult>
  /** Most specific rule first; ties → earlier-created. Switches the order mode back to "auto". */
  sortBySpecificity(): Promise<RulesListResult>
  /** Dry run of the bulk re-categorisation. Changes nothing. */
  recategorizePreview(input: RecategorizeOptions): Promise<RecategorizePreview>
  /** Re-run the saved rules over existing transactions (explicit, user-confirmed). */
  recategorizeApply(input: RecategorizeOptions): Promise<{ changed: number }>
}

export const rulesMethods = {
  list: 1,
  create: 1,
  update: 1,
  delete: 1,
  setEnabled: 1,
  move: 1,
  sortBySpecificity: 1,
  recategorizePreview: 1,
  recategorizeApply: 1
} satisfies Record<keyof RulesApi, 1>
