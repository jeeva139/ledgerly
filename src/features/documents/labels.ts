import type { DocumentKind, DocumentStatus } from '@shared/types'

export const KIND_LABELS: Record<DocumentKind, string> = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  statement: 'Bank statement',
  spreadsheet: 'Spreadsheet',
  other: 'Other'
}

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  stored: 'Stored',
  review: 'Review required',
  queued: 'Ready to import'
}

export const STATUS_TONE: Record<DocumentStatus, 'info' | 'warning' | undefined> = {
  stored: undefined,
  review: 'warning',
  queued: 'info'
}

/** File types the vault accepts (the native dialog and drag & drop both use this). */
export const ACCEPTED_TYPES = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.tif,.tiff,.csv,.xls,.xlsx,.qif,.txt'

const STATEMENT_EXT = ['.csv', '.xls', '.xlsx', '.qif']
export const isStatementName = (filename: string): boolean => STATEMENT_EXT.some((e) => filename.toLowerCase().endsWith(e))
export const isImageName = (filename: string): boolean => /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(filename)
export const isPdfName = (filename: string): boolean => /\.pdf$/i.test(filename)
export const isSheetName = (filename: string): boolean => /\.(csv|xlsx?|qif)$/i.test(filename)
