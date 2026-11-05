// Date parsing for statements. Never invents a date: anything unreadable returns null.
import { isValidISODate } from '../../../shared/dates'

export type ResolvedOrder = 'DMY' | 'MDY'

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
}

export interface DateParts {
  /** ymd/named: a=year b=month c=day (unambiguous). numeric: a,b = first two numbers as written, c = year. */
  kind: 'ymd' | 'named' | 'numeric'
  a: number
  b: number
  c: number
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function fullYear(yy: string, apostrophe = false): number {
  if (yy.length === 4) return Number(yy)
  const n = Number(yy)
  if (apostrophe) return 2000 + n // Quicken: 1/ 5'06 → 2006
  return n < 70 ? 2000 + n : 1900 + n
}

/** Split a date string into numbers without deciding day/month order yet. */
export function parseDateParts(raw: unknown): DateParts | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return null
  let m: RegExpExecArray | null

  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s))) {
    return { kind: 'ymd', a: Number(m[1]), b: Number(m[2]), c: Number(m[3]) }
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return { kind: 'ymd', a: Number(m[1]), b: Number(m[2]), c: Number(m[3]) }

  // 1/ 5'06 · 12-10-2026 · 12.10.26 · 12/10/2026 14:03
  if ((m = /^(\d{1,2}) ?([/.\-]) ?(\d{1,2}) ?([/.\-']) ?(\d{2}|\d{4})(?:[ T,].*)?$/.exec(s))) {
    return { kind: 'numeric', a: Number(m[1]), b: Number(m[3]), c: fullYear(m[5], m[4] === "'") }
  }

  // 12-Oct-26 · 12 Oct 2026 · 12 October 2026
  if ((m = /^(\d{1,2})[ \-/.]([A-Za-z]{3,9})\.?[ \-/.,]+(\d{2}|\d{4})(?:[ T,].*)?$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)]
    if (!mon) return null
    return { kind: 'named', a: fullYear(m[3]), b: mon, c: Number(m[1]) }
  }
  // Oct 12, 2026 · Oct-12-2026
  if ((m = /^([A-Za-z]{3,9})\.?[ \-/.]+(\d{1,2}),?[ \-/.]+(\d{2}|\d{4})(?:[ T,].*)?$/.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)]
    if (!mon) return null
    return { kind: 'named', a: fullYear(m[3]), b: mon, c: Number(m[2]) }
  }
  // 2026-Oct-12
  if ((m = /^(\d{4})[ \-/.]([A-Za-z]{3,9})[ \-/.](\d{1,2})$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)]
    if (!mon) return null
    return { kind: 'named', a: Number(m[1]), b: mon, c: Number(m[3]) }
  }
  return null
}

/** Turn parsed parts into YYYY-MM-DD using the given day/month order for numeric dates. */
export function resolveDate(p: DateParts, order: ResolvedOrder): string | null {
  let y: number
  let mo: number
  let d: number
  if (p.kind === 'numeric') {
    if (order === 'DMY') {
      d = p.a
      mo = p.b
    } else {
      mo = p.a
      d = p.b
    }
    y = p.c
  } else {
    y = p.a
    mo = p.b
    d = p.c
  }
  const iso = `${pad(y, 4)}-${pad(mo)}-${pad(d)}`
  return isValidISODate(iso) ? iso : null
}

export interface OrderDetection {
  order: ResolvedOrder
  /** True when the data does not settle day-vs-month (or contradicts itself). */
  ambiguous: boolean
  numericCount: number
  dmyEvidence: number
  mdyEvidence: number
}

/**
 * Decide DD/MM vs MM/DD from the whole file: a first number above 12 can only be a day, a second number
 * above 12 can only be a day in MM/DD. With no evidence the caller's fallback is used and `ambiguous` is true.
 */
export function detectDateOrder(values: Iterable<string>, fallback: ResolvedOrder): OrderDetection {
  let numeric = 0
  let dmy = 0
  let mdy = 0
  // Dates whose meaning really differs between DD/MM and MM/DD (e.g. 03/04). "09/09" reads the same both ways.
  let differsEitherWay = 0
  for (const v of values) {
    const p = parseDateParts(v)
    if (!p || p.kind !== 'numeric') continue
    numeric++
    if (p.a > 12 && p.b <= 12) dmy++
    else if (p.b > 12 && p.a <= 12) mdy++
    else if (p.a <= 12 && p.b <= 12 && p.a !== p.b) differsEitherWay++
  }
  if (numeric === 0) return { order: fallback, ambiguous: false, numericCount: 0, dmyEvidence: 0, mdyEvidence: 0 }
  if (dmy > 0 && mdy === 0) return { order: 'DMY', ambiguous: false, numericCount: numeric, dmyEvidence: dmy, mdyEvidence: mdy }
  if (mdy > 0 && dmy === 0) return { order: 'MDY', ambiguous: false, numericCount: numeric, dmyEvidence: dmy, mdyEvidence: mdy }
  if (dmy > 0 && mdy > 0) {
    return { order: dmy >= mdy ? 'DMY' : 'MDY', ambiguous: true, numericCount: numeric, dmyEvidence: dmy, mdyEvidence: mdy }
  }
  // No evidence either way: only worth asking when at least one date would actually change meaning.
  return { order: fallback, ambiguous: differsEitherWay > 0, numericCount: numeric, dmyEvidence: 0, mdyEvidence: 0 }
}

export function parseDate(raw: unknown, order: ResolvedOrder): string | null {
  const p = parseDateParts(raw)
  return p ? resolveDate(p, order) : null
}
