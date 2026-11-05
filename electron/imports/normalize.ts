// Turn parsed records into uniform rows. Pure; no database access.
import { round2 } from '../../shared/money'
import { TRANSFER_CATEGORY, type TxnType } from '../../shared/types'
import type { ColumnMapping } from '../../shared/api/imports'
import { indicatorType, parseAmount } from './common/amount'
import { parseDateParts, resolveDate, type ResolvedOrder } from './common/dates'
import { cellText } from './table'
import type { Cell, NormRow, QifRecord } from './types'

export const NO_DESCRIPTION = '(No description)'
const MAX_MERCHANT = 500
const MAX_MEMO = 2000

export interface NormalizeContext {
  order: ResolvedOrder
  /** Swap income and expense. */
  reverse: boolean
}

function blank(seq: number): NormRow {
  return {
    seq, date: null, rawDate: '', merchant: '', memo: '', amount: 0, type: 'expense', category: '', account: '', isTransfer: false,
    reference: '', issue: null, finalCategory: '', categorySource: 'none', fingerprint: '', status: 'new', dupReason: '', repeated: false
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

function applyAmount(row: NormRow, signed: number | null, forced: TxnType | null, ctx: NormalizeContext, hadAnyAmountText: boolean): void {
  if (signed === null) {
    row.issue = row.issue ?? (hadAnyAmountText ? 'Amount could not be read' : 'No amount')
    return
  }
  const magnitude = round2(Math.abs(signed))
  if (!(magnitude > 0)) {
    row.issue = row.issue ?? 'Amount is zero'
    return
  }
  let type: TxnType = forced ?? (signed < 0 ? 'expense' : 'income')
  if (ctx.reverse) type = type === 'expense' ? 'income' : 'expense'
  row.amount = magnitude
  row.type = type
}

/** One QIF record → row. */
export function normalizeQifRecord(rec: QifRecord, seq: number, ctx: NormalizeContext): NormRow {
  const row = blank(seq)
  row.rawDate = rec.date
  if (!rec.date.trim()) row.issue = 'No date'
  else {
    const parts = parseDateParts(rec.date)
    row.date = parts ? resolveDate(parts, ctx.order) : null
    if (!row.date) row.issue = 'Date could not be read'
  }
  const amt = parseAmount(rec.amount)
  applyAmount(row, amt ? amt.value : null, null, ctx, rec.amount.trim() !== '')

  const payee = oneLine(rec.payee)
  const memo = oneLine(rec.memo)
  row.merchant = clip(payee || memo || NO_DESCRIPTION, MAX_MERCHANT)
  row.memo = payee ? clip(memo, MAX_MEMO) : ''
  row.reference = clip(oneLine(rec.number), 100)

  let cat = rec.category.trim()
  const transfer = /^\[(.+)\]/.exec(cat)
  if (transfer) {
    row.isTransfer = true
    row.category = TRANSFER_CATEGORY
    row.memo = clip(row.memo ? `${row.memo} · Transfer: ${transfer[1]}` : `Transfer: ${transfer[1]}`, MAX_MEMO)
  } else {
    if (!cat && rec.splitCategories.length) {
      const distinct = [...new Set(rec.splitCategories.map((c) => c.trim()).filter(Boolean))]
      if (distinct.length === 1) cat = distinct[0]
    }
    const slash = cat.indexOf('/')
    if (slash > 0) cat = cat.slice(0, slash) // "Food:Dining/ClassName" → drop the class
    row.category = clip(oneLine(cat), 60)
  }
  return row
}

/** One CSV / Excel row → row, or null for a row that is blank in every mapped column. */
export function normalizeTableRow(cells: Cell[], seq: number, map: ColumnMapping, ctx: NormalizeContext): NormRow | null {
  const get = (c: number | null): Cell => (c === null ? null : (cells[c] ?? null))
  const text = (c: number | null) => oneLine(cellText(get(c)))

  const dateCell = get(map.date)
  const dateText = cellText(dateCell).trim()
  const desc = text(map.description)
  const memo = text(map.memo)
  const debitCell = get(map.debit)
  const creditCell = get(map.credit)
  const amountCell = get(map.amount)
  const anyAmountText = [debitCell, creditCell, amountCell].some((c) => cellText(c).trim() !== '')
  if (!dateText && !desc && !memo && !anyAmountText) return null

  const row = blank(seq)
  row.rawDate = dateText
  if (!dateText) row.issue = 'No date'
  else {
    const parts = parseDateParts(dateText)
    row.date = parts ? resolveDate(parts, ctx.order) : null
    if (!row.date) row.issue = 'Date could not be read'
  }

  // ---- amount ----
  if (map.debit !== null || map.credit !== null) {
    const d = map.debit !== null ? parseAmount(debitCell) : null
    const c = map.credit !== null ? parseAmount(creditCell) : null
    const dv = d ? Math.abs(d.value) : 0
    const cv = c ? Math.abs(c.value) : 0
    if (dv > 0 && cv > 0) {
      row.issue = row.issue ?? 'Both debit and credit have a value'
    } else if (dv > 0) applyAmount(row, dv, 'expense', ctx, true)
    else if (cv > 0) applyAmount(row, cv, 'income', ctx, true)
    else {
      const unreadable = (cellText(debitCell).trim() !== '' && !d) || (cellText(creditCell).trim() !== '' && !c)
      row.issue = row.issue ?? (unreadable ? 'Amount could not be read' : 'No amount')
    }
  } else {
    const a = parseAmount(amountCell)
    let forced: TxnType | null = null
    if (a) {
      if (map.drcr !== null) forced = indicatorType(cellText(get(map.drcr)))
      if (!forced && a.indicator) forced = a.indicator === 'dr' ? 'expense' : 'income'
    }
    applyAmount(row, a ? a.value : null, forced, ctx, cellText(amountCell).trim() !== '')
  }

  row.merchant = clip(desc || memo || NO_DESCRIPTION, MAX_MERCHANT)
  row.memo = desc ? clip(memo, MAX_MEMO) : ''
  row.category = clip(text(map.category), 60)
  if (/^(uncategori[sz]ed|none|n\/a|-)$/i.test(row.category)) row.category = ''
  row.account = clip(text(map.account), 60)
  row.reference = clip(text(map.reference), 100)

  // A line with no readable date and no amount is a heading / total / footer, not a transaction.
  if (!row.date && row.amount === 0 && row.issue) row.issue = 'Not a transaction row'
  return row
}
