// Saved categorisation rules: CRUD, ordering and the explicit bulk re-categorisation tool.
//
// Ordering model
//  - Every rule has an explicit `priority` (1 = evaluated first). The first matching rule wins.
//  - Order mode "auto" (default): after every change rules are re-sorted most-specific-first
//    (ties → earlier-created). Order mode "manual": the user moved a rule by hand, priorities are left alone
//    and new rules are appended. "Sort by specificity" returns to auto.
import { getDb } from '../database/db'
import { newId, nowISO } from '../database/ids'
import { K, getSetting, setSetting } from './settings'
import { canonicalCategory } from './catalog'
import { RULE_COLUMNS, listRules, loadCompiledRules, rowToRule, type RuleRow } from './rulesStore'
import { AppError } from '../../shared/errors'
import { firstMatchingRule, searchTextOf, sortRulesBySpecificity } from '../../shared/matching'
import { NEEDS_REVIEW, type Rule, type RuleMatchType } from '../../shared/types'
import type { RecategorizeOptions, RecategorizePreview, RecategorizeSample, RuleInput, RulesListResult, RulesOrderMode } from '../../shared/api/rules'

const MATCH_TYPES: RuleMatchType[] = ['contains', 'word', 'starts_with', 'equals']
export const MAX_KEYWORD_LENGTH = 200

export function getOrderMode(): RulesOrderMode {
  return getSetting<string>(K.rulesOrderMode, 'auto') === 'manual' ? 'manual' : 'auto'
}

function setOrderMode(mode: RulesOrderMode): void {
  setSetting(K.rulesOrderMode, mode)
}

export function listRulesView(): RulesListResult {
  return { rules: listRules(), orderMode: getOrderMode() }
}

// ---- validation -----------------------------------------------------------------------------

export function cleanKeyword(raw: string): string {
  const k = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!k) throw new AppError('VALIDATION', 'Enter the text this rule should look for.')
  if (k.length > MAX_KEYWORD_LENGTH) throw new AppError('VALIDATION', `The rule text can be at most ${MAX_KEYWORD_LENGTH} characters long.`)
  return k
}

function cleanMatchType(t: unknown): RuleMatchType {
  if (t === undefined) return 'contains'
  if (!MATCH_TYPES.includes(t as RuleMatchType)) throw new AppError('VALIDATION', 'Choose how the text should be matched.')
  return t as RuleMatchType
}

function requireCategory(raw: string): string {
  const name = (raw ?? '').trim()
  if (!name) throw new AppError('VALIDATION', 'Choose the category this rule should assign.')
  const canonical = canonicalCategory(name)
  if (!canonical) throw new AppError('VALIDATION', `The category "${name}" does not exist. Choose an existing category or create it first.`)
  return canonical
}

const keywordKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Strictly increasing timestamps, so rules created in the same millisecond still have a defined "earlier-created" order. */
let lastStamp = 0
function stamp(): string {
  const t = Math.max(Date.now(), lastStamp + 1)
  lastStamp = t
  return new Date(t).toISOString()
}

function getRule(id: string): Rule {
  const row = getDb().get<RuleRow>(`SELECT ${RULE_COLUMNS} FROM rules WHERE id = ?`, id)
  if (!row) throw new AppError('NOT_FOUND', 'That rule no longer exists.')
  return rowToRule(row)
}

// ---- ordering -------------------------------------------------------------------------------

/** Rewrite priorities as 1..n following the given id order. */
function renumber(orderedIds: string[]): void {
  const db = getDb()
  orderedIds.forEach((id, i) => {
    db.run('UPDATE rules SET priority = ? WHERE id = ? AND priority <> ?', i + 1, id, i + 1)
  })
}

function resortBySpecificity(): void {
  renumber(sortRulesBySpecificity(listRules()).map((r) => r.id))
}

function nextPriority(): number {
  return (getDb().scalar<number>('SELECT COALESCE(MAX(priority), 0) FROM rules') ?? 0) + 1
}

// ---- CRUD -----------------------------------------------------------------------------------

function findSameKeyword(whenText: string, matchType: RuleMatchType, excludeId?: string): Rule | undefined {
  const key = keywordKey(whenText)
  return listRules().find((r) => r.id !== excludeId && r.matchType === matchType && keywordKey(r.whenText) === key)
}

export function createRule(input: RuleInput & { source?: Rule['source'] }): Rule {
  const whenText = cleanKeyword(input.whenText)
  const thenText = requireCategory(input.thenText)
  const matchType = cleanMatchType(input.matchType)
  const existing = findSameKeyword(whenText, matchType)
  if (existing) {
    throw new AppError(
      'DUPLICATE',
      existing.thenText === thenText
        ? 'This rule already exists.'
        : `A rule for "${existing.whenText}" already assigns "${existing.thenText}". Edit that rule instead.`
    )
  }
  const db = getDb()
  const id = newId()
  const now = stamp()
  db.transaction(() => {
    db.run(
      `INSERT INTO rules (id, whenText, thenText, enabled, priority, matchType, source, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, whenText, thenText, input.enabled === false ? 0 : 1, nextPriority(), matchType, input.source ?? 'manual', now, now
    )
    if (getOrderMode() === 'auto') resortBySpecificity()
  })
  return getRule(id)
}

export function updateRule(id: string, patch: Partial<RuleInput>): Rule {
  const current = getRule(id)
  const whenText = patch.whenText !== undefined ? cleanKeyword(patch.whenText) : current.whenText
  const thenText = patch.thenText !== undefined && patch.thenText !== current.thenText ? requireCategory(patch.thenText) : current.thenText
  const matchType = patch.matchType !== undefined ? cleanMatchType(patch.matchType) : current.matchType
  const enabled = patch.enabled ?? current.enabled
  const clash = findSameKeyword(whenText, matchType, id)
  if (clash) {
    throw new AppError('DUPLICATE', `A rule for "${clash.whenText}" (${clash.thenText}) already exists. Edit that rule instead.`)
  }
  const db = getDb()
  db.transaction(() => {
    db.run('UPDATE rules SET whenText = ?, thenText = ?, matchType = ?, enabled = ?, updatedAt = ? WHERE id = ?',
      whenText, thenText, matchType, enabled ? 1 : 0, nowISO(), id)
    if (getOrderMode() === 'auto') resortBySpecificity()
  })
  return getRule(id)
}

export function setRuleEnabled(id: string, enabled: boolean): Rule {
  getRule(id)
  getDb().run('UPDATE rules SET enabled = ?, updatedAt = ? WHERE id = ?', enabled ? 1 : 0, nowISO(), id)
  return getRule(id)
}

export function deleteRule(id: string): void {
  const db = getDb()
  getRule(id)
  db.transaction(() => {
    db.run('DELETE FROM rules WHERE id = ?', id)
    renumber(listRules().map((r) => r.id)) // keep the existing order, close the gap
  })
}

export function moveRule(id: string, direction: 'up' | 'down'): RulesListResult {
  const db = getDb()
  getRule(id)
  db.transaction(() => {
    const ids = listRules().map((r) => r.id)
    const i = ids.indexOf(id)
    const j = direction === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    renumber(ids)
    setOrderMode('manual')
  })
  return listRulesView()
}

export function sortBySpecificity(): RulesListResult {
  getDb().transaction(() => {
    resortBySpecificity()
    setOrderMode('auto')
  })
  return listRulesView()
}

// ---- rules from Category Finder keywords ---------------------------------------------------

export interface CreateFromKeywordsResult {
  created: Rule[]
  skipped: { keyword: string; reason: 'duplicate' | 'conflict'; existingCategory?: string }[]
}

/**
 * One rule per keyword. A keyword that already has an identical rule is skipped; if an existing rule for the
 * same keyword assigns a *different* category it is also skipped (reported as a conflict) so that the older
 * rule is never silently shadowed — the user can edit it on the Rules page.
 */
export function createRulesFromKeywords(categoryName: string, keywords: string[], matchType: RuleMatchType): CreateFromKeywordsResult {
  const thenText = requireCategory(categoryName)
  const db = getDb()
  const result: CreateFromKeywordsResult = { created: [], skipped: [] }
  const ids: string[] = []
  db.transaction(() => {
    const seen = new Set<string>()
    for (const raw of keywords) {
      const keyword = cleanKeyword(raw)
      const key = keywordKey(keyword)
      if (seen.has(key)) continue
      seen.add(key)
      const existing = findSameKeyword(keyword, matchType)
      if (existing) {
        result.skipped.push(
          existing.thenText === thenText
            ? { keyword, reason: 'duplicate' }
            : { keyword, reason: 'conflict', existingCategory: existing.thenText }
        )
        continue
      }
      const id = newId()
      const now = stamp()
      db.run(
        `INSERT INTO rules (id, whenText, thenText, enabled, priority, matchType, source, createdAt, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?, 'category-finder', ?, ?)`,
        id, keyword, thenText, nextPriority(), matchType, now, now
      )
      ids.push(id)
    }
    if (ids.length > 0 && getOrderMode() === 'auto') resortBySpecificity()
  })
  result.created = ids.map(getRule)
  return result
}

// ---- bulk recategorise ----------------------------------------------------------------------

interface RecatRow {
  id: string
  date: string
  merchant: string
  memo: string
  category: string
  categoryLocked: number
}

interface Evaluation {
  rulesEnabled: number
  scanned: number
  skippedLocked: number
  skippedCategorized: number
  changes: { id: string; to: string }[]
  byCategory: Map<string, number>
  samples: RecategorizeSample[]
}

/**
 * Run the enabled rules over existing transactions without writing anything.
 * Candidates: rows in "Needs review" (or any category when includeCategorized), not manually categorized
 * (unless includeLocked). Transfers are never touched.
 */
function evaluate(opts: RecategorizeOptions): Evaluation {
  const compiled = loadCompiledRules()
  const ev: Evaluation = {
    rulesEnabled: compiled.length,
    scanned: 0,
    skippedLocked: 0,
    skippedCategorized: 0,
    changes: [],
    byCategory: new Map(),
    samples: []
  }
  if (compiled.length === 0) return ev
  const rows = getDb().iterate<RecatRow>(
    'SELECT id, date, merchant, memo, category, categoryLocked FROM transactions WHERE isTransfer = 0 ORDER BY date DESC, rowid DESC'
  )
  for (const row of rows) {
    ev.scanned++
    if (row.categoryLocked === 1 && !opts.includeLocked) {
      ev.skippedLocked++
      continue
    }
    if (row.category !== NEEDS_REVIEW && !opts.includeCategorized) {
      ev.skippedCategorized++
      continue
    }
    const text = searchTextOf(row)
    const hit = firstMatchingRule(text, compiled)
    if (!hit || hit.rule.thenText === row.category) continue
    ev.changes.push({ id: row.id, to: hit.rule.thenText })
    ev.byCategory.set(hit.rule.thenText, (ev.byCategory.get(hit.rule.thenText) ?? 0) + 1)
    if (ev.samples.length < 25) {
      ev.samples.push({ id: row.id, date: row.date, text, from: row.category, to: hit.rule.thenText, rule: hit.rule.whenText })
    }
  }
  return ev
}

export function recategorizePreview(opts: RecategorizeOptions): RecategorizePreview {
  const ev = evaluate(opts)
  return {
    rulesEnabled: ev.rulesEnabled,
    scanned: ev.scanned,
    wouldChange: ev.changes.length,
    skippedLocked: ev.skippedLocked,
    skippedCategorized: ev.skippedCategorized,
    byCategory: [...ev.byCategory].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 25),
    samples: ev.samples
  }
}

/** Writes the category only (the manual-override flag is left exactly as it was). */
export function recategorizeApply(opts: RecategorizeOptions): { changed: number } {
  const ev = evaluate(opts)
  if (ev.rulesEnabled === 0) throw new AppError('VALIDATION', 'There are no enabled rules to apply. Create or enable a rule first.')
  const db = getDb()
  let changed = 0
  db.transaction(() => {
    const now = nowISO()
    for (const c of ev.changes) {
      changed += db.run('UPDATE transactions SET category = ?, updatedAt = ? WHERE id = ?', c.to, now, c.id).changes
    }
  })
  return { changed }
}
