// Category Finder engine (offline, main process).
//
// search  → read-only scan of ALL transactions (merchant + memo), creates a "finder session"
//           holding the ordered match ids and the user's selection (one byte per match).
// page    → hydrates one page of matches from SQLite (text, hits for highlighting, selection state).
// select / toggle → change the selection held in the session.
// apply   → the ONLY writing step: sets category (+ manual-override flag + updatedAt) on the selected rows
//           inside a single SQLite transaction. Amounts, dates, merchants and accounts are never touched.
import { getDb } from '../database/db'
import { newId, nowISO } from '../database/ids'
import { canonicalCategory, ensureCategory } from './catalog'
import { createRulesFromKeywords, type CreateFromKeywordsResult } from './rules'
import { AppError } from '../../shared/errors'
import { compileKeywords, findKeywordHits, parseKeywords, searchTextOf, type CompiledMatcher } from '../../shared/matching'
import type { TxnType } from '../../shared/types'
import type {
  FinderApplyResult, FinderKeywordCount, FinderPage, FinderRow, FinderSearchInput, FinderSelectOp, FinderSummary
} from '../../shared/api/categoryFinder'

export const MAX_KEYWORDS = 100
const MAX_SESSIONS = 3

interface Session {
  id: string
  category: string
  keywords: string[]
  wholeWord: boolean
  matchers: CompiledMatcher[]
  /** Match ids ordered newest first. */
  ids: string[]
  selected: Uint8Array
  defaults: Uint8Array
  selectedCount: number
  indexById: Map<string, number> | null
  summary: FinderSummary
}

const sessions = new Map<string, Session>()

function getSession(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new AppError('NOT_FOUND', 'This search is no longer available. Please search again.')
  return s
}

export function cancelSession(id: string): void {
  sessions.delete(id)
}

export function clearAllSessions(): void {
  sessions.clear()
}

interface ScanRow {
  id: string
  merchant: string
  memo: string
  category: string
  categoryLocked: number
}

/** Read-only scan. Creates a session; nothing is written. */
export function startSearch(input: FinderSearchInput): FinderSummary {
  const keywords = parseKeywords(input.keywords ?? '')
  if (keywords.length === 0) throw new AppError('VALIDATION', 'Enter at least one keyword, separated by commas.')
  if (keywords.length > MAX_KEYWORDS) throw new AppError('VALIDATION', `Please use at most ${MAX_KEYWORDS} keywords at a time.`)
  if (keywords.some((k) => k.length > 200)) throw new AppError('VALIDATION', 'Each keyword can be at most 200 characters long.')
  const typed = (input.category ?? '').trim()
  if (!typed) throw new AppError('VALIDATION', 'Choose the category that matching transactions should be assigned to.')
  const category = canonicalCategory(typed)
  if (!category) throw new AppError('VALIDATION', `The category "${typed}" does not exist yet. Choose an existing category or create it first.`)
  const wholeWord = !!input.wholeWord
  const matchers = compileKeywords(keywords, wholeWord ? 'word' : 'contains')
  if (matchers.length === 0) throw new AppError('VALIDATION', 'Those keywords could not be used for searching. Please check them.')

  const ids: string[] = []
  const defaults: number[] = []
  const counts = new Array<number>(matchers.length).fill(0)
  let scanned = 0
  let alreadyInCategory = 0
  let lockedElsewhere = 0
  const rows = getDb().iterate<ScanRow>(
    'SELECT id, merchant, memo, category, categoryLocked FROM transactions ORDER BY date DESC, rowid DESC'
  )
  for (const row of rows) {
    scanned++
    const text = searchTextOf(row)
    let matched = false
    for (let i = 0; i < matchers.length; i++) {
      if (matchers[i].regex.test(text)) {
        counts[i]++
        matched = true
      }
    }
    if (!matched) continue
    ids.push(row.id)
    const already = row.category === category
    const locked = !already && row.categoryLocked === 1
    if (already) alreadyInCategory++
    if (locked) lockedElsewhere++
    defaults.push(already || locked ? 0 : 1)
  }

  const defaultArr = Uint8Array.from(defaults)
  let selectedCount = 0
  for (const v of defaultArr) selectedCount += v
  const perKeyword: FinderKeywordCount[] = matchers.map((m, i) => ({ keyword: m.keyword, count: counts[i] }))

  const id = newId()
  const summary: FinderSummary = {
    sessionId: id,
    category,
    keywords: matchers.map((m) => m.keyword),
    wholeWord,
    total: ids.length,
    scanned,
    alreadyInCategory,
    lockedElsewhere,
    selectedCount,
    perKeyword
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest === undefined) break
    sessions.delete(oldest)
  }
  sessions.set(id, {
    id, category, keywords: summary.keywords, wholeWord, matchers, ids,
    selected: Uint8Array.from(defaultArr), defaults: defaultArr, selectedCount, indexById: null, summary
  })
  return summary
}

interface PageRow {
  id: string
  date: string
  merchant: string
  memo: string
  amount: number
  type: TxnType
  account: string
  category: string
  categoryLocked: number
  isTransfer: number
}

export function getPage(sessionId: string, page: number, pageSize: number): FinderPage {
  const s = getSession(sessionId)
  const total = s.ids.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(Math.max(1, page), pages)
  const start = (p - 1) * pageSize
  const slice = s.ids.slice(start, start + pageSize)
  const byId = new Map<string, PageRow>()
  if (slice.length > 0) {
    const marks = slice.map(() => '?').join(',')
    for (const r of getDb().all<PageRow>(
      `SELECT id, date, merchant, memo, amount, type, account, category, categoryLocked, isTransfer
         FROM transactions WHERE id IN (${marks})`,
      ...slice
    )) byId.set(r.id, r)
  }
  const rows: FinderRow[] = []
  slice.forEach((id, offset) => {
    const r = byId.get(id)
    if (!r) return // deleted since the search
    const text = searchTextOf(r)
    rows.push({
      id: r.id,
      date: r.date,
      text,
      amount: r.amount,
      type: r.type,
      account: r.account,
      currentCategory: r.category,
      categoryLocked: r.categoryLocked === 1,
      isTransfer: r.isTransfer === 1,
      alreadyInCategory: r.category === s.category,
      selected: s.selected[start + offset] === 1,
      hits: findKeywordHits(text, s.matchers)
    })
  })
  return { rows, total, page: p, pageSize, selectedCount: s.selectedCount }
}

function recount(s: Session): void {
  let n = 0
  for (const v of s.selected) n += v
  s.selectedCount = n
}

export function selectOp(sessionId: string, op: FinderSelectOp): { selectedCount: number } {
  const s = getSession(sessionId)
  switch (op) {
    case 'all':
      s.selected.fill(1)
      break
    case 'none':
      s.selected.fill(0)
      break
    case 'default':
      s.selected.set(s.defaults)
      break
    case 'invert':
      for (let i = 0; i < s.selected.length; i++) s.selected[i] = s.selected[i] ? 0 : 1
      break
  }
  recount(s)
  return { selectedCount: s.selectedCount }
}

export function toggleRows(sessionId: string, ids: string[], selected: boolean): { selectedCount: number } {
  const s = getSession(sessionId)
  if (!s.indexById) {
    s.indexById = new Map()
    s.ids.forEach((id, i) => s.indexById!.set(id, i))
  }
  for (const id of ids) {
    const i = s.indexById.get(id)
    if (i === undefined) continue
    if (s.selected[i] !== (selected ? 1 : 0)) {
      s.selected[i] = selected ? 1 : 0
      s.selectedCount += selected ? 1 : -1
    }
  }
  return { selectedCount: s.selectedCount }
}

/**
 * Assign the category to the selected matches. Only `category`, `categoryLocked` and `updatedAt` are written,
 * all inside one transaction (all-or-nothing). Selected rows are marked as manually categorized so routine
 * rule runs never overwrite them. The session is discarded afterwards.
 */
export function applySelection(sessionId: string): FinderApplyResult {
  const s = getSession(sessionId)
  if (s.selectedCount === 0) throw new AppError('VALIDATION', 'Select at least one transaction to apply the category to.')
  const category = ensureCategory(s.category)
  const db = getDb()
  const now = nowISO()
  let changed = 0
  let alreadyInCategory = 0
  db.transaction(() => {
    for (let i = 0; i < s.ids.length; i++) {
      if (s.selected[i] !== 1) continue
      const id = s.ids[i]
      const res = db.run(
        'UPDATE transactions SET category = ?, categoryLocked = 1, updatedAt = ? WHERE id = ? AND category <> ?',
        category, now, id, category
      )
      if (res.changes > 0) {
        changed++
      } else {
        const lock = db.run(
          'UPDATE transactions SET categoryLocked = 1, updatedAt = ? WHERE id = ? AND category = ? AND categoryLocked = 0',
          now, id, category
        )
        if (lock.changes > 0 || db.get('SELECT 1 AS x FROM transactions WHERE id = ?', id)) alreadyInCategory++
      }
    }
  })
  const result: FinderApplyResult = {
    category,
    changed,
    alreadyInCategory,
    notSelected: s.ids.length - s.selectedCount,
    selected: s.selectedCount,
    total: s.ids.length
  }
  sessions.delete(sessionId)
  return result
}

export function saveRulesFromFinder(category: string, keywords: string[], wholeWord: boolean): CreateFromKeywordsResult {
  return createRulesFromKeywords(category, keywords, wholeWord ? 'word' : 'contains')
}
