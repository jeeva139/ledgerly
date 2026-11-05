import Papa from 'papaparse'
import { decodeText } from '../common/decode'
import type { Cell, ParsedTable } from '../types'

/** Parse a CSV/TSV/semicolon file into rows. The delimiter is auto-detected. */
export function parseCsv(bytes: Uint8Array): ParsedTable {
  const { text, encoding } = decodeText(bytes)
  const res = Papa.parse<string[]>(text, {
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: 'greedy',
    dynamicTyping: false
  })
  const rows: Cell[][] = []
  for (const r of res.data) {
    if (!Array.isArray(r)) continue
    // trim cells; drop rows that are entirely empty
    const cells: Cell[] = r.map((c) => (typeof c === 'string' ? c.trim() : c == null ? null : (c as Cell)))
    if (cells.some((c) => c !== null && c !== '')) rows.push(cells.map((c) => (c === '' ? null : c)))
  }
  return { kind: 'table', format: 'csv', sheets: [], sheet: null, rows, delimiter: res.meta.delimiter, encoding }
}
