// QIF (Quicken Interchange Format) parser.
// Records are separated by "^". Recognised fields: D date · T/U amount · P payee · M memo · L category ·
// N number · C cleared · A address · S/E/$/% split lines · "!Type:", "!Account", "!Option" headers.
import { decodeText } from '../common/decode'
import type { ParsedQif, QifRecord } from '../types'

/** Sections whose records are real transactions. Everything else is counted as skipped. */
const TRANSACTION_SECTIONS = new Set(['bank', 'cash', 'ccard', 'oth a', 'etha', 'oth l', 'othl', 'liability', 'asset', 'port'])
const SECTION_LABELS: Record<string, string> = {
  invst: 'Investment',
  cat: 'Categories',
  class: 'Classes',
  memorized: 'Memorized transactions',
  tag: 'Tags',
  prices: 'Prices',
  security: 'Securities'
}

function sectionKey(typeText: string): string {
  return typeText.trim().toLowerCase()
}

export function parseQif(bytes: Uint8Array): ParsedQif {
  const { text, encoding } = decodeText(bytes)
  const lines = text.split(/\r\n|\n|\r/)

  const records: QifRecord[] = []
  const accountNames: string[] = []
  const skippedSections = new Set<string>()
  let skippedRecords = 0
  let accountType: string | null = null

  let section = 'Bank' // a file without a header is treated as a bank register
  let sectionIsTransactions = true
  let inAccountList = false

  const state: { cur: Partial<QifRecord> | null } = { cur: null }
  let curLine = 0
  let addressLines = 0
  let hasFields = false

  const startRecord = (lineNo: number) => {
    state.cur = { section, date: '', amount: '', payee: '', memo: '', category: '', number: '', cleared: '', splitCategories: [], line: lineNo }
    curLine = lineNo
    addressLines = 0
    hasFields = false
  }

  const finishRecord = () => {
    const cur = state.cur
    if (!cur) return
    if (inAccountList) {
      // !Account block: N<name> T<type> ^
      if (cur.payee) accountNames.push(cur.payee)
    } else if (hasFields) {
      if (sectionIsTransactions) {
        records.push({ ...(cur as QifRecord), line: curLine })
        if (accountType === null) accountType = section
      } else {
        skippedRecords++
        skippedSections.add(SECTION_LABELS[sectionKey(section)] ?? section)
      }
    }
    state.cur = null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw) continue
    const line = raw.trimEnd()
    if (!line.trim()) continue

    if (line[0] === '!') {
      finishRecord()
      const lower = line.toLowerCase()
      if (lower.startsWith('!type:')) {
        section = line.slice(6).trim() || 'Bank'
        const key = sectionKey(section)
        sectionIsTransactions = TRANSACTION_SECTIONS.has(key)
        inAccountList = false
      } else if (lower.startsWith('!account')) {
        inAccountList = true
        sectionIsTransactions = false
      } else {
        // !Option:AutoSwitch / !Clear:AutoSwitch and friends: nothing to import
        if (lower.startsWith('!clear:autoswitch')) inAccountList = false
      }
      continue
    }

    if (line === '^' || line.startsWith('^')) {
      finishRecord()
      continue
    }

    const code = line[0]
    // QIF field codes are single upper-case letters (plus $ and %). Anything else is not QIF data.
    if (!/[A-Z$%]/.test(code)) continue
    if (!state.cur) startRecord(i + 1)
    const c = state.cur as Partial<QifRecord>
    const value = line.slice(1).trim()
    hasFields = true

    if (inAccountList) {
      if (code === 'N') c.payee = value
      continue
    }
    switch (code) {
      case 'D':
        c.date = value
        break
      case 'T':
        c.amount = value
        break
      case 'U':
        if (!c.amount) c.amount = value
        break
      case 'P':
        c.payee = value
        break
      case 'M':
        c.memo = value
        break
      case 'L':
        c.category = value
        break
      case 'N':
        c.number = value
        break
      case 'C':
        c.cleared = value
        break
      case 'A':
        addressLines++
        break
      case 'S':
        c.splitCategories = [...(c.splitCategories ?? []), value]
        break
      default:
        // E (split memo), $ (split amount), % , F, I, Q, Y, O …: the total in T is what we import
        break
    }
  }
  finishRecord()

  return {
    kind: 'qif',
    records,
    accountType,
    accountNames,
    skippedRecords,
    skippedSections: [...skippedSections],
    encoding
  }
}
