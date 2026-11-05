import type { DateFormat, PeriodId } from './types'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Local calendar date as YYYY-MM-DD (never UTC-shifted). */
export function toISODate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now)
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (y < 1900 || y > 2200) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(b) - utc(a)) / 86400000)
}

export function addMonths(iso: string, months: number): string {
  const d = parseISODate(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISODate(d)
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return toISODate(new Date(y, m, 0))
}

/** "2026-03" for a date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function formatMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export interface DateRange {
  /** Inclusive lower bound, or null for open-ended. */
  from: string | null
  /** Inclusive upper bound, or null for open-ended. */
  to: string | null
}

/**
 * Date range for a dashboard/report period.
 * - this-month: first of this month → end of this month
 * - last-month: the previous calendar month
 * - last-3-months / last-6-months: the same calendar day 3 / 6 months ago → today (rolling)
 * - this-year: Jan 1 → Dec 31 of the current year
 */
export function periodRange(period: PeriodId, now: Date = new Date()): DateRange {
  const today = toISODate(now)
  switch (period) {
    case 'all-time':
      return { from: null, to: null }
    case 'this-month':
      return { from: startOfMonth(today), to: endOfMonth(today) }
    case 'last-month': {
      const prev = addMonths(startOfMonth(today), -1)
      return { from: startOfMonth(prev), to: endOfMonth(prev) }
    }
    case 'last-3-months':
      return { from: addDays(addMonths(today, -3), 1), to: today }
    case 'last-6-months':
      return { from: addDays(addMonths(today, -6), 1), to: today }
    case 'this-year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` }
  }
}

export function formatDate(iso: string | null | undefined, fmt: DateFormat = 'DD/MM/YYYY'): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso ?? ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  switch (fmt) {
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`
    default:
      return `${d}/${m}/${y}`
  }
}

export function formatDateTime(isoTimestamp: string, fmt: DateFormat = 'DD/MM/YYYY'): string {
  const d = new Date(isoTimestamp)
  if (Number.isNaN(d.getTime())) return isoTimestamp
  return `${formatDate(toISODate(d), fmt)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
