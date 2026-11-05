// Offline keyword / rule matching engine.
// Used by Category Finder, saved rules, imports and bulk recategorisation. Pure functions only:
// no I/O, no network, nothing leaves the machine.
import type { Rule, RuleMatchType } from './types'

/** Characters that are neither letters nor digits act as separators. */
const SEP = '[^\\p{L}\\p{N}]'

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Normalise text for display/grouping purposes:
 * lowercase → separators become single spaces → trimmed. ("UPI-LUNCH@YBL" → "upi lunch ybl")
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Searchable text of a transaction: visible merchant plus memo/narration. */
export function searchTextOf(t: { merchant: string; memo?: string }): string {
  return t.memo ? `${t.merchant} ${t.memo}` : t.merchant
}

/**
 * Split user input into independent keywords.
 * "Tea, tea, TEA, Lunch ,, Dosa" → ["Tea", "Lunch", "Dosa"] (trimmed, blanks dropped, case-insensitive de-dupe).
 * Commas are the documented separator; semicolons and new lines are accepted as well.
 */
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(/[,;\n\r]+/)) {
    const kw = raw.trim().replace(/\s+/g, ' ')
    if (!kw) continue
    const key = kw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(kw)
  }
  return out
}

export interface CompiledMatcher {
  keyword: string
  matchType: RuleMatchType
  regex: RegExp
}

/**
 * Compile one keyword into a case-insensitive matcher.
 *
 * - `contains`    substring anywhere ("lunch" matches "UPI-…-LUNCHUPI-…", "TEA-12345", "Briyani@Restaurant")
 * - `word`        like contains, but not glued to letters on either side ("tea" no longer matches "steak";
 *                 digits and punctuation next to the keyword are still fine)
 * - `starts_with` text starts with the keyword (ignoring leading punctuation)
 * - `equals`      whole text equals the keyword (ignoring surrounding punctuation)
 *
 * Multi-word keywords tolerate any separators between the words ("uber eats" matches "UBER-EATS" and "UBEREATS").
 */
export function compileMatcher(keyword: string, matchType: RuleMatchType = 'contains'): CompiledMatcher | null {
  const trimmed = keyword.trim()
  if (!trimmed) return null
  const tokens = trimmed
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(escapeRegex)
  const core = tokens.length ? tokens.join(`${SEP}*`) : escapeRegex(trimmed)
  let source: string
  switch (matchType) {
    case 'word':
      source = `(?<![\\p{L}])${core}(?![\\p{L}])`
      break
    case 'starts_with':
      source = `^${SEP}*${core}`
      break
    case 'equals':
      source = `^${SEP}*${core}${SEP}*$`
      break
    default:
      source = core
  }
  try {
    return { keyword: trimmed, matchType, regex: new RegExp(source, 'iu') }
  } catch {
    return null
  }
}

export function compileKeywords(keywords: string[], matchType: RuleMatchType = 'contains'): CompiledMatcher[] {
  const out: CompiledMatcher[] = []
  for (const k of keywords) {
    const m = compileMatcher(k, matchType)
    if (m) out.push(m)
  }
  return out
}

export interface KeywordHit {
  keyword: string
  /** Offsets into the original (un-normalised) text. */
  start: number
  end: number
}

/** All keywords found in the text, ordered by position. Empty array = no match. */
export function findKeywordHits(text: string, matchers: CompiledMatcher[]): KeywordHit[] {
  const hits: KeywordHit[] = []
  for (const m of matchers) {
    const r = m.regex.exec(text)
    if (r) hits.push({ keyword: m.keyword, start: r.index, end: r.index + r[0].length })
  }
  return hits.sort((a, b) => a.start - b.start)
}

/** First matching keyword only (cheaper than findKeywordHits). */
export function findFirstKeyword(text: string, matchers: CompiledMatcher[]): KeywordHit | null {
  for (const m of matchers) {
    const r = m.regex.exec(text)
    if (r) return { keyword: m.keyword, start: r.index, end: r.index + r[0].length }
  }
  return null
}

/** Shorten a very long narration around a hit so the matched part stays visible. */
export function snippetAround(text: string, start: number, end: number, context = 48): { before: string; match: string; after: string } {
  const from = Math.max(0, start - context)
  const to = Math.min(text.length, end + context)
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, to) + (to < text.length ? '…' : '')
  }
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const MATCH_TYPE_BONUS: Record<RuleMatchType, number> = { equals: 300, starts_with: 200, word: 100, contains: 0 }

/** Higher = more specific (longer keyword, stricter match type). */
export function ruleSpecificity(rule: Pick<Rule, 'whenText' | 'matchType'>): number {
  const len = rule.whenText.replace(/[^\p{L}\p{N}]/gu, '').length
  return (MATCH_TYPE_BONUS[rule.matchType] ?? 0) + len
}

/** Evaluation order = explicit priority, then earlier-created, then id (stable). */
export function sortRulesByPriority<T extends Pick<Rule, 'priority' | 'createdAt' | 'id'>>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

/** "Most specific first; ties → earlier-created first." */
export function sortRulesBySpecificity<T extends Pick<Rule, 'whenText' | 'matchType' | 'createdAt' | 'id'>>(rules: T[]): T[] {
  return [...rules].sort(
    (a, b) => ruleSpecificity(b) - ruleSpecificity(a) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  )
}

export interface CompiledRule {
  rule: Rule
  matcher: CompiledMatcher
}

/** Enabled rules in evaluation order, ready to run against many transactions. */
export function compileRules(rules: Rule[]): CompiledRule[] {
  const out: CompiledRule[] = []
  for (const rule of sortRulesByPriority(rules)) {
    if (!rule.enabled) continue
    const matcher = compileMatcher(rule.whenText, rule.matchType)
    if (matcher) out.push({ rule, matcher })
  }
  return out
}

/** First matching rule in priority order, or null. */
export function firstMatchingRule(text: string, compiled: CompiledRule[]): CompiledRule | null {
  for (const c of compiled) {
    if (c.matcher.regex.test(text)) return c
  }
  return null
}
