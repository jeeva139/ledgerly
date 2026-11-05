// Header-row and column-mapping detection for CSV / Excel statements.
// Rule: automatic detection fills the mapping in, but anything ambiguous or guessed from data alone is
// reported in `uncertain` so the UI makes the user confirm it. Nothing ambiguous is accepted silently.
import { MAPPING_FIELDS, type ColumnMapping, type MappingField } from '../../shared/api/imports'
import { parseAmount } from './common/amount'
import { parseDateParts } from './common/dates'
import type { Cell } from './types'

export const emptyMapping = (): ColumnMapping => ({
  date: null, description: null, memo: null, amount: null, debit: null, credit: null, drcr: null,
  category: null, account: null, reference: null, balance: null
})

export const cellText = (c: Cell | undefined): string => (c === null || c === undefined ? '' : typeof c === 'number' ? String(c) : c)

function norm(h: unknown): string {
  return cellText(h as Cell)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

interface Pat {
  strong: string[]
  medium?: string[]
  contains?: RegExp
  /** Headers that must NOT match even if a pattern would. */
  not?: RegExp
}

const PATTERNS: Record<MappingField, Pat> = {
  date: {
    strong: ['date', 'transaction date', 'txn date', 'trans date', 'posting date', 'posted date', 'booking date', 'tran date', 'date of transaction', 'txn dt', 'trans dt'],
    medium: ['value date', 'value dt', 'valuedate', 'entry date'],
    contains: /\bdate\b|\bdt\b/,
    not: /update|maturity|due|birth/
  },
  description: {
    strong: ['description', 'narration', 'particulars', 'merchant', 'payee', 'transaction details', 'transaction description', 'narrative', 'transaction remarks', 'payee name', 'merchant name', 'details', 'description of transaction'],
    medium: ['name', 'remarks', 'transaction', 'memo/description'],
    contains: /descr|narrat|particular|merchant|payee/,
    not: /account|balance|category/
  },
  memo: { strong: ['memo', 'notes', 'note', 'comments', 'comment', 'additional info', 'additional information', 'remarks'], contains: /\bmemo\b/ },
  amount: {
    strong: ['amount', 'amt', 'transaction amount', 'txn amount', 'amount inr', 'amount in inr', 'net amount'],
    medium: ['value'],
    contains: /amount/,
    not: /debit|credit|withdraw|deposit|balance|dr\b|cr\b/
  },
  debit: {
    strong: ['debit', 'debits', 'debit amount', 'debit amt', 'withdrawal', 'withdrawals', 'withdrawal amt', 'withdrawal amount', 'dr', 'dr amount', 'paid out', 'money out', 'amount debited', 'withdrawal amt (inr)'],
    contains: /withdraw|\bdebit/,
    not: /\/|credit|deposit|balance/
  },
  credit: {
    strong: ['credit', 'credits', 'credit amount', 'credit amt', 'deposit', 'deposits', 'deposit amt', 'deposit amount', 'cr', 'cr amount', 'paid in', 'money in', 'amount credited', 'deposit amt (inr)'],
    contains: /deposit|\bcredit/,
    not: /\/|debit|withdraw|balance/
  },
  drcr: {
    strong: ['dr/cr', 'cr/dr', 'drcr', 'crdr', 'dr cr', 'cr dr', 'debit/credit', 'credit/debit', 'transaction type', 'txn type', 'type'],
    contains: /\bdr\/cr\b|\bcr\/dr\b/
  },
  category: { strong: ['category', 'categories'], contains: /categor/ },
  account: { strong: ['account', 'account name', 'acct', 'account title'] },
  reference: {
    strong: ['reference', 'ref', 'ref no', 'reference no', 'reference number', 'chq/ref no', 'chq/refno', 'chq ref no', 'cheque no', 'chq no', 'cheque number', 'utr', 'utr no', 'transaction id', 'txn id', 'ref number', 'instrument no', 'check number', 'check no'],
    contains: /\b(ref|chq|cheque|utr)\b|refno/
  },
  balance: {
    strong: ['balance', 'closing balance', 'running balance', 'available balance', 'bal', 'balance amt', 'closing bal'],
    contains: /balance/
  }
}

/** How well a header title fits a field: 100 exact · 60 near · 40 keyword · 0 none. */
function headerScore(field: MappingField, header: unknown): number {
  const n = norm(header)
  if (!n) return 0
  const p = PATTERNS[field]
  if (p.not?.test(n) && !p.strong.includes(n)) return 0
  if (p.strong.includes(n)) return 100
  if (p.medium?.includes(n)) return 60
  if (p.contains?.test(n)) return 40
  return 0
}

const isNumeric = (c: Cell | undefined) => parseAmount(c) !== null
const isDateLike = (c: Cell | undefined) => typeof c === 'string' && parseDateParts(c) !== null

/** Find the header row among the first rows. Returns the 0-based index, or -1 when the file has none. */
export function detectHeaderRow(rows: Cell[][]): number {
  const limit = Math.min(rows.length, 40)
  let best = -1
  let bestScore = 1
  for (let i = 0; i < limit; i++) {
    const row = rows[i]
    let score = 0
    let textCells = 0
    let nonEmpty = 0
    for (const c of row) {
      if (c === null || c === '') continue
      nonEmpty++
      if (typeof c === 'string' && !isNumeric(c) && !isDateLike(c)) textCells++
      let hit = false
      for (const f of MAPPING_FIELDS) {
        if (headerScore(f, c) >= 60) {
          hit = true
          break
        }
      }
      if (hit) score++
    }
    if (score > bestScore && textCells >= Math.ceil(nonEmpty * 0.5)) {
      best = i
      bestScore = score
    }
  }
  if (best >= 0) return best
  // No recognised titles: a first row made of plain text (no dates / amounts) is probably a header anyway.
  const first = rows[0]
  if (first) {
    const nonEmpty = first.filter((c) => c !== null && c !== '')
    if (nonEmpty.length >= 2 && nonEmpty.every((c) => typeof c === 'string' && !isNumeric(c) && !isDateLike(c))) return 0
  }
  return -1
}

export interface TableLayout {
  /** 0-based header row index, or -1 (no header). */
  headerIndex: number
  /** Index of the first data row. */
  dataStart: number
  headers: string[]
  width: number
}

/** `headerRowOption`: ≥1 explicit 1-based row · -1 no header · null/0 detect. */
export function layoutTable(rows: Cell[][], headerRowOption?: number | null): TableLayout {
  let width = 0
  for (let i = 0; i < Math.min(rows.length, 200); i++) width = Math.max(width, rows[i].length)
  let headerIndex: number
  if (headerRowOption === -1) headerIndex = -1
  else if (headerRowOption && headerRowOption >= 1) headerIndex = Math.min(headerRowOption - 1, Math.max(0, rows.length - 1))
  else headerIndex = detectHeaderRow(rows)
  const headers: string[] = []
  for (let c = 0; c < width; c++) {
    const t = headerIndex >= 0 ? cellText(rows[headerIndex]?.[c]).trim() : ''
    headers.push(t || `Column ${c + 1}`)
  }
  return { headerIndex, dataStart: headerIndex + 1, headers, width }
}

export interface MappingDetection {
  mapping: ColumnMapping
  uncertain: Partial<Record<MappingField, string>>
}

const colValues = (sample: Cell[][], c: number): Cell[] => sample.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== '')
const share = (vals: Cell[], pred: (v: Cell) => boolean): number => (vals.length ? vals.filter(pred).length / vals.length : 0)
const INDICATOR = /^(dr|cr|debit|credit|d|c|withdrawal|deposit)\.?$/i

/** Detect the column mapping from the header titles and the data underneath. */
export function detectMapping(headers: string[], sample: Cell[][]): MappingDetection {
  const mapping = emptyMapping()
  const uncertain: Partial<Record<MappingField, string>> = {}
  const used = new Set<number>()
  const nameOf = (c: number) => `"${headers[c]}"`

  const candidates = (f: MappingField): { col: number; score: number }[] =>
    headers
      .map((h, col) => ({ col, score: headerScore(f, h) }))
      .filter((x) => x.score > 0 && !used.has(x.col))
      .sort((a, b) => b.score - a.score || a.col - b.col)

  const pickTop = (f: MappingField): { col: number; ties: number[] } | null => {
    const c = candidates(f)
    if (!c.length) return null
    const ties = c.filter((x) => x.score === c[0].score).map((x) => x.col)
    return { col: c[0].col, ties }
  }

  // --- date
  {
    const top = pickTop('date')
    if (top) {
      mapping.date = top.col
      used.add(top.col)
      if (top.ties.length > 1) {
        uncertain.date = `Several columns could be the date (${top.ties.map(nameOf).join(', ')}). Please confirm which one to use.`
      } else if (share(colValues(sample, top.col), isDateLike) < 0.6) {
        uncertain.date = `The values in ${nameOf(top.col)} do not look like dates. Please check this column.`
      }
    }
  }

  // --- debit / credit / amount
  const debit = pickTop('debit')
  if (debit) {
    mapping.debit = debit.col
    used.add(debit.col)
  }
  const credit = pickTop('credit')
  if (credit) {
    mapping.credit = credit.col
    used.add(credit.col)
  }
  const amount = pickTop('amount')
  if (amount) {
    if (mapping.debit !== null || mapping.credit !== null) {
      uncertain.amount = `The file has an Amount column and Debit/Credit columns. Debit and Credit are being used; confirm that is right.`
    } else {
      mapping.amount = amount.col
      used.add(amount.col)
      if (amount.ties.length > 1) uncertain.amount = `Several columns could be the amount (${amount.ties.map(nameOf).join(', ')}). Please confirm which one to use.`
    }
  }
  for (const f of ['amount', 'debit', 'credit'] as const) {
    const c = mapping[f]
    if (c !== null && share(colValues(sample, c), isNumeric) < 0.6 && !uncertain[f]) {
      uncertain[f] = `The values in ${nameOf(c)} do not look like amounts. Please check this column.`
    }
  }

  // --- debit/credit indicator (only when the data really holds Dr/Cr style text)
  {
    const top = pickTop('drcr')
    if (top && mapping.drcr === null) {
      const vals = colValues(sample, top.col)
      if (vals.length && share(vals, (v) => typeof v === 'string' && INDICATOR.test(v.trim())) >= 0.9) {
        mapping.drcr = top.col
        used.add(top.col)
      }
    }
  }

  // --- description (+ memo from a second descriptive column)
  {
    const c = candidates('description')
    if (c.length) {
      mapping.description = c[0].col
      used.add(c[0].col)
      const second = c.find((x) => x.col !== c[0].col && x.score === c[0].score)
      if (second) {
        mapping.memo = second.col
        used.add(second.col)
      }
    }
  }
  if (mapping.memo === null) {
    const m = pickTop('memo')
    if (m && !used.has(m.col)) {
      mapping.memo = m.col
      used.add(m.col)
    }
  }

  for (const f of ['category', 'account', 'reference', 'balance'] as const) {
    const top = pickTop(f)
    if (top && !used.has(top.col)) {
      mapping[f] = top.col
      used.add(top.col)
      if (top.ties.length > 1) uncertain[f] = `Several columns could be this field (${top.ties.map(nameOf).join(', ')}). Please confirm.`
    }
  }

  // ---- content-based fallbacks when titles told us nothing ----
  const free = headers.map((_, c) => c).filter((c) => !used.has(c))
  if (mapping.date === null) {
    const dateCols = free.filter((c) => {
      const v = colValues(sample, c)
      return v.length >= 1 && share(v, isDateLike) >= 0.8
    })
    if (dateCols.length >= 1) {
      mapping.date = dateCols[0]
      used.add(dateCols[0])
      uncertain.date =
        dateCols.length === 1
          ? `Detected from the data in ${nameOf(dateCols[0])}, not from a column title. Please confirm.`
          : `Several columns look like dates (${dateCols.map(nameOf).join(', ')}). Please confirm which one to use.`
    }
  }
  if (mapping.amount === null && mapping.debit === null && mapping.credit === null) {
    const numCols = headers
      .map((_, c) => c)
      .filter((c) => !used.has(c))
      .filter((c) => {
        const v = colValues(sample, c)
        return v.length >= 1 && share(v, isNumeric) >= 0.8 && share(v, isDateLike) < 0.5
      })
    if (numCols.length === 1) {
      mapping.amount = numCols[0]
      used.add(numCols[0])
      uncertain.amount = `Detected from the data in ${nameOf(numCols[0])}, not from a column title. Please confirm.`
    } else if (numCols.length > 1) {
      uncertain.amount = `Several numeric columns found (${numCols.map(nameOf).join(', ')}). Choose the amount column, or set Debit and Credit.`
    }
  }
  if (mapping.description === null) {
    let best = -1
    let bestLen = 0
    for (const c of headers.map((_, i) => i).filter((i) => !used.has(i))) {
      const v = colValues(sample, c)
      if (!v.length || share(v, (x) => typeof x === 'string' && !isNumeric(x) && !isDateLike(x)) < 0.7) continue
      const avg = v.reduce<number>((s, x) => s + cellText(x).length, 0) / v.length
      if (avg > bestLen) {
        bestLen = avg
        best = c
      }
    }
    if (best >= 0) {
      mapping.description = best
      used.add(best)
      uncertain.description = `Detected from the data in ${nameOf(best)}, not from a column title. Please confirm.`
    }
  }
  return { mapping, uncertain }
}

/** Merge automatic detection with the user's explicit choices (explicit keys win, even when null). */
export function resolveMapping(
  detected: MappingDetection,
  explicit: Partial<ColumnMapping> | undefined,
  width: number
): MappingDetection {
  const mapping = { ...detected.mapping }
  const uncertain = { ...detected.uncertain }
  if (explicit) {
    for (const f of MAPPING_FIELDS) {
      if (!(f in explicit)) continue
      const v = explicit[f]
      mapping[f] = v === null || v === undefined ? null : v
      delete uncertain[f]
    }
  }
  for (const f of MAPPING_FIELDS) {
    const v = mapping[f]
    if (v !== null && (v < 0 || v >= width)) mapping[f] = null
  }
  // A field the user cleared is no longer uncertain; one that is still unmapped is simply missing.
  return { mapping, uncertain }
}

/** Human-readable reasons the mapping cannot be used yet. */
export function mappingBlockers(mapping: ColumnMapping): string[] {
  const out: string[] = []
  if (mapping.date === null) out.push('Choose which column holds the date.')
  if (mapping.description === null && mapping.memo === null) out.push('Choose which column holds the description.')
  if (mapping.amount === null && mapping.debit === null && mapping.credit === null) {
    out.push('Choose the amount column, or the debit and credit columns.')
  }
  return out
}
