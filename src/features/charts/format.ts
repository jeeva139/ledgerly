import { formatMonthKey } from '@shared/dates'
import { currencyDef } from '@shared/money'
import type { BucketGranularity } from '@shared/api/reports'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Short axis label: "5 Mar" (day) or "Mar ’26" (month). */
export function bucketLabel(key: string, granularity: BucketGranularity): string {
  if (granularity === 'day') {
    const [, m, d] = key.split('-').map(Number)
    return `${d} ${MONTHS[m - 1]}`
  }
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ’${String(y).slice(2)}`
}

/** Full label for tooltips and tables: "5 Mar 2026" or "Mar 2026". */
export function bucketLabelLong(key: string, granularity: BucketGranularity): string {
  if (granularity === 'day') {
    const [y, m, d] = key.split('-').map(Number)
    return `${d} ${MONTHS[m - 1]} ${y}`
  }
  return formatMonthKey(key)
}

export const monthLabel = (key: string): string => formatMonthKey(key)

/** Compact money for axis ticks: ₹500, ₹12.5K, ₹3L (locale aware), no decimals under 1,000. */
export function axisMoney(n: number, currencyCode: string): string {
  const c = currencyDef(currencyCode)
  const abs = Math.abs(n)
  const body =
    abs >= 1000
      ? new Intl.NumberFormat(c.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(abs)
      : String(Math.round(abs))
  return `${n < 0 ? '−' : ''}${c.symbol}${body}`
}
