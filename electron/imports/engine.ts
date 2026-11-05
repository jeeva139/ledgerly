// Pure parsing entry point shared by the worker thread and the inline fallback.
import { AppError } from '../../shared/errors'
import type { ImportFormat } from '../../shared/api/imports'
import { parseQif } from './qif/parseQif'
import { parseCsv } from './csv/parseCsv'
import { parseExcel } from './excel/parseExcel'
import type { ParsedFile } from './types'

export const MAX_IMPORT_BYTES = 200 * 1024 * 1024

const FORMAT_LABEL: Record<ImportFormat, string> = { qif: 'QIF', csv: 'CSV', excel: 'Excel' }

export function parseBytes(format: ImportFormat, bytes: Uint8Array, opts: { sheet?: string | null } = {}): ParsedFile {
  if (bytes.byteLength === 0) throw new AppError('VALIDATION', 'This file is empty.')
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new AppError('LIMIT', 'This file is larger than 200 MB, which is more than Ledgerly can import at once. Please split it into smaller files.')
  }
  const fail = () =>
    new AppError('VALIDATION', `Ledgerly could not read this file. Check that it is a valid ${FORMAT_LABEL[format]} file and try again.`)
  try {
    if (format === 'qif') {
      const parsed = parseQif(bytes)
      if (parsed.records.length === 0 && parsed.skippedRecords === 0) {
        throw new AppError('VALIDATION', 'No transactions were found in this QIF file. Check that it is a valid QIF export.')
      }
      return parsed
    }
    if (format === 'csv') {
      const parsed = parseCsv(bytes)
      if (parsed.rows.length === 0) throw new AppError('VALIDATION', 'No rows were found in this CSV file.')
      return parsed
    }
    // .xlsx is a ZIP ("PK"), .xls is an OLE2 container. SheetJS would happily read any other text as a sheet.
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b
    const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
    if (!zip && !ole) throw fail()
    const parsed = parseExcel(bytes, opts.sheet)
    if (parsed.rows.length === 0) throw new AppError('VALIDATION', 'No data was found in this Excel sheet. Try another sheet.')
    return parsed
  } catch (e) {
    if (e instanceof AppError) throw e
    throw fail()
  }
}
