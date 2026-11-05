export interface CurrencyDef {
  code: string
  symbol: string
  name: string
  locale: string
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham', locale: 'en-AE' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' }
]

export function currencyDef(code: string): CurrencyDef {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]
}

/** Round to 2 decimals without float noise (e.g. 1.005 → 1.01). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function formatMoney(amount: number, currencyCode = 'INR', opts: { sign?: boolean; compact?: boolean } = {}): string {
  const c = currencyDef(currencyCode)
  const value = Number.isFinite(amount) ? amount : 0
  const abs = Math.abs(value)
  const fractionDigits = c.code === 'JPY' ? 0 : 2
  const body = opts.compact && abs >= 1000
    ? new Intl.NumberFormat(c.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(abs)
    : new Intl.NumberFormat(c.locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(abs)
  const sign = value < 0 ? '−' : opts.sign && value > 0 ? '+' : ''
  return `${sign}${c.symbol}${body}`
}

/** Savings rate = ((income − spending) / income) × 100; 0 when there is no income. */
export function savingsRate(income: number, spending: number): number {
  if (!(income > 0)) return 0
  return round2(((income - spending) / income) * 100)
}
