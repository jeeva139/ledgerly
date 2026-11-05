// Local, offline extraction of merchant / date / total from documents.
// - Text files and PDFs with a text layer are parsed with heuristics.
// - Images (no OCR engine ships with Ledgerly) and anything uncertain are reported as unavailable.
// Values are NEVER invented: a field Ledgerly cannot read stays null and the result always needs review.
import { inflateSync } from 'node:zlib'
import { isValidISODate, toISODate } from '../../shared/dates'
import { firstMatchingRule, type CompiledRule } from '../../shared/matching'
import { round2 } from '../../shared/money'
import type { DateFormat, DocumentExtraction, DocumentKind } from '../../shared/types'

export const UNAVAILABLE_MESSAGE = 'Automatic text extraction is unavailable for this document.\nYou can enter the transaction manually.'
export const STATEMENT_MESSAGE = 'This file looks like a bank statement. Use Import to add its transactions.'
const NOTHING_FOUND_MESSAGE = 'Ledgerly could not read a merchant, date or total from this document.\nYou can enter the transaction manually.'
const REVIEW_MESSAGE = 'Review required. Please check these values before creating a transaction. Anything Ledgerly could not read is left empty.'

const unavailable = (message = UNAVAILABLE_MESSAGE): DocumentExtraction => ({
  merchant: null, date: null, amount: null, type: null, category: null, message
})

// =============================================================================================
// PDF text layer (best effort, no external libraries)
// =============================================================================================

interface PdfObject {
  dict: string
  data?: Buffer
}

type CMap = { bytes: number; map: Map<number, string> }
const MAX_INFLATED = 60 * 1024 * 1024

function tryInflate(buf: Buffer): Buffer | null {
  try {
    return inflateSync(buf)
  } catch {
    try {
      // Some writers append junk after the zlib stream.
      return inflateSync(buf, { finishFlush: 2 /* Z_SYNC_FLUSH */ })
    } catch {
      return null
    }
  }
}

function parsePdfObjects(buf: Buffer): Map<number, PdfObject> {
  const raw = buf.toString('latin1')
  const objects = new Map<number, PdfObject>()
  const header = /(\d+)\s+(\d+)\s+obj\b/g
  const starts: { num: number; bodyStart: number; headStart: number }[] = []
  for (let m = header.exec(raw); m; m = header.exec(raw)) {
    starts.push({ num: Number(m[1]), bodyStart: m.index + m[0].length, headStart: m.index })
  }
  let inflatedTotal = 0
  const objStreams: { dict: string; data: Buffer }[] = []

  for (let i = 0; i < starts.length; i++) {
    const { num, bodyStart } = starts[i]
    const bodyEnd = i + 1 < starts.length ? starts[i + 1].headStart : raw.length
    const body = raw.slice(bodyStart, bodyEnd)
    const sm = /stream\r?\n/.exec(body)
    if (!sm || !/>>\s*$/.test(body.slice(0, sm.index))) {
      objects.set(num, { dict: body })
      continue
    }
    const dict = body.slice(0, sm.index)
    const dataStart = bodyStart + sm.index + sm[0].length
    const endRel = body.indexOf('endstream', sm.index + sm[0].length)
    const dataEnd = endRel >= 0 ? bodyStart + endRel : bodyEnd
    let data: Buffer | undefined = buf.subarray(dataStart, dataEnd)
    if (/\/FlateDecode/.test(dict)) {
      const inflated = tryInflate(data)
      inflatedTotal += inflated?.length ?? 0
      if (inflatedTotal > MAX_INFLATED) break
      data = inflated ?? undefined
    } else if (/\/Filter/.test(dict)) {
      data = undefined // image / other filters: not text we can read
    }
    objects.set(num, { dict, data })
    if (data && /\/Type\s*\/ObjStm/.test(dict)) objStreams.push({ dict, data })
  }

  // Objects packed inside object streams (PDF 1.5+): fonts and resources often live here.
  for (const os of objStreams) {
    const n = Number(/\/N\s+(\d+)/.exec(os.dict)?.[1] ?? 0)
    const first = Number(/\/First\s+(\d+)/.exec(os.dict)?.[1] ?? 0)
    if (!n || !first) continue
    const text = os.data.toString('latin1')
    const nums = text.slice(0, first).trim().split(/\s+/).map(Number)
    for (let k = 0; k < n; k++) {
      const objNum = nums[k * 2]
      const off = nums[k * 2 + 1]
      const next = k + 1 < n ? nums[(k + 1) * 2 + 1] : text.length - first
      if (Number.isFinite(objNum) && Number.isFinite(off) && !objects.has(objNum)) {
        objects.set(objNum, { dict: text.slice(first + off, first + next) })
      }
    }
  }
  return objects
}

function parseCMap(text: string): CMap | null {
  const map = new Map<number, string>()
  let bytes = 0
  const hexToText = (hex: string): string => {
    let out = ''
    for (let i = 0; i + 3 < hex.length + 1; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
    return out
  }
  const chars = /beginbfchar([\s\S]*?)endbfchar/g
  for (let m = chars.exec(text); m; m = chars.exec(text)) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g
    for (let p = re.exec(m[1]); p; p = re.exec(m[1])) {
      bytes = bytes || p[1].length / 2
      map.set(parseInt(p[1], 16), hexToText(p[2].padStart(4, '0')))
    }
  }
  const ranges = /beginbfrange([\s\S]*?)endbfrange/g
  for (let m = ranges.exec(text); m; m = ranges.exec(text)) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g
    for (let p = re.exec(m[1]); p; p = re.exec(m[1])) {
      bytes = bytes || p[1].length / 2
      const lo = parseInt(p[1], 16)
      const hi = Math.min(parseInt(p[2], 16), lo + 65535)
      if (p[4]) {
        const base = parseInt(p[4], 16)
        const width = p[4].length
        for (let c = lo; c <= hi; c++) map.set(c, hexToText((base + (c - lo)).toString(16).padStart(Math.max(4, width), '0')))
      } else if (p[5]) {
        const items = [...p[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1])
        items.forEach((h, idx) => map.set(lo + idx, hexToText(h.padStart(4, '0'))))
      }
    }
  }
  return map.size ? { bytes: bytes || 2, map } : null
}

type Operand = number | string | { s: string } | Operand[]

/** Minimal content-stream tokenizer: calls onOp(operator, operands) for every operator. */
function runContent(s: string, onOp: (op: string, args: Operand[]) => void): void {
  let i = 0
  const n = s.length
  let stack: Operand[] = []
  const arrays: Operand[][] = []
  const push = (v: Operand) => (arrays.length ? arrays[arrays.length - 1] : stack).push(v)
  const isWs = (c: string) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0'
  const isDelim = (c: string) => '()<>[]{}/%'.includes(c)

  while (i < n) {
    const c = s[i]
    if (isWs(c)) {
      i++
    } else if (c === '%') {
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++
    } else if (c === '(') {
      let depth = 1
      let out = ''
      i++
      while (i < n && depth > 0) {
        const ch = s[i]
        if (ch === '\\') {
          const nx = s[i + 1]
          if (nx === 'n') out += '\n'
          else if (nx === 'r') out += '\r'
          else if (nx === 't') out += '\t'
          else if (nx === 'b') out += '\b'
          else if (nx === 'f') out += '\f'
          else if (nx >= '0' && nx <= '7') {
            const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))![0]
            out += String.fromCharCode(parseInt(oct, 8) & 255)
            i += oct.length
            continue
          } else if (nx === '\n' || nx === '\r') {
            /* line continuation */
          } else out += nx ?? ''
          i += 2
          continue
        }
        if (ch === '(') depth++
        else if (ch === ')') {
          depth--
          if (depth === 0) break
        }
        out += ch
        i++
      }
      i++
      push({ s: out })
    } else if (c === '<') {
      if (s[i + 1] === '<') {
        i += 2
      } else {
        const end = s.indexOf('>', i)
        const hex = s.slice(i + 1, end < 0 ? n : end).replace(/\s+/g, '')
        let out = ''
        for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16))
        push({ s: out })
        i = end < 0 ? n : end + 1
      }
    } else if (c === '>') {
      i += s[i + 1] === '>' ? 2 : 1
    } else if (c === '[') {
      arrays.push([])
      i++
    } else if (c === ']') {
      const a = arrays.pop()
      if (a) push(a)
      i++
    } else if (c === '/') {
      let j = i + 1
      while (j < n && !isWs(s[j]) && !isDelim(s[j])) j++
      push('/' + s.slice(i + 1, j))
      i = j
    } else {
      let j = i
      while (j < n && !isWs(s[j]) && !isDelim(s[j])) j++
      const word = s.slice(i, j)
      i = j === i ? i + 1 : j
      if (word === '') continue
      const num = Number(word)
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) && Number.isFinite(num)) push(num)
      else if (word === 'BI') {
        const ei = s.indexOf('EI', i)
        i = ei < 0 ? n : ei + 2
        stack = []
      } else {
        onOp(word, stack)
        stack = []
      }
    }
  }
}

function plausible(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (t.length < 12) return false
  let ok = 0
  for (const ch of t) if (/[\p{L}\p{N}.,:;/\-+()%&@#$€£₹*'"!?]/u.test(ch)) ok++
  return ok / t.length > 0.9 && /\p{L}{3,}/u.test(text)
}

/** Best-effort text of a PDF with a text layer. Returns '' for scanned/unsupported PDFs. */
export function extractPdfText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.subarray(0, 8).toString('latin1').indexOf('%PDF') < 0 && buf.toString('latin1', 0, 1024).indexOf('%PDF') < 0) return ''
  let objects: Map<number, PdfObject>
  try {
    objects = parsePdfObjects(buf)
  } catch {
    return ''
  }

  // Font resource names → ToUnicode maps.
  const cmapOfObj = new Map<number, CMap | null>()
  const cmapFor = (objNum: number): CMap | null => {
    if (cmapOfObj.has(objNum)) return cmapOfObj.get(objNum)!
    const o = objects.get(objNum)
    const parsed = o?.data ? parseCMap(o.data.toString('latin1')) : null
    cmapOfObj.set(objNum, parsed)
    return parsed
  }
  const fontCmaps = new Map<string, CMap | null>() // resource name -> cmap
  const addFontPairs = (fontDict: string) => {
    for (const m of fontDict.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const font = objects.get(Number(m[2]))
      const tu = font ? /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(font.dict) : null
      fontCmaps.set(m[1], tu ? cmapFor(Number(tu[1])) : null)
    }
  }
  for (const o of objects.values()) {
    for (const m of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)) addFontPairs(m[1])
    for (const m of o.dict.matchAll(/\/Font\s+(\d+)\s+\d+\s+R/g)) {
      const ref = objects.get(Number(m[1]))
      if (ref) addFontPairs(ref.dict)
    }
  }

  const pages: string[] = []
  const nums = [...objects.keys()].sort((a, b) => a - b)
  for (const num of nums) {
    const o = objects.get(num)!
    if (!o.data || /\/Subtype\s*\/(Image|Form)\b/.test(o.dict) && !/BT/.test(o.data.toString('latin1', 0, 4096))) continue
    const content = o.data.toString('latin1')
    if (!/\bBT\b/.test(content) || !/\b(Tj|TJ)\b/.test(content)) continue

    let out = ''
    let font: CMap | null = null
    let lastY: number | null = null
    const decode = (str: string): string => {
      if (font) {
        let t = ''
        for (let k = 0; k < str.length; k += font.bytes) {
          let code = 0
          for (let b = 0; b < font.bytes; b++) code = (code << 8) | (str.charCodeAt(k + b) & 255)
          t += font.map.get(code) ?? ''
        }
        return t
      }
      return str.replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    }
    const nl = () => {
      if (!out.endsWith('\n')) out += '\n'
    }
    const sp = () => {
      if (!out.endsWith(' ') && !out.endsWith('\n') && out) out += ' '
    }
    runContent(content, (op, args) => {
      switch (op) {
        case 'Tf':
          font = fontCmaps.get(String(args[0]).replace(/^\//, '')) ?? null
          break
        case 'Tj':
          out += decode((args[0] as { s: string })?.s ?? '')
          break
        case 'TJ': {
          for (const item of (args[0] as Operand[]) ?? []) {
            if (typeof item === 'object' && !Array.isArray(item)) out += decode(item.s)
            else if (typeof item === 'number' && item < -250) sp()
          }
          break
        }
        case "'":
        case '"':
          nl()
          out += decode((args[args.length - 1] as { s: string })?.s ?? '')
          break
        case 'Td':
        case 'TD': {
          const ty = Number(args[1] ?? 0)
          if (Math.abs(ty) > 0.5) nl()
          else sp()
          break
        }
        case 'T*':
          nl()
          break
        case 'Tm': {
          const y = Number(args[5] ?? 0)
          if (lastY !== null && Math.abs(y - lastY) > 1) nl()
          else sp()
          lastY = y
          break
        }
        case 'ET':
          nl()
          break
      }
    })
    pages.push(out)
  }
  const text = pages.join('\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return plausible(text) ? text : ''
}

// =============================================================================================
// Text → receipt fields
// =============================================================================================

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
}

function toISO(y: number, m: number, d: number, now: Date): string | null {
  if (y < 100) y += 2000
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (!isValidISODate(iso)) return null
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (y < 2000 || iso > toISODate(tomorrow)) return null
  return iso
}

/** First plausible calendar date in a piece of text. Ambiguous d/m vs m/d follows the user's date-format preference. */
export function findDate(text: string, dateFormat: DateFormat = 'DD/MM/YYYY', now: Date = new Date()): string | null {
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text)
  if (iso) {
    const v = toISO(Number(iso[1]), Number(iso[2]), Number(iso[3]), now)
    if (v) return v
  }
  const num = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(text)
  if (num) {
    const a = Number(num[1])
    const b = Number(num[2])
    const y = Number(num[3])
    let d = a
    let m = b
    if (a > 12) {
      d = a
      m = b
    } else if (b > 12) {
      d = b
      m = a
    } else if (dateFormat === 'MM/DD/YYYY') {
      d = b
      m = a
    }
    const v = toISO(y, m, d, now)
    if (v) return v
  }
  const dmy = /\b(\d{1,2})(?:st|nd|rd|th)?[\s.-]+([A-Za-z]{3,9})[\s,.-]+(\d{4}|\d{2})\b/.exec(text)
  if (dmy) {
    const m = MONTHS[dmy[2].slice(0, 3).toLowerCase()]
    if (m) {
      const v = toISO(Number(dmy[3]), m, Number(dmy[1]), now)
      if (v) return v
    }
  }
  const mdy = /\b([A-Za-z]{3,9})[\s.-]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(text)
  if (mdy) {
    const m = MONTHS[mdy[1].slice(0, 3).toLowerCase()]
    if (m) {
      const v = toISO(Number(mdy[3]), m, Number(mdy[2]), now)
      if (v) return v
    }
  }
  return null
}

/** Parse "1,234.50", "₹ 1,23,456", "12.5" → number. */
function parseAmountToken(tok: string): number | null {
  // Drop any currency prefix first ("Rs. 1,200" must not keep the dot after "Rs").
  const cleaned = tok.replace(/^[^\d]+/, '').replace(/[^\d.,]/g, '')
  if (!cleaned) return null
  let s = cleaned
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && (s.match(/,/g) ?? []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) && n > 0 && n < 1e10 ? round2(n) : null
}

const AMOUNT_TOKEN = /(?:(?:rs\.?|inr|usd|eur|gbp|aed|[₹$€£])\s*)?\d[\d,]*(?:\.\d{1,2})?/gi

function amountsOnLine(line: string): number[] {
  const out: number[] = []
  for (const m of line.matchAll(AMOUNT_TOKEN)) {
    const v = parseAmountToken(m[0])
    if (v !== null) out.push(v)
  }
  return out
}

const STRONG_TOTAL = /grand\s*total|total\s*(amount\s*)?(due|payable|paid)|amount\s*(due|payable|paid)|net\s*(amount|payable|total)|balance\s*due|total\s*charge|you\s*paid/i
const PLAIN_TOTAL = /\btotal\b/i
const NOT_TOTAL = /sub\s*-?\s*total|total\s*(tax|gst|vat|discount|savings?|items?|qty|quantity|before)|tax\s*total/i

/** The document total — only taken from lines that actually say "total / amount due …". */
export function findTotal(lines: string[]): number | null {
  let strong: number | null = null
  let plainMax: number | null = null
  for (const line of lines) {
    if (NOT_TOTAL.test(line)) continue
    const vals = amountsOnLine(line)
    if (!vals.length) continue
    // The value is normally the right-most number on the line.
    const value = vals[vals.length - 1]
    if (STRONG_TOTAL.test(line)) strong = value
    else if (PLAIN_TOTAL.test(line)) plainMax = plainMax === null ? value : Math.max(plainMax, value)
  }
  return strong ?? plainMax
}

const MERCHANT_LABEL = /^(?:merchant|vendor|seller|store|shop|paid\s*to|sold\s*by|billed\s*by|payee|from)\s*[:\-]\s*(.{2,80})$/i
const MERCHANT_SKIP = /^(?:tax\s*)?(?:invoice|receipt|bill|cash\s*memo|statement|order|gstin|gst|vat|tel|phone|ph\b|mobile|www\.|http|date|time|no\.?\b|#|thank|welcome|page\s*\d|duplicate|original|customer|name\s*:)/i

export function findMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 40)) {
    const m = MERCHANT_LABEL.exec(line.trim())
    if (m) return m[1].trim().replace(/\s+/g, ' ')
  }
  for (const raw of lines.slice(0, 10)) {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (line.length < 3 || line.length > 80) continue
    if (MERCHANT_SKIP.test(line)) continue
    const letters = (line.match(/\p{L}/gu) ?? []).length
    const digits = (line.match(/\d/g) ?? []).length
    if (letters < 3 || digits > letters * 0.5) continue
    if (findDate(line)) continue
    return line
  }
  return null
}

export interface ReceiptParseOptions {
  kind?: DocumentKind
  dateFormat?: DateFormat
  rules?: CompiledRule[]
  now?: Date
}

/** Heuristic parse of receipt/invoice text. Pure and deterministic. */
export function parseReceiptText(text: string, opts: ReceiptParseOptions = {}): DocumentExtraction {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const merchant = findMerchant(lines)
  const dateLine = lines.find((l) => /date|dated|issued|invoice\s*no|bill\s*date|time/i.test(l) && findDate(l, opts.dateFormat, opts.now))
  const date = (dateLine ? findDate(dateLine, opts.dateFormat, opts.now) : null) ?? findDate(text, opts.dateFormat, opts.now)
  const amount = findTotal(lines)
  const category = merchant && opts.rules?.length ? (firstMatchingRule(merchant, opts.rules)?.rule.thenText ?? null) : null
  // Only receipts are certain to be money going out; invoices could be either, so the user decides.
  const type = opts.kind === 'receipt' && (merchant || amount !== null) ? ('expense' as const) : null
  // A first line of text alone is not evidence of a transaction: need at least a date or a total.
  if (!date && amount === null) return unavailable(NOTHING_FOUND_MESSAGE)
  return { merchant, date, amount, type, category, message: REVIEW_MESSAGE }
}

function decodeText(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8.replace(/^﻿/, '')
}

const STATEMENT_EXT = new Set(['.csv', '.xls', '.xlsx', '.qif'])

export interface ExtractInput {
  filename: string
  bytes: Uint8Array
  kind: DocumentKind
  dateFormat?: DateFormat
  rules?: CompiledRule[]
  now?: Date
}

/** Run local extraction for one document. */
export function extractDocument(input: ExtractInput): DocumentExtraction {
  const ext = (/\.[^.]+$/.exec(input.filename)?.[0] ?? '').toLowerCase()
  if (STATEMENT_EXT.has(ext)) return unavailable(STATEMENT_MESSAGE)
  let text = ''
  try {
    if (ext === '.txt') text = decodeText(input.bytes)
    else if (ext === '.pdf') text = extractPdfText(input.bytes)
  } catch {
    text = ''
  }
  if (!text.trim()) return unavailable()
  return parseReceiptText(text, { kind: input.kind, dateFormat: input.dateFormat, rules: input.rules, now: input.now })
}

/** True when the result carries at least one real value that needs reviewing. */
export const hasExtractedValues = (e: DocumentExtraction): boolean => e.merchant !== null || e.date !== null || e.amount !== null
