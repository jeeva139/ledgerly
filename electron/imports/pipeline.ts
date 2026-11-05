// Preview pipeline: normalise → date order → duplicate detection → saved rules → summary.
// Runs in the main process in chunks that yield to the event loop, so large files never freeze the app.
// Nothing here writes to the database.
import { baseFingerprint, existingFingerprints, occurrenceFingerprint } from '../database/txnStore'
import { listAccounts, listCategories } from '../services/catalog'
import { loadCompiledRules } from '../services/rulesStore'
import { getImportPreferences, getPreferences } from '../services/settings'
import { emitEvent } from '../platform/events'
import { firstMatchingRule, searchTextOf } from '../../shared/matching'
import { round2 } from '../../shared/money'
import { NEEDS_REVIEW, TRANSFER_CATEGORY } from '../../shared/types'
import type {
  ColumnMapping, ImportFormat, ImportOptions, ImportPreview, ImportSessionSummary, PreviewRowDto, TableInfo
} from '../../shared/api/imports'
import { detectDateOrder, type ResolvedOrder } from './common/dates'
import { normalizeQifRecord, normalizeTableRow, type NormalizeContext } from './normalize'
import { cellText, detectMapping, layoutTable, mappingBlockers, resolveMapping, type MappingDetection, type TableLayout } from './table'
import type { NormRow, ParsedFile, ParsedQif, ParsedTable } from './types'
import { parseFile } from './workerClient'

export interface Session {
  id: string
  filename: string
  format: ImportFormat
  size: number
  bytes: Uint8Array | null
  parsed: ParsedFile
  createdAt: number
  optionsKey: string | null
  rows: NormRow[]
  preview: ImportPreview | null
  idx: { new: number[]; duplicate: number[]; review: number[]; invalid: number[] }
  /** Resolved at preview time and reused by commit. */
  defaultAccount: string
  newAccountsFromFile: string[]
  accountType: string
}

const CHUNK = 4000
export const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function defaultOptions(parsed: ParsedFile): ImportOptions {
  const prefs = getImportPreferences()
  const opts: ImportOptions = {
    account: null,
    dateFormat: 'auto',
    signConvention: 'normal',
    rulesOverrideImported: prefs.rulesOverrideImported,
    addNewCategories: prefs.addNewCategories
  }
  if (parsed.kind === 'qif') {
    const match = parsed.accountNames.map((n) => listAccounts().find((a) => same(a.name, n))).find(Boolean)
    if (match) opts.account = { name: match.name }
  }
  return opts
}

// ---- table helpers ------------------------------------------------------------------------------

function tableInfo(parsed: ParsedTable, layout: TableLayout, resolved: MappingDetection): TableInfo {
  const show = (c: unknown) => cellText(c as never).slice(0, 60)
  return {
    sheets: parsed.sheets,
    sheet: parsed.sheet,
    headerRow: layout.headerIndex + 1,
    headers: layout.headers,
    sampleRows: parsed.rows.slice(layout.dataStart, layout.dataStart + 8).map((r) => layout.headers.map((_, i) => show(r[i]))),
    dataRowCount: Math.max(0, parsed.rows.length - layout.dataStart),
    mapping: resolved.mapping,
    uncertain: resolved.uncertain,
    topRows: parsed.rows.slice(0, 12).map((r) => layout.headers.map((_, i) => show(r[i])))
  }
}

export function analyseTable(parsed: ParsedTable, options: ImportOptions): { layout: TableLayout; resolved: MappingDetection; info: TableInfo } {
  const layout = layoutTable(parsed.rows, options.headerRow)
  const sample = parsed.rows.slice(layout.dataStart, layout.dataStart + 200)
  const detected = detectMapping(layout.headers, sample)
  const resolved = resolveMapping(detected, options.mapping as Partial<ColumnMapping> | undefined, layout.width)
  return { layout, resolved, info: tableInfo(parsed, layout, resolved) }
}

export function buildSummary(s: Session): ImportSessionSummary {
  const defaults = defaultOptions(s.parsed)
  const notes: string[] = []
  const summary: ImportSessionSummary = { sessionId: s.id, filename: s.filename, format: s.format, size: s.size, defaults, notes }
  if (s.parsed.kind === 'qif') {
    summary.qif = {
      accountType: s.parsed.accountType,
      accountNames: s.parsed.accountNames,
      skippedRecords: s.parsed.skippedRecords,
      skippedSections: s.parsed.skippedSections
    }
    if (s.parsed.encoding === 'windows-1252') notes.push('This file is not UTF-8, so it was read as Windows-1252 text.')
  } else {
    summary.table = analyseTable(s.parsed, defaults).info
    if (s.parsed.format === 'csv' && s.parsed.encoding === 'windows-1252') notes.push('This file is not UTF-8, so it was read as Windows-1252 text.')
  }
  return summary
}

// ---- date order ---------------------------------------------------------------------------------

function chooseOrder(
  option: ImportOptions['dateFormat'],
  values: Iterable<string>,
  fallback: ResolvedOrder
): { order: ResolvedOrder; ambiguous: boolean; numeric: number } {
  if (option === 'DMY' || option === 'MDY') return { order: option, ambiguous: false, numeric: 1 }
  const d = detectDateOrder(values, fallback)
  return { order: d.order, ambiguous: d.ambiguous, numeric: d.numericCount }
}

// ---- the pipeline ---------------------------------------------------------------------------------

export async function buildPreview(s: Session, rawOptions: ImportOptions): Promise<ImportPreview> {
  const prefs = getImportPreferences()
  const options: ImportOptions = { ...rawOptions }
  const rulesOverride = options.rulesOverrideImported ?? prefs.rulesOverrideImported
  const reverse = options.signConvention === 'reverse'
  const fallbackOrder: ResolvedOrder = getPreferences().dateFormat === 'MM/DD/YYYY' ? 'MDY' : 'DMY'
  const blockers: string[] = []
  const notes: string[] = []
  const progress = (done: number, total: number) => emitEvent('import:progress', { sessionId: s.id, phase: 'checking', done, total })

  // Excel: another sheet was chosen → read that sheet.
  if (s.parsed.kind === 'table' && s.format === 'excel' && options.sheet && options.sheet !== s.parsed.sheet && s.parsed.sheets.includes(options.sheet) && s.bytes) {
    s.parsed = await parseFile('excel', s.bytes, { sheet: options.sheet })
  }

  let rows: NormRow[] = []
  let tInfo: TableInfo | undefined
  let order: ResolvedOrder = fallbackOrder
  let dateAmbiguous = false
  let debitCreditMode = false
  let mapping: ColumnMapping | null = null

  if (s.parsed.kind === 'qif') {
    const parsed: ParsedQif = s.parsed
    const o = chooseOrder(options.dateFormat, parsed.records.map((r) => r.date), fallbackOrder)
    order = o.order
    dateAmbiguous = o.ambiguous
    const ctx: NormalizeContext = { order, reverse }
    rows = new Array(parsed.records.length)
    for (let i = 0; i < parsed.records.length; i++) {
      rows[i] = normalizeQifRecord(parsed.records[i], i + 1, ctx)
      if ((i + 1) % CHUNK === 0) {
        progress(i + 1, parsed.records.length)
        await yieldToLoop()
      }
    }
    if (parsed.skippedRecords > 0) {
      notes.push(`${parsed.skippedRecords.toLocaleString()} record${parsed.skippedRecords === 1 ? '' : 's'} in sections Ledgerly does not import (${parsed.skippedSections.join(', ')}) were skipped.`)
    }
    if (parsed.accountNames.length) notes.push(`The file names the account “${parsed.accountNames[0]}”.`)
  } else {
    const parsed = s.parsed
    const { layout, resolved, info } = analyseTable(parsed, options)
    tInfo = info
    mapping = resolved.mapping
    blockers.push(...mappingBlockers(resolved.mapping))
    if (blockers.length === 0 && Object.keys(resolved.uncertain).length > 0) {
      blockers.push('Please confirm the highlighted column choices before importing.')
    }
    debitCreditMode = resolved.mapping.debit !== null || resolved.mapping.credit !== null
    if (blockers.filter((b) => !b.startsWith('Please confirm')).length === 0) {
      const dateCol = resolved.mapping.date as number
      const dates: string[] = []
      for (let i = layout.dataStart; i < parsed.rows.length; i++) {
        const v = parsed.rows[i][dateCol]
        if (v !== null && v !== undefined) dates.push(cellText(v))
      }
      const o = chooseOrder(options.dateFormat, dates, fallbackOrder)
      order = o.order
      dateAmbiguous = o.ambiguous
      const ctx: NormalizeContext = { order, reverse }
      const total = parsed.rows.length - layout.dataStart
      let seq = 0
      for (let i = layout.dataStart; i < parsed.rows.length; i++) {
        const r = normalizeTableRow(parsed.rows[i], seq + 1, resolved.mapping, ctx)
        if (r) {
          seq++
          rows.push(r)
        }
        if ((i - layout.dataStart + 1) % CHUNK === 0) {
          progress(i - layout.dataStart + 1, total)
          await yieldToLoop()
        }
      }
    }
    if (parsed.format === 'csv' && parsed.delimiter && parsed.delimiter !== ',') {
      notes.push(`Columns are separated by “${parsed.delimiter === '\t' ? 'tab' : parsed.delimiter}”.`)
    }
  }

  if (dateAmbiguous && (options.dateFormat === undefined || options.dateFormat === 'auto')) {
    blockers.push('Confirm the date format: are dates written day/month or month/day?')
  }

  // ---- accounts ----
  const accounts = listAccounts()
  const chosen = (options.account?.name ?? '').trim()
  const hasAccountColumn = mapping !== null && mapping.account !== null
  if (!chosen && !hasAccountColumn) blockers.push('Choose which account these transactions belong to.')
  const canonicalAccount = (n: string) => accounts.find((a) => same(a.name, n))?.name ?? n.trim()
  const defaultAccount = chosen ? canonicalAccount(chosen) : 'Imported account'
  const fileAccounts = new Set<string>()
  const accountFor = (r: NormRow) => (r.account ? canonicalAccount(r.account) : defaultAccount)
  if (hasAccountColumn) {
    for (const r of rows) if (r.account) fileAccounts.add(canonicalAccount(r.account))
    if (fileAccounts.size > 50) blockers.push('The account column has too many different values to be account names. Set it to “not used”.')
    if (!chosen) notes.push('Rows without an account in the file will use “Imported account”.')
  }
  const newAccounts = [...fileAccounts].filter((n) => !accounts.some((a) => same(a.name, n)))

  // ---- duplicates, rules, categories ----
  const managed = new Map(listCategories().map((c) => [c.toLowerCase(), c]))
  const compiled = loadCompiledRules()
  const counts = new Map<string, number>()
  const newCategorySet = new Set<string>()
  const idx = { new: [] as number[], duplicate: [] as number[], review: [] as number[], invalid: [] as number[] }
  const keepRepeats = prefs.keepRepeatedRows
  const fpBatch: number[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.issue || !r.date || !(r.amount > 0)) {
      r.status = 'invalid'
      idx.invalid.push(i)
    } else {
      const base = baseFingerprint(r.date, r.merchant, r.amount, accountFor(r))
      const n = (counts.get(base) ?? 0) + 1
      counts.set(base, n)
      if (n > 1 && !keepRepeats) {
        r.status = 'duplicate'
        r.dupReason = 'in-file'
        r.fingerprint = base
      } else {
        r.fingerprint = occurrenceFingerprint(base, n)
        r.repeated = n > 1
        r.status = 'new'
        fpBatch.push(i)
      }
      // category: transfer → file → rule → needs review
      if (r.isTransfer) {
        r.finalCategory = TRANSFER_CATEGORY
        r.categorySource = 'transfer'
      } else {
        const fileCat = r.category && !same(r.category, NEEDS_REVIEW) ? (managed.get(r.category.toLowerCase()) ?? r.category) : ''
        const hit = fileCat && !rulesOverride ? null : firstMatchingRule(searchTextOf(r), compiled)
        if (hit) {
          r.finalCategory = hit.rule.thenText
          r.categorySource = 'rule'
        } else if (fileCat) {
          r.finalCategory = fileCat
          r.categorySource = 'file'
        } else {
          r.finalCategory = NEEDS_REVIEW
          r.categorySource = 'none'
        }
      }
    }
    if ((i + 1) % CHUNK === 0) await yieldToLoop()
  }

  // Which of the "new" rows already exist in the database?
  for (let start = 0; start < fpBatch.length; start += 2000) {
    const slice = fpBatch.slice(start, start + 2000)
    const existing = existingFingerprints(slice.map((i) => rows[i].fingerprint))
    for (const i of slice) {
      const r = rows[i]
      if (existing.has(r.fingerprint)) {
        r.status = 'duplicate'
        r.dupReason = 'existing'
      }
    }
    await yieldToLoop()
  }

  let incomeCount = 0, incomeTotal = 0, expenseCount = 0, expenseTotal = 0, transferCount = 0
  let valid = 0, repeated = 0, needsReview = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.status === 'invalid') continue
    valid++
    if (r.isTransfer) transferCount++
    else if (r.type === 'income') {
      incomeCount++
      incomeTotal += r.amount
    } else {
      expenseCount++
      expenseTotal += r.amount
    }
    if (r.status === 'new') {
      idx.new.push(i)
      if (r.repeated) repeated++
      if (r.finalCategory === NEEDS_REVIEW) {
        needsReview++
        idx.review.push(i)
      }
      if (r.categorySource === 'file' && !managed.has(r.finalCategory.toLowerCase())) newCategorySet.add(r.finalCategory)
    } else {
      idx.duplicate.push(i)
    }
  }

  if (newCategorySet.size > 200) {
    notes.push('The file contains a very large number of different categories. Check that the right column is used for “Category”.')
  }

  // ---- hints ----
  let signHint: string | null = null
  if (!debitCreditMode && valid >= 5) {
    const incomeShare = incomeCount / Math.max(1, incomeCount + expenseCount)
    if (incomeShare >= 0.9 && !reverse) {
      const card = s.parsed.kind === 'qif' && /ccard/i.test(s.parsed.accountType ?? '')
      signHint = card
        ? 'This is a credit-card file and almost every amount is positive, so everything is being read as income. If these are purchases, switch the sign convention to “Reverse”.'
        : 'Almost every amount is positive, so nearly everything is being read as income. If this file lists purchases as positive numbers, switch the sign convention to “Reverse”.'
    }
  }

  const preview: ImportPreview = {
    sessionId: s.id,
    filename: s.filename,
    format: s.format,
    detected: rows.length,
    valid,
    incomeCount,
    incomeTotal: round2(incomeTotal),
    expenseCount,
    expenseTotal: round2(expenseTotal),
    transferCount,
    newCount: idx.new.length,
    duplicates: idx.duplicate.length,
    repeatedInFile: repeated,
    needsReview,
    invalid: idx.invalid.length,
    dateOrder: s.parsed.kind === 'qif' || (mapping !== null && mapping.date !== null) ? order : null,
    dateAmbiguous,
    signHint,
    newCategories: [...newCategorySet].sort((a, b) => a.localeCompare(b)),
    newAccounts,
    account: chosen ? { name: defaultAccount, exists: accounts.some((a) => same(a.name, defaultAccount)) } : null,
    table: tInfo,
    notes,
    blockers,
    canImport: blockers.length === 0 && idx.new.length > 0
  }
  if (blockers.length === 0 && idx.new.length === 0) {
    preview.blockers = [rows.length === 0 ? 'No transactions were found in this file.' : 'There is nothing new to import: every readable row is a duplicate or invalid.']
  }

  s.rows = rows
  s.idx = idx
  s.preview = preview
  s.defaultAccount = defaultAccount
  s.newAccountsFromFile = newAccounts
  s.accountType = options.account?.type ?? 'other'
  progress(rows.length, rows.length)
  return preview
}

export function toPreviewRow(r: NormRow): PreviewRowDto {
  const invalid = r.status === 'invalid'
  return {
    seq: r.seq,
    date: r.date,
    rawDate: r.rawDate,
    merchant: r.merchant,
    memo: r.memo,
    amount: invalid && !(r.amount > 0) ? null : r.amount,
    type: invalid && !(r.amount > 0) ? null : r.type,
    category: r.finalCategory || r.category,
    categorySource: r.categorySource,
    account: r.account,
    isTransfer: r.isTransfer,
    status: r.status,
    issue: invalid ? r.issue : r.status === 'duplicate' ? (r.dupReason === 'in-file' ? 'Repeated earlier in this file' : 'Already in Ledgerly') : r.repeated ? 'Identical to an earlier row (kept as a separate transaction)' : null,
    repeated: r.repeated,
    needsReview: r.status === 'new' && r.finalCategory === NEEDS_REVIEW
  }
}
