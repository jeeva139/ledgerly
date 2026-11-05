// Tolerant amount parsing for bank statements.
// Handles: currency symbols, thousands separators (1,234.56 · 1.234,56 · Indian 1,23,456.78),
// European decimal commas, (parentheses) and leading/trailing minus as negatives, and Dr/Cr markers.

export interface ParsedAmount {
  /** Signed value: negative = money out as written in the source. */
  value: number
  /** Explicit "Dr"/"Cr" marker found next to the number, if any. */
  indicator: 'dr' | 'cr' | null
}

const INDICATOR_SUFFIX = /(?:^|(?<=[\d\s.,)]))(dr|cr|debit|credit)\.?\s*$/i
const INDICATOR_PREFIX = /^\s*(dr|cr|debit|credit)\.?(?=[\s\d(\-−₹$€£¥])/i

export function parseAmount(input: unknown): ParsedAmount | null {
  if (typeof input === 'number') return Number.isFinite(input) ? { value: input, indicator: null } : null
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (!s) return null

  let indicator: 'dr' | 'cr' | null = null
  const suf = INDICATOR_SUFFIX.exec(s)
  if (suf) {
    indicator = suf[1].toLowerCase().startsWith('d') ? 'dr' : 'cr'
    s = s.slice(0, suf.index).trim()
  } else {
    const pre = INDICATOR_PREFIX.exec(s)
    if (pre) {
      indicator = pre[1].toLowerCase().startsWith('d') ? 'dr' : 'cr'
      s = s.slice(pre[0].length).trim()
    }
  }

  // drop currency symbols / words that come before the number ("$-12.50", "Rs. 2,500", "INR 100")
  s = s.replace(/^[^\d()\-−–+.,]+/, '').trim()
  if (/^\.(?!\d)/.test(s)) s = s.replace(/^[.\s]+/, '') // the dot of "Rs." — but keep ".50"

  let negative = false
  const paren = /^\((.*)\)$/.exec(s)
  if (paren) {
    negative = true
    s = paren[1].trim()
  }
  if (/^[-−–]/.test(s)) {
    negative = !negative ? true : negative
    s = s.slice(1).trim()
  }
  if (/[-−–]$/.test(s)) {
    negative = true
    s = s.slice(0, -1).trim()
  }
  // keep only digits and separators (drops currency symbols / letters like "Rs.", "INR")
  s = s.replace(/[^\d.,]/g, '')
  if (!/\d/.test(s)) return null

  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    // the separator that comes last is the decimal one
    if (lastDot > lastComma) normalized = s.replace(/,/g, '')
    else normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (lastComma >= 0) {
    const commas = (s.match(/,/g) ?? []).length
    const after = s.length - lastComma - 1
    if (commas > 1) normalized = s.replace(/,/g, '') // 1,23,456
    else if (after === 3 && lastComma > 0) normalized = s.replace(',', '') // 1,234 → thousands
    else normalized = s.replace(',', '.') // 12,5 / 1234,56 → decimal comma
  } else if (lastDot >= 0) {
    const dots = (s.match(/\./g) ?? []).length
    normalized = dots > 1 ? s.replace(/\./g, '') : s // 1.234.567 → thousands; 12.50 → decimal
  } else {
    normalized = s
  }
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return { value: negative ? -n : n, indicator }
}

/** "Dr"/"Debit"/"W"… → expense; "Cr"/"Credit"/"D"… → income; anything else → null. */
export function indicatorType(text: unknown): 'expense' | 'income' | null {
  if (typeof text !== 'string') return null
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (/^(dr|debit|d|withdrawal|withdraw|w|out|paid out|expense)\b/.test(t)) return 'expense'
  if (/^(cr|credit|c|deposit|in|paid in|income)\b/.test(t)) return 'income'
  return null
}
