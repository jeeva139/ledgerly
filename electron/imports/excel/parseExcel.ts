import * as XLSX from 'xlsx'
import type { Cell, ParsedTable } from '../types'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Convert an Excel serial date to YYYY-MM-DD with no timezone involvement. */
function serialToIso(serial: number): string | null {
  const p = XLSX.SSF.parse_date_code(serial)
  if (!p || !p.y || p.y < 1900 || p.y > 2200) return null
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`
}

function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt || fmt === 'General') return false
  try {
    return XLSX.SSF.is_date(fmt)
  } catch {
    return false
  }
}

export function excelSheetNames(bytes: Uint8Array): string[] {
  const wb = XLSX.read(bytes, { type: 'array', bookSheets: true })
  return wb.SheetNames
}

/**
 * Read one sheet into rows. Real date cells become YYYY-MM-DD text (exact, no timezone drift);
 * numbers stay numbers; everything else becomes trimmed text.
 */
export function parseExcel(bytes: Uint8Array, wantedSheet?: string | null): ParsedTable {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: false })
  const names = wb.SheetNames
  if (names.length === 0) return { kind: 'table', format: 'excel', sheets: [], sheet: null, rows: [] }

  let sheetName = wantedSheet && names.includes(wantedSheet) ? wantedSheet : null
  if (!sheetName) {
    // first sheet that actually has data
    sheetName =
      names.find((n) => {
        const ref = wb.Sheets[n]?.['!ref']
        if (!ref) return false
        const r = XLSX.utils.decode_range(ref)
        return r.e.r > r.s.r || r.e.c > r.s.c
      }) ?? names[0]
  }
  const ws = wb.Sheets[sheetName]
  const rows: Cell[][] = []
  if (ws && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref'])
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: Cell[] = []
      let any = false
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
        let v: Cell = null
        if (cell && cell.v !== undefined && cell.v !== null) {
          if (cell.t === 'n' && typeof cell.v === 'number') {
            v = isDateFormat(cell.z as string | undefined) ? (serialToIso(cell.v) ?? cell.v) : cell.v
          } else if (cell.t === 'd' && cell.v instanceof Date) {
            v = `${pad(cell.v.getUTCFullYear(), 4)}-${pad(cell.v.getUTCMonth() + 1)}-${pad(cell.v.getUTCDate())}`
          } else if (cell.t === 'e') {
            v = null
          } else {
            const t = String(cell.v).trim()
            v = t === '' ? null : t
          }
        }
        if (v !== null) any = true
        row.push(v)
      }
      if (any) rows.push(row)
    }
  }
  return { kind: 'table', format: 'excel', sheets: names, sheet: sheetName, rows }
}
