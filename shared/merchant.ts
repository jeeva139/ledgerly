// Merchant normalisation shared by recurring detection, reports (top merchants) and anything that
// needs to group "the same payee" across noisy bank narrations. Pure and offline.

const CHANNELS = new Set(['upi', 'neft', 'imps', 'rtgs', 'ach', 'nach', 'ecs', 'pos', 'atm', 'ib', 'bil', 'mmt', 'int', 'pcd', 'emi'])
/** Words that appear around a payee in narrations but are not part of the name. */
const NOISE_TOKENS = new Set(['dr', 'cr', 'p2a', 'p2m', 'p2p', 'ref', 'refno', 'txn', 'payment', 'paid', 'to', 'from', 'by', 'via', 'the', 'purchase', 'debit', 'card'])
/** Corporate suffixes dropped from the key so "Swiggy Ltd" and "Swiggy" group together. */
const COMPANY_SUFFIXES = new Set(['ltd', 'pvt', 'limited', 'private', 'inc', 'llc', 'llp'])

const IFSC = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/
const isDigits = (t: string) => /^\d+$/.test(t)
const hasLettersAndDigits = (t: string) => /[a-z]/i.test(t) && /\d/.test(t)
const isMaskedNumber = (t: string) => /^x{4,}$/i.test(t)
const ASCII_ONLY = /^[\x00-\x7f]*$/

const SEPARATOR = /[-/|~\\]/
const PART = /[^-/|~\\]+/g

function looksLikeIdentifier(part: string): boolean {
  const p = part.trim()
  if (!p) return true
  if (p.includes('@')) return true // VPA
  if (IFSC.test(p)) return true
  if (isDigits(p.replace(/\s+/g, ''))) return true
  if (/^[A-Za-z0-9]{10,}$/.test(p) && hasLettersAndDigits(p)) return true
  return !/[a-z]{2}/i.test(p) // needs at least two consecutive letters to be a name
}

/** Best guess of the payee text inside a bank narration; falls back to the whole string. */
export function extractPayee(raw: string): string {
  const text = raw.trim()
  // Narrations look like "UPI-<payee>-<ids…>": only those need parsing, and parts are scanned lazily
  // (a bank statement can hold 100,000 long narrations).
  const sep = text.search(SEPARATOR)
  if (sep <= 0) return text
  if (!CHANNELS.has(text.slice(0, sep).toLowerCase().replace(/[^a-z]/g, ''))) return text
  PART.lastIndex = sep
  let m: RegExpExecArray | null
  while ((m = PART.exec(text))) {
    const part = m[0].trim()
    if (part && !looksLikeIdentifier(part) && !NOISE_TOKENS.has(part.toLowerCase())) return part
  }
  return text
}

/**
 * Stable grouping key: lowercase, payee extracted from narrations, punctuation removed, long numbers,
 * masked card numbers and mixed reference codes dropped, leading channel words ("POS", "payment to")
 * and company suffixes ("Ltd") removed, trailing numbers removed, whitespace collapsed.
 *   "SWIGGY ORDER #4482913"                → "swiggy order"
 *   "UPI-MR A MANIKANDAN-9578379800-2@YBL…" → "mr a manikandan"
 *   "NETFLIX.COM 800-585-3898 CA"           → "netflix com ca"
 *   "POS 4567XXXXXX1234 AMAZON PAY"         → "amazon pay"
 */
export function normalizeMerchantKey(raw: string): string {
  const base = extractPayee(raw).toLowerCase()
  // ASCII text (the common case) takes a much cheaper regex than the Unicode-aware one.
  const spaced = ASCII_ONLY.test(base) ? base.replace(/[^a-z0-9]+/g, ' ') : base.replace(/[^\p{L}\p{N}]+/gu, ' ')
  let tokens: string[] = []
  for (const t of spaced.split(' ')) {
    if (!t) continue
    if (isDigits(t) ? t.length >= 3 : (t.length >= 6 && hasLettersAndDigits(t)) || isMaskedNumber(t)) continue
    tokens.push(t)
  }

  // Leading channel / noise words, as long as something meaningful remains.
  let start = 0
  while (start < tokens.length - 1 && (CHANNELS.has(tokens[start]) || NOISE_TOKENS.has(tokens[start]))) start++
  tokens = tokens.slice(start)

  tokens = tokens.filter((t, i) => !(COMPANY_SUFFIXES.has(t) && (tokens.length > 1 || i > 0)))

  // Trailing counters / short reference numbers ("order 12").
  while (tokens.length > 1 && isDigits(tokens[tokens.length - 1])) tokens.pop()

  return tokens.join(' ').trim() || raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** "mr a manikandan" → "Mr A Manikandan" */
export function prettyMerchant(key: string): string {
  return key.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}
